# Phase 1: Infrastructure Setup (Terraform)

## Goal
Establish the foundational Google Cloud Platform (GCP) resources required to run the `defenda-platform` monorepo. This phase focuses entirely on Infrastructure as Code (IaC) and assumes empty/placeholder Cloud Run containers to establish routing.

## Prerequisites
1. A new GitHub repository `defenda-platform` initialized.
2. A GCP Project created with billing enabled. (prj-defenda-platform-adf)
3. Terraform CLI installed locally.


## Steps

### 1. Monorepo Scaffolding
Create the base directory structure according to `architecture_design.md`.
```bash
mkdir -p cicd services/ingestA/src services/alertA/src services/respondA/src shared/models
```

### 2. Terraform Provider Configuration
In `cicd/main.tf`, configure the `google` and `google-beta` providers. Ensure variables for `project_id`, `region`, and `zone` are established in `variables.tf`.
Ensure GCP APIs are enabled for the core services (Compute, Cloud Run, BigQuery, Firestore, Pub/Sub, Scheduler).

### 3. Deploy Data Storage (OLAP & OLTP)
- **BigQuery**: Define a BigQuery Dataset (`defenda_data_lake`) and a Table (`events`).
  - *Crucial*: Configure the table schema with a `JSON` column type for the `details` field, and configure time-based partitioning on the `utctimestamp` field.
- **Firestore**: Define a Firestore Database (Native mode) to hold the `alerts` collection. Use the 'default' database to take advantage of the generous free tier.

### 4. Deploy Messaging (Pub/Sub)
- Create a Pub/Sub Topic `defenda-event-ingest`.
- Create a Push Subscription for this topic. The Push Endpoint will eventually be the URL of the `ingestA` Cloud Run service.

### 5. Deploy Compute (Cloud Run Placeholders)
Deploy three basic Cloud Run services using a generic/public hello-world container image (e.g., `us-docker.pkg.dev/cloudrun/container/hello`) just to establish the URLs and IAM permissions.
1. **`ingestA-service`**: Must allow unauthenticated invocation (or configure Pub/Sub to invoke it securely via OIDC).
2. **`alertA-service`**: Must not allow unauthenticated invocation (Internal/Scheduler only).
3. **`respondA-service`**: Can allow unauthenticated invocation if it serves public frontend assets, or sit behind Identity-Aware Proxy (IAP).

### 6. Deploy Scheduling
- Create a Cloud Scheduler job named `trigger-alertA`.
- Configure it to run on a cron schedule (e.g., `* * * * *` for every minute).
- Configure the target to hit the `alertA-service` URL via OIDC authentication.

### 7. IAM & Permissions
Ensure the principle of least privilege using Terraform `google_project_iam_member` or `google_service_account_iam_binding`:
- `ingestA`'s service account needs `roles/bigquery.dataEditor`.
- `alertA`'s service account needs `roles/bigquery.dataViewer` and `roles/datastore.user`.
- Pub/Sub needs permission to invoke `ingestA`.

## Success Criteria
- Running `terraform apply` succeeds without errors.
- The BigQuery dataset and table exist with native JSON schema.
- The Firestore database exists.
- Pushing a dummy message to the Pub/Sub topic results in a successful HTTP 200 delivery to the placeholder `ingestA` Cloud Run service.
- The Cloud Scheduler triggers the `alertA` placeholder successfully.