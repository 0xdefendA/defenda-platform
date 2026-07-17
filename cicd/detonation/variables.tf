variable "detonation_project_id" {
  description = "The sacrificial project (created by hand first -- gcloud projects create). MUST live under the org collectA's audit sink covers."
  type        = string
}

variable "platform_project_id" {
  description = "The defendA platform project -- owns the data lake the fixtures are read from."
  type        = string
}

variable "region" {
  description = "GCP region."
  type        = string
  default     = "us-central1"
}

variable "campaign_name" {
  description = "This campaign's name. Rotate it (and the project) for a fresh canary, so first_seens novelty stays honest across repeat detonations."
  type        = string
  default     = "seed"
}

variable "detonator_principals" {
  description = <<-DESC
    Who may impersonate the canary via ADC, e.g. ["user:someone@somewhere.com"].
    Required to run stratus as the canary. See the runbook: use
    `gcloud auth application-default login --impersonate-service-account`, NOT the
    gcloud-only `config set auth/impersonate_service_account`.
  DESC
  type        = list(string)
}
