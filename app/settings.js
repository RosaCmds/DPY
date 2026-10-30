const get = id => document.getElementById(id);
let working = false, lastState, selected, hydrated, hydratedRevision, localNotice = '';
let workbuddyOptionsRevision = '';

function hydrate(s, force = false) {
  const configuration = s.connections.connections[selected];
  const revision = JSON.stringify(configuration);
  if (!force && hydrated === selected && hydratedRevision === revision) return;
  hydrated = selected; hydratedRevision = revision;
  if (configuration) {
    get('base-url').value = configuration.baseUrl ?? '';
    get('api-model').value = configuration.model ?? '';
    get('api-key').value = '';
    get('api-key').placeholder = configuration.hasKey ? '已保存；留空保留现有密钥' : '填写该服务商的 API Key';
    get('key-state').textContent = configuration.hasKey ? '已加密保存' : '尚未设置';
    get('workbuddy-model').value = configuration.model || 'fast-model';
  }
  const preset = s.connections.providers.find(p => p.id === selected);
  get('model-suggestions').replaceChildren(...(preset?.models ?? []).map(m => new Option(m, m)));
  get('api-heading').textContent = selected === 'deepseek' ? 'DeepSeek API' : selected === 'doubao' ? '豆包 · 火山方舟 API' : 'OpenAI 兼容接口';
  get('api-description').textContent = selected === 'doubao' ? '填写火山方舟 API Key，以及控制台显示的模型 ID 或 ep- 开头的推理接入点 ID。豆包 App 登录凭据不能填在这里。' : selected === 'deepseek' ? '填写 DeepSeek 开放平台 API Key；默认使用 DeepSeek Flash，也可填写账户可用的模型 ID。' : '支持提供 Chat Completions 协议的服务商和本机兼容接口。';
  get('api-model').placeholder = selected === 'doubao' ? '控制台提供的模型 ID 或 ep-…' : '该服务商的模型 ID';
}
function render(s) {
  lastState = s;
  const update = s.update ?? { version: '1.3.0', status: 'development', message: '' };
  get('version').textContent = 'v' + update.version;
  get('update-status').textContent = update.message;
  get('update-check').disabled = ['checking','downloading','development','downloaded'].includes(update.status);
  get('update-download').hidden = update.status !== 'available';
  get('update-install').hidden = update.status !== 'downloaded';
  if (!selected) {
    selected = s.connections.active;
    get('provider').replaceChildren(...s.connections.providers.map(p => new Option(p.name, p.id, false, p.id === selected)));
  }
  get('provider').disabled = s.busy || working;
  const preset = s.connections.providers.find(p => p.id === selected);
  const active = s.connections.providers.find(p => p.id === s.connections.active);
  get('active-badge').textContent = '当前使用';
  get('active-note').textContent = `当前：${active.name}${selected !== s.connections.active ? '。下方保存后才会切换。' : ''}`;
  get('chatgpt-panel').hidden = selected !== 'chatgpt';
  get('api-panel').hidden = preset.kind !== 'api';
  get('workbuddy-panel').hidden = selected !== 'workbuddy';
  hydrate(s);
  const catalog = s.workbuddyCatalog ?? { status: 'idle', models: [] };
  const revision = JSON.stringify([catalog.models, s.connections.connections.workbuddy.model]);
  if (revision !== workbuddyOptionsRevision) {
    const previous = get('workbuddy-model').value;
    const saved = s.connections.connections.workbuddy.model;
    const choices = catalog.models ?? [];
    const preferred = [previous, saved, catalog.currentModelId, choices[0]?.id].find(id => choices.some(m => m.id === id)) || saved || 'fast-model';
    const options = choices.map(m => new Option(`${m.name}${m.description ? ' · ' + m.description : ''}`, m.id));
    if (saved && !choices.some(m => m.id === saved)) options.push(new Option(`${saved}（已保存的模式）`, saved));
    if (!options.length) options.push(new Option('请先登录并刷新账号模型', ''));
    get('workbuddy-model').replaceChildren(...options);
    get('workbuddy-model').value = preferred;
    workbuddyOptionsRevision = revision;
  }
  get('workbuddy-refresh').disabled = catalog.status === 'loading' || s.busy || working;
  get('workbuddy-model').disabled = catalog.status === 'loading' || s.busy || working;
  get('workbuddy-catalog-status').textContent = catalog.status === 'loading' ? '正在读取腾讯账号模型列表…' : catalog.status === 'error' ? catalog.error + (catalog.models.length ? ' 当前保留上次读取的列表。' : '') : catalog.status === 'ready' ? `已从腾讯账号读取 ${catalog.models.length} 个模型${catalog.currentModelId ? '；账号当前模型：' + (catalog.models.find(m => m.id === catalog.currentModelId)?.name ?? catalog.currentModelId) : ''}。选择后点击下方保存。` : '从已登录的腾讯官方客户端读取，查询列表不会发起聊天。';
  get('badge').textContent = s.session.sharing ? '已连接订阅' : s.session.status === 'connecting' ? '正在登录' : '尚未连接';
  get('account').textContent = s.session.identity?.email || (s.session.sharing ? '账号已连接' : '请通过浏览器登录并允许使用订阅额度。');
  get('signin').textContent = s.session.sharing ? '重新连接 ChatGPT' : '使用 ChatGPT 登录';
  get('signin').disabled = s.busy || working;
  get('cancel').hidden = s.session.status !== 'connecting';
  if (JSON.stringify([...get('model').options].map(o => o.value)) !== JSON.stringify(s.models.map(m => m.slug))) get('model').replaceChildren(...(s.models.length ? s.models.map(m => new Option(m.displayName, m.slug)) : [new Option('登录后自动读取', '')]));
  get('model').value = s.model;
  get('model').disabled = s.busy || working || !s.models.length;
  get('refresh').disabled = s.busy || working;
  get('save').disabled = s.busy || working || (selected === 'chatgpt' && (!s.session.sharing || !s.model));
  get('workbuddy-login').disabled = s.busy || working;
  const current = s.connections.connections[s.connections.active];
  const ready = s.connections.active === 'chatgpt' ? s.session.sharing && s.model : s.connections.active === 'workbuddy' ? current?.model : current?.hasKey && current?.model;
  get('test').disabled = s.busy || working || selected !== s.connections.active || !ready;
  get('notice').textContent = localNotice || s.notice || (selected === 'chatgpt' ? s.session.error?.message : '') || '';
  get('runtime').textContent = s.petRunning ? '桌宠已独立运行。' : '桌宠正在启动或已退出。';
}
async function run(action) {
  working = true;
  localNotice = '';
  try { if (lastState) render(lastState); const s = await action(); if (s) render(s); }
  catch (error) { localNotice = error.message; get('notice').textContent = localNotice; }
  finally { working = false; try { render(await window.pet.state()); } catch {} }
}
get('provider').onchange = () => { localNotice = ''; selected = get('provider').value; hydrate(lastState, true); render(lastState); if (selected === 'workbuddy' && lastState.workbuddyCatalog?.status !== 'ready') run(() => window.pet.workbuddyModels()); };
get('save').onclick = () => {
  const input = { provider: selected };
  if (selected === 'workbuddy') input.model = get('workbuddy-model').value.trim();
  else if (selected !== 'chatgpt') {
    if (!get('api-form').reportValidity()) return;
    Object.assign(input, { baseUrl: get('base-url').value.trim(), model: get('api-model').value.trim(), apiKey: get('api-key').value.trim() });
  }
  run(async () => { const s = await window.pet.connection(input); get('api-key').value = ''; hydratedRevision = undefined; return s; });
};
get('api-form').onsubmit = e => { e.preventDefault(); get('save').click(); };
get('workbuddy-login').onclick = () => run(() => window.pet.workbuddyLogin());
get('workbuddy-refresh').onclick = () => run(() => window.pet.workbuddyModels());
get('signin').onclick = () => run(() => window.pet.signin());
get('cancel').onclick = () => window.pet.cancel();
get('refresh').onclick = () => run(() => window.pet.refresh());
get('model').onchange = () => { const model = get('model').value; run(() => window.pet.model(model)); };
get('test').onclick = () => run(() => window.pet.test());
get('usage').onclick = () => window.pet.usage();
get('update-check').onclick = () => run(() => window.pet.updateCheck());
get('update-download').onclick = () => run(() => window.pet.updateDownload());
get('update-install').onclick = () => window.pet.updateInstall();
get('update-source').onclick = () => window.pet.updateSource();
get('quit').onclick = () => window.pet.quit();
setInterval(() => window.pet.state().then(render).catch(() => {}), 2000);
window.pet.state().then(s => { render(s); if (selected === 'workbuddy' && s.workbuddyCatalog?.status === 'idle') run(() => window.pet.workbuddyModels()); }).catch(error => { get('notice').textContent = error.message; });
