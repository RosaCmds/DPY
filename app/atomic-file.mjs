import { renameSync } from 'node:fs';

// Windows scanners can briefly hold a file after it is read. Never delete the
// previous settings to work around a sharing violation: retry the atomic rename.
export function replaceFileSync(from, to, { rename = renameSync, platform = process.platform, pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { rename(from, to); return; }
    catch (error) {
      if (platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 9) throw error;
      pause(Math.min(100, 10 * 2 ** attempt));
    }
  }
}
