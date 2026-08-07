import { BaseGateway } from './base.js';

export class PortkeyGateway extends BaseGateway {
  name = 'Portkey';

  constructor(apiKey: string) {
    // Native Anthropic Messages endpoint: SDK posts to https://api.portkey.ai/v1/messages
    // Auth (bearer vs x-api-key) + model slug to confirm on first run.
    super(apiKey, 'https://api.portkey.ai/v1', undefined, {
      baseURL: 'https://api.portkey.ai',
      authStyle: 'bearer',
    });
  }
}
