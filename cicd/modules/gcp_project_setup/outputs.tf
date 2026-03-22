output "terraform_state_bucket_name" {
  description = "The name of the GCS bucket for Terraform state."
  value       = google_storage_bucket.terraform_state.name
}

output "project_number" {
  description = "The project number of the GCP project."
  value       = data.google_project.project.number
}

output "ingesta_sa_email" {
  description = "The email of the ingestA service account."
  value       = google_service_account.ingesta_sa.email
}

output "alerta_sa_email" {
  description = "The email of the alertA service account."
  value       = google_service_account.alerta_sa.email
}

output "pubsub_topic_id" {
  description = "The ID of the ingest Pub/Sub topic."
  value       = google_pubsub_topic.defenda_event_ingest.id
}

output "pubsub_topic_name" {
  description = "The name of the ingest Pub/Sub topic."
  value       = google_pubsub_topic.defenda_event_ingest.name
}
