import OpenAI from 'openai';
import { endpointUrl } from './providers.mjs';

export function createApiProvider({ getConnection, fetcher = globalThis.fetch }) {
  return {
    async streamResponse({ input, instructions, signal, onDelta, maxTokens = 1024 }) {
      const config = getConnection();
      if (!config.apiKey) throw Object.assign(new Error('请先填写并保存当前服务商的 API Key。'), { code: 'key_required' });
      if (!config.model) throw Object.assign(new Error('请填写当前服务商的模型 ID。'), { code: 'model_required' });
      const endpoint = endpointUrl(config.baseUrl);
      const baseURL = endpoint.slice(0, -'/chat/completions'.length);
      const client = new OpenAI({ apiKey: config.apiKey, baseURL, organization: null, project: null, maxRetries: 0, timeout: 55000, logLevel: 'off',
        fetch: async (url, init) => {
          if (String(url) !== endpoint) throw new Error('Unexpected model endpoint.');
          return fetcher(endpoint, { method: 'POST', body: init.body, signal: init.signal, redirect: 'error', headers: { 'content-type': 'application/json', accept: 'text/event-stream', authorization: `Bearer ${config.apiKey}` } });
        },
      });
      let text = '', completed = false;
      try {
        const stream = await client.chat.completions.create({ model: config.model, messages: [{ role: 'system', content: instructions ?? '' }, ...input], stream: true, max_tokens: Number.isInteger(maxTokens) ? Math.max(128, Math.min(4096, maxTokens)) : 1024,
          ...(['deepseek', 'doubao'].includes(config.provider) || (config.provider === 'kimi' && config.model === 'kimi-k2.6') ? { thinking: { type: 'disabled' } } : {}),
        }, { signal });
        for await (const event of stream) {
          signal?.throwIfAborted();
          const choice = event.choices?.find(c => c.index === 0);
          if (choice?.delta?.refusal) throw Object.assign(new Error(), { code: 'refusal' });
          const delta = choice?.delta?.content;
          if (typeof delta === 'string') {
            text += delta;
            if (text.length > 16384) throw Object.assign(new Error(), { code: 'output_too_large' });
            onDelta?.(delta);
          }
          if (choice?.finish_reason) {
            if (choice.finish_reason !== 'stop') throw Object.assign(new Error(), { code: `finish_${choice.finish_reason}` });
            completed = true;
          }
        }
        signal?.throwIfAborted();
        if (!completed || !text.trim()) throw Object.assign(new Error(), { code: 'incomplete_response' });
        return { text };
      } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : undefined;
        const code = signal?.aborted ? 'cancelled' : status ? `http_${status}` : /^[a-z_]{1,40}$/u.test(error?.code ?? '') ? error.code : 'network_error';
        const hint = status === 401 || status === 403 ? '请检查 API Key 和模型权限。' : status === 429 ? '接口限流或额度不足。' : '请检查接口地址、模型 ID 和网络。';
        throw Object.assign(new Error(`模型接口请求未完成（${code}）。${hint}`), { code, status });
      }
    },
  };
}
