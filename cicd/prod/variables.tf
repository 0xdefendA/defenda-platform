variable "project_id" {
  description = "The GCP project ID."
  type        = string
}

variable "region" {
  description = "The GCP region to deploy resources to."
  type        = string
}

variable "platform_alert_email" {
  description = <<-DESC
    Email for "the platform itself is broken" pages (monitoring.tf).

    Deliberately NOT the Slack webhook alertA uses for detections: if alertA is
    dead it cannot notify you that it is dead. The escalation path for a platform
    failure must not route through the platform.

    Leave empty to skip creating the monitoring policies -- but understand what you
    are opting out of: alertA's deadman RULES cannot detect alertA being down,
    because alertA is what evaluates them. Without these policies, a dead cron is a
    silent, green outage.
  DESC
  type        = string
  default     = ""
}

variable "hunt_agent_principals" {
  description = "Principals allowed to impersonate the read-only hunt-agent SA for local phase-2b harness runs. Empty by default."
  type        = list(string)
  default     = []
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
