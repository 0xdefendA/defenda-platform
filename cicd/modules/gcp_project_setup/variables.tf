variable "project_id" {
  description = "The GCP project ID."
  type        = string
}

variable "region" {
  description = "The GCP region for resources."
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
