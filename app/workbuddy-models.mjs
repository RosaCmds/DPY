import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { workbuddyEnvironment } from './workbuddy-provider.mjs';

function safeText(value, max) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, max) : ''; }

/** Keep only public model metadata from the official ACP response. */
export function normalizeWorkbuddyModels(result) {
  const modelOptions = result?.configOptions?.find(option => option.id === 'model' && option.type === 'select');
  const raw = Array.isArray(result?.models?.availableModels) ? result.models.availableModels : modelOptions?.options;
  if (!Array.isArray(raw)) throw new Error('腾讯客户端没有返回账号模型列表。');
  const seen = new Set();
  const models = raw.flatMap(item => {
    if (!item || item.disabled || item._meta?.disabled || typeof (item.modelId ?? item.value) !== 'string') return [];
    const id = item.modelId ?? item.value;
    if (!id || id.length > 200 || /[\s\u0000-\u001f\u007f]/u.test(id) || seen.has(id)) return [];
    seen.add(id);
    return [{ id, name: safeText(item.name, 240) || id, description: safeText(item.description ?? item._meta?.credits, 160) }];
  }).slice(0, 500);
  if (!models.length) throw new Error('腾讯账号目前没有返回可用模型，请检查登录状态和账号权限。');
  const currentModelId = safeText(result?.models?.currentModelId ?? modelOptions?.currentValue, 200);
  return { models, currentModelId: models.some(model => model.id === currentModelId) ? currentModelId : '', updatedAt: new Date().toISOString() };
}

/** Read account metadata only: initialize + session/new, never session/prompt. */
export function readWorkbuddyModels({ executable, cliPath, root, dataDir = join(root, 'data'), signal, spawnProcess = spawn }) {
  const cwd = join(dataDir, 'workbuddy-session');
  mkdirSync(cwd, { recursive: true });
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('模型列表读取已取消。'));
    const child = spawnProcess(executable, [cliPath, '--acp', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '', '--settings', '{"disableAllHooks":true}', '--no-session-persistence'], { cwd, env: workbuddyEnvironment(root, false, dataDir), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let settled = false, total = 0;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reader.close(); child.kill(); };
    const finish = (error, value) => { if (settled) return; settled = true; cleanup(); error ? reject(error) : resolve(value); };
    const abort = () => finish(new Error('模型列表读取已取消。'));
    const timer = setTimeout(() => finish(new Error('读取腾讯账号模型列表超时，请检查网络后重试。')), 25000);
    signal?.addEventListener('abort', abort, { once: true });
    child.stderr.resume();
    child.stdin.on('error', () => finish(new Error('腾讯模型查询通道已关闭，请重试。')));
    const send = (id, method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    reader.on('line', line => {
      total += line.length;
      if (total > 2 * 1024 * 1024) return finish(new Error('腾讯模型列表响应过大。'));
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (![1, 2].includes(event?.id)) return;
      if (event.error) {
        const authentication = /auth|login|登录/iu.test(String(event.error.message ?? ''));
        return finish(new Error(authentication ? '尚未读取到腾讯登录状态。请先完成官方登录，再点击“刷新账号模型”。' : '腾讯客户端未能读取账号模型列表，请检查网络或稍后重试。'));
      }
      if (event.id === 1) {
        if (event.result?.protocolVersion !== 1) return finish(new Error('腾讯客户端协议版本不兼容。'));
        send(2, 'session/new', { cwd, mcpServers: [] });
      } else {
        try { finish(null, normalizeWorkbuddyModels(event.result)); } catch (error) { finish(error); }
      }
    });
    child.on('error', () => finish(new Error('腾讯官方 CLI 无法启动，请检查桌宠文件是否完整。')));
    child.on('close', () => { if (!settled) finish(new Error('腾讯模型查询已结束，未返回列表。请先完成登录。')); });
    send(1, 'initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'desktop-pet-model-list', version: '1.0.0' } });
  });
}
