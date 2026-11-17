import { BaseGateway } from './base.js';

export class RequestyGateway extends BaseGateway {
  name = 'Requesty';

  constructor(apiKey: string) {
    super(apiKey, 'https://router.requesty.ai/v1', undefined, {
      baseURL: 'https://router.requesty.ai',
      authStyle: 'bearer',
    });
  }
}
