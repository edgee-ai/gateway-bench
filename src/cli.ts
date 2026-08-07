#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { table } from 'table';
import dotenv from 'dotenv';
import { BenchmarkRunner } from './benchmark.js';
import { getConfiguredGateways, getMissingRequiredGateways, getUnconfiguredGateways } from './gateways/index.js';
import { BigQueryWriter } from './bigquery.js';
import { BenchmarkResult } from './types.js';
import { loadModelsConfig, getModelConfigurations } from './models.js';
import { getClientLocationInfo } from './utils/location.js';
import { getPromptScenarios } from './prompts.js';
import { ChunkSample } from './types.js';
import {
  AnalyticsReader,
  Dimension,
  Metric,
  PairedRow,
  RankFilters,
  RankRow,
  defaultWindow,
  normalizeGroupBy,
  parseDimensions,
  parseMetric,
} from './analytics.js';

// Load .env file if it exists, environment variables take precedence
dotenv.config({ override: false });

const program = new Command();

program
  .name('gateway-bench')
  .description('Benchmark AI Gateway performance')
  .version('1.0.0');

program
  .command('run')
  .description('Run benchmarks on configured gateways (tests all models from models.json)')
  .option('-p, --prompt <prompt>', 'Legacy: custom prompt to use (creates custom scenario)', '')
  .option('-i, --iterations <number>', 'Number of iterations per gateway/model', process.env.BENCHMARK_ITERATIONS || '1')
  .option('-g, --gateway <gateways>', 'Run only specific gateway(s) (comma-separated)', '')
  .option('-s, --scenario <scenarios>', 'Run only specific scenario(s) (comma-separated): simple, large-context, complex-tools', '')
  .option('-b, --batch-name <batchName>', 'Batch name to use', generateBatchName())
  .option('--parallel', 'Run gateways in parallel')
  .option('--no-bigquery', 'Skip BigQuery upload')
  .option('--max-tokens <number>', 'Max tokens to generate (only used with --prompt)', '3000')
  .option('--provider <provider>', 'Test only the given provider (openai or anthropic)', '')
  .option('--no-warmup', 'Disable the unmeasured warm-up ping sent before each request')
  .action(async (options) => {
    console.log(chalk.bold.cyan('\n🚀 Gateway Benchmark Tool\n'));

    // Check for required gateways
    const missingRequired = getMissingRequiredGateways();
    if (missingRequired.length > 0) {
      console.error(chalk.red('❌ Missing required API keys for baseline comparison:'));
      missingRequired.forEach((config) => {
        console.error(chalk.red(`   • ${config.envKey} (${config.name})`));
      });
      console.error(chalk.yellow('\nThese providers are required for accurate baseline comparison.'));
      console.error(chalk.gray('Please add them to your .env file.\n'));
      process.exit(1);
    }

    const batchName = options.batchName;
    console.log(chalk.magentaBright(`Batch name: ${batchName}`));
    console.log();

    // Get configured gateways
    let gateways = getConfiguredGateways();

    if (gateways.length === 0) {
      console.error(chalk.red('❌ No gateways configured. Please set API keys in .env file.'));
      process.exit(1);
    }

    // Filter by gateway if specified
    if (options.gateway && options.gateway !== '') {
      const requestedGateways = options.gateway.split(',').map((g: string) => g.trim());
      const filteredGateways = gateways.filter((gw) =>
        requestedGateways.some((name: string) =>
          gw.name.toLowerCase() === name.toLowerCase()
        )
      );

      // Check if any requested gateways were not found
      const foundGatewayNames = filteredGateways.map((gw) => gw.name.toLowerCase());
      const notFound = requestedGateways.filter((name: string) =>
        !foundGatewayNames.includes(name.toLowerCase())
      );

      if (notFound.length > 0) {
        gateways.forEach((gw) => console.log(chalk.yellow(`  • ${gw.name}`)));
        process.exit(1);
      }

      if (filteredGateways.length === 0) {
        console.error(chalk.red('❌ No matching gateways found.'));
        process.exit(1);
      }

      gateways = filteredGateways;
      console.log(chalk.gray(`Selected ${gateways.length} gateway(s):`));
      gateways.forEach((gw) => console.log(chalk.gray(`  • ${gw.name}`)));
    } else {
      console.log(chalk.gray(`Found ${gateways.length} configured gateway(s):`));
      gateways.forEach((gw) => console.log(chalk.gray(`  • ${gw.name}`)));

      // Show skipped gateways only when running all
      const unconfigured = getUnconfiguredGateways();
      if (unconfigured.length > 0) {
        console.log(chalk.dim(`\nSkipped ${unconfigured.length} gateway(s) (API key not set):`));
        unconfigured.forEach((config) => console.log(chalk.dim(`  • ${config.name}`)));
      }
    }
    console.log();

    // Load models configuration
    const modelsConfig = loadModelsConfig();

    // Load prompt scenarios
    let scenarios = getPromptScenarios();

    // Filter by scenario if specified
    if (options.scenario && options.scenario !== '') {
      const requestedScenarios = options.scenario.split(',').map((s: string) => s.trim());
      const filteredScenarios = scenarios.filter((scenario) =>
        requestedScenarios.some((name: string) =>
          scenario.name.toLowerCase() === name.toLowerCase()
        )
      );

      if (filteredScenarios.length === 0) {
        console.error(chalk.red('❌ No matching scenarios found.'));
        console.log(chalk.yellow('\nAvailable scenarios:'));
        scenarios.forEach((s) => console.log(chalk.yellow(`  • ${s.name} - ${s.description}`)));
        process.exit(1);
      }

      scenarios = filteredScenarios;
    }

    // Override with legacy custom prompt if provided
    if (options.prompt && options.prompt !== '') {
      const maxTokens = parseInt(options.maxTokens);
      scenarios = [{
        name: 'custom',
        description: 'Custom prompt from CLI',
        maxTokens,
        messages: [{ role: 'user' as const, content: options.prompt }],
      }];
    }

    // Create benchmark runner
    const runner = new BenchmarkRunner(gateways);
    const iterations = parseInt(options.iterations);

    // Fetch client location info
    const locationSpinner = ora('Fetching client location info...').start();
    const clientInfo = await getClientLocationInfo();
    locationSpinner.succeed(chalk.green('Client location fetched'));

    console.log(chalk.bold('\nClient Information:'));
    console.log(chalk.gray(`  Country: ${clientInfo.country_code}`));
    console.log(chalk.gray(`  Continent: ${clientInfo.continent}`));
    console.log(chalk.gray(`  Connection: ${clientInfo.conn_type} (${clientInfo.conn_speed})`));
    console.log(chalk.gray(`  Proxy: ${clientInfo.proxy_type} - ${clientInfo.proxy_description}`));
    console.log(chalk.gray(`  AS: ${clientInfo.as_name}`));
    if (clientInfo.city && clientInfo.region) {
      console.log(chalk.gray(`  Location: ${clientInfo.city}, ${clientInfo.region}`));
    }
    if (clientInfo.fargate_pop_region) {
      console.log(chalk.gray(`  Edgee Pop: ${clientInfo.fargate_pop_region}`));
    }

    console.log(chalk.bold('\nConfiguration:'));
    console.log(chalk.gray(`  Scenarios: ${scenarios.map((s) => s.name).join(', ')}`));
    console.log(chalk.gray(`  Iterations: ${iterations} per gateway/model/scenario`));
    console.log(chalk.gray(`  Mode: ${options.parallel ? 'Parallel' : 'Sequential'}`));
    console.log(chalk.gray(`  Warm-up: ${options.warmup ? 'Enabled (unmeasured ping before each request)' : 'Disabled'}`));
    console.log(chalk.gray(`  Bigquery: ${options.bigquery ? 'Enabled' : 'Disabled'}`));
    console.log(chalk.gray('\n  Scenarios:'));
    for (const scenario of scenarios) {
      console.log(chalk.gray(`    • ${scenario.name}: ${scenario.description} (max ${scenario.maxTokens} tokens)`));
    }
    console.log(chalk.gray('\n  Models (from models.json):'));
    for (const provider of modelsConfig.providers) {
      const modelNames = provider.models.map((m) => m.name).join(', ');
      console.log(chalk.gray(`    ${provider.name}: ${modelNames}`));
    }
    console.log();

    // Initialize BigQuery writer before benchmarks start
    let bigqueryWriter: BigQueryWriter | null = null;
    let bigqueryInsertCount = 0;
    let bigqueryErrorCount = 0;

    if (options.bigquery) {
      try {
        console.log(chalk.gray('Initializing BigQuery writer...'));
        bigqueryWriter = await BigQueryWriter.createFromEnv();
      } catch (error) {
        console.error(chalk.red('✗ Failed to initialize BigQuery:'));
        console.error(chalk.red(`  Error: ${error instanceof Error ? error.message : error}`));
        console.log(chalk.yellow('⚠️  Continuing without BigQuery...\n'));
      }
    }

    const spinner = ora('Running benchmarks...').start();
    let results: BenchmarkResult[] = [];

    // Callback to insert each result immediately into BigQuery
    const onResultComplete = async (result: BenchmarkResult) => {
      if (bigqueryWriter) {
        try {
          await bigqueryWriter.writeResults([result]);
          bigqueryInsertCount++;
        } catch (error) {
          bigqueryErrorCount++;
          console.error(chalk.red(`\n✗ Failed to insert result for ${result.gateway} [${result.provider}]:`));
          console.error(chalk.red(`  ${error instanceof Error ? error.message : error}`));
        }
      }
    };

    try {
      const providerFilter = options.provider || undefined;
      const warmup = !!options.warmup;
      const allResults = options.parallel
        ? await runner.runParallel(scenarios, iterations, batchName, (gateway, provider, modelTopLevelName, scenario, iteration, api) => {
            spinner.text = `Testing ${gateway} [${provider}/${modelTopLevelName}] [${api}] [${scenario}] (${iteration}/${iterations})...`;
          }, onResultComplete, providerFilter, warmup)
        : await runner.runSequential(scenarios, iterations, batchName, (gateway, provider, modelTopLevelName, scenario, iteration, api) => {
            spinner.text = `Testing ${gateway} [${provider}/${modelTopLevelName}] [${api}] [${scenario}] (${iteration}/${iterations})...`;
          }, onResultComplete, providerFilter, warmup);

      results = allResults;
      spinner.succeed(chalk.green(`Completed ${results.length} benchmark runs`));
    } catch (error) {
      spinner.fail(chalk.red('Benchmark failed'));
      console.error(error);
      process.exit(1);
    }

    // Display results
    displayResults(results);

    if (options.bigquery && (bigqueryInsertCount > 0 || bigqueryErrorCount > 0)) {
      console.log(chalk.gray(`  BigQuery: ${bigqueryInsertCount} inserted${bigqueryErrorCount > 0 ? `, ${bigqueryErrorCount} failed` : ''}`));
    }
    console.log(chalk.bold.green('\n✨ Benchmark complete!\n'));
  });

program
  .command('list')
  .description('List available and configured gateways')
  .action(() => {
    console.log(chalk.bold.cyan('\n📋 Gateway Status\n'));

    import('./gateways/index.js').then(({ AVAILABLE_GATEWAYS }) => {
      AVAILABLE_GATEWAYS.forEach((config) => {
        const isConfigured = !!process.env[config.envKey];
        const status = isConfigured ? chalk.green('✓ Configured') : chalk.gray('✗ Not configured');
        const requiredBadge = config.required ? chalk.yellow('[REQUIRED]') : '';
        console.log(`${status} ${config.name} ${requiredBadge}`);
      });
      console.log();
    });
  });

program
  .command('scenarios')
  .description('List available prompt scenarios')
  .action(() => {
    console.log(chalk.bold.cyan('\n📝 Available Prompt Scenarios\n'));

    const scenarios = getPromptScenarios();
    scenarios.forEach((scenario) => {
      console.log(chalk.bold.green(`• ${scenario.name}`));
      console.log(chalk.gray(`  Description: ${scenario.description}`));
      console.log(chalk.gray(`  Max Tokens: ${scenario.maxTokens}`));
      console.log(chalk.gray(`  Messages: ${scenario.messages.length}`));
      if (scenario.tools && scenario.tools.length > 0) {
        console.log(chalk.gray(`  Tools: ${scenario.tools.length} available`));
      }
      console.log();
    });
  });

function generateBatchName(): string {
  return `batch-${Date.now()}`;
}

function displayResults(results: BenchmarkResult[]) {
  console.log(chalk.bold('\n📊 Results Summary:\n'));

  // Group by gateway + provider + model + api (one row per method)
  const groupedResults = results.reduce((acc, result) => {
    const key = `${result.gateway} [${result.provider}] ${result.modelTopLevelName} (${result.api})`;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(result);
    return acc;
  }, {} as Record<string, BenchmarkResult[]>);

  const summaryData: string[][] = [
    ['Gateway [Provider]', 'Model', 'API', 'TTFT (ms)', 'Total Time (ms)', 'Success Rate'],
  ];

  // Average TTFT for a group; failed groups (no successes) sort last.
  const avgTtft = (group: BenchmarkResult[]): number => {
    const ok = group.filter((r) => r.success);
    if (ok.length === 0) return Infinity;
    return ok.reduce((sum, r) => sum + r.ttft, 0) / ok.length;
  };

  // Label the transport: messages = Anthropic API, chat = OpenAI Chat Completions.
  const apiLabel = (api: BenchmarkResult['api']): string => (api === 'anthropic' ? 'messages' : 'chat');

  Object.entries(groupedResults)
    .sort(([, a], [, b]) => {
      const ma = (a[0]!.modelTopLevelName ?? a[0]!.model ?? '');
      const mb = (b[0]!.modelTopLevelName ?? b[0]!.model ?? '');
      const mc = ma.localeCompare(mb);
      if (mc !== 0) return mc;
      const tc = avgTtft(a) - avgTtft(b);
      if (tc !== 0) return tc;
      return a[0]!.gateway.localeCompare(b[0]!.gateway);
    })
    .forEach(([_, gatewayResults]) => {
    const successfulResults = gatewayResults.filter((r) => r.success);
    const successRate = (successfulResults.length / gatewayResults.length) * 100;
    const first = gatewayResults[0]!;
    const gatewayLabel = `${first.gateway} [${first.provider}]`;
    const modelLabel = first.modelTopLevelName ?? first.model ?? 'N/A';
    const apiCol = apiLabel(first.api);

    if (successfulResults.length > 0) {
      const avgTTFT = successfulResults.reduce((sum, r) => sum + r.ttft, 0) / successfulResults.length;
      const avgTotalTime = successfulResults.reduce((sum, r) => sum + r.totalTime, 0) / successfulResults.length;

      summaryData.push([
        gatewayLabel,
        modelLabel,
        apiCol,
        avgTTFT.toFixed(0),
        avgTotalTime.toFixed(0),
        `${successRate.toFixed(0)}%`,
      ]);
    } else {
      summaryData.push([
        gatewayLabel,
        modelLabel,
        apiCol,
        chalk.red('Failed'),
        chalk.red('Failed'),
        `${successRate.toFixed(0)}%`,
      ]);
    }
  });

  console.log(table(summaryData));

  // Show errors if any
  const errors = results.filter((r) => !r.success);
  if (errors.length > 0) {
    console.log(chalk.bold.red('\n❌ Errors:\n'));
    errors.forEach((error) => {
      const modelLabel = error.modelTopLevelName ?? error.model;
      console.log(chalk.red(`${error.gateway} [${error.provider}] (${modelLabel}): ${error.error}`));
    });
    console.log();
  }
}

// Render a captured chunk log: one line per chunk, marking the chunk that the
// TTFT metric is pinned to and flagging suspicious empty/whitespace chunks that
// arrive *before* it (a sign the gateway may be inflating its TTFT).
function renderChunkLog(samples: ChunkSample[], ttft: number) {
  if (samples.length === 0) {
    console.log(chalk.dim('    (no chunks captured)'));
    return;
  }

  const ttftIndex = samples.find((s) => s.countsAsTtft)?.index ?? -1;

  for (const s of samples) {
    const isPreTtftEmpty =
      (ttftIndex === -1 || s.index < ttftIndex) && s.text.trim() === '';

    let marker = '  ';
    if (s.countsAsTtft) marker = chalk.green('▶ '); // chunk the TTFT is measured on
    else if (isPreTtftEmpty) marker = chalk.yellow('⚠ '); // early empty/whitespace chunk

    const at = `${String(s.atMs).padStart(5)}ms`;
    const kind = s.kind ? chalk.cyan(s.kind.padEnd(20)) : '';
    // JSON.stringify makes empty strings, spaces and newlines visible.
    const textRepr = chalk.white(JSON.stringify(s.text));
    const flag = s.countsAsTtft
      ? chalk.green('  ← TTFT')
      : isPreTtftEmpty
        ? chalk.yellow('  ← empty chunk before first token')
        : '';

    console.log(`    ${marker}#${s.index} ${chalk.gray(at)}  ${kind}text=${textRepr}${flag}`);
    console.log(chalk.dim(`        raw: ${s.raw}`));
  }

  console.log(chalk.gray(`    → measured TTFT: ${ttft}ms`));
}

program
  .command('inspect')
  .description('Inspect the first streamed chunks of each gateway to verify how TTFT is produced')
  .option('-g, --gateway <gateways>', 'Inspect only specific gateway(s) (comma-separated)', '')
  .option('-s, --scenario <scenario>', 'Scenario to use', 'simple')
  .option('--provider <provider>', 'Filter by provider (openai or anthropic)', '')
  .option('-n, --chunks <number>', 'Number of leading chunks to capture per request', '6')
  .action(async (options) => {
    console.log(chalk.bold.cyan('\n🔬 Gateway Chunk Inspector\n'));
    console.log(chalk.dim('Legend: ') + chalk.green('▶ TTFT chunk') + chalk.dim('   ') + chalk.yellow('⚠ empty/whitespace chunk before first token') + '\n');

    let gateways = getConfiguredGateways();
    if (gateways.length === 0) {
      console.error(chalk.red('❌ No gateways configured. Please set API keys in .env file.'));
      process.exit(1);
    }

    if (options.gateway && options.gateway !== '') {
      const requested = options.gateway.split(',').map((g: string) => g.trim().toLowerCase());
      gateways = gateways.filter((gw) => requested.includes(gw.name.toLowerCase()));
      if (gateways.length === 0) {
        console.error(chalk.red('❌ No matching gateways found.'));
        process.exit(1);
      }
    }

    const scenario = getPromptScenarios().find((s) => s.name === options.scenario);
    if (!scenario) {
      console.error(chalk.red(`❌ Scenario "${options.scenario}" not found.`));
      process.exit(1);
    }

    const chunksToCapture = parseInt(options.chunks) || 6;
    const promptText = scenario.messages.map((m) => `${m.role}: ${m.content}`).join('\n');

    for (const gateway of gateways) {
      const modelConfigs = getModelConfigurations(gateway.name);
      for (const { provider, model, modelTopLevelName, api } of modelConfigs) {
        if (options.provider && provider !== options.provider) continue;
        const resolvedApi = api ?? gateway.defaultApi;
        if (!gateway.supportsApi(resolvedApi)) continue;

        const apiLabel = resolvedApi === 'anthropic' ? 'messages' : 'chat';
        console.log(
          chalk.bold(`\n━━ ${gateway.name} `) +
            chalk.gray(`[${provider}/${modelTopLevelName}] `) +
            chalk.magenta(`(${apiLabel})`) +
            chalk.dim(` model=${model}`),
        );

        let captured: ChunkSample[] = [];
        const result = await gateway.execute({
          batchName: 'inspect',
          model,
          provider,
          modelTopLevelName,
          scenarioName: scenario.name,
          prompt: promptText,
          messages: scenario.messages,
          tools: scenario.tools,
          iterations: 1,
          maxTokens: scenario.maxTokens,
          api: resolvedApi,
          debugChunks: chunksToCapture,
          onChunkLog: (samples) => {
            captured = samples;
          },
        });

        if (!result.success) {
          console.log(chalk.red(`    ✗ request failed: ${result.error}`));
          continue;
        }

        renderChunkLog(captured, result.ttft);
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    console.log(chalk.bold.green('\n✨ Inspection complete!\n'));
  });

// ── rank ──────────────────────────────────────────────────────────────────────
// Ranking is deliberately opinionated. See the guardrails in renderGrouped():
// percentiles are computed on successful requests only, gateways entered the
// benchmark on different dates, and the two models differ by ~370ms of median
// TTFT — each of those silently inverts the ranking if left unhandled.

const SUCCESS_FLOOR = 0.95; // below this, percentiles are survivorship-biased
const P95_MIN_N = 100; // a p95 needs more samples than a p50 to mean anything

type OutputFormat = 'table' | 'md' | 'csv' | 'json';

function splitList(value: string): string[] | undefined {
  if (!value || value.trim() === '') return undefined;
  return value.split(',').map((s) => s.trim()).filter((s) => s !== '');
}

function fmtMs(v: number | null): string {
  return v === null ? '—' : String(Math.round(v));
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function fmtDelta(v: number | null): string {
  if (v === null) return '—';
  const r = Math.round(v);
  return r > 0 ? `+${r}` : String(r);
}

// A row is rankable when it has enough samples AND a success rate that makes its
// percentiles trustworthy. Everything else is still shown, but below the ranking
// and without a position, so it can never be quoted as "the fastest gateway".
function isRankable(row: RankRow, minN: number): boolean {
  return row.n >= minN && row.successRate >= SUCCESS_FLOOR && row.ttftP50 !== null;
}

function groupByKey<T>(rows: T[], key: (_r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(r);
  }
  return out;
}

function dimLabel(row: { continent?: string; country?: string }, dims: Dimension[]): string[] {
  const cells: string[] = [];
  if (dims.includes('continent')) cells.push(row.continent || '—');
  if (dims.includes('country')) cells.push(row.country || '—');
  return cells;
}

function dimHeaders(dims: Dimension[]): string[] {
  const cells: string[] = [];
  if (dims.includes('continent')) cells.push('Continent');
  if (dims.includes('country')) cells.push('Country');
  return cells;
}

function emit(rows: string[][], format: OutputFormat, title: string) {
  if (format === 'md') {
    console.log(`\n### ${title}\n`);
    const [header, ...body] = rows;
    console.log(`| ${header!.join(' | ')} |`);
    console.log(`| ${header!.map(() => '---').join(' | ')} |`);
    body.forEach((r) => console.log(`| ${r.join(' | ')} |`));
    return;
  }
  if (format === 'csv') {
    console.log(`# ${title}`);
    rows.forEach((r) => console.log(r.map((c) => (c.includes(',') ? `"${c}"` : c)).join(',')));
    return;
  }
  console.log(chalk.bold(`\n${title}`));
  console.log(table(rows));
}

function renderGrouped(rows: RankRow[], dims: Dimension[], minN: number, format: OutputFormat) {
  const perModel = groupByKey(rows, (r) => r.model);
  // Rank restarts inside each geographic cell: comparing an EU row against an NA
  // row would rank regions, not gateways.
  const cellKey = (r: RankRow) => dimLabel(r, dims).join('|');

  for (const [model, modelRows] of perModel) {
    const header = ['#', 'Gateway', ...dimHeaders(dims), 'n', 'Success', 'TTFT p50', 'p90', 'p95', 'TTFB p50', 'Total p50'];
    const body: string[][] = [];

    for (const [, cellRows] of groupByKey(modelRows, cellKey)) {
      const rankable = cellRows.filter((r) => isRankable(r, minN)).sort((a, b) => a.ttftP50! - b.ttftP50!);
      const excluded = cellRows.filter((r) => !isRankable(r, minN)).sort((a, b) => b.n - a.n);

      rankable.forEach((r, i) => {
        body.push([
          String(i + 1),
          r.gateway,
          ...dimLabel(r, dims),
          String(r.n),
          fmtPct(r.successRate),
          fmtMs(r.ttftP50),
          fmtMs(r.ttftP90),
          r.n >= P95_MIN_N ? fmtMs(r.ttftP95) : '—',
          fmtMs(r.ttfbP50),
          fmtMs(r.totalP50),
        ]);
      });

      excluded.forEach((r) => {
        const why = r.n < minN ? `n<${minN}` : `success<${Math.round(SUCCESS_FLOOR * 100)}%`;
        const thin = r.n < minN;
        body.push([
          '⚠',
          `${r.gateway} (${why})`,
          ...dimLabel(r, dims),
          String(r.n),
          fmtPct(r.successRate),
          thin ? '—' : fmtMs(r.ttftP50),
          thin ? '—' : fmtMs(r.ttftP90),
          '—',
          thin ? '—' : fmtMs(r.ttfbP50),
          thin ? '—' : fmtMs(r.totalP50),
        ]);
      });
    }

    emit([header, ...body], format, `Model: ${model}`);
  }
}

function renderPaired(rows: PairedRow[], dims: Dimension[], baseline: string, minN: number, metric: Metric, format: OutputFormat) {
  const perModel = groupByKey(rows, (r) => r.model);
  const cellKey = (r: PairedRow) => dimLabel(r, dims).join('|');

  for (const [model, modelRows] of perModel) {
    const header = [
      'Gateway',
      ...dimHeaders(dims),
      'paired n',
      `Δ ${metric} p50`,
      'Δ p90',
      `${baseline} wins`,
    ];
    const body: string[][] = [];

    // Sorted within each geographic cell, for the same reason as renderGrouped.
    for (const [, cellRows] of groupByKey(modelRows, cellKey)) {
      const usable = cellRows.filter((r) => r.pairedN >= minN).sort((a, b) => (b.deltaP50 ?? 0) - (a.deltaP50 ?? 0));
      const thin = cellRows.filter((r) => r.pairedN < minN);

      usable.forEach((r) => {
        body.push([
          r.gateway,
          ...dimLabel(r, dims),
          String(r.pairedN),
          fmtDelta(r.deltaP50),
          fmtDelta(r.deltaP90),
          fmtPct(r.baselineWinRate),
        ]);
      });
      thin.forEach((r) => {
        body.push([`${r.gateway} (n<${minN})`, ...dimLabel(r, dims), String(r.pairedN), '—', '—', '—']);
      });
    }

    emit([header, ...body], format, `Model: ${model} — head-to-head vs ${baseline} (positive Δ = slower than ${baseline})`);
  }
}

program
  .command('rank')
  .description('Rank gateway performance from BigQuery results')
  .option('--from <date>', 'Start date YYYY-MM-DD (default: 30 days ago)', '')
  .option('--to <date>', 'End date YYYY-MM-DD (default: today)', '')
  .option('-g, --gateway <list>', 'Gateways, comma-separated (default: all)', '')
  .option('-m, --model <list>', 'Models, comma-separated (default: all, never merged)', '')
  .option('--continent <list>', 'Continents, comma-separated (EU,NA,AS,SA,OC,AF)', '')
  .option('--country <list>', 'Country codes, comma-separated', '')
  .option('--group-by <dims>', 'Extra dimensions: continent, country (model always applied)', '')
  .option('--vs <gateway>', 'Paired head-to-head against this baseline gateway', '')
  .option('--metric <metric>', 'ttft (default) | ttfb | total_time', 'ttft')
  .option('--min-n <number>', 'Minimum samples before a cell is shown', '30')
  .option('-s, --scenario <name>', 'Scenario filter', 'simple')
  .option('--api <api>', 'Transport filter: openai | anthropic', '')
  .option('--format <format>', 'table (default) | md | csv | json', 'table')
  .option('--no-common-window', 'Do not narrow the window to the range all gateways share')
  .action(async (options) => {
    const format = options.format as OutputFormat;
    if (!['table', 'md', 'csv', 'json'].includes(format)) {
      console.error(chalk.red(`❌ Unknown format "${options.format}". Expected: table, md, csv, json`));
      process.exit(1);
    }

    let metric: Metric;
    let dims: Dimension[];
    try {
      metric = parseMetric(options.metric);
      dims = normalizeGroupBy(parseDimensions(options.groupBy));
    } catch (error) {
      console.error(chalk.red(`❌ ${error instanceof Error ? error.message : error}`));
      process.exit(1);
      return;
    }

    const fallback = defaultWindow(30);
    const filters: RankFilters = {
      from: options.from || fallback.from,
      to: options.to || fallback.to,
      gateways: splitList(options.gateway),
      models: splitList(options.model),
      continents: splitList(options.continent),
      countries: splitList(options.country),
      scenario: options.scenario || undefined,
      api: options.api || undefined,
      groupBy: dims,
      minN: parseInt(options.minN, 10) || 30,
    };

    let reader: AnalyticsReader;
    try {
      reader = AnalyticsReader.createFromEnv();
    } catch (error) {
      console.error(chalk.red(`❌ ${error instanceof Error ? error.message : error}`));
      process.exit(1);
      return;
    }

    const human = format === 'table';
    const spinner = human ? ora('Querying BigQuery...').start() : null;

    try {
      const window = await reader.commonWindow(filters);
      const applied = { ...filters };
      let narrowedNote = '';

      // Gateways joined the benchmark on different dates. Comparing a seven-week
      // percentile against a five-day one compares periods, not gateways.
      if (options.commonWindow && window.perGateway.length > 1 && window.narrowed) {
        applied.from = window.from;
        applied.to = window.to;
        const latest = window.perGateway.reduce((a, g) => (g.from > a.from ? g : a), window.perGateway[0]!);
        narrowedNote = `narrowed to the range shared by all selected gateways (${latest.gateway} joined ${latest.from})`;
      }

      const grouped = options.vs ? null : await reader.rankGrouped(applied);
      const paired = options.vs ? await reader.rankPaired(applied, options.vs, metric) : null;
      spinner?.succeed(chalk.green('Query complete'));

      if (format === 'json') {
        console.log(
          JSON.stringify(
            {
              window: { from: applied.from, to: applied.to, narrowed: applied.from !== filters.from || applied.to !== filters.to },
              filters: { ...filters, groupBy: dims },
              metric,
              baseline: options.vs || null,
              coverage: window.perGateway,
              grouped,
              paired,
            },
            null,
            2,
          ),
        );
        return;
      }

      const headerLines = [
        `Window: ${applied.from} → ${applied.to}${narrowedNote ? ` (${narrowedNote})` : ''}`,
        `Scenario: ${filters.scenario ?? 'all'} · min-n: ${filters.minN} · metric: ${metric}`,
        'Percentiles cover successful requests only — read them next to the Success column.',
      ];
      if (human) {
        console.log(chalk.bold.cyan('\n📊 Gateway Performance Ranking\n'));
        headerLines.forEach((l) => console.log(chalk.gray(`  ${l}`)));
      } else {
        headerLines.forEach((l) => console.log(format === 'md' ? `> ${l}` : `# ${l}`));
      }

      if (paired) {
        if (paired.length === 0) {
          console.error(chalk.yellow(`\n⚠️  No paired rows. Is "${options.vs}" present in these batches?`));
          return;
        }
        renderPaired(paired, dims, options.vs, filters.minN, metric, format);
      } else if (grouped) {
        if (grouped.length === 0) {
          console.error(chalk.yellow('\n⚠️  No rows matched these filters.'));
          return;
        }
        renderGrouped(grouped, dims, filters.minN, format);
      }
    } catch (error) {
      spinner?.fail(chalk.red('Query failed'));
      console.error(chalk.red(`  ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

program.parse();
