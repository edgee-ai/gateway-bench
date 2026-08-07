import OpenAI from 'openai';
import diagnosticsChannel from 'node:diagnostics_channel';
import { URL } from 'node:url';
import { BenchmarkConfig, BenchmarkResult, ChunkSample } from '../types.js';
import { getClientLocationInfo } from '../utils/location.js';

// Raised when a gateway is asked for an API method it doesn't support.
export class ApiUnsupportedError extends Error {}

// Structural view of a fetch Headers object (avoids depending on the global
// `Headers` type name, which the lint env doesn't expose).
type HeaderBag = { forEach(_cb: (_value: string, _name: string) => void): void };

// ---------------------------------------------------------------------------
// Flow instrumentation (gateway network-path analysis).
//
// We capture, per request: the upstream host + resolved remote IP, the
// negotiated ALPN (h2/http1), the connect+TLS time, whether the connection was
// freshly opened (cold) or reused (warm), the time to response headers (TTFB)
// vs time to first token (TTFT), and a curated set of response headers. The
// headers are the high-signal part: `cf-ray` reveals the Cloudflare edge colo
// that served the client (proves anycast-near-client), `server`/`via` reveal
// the fronting stack, and forwarded `anthropic-*` headers prove the gateway
// truly proxies to Anthropic. Each request emits one `FLOW {json}` line on
// stdout for later extraction.
// ---------------------------------------------------------------------------

export interface FlowInfo {
  host: string;
  remoteIp?: string;
  alpn?: string;
  httpStatus?: number;
  connectMs?: number; // TCP+TLS establishment time for the last connection to host
  connFresh?: boolean; // a new connection was opened during this request (cold) vs reused (warm)
  ttfbMs: number; // time from request start to response headers
  headers: Record<string, string>;
}

// Last connection observed per host, from undici diagnostics channels. Best
// effort: under concurrency the host key may collide, and reused (keep-alive)
// connections emit no event so the entry reflects the original handshake.
const connByHost = new Map<string, { remoteIp?: string; alpn?: string; connectMs?: number; at: number }>();
const beforeConnectAt = new Map<string, number>();
try {
  diagnosticsChannel.subscribe('undici:client:beforeConnect', (msg: unknown) => {
    const host = (msg as { connectParams?: { hostname?: string } })?.connectParams?.hostname;
    if (host) beforeConnectAt.set(host, Date.now());
  });
  diagnosticsChannel.subscribe('undici:client:connected', (msg: unknown) => {
    const m = msg as { connectParams?: { hostname?: string }; socket?: { remoteAddress?: string; alpnProtocol?: string } };
    const host = m?.connectParams?.hostname;
    if (!host) return;
    const started = beforeConnectAt.get(host);
    connByHost.set(host, {
      remoteIp: m.socket?.remoteAddress,
      alpn: m.socket?.alpnProtocol || undefined,
      connectMs: started !== undefined ? Date.now() - started : undefined,
      at: Date.now(),
    });
  });
} catch {
  // diagnostics channel unavailable — flow logs simply omit connection details.
}

// Response headers worth keeping for path analysis. Either an exact name or a
// prefix match; high-cardinality / sensitive headers are dropped.
const HEADER_PREFIXES = ['cf-', 'x-', 'anthropic-', 'openai-', 'fly-'];
const HEADER_NAMES = new Set(['server', 'via', 'age', 'date', 'retry-after', 'alt-svc']);
function pickHeaders(h: HeaderBag): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, name) => {
    const n = name.toLowerCase();
    if (n === 'set-cookie' || n === 'authorization') return;
    if (HEADER_NAMES.has(n) || HEADER_PREFIXES.some((p) => n.startsWith(p))) {
      out[n] = value;
    }
  });
  return out;
}

// Builds a FlowInfo from a fetch/SDK Response, attaching the last-seen
// connection details for `host` (and whether that connection is fresh).
function buildFlow(host: string, status: number, headers: HeaderBag, startTime: number): FlowInfo {
  const conn = connByHost.get(host);
  return {
    host,
    remoteIp: conn?.remoteIp,
    alpn: conn?.alpn,
    httpStatus: status,
    connectMs: conn?.connectMs,
    connFresh: conn ? conn.at >= startTime : undefined,
    ttfbMs: Date.now() - startTime,
    headers: pickHeaders(headers),
  };
}

// What a transport returns on success; throws on failure.
export interface TransportOutcome {
  response: string;
  ttft: number; // ms
  totalTime: number; // ms
  modelUsed: string;
  finishReason: string;
  flow?: FlowInfo;
}

// Connection details for the Anthropic Messages endpoint of a gateway (or Anthropic direct).
export interface AnthropicConnection {
  baseURL: string; // host root; we POST to `${baseURL}/v1/messages`
  authStyle: 'bearer' | 'x-api-key';
  apiKey: string;
  extraHeaders?: Record<string, string>;
}

// Fire one throwaway request to warm the gateway→upstream (OpenAI/Anthropic) connection.
// Not measured: errors are swallowed and timing is discarded. Keeps maxTokens tiny and
// strips diagnostics so the ping is as cheap as possible.
export async function runWarmup(
  client: OpenAI | undefined,
  conn: AnthropicConnection | undefined,
  config: BenchmarkConfig,
): Promise<void> {
  const warmConfig: BenchmarkConfig = {
    ...config,
    prompt: 'ping',
    messages: [{ role: 'user', content: 'ping' }],
    tools: undefined,
    maxTokens: 100,
    debugChunks: 0,
    onChunkLog: undefined,
  };
  try {
    const api = config.api ?? 'openai';
    if (api === 'anthropic' && conn) {
      await runAnthropicTransport(conn, warmConfig, Date.now());
    } else if (client) {
      await runOpenAITransport(client, warmConfig, Date.now());
    }
  } catch {
    // warm-up failures must not affect the measured run
  }
}

// OpenAI Chat Completions transport (POST /v1/chat/completions).
export async function runOpenAITransport(
  client: OpenAI,
  config: BenchmarkConfig,
  startTime: number,
): Promise<TransportOutcome> {
  let ttft = 0;
  let firstTokenReceived = false;

  const messages = config.messages || [{ role: 'user' as const, content: config.prompt }];

  // GPT-5 models use max_completion_tokens instead of max_tokens
  const isGpt5Model = config.model.includes('gpt-5') || config.model.includes('gpt5');
  const tokenParam = isGpt5Model
    ? { max_completion_tokens: config.maxTokens || 3000 }
    : { max_tokens: config.maxTokens || 3000 };

  const stream = await client.chat.completions.create({
    model: config.model,
    messages,
    ...tokenParam,
    ...(config.tools ? { tools: config.tools } : {}),
    stream: true,
    stream_options: { include_usage: true },
  }).withResponse();

  const { data: chunks, response } = stream;
  const host = (() => {
    try {
      return new URL(String(client.baseURL)).hostname;
    } catch {
      return 'unknown';
    }
  })();
  const flow = buildFlow(host, response.status, response.headers, startTime);

  let response_text = '';
  let finishReason = '';
  let modelUsed = config.model;

  const captureN = config.debugChunks ?? 0;
  const chunkLog: ChunkSample[] = [];

  for await (const chunk of chunks) {
    // Some gateways (e.g. Orq.ai) wrap the OpenAI chunk in an { event, data } envelope.
    const payload = ((chunk as unknown as { data?: typeof chunk }).data ?? chunk);
    const choice = payload.choices?.[0];
    // Detect first token when content property exists (even if empty string)
    const hasContent = !!choice?.delta && 'content' in choice.delta && choice.delta.content !== '';
    const isFirstContent = !firstTokenReceived && hasContent;
    if (isFirstContent) {
      ttft = Date.now() - startTime;
      firstTokenReceived = true;
    }

    if (captureN && chunkLog.length < captureN) {
      const delta = choice?.delta as { content?: unknown } | undefined;
      chunkLog.push({
        index: chunkLog.length,
        atMs: Date.now() - startTime,
        text: typeof delta?.content === 'string' ? delta.content : '',
        countsAsTtft: isFirstContent,
        raw: JSON.stringify(payload).slice(0, 400),
      });
    }

    const content = choice?.delta?.content || '';
    response_text += content;

    if (choice?.finish_reason) {
      finishReason = choice.finish_reason;
    }

    if (payload.model) {
      modelUsed = payload.model;
    }
  }

  if (captureN && config.onChunkLog) config.onChunkLog(chunkLog);

  return { response: response_text, ttft, totalTime: Date.now() - startTime, modelUsed, finishReason, flow };
}

// Pulls text/finish/model out of a single SSE event, tolerating both Anthropic-native
// (content_block_delta / text_delta) and OpenAI-style (choices[].delta.content) shapes —
// some gateways stream OpenAI chunks from their /v1/messages endpoint.
function parseMessagesEvent(obj: Record<string, unknown>): { text: string; finishReason?: string; model?: string } {
  let text = '';
  let finishReason: string | undefined;
  let model: string | undefined;

  // Anthropic native
  const type = obj.type as string | undefined;
  const delta = obj.delta as Record<string, unknown> | undefined;
  if (type === 'content_block_delta' && delta?.type === 'text_delta' && typeof delta.text === 'string') {
    text += delta.text;
  }
  if (type === 'message_delta' && typeof delta?.stop_reason === 'string') {
    finishReason = delta.stop_reason;
  }
  const message = obj.message as Record<string, unknown> | undefined;
  if (typeof message?.model === 'string') {
    model = message.model;
  }

  // OpenAI-style chunk
  const choices = obj.choices as Array<Record<string, unknown>> | undefined;
  const choice = choices?.[0];
  if (choice) {
    const oaDelta = choice.delta as Record<string, unknown> | undefined;
    if (typeof oaDelta?.content === 'string') {
      text += oaDelta.content;
    }
    if (typeof choice.finish_reason === 'string') {
      finishReason = choice.finish_reason;
    }
  }
  if (typeof obj.model === 'string') {
    model = obj.model;
  }

  return { text, finishReason, model };
}

// Anthropic Messages transport (POST /v1/messages), via raw fetch + tolerant SSE parsing.
// Works against Anthropic direct and any gateway exposing a /v1/messages endpoint,
// regardless of whether it streams Anthropic-native or OpenAI-style chunks.
export async function runAnthropicTransport(
  conn: AnthropicConnection,
  config: BenchmarkConfig,
  startTime: number,
): Promise<TransportOutcome> {
  let ttft = 0;
  let firstTokenReceived = false;

  // System messages are passed separately in the Anthropic API.
  const systemMessage = config.messages?.find((m) => m.role === 'system');
  const userMessages = config.messages
    ? config.messages.filter((m) => m.role !== 'system')
    : [{ role: 'user' as const, content: config.prompt }];

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    ...(conn.authStyle === 'bearer'
      ? { authorization: `Bearer ${conn.apiKey}` }
      : { 'x-api-key': conn.apiKey }),
    ...conn.extraHeaders,
  };

  const body = JSON.stringify({
    model: config.model,
    messages: userMessages,
    max_tokens: config.maxTokens || 3000,
    ...(systemMessage ? { system: systemMessage.content } : {}),
    ...(config.tools ? { tools: config.tools } : {}),
    stream: true,
  });

  const res = await fetch(`${conn.baseURL}/v1/messages`, { method: 'POST', headers, body });
  const host = (() => {
    try {
      return new URL(conn.baseURL).hostname;
    } catch {
      return 'unknown';
    }
  })();
  const flow = buildFlow(host, res.status, res.headers, startTime);
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  let response = '';
  let finishReason = '';
  let modelUsed = config.model;

  const captureN = config.debugChunks ?? 0;
  const chunkLog: ChunkSample[] = [];

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '' || data === '[DONE]') continue;

      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(data);
      } catch {
        continue;
      }

      const { text, finishReason: fr, model } = parseMessagesEvent(obj);
      const isFirstContent = !firstTokenReceived && !!text;
      if (text) {
        if (isFirstContent) {
          ttft = Date.now() - startTime;
          firstTokenReceived = true;
        }
        response += text;
      }

      if (captureN && chunkLog.length < captureN) {
        chunkLog.push({
          index: chunkLog.length,
          atMs: Date.now() - startTime,
          kind: typeof obj.type === 'string' ? obj.type : undefined,
          text: text || '',
          countsAsTtft: isFirstContent,
          raw: data.slice(0, 400),
        });
      }

      if (fr) finishReason = fr;
      if (model) modelUsed = model;
    }
  }

  if (captureN && config.onChunkLog) config.onChunkLog(chunkLog);

  return { response, ttft, totalTime: Date.now() - startTime, modelUsed, finishReason, flow };
}

// Builds the final BenchmarkResult from a transport outcome or an error.
// Single home for location lookup, the TTFT-zero fallback, and result shaping.
export async function assembleResult(
  gatewayName: string,
  config: BenchmarkConfig,
  result: TransportOutcome | { error: unknown },
): Promise<BenchmarkResult> {
  const locationInfo = await getClientLocationInfo();
  const api = config.api ?? 'openai';

  // if gateway is Edgee, use Fargate pop region, otherwise use empty string
  let pop_region = '';
  if (gatewayName === 'Edgee') {
    pop_region = locationInfo.fargate_pop_region || '';
  } else {
    pop_region = '';
  }

  const base = {
    gateway: gatewayName,
    batchName: config.batchName,
    provider: config.provider,
    modelTopLevelName: config.modelTopLevelName,
    scenarioName: config.scenarioName,
    timestamp: new Date(),
    country_code: locationInfo.country_code,
    continent: locationInfo.continent,
    city: locationInfo.city,
    region: locationInfo.region,
    proxy_type: locationInfo.proxy_type,
    proxy_description: locationInfo.proxy_description,
    as_name: locationInfo.as_name,
    conn_speed: locationInfo.conn_speed,
    conn_type: locationInfo.conn_type,
    model: config.model,
    api,
    pop_region,
  };

  if ('error' in result) {
    const error = result.error;
    return {
      ...base,
      ttft: 0,
      totalTime: 0,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  let { ttft } = result;
  // If we got a response but never measured TTFT, estimate it just before total time.
  if (ttft === 0 && result.response.length > 0) {
    ttft = Math.max(1, result.totalTime - 100);
    console.warn(`⚠️  ${gatewayName}: TTFT was 0 but response received. Estimated TTFT: ${ttft}ms`);
  }

  // Flatten the flow info onto the result so it persists through the BigQuery
  // sink (one clean row per request per PoP — far more reliable than parsing
  // stdout/Stackdriver). Headers we surface as columns + a JSON blob.
  const f = result.flow;
  const flowFields = f
    ? {
        ttfb: f.ttfbMs,
        flow_host: f.host,
        flow_remote_ip: f.remoteIp,
        flow_alpn: f.alpn,
        flow_http_status: f.httpStatus,
        flow_connect_ms: f.connectMs,
        flow_conn_fresh: f.connFresh,
        flow_server: f.headers['server'],
        flow_cf_ray: f.headers['cf-ray'],
        flow_via: f.headers['via'],
        flow_headers_json: JSON.stringify(f.headers),
      }
    : {};

  return {
    ...base,
    ...flowFields,
    ...base,
    ttft,
    totalTime: result.totalTime,
    success: true,
    modelUsed: result.modelUsed,
    finishReason: result.finishReason,
  };
}
