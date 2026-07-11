#!/usr/bin/env python3
"""
validate_detonation.py -- huntA phase 2a.

After detonating stratus-red-team techniques in the sacrificial project, prove
that the telemetry actually arrived AND that every field the hunting schema
promises is populated.

Why this exists: a hunt agent cannot find what ingest silently dropped, and a
NULL column is indistinguishable from a quiet environment. `docs/hunting_schema.md`
makes claims ("this is where invite-external-user lands") that were written from
design, not from evidence. This script is the evidence.

Output is a per-technique mapping report:

    gcp.persistence.invite-external-user
      landed in events                        PASS  (3 events)
      identity_events.identity                PASS  hunta-canary@...
      iam_changes row exists                  PASS
      iam_changes.granted_member              FAIL  <NULL>   <-- ingest gap
      iam_changes.policy_delta                PASS  ADD roles/editor user:...

Every FAIL is a specific ingest-plugin or view fix, not a mystery.

Usage:
    python tools/validate_detonation.py \\
        --project defenda-platform-prod \\
        --canary hunta-canary@sacrificial-project.iam.gserviceaccount.com \\
        --since 2026-07-11T17:00:00Z

    # limit to what you actually detonated
    python tools/validate_detonation.py ... --techniques invite-external-user,create-service-account-key
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Callable

try:
    from google.cloud import bigquery
except ImportError:
    sys.exit("pip install google-cloud-bigquery")


# --- what "landed correctly" means, per technique -----------------------------
#
# Each check is a SQL predicate over the hunting views plus the field we expect
# to be non-NULL. Keep these honest: if a check is aspirational, say so in
# `note`, because a green board built on lowered expectations is worse than a
# red one.


@dataclass
class Check:
    name: str
    sql: str
    # A row is a pass if this returns True. Default: any row at all.
    passed: Callable[[dict], bool] = lambda row: True
    note: str = ""


@dataclass
class Technique:
    id: str
    tactic: str
    why: str
    checks: list[Check] = field(default_factory=list)


def build_techniques(project: str, canary: str, since: str) -> list[Technique]:
    hunting = f"`{project}.defenda_hunting`"
    # Every query is time-filtered. The events table is partitioned on
    # utctimestamp; an unfiltered hunting query scans the entire lake.
    window = f"utctimestamp >= TIMESTAMP('{since}')"
    actor = f"identity = '{canary}'"

    def base_landing(action_like: str) -> Check:
        return Check(
            name="landed in identity_events",
            sql=f"""
                SELECT COUNT(*) AS n,
                       ANY_VALUE(identity) AS identity,
                       ANY_VALUE(action)   AS action,
                       ANY_VALUE(project)  AS project,
                       ANY_VALUE(source_ip) AS source_ip
                FROM {hunting}.identity_events
                WHERE {window} AND {actor}
                  AND LOWER(action) LIKE '{action_like}'
            """,
            passed=lambda r: r["n"] > 0,
        )

    return [
        Technique(
            id="gcp.persistence.invite-external-user",
            tactic="persistence",
            why="The happy path the gcp_audit plugin was written for "
            "(cloudresourcemanager SetIamPolicy). If this fails, nothing else "
            "is worth debugging.",
            checks=[
                base_landing("%setiampolicy%"),
                Check(
                    name="iam_changes row exists",
                    sql=f"""
                        SELECT COUNT(*) AS n
                        FROM {hunting}.iam_changes
                        WHERE {window} AND {actor}
                    """,
                    passed=lambda r: r["n"] > 0,
                ),
                Check(
                    name="iam_changes.granted_member populated",
                    sql=f"""
                        SELECT granted_member, policy_delta, action
                        FROM {hunting}.iam_changes
                        WHERE {window} AND {actor}
                          AND granted_member IS NOT NULL
                        ORDER BY utctimestamp DESC LIMIT 1
                    """,
                    passed=lambda r: bool(r.get("granted_member")),
                    note="NULL here means the SetIamPolicy landed but the member "
                    "was never extracted -- the external-grant hunt in "
                    "docs/hunting_schema.md returns empty and looks clean.",
                ),
                Check(
                    name="an external member is findable via granted_members[]",
                    sql=f"""
                        SELECT ANY_VALUE(member) AS granted_member
                        FROM {hunting}.iam_changes, UNNEST(granted_members) AS member
                        WHERE {window} AND {actor}
                          AND NOT REGEXP_CONTAINS(member,
                              r'\\.iam\\.gserviceaccount\\.com$')
                    """,
                    passed=lambda r: bool(r.get("granted_member")),
                    note="This is the documented example hunt in "
                    "docs/hunting_schema.md, run verbatim. If it does not match, "
                    "the example hunt is fiction and every analyst who copies it "
                    "gets a false all-clear.",
                ),
            ],
        ),
        Technique(
            id="gcp.persistence.create-service-account-key",
            tactic="persistence",
            why="Exercises the non-SetIamPolicy branch of the iam_changes view "
            "filter (LIKE '%serviceaccountkey%').",
            checks=[
                base_landing("%createserviceaccountkey%"),
                Check(
                    name="iam_changes catches key creation",
                    sql=f"""
                        SELECT action, resource
                        FROM {hunting}.iam_changes
                        WHERE {window} AND {actor}
                          AND LOWER(action) LIKE '%serviceaccountkey%'
                        LIMIT 1
                    """,
                    passed=lambda r: bool(r.get("action")),
                    note="A long-lived SA key is the single highest-value cloud "
                    "persistence artifact. If the view misses it, the "
                    "persistence skill is built on sand.",
                ),
            ],
        ),
        Technique(
            id="gcp.persistence.create-admin-service-account",
            tactic="persistence",
            why="Multi-event sequence: CreateServiceAccount THEN SetIamPolicy "
            "granting it owner. Tests whether the agent can link two events -- "
            "and whether a multi-binding delta loses the owner grant "
            "(see the deltas[0] xfail in test_plugin_gcp_audit.py).",
            checks=[
                base_landing("%createserviceaccount"),
                Check(
                    name="both create AND grant are present",
                    sql=f"""
                        SELECT
                          COUNTIF(LOWER(action) LIKE '%createserviceaccount') AS creates,
                          COUNTIF(LOWER(action) LIKE '%setiampolicy%')        AS grants
                        FROM {hunting}.iam_changes
                        WHERE {window} AND {actor}
                    """,
                    passed=lambda r: r["creates"] > 0 and r["grants"] > 0,
                    note="Only one of the two present = the agent sees half an "
                    "attack and will likely call it benign.",
                ),
                Check(
                    name="the owner-role grant survived delta extraction",
                    sql=f"""
                        SELECT ANY_VALUE(policy_delta) AS policy_delta,
                               ANY_VALUE(role)         AS role
                        FROM {hunting}.iam_changes, UNNEST(granted_roles) AS role
                        WHERE {window} AND {actor}
                          AND LOWER(role) LIKE '%owner%'
                    """,
                    passed=lambda r: bool(r.get("role")),
                    note="Regression check on the bindingDeltas[0] bug (fixed "
                    "2026-07-11). If the owner grant is missing while the SA "
                    "creation is present, multi-delta extraction broke again and "
                    "every external-grant hunt is quietly reporting the wrong "
                    "member.",
                ),
            ],
        ),
        Technique(
            id="gcp.persistence.backdoor-service-account-policy",
            tactic="persistence",
            why="SetIamPolicy scoped to a SERVICE ACCOUNT (iam.googleapis.com), "
            "not a project. Predicted to expose the serviceData shape gap.",
            checks=[
                base_landing("%setiampolicy%"),
                Check(
                    name="event reaches the iam_changes view at all",
                    sql=f"""
                        SELECT COUNT(*) AS n
                        FROM {hunting}.iam_changes
                        WHERE {window} AND {actor}
                          AND LOWER(resource) LIKE '%serviceaccount%'
                    """,
                    passed=lambda r: r["n"] > 0,
                ),
                Check(
                    name="granted_member populated for SA-scoped policy",
                    sql=f"""
                        SELECT granted_member, resource
                        FROM {hunting}.iam_changes
                        WHERE {window} AND {actor}
                          AND LOWER(resource) LIKE '%serviceaccount%'
                          AND granted_member IS NOT NULL
                        LIMIT 1
                    """,
                    passed=lambda r: bool(r.get("granted_member")),
                    note="EXPECTED PASS. stratus's published sample shows "
                    "iam.googleapis.com SetIAMPolicy carries "
                    "serviceData.policyDelta.bindingDeltas like project events, "
                    "so the plugin should extract it. If this is NULL, real GCP "
                    "diverged from the documented sample -- capture the raw "
                    "payload and fix the plugin.",
                ),
            ],
        ),
        Technique(
            id="gcp.privilege-escalation.impersonate-service-accounts",
            tactic="privilege_escalation",
            why="DATA ACCESS log (GenerateAccessToken on iamcredentials). The ONLY "
            "technique that exercises the Data Access path we enabled org-wide. If "
            "stratus broke, use the hand-rolled atomic in the runbook -- do not skip "
            "it, this is the one we spent the audit-config decision on.",
            checks=[
                # First question: is the Data Access FEED alive at all? Separate from
                # attribution. If GenerateAccessToken appears from ANYONE in the
                # window, the feed works and the audit_config took. If it appears from
                # nobody, the whole credential-access class is blind -- and that is a
                # collection finding, not an agent failure.
                Check(
                    name="Data Access feed is alive (any GenerateAccessToken)",
                    sql=f"""
                        SELECT COUNT(*) AS n, ANY_VALUE(identity) AS identity
                        FROM {hunting}.identity_events
                        WHERE {window}
                          AND LOWER(action) LIKE '%generateaccesstoken%'
                    """,
                    passed=lambda r: r["n"] > 0,
                    note="EMPTY = Data Access logging is not flowing, and every "
                    "impersonation/secret hunt is blind. Check feed_coverage and the "
                    "org audit config before blaming anything downstream. Note you "
                    "likely emitted one of these just by running the campaign "
                    "(ADC impersonation of the canary is itself a GenerateAccessToken) "
                    "-- so a truly empty result points hard at collection.",
                ),
                Check(
                    name="a canary-attributed impersonation exists",
                    sql=f"""
                        SELECT identity, action, resource
                        FROM {hunting}.identity_events
                        WHERE {window} AND {actor}
                          AND LOWER(action) LIKE '%generateaccesstoken%'
                        LIMIT 1
                    """,
                    passed=lambda r: bool(r.get("identity")),
                    note="Feed alive but nothing attributed to the canary usually "
                    "means the impersonation ran under YOUR identity (the ADC login), "
                    "not the canary. Run the runbook's hand-rolled atomic to get a "
                    "canary-attributed one the fixture can label.",
                ),
            ],
        ),
        Technique(
            id="workspace.assign-admin-role",
            tactic="persistence",
            why="Hand-rolled Workspace atomic (no stratus coverage). Validates the "
            "google_admin plugin path and that Workspace + GCP identities join on "
            "the same `identity` column -- the whole premise of identity-centric "
            "hunting.",
            checks=[
                Check(
                    name="workspace event landed",
                    sql=f"""
                        SELECT COUNT(*) AS n, ANY_VALUE(workspace_event) AS ev
                        FROM {hunting}.identity_events
                        WHERE {window}
                          AND source = 'google_workspace'
                          AND LOWER(workspace_event) LIKE '%role%'
                    """,
                    passed=lambda r: r["n"] > 0,
                ),
                Check(
                    name="workspace and gcp identities are joinable",
                    sql=f"""
                        SELECT COUNT(DISTINCT source) AS sources
                        FROM {hunting}.entity_daily_activity, UNNEST(sources) AS source
                        WHERE day >= DATE(TIMESTAMP('{since}'))
                    """,
                    passed=lambda r: r["sources"] >= 2,
                    note="entity_daily_activity should show BOTH gcp_audit and "
                    "google_workspace. If not, the identity-centric design does "
                    "not hold in practice and cross-source hunts cannot work.",
                ),
            ],
        ),
    ]


# --- runner -------------------------------------------------------------------

GREEN, RED, YELLOW, DIM, RESET = (
    "\033[32m",
    "\033[31m",
    "\033[33m",
    "\033[2m",
    "\033[0m",
)


def run(args) -> int:
    client = bigquery.Client(project=args.project)
    techniques = build_techniques(args.project, args.canary, args.since)

    if args.techniques:
        wanted = {t.strip() for t in args.techniques.split(",")}
        techniques = [
            t for t in techniques if any(w in t.id for w in wanted)
        ]
        if not techniques:
            sys.exit(f"no techniques matched {sorted(wanted)}")

    print(f"\nhuntA phase 2a -- detonation mapping report")
    print(f"  project : {args.project}")
    print(f"  canary  : {args.canary}")
    print(f"  since   : {args.since}\n")

    failures: list[tuple[str, str, str]] = []
    total = passed = 0

    for tech in techniques:
        print(f"{tech.id}  {DIM}[{tech.tactic}]{RESET}")
        print(f"  {DIM}{tech.why}{RESET}")

        for check in tech.checks:
            total += 1
            try:
                rows = list(client.query(check.sql).result())
            except Exception as exc:  # noqa: BLE001 -- a broken view IS a finding
                print(f"  {RED}ERROR{RESET} {check.name}")
                print(f"        {exc}")
                failures.append((tech.id, check.name, f"query error: {exc}"))
                continue

            row = dict(rows[0]) if rows else {}
            ok = bool(row) and check.passed(row)

            if ok:
                passed += 1
                detail = ", ".join(
                    f"{k}={v}" for k, v in row.items() if v not in (None, 0)
                )
                print(f"  {GREEN}PASS {RESET} {check.name}  {DIM}{detail[:90]}{RESET}")
            else:
                print(f"  {RED}FAIL {RESET} {check.name}  {DIM}{row or '<no rows>'}{RESET}")
                if check.note:
                    print(f"        {YELLOW}{check.note}{RESET}")
                failures.append((tech.id, check.name, check.note))
        print()

    print("-" * 72)
    print(f"{passed}/{total} checks passed")

    if failures:
        print(f"\n{RED}Ingest/schema gaps to fix before writing the first hunt skill:{RESET}")
        for tech_id, check_name, note in failures:
            print(f"  - [{tech_id}] {check_name}")
        print(
            "\nEach of these is a field a hunt agent would query, get NULL from, "
            "\nand conclude nothing happened. Fix the plugin/view, re-run, then "
            "\nexport the fixture (tools/export_fixture.py)."
        )
        return 1

    print(f"\n{GREEN}Schema holds against real attack telemetry.{RESET}")
    print("Next: tools/export_fixture.py to freeze this window as the eval fixture,")
    print("then hand the catalog + a read-only query tool to an agent with NO skill")
    print("and see if it finds the attack (huntA seed loop, step 3).")
    return 0


def main() -> int:
    default_since = (datetime.now(timezone.utc) - timedelta(hours=2)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )

    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--project", required=True, help="Platform project (owns defenda_hunting)")
    p.add_argument("--canary", required=True, help="Canary SA email that detonations ran as")
    p.add_argument(
        "--since",
        default=default_since,
        help=f"Start of the detonation window, RFC3339 (default: 2h ago = {default_since})",
    )
    p.add_argument(
        "--techniques",
        help="Comma-separated substrings to filter which techniques to check",
    )
    return run(p.parse_args())


if __name__ == "__main__":
    sys.exit(main())
