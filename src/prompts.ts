import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface PromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PromptTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface PromptScenario {
  name: string;
  description: string;
  maxTokens: number;
  messages: PromptMessage[];
  tools?: PromptTool[];
}

interface PromptsConfig {
  scenarios: PromptScenario[];
}

let cachedConfig: PromptsConfig | null = null;

export function loadPromptsConfig(): PromptsConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = join(__dirname, '..', 'prompts.json');
  const configContent = readFileSync(configPath, 'utf-8');
  cachedConfig = JSON.parse(configContent);
  return cachedConfig as PromptsConfig;
}

export function getPromptScenarios(): PromptScenario[] {
  const config = loadPromptsConfig();
  return config.scenarios;
}

export function getPromptScenario(name: string): PromptScenario | undefined {
  const scenarios = getPromptScenarios();
  return scenarios.find((s) => s.name === name);
}

export function getPromptScenarioNames(): string[] {
  const scenarios = getPromptScenarios();
  return scenarios.map((s) => s.name);
}

// Legacy: convert single prompt string to scenario format
export function createLegacyScenario(prompt: string, maxTokens: number): PromptScenario {
  return {
    name: 'custom',
    description: 'Custom prompt from CLI',
    maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
}
