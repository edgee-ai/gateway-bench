.PHONY: all help docker-build-local docker-run gcp-build create-jobs create-schedulers launch dev.launch require-gcp-project
MAKEFLAGS += --silent

VERSION=1.0.0

# ---------------------------------------------------------------------------
# Deployment configuration
#
# These values are specific to whoever deploys this benchmark. Nothing here is
# secret, but nothing here is universal either — so don't hardcode your own
# project in this file. Override them in one of two ways:
#
#   1. Create a Makefile.local (git-ignored), e.g.
#        GCP_PROJECT_ID = my-gcp-project
#        DOCKER_IMAGE   = myuser/gateway-bench
#
#   2. Or export/pass them on the command line
#        GCP_PROJECT_ID=my-gcp-project make gcp-build
#
# API keys never belong here — they live in .env (see .env.example).
# ---------------------------------------------------------------------------
-include Makefile.local

# Local image tag used by `make docker-build-local` / `make docker-run`
DOCKER_IMAGE   ?= gateway-bench

# GCP Artifact Registry target used by `make gcp-build`
GCP_PROJECT_ID ?=
GCP_REGION     ?= europe
ARTIFACT_REPO  ?= gateway-bench
IMAGE_NAME     ?= gateway-bench
REGISTRY_IMAGE ?= $(GCP_REGION)-docker.pkg.dev/$(GCP_PROJECT_ID)/$(ARTIFACT_REPO)/$(IMAGE_NAME)

all: help

help:
	@grep -E '^[a-zA-Z1-9\._-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| sed -e "s/^Makefile://" -e "s///" \
		| awk 'BEGIN { FS = ":.*?## " }; { printf "\033[36m%-30s\033[0m %s\n", $$1, $$2 }'

require-gcp-project:
	@if [ -z "$(GCP_PROJECT_ID)" ]; then \
		echo "❌ GCP_PROJECT_ID is not set."; \
		echo ""; \
		echo "   Create a Makefile.local (git-ignored) containing:"; \
		echo "     GCP_PROJECT_ID = your-gcp-project"; \
		echo ""; \
		echo "   ...or pass it inline:"; \
		echo "     GCP_PROJECT_ID=your-gcp-project make $(MAKECMDGOALS)"; \
		echo ""; \
		exit 1; \
	fi

docker-build-local: ## Build docker image for local platform only
	docker build -t $(DOCKER_IMAGE):latest .

docker-run: ## Run docker image locally, reading credentials from .env
	@if [ ! -f .env ]; then echo "❌ .env not found. Copy .env.example to .env first."; exit 1; fi
	docker run -it --rm --env-file .env $(DOCKER_IMAGE):latest

gcp-build: require-gcp-project ## Build and push multi-platform image (amd64 + arm64) to Artifact Registry
	@echo "Building Docker image for $(REGISTRY_IMAGE)..."
	docker buildx create --name multiplatform --use --bootstrap || true
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		--tag $(REGISTRY_IMAGE):latest \
		--tag $(REGISTRY_IMAGE):$(VERSION) \
		--push \
		.
	@echo "✓ Multi-platform image built and pushed successfully (no cache)"

create-jobs: require-gcp-project ## Create/update the Cloud Run jobs (injects .env as job env vars)
	PROJECT_ID=$(GCP_PROJECT_ID) IMAGE=$(REGISTRY_IMAGE):latest ./cloud-run-jobs/create-jobs.sh

create-schedulers: require-gcp-project ## Create/update the Cloud Scheduler triggers
	PROJECT_ID=$(GCP_PROJECT_ID) ./cloud-run-jobs/create-schedulers.sh

launch: require-gcp-project ## Launch cloud run jobs
	PROJECT_ID=$(GCP_PROJECT_ID) ./cloud-run-jobs/launch-jobs.sh

dev.launch: ## Run the benchmark locally
	npm run bench run
