import { BaseGateway } from './base.js';

export class OpenAIGateway extends BaseGateway {
  name = 'OpenAI (Direct)';

  constructor(apiKey: string) {
    super(apiKey, 'https://api.openai.com/v1');
  }
}
