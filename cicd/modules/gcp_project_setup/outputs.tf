output "ingesta_service_uri" {
  description = "The URI of the ingestA Cloud Run service."
  value       = google_cloud_run_v2_service.ingestA_service.uri
}

output "alerta_service_uri" {
  description = "The URI of the alertA Cloud Run service."
  value       = google_cloud_run_v2_service.alertA_service.uri
}

output "responda_service_uri" {
  description = "The URI of the respondA Cloud Run service."
  value       = google_cloud_run_v2_service.respondA_service.uri
}

output "terraform_state_bucket_name" {
  description = "The name of the GCS bucket for Terraform state."
  value       = google_storage_bucket.terraform_state.name
}

output "project_number" {
  description = "The project number of the GCP project."
  value       = data.google_project.project.number
}
