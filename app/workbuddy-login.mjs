import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export function writeLoginBatch({ data, root, resources }) {
  mkdirSync(join(data, 'workbuddy-session'), { recursive: true });
  const literal = value => { if (/[\r\n"]/u.test(value)) throw new Error('安装路径无效。'); return value.replaceAll('%', '%%'); };
  const batch = join(data, '登录腾讯账号.cmd');
  const lines = ['@echo off', 'chcp 65001 >nul', 'setlocal', 'title DPY - 腾讯账号登录', 'set "ELECTRON_RUN_AS_NODE="', 'set "NODE_OPTIONS="', `set "CODEBUDDY_CONFIG_DIR=${literal(join(data, 'workbuddy-account'))}"`, 'set "DISABLE_AUTOUPDATER=1"', 'set "DISABLE_TELEMETRY=1"', 'set "DISABLE_ERROR_REPORTING=1"', `cd /d "${literal(join(data, 'workbuddy-session'))}"`, 'echo 请在官方界面选择 Chinese Site，并登录与 WorkBuddy 相同的腾讯账号。', 'echo 登录完成后关闭此窗口，回到桌宠设置刷新模型并测试。', `"${literal(join(resources, 'runtime', 'node.exe'))}" "${literal(join(resources, 'workbuddy-cli/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy'))}" --tools "" --strict-mcp-config --mcp-config "${literal(join(root, 'app/empty-mcp.json'))}" --setting-sources "" --settings "${literal(join(root, 'app/workbuddy-login-settings.json'))}" --no-session-persistence /login`, 'echo 登录程序已退出。', 'pause'];
  writeFileSync(batch, lines.join('\r\n') + '\r\n', 'utf8');
  return batch;
}
