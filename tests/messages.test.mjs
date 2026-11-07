import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

delete process.env.CLIENT_GEO_URL;
delete process.env.POP_REGION_URL;
process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
process.env.CLOUDFLARE_GATEWAY_ID = 'test-gateway';
const { runAnthropicTransport } = await import('../dist/gateways/transport.js');
const models = JSON.parse(readFileSync(new URL('../models.json', import.meta.url)));
const entries = models.providers.find(p => p.name === 'anthropic').models[0].gateways;
const tools = [{ type: 'function', function: { name: 'lookup', description: 'Look up a city',
  parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } }];
const events = [
  { type: 'message_start', message: { model: 'served-model' } },
  { type: 'ping' },
  { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"city":"Paris"}' } },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
  { type: 'message_stop' },
];
function sse(events) {
  return events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}
for (const [file, className, endpoint] of [
  ['anthropic', 'AnthropicGateway', 'https://api.anthropic.com/v1/messages'],
  ['edgee', 'EdgeeGateway', 'https://edgee.io/v1/messages'],
  ['openrouter', 'OpenRouterGateway', 'https://openrouter.ai/api/v1/messages'],
  ['truefoundry', 'TrueFoundryGateway', 'https://gateway.truefoundry.ai/messages'],
  ['vercel', 'VercelGateway', 'https://ai-gateway.vercel.sh/v1/messages'],
  ['cloudflare', 'CloudflareGateway', 'https://gateway.ai.cloudflare.com/v1/test-account/test-gateway/anthropic/v1/messages'],
  ['orq', 'OrqGateway', 'https://my.orq.ai/v3/anthropic/v1/messages'],
  ['portkey', 'PortkeyGateway', 'https://api.portkey.ai/v1/messages'],
  ['requesty', 'RequestyGateway', 'https://router.requesty.ai/v1/messages'],
]) {
  const Gateway = (await import(`../dist/gateways/${file}.js`))[className];
  test(`${className}: configured Messages endpoint, payload, auth, and warmup`, async t => {
    const gateway = new Gateway('test-key');
    const entry = entries[gateway.name];
    assert.equal(entry.api, 'anthropic');
    assert.equal(gateway.supportsApi(entry.api), true);
    const requests = [];
    let chunks;
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(url, endpoint);
      assert.equal(init.headers['anthropic-version'], '2023-06-01');
      assert.equal(init.headers[file === 'anthropic' ? 'x-api-key' : 'authorization'],
        file === 'anthropic' ? 'test-key' : 'Bearer test-key');
      requests.push(JSON.parse(init.body));
      // Split SSE fields and JSON across network chunks to exercise buffering.
      const bytes = new TextEncoder().encode(sse(events));
      return new Response(new ReadableStream({ start(controller) {
        for (let i = 0; i < bytes.length; i += 13) controller.enqueue(bytes.slice(i, i + 13));
        controller.close();
      } }), { headers: { 'content-type': 'text/event-stream' } });
    });
    const result = await gateway.execute({ ...entry, provider: 'anthropic', warmup: true,
      prompt: 'Hello', maxTokens: 256, tools, debugChunks: 10, onChunkLog: c => { chunks = c; },
      messages: [{ role: 'system', content: 'Be concise' }, { role: 'system', content: 'Use tools' }, { role: 'user', content: 'Paris?' }],
    });
    assert.equal(result.success, true, result.error);
    assert.equal(result.api, 'anthropic');
    assert.equal(result.modelUsed, 'served-model');
    assert.equal(result.finishReason, 'tool_use');
    assert.deepEqual(chunks.map(c => c.countsAsTtft), [false, false, true, false, false]);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].max_tokens, 100);
    assert.equal(requests[0].tools, undefined);
    assert.deepEqual(requests[0].messages, [{ role: 'user', content: 'ping' }]);
    assert.equal(requests[1].max_tokens, 256);
    assert.deepEqual(requests[1].messages, [{ role: 'user', content: 'Paris?' }]);
    assert.deepEqual(requests[1].system, [{ type: 'text', text: 'Be concise' }, { type: 'text', text: 'Use tools' }]);
    assert.deepEqual(requests[1].tools, [{ name: 'lookup', description: 'Look up a city', input_schema: tools[0].function.parameters }]);
    for (const body of requests) {
      assert.equal(body.model, entry.model);
      assert.deepEqual(body.provider, file === 'openrouter' ? { only: ['anthropic'], allow_fallbacks: false } : undefined);
    }
  });
}
for (const [events, expected] of [
  [[{ type: 'error', error: { message: 'overloaded' } }], /overloaded/],
  [[{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } }], /without a stop reason/],
]) {
  test(`Messages rejects ${expected}`, async t => {
    t.mock.method(globalThis, 'fetch', async () => new Response(sse(events)));
    await assert.rejects(runAnthropicTransport({ baseURL: 'https://example.test', authStyle: 'bearer', apiKey: 'test-key' },
      { model: 'test-model', prompt: 'Hi' }, Date.now()), expected);
  });
}
