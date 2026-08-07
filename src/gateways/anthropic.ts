import { ApiMethod, BenchmarkConfig, BenchmarkResult, Gateway } from '../types.js';
import { AnthropicConnection, ApiUnsupportedError, assembleResult, runAnthropicTransport, runWarmup } from './transport.js';

export class AnthropicGateway implements Gateway {
  name = 'Anthropic (Direct)';
  defaultApi: ApiMethod = 'anthropic';
  private conn: AnthropicConnection;

  constructor(apiKey: string) {
    this.conn = {
      baseURL: 'https://api.anthropic.com',
      authStyle: 'x-api-key',
      apiKey,
    };
  }

  supportsApi(api: ApiMethod): boolean {
    return api === 'anthropic';
  }

  async execute(config: BenchmarkConfig): Promise<BenchmarkResult> {
    try {
      const api = config.api ?? this.defaultApi;
      if (api !== 'anthropic') {
        throw new ApiUnsupportedError(`${this.name} only supports the anthropic (messages) API`);
      }

      if (config.warmup) {
        await runWarmup(undefined, this.conn, config);
      }

      const startTime = Date.now();
      const outcome = await runAnthropicTransport(this.conn, config, startTime);
      return assembleResult(this.name, config, outcome);
    } catch (error) {
      return assembleResult(this.name, config, { error });
    }
  }
}
