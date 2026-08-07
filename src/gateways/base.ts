import OpenAI from 'openai';
import { AnthropicClientConfig, ApiMethod, BenchmarkConfig, BenchmarkResult, Gateway } from '../types.js';
import { AnthropicConnection, ApiUnsupportedError, assembleResult, runAnthropicTransport, runOpenAITransport, runWarmup } from './transport.js';

export abstract class BaseGateway implements Gateway {
  abstract name: string;
  defaultApi: ApiMethod = 'openai';
  protected client: OpenAI;
  protected anthropicConn?: AnthropicConnection;

  constructor(
    apiKey: string,
    baseURL?: string,
    defaultHeaders?: Record<string, string>,
    anthropicConfig?: AnthropicClientConfig,
  ) {
    this.client = new OpenAI({
      apiKey,
      baseURL,
      defaultHeaders,
    });

    if (anthropicConfig) {
      this.anthropicConn = {
        baseURL: anthropicConfig.baseURL,
        authStyle: anthropicConfig.authStyle,
        apiKey,
        extraHeaders: anthropicConfig.extraHeaders,
      };
    }
  }

  supportsApi(api: ApiMethod): boolean {
    return api === 'anthropic' ? !!this.anthropicConn : true;
  }

  async execute(config: BenchmarkConfig): Promise<BenchmarkResult> {
    try {
      const api = config.api ?? this.defaultApi;
      if (api === 'anthropic' && !this.anthropicConn) {
        throw new ApiUnsupportedError(`${this.name} does not support the anthropic (messages) API`);
      }

      if (config.warmup) {
        await runWarmup(this.client, this.anthropicConn, config);
      }

      const startTime = Date.now();
      const outcome = api === 'anthropic'
        ? await runAnthropicTransport(this.anthropicConn!, config, startTime)
        : await runOpenAITransport(this.client, config, startTime);
      return assembleResult(this.name, config, outcome);
    } catch (error) {
      return assembleResult(this.name, config, { error });
    }
  }
}
