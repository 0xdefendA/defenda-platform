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
| audit_log_type | `activity` \| `data_access` \| `system_event` \| `policy_denied`. See `feed_coverage` — `data_access` is off by default in GCP and only exists where enabled |
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

### `feed_coverage` — is my feed even alive?
Grain: one row per (source, audit_log_type), last 7 days.

`events_7d`, `distinct_identities`, `distinct_projects`, `first_event_at`,
`last_event_at`, `hours_since_last_event`.

**Check this before trusting an empty result.** A hunt that queries a feed nobody
collects returns zero rows — which looks exactly like a quiet environment. That is
the worst failure mode in this design: the skill scores perfectly on its eval
fixture, detects nothing in production forever, and the coverage map reports green.

If your hunt depends on Data Access events (impersonation via `GenerateAccessToken`,
secret retrieval via `AccessSecretVersion`), confirm `audit_log_type = 'data_access'`
actually has recent events **in the projects you are hunting** before concluding
"no impersonation happened." Declare the dependency in skill frontmatter
(`requires: [gcp_data_access]`) so the orchestrator skips the hunt rather than
letting it return a false all-clear.

### `iam_changes` — control-plane persistence/privilege
Grain: one row per IAM-change event (source: `gcp_audit`).

`identity`, `action`, `resource`, `project`, **`granted_members[]`**,
**`granted_roles[]`**, `granted_member`, `policy_delta`, `source_ip`, `severity`,
`summary`, `details`.

**Use `granted_members` (the array), not `granted_member` (the scalar).** One
`SetIamPolicy` call can change several bindings at once. The scalar columns are the
*first* delta only, kept for existing rules. If a benign `roles/viewer` grant sorts
first, an external `roles/owner` grant in the same call is invisible to the scalar —
and the hunt returns clean. `UNNEST(granted_members)`.

Covers `SetIamPolicy`, service-account creation, and service-account key
creation. This is where `stratus-red-team gcp.persistence.invite-external-user`
lands: look for `granted_member` outside your org's domains.

⚠️ `granted_member` and `policy_delta` are **unverified** — see Verification
Status below. An empty external-grant result may mean "no external grants" or
may mean the extraction failed. Do not read silence as safety here yet.

## Current Telemetry (2026-07)

| source | what it gives |
| --- | --- |
| `gcp_audit` | GCP Admin Activity: IAM changes, resource CRUD, service-account use |
| `google_workspace` | logins, admin actions, OAuth grants, Drive activity |

Blind spots (per the huntA coverage map): endpoint execution, raw network/DNS,
AWS control plane (CloudTrail not yet collected). Hunts should declare their
`requires:` sources so unavailable ones are skipped rather than silently
returning empty.

> **Data Access logs are OFF by default in GCP** and are enabled **org-wide** by
> collectA (`defenda-collectas/terraform/gcp_audit_sink.tf`). Without them,
> `GenerateAccessToken` (service-account impersonation), `AccessSecretVersion`
> (secret retrieval), and `TestIamPermissions` (enumeration) are invisible — a
> **collection** gap wearing a detection gap's costume.
>
> Org-wide rather than detonation-project-only, on purpose: a detonation project
> richer than production would teach hunt agents to write skills against telemetry
> that exists nowhere else. Perfect eval scores, zero production detections.
>
> **The log types are counterintuitive — check before trimming the config:**
>
> * `iam.googleapis.com` has **no `DATA_READ` methods at all**. A `DATA_READ` block
>   on it applies cleanly and does nothing.
> * `GenerateAccessToken` — impersonation, the highest-value cloud lateral-movement
>   signal — is **`ADMIN_READ`**, not `DATA_READ`.
> * `iamcredentials.googleapis.com` **cannot be configured independently**; it rides
>   on `iam.googleapis.com`. Naming it in an audit config silently no-ops.
>
> So `ADMIN_READ` on `iam.googleapis.com` is the line that actually buys
> impersonation visibility, and it is exactly the line a reasonable person would
> have omitted.

## Verification Status

**These views have not yet been validated against real attack telemetry.** The
mapping claims below were written from the shape of the GCP audit log, not from
detonated evidence. huntA phase 2a exists to fix that
(`docs/detonation_runbook.md`, `tools/validate_detonation.py`).

One confirmed gap is encoded as an expected-failure unit test in
`services/ingestA/tests/test_plugin_gcp_audit.py`:

* **`bindingDeltas[0]` (certain).** `gcp_audit.py` extracts only the *first*
  binding delta from a `SetIamPolicy`. Real calls carry several. If a benign
  grant sorts first, `iam_changes.granted_member` reports the boring one and the
  interesting grant disappears — a confidently wrong answer, not a miss.

One earlier suspicion was **retired by fact-check**: `SetIamPolicy` against a
service account (`iam.googleapis.com`) was thought to omit
`serviceData.policyDelta`. stratus's published detection sample shows it carries
the delta in the same shape as project events, so the existing extraction path
covers it (asserted by a unit test). Still confirmed by live detonation.

Treat `granted_member` as unproven until the detonation says otherwise. When
hunting, corroborate with `details` rather than concluding "no external grants"
from an empty result.

## Example Hunts

```sql
-- External identities granted roles in the last 7 days.
-- NOTE the UNNEST: a SetIamPolicy call can carry several binding deltas, and the
-- scalar `granted_member` is only the FIRST one. Querying the scalar will happily
-- report a benign roles/viewer grant while an external roles/owner grant sits
-- behind it in the same call, and return "no external grants."
SELECT utctimestamp, identity, member AS granted_member, policy_delta, resource
FROM `PROJECT.defenda_hunting.iam_changes`, UNNEST(granted_members) AS member
WHERE utctimestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
  AND NOT REGEXP_CONTAINS(member, r'@(yourdomain\.com|.*\.iam\.gserviceaccount\.com)$')
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
