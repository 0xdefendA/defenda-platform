# -----------------------------------------------------------------------------
# The watchdog that watches the watchdog.
#
# alertA's deadman RULES (services/alertA/rules/deadman_*.yml) cover feed outages
# and a degraded fan-out, and they are the right tool for that: they see the same
# events the detections see, and they fail the same way.
#
# But they share a fatal blind spot, and it is structural, not fixable in a rule:
#
#     alertA evaluates the deadman rules.
#
# If alertA's /cron stops running -- crashed container, failed deploy, scheduler
# job disabled, service deleted -- then NO rules are evaluated at all, including
# the deadman rule that says "alertA is down." The system goes perfectly silent
# and perfectly green. A watchdog cannot watch itself.
#
# That case has to be caught from OUTSIDE the platform, by infrastructure that
# does not depend on the platform being alive. That is what this file is. It is
# deliberately dumb: GCP-native metrics, no defendA code in the path.
#
# -----------------------------------------------------------------------------

resource "google_project_service" "monitoring_api" {
  project            = var.project_id
  service            = "monitoring.googleapis.com"
  disable_on_destroy = false
}

# Where the "the platform itself is down" pages go. Deliberately NOT the Slack
# webhook alertA uses for detections: if alertA is dead, it cannot notify you that
# it is dead. The escalation path for a platform failure must not route through
# the platform.
resource "google_monitoring_notification_channel" "platform_oncall" {
  count = var.platform_alert_email != "" ? 1 : 0

  project      = var.project_id
  display_name = "defendA platform on-call"
  type         = "email"

  labels = {
    email_address = var.platform_alert_email
  }

  depends_on = [google_project_service.monitoring_api]
}

locals {
  platform_channels = (
    var.platform_alert_email != ""
    ? [google_monitoring_notification_channel.platform_oncall[0].id]
    : []
  )
}

# --- alertA is erroring --------------------------------------------------------
# /cron returning 5xx means the fan-out is failing. Detections may be partially or
# wholly unevaluated, and Cloud Scheduler will be retrying into the same failure
# every minute.
resource "google_monitoring_alert_policy" "alerta_5xx" {
  count = var.platform_alert_email != "" ? 1 : 0

  project      = var.project_id
  display_name = "defendA: alertA returning 5xx (detections may not be running)"
  combiner     = "OR"

  documentation {
    content   = <<-DOC
      alertA is returning server errors. Detections may be partially or entirely
      unevaluated, and this alert is the ONLY thing that can tell you -- alertA's
      own deadman rules cannot fire if alertA is the thing that is broken.

      Check:
        gcloud logging read 'resource.labels.service_name="alerta-service" AND severity=ERROR' --limit 20

      Known prior failure (2026-07-11): a single un-serializable Firestore document
      in `inflight_alerts` raised out of the /cron fan-out loop, 500'd every run,
      and silently froze all sequence rules. The loop is now per-item guarded, but
      any NEW unguarded raise in /cron will look exactly like this again.
    DOC
    mime_type = "text/markdown"
  }

  conditions {
    display_name = "alerta-service 5xx responses"

    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"cloud_run_revision\"",
        "resource.labels.service_name = \"alerta-service\"",
        "metric.type = \"run.googleapis.com/request_count\"",
        "metric.labels.response_code_class = \"5xx\"",
      ])

      # Any 5xx at all. This service is called once a minute by a scheduler; it
      # has no organic error budget to spend.
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "300s" # sustained 5m -- ride out a single cold-start blip

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  notification_channels = local.platform_channels

  alert_strategy {
    auto_close = "3600s"
  }

  depends_on = [google_project_service.monitoring_api]
}

# --- alertA is not being called at all -----------------------------------------
# The pure-silence case: scheduler job paused, deleted, its OIDC token invalid, or
# the service gone. alertA is not erroring -- it is not RUNNING. Nothing inside the
# platform can observe this, because nothing inside the platform is executing.
#
# WHY NOT THE CLOUD SCHEDULER METRIC (cloudscheduler.googleapis.com/job/attempt_count):
#
#   1. Chicken-and-egg. Cloud Monitoring validates metric.type when the POLICY is
#      created, and a metric descriptor only exists in a project once that metric
#      has actually been WRITTEN there. On a fresh project the policy 404s at apply
#      with "Cannot find metric(s) that match type". A watchdog you cannot deploy
#      until the thing it watches has already run is a bad watchdog.
#
#   2. It measures the wrong end of the wire. attempt_count ticks when the
#      scheduler ATTEMPTS the call -- it says nothing about whether alertA received
#      it. A broken OIDC token, a deleted service, a network failure: the scheduler
#      attempts happily, the metric stays green, and detections are dead.
#
# run.googleapis.com/request_count absence is strictly better on both counts: the
# descriptor provably exists (the 5xx policy above uses it), and "alertA received
# no requests" is the question we actually mean.
#
# The causality is what makes this airtight: /cron is what publishes to the
# evaluate topic, so if cron stops, the Pub/Sub push traffic to /evaluate dries up
# too. No cron => no fan-out => no pushes => NO requests of any kind. Total silence
# on this metric means the detection loop has stopped, whatever broke it.
#
# CAVEAT, stated plainly: a metric-absence condition needs the time series to have
# EXISTED. On a brand-new deploy that has never served a request, there is no
# series to go absent from, so this will not fire until alertA is called once. It
# guards a running system, not an unborn one.
resource "google_monitoring_alert_policy" "alerta_not_running" {
  count = var.platform_alert_email != "" ? 1 : 0

  project      = var.project_id
  display_name = "defendA: alertA receiving no traffic (no detections at all)"
  combiner     = "OR"

  documentation {
    content   = <<-DOC
      alertA has received NO requests for 15 minutes. Cloud Scheduler invokes /cron
      every minute, and /cron's fan-out drives the Pub/Sub pushes to /evaluate --
      so total silence means the detection loop has stopped entirely.

      This is the failure that looks healthiest: no rules are being evaluated, no
      deadman rules are being evaluated, and nothing is running to disagree.
      Everything is green because nothing is on. alertA's own deadman rules CANNOT
      catch this -- alertA is what evaluates them.

      Check the scheduler job exists, is ENABLED, and its OIDC token is valid:
        gcloud scheduler jobs list --location=${var.region}
        gcloud run services describe alerta-service --region=${var.region}
    DOC
    mime_type = "text/markdown"
  }

  conditions {
    display_name = "No requests to alerta-service in 15m"

    condition_absent {
      filter = join(" AND ", [
        "resource.type = \"cloud_run_revision\"",
        "resource.labels.service_name = \"alerta-service\"",
        "metric.type = \"run.googleapis.com/request_count\"",
      ])

      duration = "900s" # cron is every minute; 15m of total silence is not a blip

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  notification_channels = local.platform_channels

  alert_strategy {
    auto_close = "3600s"
  }

  depends_on = [google_project_service.monitoring_api]
}
