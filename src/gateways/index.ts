import { Gateway } from '../types.js';
import { OpenAIGateway } from './openai.js';
import { AnthropicGateway } from './anthropic.js';
import { EdgeeGateway } from './edgee.js';
import { OpenRouterGateway } from './openrouter.js';
import { OrqGateway } from './orq.js';
import { PortkeyGateway } from './portkey.js';
import { HeliconeGateway } from './helicone.js';
import { TrueFoundryGateway } from './truefoundry.js';
import { RequestyGateway } from './requesty.js';
import { VercelGateway } from './vercel.js';
import { CloudflareGateway } from './cloudflare.js';
import { KongGateway } from './kong.js';

export interface GatewayConfig {
  name: string;
  envKey: string;
  createGateway: (_apiKey: string) => Gateway;
  required?: boolean; // For baseline comparison providers
  customCheck?: () => boolean; // Custom validation logic instead of envKey check
}

export const AVAILABLE_GATEWAYS: GatewayConfig[] = [
  // Baseline providers (required for comparison)
  {
    name: 'OpenAI (Direct)',
    envKey: 'OPENAI_API_KEY',
    createGateway: (key) => new OpenAIGateway(key),
    required: true,
  },
  {
    name: 'Anthropic (Direct)',
    envKey: 'ANTHROPIC_API_KEY',
    createGateway: (key) => new AnthropicGateway(key),
    required: true,
  },

  // Gateway providers
  {
    name: 'Edgee',
    envKey: 'EDGEE_API_KEY',
    createGateway: (key) => new EdgeeGateway(key),
  },
  {
    name: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    createGateway: (key) => new OpenRouterGateway(key),
  },
  {
    name: 'Orq.ai',
    envKey: 'ORQ_API_KEY',
    createGateway: (key) => new OrqGateway(key),
  },
  {
    name: 'Portkey',
    envKey: 'PORTKEY_API_KEY',
    createGateway: (key) => new PortkeyGateway(key),
  },
  {
    name: 'Helicone',
    envKey: 'HELICONE_API_KEY',
    createGateway: (key) => new HeliconeGateway(key),
  },
  {
    name: 'TrueFoundry',
    envKey: 'TRUEFOUNDRY_API_KEY',
    createGateway: (key) => new TrueFoundryGateway(key),
  },
  {
    name: 'Requesty',
    envKey: 'REQUESTY_API_KEY',
    createGateway: (key) => new RequestyGateway(key),
  },
  {
    name: 'Vercel',
    envKey: 'VERCEL_API_KEY',
    createGateway: (key) => new VercelGateway(key),
  },
  {
    // Needs both the key and the account id addressing your own AI Gateway instance.
    name: 'Cloudflare',
    envKey: 'CLOUDFLARE_API_KEY',
    createGateway: (key) => new CloudflareGateway(key),
    customCheck: () =>
      !!process.env.CLOUDFLARE_API_KEY?.trim() && !!process.env.CLOUDFLARE_ACCOUNT_ID?.trim(),
  },
  {
    // Open gateway (provider keys held by Kong): the URL itself is the enable switch.
    name: 'Kong',
    envKey: 'KONG_GATEWAY_URL',
    createGateway: (url) => new KongGateway(url),
  },
];

export function getConfiguredGateways(): Gateway[] {
  const gateways = AVAILABLE_GATEWAYS.filter((config) => {
    // Use custom check if available, otherwise check envKey
    if (config.customCheck) {
      return config.customCheck();
    }
    const apiKey = process.env[config.envKey];
    // Filter out if API key is not set, empty, or only whitespace
    return apiKey && apiKey.trim().length > 0;
  }).map((config) => config.createGateway(process.env[config.envKey] || ''));

  return gateways;
}

export function getAvailableGatewayNames(): string[] {
  return AVAILABLE_GATEWAYS.filter((config) => {
    if (config.customCheck) {
      return config.customCheck();
    }
    const apiKey = process.env[config.envKey];
    return apiKey && apiKey.trim().length > 0;
  }).map((config) => config.name);
}

export function getUnconfiguredGateways(): GatewayConfig[] {
  return AVAILABLE_GATEWAYS.filter((config) => {
    if (config.required) return false; // Don't include required ones (handled separately)
    if (config.customCheck) {
      return !config.customCheck();
    }
    const apiKey = process.env[config.envKey];
    return !apiKey || apiKey.trim().length === 0;
  });
}

export function getRequiredGateways(): GatewayConfig[] {
  return AVAILABLE_GATEWAYS.filter((config) => config.required);
}

export function getMissingRequiredGateways(): GatewayConfig[] {
  return AVAILABLE_GATEWAYS.filter(
    (config) => config.required && !process.env[config.envKey]
  );
}
