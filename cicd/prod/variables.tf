variable "project_id" {
  description = "The GCP project ID."
  type        = string
}

variable "region" {
  description = "The GCP region to deploy resources to."
  type        = string
}

# Sensitive variables now fetched directly from Secret Manager by Cloud Build

variable "firebase_messaging_sender_id" {
  description = "Firebase Messaging Sender ID"
  type        = string
}

variable "firebase_app_id" {
  description = "Firebase App ID"
  type        = string
}

variable "zone" {
  description = "The GCP zone for resources (if needed)."
  type        = string
  default     = "us-central1-c"
}
