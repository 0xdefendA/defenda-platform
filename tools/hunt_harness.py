#!/usr/bin/env python3
"""
hunt_harness.py -- local CLI over the shared hunt engine.

Deliberately not the orchestrator. No Cloud Run, no Pub/Sub, no Firestore. That is
plumbing, and it is not where the risk is. The risk is the agent loop. Prove the
loop locally, then industrialise it (services/huntA does the scheduled version and
imports the SAME engine, so what you prove here is what runs there).

    pip install "google-adk==2.4.*" google-cloud-bigquery

    # Vertex env (Gemini is native to ADK -- no extra SDK):
    export GOOGLE_GENAI_USE_VERTEXAI=TRUE
    export GOOGLE_CLOUD_PROJECT=$PLATFORM_PROJECT
    export GOOGLE_CLOUD_LOCATION=global

    # the honest run: agent is NOT told whether this window contains an attack
    python tools/hunt_harness.py \
        --project      $PLATFORM_PROJECT \
        --since        2026-07-11T17:00:00Z \
        --until        2026-07-11T19:00:00Z \
        --run-id       seed-detonation

    # the run that matters just as much: a window with nothing in it
    python tools/hunt_harness.py ... --since <quiet window> --run-id seed-benign

Run as the least-privilege agent SA, not as yourself, or the IAM scoping is
theatre:

    gcloud auth application-default login \
        --impersonate-service-account=hunta-agent@<project>.iam.gserviceaccount.com

See shared/hunt/engine.py for the blind-window rationale and the agent loop.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# Repo root on path so `shared` imports work when run as a script.
REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

try:
    from shared.hunt.engine import DEFAULT_MODEL, MAX_QUERIES, run_hunt, strip_frontmatter
except ImportError as e:
    sys.exit(f"{e}\n\npip install 'google-adk==2.4.*' google-cloud-bigquery")

CATALOG = REPO / "docs" / "hunting_schema.md"


async def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument(
        "--project",
        required=True,
        help="Platform project where BigQuery lives (owns defenda_hunting)",
    )
    p.add_argument("--since", required=True)
    p.add_argument("--until", required=True)
    p.add_argument("--run-id", required=True)
    p.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Vertex Gemini model id (default {DEFAULT_MODEL}).",
    )
    p.add_argument(
        "--skill",
        default=None,
        help="Path to a SKILL.md to run WITH (body only; frontmatter is stripped).",
    )
    args = p.parse_args()

    # Inject the skill BODY only, never the YAML frontmatter. Frontmatter names the
    # exact techniques the skill was evaluated against -- handing that to an agent
    # hunting a window that contains those artifacts turns "learn the method" into
    # "here is the answer key."
    skill_body = None
    if args.skill:
        skill_body = strip_frontmatter(Path(args.skill).read_text())

    out_dir = REPO / "hunt_runs" / args.run_id
    result = await run_hunt(
        project=args.project,
        since=args.since,
        until=args.until,
        run_id=args.run_id,
        catalog_text=CATALOG.read_text(),
        out_dir=out_dir,
        model=args.model,
        skill_body=skill_body,
    )

    print(f"\nhunt_runs/{args.run_id}/")
    print(f"  queries       {result.cost['queries']}/{MAX_QUERIES}")
    print(f"  bytes scanned {result.cost['bytes_scanned'] / 2**30:.2f} GiB")

    if result.report is None:
        print("\n  NO REPORT. The agent never called write_report.")
        print(
            "  Read transcript.jsonl -- this is a harness/prompt finding, not an agent failure."
        )
        return 1

    r = result.report
    print(f"\n  verdict  {r.verdict}")
    print(f"  findings {len(r.findings)}")
    for f in r.findings:
        print(f"    [{f.confidence}] {f.title}")
        print(f"        entities: {', '.join(f.entities)}")
        print(f"        cites {len(f.evidence_eventids)} eventids")

    if r.verdict == "nothing_of_concern":
        print(
            "\n  The agent found nothing and said so. On a benign window that is a PASS --\n"
            "  knowing when to shut up is the capability we are actually testing."
        )

    print("\nNext: score against fixtures/<name>/ground_truth.json.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
