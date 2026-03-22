# Phase 2: Building ingestA (Data Lake Processing)

## Goal
Replace the AWS Lambda ingestion pipelines (`s3_to_firehose.py` and `processor.py`) with a GCP Cloud Run service called `ingestA`. This service will receive HTTP push requests from Pub/Sub, run the legacy python plugins against the payload, and stream the resulting data directly into BigQuery.

## Prerequisites
1. Phase 1 (Infrastructure) is completed. Pub/Sub and BigQuery exist.
2. The legacy `defenda-data-lake` repository is accessible to port over the python plugins.

## Steps

### 1. Project Setup
- Navigate to `services/ingestA/`.
- Initialize a Python project (using `uv`).
- Install dependencies: `fastapi`, `uvicorn`, `google-cloud-bigquery`.

### 2. Porting the Legacy Plugins
- Copy the `lambdas/enrichment_plugins/`, `lambdas/normalization_plugins/`, and `lambdas/utils/` directories from the legacy `defenda-data-lake` repo into `services/ingestA/src/`.
- Ensure the plugin architecture (the priority queue and dictionary manipulation) works exactly as it did in AWS Lambda. Tests from the legacy repo should be ported and passing.

### 3. Creating the FastAPI Web Server
- Create `services/ingestA/src/main.py`.
- Define an endpoint `POST /` to receive Pub/Sub push messages.
  - *Note*: Pub/Sub push payloads are wrapped in a specific JSON envelope `{"message": {"data": "<base64_encoded_string>"}}`. The endpoint must decode this envelope.
- Pass the decoded JSON payload through the legacy plugin chain (`send_event_to_plugins`).

### 4. BigQuery Integration
- If the plugin pipeline successfully returns an enriched record, use the `google-cloud-bigquery` library's Storage Write API (or legacy `insert_rows_json`) to stream the record directly into the `defenda_data_lake.events` table.
- Log failures to stderr (which will automatically be captured by Google Cloud Logging).

### 5. Containerization
- Write a `Dockerfile` in `services/ingestA/` that uses a lightweight Python base image (e.g., `python:3.11-slim`), copies the `src/` code, installs dependencies, and runs `uvicorn main:app --host 0.0.0.0 --port $PORT`.

### 6. Deployment
- Build and push the Docker image to Google Artifact Registry.
- Update the Terraform configuration from Phase 1 to deploy *this* new image to the `ingestA` Cloud Run service instead of the placeholder.
- Run `terraform apply`.

## Success Criteria
- Producing a raw JSON log to the `defenda-log-ingest` Pub/Sub topic results in the log being parsed.
- A query to `SELECT * FROM defenda_data_lake.events` reveals the parsed, normalized, and enriched log row with native JSON in the `details` column.