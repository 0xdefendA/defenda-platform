import pytest
import json
import glob
import os
from unittest.mock import patch
from datetime import datetime

import evaluator


def test_get_value_by_path():
    data = {
        "user": {"name": "Alice", "metadata": {"role": "admin"}},
        "status": "active",
    }

    assert evaluator.get_value_by_path(data, "user.name") == "Alice"
    assert evaluator.get_value_by_path(data, "user.metadata.role") == "admin"
    assert evaluator.get_value_by_path(data, "status") == "active"
    assert evaluator.get_value_by_path(data, "user.missing") is None
    assert evaluator.get_value_by_path(data, "missing.key") is None


def test_most_common():
    events = [
        {"user": "Alice", "type": "login"},
        {"user": "Bob", "type": "login"},
        {"user": "Alice", "type": "logout"},
        {"user": "Charlie", "type": "login"},
        {"user": "Alice", "type": "login"},
    ]

    # Test grouping by user
    counts = evaluator.most_common(events, "user")
    # Alice: 3, Bob: 1, Charlie: 1
    assert len(counts) == 3
    assert counts[0] == ("Alice", 3)

    # Test grouping by type
    counts = evaluator.most_common(events, "type")
    assert counts[0] == ("login", 4)
    assert counts[1] == ("logout", 1)

    # Test no aggregation key
    counts = evaluator.most_common(events, "none")
    assert counts[0] == ("all", 5)


def test_determine_threshold_trigger():
    # Load sample events
    sample_file = os.path.join(
        os.path.dirname(__file__), "samples/sample_cloudtrail_login_no_mfa.json"
    )
    with open(sample_file, "r") as f:
        raw_events = json.load(f)

    # Wrap in BigQuery format
    events = [{"details": e} for e in raw_events]

    rule = {
        "alert_name": "test_threshold",
        "alert_type": "threshold",
        "summary": "{{events.0.details.eventname}} by {{events.0.details.useridentity.type}} {{metadata.count}} mfa:{{events.0.details.additionaleventdata.mfaused}}",
        "event_snippet": "{{details.eventname}}/{{details.responseelements.consolelogin}} mfa:{{details.additionaleventdata.mfaused}} from {{details.sourceipaddress}}",
        "aggregation_key": "details.additionaleventdata.mfaused",
        "threshold": 1,
        "event_sample_count": 3,
    }

    alerts = list(evaluator.determine_threshold_trigger(rule, events))

    assert len(alerts) == 1
    alert = alerts[0]

    assert alert["triggered"] is True
    assert alert["metadata"]["value"] == "No"
    assert alert["metadata"]["count"] == 2
    assert len(alert["events"]) == 2

    # Test Chevron resolution
    assert "ConsoleLogin by Root" in alert["summary"]
    assert "mfa:No" in alert["summary"]
    # Snippet test
    assert "ConsoleLogin/Success" in alert["summary"]
    assert "from 6.9.9.93" in alert["summary"]


@patch("evaluator.datetime")
def test_determine_deadman_trigger(mock_datetime):
    mock_datetime.utcnow.return_value = datetime(2026, 1, 1, 12, 0, 0)

    sample_file = os.path.join(
        os.path.dirname(__file__), "samples/sample_OneLogin_EventBridge_Raw.json"
    )
    with open(sample_file, "r") as f:
        raw_events = json.load(f)

    events = [{"details": e} for e in raw_events]

    rule = {
        "alert_name": "test_deadman",
        "alert_type": "deadman",
        "summary": "Expected events are missing",
        "aggregation_key": "details.region",
        "threshold": 0,
        "tags": ["deadman"],
    }

    # With events present (count = 1), shouldn't trigger (threshold = 0)
    alerts = list(evaluator.determine_deadman_trigger(rule, events))
    assert len(alerts) == 0

    # Without events, it should trigger
    empty_events = []
    alerts = list(evaluator.determine_deadman_trigger(rule, empty_events))
    assert len(alerts) == 1

    alert = alerts[0]
    assert alert["triggered"] is True
    assert "Expected events are missing" in alert["summary"]
    assert "deadman" in alert.get("tags", [])


def test_sequence_alert_slot_templating():
    # Test that chevron template resolution for sequence slots works.
    # In main.py, slots reference previous slots.

    rule = {
        "alert_name": "multiple_risky_logins",
        "summary": "Multiple {{metadata.count}} risky logins by {{slots.0.events.0.details.user_name}}",
        "slots": [
            {
                "triggered": True,
                "events": [{"details": {"user_name": "Jane Doe", "risk_score": 90}}],
            },
            {
                "criteria": "source='onelogin' AND JSON_VALUE(details.user_name)='{{slots.0.events.0.details.user_name}}'"
            },
        ],
    }

    import chevron

    target_slot = rule["slots"][1]
    criteria = chevron.render(target_slot["criteria"], rule)

    assert criteria == "source='onelogin' AND JSON_VALUE(details.user_name)='Jane Doe'"

    # Resolve final summary
    rule["metadata"] = {"count": 2}
    final_summary = chevron.render(rule["summary"], rule)
    assert final_summary == "Multiple 2 risky logins by Jane Doe"
