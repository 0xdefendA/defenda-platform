# -----------------------------------------------------------------------------
# The hunt agent's identity -- huntA phase 2b.
#
# The whole read-only posture of the hunt harness rests on THIS being a
# permission, not a prompt. The plan says event content is attacker-controlled and
# the agent's tools must be read-only "not merely told not to." An LLM told "only
# SELECT" can be talked out of it; an identity with no write role cannot write.
#
# What this SA can do:
#   * run query jobs                (roles/bigquery.jobUser, project level)
#   * read the curated hunting views (roles/bigquery.dataViewer on defenda_hunting)
#   * call Gemini on Vertex          (roles/aiplatform.user, project level)
#
# What it CANNOT do, by construction:
#   * read defenda_data_lake directly -- it has no grant there. It reaches the lake
#     ONLY through the authorized views (see hunting.tf). Raw-events archaeology,
#     the thing the schema exists to prevent, is not just discouraged -- it is
#     denied by IAM.
#   * write anything, anywhere. No dataEditor, no job that isn't a query.
#   * emit signals or alerts. That is phase 3; this SA is shadow-mode read-only.
#
# Worst case for a fully prompt-injected agent is therefore a bad REPORT -- never a
# write, never an action, never a page. Exactly the containment the plan promises.
resource "google_service_account" "hunta_agent" {
  project      = var.project_id
  account_id   = "hunta-agent"
  display_name = "huntA hunt agent (read-only)"
  description  = "Identity the ADK hunt agent runs as. Read-only over defenda_hunting via authorized views. No write, no lake, no signal emission."
}

# Run query jobs. jobUser is the ability to START a query; it grants NO data
# access on its own, so this is safe at project scope.
resource "google_project_iam_member" "hunta_agent_jobuser" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.hunta_agent.email}"
}

# The Vertex AI API must be ON, or aiplatform.user grants access to nothing and
# the harness fails at model-call time. Kept here (not main.tf) so the whole Vertex
# dependency -- API + role + SA -- reads as one unit.
resource "google_project_service" "aiplatform_api" {
  project            = var.project_id
  service            = "aiplatform.googleapis.com"
  disable_on_destroy = false
}

# Call the model on Vertex. The agent runs Gemini via generateContent, which needs
# aiplatform.endpoints.predict -- carried by roles/aiplatform.user.
#
# Honest scope note: aiplatform.user is broader than the one permission we use (it
# also allows creating datasets, endpoints, training jobs, etc.). There is no
# predefined "predict only" role. It does not undermine the containment story --
# the agent is driven entirely by our bounded loop and cannot initiate anything
# beyond inference, whose spend the harness already caps (max_llm_calls). If you
# want it tighter, swap this for a custom role holding only
# aiplatform.endpoints.predict; noted, not done, to avoid a custom-role to
# maintain for one permission.
resource "google_project_iam_member" "hunta_agent_aiplatform" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.hunta_agent.email}"

  # Grant is meaningless until the API exists; avoid the apply-order race.
  depends_on = [google_project_service.aiplatform_api]
}

# Read the curated views -- and ONLY the curated dataset. Dataset-level binding,
# not project-level: project-wide dataViewer would hand it defenda_data_lake too,
# collapsing the entire separation. The authorized dataset in hunting.tf is what
# lets these views reach the lake without the agent itself being able to.
resource "google_bigquery_dataset_iam_member" "hunta_agent_hunting_viewer" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.defenda_hunting.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.hunta_agent.email}"
}

# Let named principals impersonate the agent SA, so a LOCAL harness run
# (tools/hunt_harness.py, phase 2b) executes with the SA's exact least privilege
# rather than the developer's owner rights. If you run the harness as yourself,
# the IAM scoping above is theatre -- you would be querying as an owner who can
# read everything. Impersonate:
#   gcloud auth application-default login \
#     --impersonate-service-account=hunta-agent@<project>.iam.gserviceaccount.com
resource "google_service_account_iam_member" "hunta_agent_impersonators" {
  for_each = toset(var.hunt_agent_principals)

  service_account_id = google_service_account.hunta_agent.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = each.key
}
