#!/bin/bash
set -euo pipefail

# Create (or update) one Cloud Run job per region.
#
# Credentials are never baked into the image. This script converts your local
# .env into a temporary env-vars file that gcloud applies to each job, so the
# job sees exactly the same variables you get when running the benchmark
# locally. That temp file holds plaintext secrets: it is created with mode 0600
# and deleted when the script exits.
#
# Usage:
#   PROJECT_ID=my-project IMAGE=europe-docker.pkg.dev/.../gateway-bench:latest \
#     ./cloud-run-jobs/create-jobs.sh
#
# or simply: make create-jobs

cd "$(dirname "$0")/.."
source ./cloud-run-jobs/config.sh

IMAGE=${IMAGE:?IMAGE is required (e.g. IMAGE=europe-docker.pkg.dev/my-project/gateway-bench/gateway-bench:latest)}
ENV_FILE=${ENV_FILE:-.env}

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ $ENV_FILE not found. Copy .env.example to .env and fill in your keys." >&2
  exit 1
fi

# Parse .env with the same library the app uses, so Cloud Run receives exactly
# the values dotenv would produce locally. Emitted as double-quoted YAML
# scalars, which safely carry commas, newlines and quotes (e.g. the service
# account private key) that --set-env-vars cannot.
ENV_YAML=$(mktemp "${TMPDIR:-/tmp}/gateway-bench-env.XXXXXX")
chmod 600 "$ENV_YAML"
trap 'rm -f "$ENV_YAML"' EXIT

node --input-type=commonjs -e '
  const fs = require("fs");
  const dotenv = require("dotenv");
  const parsed = dotenv.parse(fs.readFileSync(process.argv[1]));
  const out = Object.entries(parsed)
    .filter(([, v]) => v !== undefined && String(v).trim() !== "")
    .map(([k, v]) => `${k}: ${JSON.stringify(String(v))}`)
    .join("\n");
  process.stdout.write(out + "\n");
' "$ENV_FILE" > "$ENV_YAML"

VAR_COUNT=$(grep -c ':' "$ENV_YAML" || true)
echo "Applying ${VAR_COUNT} environment variables from ${ENV_FILE}"
echo "Image: ${IMAGE}"
echo ""

for region in $REGIONS; do
  echo "→ ${JOB_PREFIX}-${region}"
  gcloud run jobs deploy "${JOB_PREFIX}-${region}" \
    --project="${PROJECT_ID}" \
    --region="${region}" \
    --image="${IMAGE}" \
    --env-vars-file="${ENV_YAML}"
done

echo ""
echo "✓ Jobs deployed across $(echo $REGIONS | wc -w | tr -d ' ') regions"
