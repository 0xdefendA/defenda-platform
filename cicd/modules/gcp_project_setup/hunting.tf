# -----------------------------------------------------------------------------
# defenda_hunting: agent- and analyst-friendly views over the events data lake.
#
# Purpose (huntA plan, phase 1): hunt agents and analysts should never do
# JSON_VALUE archaeology over raw `details` blobs. These views present the
# identity-centric grain the hunting skills reason about.
#
# Cost model: these are plain VIEWS (a saved query, no storage). BigQuery bills
# bytes scanned at query time; the events table is partitioned on utctimestamp
# so windowed queries prune. `first_seens` is the one full-history view —
# graduate it to an incrementally-maintained table (scheduled query) if/when
# scan cost shows up at hunt cadence.
# -----------------------------------------------------------------------------

resource "google_bigquery_dataset" "defenda_hunting" {
  dataset_id  = "defenda_hunting"
  project     = var.project_id
  location    = var.region
  description = "Curated views over defenda_data_lake.events for threat hunting (human and agent)"

  depends_on = [
    google_bigquery_dataset.defenda_data_lake
  ]
}

locals {
  events_table = "`${var.project_id}.defenda_data_lake.events`"
}

# --- identity_events ----------------------------------------------------------
# The workhorse. Every identity-attributed event with the common details.*
# fields lifted to real columns. Start here for "what did this identity do".
resource "google_bigquery_table" "identity_events" {
  dataset_id          = google_bigquery_dataset.defenda_hunting.dataset_id
  table_id            = "identity_events"
  project             = var.project_id
  deletion_protection = false

  description = "All identity-attributed events, flattened. Grain: one row per event. Sources: any (gcp_audit, google_workspace, cloudtrail)."

  view {
    use_legacy_sql = false
    query          = <<-SQL
      SELECT
        utctimestamp,
        eventid,
        source,
        category,
        severity,
        summary,
        JSON_VALUE(details.user)              AS identity,
        JSON_VALUE(details.sourceipaddress)   AS source_ip,
        JSON_VALUE(details.useragent)         AS user_agent,
        -- Which Cloud Audit Log stream this came from: activity | data_access |
        -- system_event | policy_denied. Load-bearing, not metadata: data_access is
        -- OFF by default in GCP and only exists where explicitly enabled. A hunt
        -- that depends on it (impersonation, secret retrieval) must be able to ask
        -- "is this feed flowing?" rather than reading an empty result as a quiet
        -- environment.
        JSON_VALUE(details.audit_log_type)    AS audit_log_type,
        -- gcp_audit / cloudtrail action fields
        COALESCE(
          JSON_VALUE(details.methodname),
          JSON_VALUE(details.eventname)
        )                                     AS action,
        COALESCE(
          JSON_VALUE(details.servicename),
          JSON_VALUE(details.eventsource)
        )                                     AS service,
        JSON_VALUE(details.resourcename)      AS resource,
        JSON_VALUE(details.project)           AS project,
        -- google_workspace action field
        JSON_VALUE(details.events[0].name)    AS workspace_event,
        tags,
        details
      FROM ${local.events_table}
      WHERE JSON_VALUE(details.user) IS NOT NULL
    SQL
  }
}

# --- entity_daily_activity ----------------------------------------------------
# Per-identity daily rollup. The baselining view: "is today unusual for them?"
resource "google_bigquery_table" "entity_daily_activity" {
  dataset_id          = google_bigquery_dataset.defenda_hunting.dataset_id
  table_id            = "entity_daily_activity"
  project             = var.project_id
  deletion_protection = false

  description = "Per-identity, per-day activity rollup. Grain: one row per (identity, day)."

  view {
    use_legacy_sql = false
    query          = <<-SQL
      SELECT
        JSON_VALUE(details.user)                                        AS identity,
        DATE(utctimestamp)                                              AS day,
        COUNT(*)                                                        AS event_count,
        ARRAY_AGG(DISTINCT source IGNORE NULLS)                         AS sources,
        ARRAY_AGG(DISTINCT category IGNORE NULLS)                       AS categories,
        COUNT(DISTINCT JSON_VALUE(details.sourceipaddress))             AS distinct_ips,
        ARRAY_AGG(DISTINCT JSON_VALUE(details.sourceipaddress) IGNORE NULLS) AS ips,
        ARRAY_AGG(DISTINCT JSON_VALUE(details.useragent) IGNORE NULLS)  AS user_agents,
        COUNTIF(severity IN ('WARNING', 'CRITICAL'))                    AS warning_events,
        MIN(utctimestamp)                                               AS first_event_at,
        MAX(utctimestamp)                                               AS last_event_at
      FROM ${local.events_table}
      WHERE JSON_VALUE(details.user) IS NOT NULL
      GROUP BY identity, day
    SQL
  }
}

# --- first_seens --------------------------------------------------------------
# "First time we ever saw this identity with this IP / user agent / project /
# source." The novelty signal that drives hunt candidate selection.
# NOTE: full-history scan by design. Graduate to a scheduled-query table if it
# gets expensive.
resource "google_bigquery_table" "first_seens" {
  dataset_id          = google_bigquery_dataset.defenda_hunting.dataset_id
  table_id            = "first_seens"
  project             = var.project_id
  deletion_protection = false

  description = "First observation of each (identity, dimension, value). Grain: one row per (identity, dimension, value). Dimensions: source_ip, user_agent, project, source."

  view {
    use_legacy_sql = false
    query          = <<-SQL
      WITH attributed AS (
        SELECT
          JSON_VALUE(details.user)            AS identity,
          JSON_VALUE(details.sourceipaddress) AS source_ip,
          JSON_VALUE(details.useragent)       AS user_agent,
          JSON_VALUE(details.project)         AS project,
          source,
          utctimestamp
        FROM ${local.events_table}
        WHERE JSON_VALUE(details.user) IS NOT NULL
      )
      SELECT identity, 'source_ip' AS dimension, source_ip AS value,
             MIN(utctimestamp) AS first_seen_at, MAX(utctimestamp) AS last_seen_at,
             COUNT(*) AS event_count
      FROM attributed WHERE source_ip IS NOT NULL
      GROUP BY identity, value

      UNION ALL
      SELECT identity, 'user_agent' AS dimension, user_agent AS value,
             MIN(utctimestamp) AS first_seen_at, MAX(utctimestamp) AS last_seen_at,
             COUNT(*) AS event_count
      FROM attributed WHERE user_agent IS NOT NULL
      GROUP BY identity, value

      UNION ALL
      SELECT identity, 'project' AS dimension, project AS value,
             MIN(utctimestamp) AS first_seen_at, MAX(utctimestamp) AS last_seen_at,
             COUNT(*) AS event_count
      FROM attributed WHERE project IS NOT NULL
      GROUP BY identity, value

      UNION ALL
      SELECT identity, 'source' AS dimension, source AS value,
             MIN(utctimestamp) AS first_seen_at, MAX(utctimestamp) AS last_seen_at,
             COUNT(*) AS event_count
      FROM attributed WHERE source IS NOT NULL
      GROUP BY identity, value
    SQL
  }
}

# --- feed_coverage -------------------------------------------------------------
# What telemetry is ACTUALLY flowing, per source and audit stream, over the last
# 7 days. The answer to "is the feed my hunt depends on alive?"
#
# This exists because of the single worst failure mode in the huntA design: a hunt
# skill that queries a feed nobody is collecting returns zero rows, which is
# indistinguishable from a genuinely quiet environment. The skill scores perfectly
# on its eval fixture (captured where the feed DID flow), detects nothing forever
# in production, and the coverage map reports green. A skill that passes evals and
# detects nothing is worse than no skill.
#
# The orchestrator checks this before dispatching a skill whose frontmatter
# declares `requires: [gcp_data_access, ...]`, and SKIPS rather than running a hunt
# that is structurally incapable of finding anything. Silence becomes a skipped
# hunt and a visible collection gap instead of a false all-clear.
resource "google_bigquery_table" "feed_coverage" {
  dataset_id          = google_bigquery_dataset.defenda_hunting.dataset_id
  table_id            = "feed_coverage"
  project             = var.project_id
  deletion_protection = false

  description = "Which telemetry feeds are actually flowing (last 7d). Grain: one row per (source, audit_log_type). The orchestrator gates skills' `requires:` against this so a dead feed skips the hunt instead of silently returning 'nothing found'."

  view {
    use_legacy_sql = false
    query          = <<-SQL
      SELECT
        source,
        COALESCE(JSON_VALUE(details.audit_log_type), 'n/a') AS audit_log_type,
        COUNT(*)                                            AS events_7d,
        COUNT(DISTINCT JSON_VALUE(details.user))            AS distinct_identities,
        COUNT(DISTINCT JSON_VALUE(details.project))         AS distinct_projects,
        MIN(utctimestamp)                                   AS first_event_at,
        MAX(utctimestamp)                                   AS last_event_at,
        -- A feed that has not produced an event in 24h is suspect. Deadman rules
        -- own the alerting; this is the hunt-time view of the same question.
        TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(utctimestamp), HOUR) AS hours_since_last_event
      FROM ${local.events_table}
      WHERE utctimestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
      GROUP BY source, audit_log_type
    SQL
  }
}

# --- iam_changes --------------------------------------------------------------
# Control-plane persistence/privilege hunting. This is where stratus-red-team
# gcp.persistence.invite-external-user lands (SetIamPolicy + bindingDeltas).
resource "google_bigquery_table" "iam_changes" {
  dataset_id          = google_bigquery_dataset.defenda_hunting.dataset_id
  table_id            = "iam_changes"
  project             = var.project_id
  deletion_protection = false

  description = "IAM policy changes and grants. Grain: one row per IAM-change event. Source: gcp_audit."

  view {
    use_legacy_sql = false
    query          = <<-SQL
      SELECT
        utctimestamp,
        eventid,
        JSON_VALUE(details.user)            AS identity,
        JSON_VALUE(details.methodname)      AS action,
        JSON_VALUE(details.resourcename)    AS resource,
        JSON_VALUE(details.project)         AS project,
        -- EVERY member/role touched by the SetIamPolicy call. Hunt over THESE.
        -- A single call routinely carries several bindingDeltas: if a benign
        -- roles/viewer grant sorts first, the roles/owner grant behind it is
        -- invisible to the scalar columns below. UNNEST these instead.
        JSON_VALUE_ARRAY(details.policy_members) AS granted_members,
        JSON_VALUE_ARRAY(details.policy_roles)   AS granted_roles,
        -- Scalars: the FIRST binding delta only. Kept for existing rules; a footgun
        -- for hunting. `granted_member` can name the boring grant while the
        -- interesting one hides in granted_members.
        JSON_VALUE(details.policy_member)   AS granted_member,
        JSON_VALUE(details.policy_delta)    AS policy_delta,
        JSON_VALUE(details.sourceipaddress) AS source_ip,
        severity,
        summary,
        details
      FROM ${local.events_table}
      WHERE source = 'gcp_audit'
        AND (
          'iam-policy-change' IN UNNEST(tags)
          OR LOWER(JSON_VALUE(details.methodname)) LIKE '%setiampolicy%'
          OR LOWER(JSON_VALUE(details.methodname)) LIKE '%serviceaccountkey%'
          OR LOWER(JSON_VALUE(details.methodname)) LIKE '%createserviceaccount%'
        )
    SQL
  }
}
