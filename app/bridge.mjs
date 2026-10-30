import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';

export async function createBridge({ chatgpt, apiKey, getModel, getBackend }) {
  let active = false;
  const requests = new Set();
  const server = createServer(async (req, res) => {
    const reject = (status, message) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: { message, type: 'local_bridge_error' } }));
    };
    const expectedHost = `127.0.0.1:${server.address().port}`;
    if (req.headers.host !== expectedHost || req.headers.origin || req.headers['sec-fetch-site'] === 'cross-site') return reject(403, 'Local application access only.');
    const supplied = req.headers.authorization ?? '';
    const expected = `Bearer ${apiKey}`;
    if (Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return reject(401, 'Invalid local credential.');
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return reject(404, 'Unknown endpoint.');
    if (active) return reject(429, '桌宠正在回复，请稍候。');
    const controller = new AbortController();
    requests.add(controller);
    res.on('close', () => { if (!res.writableFinished) controller.abort(); });
    let wrote = false;
    let claimed = false;
    try {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 196608) return reject(413, 'Message too large.');
      }
      const body = JSON.parse(raw);
      if (!body || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 65 || !['chatgpt-plan', 'desktop-pet'].includes(body.model) || body.stream !== true) return reject(400, 'Invalid request.');
      if (body.messages.some(m => !m || !['system', 'developer', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string') || body.messages.reduce((n, m) => n + m.content.length, 0) > 32768) return reject(400, 'Invalid text messages.');
      // Claim the slot after reading the body, then check it again to avoid a race.
      if (active) return reject(429, '桌宠正在回复，请稍候。');
      active = true;
      claimed = true;
      const backend = getBackend ? await getBackend() : { client: chatgpt, model: getModel(), needsSession: true };
      if (backend.needsSession && !(await backend.client.getSession()).sharing) return reject(503, '请打开模型连接设置，登录 ChatGPT 并允许使用订阅额度。');
      const model = backend.model;
      if (!model) return reject(400, '请先在模型连接设置中选择或填写模型。');
      const instructions = body.messages.filter(m => m.role === 'system' || m.role === 'developer').map(m => m.content).join('\n');
      const input = body.messages.filter(m => m.role === 'user' || m.role === 'assistant');
      if (!input.length) return reject(400, 'Missing user message.');
      const id = `chatcmpl-${randomUUID()}`;
      const emit = (delta, finish_reason = null) => {
        if (res.destroyed) return;
        if (!wrote) {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
          wrote = true;
        }
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      };
      let output = 0;
      await backend.client.streamResponse({ model, input, instructions: `${instructions}\n回复尽量简短，通常不超过 200 个汉字。`, maxTokens: body.max_tokens, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(55000)]), onDelta(delta) {
        output += delta.length;
        if (output > 16384) { controller.abort(); return; }
        emit({ content: delta });
      } });
      emit({}, 'stop');
      res.end('data: [DONE]\n\n');
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : 'request_failed';
      if (!wrote) reject(error?.status === 429 ? 429 : 502, `当前模型请求未完成（${code}）。请打开模型连接设置，检查登录、密钥、模型和额度。`);
      else {
        res.write(`data: ${JSON.stringify({ error: { message: `Model response failed: ${code}`, type: 'local_bridge_error' } })}\n\n`);
        res.end();
      }
    } finally {
      requests.delete(controller);
      // Only the request that claimed the slot can release it.
      if (claimed) active = false;
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { port: server.address().port, close() { for (const request of requests) request.abort(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}
