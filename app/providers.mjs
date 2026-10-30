import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { replaceFileSync } from './atomic-file.mjs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const PROVIDERS = Object.freeze([
  { id: 'chatgpt', name: 'ChatGPT · 账号订阅', kind: 'account' },
  { id: 'deepseek', name: 'DeepSeek · API Key', kind: 'api', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', models: ['deepseek-flash', 'deepseek-v4-pro'] },
  { id: 'doubao', name: '豆包 · 火山方舟 API Key', kind: 'api', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '', models: [] },
  { id: 'workbuddy', name: 'WorkBuddy / CodeBuddy · 腾讯账号', kind: 'cli', model: 'fast-model', models: [] },
  { id: 'custom', name: '其他 OpenAI 兼容接口', kind: 'api', baseUrl: '', model: '', models: [] },
]);

export function endpointUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/u.test(value)) throw new Error('接口地址格式不正确。');
  let url;
  try { url = new URL(value); } catch { throw new Error('请填写完整的接口地址。'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) throw new Error('接口需要 HTTPS；本机接口可使用 HTTP。地址中不能包含凭据或查询参数。');
  const path = url.pathname.replace(/\/+$/u, '');
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`;
  return url.href;
}

function cleanText(value, max) { return typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value); }

export function createProviderStore({ directory, encryption }) {
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'model-connections.encrypted.json');
  let saved = { version: 1, active: 'chatgpt', connections: {} };
  if (existsSync(file)) {
    try {
      if (!encryption.isAvailable()) throw new Error();
      const envelope = JSON.parse(readFileSync(file, 'utf8'));
      if (envelope.version !== 1 || typeof envelope.ciphertext !== 'string') throw new Error();
      const loaded = JSON.parse(encryption.decrypt(Buffer.from(envelope.ciphertext, 'base64')));
      if (loaded.version !== 1 || !PROVIDERS.some(p => p.id === loaded.active) || !loaded.connections || typeof loaded.connections !== 'object') throw new Error();
      for (const [id, record] of Object.entries(loaded.connections)) {
        const preset = PROVIDERS.find(p => p.id === id);
        if (!preset || preset.kind === 'account' || !record || !cleanText(record.model, 200)) throw new Error();
        if (preset.kind === 'api') {
          if (!cleanText(record.apiKey, 8192) || /\s/u.test(record.apiKey) || !cleanText(record.baseUrl, 2048)) throw new Error();
          if (record.baseUrl) endpointUrl(record.baseUrl);
        }
      }
      saved = loaded;
    } catch { throw new Error('无法解密模型连接设置。请使用保存它的 Windows 账号打开，原文件已保留。'); }
  }
  function persist(next) {
    if (!encryption.isAvailable()) throw new Error('Windows 凭据加密当前不可用，尚未保存密钥。');
    const encrypted = encryption.encrypt(JSON.stringify(next));
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, ciphertext: Buffer.from(encrypted).toString('base64') }), { mode: 0o600, flag: 'wx' });
    try { replaceFileSync(temporary, file); }
    catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
    saved = next;
  }
  function connection(id) {
    const preset = PROVIDERS.find(p => p.id === id);
    if (!preset) throw new Error('未知服务商。');
    return { provider: id, baseUrl: preset.baseUrl ?? '', model: preset.model ?? '', apiKey: '', ...saved.connections[id] };
  }
  return {
    active: () => saved.active,
    connection,
    publicState() {
      return { active: saved.active, providers: PROVIDERS, connections: Object.fromEntries(PROVIDERS.filter(p => p.kind !== 'account').map(p => {
        const { apiKey, ...fields } = connection(p.id); return [p.id, { ...fields, hasKey: Boolean(apiKey) }];
      })) };
    },
    save(input) {
      if (!input || typeof input !== 'object' || !PROVIDERS.some(p => p.id === input.provider)) throw new Error('请选择服务商。');
      const preset = PROVIDERS.find(p => p.id === input.provider);
      const next = structuredClone(saved);
      if (preset.kind !== 'account') {
        const previous = connection(preset.id);
        const record = { model: input.model ?? previous.model };
        if (!cleanText(record.model, 200) || !record.model.trim()) throw new Error('请填写模型 ID。');
        record.model = record.model.trim();
        if (preset.kind === 'api') {
          record.baseUrl = input.baseUrl ?? previous.baseUrl;
          endpointUrl(record.baseUrl);
          record.apiKey = input.clearApiKey ? '' : input.apiKey || previous.apiKey;
          if (!cleanText(record.apiKey, 8192) || /\s/u.test(record.apiKey)) throw new Error('API Key 格式不正确。');
          // A saved preset key is only valid for its saved endpoint. Changing the
          // endpoint requires explicit key entry so an old key cannot leak.
          if (previous.apiKey && endpointUrl(previous.baseUrl) !== endpointUrl(record.baseUrl) && !input.apiKey && !input.clearApiKey) throw new Error('接口地址已改变，请重新填写该接口对应的 API Key。');
          if (input.activate !== false && !record.apiKey) throw new Error('请先填写 API Key，再启用这个接口。');
        }
        next.connections[preset.id] = record;
      }
      if (input.activate !== false) next.active = preset.id;
      persist(next);
      return this.publicState();
    },
  };
}
