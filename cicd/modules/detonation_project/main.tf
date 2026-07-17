# -----------------------------------------------------------------------------
# detonation_project: the sacrificial project where hunt fixtures are made.
#
# huntA plan, phase 2a. Purpose: run stratus-red-team techniques against a
# throwaway project whose audit logs flow through the NORMAL ingest path into the
# production data lake. Detonation telemetry in prod is a decision, not an
# accident (see the plan's seed loop): hunt agents are time-bounded and emit
# signals at worst, and BQ rows are deletable if pollution ever matters.
#
# ---------------------------------------------------------------------------
# THIS MODULE CREATES NO SINK AND NO AUDIT CONFIG. That is deliberate.
#
# collectA owns collection, org-wide:
#   defenda-collectas/terraform/gcp_audit_sink.tf
#     - org-level aggregated sink, include_children = true
#     - org-level Data Access audit config (ADMIN_READ + DATA_READ)
#
# It picks this project up automatically the moment the project exists under the
# org. A project-scoped sink here would publish every entry to
# defenda-event-ingest TWICE.
#
# More importantly, a project-scoped AUDIT CONFIG here would be actively harmful.
# It would make the detonation project RICHER than production: the hunt agent
# learns to hunt on GenerateAccessToken, writes a skill keyed on it, scores
# perfectly against its eval fixture forever -- and detects nothing in prod,
# because no other project emits those logs. A skill that passes evals and detects
# nothing is worse than no skill; it makes the coverage map lie.
#
# The detonation environment must MATCH the production telemetry surface, or the
# seed loop encodes fiction. So Data Access is enabled at the org (collectA), not
# here, and this project is telemetrically identical to every other project in the
# org -- it just happens to have an attacker in it.
#
# PRECONDITION: this project must live under the org collectA's sink covers.
# Otherwise detonations produce telemetry that never reaches the lake, and the
# whole exercise silently measures nothing. Enforced below.
# ---------------------------------------------------------------------------
#
# This same wiring later carries the deadman detonations (plan phase 7) --
# scheduled canary attacks asserting the whole chain, detonation through
# accumulation, still works.
# -----------------------------------------------------------------------------

terraform {
  required_providers {
    google = {
      source = "hashicorp/google"
    }
    random = {
      source = "hashicorp/random"
    }
  }
}

# --- Naming -------------------------------------------------------------------
# GCP project IDs are globally unique across ALL of GCP, not just your org -- a
# fixed "defenda-detonation" will eventually collide with someone else's.
#
# The randomness earns its keep twice over. huntA's deadman phase has a novelty
# problem: first_seens is first-EVER, so a static canary in a static project stops
# being novel on the second run, and novelty-driven hunts legitimately go quiet
# while the deadman screams. A fresh project + fresh canary per campaign makes
# every detonation genuinely novel telemetry, so the novelty hunts stay honest.
# Detonation projects are meant to be ephemeral: create, detonate, export the
# fixture, destroy.
resource "random_id" "campaign" {
  byte_length = 4

  # Change this to force a brand-new project + canary (i.e. a new campaign).
  keepers = {
    campaign = var.campaign_name
  }
}

locals {
  suffix       = random_id.campaign.hex
  project_id   = var.detonation_project_id != "" ? var.detonation_project_id : "${var.name_prefix}-${local.suffix}"
  canary_id    = "${var.canary_account_id}-${local.suffix}"
  canary_email = "${local.canary_id}@${local.project_id}.iam.gserviceaccount.com"
}

# --- The sacrificial project --------------------------------------------------
# Optional: set create_project = false and pass detonation_project_id to point at
# a project you made by hand.
resource "google_project" "detonation" {
  count = var.create_project ? 1 : 0

  name            = local.project_id
  project_id      = local.project_id
  org_id          = var.organization_id
  billing_account = var.billing_account

  # It's sacrificial. Let terraform destroy actually destroy it.
  deletion_policy = "DELETE"

  labels = {
    purpose  = "hunta-detonation"
    campaign = var.campaign_name
    # Anything reading the lake can attribute events back to a campaign.
    ephemeral = "true"
  }
}

# --- APIs the techniques need -------------------------------------------------
resource "google_project_service" "detonation_apis" {
  for_each = toset([
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "secretmanager.googleapis.com",
    "logging.googleapis.com",
    "compute.googleapis.com",
  ])

  project            = local.project_id
  service            = each.key
  disable_on_destroy = false

  depends_on = [google_project.detonation]
}

# --- The canary identity ------------------------------------------------------
# Detonations run as this service account so every resulting event is
# attributable. That attribution IS the ground-truth label for the eval fixture
# (tools/export_fixture.py), and it is how the deadman rule correlates
# "detonation at T" with "signal about this identity by T+N".
#
# Hunt skills must NEVER name it. The deadman assertion rule knows it; the agents
# do not. A skill that greps for the canary proves nothing when the canary fires.
#
# Rotates with the campaign suffix -- see the novelty note on random_id above.
resource "google_service_account" "canary" {
  project      = local.project_id
  account_id   = local.canary_id
  display_name = "huntA detonation canary (${var.campaign_name})"
  description  = "Identity that stratus-red-team detonations run as. Not a real user. Never named in hunt skills."

  depends_on = [google_project_service.detonation_apis]

  lifecycle {
    # Catch the config that would otherwise fail deep in the apply with a
    # confusing "project not found": bring-your-own-project mode without
    # actually naming the project, which leaves local.project_id pointing at a
    # randomly-named project nobody created.
    precondition {
      condition     = var.create_project || var.detonation_project_id != ""
      error_message = "create_project = false requires detonation_project_id to name an existing project. Otherwise leave create_project = true and let the module generate an ephemeral, randomly-named one."
    }

    # The org sink is what delivers Admin Activity logs from this project. If the
    # project is not under that org, detonations produce telemetry that never
    # reaches the lake, and the whole exercise silently measures nothing.
    precondition {
      condition     = !var.create_project || var.organization_id != ""
      error_message = "organization_id is required when creating the project: it MUST be the org covered by collectA's include_children audit sink, or Admin Activity logs never reach defenda-event-ingest."
    }
  }
}

# Permissions the stratus GCP techniques require. Broad on purpose -- this is an
# attacker identity in a throwaway project. It has NO access to the platform
# project.
resource "google_project_iam_member" "canary_roles" {
  for_each = toset([
    "roles/iam.serviceAccountAdmin",         # create-admin-service-account, backdoor-service-account-policy
    "roles/iam.serviceAccountKeyAdmin",      # create-service-account-key
    "roles/iam.serviceAccountTokenCreator",  # impersonate-service-accounts
    "roles/resourcemanager.projectIamAdmin", # invite-external-user, admin SA role grant
    "roles/secretmanager.admin",             # secretmanager-retrieve-secrets
  ])

  project = local.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.canary.email}"
}

# Whoever runs the detonation needs to impersonate the canary via ADC.
# (Not gcloud's auth/impersonate_service_account -- that is CLI-only and stratus
# reads ADC directly; see docs/detonation_runbook.md.)
resource "google_service_account_iam_member" "detonator_can_impersonate" {
  for_each = toset(var.detonator_principals)

  service_account_id = google_service_account.canary.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = each.key
}
