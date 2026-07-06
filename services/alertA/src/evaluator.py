import chevron
import re
import time
from typing import Any, Dict, Generator, List, Optional
from collections import Counter
from datetime import datetime, timezone


MAX_LOOKBACK_MINUTES = 612000  # 425 days, matches table retention


def generate_bigquery_sql(criteria: str, project_id: str, lookback_minutes: int = 5) -> str:
    """
    Generates a BigQuery SQL statement for rule evaluation.
    Assumes rules are written for BigQuery Native JSON
    (e.g., STRING(details.eventname) = 'ConsoleLogin')

    lookback_minutes defaults to 5 (a buffer for late arriving logs);
    deadman rules in particular often want a longer window via the
    `lookback_minutes` rule field.
    """
    try:
        lookback = max(1, min(int(lookback_minutes), MAX_LOOKBACK_MINUTES))
    except (TypeError, ValueError):
        lookback = 5

    query = f"""
    SELECT *
    FROM `{project_id}.defenda_data_lake.events`
    WHERE {criteria}
    AND utctimestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {lookback} MINUTE)
    LIMIT 1000
    """
    return query


SEVERITY_RANK = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1, "INFO": 0}


def severity_allows(alert_severity: str, min_severity: str) -> bool:
    """True when an alert's severity meets the notification threshold."""
    rank = SEVERITY_RANK.get(str(alert_severity).upper(), 0)
    min_rank = SEVERITY_RANK.get(str(min_severity).upper(), 3)  # default HIGH
    return rank >= min_rank


def render_slack_template(obj: Any, context: dict) -> Any:
    """
    Recursively chevron-renders every string in a parsed Slack Block Kit
    structure against the alert dict. Rendering after JSON parsing (rather
    than string substitution into JSON text) means quotes/newlines in alert
    fields can't corrupt the payload.
    """
    if isinstance(obj, str):
        # {{var}} HTML-escapes per the mustache spec (quotes become &quot;),
        # which is wrong for Slack text. Promote plain variable tags to raw
        # triple-mustache; sections ({{#..}}) and existing {{{..}}} untouched.
        raw = re.sub(r"\{\{\s*([\w.]+)\s*\}\}", r"{{{\1}}}", obj)
        return chevron.render(raw, context)
    if isinstance(obj, list):
        return [render_slack_template(item, context) for item in obj]
    if isinstance(obj, dict):
        return {k: render_slack_template(v, context) for k, v in obj.items()}
    return obj


def is_expired(expiration: Any, now_ts: Optional[float] = None) -> bool:
    """
    True when an inflight alert's expiration has passed. Expiration may be a
    Firestore timestamp (datetime-like with .timestamp()), an ISO string
    (legacy docs), or missing/garbage (never expires — safer than deleting).
    """
    if now_ts is None:
        now_ts = time.time()

    if expiration is None:
        return False
    if hasattr(expiration, "timestamp"):
        try:
            return expiration.timestamp() < now_ts
        except (ValueError, OverflowError, OSError):
            return False
    if isinstance(expiration, str):
        try:
            parsed = datetime.fromisoformat(expiration)
            if parsed.tzinfo is None:
                # Naive strings (legacy docs) are written from UTC wall time.
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.timestamp() < now_ts
        except (ValueError, OverflowError, OSError):
            return False
    if isinstance(expiration, (int, float)):
        return float(expiration) < now_ts
    return False


def get_value_by_path(d: dict, path: str) -> Any:
    keys = path.split(".")
    val = d
    for key in keys:
        if isinstance(val, dict):
            val = val.get(key)
        else:
            return None
    return val


def most_common(events: List[dict], aggregation_key: str) -> List[tuple]:
    if not aggregation_key or aggregation_key == "none":
        return [("all", len(events))]

    values = []
    for event in events:
        val = get_value_by_path(event, aggregation_key)
        if val is not None:
            if isinstance(val, list):
                # If the value is a list (like tags), we could handle differently,
                # but let's assume primitives for keys
                val = str(val)
            values.append(val)
    return Counter(values).most_common()


def determine_threshold_trigger(
    rule: dict, events: List[dict]
) -> Generator[dict, None, None]:
    counts = most_common(events, rule.get("aggregation_key", ""))
    threshold = rule.get("threshold", 1)

    for value, count in counts:
        if count >= threshold:
            alert = rule.copy()
            alert["triggered"] = True

            # create metadata for chevron
            alert["metadata"] = {"value": value, "count": count}

            # Filter events to those matching the value
            if rule.get("aggregation_key") and rule["aggregation_key"] != "none":
                alert["events"] = [
                    e
                    for e in events
                    if get_value_by_path(e, rule["aggregation_key"]) == value
                ]
            else:
                alert["events"] = events

            # Render summary
            alert["summary"] = chevron.render(alert.get("summary", ""), alert)

            # Add snippets
            snippet_template = alert.get("event_snippet", "")
            if snippet_template:
                sample_count = alert.get("event_sample_count", 3)
                for event in alert["events"][:sample_count]:
                    alert["summary"] += " " + chevron.render(snippet_template, event)

            yield alert


def determine_slot_trigger(
    slot: dict, events: List[dict]
) -> Generator[dict, None, None]:
    """
    Dispatches a sequence slot to its evaluator by alert_type. Threshold and
    deadman slots can be combined freely within one sequence (e.g. root login
    followed by deadman lack-of-vault-access).
    """
    slot_type = slot.get("alert_type", "threshold")
    if slot_type == "deadman":
        yield from determine_deadman_trigger(slot, events)
    else:
        yield from determine_threshold_trigger(slot, events)


def determine_deadman_trigger(
    rule: dict, events: List[dict]
) -> Generator[dict, None, None]:
    counts = most_common(events, rule.get("aggregation_key", ""))
    threshold = rule.get("threshold", 0)

    if not events:
        events = [
            {
                "utctimestamp": datetime.utcnow().isoformat(),
                "severity": "INFO",
                "summary": "Expected event not found",
                "category": "deadman",
                "source": "deadman",
                "tags": ["deadman"],
                "plugins": [],
                "details": {},
            }
        ]

    if not counts:
        counts = [(rule.get("aggregation_key", "none"), 0)]

    for value, count in counts:
        if count <= threshold:
            alert = rule.copy()
            alert["triggered"] = True
            alert["metadata"] = {"value": value, "count": count}

            if rule.get("aggregation_key") and rule["aggregation_key"] != "none":
                alert["events"] = [
                    e
                    for e in events
                    if get_value_by_path(e, rule["aggregation_key"]) == value
                ]
            else:
                alert["events"] = events

            alert["summary"] = chevron.render(alert.get("summary", ""), alert)

            snippet_template = alert.get("event_snippet", "")
            if snippet_template:
                sample_count = alert.get("event_sample_count", 0)
                for event in alert["events"][:sample_count]:
                    alert["summary"] += " " + chevron.render(snippet_template, event)

            yield alert
