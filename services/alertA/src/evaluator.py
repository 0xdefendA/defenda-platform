import chevron
from typing import List, Dict, Any, Generator
from collections import Counter
from datetime import datetime


def generate_bigquery_sql(criteria: str, project_id: str) -> str:
    """
    Generates a BigQuery SQL statement for rule evaluation.
    Assumes rules are written for BigQuery Native JSON
    (e.g., STRING(details.eventname) = 'ConsoleLogin')
    """
    # Using 5 minutes to give a buffer for late arriving logs.
    query = f"""
    SELECT *
    FROM `{project_id}.defenda_data_lake.events`
    WHERE {criteria}
    AND utctimestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 5 MINUTE)
    LIMIT 1000
    """
    return query


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
