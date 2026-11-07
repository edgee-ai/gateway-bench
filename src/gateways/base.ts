import OpenAI from 'openai';
import { AnthropicClientConfig, ApiMethod, BenchmarkConfig, BenchmarkResult, Gateway } from '../types.js';
import { AnthropicConnection, ApiUnsupportedError, assembleResult, runAnthropicTransport, runOpenAITransport, runResponsesTransport, runWarmup } from './transport.js';

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
        messagesPath: anthropicConfig.messagesPath,
        authStyle: anthropicConfig.authStyle,
        apiKey,
        extraHeaders: anthropicConfig.extraHeaders,
      };
    }
  }

  supportsApi(api: ApiMethod): boolean {
    return api === 'anthropic' ? !!this.anthropicConn : true;
  }

  // Gateway-specific routing fields, kept out of shared benchmark configuration.
  protected requestBody(_config: BenchmarkConfig): Record<string, unknown> {
    return {};
  }

  async execute(config: BenchmarkConfig): Promise<BenchmarkResult> {
    config = { ...config, api: config.api ?? this.defaultApi };
    try {
      const api = config.api;
      const extraBody = this.requestBody(config);
      if (api === 'anthropic' && !this.anthropicConn) {
        throw new ApiUnsupportedError(`${this.name} does not support the anthropic (messages) API`);
      }

      if (config.warmup) {
        await runWarmup(this.client, this.anthropicConn, config, extraBody);
      }

      const startTime = Date.now();
      const outcome = api === 'anthropic'
        ? await runAnthropicTransport(this.anthropicConn!, config, startTime, extraBody)
        : api === 'responses'
          ? await runResponsesTransport(this.client, config, startTime, extraBody)
          : await runOpenAITransport(this.client, config, startTime, extraBody);
      return assembleResult(this.name, config, outcome);
    } catch (error) {
      return assembleResult(this.name, config, { error });
    }
  }
}
