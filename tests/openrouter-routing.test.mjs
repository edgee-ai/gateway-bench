import assert from 'node:assert/strict';
import test from 'node:test';

// Keep result assembly offline as well as the mocked inference requests.
delete process.env.CLIENT_GEO_URL;
delete process.env.POP_REGION_URL;
const { OpenRouterGateway } = await import('../dist/gateways/openrouter.js');
const { OpenAIGateway } = await import('../dist/gateways/openai.js');

for (const api of ['responses', 'openai']) {
  for (const [Gateway, provider, model, pinned] of [
    [OpenRouterGateway, 'openai', 'openai/gpt-6-luna', true],
    [OpenRouterGateway, 'anthropic', 'anthropic/claude-sonnet-4.6', true],
    [OpenAIGateway, 'openai', 'gpt-6-luna', false],
  ]) {
    test(`${Gateway.name} ${provider} ${api}: routing applies to measured and warmup requests`, async () => {
      const gateway = new Gateway('test-key');
      const requests = [];
      gateway.client.fetch = async (url, init) => {
        assert.ok(String(url).endsWith(api === 'responses' ? '/responses' : '/chat/completions'));
        requests.push(JSON.parse(init.body));
        const events = api === 'responses'
          ? [{ type: 'response.output_text.delta', delta: 'Hi' },
            { type: 'response.completed', response: { model, status: 'completed' } }]
          : [{ model, choices: [{ delta: { content: 'Hi' }, finish_reason: 'stop' }] }];
        return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } });
      };
      const result = await gateway.execute({ model, provider, api, warmup: true, prompt: 'Hi', maxTokens: 256 });
      assert.equal(result.success, true, result.error);
      assert.equal(requests.length, 2);
      for (const body of requests) {
        assert.equal(body.model, model);
        if (pinned) {
          assert.deepEqual(body.provider, { only: [provider], allow_fallbacks: false });
        } else {
          assert.equal('provider' in body, false);
        }
      }
    });
  }
}

for (const [Gateway, pinned] of [[OpenRouterGateway, true], [(await import('../dist/gateways/vercel.js')).VercelGateway, false]]) {
  test(`${Gateway.name} Messages routing applies to warmup and measured requests`, async (t) => {
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.ok(String(url).endsWith('/v1/messages'));
      requests.push(JSON.parse(init.body));
      return new Response(
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n' +
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    });
    const result = await new Gateway('test-key').execute({
      model: 'anthropic/claude-sonnet-4.6', provider: 'anthropic', api: 'anthropic',
      warmup: true, prompt: 'Hi', maxTokens: 256,
    });
    assert.equal(result.success, true, result.error);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].max_tokens, 100);
    assert.equal(requests[1].max_tokens, 256);
    for (const body of requests) {
      assert.deepEqual(body.provider, pinned ? { only: ['anthropic'], allow_fallbacks: false } : undefined);
    }
  });
}
