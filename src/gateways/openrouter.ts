import { BenchmarkConfig } from '../types.js';
import { BaseGateway } from './base.js';

export class OpenRouterGateway extends BaseGateway {
  name = 'OpenRouter';

  protected requestBody(config: BenchmarkConfig): Record<string, unknown> {
    // The model prefix identifies its author, not the inference provider.
    // A base slug matches the provider's endpoint variants, excluding other providers.
    return config.provider === 'openai' || config.provider === 'anthropic'
      ? { provider: { only: [config.provider], allow_fallbacks: false } }
      : {};
  }

  constructor(apiKey: string) {
    // Native Anthropic Messages endpoint: SDK posts to https://openrouter.ai/api/v1/messages
    super(apiKey, 'https://openrouter.ai/api/v1', undefined, {
      baseURL: 'https://openrouter.ai/api',
      authStyle: 'bearer',
    });
  }
}
