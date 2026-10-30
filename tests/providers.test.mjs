import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createProviderStore, endpointUrl } from '../app/providers.mjs';
import { createApiProvider } from '../app/api-provider.mjs';
import { createWorkbuddyProvider, workbuddyArguments } from '../app/workbuddy-provider.mjs';
import { createBridge } from '../app/bridge.mjs';

const scratch = tmpdir();
function encryption() {
  const key = randomBytes(32);
  return { isAvailable: () => true, encrypt(text) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    const content = Buffer.concat([cipher.update(text), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), content]);
  }, decrypt(data) {
    const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString();
  } };
}
test('separate encrypted provider keys survive switching without appearing in public state', () => {
  const directory = mkdtempSync(join(scratch, 'provider-test-'));
  const cipher = encryption();
  const store = createProviderStore({ directory, encryption: cipher });
  assert.equal(store.active(), 'chatgpt');
  store.save({ provider: 'deepseek', apiKey: 'fake-deepseek-secret', model: 'deepseek-flash' });
  store.save({ provider: 'doubao', apiKey: 'fake-doubao-secret', model: 'ep-test' });
  store.save({ provider: 'deepseek', apiKey: '', model: 'deepseek-v4-pro' });
  assert.equal(store.connection('deepseek').apiKey, 'fake-deepseek-secret');
  assert.equal(store.connection('doubao').apiKey, 'fake-doubao-secret');
  assert.doesNotMatch(JSON.stringify(store.publicState()), /fake-deepseek-secret|fake-doubao-secret/);
  assert.doesNotMatch(readFileSync(join(directory, 'model-connections.encrypted.json'), 'utf8'), /fake-deepseek-secret|fake-doubao-secret/);
  const reloaded = createProviderStore({ directory, encryption: cipher });
  assert.equal(reloaded.active(), 'deepseek');
  assert.equal(reloaded.connection('doubao').model, 'ep-test');
  assert.throws(() => store.save({ provider: 'deepseek', baseUrl: 'https://different.example/v1' }), /重新填写/);
  assert.equal(store.active(), 'deepseek');
  store.save({ provider: 'workbuddy', model: 'fast-model' });
  assert.equal(store.active(), 'workbuddy');
  store.save({ provider: 'chatgpt' });
  assert.equal(store.active(), 'chatgpt');
});
test('unsafe URLs and corrupt encrypted storage fail closed', () => {
  for (const url of ['http://example.com/v1', 'https://name:password@example.com/v1', 'https://example.com?key=secret', 'file:///C:/data']) assert.throws(() => endpointUrl(url));
  assert.equal(endpointUrl('https://api.deepseek.com'), 'https://api.deepseek.com/chat/completions');
  assert.equal(endpointUrl('https://ark.cn-beijing.volces.com/api/v3/chat/completions'), 'https://ark.cn-beijing.volces.com/api/v3/chat/completions');
  assert.equal(endpointUrl('http://127.0.0.1:1234/v1'), 'http://127.0.0.1:1234/v1/chat/completions');
  const directory = mkdtempSync(join(scratch, 'provider-corrupt-'));
  writeFileSync(join(directory, 'model-connections.encrypted.json'), '{"version":1,"ciphertext":"broken"}');
  assert.throws(() => createProviderStore({ directory, encryption: encryption() }), /无法解密/);
});
function sse(events) { return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }); }
test('DeepSeek and Doubao streaming use only the selected endpoint/key and ignore reasoning', async () => {
  for (const [provider, baseUrl] of [['deepseek', 'https://api.deepseek.com'], ['doubao', 'https://ark.cn-beijing.volces.com/api/v3']]) {
    const service = createApiProvider({ getConnection: () => ({ provider, baseUrl, model: 'test-model', apiKey: `fake-${provider}-key` }), fetcher: async (url, init) => {
      assert.equal(url, endpointUrl(baseUrl)); assert.equal(init.redirect, 'error');
      assert.equal(init.headers.authorization, `Bearer fake-${provider}-key`);
      const body = JSON.parse(init.body); assert.equal(body.model, 'test-model'); assert.equal(body.thinking.type, 'disabled');
      assert.equal(body.max_tokens, 128);
      return sse([{ choices: [{ index: 0, delta: { reasoning_content: 'secret reasoning' } }] }, { choices: [{ index: 0, delta: { content: '连接' } }] }, { choices: [{ index: 0, delta: { content: '成功' }, finish_reason: 'stop' }] }]);
    } });
    let received = '';
    const result = await service.streamResponse({ instructions: 'test', input: [{ role: 'user', content: '你好' }], signal: AbortSignal.timeout(2000), maxTokens: 128, onDelta: d => { received += d; } });
    assert.equal(result.text, '连接成功'); assert.equal(received, result.text);
  }
});
test('incomplete API streams and upstream errors never report success or expose diagnostics', async () => {
  const config = () => ({ provider: 'custom', baseUrl: 'https://example.com/v1', model: 'm', apiKey: 'fake-secret' });
  const input = { input: [{ role: 'user', content: 'test' }], signal: AbortSignal.timeout(2000) };
  const incomplete = createApiProvider({ getConnection: config, fetcher: async () => sse([{ choices: [{ index: 0, delta: { content: 'partial' } }] }]) });
  await assert.rejects(() => incomplete.streamResponse(input), /incomplete_response/);
  const bad = createApiProvider({ getConnection: config, fetcher: async () => new Response(JSON.stringify({ error: { message: 'private fake-secret diagnostic' } }), { status: 401, headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(() => bad.streamResponse(input), error => error.code === 'http_401' && !error.message.includes('fake-secret'));
});
test('bridge switches provider per request without falling back to ChatGPT', async () => {
  let selected = 'deepseek'; const calls = [];
  const bridge = await createBridge({ apiKey: 'test-local', getBackend: () => ({ model: selected, client: { async streamResponse(o) { calls.push(o.model); o.onDelta(o.model); return { text: o.model }; } } }) });
  try {
    const url = `http://127.0.0.1:${bridge.port}/v1/chat/completions`;
    const options = { method: 'POST', headers: { authorization: 'Bearer test-local' }, body: JSON.stringify({ model: 'chatgpt-plan', stream: true, messages: [{ role: 'user', content: 'test' }] }) };
    await (await fetch(url, options)).text(); selected = 'doubao'; await (await fetch(url, options)).text();
    assert.deepEqual(calls, ['deepseek', 'doubao']);
  } finally { await bridge.close(); }
});
test('WorkBuddy adapter disables tools/MCP and does not duplicate streamed text', async () => {
  const args = workbuddyArguments('fast-model', 'system');
  assert.equal(args[args.indexOf('--tools') + 1], ''); assert.ok(args.includes('--strict-mcp-config')); assert.ok(args.includes('--no-session-persistence'));
  let prompt = '';
  const service = createWorkbuddyProvider({ executable: 'node', cliPath: 'official-cli', root: fileURLToPath(new URL('../', import.meta.url)), getModel: () => 'fast-model', spawnProcess: (exe, cliArgs, options) => {
    assert.equal(exe, 'node'); assert.equal(options.windowsHide, true);
    const child = new EventEmitter(); Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill() {} });
    child.stdin.on('data', b => { prompt += b; });
    setImmediate(() => {
      for (const event of [{ type: 'system', subtype: 'init', tools: [] }, { type: 'stream_event', event: { delta: { type: 'text_delta', text: '你好' } } }, { type: 'assistant', message: { content: [{ type: 'text', text: '你好' }] } }, { type: 'result', subtype: 'success', result: '你好', is_error: false }]) child.stdout.write(JSON.stringify(event) + '\n');
      child.stdout.end(); setImmediate(() => child.emit('close', 0));
    });
    return child;
  } });
  let output = '';
  const result = await service.streamResponse({ input: [{ role: 'user', content: 'test' }], instructions: 'system', signal: AbortSignal.timeout(2000), onDelta: d => { output += d; } });
  assert.equal(result.text, '你好'); assert.equal(output, '你好'); assert.match(prompt, /test/);
});
