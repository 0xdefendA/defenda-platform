variable "project_id" {
  description = "The GCP project ID."
  type        = string
}

variable "region" {
  description = "The GCP region for resources."
  type        = string
}

variable "zone" {
  description = "The GCP zone for resources (if needed)."
  type        = string
  default     = "us-central1-c"
}
