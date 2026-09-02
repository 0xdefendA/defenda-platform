"""
The minimal ADK hunt engine -- the proven phase-2b agent loop, extracted so both
the local harness (tools/hunt_harness.py) and the scheduled service
(services/huntA) run the SAME loop rather than forks that drift.

Preserving one engine is the point: phase 2b proved a specific prompt + tool set +
loop can hunt AND stay quiet. A service that reimplemented them slightly would no
longer inherit that proof. So the instruction, the two tools, and the budgets live
here, exactly once.

    pip install "google-adk==2.4.*" google-cloud-bigquery

    # Vertex env (Gemini is native to ADK -- no extra SDK):
    export GOOGLE_GENAI_USE_VERTEXAI=TRUE
    export GOOGLE_CLOUD_PROJECT=$PLATFORM_PROJECT
    export GOOGLE_CLOUD_LOCATION=global

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

So the task/instruction below never mention an attack. "Nothing here" is a PASSING
result. An agent that cannot return empty is not a hunter, it is a generator of
plausible narratives.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field, ValidationError

from google.adk.agents import LlmAgent, RunConfig
from google.adk.agents.invocation_context import LlmCallsLimitExceededError
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.tools.tool_context import ToolContext
from google.cloud import bigquery
from google.genai import types

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-3.5-flash-lite"

# Vertex returns 429 RESOURCE_EXHAUSTED under capacity/quota pressure -- common
# right after a new Gemini release when everyone piles onto the new model and its
# initial quota is tight. Retry the whole hunt a few times with exponential
# backoff + jitter. A hunt is a twice-daily batch, so re-running on a 429 is fine;
# 429s also tend to hit the FIRST model call, before many BigQuery queries run, so
# retry cost is usually low.
MAX_MODEL_ATTEMPTS = 4
_RETRY_BASE_SECONDS = 10.0
_RETRY_MAX_SECONDS = 120.0


def _is_retryable_model_error(exc: BaseException) -> bool:
    """True for transient model-availability errors (429 / 503 / UNAVAILABLE).
    Deliberately signal-based rather than importing specific exception types,
    because ADK/genai/api_core each surface these differently."""
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if code in (429, 503):
        return True
    text = f"{type(exc).__name__} {exc}".lower()
    cause = getattr(exc, "__cause__", None)
    if cause:
        text += f" {cause}".lower()
    return any(
        n in text
        for n in ("resource_exhausted", "resource exhausted", "429", "503",
                  "unavailable", "rate limit")
    )


def _backoff_delay(attempt: int) -> float:
    """Exponential backoff with jitter. attempt is 1-based."""
    base = _RETRY_BASE_SECONDS * (3 ** (attempt - 1))
    return min(base, _RETRY_MAX_SECONDS) + random.uniform(0, 5)

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


@dataclass
class RunResult:
    """What a completed (or capped) hunt run produced."""

    report: Optional[Report]
    cost: dict
    out_dir: Path
    # In-memory copy of every transcript record (queries, tool results, model
    # text, cap events). Returned so callers don't depend on re-reading a file
    # that may be on ephemeral/temp storage. Row-free by construction -- query
    # RESULT rows are never logged, only the SQL and row counts -- so it is safe
    # to persist and small enough for a Firestore doc.
    transcript: list = None  # type: ignore[assignment]


class Harness:
    def __init__(
        self, project: str, run_id: str, since: str, until: str, out_dir: Path
    ):
        self.project = project
        self.since = since
        self.until = until
        self.bq = bigquery.Client(project=project)

        self.out = out_dir
        self.out.mkdir(parents=True, exist_ok=True)
        self.transcript = (self.out / "transcript.jsonl").open("w")

        self.queries = 0
        self.bytes_scanned = 0
        self.report: Optional[Report] = None
        self.budget_exhausted = False
        # In-memory mirror of the transcript. The file is for local harness runs;
        # this is what the service persists, so it does not depend on reading back
        # a temp file.
        self.records: list[dict] = []

    def log(self, kind: str, **payload):
        """Append-only, flushed, and mirrored in memory. A run that dies mid-way
        is still evidence."""
        record = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "kind": kind,
            **payload,
        }
        self.records.append(record)
        self.transcript.write(json.dumps(record) + "\n")
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
        # Count and log HERE, in the tool itself -- not only in before_tool. The
        # tool is guaranteed to run when the agent queries; a callback might not
        # fire the way a given ADK version expects, and if it silently doesn't, we
        # would under-count queries and log an empty transcript while the hunt
        # actually ran (observed: a run with queries but a blank transcript).
        self.queries += 1
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
        # Row-free record: the SQL and result metadata, never the rows (which can
        # be large and hold event data). Safe to persist; enough to see how it hunted.
        self.log(
            "query_run",
            n=self.queries,
            sql=sql,
            row_count=len(rows),
            truncated=truncated,
            bytes=job.total_bytes_processed,
        )
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

        # Counting + query logging live in the tool (query_hunting_schema), which
        # always runs. before_tool is enforcement only, and may or may not fire
        # depending on ADK wiring -- so it must not be the sole place either happens.
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


# Injected only when a skill is passed. The SOP is guidance distilled from prior
# hunts -- a strong prior on strategy and judgment, NOT a script to execute
# verbatim and NOT a substitute for reading the actual data. A skill that made the
# agent stop thinking would be worse than none.
SKILL_BLOCK = """
## Your standard operating procedure for this hunt

The following SOP was written from prior successful hunts of this kind. Treat it
as an experienced colleague's guidance: follow its strategy and apply its judgment
criteria, but ADAPT to what you actually find. If the data contradicts the SOP,
trust the data and say so -- that disagreement is how the SOP improves.

{skill}
"""


def strip_frontmatter(md: str) -> str:
    """Return the markdown body, dropping a leading YAML frontmatter block.

    Frontmatter is provenance/eval/scheduling metadata for humans and the
    orchestrator -- it names techniques and answer-key hints an agent must never
    see. If a file has no frontmatter, return it whole.
    """
    if md.lstrip().startswith("---"):
        parts = md.split("---", 2)
        if len(parts) == 3:
            return parts[2].lstrip("\n")
    return md


async def run_hunt(
    *,
    project: str,
    since: str,
    until: str,
    run_id: str,
    catalog_text: str,
    out_dir: Path,
    model: str = DEFAULT_MODEL,
    skill_body: Optional[str] = None,
) -> RunResult:
    """Run one hunt over [since, until). Returns the report (or None if the agent
    never produced one) plus a cost dict. Never raises for a capped run -- hitting
    a budget is a recorded outcome.

    catalog_text is docs/hunting_schema.md verbatim -- it IS the agent's map and the
    contract. Passed in (not read from a fixed path) so the service can bundle its
    own copy into the container.

    Retries the whole hunt on transient model errors (429 / 503) with exponential
    backoff. Each attempt gets a FRESH Harness so query counts and the transcript
    reflect only the successful run, not the failed attempts.
    """
    skill_block = SKILL_BLOCK.format(skill=skill_body) if skill_body else ""

    # ENVIRONMENT-WIDE, not project-scoped. The lake aggregates every project via
    # the audit sink, and real hunts sweep the whole environment. --project is the
    # BigQuery lake/billing project (a connection detail), NOT the hunt scope.
    task = (
        f"Investigate activity across the environment between {since} and "
        f"{until}. The hunting views aggregate EVERY project in the org -- do "
        f"not restrict to any single project unless the evidence leads you there. "
        f"Report anything that warrants human attention -- and if nothing does, "
        f"say so."
    )

    h: Optional[Harness] = None
    hit_llm_cap = False
    model_unavailable = False
    attempts = 0

    for attempt in range(1, MAX_MODEL_ATTEMPTS + 1):
        attempts = attempt
        # Fresh harness per attempt: opening the transcript with "w" truncates any
        # partial transcript from a failed attempt, so the final one is clean.
        h = Harness(project, run_id, since, until, out_dir)
        if skill_body:
            h.log("skill_loaded", injected_chars=len(skill_body))

        agent = LlmAgent(
            name="hunter",
            # Gemini is ADK-native: a plain model string, no wrapper class.
            model=model,
            instruction=INSTRUCTION.format(catalog=catalog_text, skill_block=skill_block),
            tools=[h.query_hunting_schema, h.write_report],
            before_tool_callback=h.before_tool,
            after_tool_callback=h.after_tool,
        )
        session_service = InMemorySessionService()
        await session_service.create_session(
            app_name="hunta", user_id="harness", session_id=run_id
        )
        runner = Runner(app_name="hunta", agent=agent, session_service=session_service)

        try:
            async for event in runner.run_async(
                user_id="harness",
                session_id=run_id,
                new_message=types.Content(role="user", parts=[types.Part(text=task)]),
                run_config=RunConfig(max_llm_calls=MAX_LLM_CALLS),
            ):
                if event.content and event.content.parts:
                    for part in event.content.parts:
                        if part.text:
                            h.log("model_text", text=part.text)
            break  # completed without a retryable error
        except LlmCallsLimitExceededError as e:
            # An outcome, not a crash.
            hit_llm_cap = True
            h.log("llm_cap_exceeded", error=str(e))
            break
        except Exception as e:  # noqa: BLE001 - classify then re-raise if not ours
            if not _is_retryable_model_error(e):
                h.transcript.close()
                raise
            if attempt < MAX_MODEL_ATTEMPTS:
                delay = _backoff_delay(attempt)
                logger.warning(
                    "hunt %s: retryable model error (attempt %d/%d), retrying in "
                    "%.1fs: %s", run_id, attempt, MAX_MODEL_ATTEMPTS, delay, e
                )
                h.log("model_retry", attempt=attempt, delay_s=round(delay, 1), error=str(e))
                h.transcript.close()
                await asyncio.sleep(delay)
                continue
            # Retries exhausted. Record the outage as a no-report OUTCOME rather
            # than crashing the scheduled run -- the absence shows honestly in the
            # Hunts UI, and the scheduler is not left retrying a 900s job.
            model_unavailable = True
            logger.error(
                "hunt %s: model unavailable after %d attempts: %s",
                run_id, attempt, e,
            )
            h.log("model_unavailable", attempts=attempt, error=str(e))
            break

    assert h is not None
    cost = {
        "run_id": run_id,
        "window": {"since": since, "until": until},
        "model": model,
        "queries": h.queries,
        "bytes_scanned": h.bytes_scanned,
        "attempts": attempts,
        "budget_exhausted": h.budget_exhausted,
        "llm_cap_exceeded": hit_llm_cap,
        "model_unavailable": model_unavailable,
        "produced_report": h.report is not None,
    }
    (h.out / "cost.json").write_text(json.dumps(cost, indent=2))
    h.transcript.close()

    return RunResult(report=h.report, cost=cost, out_dir=h.out, transcript=h.records)
