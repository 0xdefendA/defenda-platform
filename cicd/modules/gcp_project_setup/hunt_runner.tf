# -----------------------------------------------------------------------------
# The scheduled hunt SERVICE identity -- huntA production (services/huntA).
#
# Distinct from `hunta_agent` (hunt_agent.tf) on purpose. `hunta_agent` is the
# pristine local-harness identity: read-only over BigQuery + Vertex, and NOTHING
# else, so local iteration is maximally contained.
#
# The scheduled service needs one capability the harness does not: persist the
# report so respondA can show it. Rather than broaden the pristine agent SA, the
# service runs as its own identity that adds exactly that -- `datastore.user` --
# and nothing more.
#
# Why this does not weaken injection containment: the AGENT (the LLM) can only
# call its two registered tools -- a read-only BigQuery query and an in-memory
# write_report. It has no tool that reaches Firestore. The Firestore write happens
# in service code AFTER the loop, on a pydantic-validated report. So the runner SA
# holding datastore.user does not hand the (possibly prompt-injected) agent any
# write. Containment is the tool set, not the SA.
resource "google_service_account" "hunta_runner" {
  project      = var.project_id
  account_id   = "hunta-runner"
  display_name = "huntA scheduled service"
  description  = "Cloud Run identity for the scheduled hunt service. Read-only BigQuery + Vertex like hunta-agent, plus datastore.user to persist reports."
}

# Start query jobs (no data access on its own).
resource "google_project_iam_member" "hunta_runner_jobuser" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.hunta_runner.email}"
}

# Read ONLY the curated hunting dataset -- not the raw lake. Same scoping as the
# agent: the authorized views (hunting.tf) reach the lake; this SA cannot.
resource "google_bigquery_dataset_iam_member" "hunta_runner_hunting_viewer" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.defenda_hunting.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.hunta_runner.email}"
}

# Call Gemini on Vertex.
resource "google_project_iam_member" "hunta_runner_aiplatform" {
  project    = var.project_id
  role       = "roles/aiplatform.user"
  member     = "serviceAccount:${google_service_account.hunta_runner.email}"
  depends_on = [google_project_service.aiplatform_api]
}

# Persist hunt_reports (and read settings/notifications). Firestore IAM cannot
# scope to a collection; datastore.user is project-wide Firestore. That is the one
# capability beyond the agent's, and it is service-side only (see file header).
resource "google_project_iam_member" "hunta_runner_datastore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.hunta_runner.email}"
  depends_on = [
    google_firestore_database.database
  ]
}
