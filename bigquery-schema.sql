-- BigQuery table schema for benchmark results
-- Project: ${BIGQUERY_PROJECT_ID}
-- Dataset: ${BIGQUERY_DATASET_ID}
-- Table: results

CREATE TABLE IF NOT EXISTS `${BIGQUERY_PROJECT_ID}.${BIGQUERY_DATASET_ID}.results` (
  timestamp TIMESTAMP NOT NULL,
  batch_name STRING,
  gateway STRING NOT NULL,
  provider STRING NOT NULL,
  scenario_name STRING NOT NULL,
  country_code STRING,
  continent STRING,
  proxy_type STRING,
  proxy_description STRING,
  as_name STRING,
  conn_speed STRING,
  conn_type STRING,
  model STRING NOT NULL,
  ttft INT64 NOT NULL,
  total_time INT64 NOT NULL,
  input_tokens INT64 NOT NULL,
  output_tokens INT64 NOT NULL,
  total_tokens INT64 NOT NULL,
  hit_token_limit BOOL NOT NULL,
  success BOOL NOT NULL,
  error STRING,
  finish_reason STRING,
  model_used STRING,
  prompt STRING NOT NULL,
  response STRING
)
PARTITION BY DATE(timestamp)
OPTIONS(
  description="AI Gateway benchmark results",
  require_partition_filter=false
);

-- Example query: Get average TTFT by gateway and provider
-- SELECT
--   gateway,
--   provider,
--   AVG(ttft) as avg_ttft,
--   AVG(total_time) as avg_total_time,
--   COUNT(*) as num_requests,
--   COUNTIF(success) / COUNT(*) as success_rate
-- FROM `${BIGQUERY_PROJECT_ID}.${BIGQUERY_DATASET_ID}.results`
-- WHERE DATE(timestamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
-- GROUP BY gateway, provider
-- ORDER BY avg_ttft;
