# Raw data — AI Gateway TTFT Benchmark, 5–6 August 2026

Source data behind [`../2026-08-05_06-ttft-benchmark.md`](../2026-08-05_06-ttft-benchmark.md).
Every figure in that report can be recomputed from these files.

**Source table:** `edgee-prod.benchmark_app.results`
**Window:** `DATE(timestamp) BETWEEN '2026-08-05' AND '2026-08-06'` (UTC)
**Scope:** `gateway IN ('Edgee','OpenRouter','Vercel','Cloudflare','Kong','TrueFoundry','OpenAI (Direct)','Anthropic (Direct)')`
**Extracted:** 7 August 2026

---

## Files

| File | Rows | Contents |
|---|---|---|
| `01-raw-measurements.csv` | 16,344 | One row per request. This is the primary data; everything else is derived from it. |
| `02-ranking-pooled.csv` | 14 | Pooled percentiles per gateway and model — report §1.2, §1.3, §4.1 |
| `03-headtohead-vs-edgee.csv` | 12 | Paired deltas vs Edgee, with p10/p50/p90 and asymmetry — §4.2, §4.3 |
| `04-overhead-vs-direct-api.csv` | 12 | Paired overhead of each gateway against the direct API of its model |
| `05-geography-pooled.csv` | 70 | Medians per continent, cells with n ≥ 30 — §4.4 |
| `06-geography-headtohead.csv` | 60 | Paired deltas per continent, cells with n ≥ 30 — §4.4 |
| `07-reliability.csv` | 8 | Success rates — §4.6 |
| `08-failures-detail.csv` | 5 | Every failure, grouped, with an error sample |
| `09-network-path.csv` | 14 | Host, server header and Cloudflare-ray rate seen by the client |
| `10-coverage.csv` | 28 | Measurements per day, gateway and model — sampling balance check |

## Columns in `01-raw-measurements.csv`

| Column | Meaning |
|---|---|
| `timestamp` | Request start, UTC |
| `batch_name` | Test run identifier. **One batch = one region, one moment, every gateway.** This is the join key for every paired comparison. |
| `gateway` | Participant name |
| `model` | `gpt-5.4` or `claude-sonnet-4-6` |
| `api` | Transport used: `openai` (`/v1/chat/completions`) or `anthropic` (`/v1/messages`) |
| `provider` | Upstream provider family |
| `scenario_name` | Prompt scenario — `simple` throughout this window |
| `continent`, `country_code`, `city`, `region` | Client location, detected at run time |
| `as_name`, `conn_type` | Client network context |
| `ttft` | **Time to first token, ms.** Stamped on the first chunk carrying non-empty text content. The report's primary metric. |
| `ttfb` | Time to response headers, ms. Diagnostic only — see report §3.5. |
| `total_time` | Full response duration, ms |
| `success` | `true` when the stream completed without error |
| `error` | Error message when `success` is false |
| `finish_reason`, `model_used` | Reported by the provider |
| `flow_host`, `flow_remote_ip`, `flow_alpn`, `flow_http_status` | Network path to the gateway |
| `flow_server` | `server` response header — reveals which CDN or platform fronts each gateway |
| `flow_conn_fresh` | Whether a new connection was opened for this request |

## Reproducing the derived files

Pooled ranking (`02`):

```sql
SELECT model, gateway, COUNT(*) n, COUNTIF(success) n_ok,
  ROUND(COUNTIF(success)/COUNT(*),4) success_rate,
  APPROX_QUANTILES(IF(success,ttft,NULL),100)[OFFSET(50)] ttft_p50,
  APPROX_QUANTILES(IF(success,ttft,NULL),100)[OFFSET(90)] ttft_p90
FROM `edgee-prod.benchmark_app.results`
WHERE DATE(timestamp) BETWEEN '2026-08-05' AND '2026-08-06' AND <scope>
GROUP BY model, gateway ORDER BY model, ttft_p50
```

Paired head-to-head (`03`) — the join on `(batch_name, model)` is what makes the
comparison valid, since it puts both gateways in the same region at the same moment:

```sql
WITH ok AS (SELECT batch_name, model, gateway, ttft FROM <table> WHERE <window> AND <scope> AND success),
     e  AS (SELECT batch_name, model, ttft et FROM ok WHERE gateway='Edgee'),
     d  AS (SELECT o.model, o.gateway, o.ttft - e.et delta
            FROM ok o JOIN e USING (batch_name, model) WHERE o.gateway != 'Edgee')
SELECT model, gateway, COUNT(*) paired_n,
  APPROX_QUANTILES(delta,100)[OFFSET(10)] delta_p10,
  APPROX_QUANTILES(delta,100)[OFFSET(50)] delta_p50,
  APPROX_QUANTILES(delta,100)[OFFSET(90)] delta_p90,
  ROUND(COUNTIF(delta>0)/COUNT(*),4) edgee_win_rate
FROM d GROUP BY model, gateway
```

The same tables can be produced from the CLI without writing SQL:

```bash
GW='Edgee,OpenRouter,Vercel,Cloudflare,Kong,TrueFoundry,OpenAI (Direct),Anthropic (Direct)'
npm run bench rank -- --gateway "$GW" --from 2026-08-05 --to 2026-08-06 --no-common-window --format csv
npm run bench rank -- --gateway "$GW" --vs Edgee --from 2026-08-05 --to 2026-08-06 --no-common-window --format csv
```

## Reading notes

**`delta_p90` is not the difference between two p90s.** It is the 90th percentile of the
per-run difference. It is positive for nearly every gateway because run-to-run differences
are widely spread. Use the `asymmetry` column (`p10 + p90`) to tell a real tail advantage
from noise: near zero means the distribution is symmetric and there is nothing to claim.
Report §4.3 covers this.

**Percentiles exclude failed requests.** A request that failed has no first token. Always
read a percentile next to its success rate.

**All 140 failures in this window originate from Hong Kong**, and all are HTTP 403 region
restrictions from the providers — not timeouts or gateway faults. See `08-failures-detail.csv`.

**`ttfb` is diagnostic, not a performance metric.** It records when a gateway commits its
response headers, which is an architectural choice. It is included because a large
`ttft - ttfb` gap identifies a gateway that buffers instead of streaming.
