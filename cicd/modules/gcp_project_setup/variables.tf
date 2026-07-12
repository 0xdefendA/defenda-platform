variable "project_id" {
  description = "The GCP project ID."
  type        = string
}

variable "region" {
  description = "The GCP region for resources."
  type        = string
}

variable "hunt_agent_principals" {
  description = <<-DESC
    Principals allowed to impersonate the hunt-agent SA for LOCAL harness runs
    (phase 2b), e.g. ["user:someone@example.com"]. Empty = SA exists but only
    something already running AS it (a future Cloud Run job) can use it.

    Running the harness as yourself instead of impersonating this SA defeats the
    read-only guarantee -- you would query as an owner. Impersonate via ADC.
  DESC
  type        = list(string)
  default     = []
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
