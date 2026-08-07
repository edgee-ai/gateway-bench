import { BigQuery } from '@google-cloud/bigquery';

// Read-side counterpart of BigQueryWriter (src/bigquery.ts), which stays write-only.
// Same env vars, same credential handling.

export type Metric = 'ttft' | 'ttfb' | 'total_time';
export type Dimension = 'model' | 'continent' | 'country';

// Whitelist: the metric and grouping dimensions land in the SQL text (BigQuery
// can't bind identifiers), so they are validated here rather than interpolated raw.
const METRICS: Metric[] = ['ttft', 'ttfb', 'total_time'];
const DIMENSION_COLUMNS: Record<Dimension, string> = {
  model: 'model',
  continent: 'continent',
  country: 'country_code',
};

export interface RankFilters {
  from: string; // YYYY-MM-DD, always applied — the table is partitioned by DATE(timestamp)
  to: string;
  gateways?: string[];
  models?: string[];
  continents?: string[];
  countries?: string[];
  scenario?: string;
  api?: string;
  groupBy: Dimension[]; // 'model' is always present; see normalizeGroupBy
  minN: number;
}

export interface RankRow {
  gateway: string;
  model: string;
  continent?: string;
  country?: string;
  n: number;
  nOk: number;
  successRate: number;
  ttftP50: number | null;
  ttftP90: number | null;
  ttftP95: number | null;
  ttfbP50: number | null;
  totalP50: number | null;
}

export interface PairedRow {
  gateway: string;
  model: string;
  continent?: string;
  country?: string;
  pairedN: number;
  deltaP50: number | null;
  deltaP90: number | null;
  baselineWinRate: number;
}

export interface GatewayWindow {
  gateway: string;
  from: string;
  to: string;
  n: number;
}

export interface CommonWindow {
  from: string;
  to: string;
  narrowed: boolean; // true when the intersection is tighter than the requested window
  perGateway: GatewayWindow[];
}

interface QueryParams {
  [key: string]: string | string[] | number;
}

export class AnalyticsReader {
  private bigquery: BigQuery;
  private table: string;

  constructor(projectId: string, datasetId: string, tableId: string, email: string, privateKey: string) {
    this.bigquery = new BigQuery({
      projectId,
      credentials: { client_email: email, private_key: privateKey },
    });
    this.table = `\`${projectId}.${datasetId}.${tableId}\``;
  }

  static createFromEnv(): AnalyticsReader {
    const projectId = process.env.BIGQUERY_PROJECT_ID;
    const datasetId = process.env.BIGQUERY_DATASET_ID;
    const tableId = process.env.BIGQUERY_TABLE_ID;
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    let privateKey = process.env.GOOGLE_PRIVATE_KEY;

    if (!projectId || !datasetId || !tableId || !email || !privateKey) {
      throw new Error(
        'BigQuery is not configured. Required: BIGQUERY_PROJECT_ID, BIGQUERY_DATASET_ID, ' +
          'BIGQUERY_TABLE_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY.',
      );
    }

    privateKey = privateKey.replace(/\\n/g, '\n');
    return new AnalyticsReader(projectId, datasetId, tableId, email, privateKey);
  }

  // Filters shared by every query. `gatewayOverride` lets the paired query widen the
  // gateway list so the baseline survives a `--gateway` filter that excludes it.
  private buildWhere(f: RankFilters, params: QueryParams, gatewayOverride?: string[]): string {
    const clauses = ['DATE(timestamp) BETWEEN @from AND @to'];
    params.from = f.from;
    params.to = f.to;

    const gateways = gatewayOverride ?? f.gateways;
    if (gateways && gateways.length > 0) {
      clauses.push('gateway IN UNNEST(@gateways)');
      params.gateways = gateways;
    }
    if (f.models && f.models.length > 0) {
      clauses.push('model IN UNNEST(@models)');
      params.models = f.models;
    }
    if (f.continents && f.continents.length > 0) {
      clauses.push('continent IN UNNEST(@continents)');
      params.continents = f.continents;
    }
    if (f.countries && f.countries.length > 0) {
      clauses.push('country_code IN UNNEST(@countries)');
      params.countries = f.countries;
    }
    if (f.scenario) {
      clauses.push('scenario_name = @scenario');
      params.scenario = f.scenario;
    }
    if (f.api) {
      clauses.push('api = @api');
      params.api = f.api;
    }

    return clauses.join('\n    AND ');
  }

  private dimensionSelect(groupBy: Dimension[]): { select: string; group: string } {
    const cols = normalizeGroupBy(groupBy).map((d) => DIMENSION_COLUMNS[d]);
    return { select: cols.join(', '), group: cols.join(', ') };
  }

  private async run<T>(query: string, params: QueryParams): Promise<T[]> {
    const [rows] = await this.bigquery.query({ query, params });
    return rows as T[];
  }

  /**
   * Pooled percentiles per gateway and grouping dimension.
   * Percentiles are computed over successful rows only, which is why successRate
   * ships alongside — a gateway that fails most requests would otherwise look fast.
   */
  async rankGrouped(f: RankFilters): Promise<RankRow[]> {
    const params: QueryParams = {};
    const where = this.buildWhere(f, params);
    const dims = this.dimensionSelect(f.groupBy);

    const query = `
SELECT
  gateway,
  ${dims.select},
  COUNT(*) AS n,
  COUNTIF(success) AS n_ok,
  APPROX_QUANTILES(IF(success, ttft, NULL), 100)[SAFE_OFFSET(50)] AS ttft_p50,
  APPROX_QUANTILES(IF(success, ttft, NULL), 100)[SAFE_OFFSET(90)] AS ttft_p90,
  APPROX_QUANTILES(IF(success, ttft, NULL), 100)[SAFE_OFFSET(95)] AS ttft_p95,
  APPROX_QUANTILES(IF(success, ttfb, NULL), 100)[SAFE_OFFSET(50)] AS ttfb_p50,
  APPROX_QUANTILES(IF(success, total_time, NULL), 100)[SAFE_OFFSET(50)] AS total_p50
FROM ${this.table}
WHERE ${where}
GROUP BY gateway, ${dims.group}
ORDER BY ${dims.group}, ttft_p50`;

    const rows = await this.run<Record<string, unknown>>(query, params);
    return rows.map((r) => ({
      gateway: String(r.gateway),
      model: String(r.model),
      continent: r.continent === undefined ? undefined : String(r.continent ?? ''),
      country: r.country_code === undefined ? undefined : String(r.country_code ?? ''),
      n: num(r.n) ?? 0,
      nOk: num(r.n_ok) ?? 0,
      successRate: (num(r.n) ?? 0) === 0 ? 0 : (num(r.n_ok) ?? 0) / (num(r.n) ?? 1),
      ttftP50: num(r.ttft_p50),
      ttftP90: num(r.ttft_p90),
      ttftP95: num(r.ttft_p95),
      ttfbP50: num(r.ttfb_p50),
      totalP50: num(r.total_p50),
    }));
  }

  /**
   * Head-to-head against a baseline gateway, paired within (batch_name, model).
   * One batch = one Cloud Run region, one moment, one scenario — pairing there
   * cancels out geography, time of day and model, which pooled percentiles cannot.
   * A positive delta means the gateway was slower than the baseline.
   */
  async rankPaired(f: RankFilters, baseline: string, metric: Metric = 'ttft'): Promise<PairedRow[]> {
    if (!METRICS.includes(metric)) {
      throw new Error(`Unsupported metric: ${metric}`);
    }

    const params: QueryParams = { baseline };
    // The baseline must survive an explicit --gateway filter, otherwise the join is empty.
    const gatewayOverride =
      f.gateways && f.gateways.length > 0 ? Array.from(new Set([...f.gateways, baseline])) : undefined;
    const where = this.buildWhere(f, params, gatewayOverride);
    const dims = this.dimensionSelect(f.groupBy);
    const dimsPrefixed = normalizeGroupBy(f.groupBy)
      .map((d) => `o.${DIMENSION_COLUMNS[d]}`)
      .join(', ');

    const query = `
WITH ok AS (
  SELECT batch_name, gateway, ${dims.select}, ${metric} AS metric_value
  FROM ${this.table}
  WHERE ${where}
    AND success
    AND ${metric} IS NOT NULL
),
base AS (
  SELECT batch_name, model, metric_value AS baseline_value
  FROM ok
  WHERE gateway = @baseline
),
paired AS (
  SELECT o.gateway, ${dimsPrefixed}, o.metric_value - b.baseline_value AS delta
  FROM ok o
  JOIN base b USING (batch_name, model)
  WHERE o.gateway != @baseline
)
SELECT
  gateway,
  ${dims.select},
  COUNT(*) AS paired_n,
  APPROX_QUANTILES(delta, 100)[SAFE_OFFSET(50)] AS delta_p50,
  APPROX_QUANTILES(delta, 100)[SAFE_OFFSET(90)] AS delta_p90,
  COUNTIF(delta > 0) / COUNT(*) AS baseline_win_rate
FROM paired
GROUP BY gateway, ${dims.group}
ORDER BY ${dims.group}, delta_p50 DESC`;

    const rows = await this.run<Record<string, unknown>>(query, params);
    return rows.map((r) => ({
      gateway: String(r.gateway),
      model: String(r.model),
      continent: r.continent === undefined ? undefined : String(r.continent ?? ''),
      country: r.country_code === undefined ? undefined : String(r.country_code ?? ''),
      pairedN: num(r.paired_n) ?? 0,
      deltaP50: num(r.delta_p50),
      deltaP90: num(r.delta_p90),
      baselineWinRate: num(r.baseline_win_rate) ?? 0,
    }));
  }

  /**
   * Date coverage per gateway inside the requested window. Gateways were added over
   * time (Cloudflare and Vercel on 2026-07-31, Kong on 2026-08-04), so comparing a
   * seven-week percentile against a five-day one would compare periods, not gateways.
   */
  async commonWindow(f: RankFilters): Promise<CommonWindow> {
    const params: QueryParams = {};
    const where = this.buildWhere(f, params);

    const query = `
SELECT gateway,
  CAST(MIN(DATE(timestamp)) AS STRING) AS d0,
  CAST(MAX(DATE(timestamp)) AS STRING) AS d1,
  COUNT(*) AS n
FROM ${this.table}
WHERE ${where}
GROUP BY gateway
ORDER BY d0`;

    const rows = await this.run<Record<string, unknown>>(query, params);
    const perGateway: GatewayWindow[] = rows.map((r) => ({
      gateway: String(r.gateway),
      from: String(r.d0),
      to: String(r.d1),
      n: num(r.n) ?? 0,
    }));

    if (perGateway.length === 0) {
      return { from: f.from, to: f.to, narrowed: false, perGateway };
    }

    const from = perGateway.reduce((a, g) => (g.from > a ? g.from : a), perGateway[0]!.from);
    const to = perGateway.reduce((a, g) => (g.to < a ? g.to : a), perGateway[0]!.to);
    const outerFrom = perGateway.reduce((a, g) => (g.from < a ? g.from : a), perGateway[0]!.from);
    const outerTo = perGateway.reduce((a, g) => (g.to > a ? g.to : a), perGateway[0]!.to);

    return { from, to, narrowed: from !== outerFrom || to !== outerTo, perGateway };
  }

  async distinctValues(column: 'gateway' | 'model' | 'continent' | 'country_code', f: RankFilters): Promise<string[]> {
    const params: QueryParams = {};
    const where = this.buildWhere(f, params);
    const query = `SELECT DISTINCT ${column} AS v FROM ${this.table} WHERE ${where} AND ${column} IS NOT NULL ORDER BY v`;
    const rows = await this.run<{ v: string }>(query, params);
    return rows.map((r) => String(r.v));
  }
}

// BigQuery returns INT64 as string or {value} depending on magnitude; normalize.
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
    return num((v as Record<string, unknown>).value);
  }
  return null;
}

/**
 * 'model' is always a grouping dimension. Gateways cover different model sets
 * (OpenAI only `gpt-5.4`, Anthropic only `claude-sonnet-4-6`) and the two models differ by
 * ~370ms of median TTFT, so a model-blind ranking compares model mix, not gateways.
 */
export function normalizeGroupBy(groupBy: Dimension[]): Dimension[] {
  const out: Dimension[] = ['model'];
  for (const d of groupBy) {
    if (d !== 'model' && !out.includes(d)) out.push(d);
  }
  return out;
}

export function parseMetric(value: string): Metric {
  const m = value as Metric;
  if (!METRICS.includes(m)) {
    throw new Error(`Unknown metric "${value}". Expected one of: ${METRICS.join(', ')}`);
  }
  return m;
}

export function parseDimensions(value: string): Dimension[] {
  if (!value) return [];
  return value.split(',').map((raw) => {
    const d = raw.trim() as Dimension;
    if (!(d in DIMENSION_COLUMNS)) {
      throw new Error(`Unknown dimension "${raw.trim()}". Expected: model, continent, country`);
    }
    return d;
  });
}

export function defaultWindow(days = 30): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: fromDate.toISOString().slice(0, 10), to };
}
