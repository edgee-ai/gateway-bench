import { BaseGateway } from './base.js';

// Kong Konnect serverless AI Gateway: one ai-proxy-advanced route serving both
// providers, on the OpenAI chat ingress. Each target declares a `model_alias`
// equal to the model name we send, so the request body picks the upstream.
// Provider keys are stored on the gateway (BYOK), so the key we send is a
// placeholder the plugin overwrites and the gateway needs no consumer auth —
// KONG_GATEWAY_URL carries the host and doubles as the enable switch.
export class KongGateway extends BaseGateway {
  name = 'Kong';

  constructor(gatewayUrl: string) {
    super('kong-byok', `${gatewayUrl.replace(/\/+$/, '')}/v1`);
  }
}
