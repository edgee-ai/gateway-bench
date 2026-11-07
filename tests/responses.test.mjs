import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import OpenAI from 'openai';
import { runResponsesTransport, runWarmup } from '../dist/gateways/transport.js';

const config = { model: 'gpt-5.6-luna', api: 'responses', prompt: 'Hello', maxTokens: 256 };
const completed = { type: 'response.completed', response: { model: 'served-model', status: 'completed' } };
function clientFor(events, requests = []) {
  return new OpenAI({ apiKey: 'test-key', baseURL: 'https://gateway.example/v1', maxRetries: 0,
    fetch: async (url, init) => {
      assert.equal(String(url), 'https://gateway.example/v1/responses');
      requests.push(JSON.parse(init.body));
      return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''),
        { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'test-request' } });
    },
  });
}

test('Responses sends messages/tools and measures output rather than lifecycle events', async () => {
  const requests = [];
  let chunks;
  const messages = [{ role: 'system', content: 'Be brief' }, { role: 'user', content: 'Hello' }];
  const tools = [{ type: 'function', function: { name: 'lookup', description: 'Look up', parameters: { type: 'object', properties: {} } } }];
  const client = clientFor([
    { type: 'response.created', response: { model: 'served-model' } },
    { type: 'response.output_text.delta', delta: '' },
    { type: 'response.output_text.delta', delta: 'Hello' }, completed,
  ], requests);
  const result = await runResponsesTransport(client, { ...config, messages, tools, debugChunks: 10, onChunkLog: v => { chunks = v; } }, Date.now() - 50);
  assert.deepEqual(requests[0], { model: config.model, input: messages, max_output_tokens: 256,
    tools: [{ type: 'function', ...tools[0].function, strict: false }], stream: true, store: false });
  assert.equal(result.response, 'Hello');
  assert.equal(result.modelUsed, 'served-model');
  assert.equal(result.finishReason, 'completed');
  assert.ok(result.ttft >= 50);
  assert.deepEqual(chunks.map(c => c.countsAsTtft), [false, false, true, false]);
  assert.equal(result.flow.headers['x-request-id'], 'test-request');
  await runWarmup(client, undefined, { ...config, tools });
  assert.equal(requests[1].max_output_tokens, 100);
  assert.equal(requests[1].tools, undefined);
  assert.deepEqual(requests[1].input, [{ role: 'user', content: 'ping' }]);
});

for (const type of ['response.function_call_arguments.delta', 'response.refusal.delta']) {
  test(`Responses measures ${type}`, async () => {
    const result = await runResponsesTransport(clientFor([{ type, delta: 'output' }, completed]), config, Date.now() - 50);
    assert.ok(result.ttft >= 50);
    assert.equal(result.response, 'output');
  });
}
for (const [events, message] of [
  [[{ type: 'response.failed', response: { error: { message: 'upstream failed' } } }], /upstream failed/],
  [[{ type: 'error', message: 'stream error' }], /stream error/],
  [[{ type: 'response.output_text.delta', delta: 'partial' }], /without a terminal event/],
]) {
  test(`Responses rejects ${message}`, async () => {
    await assert.rejects(runResponsesTransport(clientFor(events), config, Date.now()), message);
  });
}
test('Responses preserves truncation reason', async () => {
  const result = await runResponsesTransport(clientFor([{ type: 'response.incomplete', response: {
    incomplete_details: { reason: 'max_output_tokens' }, model: config.model,
  } }]), config, Date.now());
  assert.equal(result.finishReason, 'max_output_tokens');
});
test('Every configured OpenAI gateway explicitly uses Responses', () => {
  const models = JSON.parse(readFileSync(new URL('../models.json', import.meta.url)));
  const entries = models.providers.find(p => p.name === 'openai').models.flatMap(m => Object.values(m.gateways));
  assert.equal(entries.length, 9);
  assert.ok(entries.every(e => e.api === 'responses'));
});
