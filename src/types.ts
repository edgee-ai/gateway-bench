export interface PromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PromptTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// Which API surface / transport a request uses.
//   'openai'    => POST /v1/chat/completions (OpenAI SDK)
//   'anthropic' => POST /v1/messages (Anthropic SDK)
export type ApiMethod = 'openai' | 'anthropic';

// One raw streamed chunk captured for diagnostics (see `inspect` CLI command).
// Used to verify whether a gateway "fakes" TTFT by emitting an early empty /
// whitespace chunk before any real content.
export interface ChunkSample {
  index: number; // 0-based arrival order
  atMs: number; // ms since request start when this chunk arrived
  kind?: string; // SSE event type for the anthropic transport (e.g. 'content_block_delta', 'ping')
  text: string; // text delta extracted from this chunk ('' when the chunk carries no text)
  countsAsTtft: boolean; // true for the chunk that the TTFT metric is pinned to (first non-empty content)
  raw: string; // truncated raw payload, for ad-hoc inspection
}

// How to build an Anthropic (messages) client pointed at a gateway's own host.
export interface AnthropicClientConfig {
  baseURL: string; // host root; the Anthropic SDK appends /v1/messages
  authStyle: 'bearer' | 'x-api-key';
  extraHeaders?: Record<string, string>;
}

export interface BenchmarkConfig {
  batchName: string;
  model: string;
  provider: string; // 'openai' or 'anthropic'
  modelTopLevelName: string;
  scenarioName: string; // Name of the prompt scenario (simple, large-context, complex-tools)
  prompt: string; // Legacy: single prompt text (for backward compatibility)
  messages?: PromptMessage[]; // Modern: array of messages for multi-turn conversations
  tools?: PromptTool[]; // Optional: tools available in the conversation
  iterations: number;
  maxTokens?: number;
  api?: ApiMethod; // Transport to use; resolved to the gateway's defaultApi when omitted

  // Diagnostics: when set, the transport captures the first `debugChunks` raw streamed
  // chunks and hands them to `onChunkLog`. Off (undefined/0) for normal benchmark runs.
  debugChunks?: number;
  onChunkLog?: (_samples: ChunkSample[]) => void;

  // When true, the gateway fires one throwaway "ping" request first (to warm the
  // gateway→upstream connection) and only measures the request that follows.
  warmup?: boolean;
}

export interface ClientLocationInfo {
  country_code: string;
  continent: string;
  proxy_type: string;
  proxy_description: string;
  as_name: string;
  conn_speed: string;
  conn_type: string;
  city: string;
  region: string;
  ip?: string;
  fargate_pop_region?: string;
}

export interface BenchmarkResult {
  gateway: string;
  batchName: string;
  provider: string; // 'openai' or 'anthropic' - for filtering results
  modelTopLevelName: string;
  scenarioName: string; // Name of the prompt scenario tested
  timestamp: Date;
  country_code: string;
  continent: string;
  city: string;
  region: string;
  proxy_type: string;
  proxy_description: string;
  as_name: string;
  conn_speed: string;
  conn_type: string;
  model: string;

  // Timing metrics (milliseconds)
  ttft: number; // Time to first token
  totalTime: number;
  ttfb?: number; // Time to response headers (client→gateway + first byte), excludes streaming

  // Transport used for this request
  api: ApiMethod;

  // Pop region
  pop_region: string;

  // Network-path analysis (see transport.ts FlowInfo). Populated on success.
  flow_host?: string;
  flow_remote_ip?: string; // resolved upstream IP (best-effort, undici diagnostics)
  flow_alpn?: string; // negotiated protocol (h2/http/1.1)
  flow_http_status?: number;
  flow_connect_ms?: number; // TCP+TLS establishment for the last connection to host
  flow_conn_fresh?: boolean; // connection opened cold for this request vs reused warm
  flow_server?: string; // `server` response header (e.g. cloudflare, Google Frontend)
  flow_cf_ray?: string; // Cloudflare ray id; suffix = edge colo that served the client
  flow_via?: string; // `via` response header
  flow_headers_json?: string; // full curated response headers as JSON, for ad-hoc analysis

  // Quality metrics
  success: boolean;
  error?: string;

  // Additional metadata
  requestId?: string;
  modelUsed?: string; // Actual model used (might differ from requested)
  finishReason?: string;
}

export interface Gateway {
  name: string;
  defaultApi: ApiMethod; // Transport used when a model entry doesn't specify one
  supportsApi(_api: ApiMethod): boolean;
  execute(_config: BenchmarkConfig): Promise<BenchmarkResult>;
}
