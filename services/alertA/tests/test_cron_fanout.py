"""Regression tests for the /cron fan-out serialization outage.

Scenario symptom: alertA's /cron returned 500 every minute from a bad document write/serialization.

These tests both halves: the payload must serialize, and one bad document must
never stop the fan-out.
"""

import json
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest


class DatetimeWithNanoseconds(datetime):
    """Stand-in for google.api_core.datetime_helpers.DatetimeWithNanoseconds.

    The real class is a datetime subclass, which is why this bug is easy to miss:
    the value behaves like a datetime everywhere EXCEPT json.dumps, which
    dispatches on exact type via its C encoder and refuses anything it doesn't
    recognize -- subclass or not.
    """


@pytest.fixture
def main():
    """Import src.main with GCP clients stubbed out (no creds in CI)."""
    with patch("google.cloud.bigquery.Client"), patch(
        "google.cloud.firestore.Client"
    ), patch("google.cloud.pubsub_v1.PublisherClient"):
        import main as main_module

        return main_module


def test_firestore_timestamp_is_serializable(main):
    """The exact production payload must now encode."""
    expiration = DatetimeWithNanoseconds(
        2026, 7, 14, 19, 50, 5, tzinfo=timezone.utc
    )
    payload = {"type": "inflight", "data": {"expiration": expiration, "slots": [{}]}}

    encoded = json.dumps(payload, default=main._json_default)

    # Round-trips as ISO -- which is what the consumer side wants anyway: pydantic
    # coerces the string straight back to a datetime, and evaluator.is_expired()
    # already accepts both shapes.
    assert json.loads(encoded)["data"]["expiration"].startswith("2026-07-14T19:50:05")


def test_plain_datetime_also_serializable(main):
    """Not just the Firestore subclass -- any datetime."""
    out = json.dumps({"e": datetime(2026, 1, 1, tzinfo=timezone.utc)}, default=main._json_default)
    assert json.loads(out)["e"].startswith("2026-01-01")


def test_unknown_type_degrades_instead_of_exploding(main):
    """An unexpected Firestore type should produce a degraded payload, not a
    total detection outage. Stringified field > zero rules evaluated."""

    class Weird:
        def __str__(self):
            return "weird-value"

    out = json.dumps({"x": Weird()}, default=main._json_default)
    assert json.loads(out)["x"] == "weird-value"


def test_one_bad_inflight_doc_does_not_stop_rule_fanout(main):
    """THE regression. One undeliverable document must not take detection down.

    Before the fix, the raise escaped the loop and 500'd /cron, so none of the
    rules were published either. Here the publish of the poison doc fails, and
    every rule still goes out.
    """
    good_doc = MagicMock(id="good")
    good_doc.to_dict.return_value = {
        "inflight_id": "abc",
        "expiration": DatetimeWithNanoseconds(2026, 7, 14, tzinfo=timezone.utc),
    }
    poison_doc = MagicMock(id="poison")
    poison_doc.to_dict.side_effect = RuntimeError("corrupt document")

    published = []
    heartbeats = []

    def fake_publish(topic, data):
        # /cron publishes to two topics: rule/inflight fan-out on the evaluate
        # topic, and the deadman heartbeat on the ingest topic. Keep them apart.
        msg = json.loads(data.decode())
        (heartbeats if topic.endswith("defenda-event-ingest") else published).append(msg)

    main.publisher = MagicMock()
    main.publisher.publish.side_effect = fake_publish
    main.fs_client = MagicMock()
    main.fs_client.collection.return_value.stream.return_value = [good_doc, poison_doc]

    rules = [{"alert_name": "rule_one"}, {"alert_name": "rule_two"}]

    with patch.object(main, "load_rules", return_value=rules), patch.object(
        main, "verify_push_token"
    ):
        import asyncio

        result = asyncio.get_event_loop().run_until_complete(
            main.handle_cron(MagicMock())
        )

    # Both rules published, plus the one healthy inflight doc. The poison doc is
    # counted as a failure rather than killing the run.
    names = [p["data"].get("alert_name") for p in published if p["type"] == "rule"]
    assert names == ["rule_one", "rule_two"], "rule fan-out must survive a bad doc"

    assert result["failed"] == 1
    assert result["published"] == 3
    # Surfaced, not swallowed -- a deadman rule can alert on this.
    assert result["status"] == "degraded"

    # And the degradation must be OBSERVABLE, not just returned to a caller nobody
    # reads. The heartbeat carries failed>0 into the lake, where
    # alerta_cron_degraded picks it up. Otherwise we have merely swapped a loud
    # failure for a quiet one, which is the worse trade.
    assert len(heartbeats) == 1
    assert heartbeats[0]["details"]["failed"] == 1
