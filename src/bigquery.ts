import { BigQuery } from '@google-cloud/bigquery';
import { BenchmarkResult } from './types.js';

interface BigQueryField {
  name: string;
  type: string;
  mode?: string;
}

export class BigQueryWriter {
  private bigquery: BigQuery;
  private projectId: string;
  private datasetId: string;
  private tableId: string;

  constructor(projectId: string, datasetId: string, tableId: string, email: string, privateKey: string) {
    this.bigquery = new BigQuery({
      projectId,
      credentials: {
        client_email: email,
        private_key: privateKey,
      },
    });
    this.projectId = projectId;
    this.datasetId = datasetId;
    this.tableId = tableId;
  }

  async initialize() {
    try {
      const dataset = this.bigquery.dataset(this.datasetId);

      // Check if dataset exists
      const [datasetExists] = await dataset.exists();
      if (!datasetExists) {
        throw new Error(`Dataset ${this.projectId}.${this.datasetId} does not exist. Please create it first with: bq mk --dataset ${this.projectId}:${this.datasetId}`);
      }

      const table = dataset.table(this.tableId);

      // Check if table exists
      const [exists] = await table.exists();

      if (!exists) {
        // Create table with schema
        const schema = this.getSchema();
        await table.create({
          schema: {
            fields: schema,
          },
        });
      } else {
        // Update table schema to ensure all columns exist
        await this.updateSchema();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to initialize BigQuery: ${errorMessage}`);
    }
  }

  private getSchema() {
    return [
      { name: 'timestamp', type: 'TIMESTAMP', mode: 'REQUIRED' },
      { name: 'batch_name', type: 'STRING', mode: 'NULLABLE' },
      { name: 'gateway', type: 'STRING', mode: 'REQUIRED' },
      { name: 'provider', type: 'STRING', mode: 'REQUIRED' },
      { name: 'scenario_name', type: 'STRING', mode: 'REQUIRED' },
      { name: 'country_code', type: 'STRING', mode: 'NULLABLE' },
      { name: 'continent', type: 'STRING', mode: 'NULLABLE' },
      { name: 'city', type: 'STRING', mode: 'NULLABLE' },
      { name: 'region', type: 'STRING', mode: 'NULLABLE' },
      { name: 'proxy_type', type: 'STRING', mode: 'NULLABLE' },
      { name: 'proxy_description', type: 'STRING', mode: 'NULLABLE' },
      { name: 'as_name', type: 'STRING', mode: 'NULLABLE' },
      { name: 'conn_speed', type: 'STRING', mode: 'NULLABLE' },
      { name: 'conn_type', type: 'STRING', mode: 'NULLABLE' },
      { name: 'model', type: 'STRING', mode: 'REQUIRED' },
      { name: 'ttft', type: 'INTEGER', mode: 'REQUIRED' },
      { name: 'total_time', type: 'INTEGER', mode: 'REQUIRED' },
      { name: 'api', type: 'STRING', mode: 'NULLABLE' },
      { name: 'success', type: 'BOOLEAN', mode: 'REQUIRED' },
      { name: 'error', type: 'STRING', mode: 'NULLABLE' },
      { name: 'finish_reason', type: 'STRING', mode: 'NULLABLE' },
      { name: 'model_used', type: 'STRING', mode: 'NULLABLE' },
      { name: 'pop_region', type: 'STRING', mode: 'NULLABLE' },
      // Network-path analysis (transport.ts FlowInfo). Added to existing tables
      // automatically via updateSchema().
      { name: 'ttfb', type: 'INTEGER', mode: 'NULLABLE' },
      { name: 'flow_host', type: 'STRING', mode: 'NULLABLE' },
      { name: 'flow_remote_ip', type: 'STRING', mode: 'NULLABLE' },
      { name: 'flow_alpn', type: 'STRING', mode: 'NULLABLE' },
      { name: 'flow_http_status', type: 'INTEGER', mode: 'NULLABLE' },
      { name: 'flow_connect_ms', type: 'INTEGER', mode: 'NULLABLE' },
      { name: 'flow_conn_fresh', type: 'BOOLEAN', mode: 'NULLABLE' },
      { name: 'flow_server', type: 'STRING', mode: 'NULLABLE' },
      { name: 'flow_cf_ray', type: 'STRING', mode: 'NULLABLE' },
      { name: 'flow_via', type: 'STRING', mode: 'NULLABLE' },
      { name: 'flow_headers_json', type: 'STRING', mode: 'NULLABLE' },
    ];
  }

  private async updateSchema() {
    try {
      const dataset = this.bigquery.dataset(this.datasetId);
      const table = dataset.table(this.tableId);

      const [metadata] = await table.getMetadata();
      const currentSchema = (metadata.schema?.fields || []) as BigQueryField[];
      const newSchema = this.getSchema();

      // Check if we need to add any new fields
      const currentFieldNames = new Set(currentSchema.map((f) => f.name));
      const fieldsToAdd = newSchema.filter(f => !currentFieldNames.has(f.name));

      if (fieldsToAdd.length > 0) {
        // Add new fields to existing schema
        const updatedSchema = [...currentSchema, ...fieldsToAdd];
        await table.setMetadata({ schema: { fields: updatedSchema } });
      }
    } catch (error) {
      console.warn(`Failed to update schema: ${error}`);
    }
  }

  async writeResults(results: BenchmarkResult[]) {
    if (results.length === 0) {
      console.log('No results to write to BigQuery');
      return;
    }

    const rows = results.map((result) => ({
      timestamp: result.timestamp.toISOString(),
      batch_name: result.batchName || null,
      gateway: result.gateway,
      provider: result.provider,
      scenario_name: result.scenarioName,
      country_code: result.country_code || null,
      continent: result.continent || null,
      city: result.city || null,
      region: result.region || null,
      proxy_type: result.proxy_type || null,
      proxy_description: result.proxy_description || null,
      as_name: result.as_name || null,
      conn_speed: result.conn_speed || null,
      conn_type: result.conn_type || null,
      model: result.modelTopLevelName,
      ttft: result.ttft,
      total_time: result.totalTime,
      api: result.api || null,
      success: result.success,
      error: result.error || null,
      finish_reason: result.finishReason || null,
      model_used: result.modelUsed || null,
      pop_region: result.pop_region || null,
      ttfb: result.ttfb ?? null,
      flow_host: result.flow_host || null,
      flow_remote_ip: result.flow_remote_ip || null,
      flow_alpn: result.flow_alpn || null,
      flow_http_status: result.flow_http_status ?? null,
      flow_connect_ms: result.flow_connect_ms ?? null,
      flow_conn_fresh: result.flow_conn_fresh ?? null,
      flow_server: result.flow_server || null,
      flow_cf_ray: result.flow_cf_ray || null,
      flow_via: result.flow_via || null,
      flow_headers_json: result.flow_headers_json || null,
    }));

    const dataset = this.bigquery.dataset(this.datasetId);
    const table = dataset.table(this.tableId);


    try {
      await table.insert(rows);
    } catch (error) {
      console.error('\n✗ BigQuery insert failed:');

      if (error && typeof error === 'object' && 'name' in error && error.name === 'PartialFailureError') {
        const partialError = error as { errors?: Array<{ row?: unknown; errors?: Array<{ message?: string; reason?: string; location?: string }> }> };
        console.error('\nPartial insert errors:');
        partialError.errors?.forEach((rowError, index) => {
          console.error(`\nRow ${index}:`);
          rowError.errors?.forEach((err) => {
            console.error(`  - ${err.reason}: ${err.message}`);
            if (err.location) {
              console.error(`    Location: ${err.location}`);
            }
          });
          if (rowError.row) {
            console.error('  Row data:', JSON.stringify(rowError.row, null, 2));
          }
        });
      } else if (error instanceof Error) {
        console.error(`  Error: ${error.message}`);
      } else {
        console.error('  Unknown error:', error);
      }

      throw error;
    }
  }

  static async createFromEnv(): Promise<BigQueryWriter | null> {
    const projectId = process.env.BIGQUERY_PROJECT_ID;
    const datasetId = process.env.BIGQUERY_DATASET_ID;
    const tableId = process.env.BIGQUERY_TABLE_ID;
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    let privateKey = process.env.GOOGLE_PRIVATE_KEY;

    if (!email || !privateKey || !projectId || !datasetId || !tableId) {
      return null;
    }

    // Replace literal \n with actual newlines (common when passing as env var)
    privateKey = privateKey.replace(/\\n/g, '\n');

    const writer = new BigQueryWriter(projectId, datasetId, tableId, email, privateKey);
    await writer.initialize();
    return writer;
  }
}
