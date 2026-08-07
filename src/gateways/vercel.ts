import { BaseGateway } from './base.js';

export class VercelGateway extends BaseGateway {
  name = 'Vercel';

  constructor(apiKey: string) {
    // Native Anthropic Messages endpoint: transport posts to https://ai-gateway.vercel.sh/v1/messages
    super(apiKey, 'https://ai-gateway.vercel.sh/v1', undefined, {
      baseURL: 'https://ai-gateway.vercel.sh',
      authStyle: 'bearer',
    });
  }
}
