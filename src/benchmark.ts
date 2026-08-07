import { BenchmarkConfig, BenchmarkResult, Gateway } from './types.js';
import { getModelConfigurations } from './models.js';
import { PromptScenario } from './prompts.js';

export class BenchmarkRunner {
  private gateways: Gateway[];

  constructor(gateways: Gateway[]) {
    this.gateways = gateways;
  }

  async runBenchmark(
    scenarios: PromptScenario[],
    iterations: number,
    batchName: string,
    onProgress?: (_gateway: string, _provider: string, _modelTopLevelName: string, _scenario: string, _iteration: number, _api: string) => void,
    onResultComplete?: (_result: BenchmarkResult) => Promise<void>,
    providerFilter?: string,
    warmup?: boolean
  ): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];

    for (const gateway of this.gateways) {
      // Get all model configurations for this gateway (OpenAI + Anthropic)
      const modelConfigs = getModelConfigurations(gateway.name);

      for (const { provider, model, modelTopLevelName, api } of modelConfigs) {
        if (providerFilter && provider !== providerFilter) continue;
        const resolvedApi = api ?? gateway.defaultApi;
        if (!gateway.supportsApi(resolvedApi)) {
          console.warn(`Skipping ${gateway.name} [${resolvedApi}] for ${modelTopLevelName}: API not supported`);
          continue;
        }

        // Test each scenario for this gateway/model combination
        for (const scenario of scenarios) {
          for (let i = 0; i < iterations; i++) {
            if (onProgress) {
              onProgress(gateway.name, provider, modelTopLevelName, scenario.name, i + 1, resolvedApi);
            }

            // Build prompt string from messages for logging/storage
            const promptText = scenario.messages.map((m) => `${m.role}: ${m.content}`).join('\n');

            const config: BenchmarkConfig = {
              batchName,
              model,
              provider,
              modelTopLevelName,
              scenarioName: scenario.name,
              prompt: promptText,
              messages: scenario.messages,
              tools: scenario.tools,
              iterations,
              maxTokens: scenario.maxTokens,
              api: resolvedApi,
              warmup,
            };

            const result = await gateway.execute(config);
            results.push(result);

            // Call result completion callback if provided
            if (onResultComplete) {
              try {
                await onResultComplete(result);
              } catch (error) {
                console.error(`Failed to process result: ${error instanceof Error ? error.message : error}`);
              }
            }

            // Small delay between requests to avoid rate limiting
            await this.sleep(1000);
          }
        }
      }
    }

    return results;
  }

  async runSequential(
    scenarios: PromptScenario[],
    iterations: number,
    batchName: string,
    onProgress?: (_gateway: string, _provider: string, _modelTopLevelName: string, _scenario: string, _iteration: number, _api: string) => void,
    onResultComplete?: (_result: BenchmarkResult) => Promise<void>,
    providerFilter?: string,
    warmup?: boolean
  ): Promise<BenchmarkResult[]> {
    return this.runBenchmark(scenarios, iterations, batchName, onProgress, onResultComplete, providerFilter, warmup);
  }

  async runParallel(
    scenarios: PromptScenario[],
    iterations: number,
    batchName: string,
    onProgress?: (_gateway: string, _provider: string, _modelTopLevelName: string, _scenario: string, _iteration: number, _api: string) => void,
    onResultComplete?: (_result: BenchmarkResult) => Promise<void>,
    providerFilter?: string,
    warmup?: boolean
  ): Promise<BenchmarkResult[]> {
    const promises = this.gateways.map(async (gateway) => {
      const gatewayResults: BenchmarkResult[] = [];
      const modelConfigs = getModelConfigurations(gateway.name);

      for (const { provider, model, modelTopLevelName, api } of modelConfigs) {
        if (providerFilter && provider !== providerFilter) continue;
        const resolvedApi = api ?? gateway.defaultApi;
        if (!gateway.supportsApi(resolvedApi)) {
          console.warn(`Skipping ${gateway.name} [${resolvedApi}] for ${modelTopLevelName}: API not supported`);
          continue;
        }

        // Test each scenario for this gateway/model combination
        for (const scenario of scenarios) {
          for (let i = 0; i < iterations; i++) {
            if (onProgress) {
              onProgress(gateway.name, provider, modelTopLevelName, scenario.name, i + 1, resolvedApi);
            }

            // Build prompt string from messages for logging/storage
            const promptText = scenario.messages.map((m) => `${m.role}: ${m.content}`).join('\n');

            const config: BenchmarkConfig = {
              batchName,
              model,
              provider,
              modelTopLevelName,
              scenarioName: scenario.name,
              prompt: promptText,
              messages: scenario.messages,
              tools: scenario.tools,
              iterations,
              maxTokens: scenario.maxTokens,
              api: resolvedApi,
              warmup,
            };

            const result = await gateway.execute(config);
            gatewayResults.push(result);

            // Call result completion callback if provided
            if (onResultComplete) {
              try {
                await onResultComplete(result);
              } catch (error) {
                console.error(`Failed to process result: ${error instanceof Error ? error.message : error}`);
              }
            }

            await this.sleep(1000);
          }
        }
      }

      return gatewayResults;
    });

    const results = await Promise.all(promises);
    return results.flat();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getGateways(): Gateway[] {
    return this.gateways;
  }
}
