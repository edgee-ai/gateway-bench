import { BaseGateway } from './base.js';

export class OrqGateway extends BaseGateway {
  name = 'Orq.ai';

  constructor(apiKey: string) {
    super(apiKey, 'https://my.orq.ai/v3/router');
  }
}
