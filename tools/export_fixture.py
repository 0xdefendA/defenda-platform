#!/usr/bin/env python3
"""
export_fixture.py -- huntA phase 2a.

Freeze a detonation window from BigQuery into a versioned fixture on disk.

The huntA plan says: "the detonation becomes that skill's permanent eval fixture."
This is that step. A fixture is worth more than the detonation that produced it --
it is what lets a skill revision be gated on "does it still catch this" forever
after, without re-detonating, and what lets the deadman canary be scored.

A fixture captures three things:

  events.jsonl   the raw normalized events in the window (what the agent sees)
  ground_truth   which events are the attack, and which technique produced them
  manifest.json  provenance: when, what was detonated, canary identity, counts

Ground truth is the part that makes it an eval rather than a pile of logs: the
canary identity IS the label. Every event attributed to the canary during the
window is attack; everything else in the window is background. That labeling is
only sound because detonations run as a dedicated identity -- which is why the
terraform creates one.

Usage:
    python tools/export_fixture.py \\
        --project defenda-platform-prod \\
        --canary hunta-canary@sacrificial-project.iam.gserviceaccount.com \\
        --since 2026-07-11T17:00:00Z --until 2026-07-11T19:00:00Z \\
        --name gcp-persistence-2026-07-11 \\
        --techniques gcp.persistence.invite-external-user,gcp.persistence.create-service-account-key

Then commit fixtures/<name>/ -- these are detections, code review applies.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    from google.cloud import bigquery
except ImportError:
    sys.exit("pip install google-cloud-bigquery")


REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURES = REPO_ROOT / "fixtures"


def fetch_window(client, project: str, since: str, until: str) -> list[dict]:
    """Everything identity-attributed in the window -- attack AND background.

    Background matters. A fixture of pure attack telemetry measures recall and
    nothing else; you cannot compute precision against an empty benign set, and
    a skill that flags literally everything would score perfectly.
    """
    sql = f"""
        SELECT
          utctimestamp, eventid, source, category, severity, summary,
          identity, source_ip, user_agent, action, service, resource, project,
          workspace_event, tags,
          TO_JSON_STRING(details) AS details_json
        FROM `{project}.defenda_hunting.identity_events`
        WHERE utctimestamp >= TIMESTAMP('{since}')
          AND utctimestamp <  TIMESTAMP('{until}')
        ORDER BY utctimestamp
    """
    rows = []
    for row in client.query(sql).result():
        d = dict(row)
        d["utctimestamp"] = d["utctimestamp"].isoformat()
        # details comes back as a JSON string; re-inflate so the fixture is
        # a faithful replay of what an agent would query, not a lossy copy.
        details = d.pop("details_json", None)
        d["details"] = json.loads(details) if details else {}
        rows.append(d)
    return rows


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--project", required=True)
    p.add_argument("--canary", required=True, help="Canary identity = the ground-truth label")
    p.add_argument("--since", required=True, help="RFC3339 start of detonation window")
    p.add_argument("--until", required=True, help="RFC3339 end of detonation window")
    p.add_argument("--name", required=True, help="Fixture name, e.g. gcp-persistence-2026-07-11")
    p.add_argument(
        "--techniques",
        required=True,
        help="Comma-separated technique IDs that ACTUALLY DETONATED. Only these. "
        "Listing one that did not run puts a lie in ground_truth.json and shows up "
        "later as a phantom recall failure -- the agent 'misses' an attack that was "
        "never in the data.",
    )
    p.add_argument(
        "--untested",
        default="",
        help="Comma-separated techniques that were PLANNED but never ran (tooling "
        "broke, etc). Recorded in the manifest as untested coverage. Do NOT put them "
        "in --techniques. See the note below on why this flag exists.",
    )
    p.add_argument("--notes", default="", help="Anything an eval reader needs to know")
    args = p.parse_args()

    client = bigquery.Client(project=args.project)
    events = fetch_window(client, args.project, args.since, args.until)

    if not events:
        sys.exit(
            "No events in the window. Either the detonation did not land, the sink "
            "is not wired, or the window is wrong. Run tools/validate_detonation.py "
            "before exporting -- exporting an empty fixture bakes a lie into the "
            "eval suite."
        )

    attack = [e for e in events if e.get("identity") == args.canary]
    background = [e for e in events if e.get("identity") != args.canary]

    if not attack:
        sys.exit(
            f"Window has {len(events)} events but NONE attributed to {args.canary}. "
            "The detonation ran as the wrong identity, or identity extraction is "
            "broken. Without canary attribution there is no ground truth and this "
            "is not a fixture."
        )

    out = FIXTURES / args.name
    out.mkdir(parents=True, exist_ok=True)

    with (out / "events.jsonl").open("w") as f:
        for e in events:
            f.write(json.dumps(e, default=str) + "\n")

    ground_truth = {
        "label_basis": "canary identity attribution",
        "canary_identity": args.canary,
        "attack_event_ids": [e["eventid"] for e in attack],
        "attack_event_count": len(attack),
        "background_event_count": len(background),
        "techniques_detonated": [t.strip() for t in args.techniques.split(",")],
    }
    (out / "ground_truth.json").write_text(json.dumps(ground_truth, indent=2) + "\n")

    manifest = {
        "name": args.name,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "source_project": args.project,
        "window": {"since": args.since, "until": args.until},
        "canary_identity": args.canary,
        "techniques": [t.strip() for t in args.techniques.split(",")],
        "counts": {
            "total": len(events),
            "attack": len(attack),
            "background": len(background),
            "distinct_identities": len({e.get("identity") for e in events}),
            "sources": sorted({e.get("source") for e in events if e.get("source")}),
        },
        "notes": args.notes,
        # Techniques that were meant to run but did not. Recorded EXPLICITLY so the
        # gap cannot go silent. Three things look identical in a fixture -- "no
        # events for technique X" -- and mean completely different things:
        #   1. never ran (tooling broke)          -> untested; retry another way
        #   2. ran, no telemetry                  -> we are BLIND; the absence is
        #                                            the finding; do not omit
        #   3. ran, landed, mapping broke         -> ingest bug; fix and re-run
        # An omitted technique with no note is indistinguishable from case 2, which
        # is a coverage gap that reports as green. This field keeps case 1 honest.
        "untested_techniques": [t.strip() for t in args.untested.split(",") if t.strip()],
        "caveats": [
            "Ground truth assumes every canary-attributed event is attack and "
            "everything else is benign. True for a sacrificial project; revisit "
            "if detonations ever run alongside real user activity.",
            "Background volume here reflects a near-empty project. Precision "
            "measured against it will be optimistic -- pair with a busy-week "
            "benign fixture before trusting any precision number.",
        ],
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    print(f"fixture written: fixtures/{args.name}/")
    print(f"  events.jsonl       {len(events)} events "
          f"({len(attack)} attack / {len(background)} background)")
    print(f"  ground_truth.json  {len(ground_truth['attack_event_ids'])} labeled attack events")
    print(f"  manifest.json      sources: {', '.join(manifest['counts']['sources'])}")

    if manifest["untested_techniques"]:
        print(
            f"\n  UNTESTED (planned, never ran): "
            f"{', '.join(manifest['untested_techniques'])}"
        )
        print(
            "  Recorded in the manifest so the gap is not silent. These are coverage\n"
            "  you have NOT validated -- retry them before trusting a hunt over this\n"
            "  telemetry class. An untested technique is not the same as a safe one."
        )

    if len(background) < 50:
        print(
            "\nNOTE: very little background telemetry. This fixture measures recall "
            "\nhonestly but precision barely at all -- a skill that alerts on "
            "\neverything would look perfect. Get a benign busy-week fixture before "
            "\nreading anything into precision numbers."
        )

    print("\nNext: hand docs/hunting_schema.md + a read-only query tool to an agent")
    print("with NO skill, and see if it finds the attack (seed loop step 3).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
