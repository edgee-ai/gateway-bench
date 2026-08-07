# Gateway Bench

A benchmarking tool for comparing AI Gateway **performance** (TTFT, latency) across Edgee and competing providers: OpenRouter, TrueFoundry, Vercel AI Gateway, Cloudflare AI Gateway, Kong AI Gateway. OpenAI and Anthropic direct APIs are tested as baselines.

## 📈 Published results

Looking for the numbers rather than the tooling? Start with [`analysis/`](analysis/).

**[AI Gateway TTFT Benchmark — 5–6 August 2026](analysis/2026-08-05_06-ttft-benchmark.md)**
compares six gateways over 16,344 measurements taken from 43 Google Cloud regions, in 28
countries across 6 continents. It is written to be read end to end: results first, then how
the measurements are taken, then how they are computed and compared, then the detailed
tables — including a per-continent breakdown and the cases where Edgee ranks behind its
competitors.

Everything behind it is in [`analysis/data/`](analysis/data/): the full per-request export,
one derived CSV per section of the report, and the SQL to regenerate each of them. Any figure
in the report can be recomputed from those files, or reproduced with `npm run bench rank`.

A few conventions the report relies on, if you plan to read the data directly:

- **`batch_name` is the unit of comparison.** One batch is one region, one moment, one
  prompt, every gateway — which is what makes a paired head-to-head valid where a pooled
  average is not.
- **Percentiles cover successful requests only**, so they are always shown next to a success
  rate.
- **Rankings are segmented by model**, never merged, because the two models differ by roughly
  400 ms of median TTFT.
- **`ttfb` and `total_time` are diagnostic, not ranking metrics.** The reasoning is in §3.5 of
  the report.

## Features

- 🚀 **Multi-Gateway Support** - Test Edgee + competitor gateways simultaneously
- 🔄 **Multi-Provider Testing** - Each gateway tests an OpenAI and an Anthropic model
- 📊 **Baseline Comparison** - Required OpenAI & Anthropic direct API comparison
- ⚡ **Performance Metrics** - Measure TTFT and total response time
- 🌍 **Automatic Location Detection** - Detailed network and geographic context via Edgee
- 📊 **BigQuery Integration** - Automatic result export to BigQuery with rich metadata
- 🔄 **Sequential & Parallel Testing** - Choose your execution mode

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and add your API keys:

```bash
cp .env.example .env
```

Edit `.env` and add your API keys:
- **Required**: `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` (for baseline comparison)
- **Optional**: Add keys for any gateways you want to test (e.g., `EDGEE_API_KEY`, `OPENROUTER_API_KEY`)
- **Edgee endpoints**: `EDGEE_API_KEY` covers (`edgee.io`); 

**Model Configuration**:
- Models are configured in `models.json` (version controlled)
- Each gateway has specific model mappings for both OpenAI and Anthropic providers
- Edit `models.json` to customize which models each gateway tests
- Example structure:
  ```json
  {
    "providers": [
      {
        "name": "openai",
        "models": [
          { "name": "gpt-5.4", "gateways": { "OpenAI (Direct)": "gpt-5.4", "OpenRouter": "openai/gpt-5.4" } }
        ]
      },
      {
        "name": "anthropic",
        "models": [
          { "name": "claude-sonnet-4-6", "gateways": { "Anthropic (Direct)": "claude-sonnet-4-6", "OpenRouter": "model": "anthropic/claude-sonnet-4.6", "api": "anthropic" } }
        ]
      }
    ]
  }
  ```

**Note**: Only gateways with valid API keys will be included in benchmarks. Gateways without keys are automatically skipped.

**API method (transport) per gateway/model**:
Each gateway entry is either a plain model string (uses the gateway's default transport) or an object that pins the transport:
- `"openai"` → `POST /v1/chat/completions` (OpenAI SDK)
- `"anthropic"` → `POST /v1/messages` (native Anthropic Messages endpoint)

```json
"Edgee": { "model": "anthropic/claude-sonnet-4-6:anthropic", "api": "anthropic" }
```
This lets you compare, for an Anthropic model, the gateway's native `/v1/messages` path against the `/v1/chat/completions` path (where the gateway must transform the request). The results table shows an **API** column (`messages` / `chat`); switch a gateway's entry between a plain string and `{ "api": "anthropic" }` and re-run to compare. Gateways with no native `/v1/messages` endpoint (e.g. TrueFoundry) simply stay on `chat`. A pinned `api` a gateway can't serve is skipped with a warning.


### 3. Set Up BigQuery (Optional)

1. Create a Google Cloud Project (or use existing)
2. Enable BigQuery API
3. Create a service account with BigQuery Data Editor and BigQuery Job User roles
4. Download the JSON key
5. Add these two values to `.env`, reading them from the JSON key file:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` — the `client_email` field
   - `GOOGLE_PRIVATE_KEY` — the `private_key` field (keep the quotes and the `\n`)

   ```bash
   # jq one-liner to print both in .env format
   jq -r '"GOOGLE_SERVICE_ACCOUNT_EMAIL=" + .client_email,
          "GOOGLE_PRIVATE_KEY=\"" + .private_key + "\""' path/to/your-key.json
   ```

### 4. Build the Project

```bash
npm run build
```

### 5. Run Benchmarks

```bash
npm run bench run
```

Or with custom options:

```bash
npm run bench run --iterations 5 --parallel --provider openai
```

## CLI Commands

### Run Benchmarks

```bash
npm run bench run [options]
```

Options:
- `-p, --prompt <prompt>` - Prompt to use for testing
- `-i, --iterations <number>` - Number of iterations per gateway/model (default: 3)
- `-g, --gateway <gateways>` - Run only specific gateway(s) (comma-separated, e.g., "Edgee,Openrouter")
- `--provider <provider>` - Filter results by provider (openai or anthropic)
- `--parallel` - Run gateways in parallel (default: sequential)
- `--no-bigquery` - Skip BigQuery upload
- `--max-tokens <number>` - Max tokens to generate (default: 3000)

**Examples:**
```bash
# Run all configured gateways
npm run bench run

# Run only Edgee gateway
npm run bench run --gateway "Edgee"

# Run multiple specific gateways
npm run bench run --gateway "Edgee,OpenRouter"

# Filter results by provider
npm run bench run --provider openai
```

**Note**: Models are configured in `models.json`. Each benchmark run tests all configured models for each gateway (both OpenAI and Anthropic where available).

### List Gateways

```bash
npm run bench list
```

Shows which gateways are configured and available.

### Rank Gateway Performance

```bash
npm run bench rank [options]
```

Queries the BigQuery results table and ranks gateways. Requires `roles/bigquery.jobUser`
on the service account (the write-only role is not enough to run queries).

Options:
- `--from <date>` / `--to <date>` - window, `YYYY-MM-DD` (default: last 30 days)
- `-g, --gateway <list>` - gateways, comma-separated (default: all)
- `-m, --model <list>` - models, comma-separated (default: all, never merged into one row)
- `--continent <list>` / `--country <list>` - geographic filters
- `--group-by <dims>` - extra dimensions: `continent`, `country` (`model` always applied)
- `--vs <gateway>` - paired head-to-head against a baseline instead of a pooled ranking
- `--metric <m>` - `ttft` (default) | `ttfb` | `total_time`
- `--min-n <n>` - minimum samples before a cell is shown (default: 30)
- `--format <f>` - `table` (default) | `md` | `csv` | `json`
- `--no-common-window` - do not narrow the window to the range all gateways share

**Examples:**
```bash
# Ranking for one model over a window
npm run bench rank --model gpt-5.4 --from 2026-07-31

# Head-to-head: how much slower is each gateway than Edgee, same batch, same region?
npm run bench rank --vs Edgee --from 2026-07-31

# Per-continent breakdown, markdown table ready to paste into an article
npm run bench rank --model gpt-5.4 --group-by continent --format md
```

#### Methodology

The ranking metric is **TTFT p50**, with p90/p95 shown alongside for the tail and the
success rate kept in its own column. Four properties of this dataset drive that choice —
each one silently inverts the ranking if ignored:

1. **Model is always a grouping dimension.** Gateways cover different model sets
   (OpenAI only `gpt-5.4`, Anthropic only `claude-sonnet-4-6`) and the two models
   differ by roughly 370ms of median TTFT. A model-blind ranking compares model mix.
2. **Windows are narrowed to the shared range by default.** Gateways joined the benchmark
   on different dates, so a seven-week percentile against a five-day one compares periods.
   The applied window and the reason for narrowing are printed above every table.
3. **Percentiles cover successful requests only.** A gateway that fails most requests
   would otherwise look fast.
   Anything below 95% success is flagged `⚠`, excluded from the ranking, and its
   percentiles are suppressed rather than shown.
4. **Thin cells are suppressed.** Below `--min-n` samples no percentile is printed; p95
   additionally requires 100 samples.

`ttfb` is reported but is **diagnostic, not a performance metric**. It records when the
gateway commits its response headers, and gateways differ in *when they decide to*: the
OpenAI API itself only sends headers 7ms before the first token, while a gateway that
flushes headers eagerly reports a `ttfb` that owes nothing to upstream latency. Use it to
detect buffering (a large `ttft − ttfb` gap means the response was held and released in one
block) and to gauge edge proximity — never to rank gateways. The honest measure of what a
gateway costs is the paired TTFT delta against the provider's direct API.

**Prefer `--vs` for any published claim.** Pooled percentiles mix batches; not every
gateway is measured in every batch. Pairing within `(batch_name, model)` — one Cloud Run
region, one moment, one scenario — cancels out geography, time of day and model at once,
and is the only form of comparison that holds up to scrutiny.

**Read `Δ p90` carefully.** It is the 90th percentile of the *per-batch difference*, not the
difference between the two gateways' p90s. It is positive for nearly every gateway simply
because run-to-run differences are widely spread — a gateway that is typically faster still
has runs where it is much slower. A positive `Δ p90` only indicates a real tail advantage
when the difference distribution is *asymmetric*; compare `Δ p10` against `Δ p90` before
claiming anything about the tail. To compare tails directly, use the `p90` column of the
pooled ranking instead.

## Docker Usage

No image is published: the benchmark runs against your own provider accounts, so
you build it yourself. The image contains **no credentials** — every key is
supplied at runtime.

```bash
make docker-build-local     # builds the `gateway-bench:latest` image
```

### Quick Start with Docker

**Option 1: Using environment variables directly (recommended for CI/CD)**
```bash
docker run --rm \
  -e OPENAI_API_KEY=$OPENAI_API_KEY \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  -e BIGQUERY_PROJECT_ID=$BIGQUERY_PROJECT_ID \
  -e BIGQUERY_DATASET_ID=$BIGQUERY_DATASET_ID \
  -e BIGQUERY_TABLE_ID=$BIGQUERY_TABLE_ID \
  -e GOOGLE_SERVICE_ACCOUNT_EMAIL=$GOOGLE_SERVICE_ACCOUNT_EMAIL \
  -e GOOGLE_PRIVATE_KEY="$GOOGLE_PRIVATE_KEY" \
  gateway-bench:latest
```

**Option 2: Using your .env file**
```bash
make docker-run             # equivalent to: docker run --rm --env-file .env gateway-bench:latest
```

**Note:** Environment variables passed with `-e` take precedence over values in the .env file.

## Deploying to Cloud Run (optional)

The `cloud-run-jobs/` scripts run the benchmark from many GCP regions on a
schedule. No project name is hardcoded — point them at your own project by
creating a git-ignored `Makefile.local`:

```make
GCP_PROJECT_ID = your-gcp-project
```

Then:

```bash
make gcp-build         # build + push the multi-arch image to Artifact Registry
make create-jobs       # create/update one Cloud Run job per region
make create-schedulers # optional: trigger them on a cron schedule
make launch            # run every regional job once, on demand
```

`make create-jobs` reads your local `.env` and applies it to each job as
environment variables, so the image itself never carries a secret. Override any
setting from the environment, e.g. `REGIONS="europe-west1 us-east1" make create-jobs`.

## Development

### Development Mode

```bash
# Run CLI in dev mode
npm run dev -- run

# Run web server in dev mode
npm run dev:web
```

### Build

```bash
npm run build
```

### Lint

```bash
npm run lint
```

## Deployment

This tool is designed to be easily deployed to multiple locations for latency testing:

1. **Docker** - Build a container and deploy to any cloud provider
2. **Cloud Functions** - Run as scheduled functions in different regions
3. **Edge Workers** - Deploy to Cloudflare Workers, Vercel Edge, etc.
4. **VPS** - Run on servers in different geographic locations

**Location Detection**:
The tool automatically detects client location information using the Edgee status endpoint, capturing:
- Country code
- Connection type and speed
- Proxy type and description
- Autonomous System (AS) name
- City and region

This information is stored with each benchmark result for geographic performance analysis.

## Metrics Collected

- **TTFT (Time to First Token)** - How quickly the first token is received
- **Total Response Time** - Complete request duration
- **Location Context** - Country code, connection type/speed, proxy type, AS name
- **Provider Information** - Which provider (OpenAI/Anthropic) was used
- **Success Rate** - Percentage of successful requests
- **Error Details** - Failure information when requests fail
- **Model Information** - Requested model and actual model used

## Architecture

- **TypeScript** - Type-safe codebase
- **OpenAI SDK** - Unified API client for all gateways
- **Commander** - CLI interface
- **Express** - Web server for dashboard
- **BigQuery** - Data persistence and analytics
- **Chart.js** - Data visualization

## License

MIT
