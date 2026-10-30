// One Electron runtime serves the launcher and upstream transparent pet helper.
const { join, resolve, dirname } = require('node:path');
const helper = join(__dirname, 'node_modules', 'dsh-pet', 'runtime', 'electron-helper', 'main.js');
const helperRequested = process.argv.slice(1).some(arg => resolve(arg).toLowerCase() === helper.toLowerCase());
if (helperRequested) {
  // Upstream loadFile('index.html') resolves against app.getAppPath().
  // Packaged Electron otherwise uses resources/app instead of the helper folder.
  require('electron').app.setAppPath(dirname(helper));
  require(helper);
}
else import('./app/main.mjs');
