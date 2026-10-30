import { app, BrowserWindow, ipcMain, safeStorage, shell, Menu, Tray, nativeImage, dialog } from 'electron';
import { createChatGPT } from './sdk/index.js';
import { createBridge } from './bridge.mjs';
import { createProviderStore, PROVIDERS } from './providers.mjs';
import { createApiProvider } from './api-provider.mjs';
import { createWorkbuddyProvider } from './workbuddy-provider.mjs';
import { readWorkbuddyModels } from './workbuddy-models.mjs';
import { createUpdates } from './updates.mjs';
import { writeLoginBatch } from './workbuddy-login.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '..');
const resources = app.isPackaged ? process.resourcesPath : join(root, 'vendor');
const node = join(resources, 'runtime', 'node.exe');
const data = process.env.DPY_DATA_DIR ? resolve(process.env.DPY_DATA_DIR) : app.isPackaged ? join(app.getPath('appData'), 'DPY-Pet') : join(root, 'data');
mkdirSync(data, { recursive: true });
app.setName('DPY 桌宠');
app.setAppUserModelId('io.github.rosacmds.dpy');
app.setPath('userData', join(data, 'desktop'));
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
let window, tray, pet, bridge, chatgpt;
let providers, updates;
let workbuddyCatalog = { status: 'idle', models: [], currentModelId: '', updatedAt: '', error: '' };
let workbuddyCatalogRequest;
const catalogAbort = new AbortController();
const activeRequests = new Set();
let quitting = false;
let model = '';
let models = [];
let busy = false;
let notice = '';
const log = text => appendFileSync(join(data, 'launcher.log'), `${new Date().toISOString()} ${text}\n`);
try { model = JSON.parse(readFileSync(join(data, 'preferences.json'), 'utf8')).model ?? ''; } catch {}
const page = pathToFileURL(join(directory, 'settings.html')).href;
const show = () => { if (window && !window.isDestroyed()) { window.show(); window.restore(); window.focus(); } };
app.on('second-instance', show);

async function refreshModels() {
  const session = await chatgpt.getSession();
  models = session.sharing ? await chatgpt.listModels({ signal: AbortSignal.timeout(20000) }) : [];
  if (!models.some(m => m.slug === model)) model = models[0]?.slug ?? '';
  writeFileSync(join(data, 'preferences.json'), JSON.stringify({ model }));
}
async function state() {
  return { update: updates.state(), session: await chatgpt.getSession(), models, model, busy, notice, connections: providers.publicState(), workbuddyCatalog, petRunning: !!pet && pet.exitCode === null };
}
const workbuddyCli = join(resources, 'workbuddy-cli', 'node_modules', '@tencent-ai', 'codebuddy-code', 'bin', 'codebuddy');
async function refreshWorkbuddyModels() {
  if (workbuddyCatalogRequest) return workbuddyCatalogRequest;
  workbuddyCatalog = { ...workbuddyCatalog, status: 'loading', error: '' };
  workbuddyCatalogRequest = (async () => {
    try {
      const catalog = await readWorkbuddyModels({ executable: node, cliPath: workbuddyCli, root, dataDir: data, signal: catalogAbort.signal });
      workbuddyCatalog = { ...catalog, status: 'ready', error: '' };
    } catch (error) { workbuddyCatalog = { ...workbuddyCatalog, status: 'error', error: error.message }; }
    finally { workbuddyCatalogRequest = undefined; }
    return workbuddyCatalog;
  })();
  return workbuddyCatalogRequest;
}
function selectedBackend(id = providers.active()) {
  const preset = PROVIDERS.find(p => p.id === id);
  const config = providers.connection(id);
  const client = id === 'chatgpt' ? chatgpt : preset.kind === 'cli' ? createWorkbuddyProvider({ executable: node, cliPath: workbuddyCli, root, dataDir: data, nodeMode: false, getModel: () => config.model }) : createApiProvider({ getConnection: () => config });
  return { model: id === 'chatgpt' ? model : config.model, needsSession: id === 'chatgpt', client: {
    getSession: () => chatgpt.getSession(),
    async streamResponse(options) {
      const controller = new AbortController(); activeRequests.add(controller);
      try { return await client.streamResponse({ ...options, signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal }); }
      finally { activeRequests.delete(controller); }
    },
  } };
}
function validate(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== page) throw new Error('Invalid settings window.');
}
function privateJson(file, value) {
  // This file contains a process-local capability, never an OpenAI credential.
  writeFileSync(file, '');
  const who = execFileSync(join(process.env.SystemRoot, 'System32', 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
  const sid = who.match(/\bS-1-\d+(?:-\d+)+\b/)?.[0];
  if (!sid) throw new Error('Cannot identify local owner.');
  execFileSync(join(process.env.SystemRoot, 'System32', 'icacls.exe'), [file, '/inheritance:r', '/grant:r', `*${sid}:F`], { windowsHide: true, stdio: 'pipe' });
  writeFileSync(file, JSON.stringify(value));
}
function startPet(apiKey) {
  const petDirectory = join(data, 'dsh-pet');
  mkdirSync(petDirectory, { recursive: true });
  privateJson(join(petDirectory, 'standalone-ai.json'), { protocol: 'openai-compatible', baseUrl: `http://127.0.0.1:${bridge.port}/v1`, model: 'chatgpt-plan', apiKey, enabled: true, automaticWhispers: false, whisperIntervalSec: 300, maxTokens: 1024, timeoutMs: 60000 });
  if (!existsSync(join(petDirectory, 'main-config.jsonc'))) writeFileSync(join(petDirectory, 'main-config.jsonc'), JSON.stringify({ pets: [{ id: 'main', name: '蓝毛小女仆', size: 360, balanceEnabled: false, whisperEnabled: true, workStatusEnabled: false, fixedEnabled: false, display: 'desktop' }] }));
  const env = { ...process.env, DSH_HOME: data, DSH_PET_ELECTRON_PATH: process.execPath };
  for (const name of ['ELECTRON_RUN_AS_NODE', 'OPENAI_API_KEY', 'OPENAI_CUSTOM_HEADERS', 'OPENAI_LOG', 'NODE_OPTIONS']) delete env[name];
  pet = spawn(node, [join(root, 'node_modules', 'dsh-pet', 'lib', 'standalone.js'), '--port', '3180'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [pet.stdout, pet.stderr]) stream.on('data', bytes => log(bytes.toString()));
  pet.on('error', error => { notice = `桌宠启动失败：${error.code ?? 'unknown'}`; log(notice); });
  pet.on('exit', code => { log(`Pet exited: ${code}`); if (!quitting) notice = '桌宠已退出；重新打开启动程序可恢复。'; });
}

if (locked) app.whenReady().then(async () => {
  updates = createUpdates({ app, root, beforeInstall: () => { quitting = true; for (const request of activeRequests) request.abort(); pet?.kill(); bridge?.close(); } });
  const encryption = {
    id: 'electron-safe-storage-v1', isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: value => { if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption unavailable.'); return safeStorage.encryptString(value); },
    decrypt: value => { if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption unavailable.'); return safeStorage.decryptString(Buffer.from(value)); },
  };
  providers = createProviderStore({ directory: data, encryption });
  chatgpt = createChatGPT({ appName: 'DSH Pet ChatGPT Local', appId: 'dsh-pet-chatgpt-local', redirectPort: 0, sendHostId: true, storageDir: join(data, 'chatgpt'), credentialEncryption: encryption, openBrowser: async url => {
    if (new URL(url).origin !== 'https://auth.openai.com') throw new Error('Unexpected authorization destination.');
    await shell.openExternal(url);
  } });
  const apiKey = randomBytes(32).toString('base64url');
  bridge = await createBridge({ apiKey, getBackend: () => selectedBackend() });
  window = new BrowserWindow({ width: 720, height: 850, minWidth: 560, minHeight: 580, title: '桌宠 · 模型连接', backgroundColor: '#eff6f9', autoHideMenuBar: true, webPreferences: { preload: join(directory, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== page) event.preventDefault(); });
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
  ipcMain.handle('pet:state', event => { validate(event); return state(); });
  ipcMain.handle('pet:workbuddy-models', async event => { validate(event); await refreshWorkbuddyModels(); return state(); });
  ipcMain.handle('pet:connection', async (event, input) => {
    validate(event);
    if (busy) throw new Error('请等待当前连接操作完成。');
    providers.save(input);
    for (const request of activeRequests) request.abort();
    notice = `${PROVIDERS.find(p => p.id === providers.active()).name} 已保存并设为当前接口。`;
    return state();
  });
  ipcMain.handle('pet:workbuddy-login', async event => {
    validate(event);
    const result = await shell.openPath(writeLoginBatch({ data, root, resources }));
    if (result) throw new Error('无法打开腾讯账号登录窗口，请检查安装文件是否完整。');
    notice = '请在腾讯官方 CLI 窗口登录与 WorkBuddy 相同的腾讯账号。完成后关闭登录窗口，返回这里测试连接。';
    return state();
  });
  ipcMain.handle('pet:signin', async event => {
    validate(event); if (busy) return state(); busy = true; notice = '请在浏览器中登录 ChatGPT，并允许本应用使用订阅额度。';
    try { await chatgpt.signIn(); await refreshModels(); notice = models.length ? 'ChatGPT 已连接，可以右键桌宠开始聊天。' : '已登录，但尚未获得可用模型。请检查订阅额度授权。'; }
    catch (error) { notice = `连接未完成：${error?.message ?? '请重试'}`; }
    finally { busy = false; }
    return state();
  });
  ipcMain.handle('pet:cancel', event => { validate(event); chatgpt.cancelSignIn(); return true; });
  ipcMain.handle('pet:model', async (event, slug) => {
    validate(event); if (!models.some(m => m.slug === slug)) throw new Error('请选择账户实际可用的模型。');
    model = slug; writeFileSync(join(data, 'preferences.json'), JSON.stringify({ model })); return state();
  });
  ipcMain.handle('pet:refresh', async event => { validate(event); try { await refreshModels(); notice = ''; } catch (error) { notice = error.message; } return state(); });
  ipcMain.handle('pet:test', async event => {
    validate(event); if (busy) return state(); busy = true;
    try {
      const backend = selectedBackend();
      if (!backend.model) throw new Error('请先保存接口配置并选择模型。');
      if (backend.needsSession && !(await chatgpt.getSession()).sharing) throw new Error('请先登录 ChatGPT 并授权订阅额度。');
      const result = await backend.client.streamResponse({ model: backend.model, input: [{ role: 'user', content: '请只回复：桌宠连接成功。' }], instructions: '你是桌宠的连接测试助手，请简短回答。', signal: AbortSignal.timeout(55000), maxTokens: 128 });
      notice = result.text.trim() ? `测试成功：${result.text}` : '模型返回了空内容。';
    } catch (error) { notice = `测试未完成：${error.message}`; } finally { busy = false; }
    return state();
  });
  ipcMain.handle('pet:usage', event => { validate(event); const urls = { chatgpt: 'https://chatgpt.com/settings/usage', deepseek: 'https://platform.deepseek.com', doubao: 'https://console.volcengine.com/ark', kimi: 'https://platform.kimi.com', workbuddy: 'https://www.codebuddy.cn/console' }; return shell.openExternal(urls[providers.active()] ?? 'https://www.codebuddy.cn/docs/cli/cli-reference'); });
  ipcMain.handle('pet:update-check', async event => { validate(event); await updates.check(); return state(); });
  ipcMain.handle('pet:update-download', async event => { validate(event); await updates.download(); return state(); });
  ipcMain.handle('pet:update-install', event => { validate(event); updates.install(); });
  ipcMain.handle('pet:update-source', event => { validate(event); return shell.openExternal(updates.state().source); });
  ipcMain.handle('pet:quit', event => { validate(event); app.quit(); });
  const icon = nativeImage.createFromPath(join(root, 'node_modules', 'dsh-pet', 'assets', 'logo.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 24, height: 24 }));
  tray.setToolTip('桌宠 · 多模型独立版');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: '模型连接与设置', click: show }, { label: '退出桌宠', click: () => app.quit() }]));
  tray.on('double-click', show);
  await window.loadURL(page);
  show();
  startPet(apiKey);
  if (providers.active() === 'workbuddy') void refreshWorkbuddyModels();
  try { await refreshModels(); } catch (error) { notice = `读取连接状态失败：${error.message}`; }
  log('Launcher ready; local bridge and standalone pet started.');
}).catch(error => { log(`Startup error: ${error.message}`); dialog.showErrorBox('桌宠启动失败', error.message); app.quit(); });
app.on('before-quit', () => { quitting = true; catalogAbort.abort(); for (const request of activeRequests) request.abort(); chatgpt?.cancelSignIn(); pet?.kill(); bridge?.close(); });
app.on('window-all-closed', () => {});
