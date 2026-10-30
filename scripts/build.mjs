import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'electron-builder';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = join(root, 'vendor');
mkdirSync(join(vendor, 'runtime'), { recursive: true });
// Build on Windows x64 with official Node 24.14.0 (CI pins this version).
if (process.platform !== 'win32' || process.arch !== 'x64' || process.version !== 'v24.14.0') throw new Error('请使用 Windows x64 和 Node.js 24.14.0 构建。');
cpSync(process.execPath, join(vendor, 'runtime', 'node.exe'));
const nodeLicense = join(vendor, 'runtime', 'LICENSE_NODE.txt');
if (!existsSync(nodeLicense)) {
  const response = await fetch('https://raw.githubusercontent.com/nodejs/node/v24.14.0/LICENSE');
  if (!response.ok) throw new Error('Node license download failed');
  writeFileSync(nodeLicense, await response.text());
}
const cli = join(vendor, 'workbuddy-cli');
mkdirSync(cli, { recursive: true });
cpSync(join(root, 'workbuddy-package.json'), join(cli, 'package.json'));
cpSync(join(root, 'workbuddy-package-lock.json'), join(cli, 'package-lock.json'));
if (!existsSync(join(cli, 'node_modules/@tencent-ai/codebuddy-code/bin/codebuddy'))) {
  execFileSync('npm.cmd', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: cli, stdio: 'inherit', shell: true });
}
const helper = join(root, 'node_modules/dsh-pet/runtime/electron-helper/main.js');
let source = readFileSync(helper, 'utf8');
const anchor = "app.setName('dsh-pet-electron-helper');";
const patch = "\n// DPY customization: isolate helper profile in the application data directory.\nif (process.env.DSH_HOME) app.setPath('userData', path.join(process.env.DSH_HOME, 'helper-desktop'));";
if (!source.includes("path.join(process.env.DSH_HOME, 'helper-desktop')")) {
  if (!source.includes(anchor)) throw new Error('桌宠上游代码已变化，请检查 helper 补丁。');
  writeFileSync(helper, source.replace(anchor, anchor + patch));
}
const repository = process.env.GITHUB_REPOSITORY || 'RosaCmds/DPY';
if (repository !== 'RosaCmds/DPY') throw new Error('发布仓库不匹配，请先审核更新地址。');
writeFileSync(join(root, 'release.json'), JSON.stringify({ repository }));
await build({ projectDir: root, publish: 'never', config: {
  appId: 'io.github.rosacmds.dpy', productName: 'DPY Desktop Pet', executableName: 'DPY-Pet',
  electronVersion: '43.3.0', ...(process.env.DPY_ELECTRON_DIST ? { electronDist: resolve(process.env.DPY_ELECTRON_DIST) } : {}),
  asar: false, npmRebuild: false, compression: 'normal',
  directories: { output: 'dist' },
  files: ['bootstrap.cjs', 'app/**/*', 'release.json', 'THIRD-PARTY-NOTICES.txt', 'licenses/**/*', 'package.json'],
  extraResources: [ { from: 'vendor/runtime', to: 'runtime' } ],
  afterPack: async context => {
    // electron-builder excludes nested node_modules from extraResources globs.
    // Copy the pinned CLI tree explicitly after its file filtering has finished.
    cpSync(cli, join(context.appOutDir, 'resources', 'workbuddy-cli'), { recursive: true });
    for (const file of [
      join(context.appOutDir, 'resources/app/node_modules/dsh-pet/assets/webm/待机呼吸休闲.webm'),
      join(context.appOutDir, 'resources/workbuddy-cli/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy'),
      join(context.appOutDir, 'resources/runtime/node.exe'),
    ]) if (!existsSync(file) || statSync(file).size < 100) throw new Error('安装资源缺失：' + file);
  },
  win: { target: [{ target: 'nsis', arch: ['x64'] }], artifactName: 'DPY-Pet-Setup-${version}-${arch}.${ext}' },
  nsis: { preCompressedFileExtensions: [], oneClick: false, perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: 'DPY 桌宠', deleteAppDataOnUninstall: false, installerLanguages: ['zh_CN', 'en_US'], language: '2052', include: 'scripts/installer.nsh' },
  publish: { provider: 'github', owner: 'RosaCmds', repo: 'DPY', releaseType: 'release' }
} });
