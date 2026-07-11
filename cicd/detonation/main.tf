# -----------------------------------------------------------------------------
# Detonation root -- the terraform you actually run for huntA phase 2a.
#
# This is a thin wrapper over modules/detonation_project. It is deliberately its
# own root with its own state (see backend.tf): the platform must never be able to
# `destroy` itself because a spent detonation campaign was cleaned up.
#
# WHO RUNS THIS: a human with org permissions, NOT CI. Project creation and the
# canary's roles are outside what the CI deployer SA holds, by design.
#
# LIFECYCLE:
#     terraform init -backend-config="bucket=<TF_STATE_BUCKET>"
#     terraform apply                         # stand up canary in the project
#     ...detonate + validate + export fixture (docs/detonation_runbook.md)...
#     terraform destroy                       # tear the campaign down
#
# The project itself is created by hand first (a gcloud one-off in the runbook),
# because project creation needs org-scoped grants; this root then configures the
# canary and its impersonation inside it.
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

provider "google" {
  project = var.detonation_project_id
  region  = var.region
}

module "detonation_project" {
  source = "../modules/detonation_project"

  # create_project defaults false: the project is a gcloud one-off (org-scoped).
  detonation_project_id = var.detonation_project_id
  platform_project_id   = var.platform_project_id
  region                = var.region
  campaign_name         = var.campaign_name
  detonator_principals  = var.detonator_principals
}

output "canary_service_account_email" {
  description = "Feed to validate_detonation.py / export_fixture.py; never into a skill."
  value       = module.detonation_project.canary_service_account_email
}

output "impersonation_command" {
  value = module.detonation_project.impersonation_command
}

output "detonation_project_id" {
  value = module.detonation_project.detonation_project_id
}
