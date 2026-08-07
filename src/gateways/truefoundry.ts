import { BaseGateway } from './base.js';

export class TrueFoundryGateway extends BaseGateway {
  name = 'TrueFoundry';

  constructor(apiKey: string) {
    super(apiKey, 'https://gateway.truefoundry.ai');
  }
}