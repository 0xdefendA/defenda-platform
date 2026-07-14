#!/usr/bin/env python3
"""
hunt_harness.py -- huntA phase 2b. The minimal ADK hunt agent.

Seed loop step 3: give an agent the hunting schema, a read-only query tool, and
NO SKILL. Then find out whether an LLM handed this schema actually hunts.

Deliberately not the orchestrator. No Cloud Run, no Pub/Sub, no Firestore. That is
plumbing we have built before (alertA's fan-out) and it is not where the risk is.
The risk is the agent loop. Prove the loop, then industrialise it.

    pip install "google-adk==2.4.*" google-cloud-bigquery

    # Vertex env (Gemini is native to ADK -- no extra SDK):
    export GOOGLE_GENAI_USE_VERTEXAI=TRUE
    export GOOGLE_CLOUD_PROJECT=$PLATFORM_PROJECT
    export GOOGLE_CLOUD_LOCATION=us-central1

    # the honest run: agent is NOT told whether this window contains an attack
    python tools/hunt_harness.py \
        --project      $PLATFORM_PROJECT \
        --since        2026-07-11T17:00:00Z \
        --until        2026-07-11T19:00:00Z \
        --run-id       seed-detonation

    # the run that matters just as much: a window with nothing in it
    python tools/hunt_harness.py ... --since <quiet window> --run-id seed-benign


ON BLIND WINDOWS -- read before changing the prompt
---------------------------------------------------
The huntA plan's seed loop says to tell the agent "find the attack in this window."
Do not do that. Told an attack exists, a competent model will find one -- including
in a window of pure benign traffic, where it will write a confident report about a
service account that legitimately rotated a key. The transcript then seeds a
SKILL.md encoding the prior "an attack is present; go locate it," which is exactly
wrong for production, where almost every window is benign.

And it is invisible to the eval: the skill scores beautifully on the detonation
fixture and is a false-positive machine in production. A skill that cries wolf every
6 hours gets muted, and a muted skill is a coverage gap that reports as green.

So the task below never mentions an attack. "Nothing here" is a PASSING result.
An agent that cannot return empty is not a hunter, it is a generator of plausible
narratives.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field, ValidationError

try:
    from google.adk.agents import LlmAgent, RunConfig
    from google.adk.agents.invocation_context import LlmCallsLimitExceededError
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.adk.tools.tool_context import ToolContext
    from google.cloud import bigquery
    from google.genai import types
except ImportError as e:
    sys.exit(f"{e}\n\npip install 'google-adk==2.4.*' google-cloud-bigquery")

# MODEL CHOICE -- Gemini, not Anthropic.
#
# Anthropic models ARE served on Vertex Model Garden, but Google gates them behind
# a per-model quota that is ZERO by default and only lifts after a sales
# conversation. "Enabled" is not "usable". So on GCP we run Gemini natively.
#
# This is exactly why the huntA design was kept model-agnostic (see the plan's
# Framework Note): read-only tools, signals-only writes, bounded loops, eval gates
# -- none of it depends on which model is behind the loop. And the blind-window
# eval is how we find out EMPIRICALLY whether Gemini can hunt and stay quiet,
# rather than arguing model quality in the abstract.
DEFAULT_MODEL = "gemini-3.1-flash-lite"


REPO = Path(__file__).resolve().parent.parent
CATALOG = REPO / "docs" / "hunting_schema.md"

# Budgets. Hitting one is a RECORDED OUTCOME, not an exception -- "burned 12 queries
# and found nothing" is a genuinely useful result and must not look like a crash.
MAX_QUERIES = 12
MAX_BYTES_PER_QUERY = 20 * 2**30
MAX_TOTAL_BYTES = 100 * 2**30
# ADK makes a summarisation call after each tool result, so budget ~2x tool calls.
MAX_LLM_CALLS = 2 * MAX_QUERIES + 4

# Rows returned per query. The ADK BigQuery toolset defaults this to 50 and
# TRUNCATES SILENTLY -- an agent would query a week of iam_changes, get 50 rows, and
# conclude it had seen everything. That is the same bug as every other one in this
# project: partial data that looks complete. We return the row count explicitly so
# the agent can SEE truncation rather than infer completeness from silence.
MAX_ROWS = 500


class Finding(BaseModel):
    """One thing a human should look at. Two fields carry the weight."""

    title: str
    confidence: str = Field(pattern="^(high|medium|low)$")
    entities: list[str] = Field(min_length=1)
    narrative: str

    # An uncited finding is a hallucination with good grammar. Requiring real
    # eventids means the harness can mechanically verify the claim against the
    # fixture's ground truth.
    evidence_eventids: list[str] = Field(min_length=1)

    # Forces the agent to argue against itself. This is the field that makes an
    # agent capable of NOT reporting: it is hard to fill in convincingly when the
    # real answer is "a service account rotated a key on schedule."
    why_not_benign: str


class Report(BaseModel):
    verdict: str = Field(pattern="^(nothing_of_concern|findings)$")
    summary: str
    findings: list[Finding] = []


class Harness:
    def __init__(self, project: str, run_id: str, since: str, until: str):
        self.project = project
        self.since = since
        self.until = until
        self.bq = bigquery.Client(project=project)

        self.out = REPO / "hunt_runs" / run_id
        self.out.mkdir(parents=True, exist_ok=True)
        self.transcript = (self.out / "transcript.jsonl").open("w")

        self.queries = 0
        self.bytes_scanned = 0
        self.report: Optional[Report] = None
        self.budget_exhausted = False

    def log(self, kind: str, **payload):
        """Append-only, flushed. A run that dies mid-way is still evidence."""
        self.transcript.write(
            json.dumps(
                {"ts": datetime.now(timezone.utc).isoformat(), "kind": kind, **payload}
            )
            + "\n"
        )
        self.transcript.flush()

    # --- tools ---------------------------------------------------------------

    def query_hunting_schema(self, sql: str) -> dict:
        """Run a read-only SQL query against the defenda_hunting BigQuery dataset.

        Use the views documented in your instructions. Always filter on a time
        window -- the underlying table is huge and partitioned on utctimestamp.

        Args:
            sql: A single BigQuery Standard SQL SELECT statement.

        Returns:
            rows, row_count, truncated, bytes_scanned.
        """
        job = self.bq.query(
            sql,
            job_config=bigquery.QueryJobConfig(
                maximum_bytes_billed=MAX_BYTES_PER_QUERY,
                use_query_cache=False,
            ),
        )
        rows = [dict(r) for r in job.result(max_results=MAX_ROWS + 1)]
        truncated = len(rows) > MAX_ROWS
        rows = rows[:MAX_ROWS]

        self.bytes_scanned += job.total_bytes_processed or 0
        return {
            "rows": json.loads(json.dumps(rows, default=str)),
            "row_count": len(rows),
            # Told, not hidden. See MAX_ROWS.
            "truncated": truncated,
            "bytes_scanned": job.total_bytes_processed,
        }

    def write_report(
        self,
        verdict: str,
        summary: str,
        findings: list[dict],
        tool_context: ToolContext,
    ) -> dict:
        """Write your final report. Call this exactly once, when you are done.

        Args:
            verdict: 'nothing_of_concern' or 'findings'.
            summary: What you looked at and what you concluded.
            findings: [] if nothing warrants attention. Each finding needs title,
                confidence, entities, narrative, evidence_eventids, why_not_benign.
        """
        try:
            report = Report.model_validate(
                {"verdict": verdict, "summary": summary, "findings": findings}
            )
        except ValidationError as e:
            # Hand the error back so the model can fix it, rather than dying. A
            # rejected report is a retry; a crashed harness is a lost run.
            return {"status": "invalid", "errors": json.loads(e.json())}

        self.report = report
        (self.out / "report.json").write_text(report.model_dump_json(indent=2))

        # THE terminal lever. `actions.escalate` does nothing on a plain LlmAgent
        # (it is only read by the deprecated LoopAgent). skip_summarization makes
        # is_final_response() true and ends the turn with no further model call.
        tool_context.actions.skip_summarization = True
        return {"status": "ok"}

    # --- guardrails ----------------------------------------------------------

    def before_tool(
        self, tool, args: dict, tool_context: ToolContext
    ) -> Optional[dict]:
        """Returning a dict SKIPS the real tool and feeds the dict back as its
        response. That is how a spent budget becomes an instruction instead of a
        crash."""
        if tool.name != "query_hunting_schema":
            return None

        sql = args.get("sql", "")

        if self.queries >= MAX_QUERIES or self.bytes_scanned >= MAX_TOTAL_BYTES:
            self.budget_exhausted = True
            self.log("budget_exhausted", queries=self.queries, bytes=self.bytes_scanned)
            return {
                "status": "error",
                "error": (
                    "Query budget exhausted. Call write_report now with what you have. "
                    "If you did not find enough to be confident, say so -- "
                    "'nothing_of_concern' is a valid and useful verdict."
                ),
            }

        # Defence in depth ONLY. The real read-only + dataset scoping guarantee is
        # IAM: run this as a service account with roles/bigquery.dataViewer on
        # defenda_hunting alone, plus roles/bigquery.jobUser. The agent must be
        # structurally incapable of writing or of reading the raw lake -- not merely
        # instructed not to. Event content is potentially attacker-controlled
        if not re.match(r"^\s*(--[^\n]*\n|\s)*select\b", sql, re.I):
            return {"status": "error", "error": "Only SELECT is permitted."}
        for ref in re.findall(r"`([^`]+)`", sql):
            if "defenda_hunting" not in ref:
                return {
                    "status": "error",
                    "error": (
                        f"'{ref}' is outside defenda_hunting. Hunt over the curated "
                        "views, not the raw events table -- see your schema catalog."
                    ),
                }

        self.queries += 1
        self.log("query", n=self.queries, sql=sql)
        return None

    def after_tool(
        self, tool, args, tool_context, tool_response: dict
    ) -> Optional[dict]:
        self.log(
            "tool_result",
            tool=tool.name,
            row_count=tool_response.get("row_count"),
            truncated=tool_response.get("truncated"),
            bytes=tool_response.get("bytes_scanned"),
            status=tool_response.get("status"),
        )
        return None


INSTRUCTION = """\
You are a threat hunter working a window of cloud activity.

Your map is the schema catalog below. Hunt over the curated views it documents --
do not go archaeology-ing through raw JSON. If you need something the catalog does
not offer, say so in your report: that is a finding about our data, and it is
useful.

## How to work

1. Orient. Check what telemetry is actually flowing (`feed_coverage`) BEFORE you
   conclude anything from an empty result. An empty result from a feed nobody
   collects is not evidence of safety -- it is evidence of nothing. Say which feeds
   you are blind to.
2. Hunt the WHOLE environment. These views aggregate every project in the org. Do
   not filter to a single project by default -- an intruder will not be in the one
   you assume. `distinct_projects` in `feed_coverage` tells you the real breadth;
   let the evidence, not an assumption, narrow your scope.
3. Look for what is unusual FOR THIS ENVIRONMENT, not what is unusual in general.
4. Follow the identity. Most cloud lateral movement is identity movement.
5. Corroborate before you believe yourself.

## The most important instruction

You are NOT told whether anything happened in this window. Most windows are
boring. **'nothing_of_concern' is a correct, valuable, and expected answer**, and
a report that says so clearly is a good report.

Do not manufacture a narrative to justify your existence. A confident story about
a service account that legitimately rotated a key is worse than silence: it trains
the humans reading you to stop reading you.

Every finding must cite real eventids, and must answer `why_not_benign` -- if you
cannot argue convincingly that something is not routine, it probably is routine,
and it does not belong in the report.

Call write_report exactly once when you are done.
{skill_block}
## Schema catalog

{catalog}
"""


# Injected only when --skill is passed. The SOP is guidance distilled from prior
# hunts -- a strong prior on strategy and judgment, NOT a script to execute
# verbatim and NOT a substitute for reading the actual data. A skill that made the
# agent stop thinking would be worse than none.
def strip_frontmatter(md: str) -> str:
    """Return the markdown body, dropping a leading YAML frontmatter block.

    Frontmatter is provenance/eval/scheduling metadata for humans and the
    orchestrator -- it names techniques and answer-key hints an agent must never
    see (see the injection site). If a file has no frontmatter, return it whole.
    """
    if md.lstrip().startswith("---"):
        # split on the fence: ['', frontmatter, body...]
        parts = md.split("---", 2)
        if len(parts) == 3:
            return parts[2].lstrip("\n")
    return md


SKILL_BLOCK = """
## Your standard operating procedure for this hunt

The following SOP was written from prior successful hunts of this kind. Treat it
as an experienced colleague's guidance: follow its strategy and apply its judgment
criteria, but ADAPT to what you actually find. If the data contradicts the SOP,
trust the data and say so -- that disagreement is how the SOP improves.

{skill}
"""


async def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument(
        "--project", required=True, help="Platform project (owns defenda_hunting)"
    )
    p.add_argument("--since", required=True)
    p.add_argument("--until", required=True)
    p.add_argument("--run-id", required=True)
    p.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help="Vertex Gemini model id. Default gemini-3.1-pro-preview; gemini-3.5-flash is "
        "the cheaper option to test once the task is proven.",
    )
    p.add_argument(
        "--skill",
        default=None,
        help="Path to a SKILL.md to run WITH (seed loop step 4+). Omit for a "
        "skill-less run (step 3). The transcript of a skill-run is what feeds the "
        "next revision; a quiet-window skill-run is how you find over-firing.",
    )
    args = p.parse_args()

    h = Harness(args.project, args.run_id, args.since, args.until)

    if args.skill:
        # Inject the BODY only, never the YAML frontmatter. The frontmatter is
        # metadata ABOUT the skill -- provenance, eval scores, authoring notes --
        # for the orchestrator and human reviewers. It routinely names the exact
        # techniques the skill was evaluated against and the shortcuts that were
        # deliberately stripped ("don't key on SAs named stratus-red-team"). Handing
        # that to an agent about to hunt a window that CONTAINS those artifacts is a
        # direct leak: it turns "learn the method" into "here is the answer key."
        # The body carries the method and judgment and nothing that names the test.
        skill_body = strip_frontmatter(Path(args.skill).read_text())
        skill_block = SKILL_BLOCK.format(skill=skill_body)
        h.log("skill_loaded", path=args.skill, injected_chars=len(skill_body))
    else:
        skill_block = ""

    agent = LlmAgent(
        name="hunter",
        # Gemini is ADK-native: a plain model string, no wrapper class. (Anthropic
        # on Vertex needs the Claude wrapper AND non-zero quota Google will not grant
        # without a sales call -- see DEFAULT_MODEL note.)
        model=args.model,
        instruction=INSTRUCTION.format(
            catalog=CATALOG.read_text(), skill_block=skill_block
        ),
        tools=[h.query_hunting_schema, h.write_report],
        before_tool_callback=h.before_tool,
        after_tool_callback=h.after_tool,
    )

    # ENVIRONMENT-WIDE, not project-scoped. The lake aggregates every project in
    # the org via the audit sink, and real hunts sweep the whole environment
    #
    # --project is the BigQuery lake/billing project (a connection detail), NOT the
    # hunt scope. Never put it in the task text.
    task = (
        f"Investigate activity across the environment between {args.since} and "
        f"{args.until}. The hunting views aggregate EVERY project in the org -- do "
        f"not restrict to any single project unless the evidence leads you there. "
        f"Report anything that warrants human attention -- and if nothing does, "
        f"say so."
    )

    session_service = InMemorySessionService()
    await session_service.create_session(
        app_name="hunta", user_id="harness", session_id=args.run_id
    )
    runner = Runner(app_name="hunta", agent=agent, session_service=session_service)

    hit_llm_cap = False
    try:
        async for event in runner.run_async(
            user_id="harness",
            session_id=args.run_id,
            new_message=types.Content(role="user", parts=[types.Part(text=task)]),
            run_config=RunConfig(max_llm_calls=MAX_LLM_CALLS),
        ):
            if event.content and event.content.parts:
                for part in event.content.parts:
                    if part.text:
                        h.log("model_text", text=part.text)
    except LlmCallsLimitExceededError as e:
        # An outcome, not a crash.
        hit_llm_cap = True
        h.log("llm_cap_exceeded", error=str(e))

    cost = {
        "run_id": args.run_id,
        "window": {"since": args.since, "until": args.until},
        "model": args.model,
        "queries": h.queries,
        "bytes_scanned": h.bytes_scanned,
        "budget_exhausted": h.budget_exhausted,
        "llm_cap_exceeded": hit_llm_cap,
        "produced_report": h.report is not None,
    }
    (h.out / "cost.json").write_text(json.dumps(cost, indent=2))

    print(f"\nhunt_runs/{args.run_id}/")
    print(f"  queries       {h.queries}/{MAX_QUERIES}")
    print(f"  bytes scanned {h.bytes_scanned / 2**30:.2f} GiB")

    if h.report is None:
        print("\n  NO REPORT. The agent never called write_report.")
        print(
            "  Read transcript.jsonl -- this is a harness/prompt finding, not an agent failure."
        )
        return 1

    r = h.report
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
    print(
        "Recall = did it find the canary. Precision = did it stay quiet on benign windows."
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
