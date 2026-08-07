import { BaseGateway } from './base.js';
import { AnthropicClientConfig } from '../types.js';

const EDGEE_HEADERS = { 'x-edgee-tags': 'benchmark' };

// Native /v1/messages support: host root (SDK appends /v1/messages), Bearer auth, same tags.
const anthropicConfig = (host: string): AnthropicClientConfig => ({
  baseURL: host,
  authStyle: 'bearer',
  extraHeaders: EDGEE_HEADERS,
});

export class EdgeeGateway extends BaseGateway {
  name = 'Edgee';

  constructor(apiKey: string) {
    super(apiKey, 'https://edgee.io/v1', EDGEE_HEADERS, anthropicConfig('https://edgee.io'));
  }
}
