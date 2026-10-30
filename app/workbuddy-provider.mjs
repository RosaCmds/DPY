import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

// Pinned official CLI 2.178.1: additionally deny its whole builtin catalog.
// The CLI init event reports its registered catalog even with tools disabled.
const DENIED_TOOLS = 'Agent,Read,Write,Edit,Bash,PowerShell,Glob,Grep,EnterPlanMode,ExitPlanMode,TaskCreate,TaskGet,TaskUpdate,TaskList,WebFetch,WebSearch,TaskStop,TaskOutput,Skill,SkillManage,Component,Mods,AskUserQuestion,AskUserForStructuredInput,StructuredOutput,ToolSearch,DeferExecuteTool,SendMessage,SendUserMessage,TeamCreate,TeamDelete,NotebookEdit,LSP,ImageGen,LibraryUpload,ImageEdit,ViewImage,VideoGen,AudioTranscribe,EnterWorktree,LeaveWorktree,CronCreate,CronDelete,CronList,WeChatReply,WeComReply,PushNotification,ReportFindings,ComputerUse,ListMcpResources,ReadMcpResource,WaitForMcpServers,Workflow,Monitor,REPL,A2AGetAgentCard,A2ASendMessage,A2AGetTask,A2ACancelTask,MessageColleague,SpeakInChannel,ChannelTasks,CreateColleague,CreateChannel,ListColleagues';

export function workbuddyArguments(model, instructions) {
  return ['--print', '--output-format', 'stream-json', '--include-partial-messages', '--verbose', '--tools', '', '--disallowedTools', DENIED_TOOLS, '--permission-mode', 'dontAsk', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '', '--settings', '{"disableAllHooks":true}', '--no-session-persistence', '--max-turns', '1', '--model', model, '--system-prompt', instructions];
}
export function workbuddyEnvironment(root, nodeMode = true, dataDir = join(root, 'data')) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(?:OPENAI_|ANTHROPIC_|CODEBUDDY_|WORKBUDDY_|OTEL_|NODE_OPTIONS$)/u.test(name)) delete env[name];
  Object.assign(env, { CODEBUDDY_CONFIG_DIR: join(dataDir, 'workbuddy-account'), CODEBUDDY_DISABLE_BACKGROUND_TASKS: '1', CODEBUDDY_MAX_RETRIES: '0', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', DISABLE_AUTOUPDATER: '1' });
  if (nodeMode) env.ELECTRON_RUN_AS_NODE = '1'; else delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
export function createWorkbuddyProvider({ executable, cliPath, root, dataDir = join(root, 'data'), nodeMode = true, getModel, spawnProcess = spawn }) {
  const cwd = join(dataDir, 'workbuddy-session');
  mkdirSync(cwd, { recursive: true });
  return {
    streamResponse({ input, instructions, signal, onDelta }) {
      return new Promise((resolve, reject) => {
        signal?.throwIfAborted();
        const child = spawnProcess(executable, [cliPath, ...workbuddyArguments(getModel(), instructions ?? '')], { cwd, env: workbuddyEnvironment(root, nodeMode, dataDir), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
        let text = '', streamed = false, final, protocolError, total = 0;
        const abort = () => child.kill();
        signal?.addEventListener('abort', abort, { once: true });
        child.stderr.resume(); // The CLI owns its login details; never log or expose stderr.
        const add = delta => { text += delta; if (text.length > 16384) { protocolError = 'output_too_large'; child.kill(); } else onDelta?.(delta); };
        reader.on('line', line => {
          total += line.length;
          if (total > 2 * 1024 * 1024) { protocolError = 'response_too_large'; child.kill(); return; }
          let event; try { event = JSON.parse(line); } catch { return; }
          if (event.type === 'system' && event.subtype === 'init' && Array.isArray(event.mcp_servers) && event.mcp_servers.length) { protocolError = 'unexpected_mcp_server'; child.kill(); return; }
          const delta = event.type === 'stream_event' ? event.event?.delta : undefined;
          if (delta?.type === 'text_delta' && typeof delta.text === 'string') { streamed = true; add(delta.text); }
          if (event.type === 'assistant' && !streamed && Array.isArray(event.message?.content)) {
            const content = event.message.content.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('');
            if (content && !text) add(content);
          }
          if (event.type === 'result') final = event;
        });
        child.on('error', () => { signal?.removeEventListener('abort', abort); reject(Object.assign(new Error('腾讯官方 CLI 无法启动，请重新打开桌宠。'), { code: 'cli_start_failed' })); });
        child.on('close', code => {
          signal?.removeEventListener('abort', abort); reader.close();
          if (signal?.aborted) return reject(Object.assign(new Error('WorkBuddy 请求已取消。'), { code: 'cancelled' }));
          if (protocolError || code !== 0 || !final || final.is_error || (final.subtype && final.subtype !== 'success')) return reject(Object.assign(new Error(`WorkBuddy 请求未完成（${protocolError ?? 'account_or_request_error'}）。请用同一个腾讯账号登录官方 CLI，并检查账号权限、可用额度和模型。`), { code: protocolError ?? 'workbuddy_request_failed' }));
          if (!text && typeof final.result === 'string') add(final.result);
          if (!text.trim()) return reject(Object.assign(new Error('WorkBuddy 没有返回文本。'), { code: 'empty_response' }));
          resolve({ text });
        });
        child.stdin.end(JSON.stringify({ conversation: input }));
      });
    },
  };
}
