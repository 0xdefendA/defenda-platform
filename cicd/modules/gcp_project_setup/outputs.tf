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

output "responda_sa_email" {
  description = "The email of the respondA service account."
  value       = google_service_account.responda_sa.email
}

output "pubsub_topic_id" {
  description = "The ID of the Pub/Sub topic for event ingestion"
  value       = google_pubsub_topic.defenda_event_ingest.id
}

output "alerta_evaluate_topic_id" {
  description = "The ID of the Pub/Sub topic for alertA rule evaluation"
  value       = google_pubsub_topic.defenda_alerta_evaluate.id
}

output "pubsub_topic_name" {
  description = "The name of the ingest Pub/Sub topic."
  value       = google_pubsub_topic.defenda_event_ingest.name
}
