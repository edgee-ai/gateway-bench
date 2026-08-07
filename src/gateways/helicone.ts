import { BaseGateway } from './base.js';

export class HeliconeGateway extends BaseGateway {
  name = 'Helicone';

  constructor(apiKey: string) {
    super(apiKey, 'https://ai-gateway.helicone.ai/v1');
  }
}
