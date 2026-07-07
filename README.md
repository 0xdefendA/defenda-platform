# defendA-platform

`defendA-platform` is a unified, cloud-native security data lake and response platform deployed entirely on Google Cloud Platform (GCP).

It represents the evolution of legacy AWS-based log management and MongoDB-based alerting engines into a cohesive, highly scalable, and zero-maintenance serverless monorepo.

## Architecture Overview

The platform uses GCP's fully managed, serverless offerings to handle unstructured log ingestion, real-time alerting, and incident response without the operational overhead of managing servers or partitions.

* **Messaging:** Cloud Pub/Sub
* **Compute:** Cloud Run
* **Data Lake (OLAP):** BigQuery (Native JSON columns, partitioned)
* **State Management (OLTP):** Firestore Native
* **CI/CD:** Cloud Build & Artifact Registry managed via Terraform

## Core Services

The platform follows a microservices architecture divided into four core engines:

1. 🟢 **`ingestA` (Data Lake Engine)**
   A high-throughput Cloud Run service triggered by Pub/Sub push subscriptions. It receives unstructured JSON logs, passes them through a flexible Python plugin architecture for normalization and enrichment, and streams the structured data directly into BigQuery.

2. 🟢 **`alertA` (Alerting Engine)**
   A continuous detection engine (every minute via Cloud Scheduler) that queries the BigQuery data lake against detection rules and writes alert state to Firestore. Supports three rule types:
   * **threshold** — fires when matching events meet a count, grouped by an aggregation key (X failed logins by username)
   * **deadman** — fires when expected events are *missing* over a configurable lookback window (a quiet log pipeline); repeated triggers fold into one open alert with a hit counter rather than re-alerting every cycle
   * **sequence** — multi-slot rules where each slot (threshold or deadman) must trigger in order within a lifespan, with cross-slot templating (`{{slots.0.events.0.details.user_name}}`)

   Newly created alerts can notify Slack (webhook URL, severity threshold, and Block Kit template configured in the UI Settings screen).

3. 🟢 **`queryA` (Event Query Engine)**
   A read-only API that lets analysts explore the events table from the UI using the same criteria syntax detection rules use — so an exploratory query can be promoted directly into a detection. Runs as a least-privilege service account with query byte caps and criteria validation.

4. 🟢 **`respondA` (User Interface)**
   The analyst SPA (React + Firestore realtime):
   * **Alerts** — triage queue with claim/resolve/escalate, live presence, customizable columns (any event field; drag to reorder/resize; sortable), and client-side filter conditions
   * **Incidents** — incident workspace (timeline, theories, tasks) and a list with the same column/filter treatment
   * **Events** — query builder (structured or raw criteria), click-to-filter/add-column/copy from any event's JSON, and "create alert from this query"
   * **Detections** — live rules with enable/disable, edit, download-as-YAML, delete
   * **Settings** — Slack notification configuration
   * Analyst profiles (display name, title, avatar) that flow through presence indicators and assignee displays

## Detections as Code (and as Data)

Rules are YAML in both cases — only the delivery differs:

* **Repo rules** (`services/alertA/rules/*.yml`) ship in the container and go through code review.
* **Firestore rules** (`rules` collection) are created live from the Events screen and evaluated within a minute — no redeploy. Good ones can be downloaded as YAML from the Detections screen and promoted into the repo.

Example threshold rule:

```yaml
---
alert_name: "aws_console_login"
alert_type: "threshold"
category: "authentication"
criteria: "source='cloudtrail' AND STRING(details.eventname) = 'ConsoleLogin'"
severity: "INFO"
summary: "User {{metadata.value}} {{metadata.count}} console logins"
event_snippet: "{{details.useridentity.arn}} from IP {{details.sourceipaddress}}"
event_sample_count: 5
threshold: 1
aggregation_key: "details.useridentity.arn"
tags:
  - "login"
  - "aws"
```

Optional fields: `lookback_minutes` (BigQuery time window, default 5 — deadman rules usually want longer), and for sequences `lifespan` (e.g. `"7 days"`) plus `slots`.

## Key Features

* **Native JSON Querying:** BigQuery's native `JSON` column type means analysts query deeply nested logs with dot notation (e.g. `JSON_VALUE(details.eventname) = 'ConsoleLogin'`) — in ad-hoc queries and rule criteria alike.
* **Query-to-Detection Workflow:** hunt in the Events screen, then save the same criteria as a live detection rule without leaving the UI.
* **Zero Partition Management:** BigQuery handles time-based partitioning automatically via the `utctimestamp` field, complete with a 425-day data retention auto-expiration policy.
* **Extensible Plugin System:** `ingestA` features a priority-queue-based plugin system to easily add custom normalization (e.g., CloudTrail, GSuite) and enrichment (e.g., IP addresses, Threat Intel) rules to incoming logs on the fly.
* **Real-time Collaboration:** Firestore listeners drive live alert/incident state, analyst presence indicators, and profile-aware assignee displays.
* **Serverless Portability:** Standard Docker containers on Cloud Run prevent vendor lock-in and make local testing trivial.

## Security Posture

* `respondA` analysts authenticate via Firebase Auth; Firestore security rules gate all collections (presence and profile docs are writable only by their owner).
* `queryA` verifies Firebase ID tokens per request and runs read-only against BigQuery with a bytes-billed cap.
* `ingestA`/`alertA` verify Google-signed OIDC tokens from Pub/Sub and Cloud Scheduler (`PUSH_SA_EMAIL` env), so public invokability doesn't mean forgeable pushes.

## Project Structure

```text
defenda-platform/
├── cicd/
│   ├── modules/gcp_project_setup/  # Core GCP infrastructure (BigQuery, Pub/Sub, IAM)
│   └── prod/                       # Environment deployments (Cloud Build, Cloud Run)
├── services/
│   ├── ingestA/                    # Python/FastAPI log ingestion service
│   ├── alertA/                     # Alerting detection engine (+ rules/*.yml)
│   ├── queryA/                     # Ad-hoc event query API
│   └── respondA/                   # Analyst response UI (React/Vite, Firestore)
└── shared/                         # Shared models and schemas
```

## Getting Started

Deployment is entirely managed via Infrastructure as Code (Terraform) combined with Cloud Build for container orchestration.

### Prerequisites
* Google Cloud SDK (`gcloud`) authenticated and configured.
* Terraform installed locally.
* Firebase CLI (`firebase-tools`) for deploying Firestore security rules.
* A target GCP Project with billing enabled.

### Deployment

1. **Configure Environment:**
   Navigate to the production deployment directory and copy the example variable file.
   ```bash
   cd cicd/prod
   cp terraform.tfvars.example terraform.tfvars
   ```
   Edit `terraform.tfvars` to include your specific GCP `project_id` and `region`.

2. **Initialize Terraform:**
   Initialize the Terraform backend and modules.
   ```bash
   terraform init
   ```

3. **Deploy:**
   Apply the configuration. Terraform will automatically provision the infrastructure, trigger Cloud Build to compile the Docker containers, push them to Artifact Registry, and deploy the fully configured Cloud Run services.
   ```bash
   terraform apply
   ```

4. **Deploy Firestore security rules** (required whenever `firestore.rules` changes):
   ```bash
   cd services/respondA
   firebase deploy --only firestore:rules
   ```

### Tests

Python services (uv, Python 3.12+):
```bash
cd services/ingestA/src && PYTHONPATH=. uv run pytest ../tests/
cd services/alertA && PYTHONPATH=src uv run pytest tests/
cd services/queryA && PYTHONPATH=src uv run pytest tests/
```

respondA (vitest — criteria compilation, rule YAML generation, filters):
```bash
cd services/respondA && npm install && npm test
```

### Running locally

To get your Firebase API Key and other configuration details, follow these steps in the Firebase Console:

### 1. Access the Firebase Console
Go to console.firebase.google.com (https://console.firebase.google.com/) and sign in with your Google account.

### 2. Select Your Project
Click on the project tile for your defenda-platform (or whichever project you are using for this deployment).

### 3. Open Project Settings
Click the Gear icon (⚙️) next to "Project Overview" in the left-hand sidebar and select Project settings.

### 4. Locate Your Web App
Under the General tab, scroll down to the Your apps section:
• If you already have a Web App: You will see it listed there.
• If you don't have one: Click the </> (Web) icon to register a new app. Give it a nickname (e.g., respondA-ui) and click Register app.

### 5. Copy the Configuration Object
Once the app is registered, look for the SDK setup and configuration section. Select the Config radio button. You will see an object like this:

const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef..."
};

### 6. Update Your Local Environment
Create a file named .env in services/respondA/ and map these values to the VITE_ prefixed variables:

VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
VITE_FIREBASE_APP_ID=1:1234567890:web:abcdef...
VITE_QUERYA_URL=http://localhost:8081

`npm run dev` in that directory to start the web ui.

For the Events screen, also run queryA locally (port 8081 matches the default `VITE_QUERYA_URL`):

```bash
cd services/queryA
PROJECT_ID=your-project-id uv run uvicorn main:app --app-dir src --reload --port 8081
```
