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


def test_generate_bigquery_sql_default_lookback():
    sql = evaluator.generate_bigquery_sql("source='x'", "proj")
    assert "INTERVAL 5 MINUTE" in sql


def test_generate_bigquery_sql_custom_lookback():
    sql = evaluator.generate_bigquery_sql("source='x'", "proj", lookback_minutes=120)
    assert "INTERVAL 120 MINUTE" in sql


def test_generate_bigquery_sql_lookback_clamped_and_safe():
    # Absurd values clamp to the retention ceiling
    sql = evaluator.generate_bigquery_sql("source='x'", "proj", lookback_minutes=10**9)
    assert f"INTERVAL {evaluator.MAX_LOOKBACK_MINUTES} MINUTE" in sql
    # Garbage falls back to the default
    sql = evaluator.generate_bigquery_sql("source='x'", "proj", lookback_minutes="nope")
    assert "INTERVAL 5 MINUTE" in sql
    # Zero/negative clamp to 1
    sql = evaluator.generate_bigquery_sql("source='x'", "proj", lookback_minutes=0)
    assert "INTERVAL 1 MINUTE" in sql


def test_is_expired_datetime_like():
    from datetime import datetime, timedelta, timezone

    now_ts = datetime.now(timezone.utc).timestamp()
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    future = datetime.now(timezone.utc) + timedelta(hours=1)

    assert evaluator.is_expired(past, now_ts) is True
    assert evaluator.is_expired(future, now_ts) is False


def test_is_expired_iso_string_and_epoch():
    from datetime import datetime, timedelta, timezone

    now_ts = datetime.now(timezone.utc).timestamp()
    # naive ISO strings are interpreted as UTC
    past_iso = (datetime.now(timezone.utc) - timedelta(hours=1)).replace(tzinfo=None).isoformat()
    future_iso = (datetime.now(timezone.utc) + timedelta(hours=1)).replace(tzinfo=None).isoformat()

    assert evaluator.is_expired(past_iso, now_ts) is True
    assert evaluator.is_expired(future_iso, now_ts) is False
    assert evaluator.is_expired(now_ts - 60, now_ts) is True
    assert evaluator.is_expired(now_ts + 60, now_ts) is False


def test_is_expired_garbage_never_expires():
    # Bad data must never cause deletion (or a crash)
    assert evaluator.is_expired(None) is False
    assert evaluator.is_expired("not-a-date") is False
    assert evaluator.is_expired({"weird": True}) is False


def test_determine_slot_trigger_dispatches_deadman():
    # A deadman slot with no matching events should trigger via the dispatcher
    slot = {
        "alert_name": "no_vault_access",
        "alert_type": "deadman",
        "summary": "no vault access seen",
        "threshold": 0,
        "aggregation_key": "",
    }
    triggers = list(evaluator.determine_slot_trigger(slot, []))
    assert len(triggers) == 1
    assert triggers[0]["triggered"] is True

    # And a threshold slot (or one with no alert_type) uses threshold logic
    slot = {
        "alert_name": "a_login",
        "summary": "{{metadata.count}} logins",
        "threshold": 1,
        "aggregation_key": "",
    }
    events = [{"eventid": "1", "summary": "login"}]
    triggers = list(evaluator.determine_slot_trigger(slot, events))
    assert len(triggers) == 1
    assert triggers[0]["events"] == events
