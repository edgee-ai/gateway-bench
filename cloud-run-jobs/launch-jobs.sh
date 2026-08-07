#!/bin/bash
set -euo pipefail

# Execute every regional Cloud Run job once, on demand.
#
# Usage:
#   PROJECT_ID=my-project ./cloud-run-jobs/launch-jobs.sh
# or: make launch

cd "$(dirname "$0")/.."
source ./cloud-run-jobs/config.sh

for region in $REGIONS; do
  echo "→ ${JOB_PREFIX}-${region}"
  gcloud run jobs execute "${JOB_PREFIX}-${region}" \
    --project="${PROJECT_ID}" \
    --region="${region}"
done
