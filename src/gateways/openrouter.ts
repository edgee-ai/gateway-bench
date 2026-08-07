import { BaseGateway } from './base.js';

export class OpenRouterGateway extends BaseGateway {
  name = 'OpenRouter';

  constructor(apiKey: string) {
    // Native Anthropic Messages endpoint: SDK posts to https://openrouter.ai/api/v1/messages
    super(apiKey, 'https://openrouter.ai/api/v1', undefined, {
      baseURL: 'https://openrouter.ai/api',
      authStyle: 'bearer',
    });
  }
}
