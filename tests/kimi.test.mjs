import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS } from '../app/providers.mjs';
import { createApiProvider } from '../app/api-provider.mjs';
test('Kimi uses its own Moonshot endpoint, key and non-thinking streaming mode', async () => {
  const preset = PROVIDERS.find(p => p.id === 'kimi');
  assert.equal(preset.baseUrl, 'https://api.moonshot.cn/v1');
  const service = createApiProvider({ getConnection: () => ({ ...preset, provider: 'kimi', apiKey: 'fake-kimi-only' }), fetcher: async (url, options) => {
    assert.equal(url, 'https://api.moonshot.cn/v1/chat/completions');
    assert.equal(options.headers.authorization, 'Bearer fake-kimi-only');
    const body = JSON.parse(options.body); assert.equal(body.model, 'kimi-k2.6'); assert.equal(body.thinking.type, 'disabled');
    return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:'你好，我是 Kimi'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n', { headers: {'content-type':'text/event-stream'} });
  } });
  let output='';const result=await service.streamResponse({input:[{role:'user',content:'你好'}],onDelta:s=>output+=s});
  assert.equal(result.text,'你好，我是 Kimi');assert.equal(output,result.text);
});
