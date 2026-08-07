import { BaseGateway } from './base.js';

export class RequestyGateway extends BaseGateway {
  name = 'Requesty';

  constructor(apiKey: string) {
    super(apiKey, 'https://router.requesty.ai/v1');
  }
}
