output "detonation_project_id" {
  description = "The sacrificial project. Fixtures record this as the scope of the attack window."
  value       = local.project_id
}

output "canary_service_account_email" {
  description = <<-DESC
    The identity detonations run as, and the ground-truth label for the fixture.
    Feed it to tools/validate_detonation.py, tools/export_fixture.py, the deadman
    assertion rule, and respondA's signal labelling -- never into a hunt skill.
  DESC
  value       = google_service_account.canary.email
}

output "campaign_suffix" {
  description = "Random suffix identifying this campaign. Rotating it yields a fresh project + canary, keeping first_seens novelty honest across repeat detonations."
  value       = local.suffix
}

output "impersonation_command" {
  description = "Copy-paste ADC login that makes stratus actually run as the canary."
  value       = "gcloud auth application-default login --impersonate-service-account=${google_service_account.canary.email}"
}

output "collection_note" {
  description = "Where this project's telemetry comes from. Intentionally not owned by this module."
  value = join(" ", [
    "Audit logs (Admin Activity + Data Access) reach the lake via collectA's",
    "org-level aggregated sink and org-level audit config. This module creates",
    "no sink and no audit config on purpose: the detonation project must be",
    "telemetrically IDENTICAL to every other project in the org, or hunt skills",
    "written from its fixtures will not generalize to production.",
  ])
}
