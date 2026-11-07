import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';
import { runOpenAITransport, runWarmup } from '../dist/gateways/transport.js';

for (const model of [
  'gpt-6-luna',
  'gpt-6-luna:openai',
  'openai/gpt-6-luna:openai',
  'openai2/gpt-6-luna',
  '@benchmark-app/gpt-6-luna',
  'gpt-5.4',
  'gpt5',
  'gpt-4o',
  'anthropic/claude-sonnet-4-6',
]) {
  test(`Chat Completions token limit for ${model}`, async () => {
    const requests = [];
    const client = new OpenAI({
      apiKey: 'test-key',
      baseURL: 'https://gateway.example/v1',
      fetch: async (url, init) => {
        assert.equal(String(url), 'https://gateway.example/v1/chat/completions');
        requests.push(JSON.parse(init.body));
        return new Response(
          'data: {"model":"served-model","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n' +
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
          'data: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
    });
    const config = { model, prompt: 'Hello', maxTokens: 256, api: 'openai' };
    const result = await runOpenAITransport(client, config, Date.now());
    await runWarmup(client, undefined, config);
    const legacy = model === 'gpt-4o' || model.startsWith('anthropic/');
    const tokenKey = legacy ? 'max_tokens' : 'max_completion_tokens';
    const absentKey = legacy ? 'max_completion_tokens' : 'max_tokens';
    assert.equal(requests.length, 2);
    for (const [index, body] of requests.entries()) {
      assert.equal(body.model, model);
      assert.equal(body[tokenKey], index === 0 ? 256 : 100);
      assert.equal(absentKey in body, false);
      assert.equal(body.stream, true);
    }
    assert.equal(result.response, 'Hello');
    assert.equal(result.modelUsed, 'served-model');
    assert.equal(result.finishReason, 'stop');
  });
}
