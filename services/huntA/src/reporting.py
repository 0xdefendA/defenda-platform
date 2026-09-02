"""
Persistence and surfacing for hunt runs. Kept separate from the agent loop and
free of ADK imports so it is unit-testable without Vertex.

Design note on the write boundary: the AGENT never touches Firestore or Slack --
its only tools are read-only BigQuery and an in-memory write_report. Everything
here runs AFTER the loop, on a pydantic-validated Report, as ordinary service
code. So the service identity holding Firestore-write does not hand the (possibly
prompt-injected) agent any write capability; the containment boundary is the tool
set, not the SA.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

SEVERITY_LADDER = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1, "INFO": 0}

# Findings carry high/medium/low confidence; map to a severity-ish rank so the
# existing settings/notifications min_severity threshold can gate hunt Slack posts.
CONFIDENCE_TO_SEVERITY = {"high": "HIGH", "medium": "MEDIUM", "low": "LOW"}


# Firestore docs cap at ~1MB. Transcript records are row-free and small, but
# model_text can be long -- cap defensively so a chatty run can't fail the write.
MAX_TRANSCRIPT_RECORDS = 200
MAX_RECORD_TEXT = 4000


def _trim_transcript(transcript: Optional[list]) -> list:
    if not transcript:
        return []
    trimmed = []
    for rec in transcript[:MAX_TRANSCRIPT_RECORDS]:
        r = dict(rec)
        for k, v in list(r.items()):
            if isinstance(v, str) and len(v) > MAX_RECORD_TEXT:
                r[k] = v[:MAX_RECORD_TEXT] + "…[truncated]"
        trimmed.append(r)
    return trimmed


def report_to_doc(
    *,
    run_id: str,
    window: dict,
    model: str,
    report: Optional[Any],
    cost: dict,
    transcript: Optional[list] = None,
) -> dict:
    """Build the Firestore hunt_reports document. `report` is a Report (or None
    when the agent never produced one). The transcript (queries + reasoning, row
    free) is persisted so the verdict is auditable -- 'nothing_of_concern' is only
    trustworthy if you can see it actually hunted."""
    doc: dict = {
        "run_id": run_id,
        "window": window,
        "model": model,
        "cost": cost,
        "transcript": _trim_transcript(transcript),
        "produced_report": report is not None,
        "created_at": datetime.now(timezone.utc),
    }
    if report is None:
        # A run that never produced a report is a harness/prompt/availability
        # finding, not a clean bill of health -- record it as its own state.
        doc["verdict"] = "no_report"
        if cost.get("model_unavailable"):
            doc["summary"] = (
                f"The model was unavailable (429 / resource exhausted) after "
                f"{cost.get('attempts', '?')} attempts; no hunt was performed. "
                "This window was NOT examined."
            )
        else:
            doc["summary"] = "The hunt agent did not produce a report (see logs/transcript)."
        doc["findings"] = []
        return doc

    doc["verdict"] = report.verdict
    doc["summary"] = report.summary
    doc["findings"] = [f.model_dump() for f in report.findings]
    return doc


def persist_report(fs_client, doc: dict) -> None:
    """Write the hunt_reports doc (id = run_id). Best-effort; logs and swallows."""
    try:
        fs_client.collection("hunt_reports").document(doc["run_id"]).set(doc)
    except Exception as e:  # noqa: BLE001 - persistence must never fail the run
        logger.error(f"Failed to persist hunt report {doc.get('run_id')}: {e}")


def _max_finding_severity(findings: list[dict]) -> str:
    rank = -1
    sev = "INFO"
    for f in findings:
        s = CONFIDENCE_TO_SEVERITY.get(str(f.get("confidence", "")).lower(), "INFO")
        if SEVERITY_LADDER.get(s, 0) > rank:
            rank = SEVERITY_LADDER.get(s, 0)
            sev = s
    return sev


def should_notify(doc: dict, min_severity: str) -> bool:
    """Only surface things worth pursuing: findings at/above the threshold.
    'nothing_of_concern' and 'no_report' never page -- silence is the expected
    case and paging on it trains humans to ignore the channel."""
    if doc.get("verdict") != "findings" or not doc.get("findings"):
        return False
    top = _max_finding_severity(doc["findings"])
    min_rank = SEVERITY_LADDER.get(str(min_severity).upper(), 3)  # default HIGH
    return SEVERITY_LADDER.get(top, 0) >= min_rank


def build_slack_blocks(doc: dict) -> dict:
    """A purpose-built hunt message (not the per-alert template). Summarizes the
    findings; the analyst opens respondA for the full report."""
    window = doc.get("window", {})
    blocks: list[dict] = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"\U0001F50D Hunt findings: {len(doc['findings'])}",
            },
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": (
                        f"window {window.get('since', '?')} → {window.get('until', '?')} "
                        f"· model {doc.get('model', '?')} · run `{doc.get('run_id', '?')}`"
                    ),
                }
            ],
        },
        {"type": "section", "text": {"type": "mrkdwn", "text": doc.get("summary", "")}},
    ]
    for f in doc["findings"][:10]:  # cap; deep detail lives in respondA
        entities = ", ".join(f.get("entities", []))
        blocks.append(
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": (
                        f"*[{f.get('confidence')}] {f.get('title')}*\n"
                        f"{f.get('narrative', '')}\n"
                        f"_entities: {entities}_\n"
                        f"_why not benign: {f.get('why_not_benign', '')}_"
                    ),
                },
            }
        )
    return {"blocks": blocks}


def build_failure_blocks(doc: dict) -> dict:
    """An operational heads-up when a scheduled hunt did not complete (verdict
    'no_report' -- model unavailable, or the agent never produced a report). This
    is the 'don't fail silently' message: a window that was NOT examined is its own
    kind of alert."""
    window = doc.get("window", {})
    cost = doc.get("cost", {}) or {}
    detail = "the agent did not produce a report"
    if cost.get("model_unavailable"):
        detail = f"model unavailable (429 / resource exhausted) after {cost.get('attempts', '?')} attempts"
    return {
        "blocks": [
            {
                "type": "header",
                "text": {"type": "plain_text", "text": "⚠️ Hunt did not complete"},
            },
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": (
                            f"window {window.get('since', '?')} → {window.get('until', '?')} "
                            f"was NOT examined · model {doc.get('model', '?')} · "
                            f"run `{doc.get('run_id', '?')}`"
                        ),
                    }
                ],
            },
            {"type": "section", "text": {"type": "mrkdwn", "text": f"*{detail}.* {doc.get('summary', '')}"}},
        ]
    }


def notify_slack(
    cfg: dict,
    doc: dict,
    *,
    post: Callable[[str, dict], Any],
) -> bool:
    """Post to Slack. Two cases:
      - findings above the severity threshold -> the findings message
      - a hunt that did NOT complete (verdict 'no_report') -> a failure heads-up,
        so a scheduled hunt can't fail silently (gated by notify_hunt_failures,
        default on)
    `post(url, json)` is injected (requests.post in prod, a fake in tests).
    Returns whether it posted."""
    if not cfg.get("enabled") or not cfg.get("webhook_url"):
        return False

    if doc.get("verdict") == "no_report":
        if not cfg.get("notify_hunt_failures", True):
            return False
        payload = build_failure_blocks(doc)
    elif should_notify(doc, cfg.get("min_severity", "HIGH")):
        payload = build_slack_blocks(doc)
    else:
        return False

    try:
        post(cfg["webhook_url"], payload)
        return True
    except Exception as e:  # noqa: BLE001
        logger.error(f"Slack hunt notify failed: {e}")
        return False
