#!/bin/bash
# Shared configuration for the Cloud Run job scripts.
#
# Nothing deployment-specific is hardcoded in this repository: every value below
# comes from the environment, with a neutral default where one makes sense.
# `make create-jobs` / `make launch` pass PROJECT_ID through for you.

PROJECT_ID=${PROJECT_ID:?PROJECT_ID is required (e.g. PROJECT_ID=my-gcp-project $0)}

# Name prefix for the Cloud Run jobs and their schedulers: one per region,
# e.g. gateway-bench-europe-west1
JOB_PREFIX=${JOB_PREFIX:-gateway-bench}

# Regions the benchmark runs from. Override to run a smaller sweep:
#   REGIONS="europe-west1 us-east1" ./cloud-run-jobs/create-jobs.sh
DEFAULT_REGIONS="africa-south1 asia-east1 asia-northeast1 asia-northeast2 \
asia-northeast3 asia-south1 asia-south2 asia-southeast1 asia-southeast2 asia-southeast3 \
australia-southeast1 australia-southeast2 europe-central2 europe-north1 europe-north2 \
europe-southwest1 europe-west1 europe-west10 europe-west12 europe-west2 europe-west3 \
europe-west4 europe-west6 europe-west8 europe-west9 me-central1 me-west1 \
northamerica-northeast1 northamerica-northeast2 northamerica-south1 southamerica-east1 \
southamerica-west1 us-central1 us-east1 us-east4 us-east5 us-south1 us-west1 us-west2 \
us-west3 us-west4"

REGIONS=${REGIONS:-$DEFAULT_REGIONS}
