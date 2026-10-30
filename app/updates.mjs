import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

export function parseRepository(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/u.test(value ?? '') || value.endsWith('/.') || value.endsWith('/..')) throw new Error('更新仓库配置无效。');
  const [owner, repo] = value.split('/');
  return { owner, repo };
}

export function createUpdates({ app, root, beforeInstall = () => {}, Updater }) {
  const config = JSON.parse(readFileSync(new URL('../release.json', import.meta.url), 'utf8'));
  const { owner, repo } = parseRepository(config.repository);
  const source = `https://github.com/${owner}/${repo}/releases`;
  let state = { version: app.getVersion(), status: app.isPackaged ? 'idle' : 'development', message: app.isPackaged ? '点击检查新版本。' : '源码运行模式；请在安装版中测试更新。', source };
  if (!app.isPackaged) return { state: () => ({ ...state }), check: async () => {}, download: async () => {}, install: () => {} };
  const NsisUpdater = Updater ?? createRequire(import.meta.url)('electron-updater').NsisUpdater;
  const updater = new NsisUpdater({ provider: 'github', owner, repo, releaseType: 'release' });
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.logger = null;
  updater.on('checking-for-update', () => { state = { ...state, status: 'checking', message: '正在检查 GitHub 上的新版本…' }; });
  updater.on('update-available', info => { state = { ...state, status: 'available', nextVersion: info.version, message: `发现新版本 ${info.version}。` }; });
  updater.on('update-not-available', () => { state = { ...state, status: 'current', message: '当前已经是最新版本。' }; });
  updater.on('download-progress', info => { state = { ...state, status: 'downloading', message: `正在下载 ${Math.max(0, Math.min(100, Math.round(info.percent)))}%` }; });
  updater.on('update-downloaded', () => { state = { ...state, status: 'downloaded', message: '下载并校验完成，点击“重启并安装”。' }; });
  const failed = () => { state = { ...state, status: 'error', message: '更新未完成。请检查网络及仓库是否已发布正式版本；当前桌宠可继续使用。' }; };
  updater.on('error', failed);
  let busy = false;
  async function run(action, required) {
    if (busy || (required && state.status !== required)) return;
    busy = true;
    try { await action(); } catch { failed(); } finally { busy = false; }
  }
  return {
    state: () => ({ ...state }),
    check: () => run(() => updater.checkForUpdates()),
    download: () => run(async () => { state = { ...state, status: 'downloading', message: '开始下载更新…' }; await updater.downloadUpdate(); }, 'available'),
    install: () => { if (state.status !== 'downloaded' || busy) return; beforeInstall(); updater.quitAndInstall(true, true); },
  };
}
