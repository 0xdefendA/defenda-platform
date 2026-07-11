"""Tests for the platform's self-monitoring rules.

The failure these guard against is embarrassing and easy: the deadman rule queries
`details.heartbeat`, the emitter writes `details.heartbeat_type`, nobody notices,
and the rule fires CRITICAL every 15 minutes forever -- or worse, is tuned into
silence and never fires again. A deadman rule that cannot match its own canary is
strictly worse than no deadman rule, because it manufactures confidence.

So these tests close the loop: take the payload alertA actually emits, and assert
the rule criteria actually select it.
"""

import glob
import json
import os
import re
from unittest.mock import MagicMock, patch

import pytest
import yaml

RULES_DIR = os.path.join(os.path.dirname(__file__), "..", "rules")


def load_rules():
    out = {}
    for f in glob.glob(os.path.join(RULES_DIR, "*.yml")):
        r = yaml.safe_load(open(f))
        out[r["alert_name"]] = r
    return out


@pytest.fixture
def main():
    with patch("google.cloud.bigquery.Client"), patch(
        "google.cloud.firestore.Client"
    ), patch("google.cloud.pubsub_v1.PublisherClient"):
        import main as main_module

        return main_module


@pytest.fixture
def heartbeat(main):
    """The literal event alertA publishes to the ingest topic."""
    captured = {}

    def capture(topic, data):
        captured["topic"] = topic
        captured["event"] = json.loads(data.decode())

    main.publisher = MagicMock()
    main.publisher.publish.side_effect = capture
    main.emit_heartbeat(published=12, failed=0, rules_loaded=6)
    return captured


def test_heartbeat_goes_through_the_real_ingest_path(heartbeat):
    """Not a side channel. The canary must traverse Pub/Sub -> ingestA -> BigQuery,
    or it only proves alertA's process is alive -- the least interesting thing that
    can be true."""
    assert heartbeat["topic"].endswith("/topics/defenda-event-ingest")


def test_heartbeat_matches_its_own_deadman_criteria(heartbeat):
    """THE closed loop. Every field the deadman rule filters on must exist, with
    the expected value, in the event the emitter actually produces."""
    event = heartbeat["event"]
    criteria = load_rules()["deadman_ingest_pipeline"]["criteria"]

    # criteria: source='defenda_platform' AND JSON_VALUE(details.heartbeat) = 'cron'
    src = re.search(r"source\s*=\s*'([^']+)'", criteria).group(1)
    assert event["source"] == src, (
        f"deadman queries source='{src}' but the heartbeat emits "
        f"source='{event['source']}' -- the rule can never fire"
    )

    for path, expected in re.findall(
        r"JSON_VALUE\(details\.(\w+)\)\s*=\s*'([^']+)'", criteria
    ):
        assert path in event["details"], (
            f"deadman filters on details.{path}, which the heartbeat never emits"
        )
        assert str(event["details"][path]) == expected


def test_degraded_rule_matches_a_failing_heartbeat(main):
    """The rule that would have caught 2026-07-11. It keys on details.failed > 0,
    so the emitter must publish `failed` as a castable integer."""
    captured = {}
    main.publisher = MagicMock()
    main.publisher.publish.side_effect = lambda t, d: captured.update(
        json.loads(d.decode())
    )
    main.emit_heartbeat(published=3, failed=9, rules_loaded=12)

    criteria = load_rules()["alerta_cron_degraded"]["criteria"]
    field = re.search(r"CAST\(JSON_VALUE\(details\.(\w+)\) AS INT64\)", criteria).group(1)

    assert field in captured["details"], f"rule casts details.{field}; emitter omits it"
    assert int(captured["details"][field]) == 9  # castable to INT64, as the SQL assumes


def test_every_deadman_rule_fires_on_absence(main):
    """A deadman must trigger when the query returns NOTHING. The engine fires when
    count <= threshold, so threshold must be 0 -- a threshold of 1 would mean the
    rule only fires when events ARE present, which is backwards and silent."""
    import evaluator

    for name, rule in load_rules().items():
        if rule.get("alert_type") != "deadman":
            continue
        assert rule["threshold"] == 0, f"{name}: deadman threshold must be 0"

        triggered = list(evaluator.determine_deadman_trigger(rule, events=[]))
        assert triggered, f"{name}: does not fire on an empty result -- it is decorative"
        assert triggered[0]["triggered"] is True


def test_deadman_rules_have_a_sane_lookback(main):
    """The engine defaults lookback to 5 minutes. For a deadman that is a pager that
    goes off on ordinary late-arriving telemetry. Every deadman must set its own."""
    for name, rule in load_rules().items():
        if rule.get("alert_type") != "deadman":
            continue
        lb = rule.get("lookback_minutes")
        assert lb and lb >= 15, f"{name}: lookback {lb}m is too tight for a deadman"


def test_deadman_rules_do_not_fire_when_the_feed_is_healthy(main):
    """The other half. A deadman that fires even when events ARE arriving is an
    alert-fatigue machine that gets muted, and then it is not a deadman at all."""
    import evaluator

    rule = load_rules()["deadman_ingest_pipeline"]
    healthy = [
        {
            "utctimestamp": "2026-07-11T20:00:00",
            "source": "defenda_platform",
            "summary": "alertA cron heartbeat: 12 published, 0 failed",
            "details": {"heartbeat": "cron", "published": 12, "failed": 0},
        }
    ]
    assert not list(evaluator.determine_deadman_trigger(rule, healthy))
