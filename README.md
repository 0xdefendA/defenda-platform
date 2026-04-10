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

The platform follows a microservices architecture divided into three core engines:

1. 🟢 **`ingestA` (Data Lake Engine)**
   A high-throughput Cloud Run service triggered by Pub/Sub push subscriptions. It receives unstructured JSON logs, passes them through a flexible Python plugin architecture for normalization and enrichment, and streams the structured data directly into BigQuery.

2. 🟢 **`alertA` (Alerting Engine)**
   A continuous detection engine that queries the BigQuery data lake against defined security signatures to identify anomalies and updates alert states in real-time in Firestore.

3. 🟢 **`respondA` (User Interface)**
   A centralized dashboard for security analysts to view, triage, and resolve alerts, utilizing Firestore's real-time synchronization capabilities.

## Key Features

* **Native JSON Querying:** By utilizing BigQuery's native `JSON` column type, complex string-extraction functions are eliminated. Analysts can query deeply nested unstructured logs using clean dot notation (e.g., `WHERE details.eventname = 'ConsoleLogin'`).
* **Zero Partition Management:** BigQuery handles time-based partitioning automatically upon ingestion via the `utctimestamp` field, complete with a 425-day data retention auto-expiration policy.
* **Extensible Plugin System:** `ingestA` features a priority-queue-based plugin system to easily add custom normalization (e.g., CloudTrail, GSuite) and enrichment (e.g., IP addresses, Threat Intel) rules to incoming logs on the fly.
* **Serverless Portability:** Standard Docker containers on Cloud Run prevent vendor lock-in and make local testing trivial.

## Project Structure

```text
defenda-platform/
├── cicd/
│   ├── modules/gcp_project_setup/  # Core GCP infrastructure (BigQuery, Pub/Sub, IAM)
│   └── prod/                       # Environment deployments (Cloud Build, Cloud Run)
├── services/
│   ├── ingestA/                    # Python/FastAPI log ingestion service
│   ├── alertA/                     # Alerting detection engine
│   └── respondA/                   # Analyst response UI
└── shared/                         # Shared models and schemas
```

## Getting Started

Deployment is entirely managed via Infrastructure as Code (Terraform) combined with Cloud Build for container orchestration.

### Prerequisites
* Google Cloud SDK (`gcloud`) authenticated and configured.
* Terraform installed locally.
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


### Tests
```
cd services/ingestA/src && PYTHONPATH=. uv run pytest ../tests/ && cd ../../alertA && PYTHONPATH=src uv run pytest tests/
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

`npm run dev` in that directory to start the web ui