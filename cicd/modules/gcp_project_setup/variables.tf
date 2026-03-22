variable "project_id" {
  description = "The GCP project ID."
  type        = string
}

variable "region" {
  description = "The GCP region for resources."
  type        = string
}

variable "ingesta_image_name" {
  description = "The Docker image name for ingestA service."
  type        = string
}
