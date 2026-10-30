import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceFileSync } from '../app/atomic-file.mjs';
test('temporary Windows sharing violations preserve atomic replacement', () => {
  let attempts = 0, replaced = false;
  const waits = [];
  replaceFileSync('new-encrypted-settings', 'previous-encrypted-settings', { platform: 'win32', pause: ms => waits.push(ms), rename(from, to) {
    assert.equal(from, 'new-encrypted-settings'); assert.equal(to, 'previous-encrypted-settings');
    if (++attempts < 4) throw Object.assign(new Error('scanner lock'), { code: 'EPERM' });
    replaced = true;
  } });
  assert.equal(replaced, true); assert.equal(attempts, 4); assert.ok(waits.length > 0);
});
test('permanent write failures stop instead of losing previous settings', () => {
  let attempts = 0;
  assert.throws(() => replaceFileSync('new', 'old', { platform: 'win32', pause() {}, rename() { attempts++; throw Object.assign(new Error('denied'), { code: 'EPERM' }); } }), /denied/);
  assert.ok(attempts <= 10);
  assert.throws(() => replaceFileSync('new', 'old', { platform: 'win32', pause() { assert.fail('must not retry disk-full'); }, rename() { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } }), /disk full/);
});
