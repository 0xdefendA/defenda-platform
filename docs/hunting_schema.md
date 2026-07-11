# Hunting Schema Catalog (`defenda_hunting`)

Curated BigQuery views over `defenda_data_lake.events`. This document is the
**map** — it is intended to be handed to hunt agents verbatim (and read by
analysts using the Events screen).

Design rule: **hunt over these views, not over raw `details` JSON.** If a hunt
needs a field that isn't here, that's a signal to add it to the schema, not to
reach into the blob.

## Conventions

* `identity` — the actor, from `details.user` (normalized by ingestA plugins).
  GCP principals are email-shaped; Workspace actors are emails. This is the
  join key across sources.
* All timestamps are UTC (`utctimestamp` in the base table).
* The base table is partitioned on `utctimestamp` — **always filter on time**
  or the query scans everything.

## Views

### `identity_events` — the workhorse
Grain: one row per identity-attributed event.

| column | notes |
| --- | --- |
| utctimestamp, eventid, source, category, severity, summary | base event fields |
| identity | the actor |
| source_ip, user_agent | request metadata |
| action | GCP `methodName` / CloudTrail `eventName` (unified) |
| service | GCP `serviceName` / CloudTrail `eventSource` (unified) |
| resource, project | GCP target |
| workspace_event | Workspace event name (e.g. `login_success`) |
| tags, details | raw arrays/JSON if you must go deeper |

Start here for "what did this identity do".

### `entity_daily_activity` — baselining
Grain: one row per (identity, day).

`event_count`, `sources[]`, `categories[]`, `distinct_ips`, `ips[]`,
`user_agents[]`, `warning_events`, `first_event_at`, `last_event_at`.

Answers "is today unusual for this identity relative to their own history".

### `first_seens` — novelty
Grain: one row per (identity, dimension, value).
Dimensions: `source_ip`, `user_agent`, `project`, `source`.

`first_seen_at`, `last_seen_at`, `event_count`.

The novelty signal — new IP, new user agent, new project for an identity.
Drives hunt **candidate selection**. Note this view scans full history by
design; filter by `first_seen_at` for recent novelty.

### `iam_changes` — control-plane persistence/privilege
Grain: one row per IAM-change event (source: `gcp_audit`).

`identity`, `action`, `resource`, `project`, `granted_member`, `policy_delta`,
`source_ip`, `severity`, `summary`, `details`.

Covers `SetIamPolicy`, service-account creation, and service-account key
creation. This is where `stratus-red-team gcp.persistence.invite-external-user`
lands: look for `granted_member` outside your org's domains.

## Current Telemetry (2026-07)

| source | what it gives |
| --- | --- |
| `gcp_audit` | GCP Admin Activity: IAM changes, resource CRUD, service-account use |
| `google_workspace` | logins, admin actions, OAuth grants, Drive activity |

Blind spots (per the huntA coverage map): endpoint execution, raw network/DNS,
AWS control plane (CloudTrail not yet collected). Hunts should declare their
`requires:` sources so unavailable ones are skipped rather than silently
returning empty.

## Example Hunts

```sql
-- External identities granted roles in the last 7 days
SELECT utctimestamp, identity, granted_member, policy_delta, resource
FROM `PROJECT.defenda_hunting.iam_changes`
WHERE utctimestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
  AND granted_member IS NOT NULL
  AND NOT REGEXP_CONTAINS(granted_member, r'@(yourdomain\.com|.*\.iam\.gserviceaccount\.com)$')
ORDER BY utctimestamp DESC;

-- Identities acting from a source IP never seen before this week
SELECT f.identity, f.value AS new_ip, f.first_seen_at, f.event_count
FROM `PROJECT.defenda_hunting.first_seens` f
WHERE f.dimension = 'source_ip'
  AND f.first_seen_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
ORDER BY f.first_seen_at DESC;

-- Sudden breadth: identities touching more services than usual today
SELECT identity, day, ARRAY_LENGTH(categories) AS category_breadth, event_count
FROM `PROJECT.defenda_hunting.entity_daily_activity`
WHERE day >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)
ORDER BY category_breadth DESC, event_count DESC;
```

## Adding Views

Views live in `cicd/modules/gcp_project_setup/hunting.tf` and are deployed with
`terraform apply`. Add a view when a hunt repeatedly needs the same shaping —
and document it here, because this catalog is what the agents read.
