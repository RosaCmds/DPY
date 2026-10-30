import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from '../app/bridge.mjs';

test('local bridge: auth, origins, login gate, stream, and failure propagation', async () => {
  let sharing = false, fail = false, calls = 0;
  const client = { getSession: async () => ({ sharing }), streamResponse: async options => {
    calls++; assert.equal(options.model, 'account-model');
    assert.deepEqual(options.input, [{ role: 'user', content: '你好' }]);
    if (fail) throw Object.assign(new Error('private diagnostic'), { code: 'test_failure' });
    options.onDelta('你好'); options.onDelta('呀'); return { text: '你好呀' };
  } };
  const bridge = await createBridge({ chatgpt: client, apiKey: 'local-secret', getModel: () => 'account-model' });
  const url = `http://127.0.0.1:${bridge.port}/v1/chat/completions`;
  const body = JSON.stringify({ model: 'chatgpt-plan', stream: true, messages: [{ role: 'system', content: '你是桌宠' }, { role: 'user', content: '你好' }] });
  const request = (headers = {}, data = body) => fetch(url, { method: 'POST', headers: { authorization: 'Bearer local-secret', ...headers }, body: data });
  try {
    assert.equal((await request({ authorization: 'wrong' })).status, 401);
    assert.equal((await request({ origin: 'https://example.com' })).status, 403);
    assert.equal((await request()).status, 503);
    assert.equal(calls, 0);
    sharing = true;
    let response = await request(); assert.equal(response.status, 200);
    const stream = await response.text();
    assert.match(stream, /你好/); assert.match(stream, /呀/); assert.match(stream, /\[DONE\]/);
    assert.equal(calls, 1);
    assert.equal((await request({}, '{invalid')).status, 502);
    fail = true; response = await request(); assert.equal(response.status, 502);
    const error = await response.text(); assert.match(error, /test_failure/); assert.doesNotMatch(error, /private diagnostic/);
  } finally { await bridge.close(); }
});

test('unauthorized or malformed requests cannot release another request slot', async () => {
  let finish;
  const blocked = new Promise(resolve => { finish = resolve; });
  const bridge = await createBridge({ apiKey: 'secret', getModel: () => 'model', chatgpt: { getSession: async () => ({ sharing: true }), streamResponse: async () => { await blocked; return { text: '' }; } } });
  const url = `http://127.0.0.1:${bridge.port}/v1/chat/completions`;
  const options = { method: 'POST', headers: { authorization: 'Bearer secret' }, body: JSON.stringify({ model: 'chatgpt-plan', stream: true, messages: [{ role: 'user', content: 'test' }] }) };
  try {
    const first = fetch(url, options);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal((await fetch(url, options)).status, 429);
    assert.equal((await fetch(url, options)).status, 429);
    finish(); assert.equal((await first).status, 200);
  } finally { finish(); await bridge.close(); }
});
