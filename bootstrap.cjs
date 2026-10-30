// One Electron runtime serves the launcher and upstream transparent pet helper.
const { join, resolve } = require('node:path');
const helper = join(__dirname, 'node_modules', 'dsh-pet', 'runtime', 'electron-helper', 'main.js');
const helperRequested = process.argv.slice(1).some(arg => resolve(arg).toLowerCase() === helper.toLowerCase());
if (helperRequested) require(helper);
else import('./app/main.mjs');
