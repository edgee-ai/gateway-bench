import { BaseGateway } from './base.js';

// Provider-specific endpoints of the AI Gateway instance: the OpenAI path serves
// /chat/completions, the Anthropic one serves /v1/messages. Provider keys are stored
// on the gateway (BYOK), so CLOUDFLARE_API_KEY is the only credential we send.
//
// The account id and gateway name address *your own* AI Gateway instance, so they
// come from the environment: set CLOUDFLARE_ACCOUNT_ID (and optionally
// CLOUDFLARE_GATEWAY_ID, defaults to "default") in your .env.
const GATEWAY_HOST = 'https://gateway.ai.cloudflare.com/v1';

export class CloudflareGateway extends BaseGateway {
  name = 'Cloudflare';

  constructor(apiKey: string) {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    const gatewayId = process.env.CLOUDFLARE_GATEWAY_ID?.trim() || 'default';

    if (!accountId) {
      throw new Error(
        'CLOUDFLARE_ACCOUNT_ID is required to use the Cloudflare gateway. ' +
          'Find it in the Cloudflare dashboard under AI > AI Gateway.',
      );
    }

    const base = `${GATEWAY_HOST}/${accountId}/${gatewayId}`;

    super(apiKey, `${base}/openai`, undefined, {
      baseURL: `${base}/anthropic`,
      authStyle: 'bearer',
    });
  }
}
