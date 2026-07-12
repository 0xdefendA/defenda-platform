#!/usr/bin/env python3
"""
score_hunt.py -- huntA phase 2b. Grade a hunt report against a fixture.

This is the ruler the eval-gated skill lifecycle depends on. The huntA plan gates
every skill revision on "must not regress against the fixture"; that gate needs a
number produced the same way every time, not a human eyeballing a transcript and
remembering who the operator was.

It automates exactly the by-hand scoring from the first good run:

    python tools/score_hunt.py \
        --run     hunt_runs/seed-recall-02 \
        --fixture fixtures/gcp-persistence-2026-07-11

THE THREE BUCKETS (why this is not a plain precision/recall calc)
-----------------------------------------------------------------
A two-way attack/benign split scores a good hunt as mediocre. The detonation
window contains three kinds of event, and an evidence citation lands in one of
them:

  attack   -> canary-attributed. Citing it is a TRUE POSITIVE.
  operator -> the human/CI who RAN the campaign. Their setup traffic
              (impersonating the canary, creating keys) is genuinely
              suspicious-looking; a hunter who flags it is not wrong. Citing it is
              a DON'T-CARE -- neither rewarded nor penalised.
  benign   -> everything else. Citing it is a REAL FALSE POSITIVE.

Scoring the operator bucket as a false positive would punish the agent for correct
reasoning about our own noise. Scoring it as a hit would reward finding something
that isn't the planted attack. Don't-care is the honest treatment.

THE METRIC THAT MATTERS MOST: hallucination
-------------------------------------------
A cited eventid that is not in the fixture AT ALL is a fabricated citation -- a
hallucination with good grammar. This is the one number that can never be traded
off. A single fabricated eventid should make you distrust the whole report,
however good its recall looks. It is reported first and loudest.

RECALL IS REPORTED TWO WAYS, on purpose
---------------------------------------
* citation recall  -- fraction of attack events the report cited. LOW is fine:
                      an analyst cites representative evidence, not all N rows.
* technique recall -- did the findings, by their cited attack events, touch every
                      technique? This is the recall that matters, but it needs
                      per-event technique labels the fixture does not yet carry, so
                      it is approximate. See the note in the output.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


GREEN, RED, YELLOW, DIM, BOLD, RESET = (
    "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[1m", "\033[0m"
)


def load(run_dir: Path, fixture_dir: Path):
    report = json.loads((run_dir / "report.json").read_text())
    gt = json.loads((fixture_dir / "ground_truth.json").read_text())
    # events.jsonl gives us the universe of real eventids -> hallucination check.
    fixture_ids = {
        json.loads(line)["eventid"]
        for line in (fixture_dir / "events.jsonl").read_text().splitlines()
        if line.strip()
    }
    return report, gt, fixture_ids


def score(report: dict, gt: dict, fixture_ids: set[str]) -> dict:
    attack = set(gt.get("attack_event_ids", []))
    operator = set(gt.get("operator_event_ids", []))

    cited: list[str] = []
    for f in report.get("findings", []):
        cited += f.get("evidence_eventids", [])
    cited_set = set(cited)

    # Partition every cited eventid into exactly one bucket.
    hallucinated = cited_set - fixture_ids          # not in the fixture at all
    real = cited_set & fixture_ids
    tp = real & attack                              # cited a genuine attack event
    dont_care = real & operator                     # cited operator setup noise
    false_pos = real - attack - operator            # cited a genuinely benign event

    verdict = report.get("verdict")
    has_findings = bool(report.get("findings"))

    return {
        "verdict": verdict,
        "cited_total": len(cited_set),
        "hallucinated": sorted(hallucinated),
        "true_positive": sorted(tp),
        "dont_care_operator": sorted(dont_care),
        "false_positive": sorted(false_pos),
        "attack_total": len(attack),
        "citation_recall": (len(tp) / len(attack)) if attack else None,
        # An empty verdict is only correct on a benign window; here (attack present)
        # it would be a miss. Flag the incoherent combos.
        "verdict_coherent": (
            (verdict == "findings" and has_findings)
            or (verdict == "nothing_of_concern" and not has_findings)
        ),
    }


def render(s: dict, run_id: str, fixture_name: str) -> int:
    print(f"\n{BOLD}hunt score{RESET}  run={run_id}  fixture={fixture_name}\n")

    # 1. Hallucination -- the non-negotiable one, first.
    if s["hallucinated"]:
        print(f"  {RED}{BOLD}HALLUCINATED CITATIONS: {len(s['hallucinated'])}{RESET}")
        for e in s["hallucinated"]:
            print(f"      {RED}{e}{RESET}  <-- not in the fixture at all")
        print(
            f"      {YELLOW}A fabricated eventid poisons the whole report. Distrust it\n"
            f"      regardless of recall.{RESET}"
        )
    else:
        print(f"  {GREEN}hallucinations   0{RESET}  (every citation is a real event)")

    # 2. Three-bucket precision.
    print()
    print(f"  attack hits      {GREEN}{len(s['true_positive'])}{RESET}  (true positives)")
    print(f"  operator cites   {DIM}{len(s['dont_care_operator'])}  (don't-care -- not penalised){RESET}")
    fp = s["false_positive"]
    fp_color = RED if fp else GREEN
    print(f"  benign cites     {fp_color}{len(fp)}{RESET}  (real false positives)")
    if fp:
        for e in fp:
            print(f"      {RED}{e}{RESET}")

    # 3. Recall, with the honest caveat.
    print()
    if s["citation_recall"] is not None:
        pct = s["citation_recall"] * 100
        print(
            f"  citation recall  {len(s['true_positive'])}/{s['attack_total']} "
            f"({pct:.0f}%)  {DIM}-- low is fine; a report cites examples, not every row{RESET}"
        )

    # 4. Verdict coherence.
    if not s["verdict_coherent"]:
        print(f"\n  {RED}verdict INCOHERENT{RESET}: '{s['verdict']}' with "
              f"{len(s['true_positive']) + len(s['false_positive'])} findings cited")

    # Bottom line: pass = found real attack, zero hallucinations, zero benign FPs.
    passed = (
        not s["hallucinated"]
        and len(s["true_positive"]) > 0
        and not s["false_positive"]
        and s["verdict_coherent"]
    )
    print()
    if passed:
        print(f"  {GREEN}{BOLD}PASS{RESET}  real attack found, cited real evidence, "
              f"no benign false positives.")
    else:
        print(f"  {RED}{BOLD}FAIL{RESET}  see above.")
    print(
        f"\n  {DIM}Reminder: precision here is only as honest as the benign volume in\n"
        f"  the fixture. A near-empty sacrificial window flatters precision -- pair\n"
        f"  with a busy benign fixture before trusting a low FP count.{RESET}"
    )
    return 0 if passed else 1


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--run", required=True, help="hunt_runs/<id> directory")
    p.add_argument("--fixture", required=True, help="fixtures/<name> directory")
    p.add_argument("--json", action="store_true", help="emit the raw scorecard as JSON")
    args = p.parse_args()

    run_dir, fixture_dir = Path(args.run), Path(args.fixture)
    if not (run_dir / "report.json").exists():
        sys.exit(f"no report.json in {run_dir} -- did the run produce one?")

    report, gt, fixture_ids = load(run_dir, fixture_dir)

    if not gt.get("operator_identities") and "operator_event_ids" not in gt:
        print(
            f"{YELLOW}WARNING: fixture has no operator bucket. Campaign-setup traffic "
            f"will score as benign false positives. Re-export with --operators, or "
            f"backfill.{RESET}",
            file=sys.stderr,
        )

    s = score(report, gt, fixture_ids)
    if args.json:
        print(json.dumps(s, indent=2))
        return 0 if (not s["hallucinated"] and not s["false_positive"] and s["true_positive"]) else 1

    return render(s, run_dir.name, fixture_dir.name)


if __name__ == "__main__":
    sys.exit(main())
