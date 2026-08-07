#!/bin/bash
set -euo pipefail

# Create (or update) Cloud Scheduler jobs that trigger each regional
# gateway-bench Cloud Run job.
#
# Requires: gcloud authenticated on the right project, Cloud Scheduler API
# enabled, and a service account with permission to run Cloud Run jobs
# (roles/run.invoker).
#
# Schedules are staggered: POOL_SIZE jobs fire at the same minute, each pool is
# spaced 1 minute apart. If a scheduler job already exists, it is updated.
#
# Usage:
#   PROJECT_ID=my-project ./cloud-run-jobs/create-schedulers.sh
# or: make create-schedulers

cd "$(dirname "$0")/.."
source ./cloud-run-jobs/config.sh

# All scheduler jobs live in one region; each one targets the Cloud Run job in its own region
SCHEDULER_REGION=${SCHEDULER_REGION:-europe-west1}
# Minute of the hour the first pool fires
START_MINUTE=${START_MINUTE:-1}
# Hours of the day the jobs fire (4 times per day, every 6h)
HOURS=${HOURS:-0,6,8,12,18}
# Number of jobs allowed to fire at the same minute
POOL_SIZE=${POOL_SIZE:-5}
# Service account used by Cloud Scheduler to call the Cloud Run Jobs API.
# Defaults to the project's compute service account.
SERVICE_ACCOUNT_EMAIL=${SERVICE_ACCOUNT_EMAIL:-$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')-compute@developer.gserviceaccount.com}

# Create (or update) one scheduler job per region, staggered by pool
i=0
for region in $REGIONS; do
  minute=$(( (START_MINUTE + i / POOL_SIZE) % 60 ))
  schedule="${minute} ${HOURS} * * *"
  args=(
    --project="${PROJECT_ID}"
    --location="${SCHEDULER_REGION}"
    --schedule="${schedule}"
    --uri="https://${region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/${JOB_PREFIX}-${region}:run"
    --http-method=POST
    --oauth-service-account-email="${SERVICE_ACCOUNT_EMAIL}"
    --oauth-token-scope=https://www.googleapis.com/auth/cloud-platform
  )
  echo "${JOB_PREFIX}-${region}: schedule '${schedule}'"
  gcloud scheduler jobs create http "${JOB_PREFIX}-${region}" "${args[@]}" 2>/dev/null \
    || gcloud scheduler jobs update http "${JOB_PREFIX}-${region}" "${args[@]}"
  i=$((i + 1))
done
