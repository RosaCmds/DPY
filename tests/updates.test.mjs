import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUpdates, parseRepository } from '../app/updates.mjs';
import { writeLoginBatch } from '../app/workbuddy-login.mjs';
import { workbuddyEnvironment } from '../app/workbuddy-provider.mjs';

test('updates only use the configured GitHub release source and explicit install', async () => {
  let instance, installed = 0, stopped = 0;
  class Fake extends EventEmitter {
    constructor(options) { super(); instance = this; assert.deepEqual(options, { provider: 'github', owner: 'RosaCmds', repo: 'DPY', releaseType: 'release' }); }
    async checkForUpdates() { this.emit('checking-for-update'); this.emit('update-available', { version: '1.4.0' }); }
    async downloadUpdate() { this.emit('download-progress', { percent: 50 }); this.emit('update-downloaded'); }
    quitAndInstall(...args) { assert.deepEqual(args, [true, true]); installed++; }
  }
  const service = createUpdates({ app: { isPackaged: true, getVersion: () => '1.3.0' }, Updater: Fake, beforeInstall: () => stopped++ });
  service.install(); assert.equal(installed, 0);
  assert.equal(instance.autoDownload, false); assert.equal(instance.autoInstallOnAppQuit, false); assert.equal(instance.allowDowngrade, false);
  await service.check(); assert.equal(service.state().status, 'available');
  await service.download(); assert.equal(service.state().status, 'downloaded');
  service.install(); assert.equal(installed, 1); assert.equal(stopped, 1);
  instance.emit('error', new Error('secret diagnostics')); assert.equal(service.state().status, 'error'); assert.ok(!service.state().message.includes('secret'));
});
test('bad update repository cannot select an arbitrary host', () => {
  for (const input of ['https://evil.test', '../repo', 'owner/repo/path', 'owner/..', 'owner/repo?token=secret']) assert.throws(() => parseRepository(input));
});
test('login and query store data outside the installation directory', () => {
  const data = mkdtempSync(join(tmpdir(), 'DPY-user-data-'));
  const batch = writeLoginBatch({ data, root: 'C:\\Program Files\\DPY', resources: 'C:\\Program Files\\DPY\\resources' });
  const content = readFileSync(batch, 'utf8');
  assert.ok(content.includes(join(data, 'workbuddy-account')));
  assert.ok(content.includes('runtime\\node.exe'));
  const env = workbuddyEnvironment('C:\\Program Files\\DPY', false, data);
  assert.equal(env.CODEBUDDY_CONFIG_DIR, join(data, 'workbuddy-account'));
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
});
