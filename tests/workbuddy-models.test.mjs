import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { normalizeWorkbuddyModels, readWorkbuddyModels } from '../app/workbuddy-models.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
test('account model list retains public metadata, filters invalid/disabled entries, and never exposes private fields', () => {
  const result = normalizeWorkbuddyModels({ models: { currentModelId: 'real-model', availableModels: [
    { modelId: 'real-model', name: '模型 A', description: 'x0.11 credits', token: 'private-token', _meta: { credits: 'x0.11 credits', otherSecret: 'private-secret' } },
    { modelId: 'real-model', name: 'duplicate' },
    { modelId: 'disabled', disabled: true },
    { modelId: 'unsafe model', name: 'bad' },
    { modelId: 'another-model', name: '模型 B' },
  ] } });
  assert.equal(result.models.length, 2);
  assert.equal(result.currentModelId, 'real-model');
  assert.deepEqual(Object.keys(result.models[0]), ['id', 'name', 'description']);
  assert.doesNotMatch(JSON.stringify(result), /private-token|private-secret/);
  const fallback = normalizeWorkbuddyModels({ configOptions: [{ type: 'select', id: 'model', currentValue: 'live-model', options: [{ value: 'live-model', name: 'Live Model' }] }] });
  assert.equal(fallback.models[0].id, 'live-model');
  assert.throws(() => normalizeWorkbuddyModels({ models: { availableModels: [] } }), /没有返回可用模型/);
});

function mockSpawn(result, requests, authentication = false) {
  return (executable, args, options) => {
    assert.equal(args[1], '--acp'); assert.ok(args.includes('--no-session-persistence')); assert.equal(options.windowsHide, true);
    const child = new EventEmitter();
    Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() { setImmediate(() => child.emit('close', 0)); } });
    child.stdin.on('data', bytes => {
      const request = JSON.parse(bytes.toString()); requests.push(request.method);
      setImmediate(() => {
        const response = request.method === 'initialize' ? { result: { protocolVersion: 1 } } : authentication ? { error: { code: -32000, message: 'Authentication required: private-token' } } : { result };
        child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...response }) + '\n');
      });
    });
    return child;
  };
}
test('catalog discovery uses initialize/session-new only, without sending an inference prompt', async () => {
  const requests = [];
  const result = await readWorkbuddyModels({ root, executable: 'node', cliPath: 'official-cli', spawnProcess: mockSpawn({ models: { currentModelId: 'account-model', availableModels: [{ modelId: 'account-model', name: 'Account Model' }] } }, requests) });
  assert.deepEqual(requests, ['initialize', 'session/new']);
  assert.equal(result.models[0].id, 'account-model');
});
test('missing login gives a useful sanitized error, never a fabricated model list', async () => {
  await assert.rejects(() => readWorkbuddyModels({ root, executable: 'node', cliPath: 'official-cli', spawnProcess: mockSpawn({}, [], true) }), error => /登录状态/.test(error.message) && !error.message.includes('private-token'));
});
