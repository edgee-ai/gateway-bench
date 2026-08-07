import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ApiMethod } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// A per-gateway model entry. A bare string keeps the gateway's default API;
// the object form pins the transport; an array runs several methods for one model.
export type GatewayEntryObject = { model: string; api?: ApiMethod };
export type GatewayEntry = string | GatewayEntryObject | Array<string | GatewayEntryObject>;

export interface ModelGateways {
  name: string;
  gateways: Record<string, GatewayEntry>;
}

export interface ProviderConfig {
  name: string;
  models: ModelGateways[];
}

export interface ModelsConfiguration {
  providers: ProviderConfig[];
}

let cachedConfig: ModelsConfiguration | null = null;

export function loadModelsConfig(): ModelsConfiguration {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = path.join(__dirname, '..', 'models.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(`Models configuration file not found at: ${configPath}`);
  }

  const content = fs.readFileSync(configPath, 'utf-8');
  cachedConfig = JSON.parse(content);

  return cachedConfig!;
}

// Normalize one gateway entry into zero or more { model, api } pairs.
// Empty / missing model strings are skipped (a gateway that doesn't run this model).
function normalizeEntry(entry: GatewayEntry | undefined): Array<{ model: string; api?: ApiMethod }> {
  if (entry === undefined || entry === null) {
    return [];
  }
  const items = Array.isArray(entry) ? entry : [entry];
  const result: Array<{ model: string; api?: ApiMethod }> = [];
  for (const item of items) {
    const model = typeof item === 'string' ? item : item.model;
    const api = typeof item === 'string' ? undefined : item.api;
    if (typeof model === 'string' && model.trim() !== '') {
      result.push({ model, api });
    }
  }
  return result;
}

/**
 * Returns all (provider, model, api) configurations for a gateway: one entry per provider
 * and per model (and per pinned API method) in models.json. `api` is undefined when the
 * entry doesn't pin one — the runner resolves it to the gateway's defaultApi.
 */
export function getModelConfigurations(
  gatewayName: string,
): Array<{ provider: string; model: string; modelTopLevelName: string; api?: ApiMethod }> {
  const config = loadModelsConfig();
  const results: Array<{ provider: string; model: string; modelTopLevelName: string; api?: ApiMethod }> = [];

  const providers = Array.isArray(config.providers) ? config.providers : [];
  for (const provider of providers) {
    const models = Array.isArray(provider.models) ? provider.models : [];
    for (const modelConfig of models) {
      const modelTopLevelName = modelConfig.name;
      const gateways = modelConfig.gateways && typeof modelConfig.gateways === 'object' ? modelConfig.gateways : {};
      for (const { model, api } of normalizeEntry(gateways[gatewayName])) {
        results.push({ provider: provider.name, model, modelTopLevelName, api });
      }
    }
  }

  return results;
}

