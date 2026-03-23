# Phase 3: Building alertA (Alerting Engine)

## Goal
Migrate the `alertA` engine from a standalone Docker/MongoDB architecture to a serverless GCP Cloud Run service. This service will execute queries against BigQuery to detect anomalies and write alert state documents to Firestore.

## Prerequisites
1. Phase 1 & 2 are complete. Logs are successfully flowing into BigQuery.
2. The legacy `alertA` rules/signatures are available for reference.

## Steps

### 1. Project Setup
- Navigate to `services/alertA/`.
- Initialize a Python project.
- Install dependencies: `fastapi`, `uvicorn`, `google-cloud-bigquery`, `google-cloud-firestore`.

### 2. Define the Shared Alert Model
- In `shared/models/alert.py` (or equivalent), define the Pydantic model or TypedDict for an Alert document. It should include fields like:
  - `alert_id` (UUID)
  - `rule_name`
  - `severity`
  - `status` ("OPEN", "ACKNOWLEDGED", "RESOLVED")
  - `created_at`
  - `raw_event_data` (A snapshot of the triggering log)

### 3. Creating the Rules Engine
- Port the legacy MongoDB aggregation queries into BigQuery standard SQL.
- *Example Transformation*: Change old queries looking for specific dates to use BigQuery time partitioning: `WHERE utctimestamp > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 5 MINUTE)`.
- Store these SQL queries as YAML or JSON files in `services/alertA/rules/`.

### 4. Creating the FastAPI Web Server (Scheduler Target)
- Create `services/alertA/src/main.py`.
- Define an endpoint `POST /run-rules` that Cloud Scheduler will invoke.
- When invoked:
  1. Iterate through the rules in the `rules/` directory.
  2. Execute the BigQuery SQL for each rule using the BigQuery Python SDK.
  3. If rows are returned (indicating an anomaly), check Firestore to see if an active alert already exists for this specific entity (to avoid alert fatigue/spam).
  4. If a new alert is required, write an Alert document to the Firestore `alerts` collection.

### 5. Containerization
- Write a `Dockerfile` in `services/alertA/`.
- Use a lightweight Python base image, install dependencies, and run `uvicorn main:app --host 0.0.0.0 --port $PORT`.

### 6. Deployment
- Build and push the Docker image to Google Artifact Registry.
- Update the Terraform configuration to deploy *this* new image to the `alertA` Cloud Run service.
- Run `terraform apply`.

## Success Criteria
- The Cloud Scheduler triggers `POST /run-rules` successfully every minute.
- Introducing a malicious log payload via Pub/Sub (simulating an attack) correctly triggers a BigQuery rule match during the next scheduler run.
- A new document successfully appears in the Firestore `alerts` collection with the correct status and metadata.