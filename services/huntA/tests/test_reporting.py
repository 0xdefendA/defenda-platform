import reporting


class FakeReport:
    """Minimal stand-in for shared.hunt.engine.Report (avoids importing ADK)."""

    def __init__(self, verdict, summary, findings):
        self.verdict = verdict
        self.summary = summary
        self.findings = findings


class FakeFinding:
    def __init__(self, **kw):
        self._d = kw

    def model_dump(self):
        return dict(self._d)


def _finding(confidence="high", **kw):
    base = {
        "title": "external owner grant",
        "confidence": confidence,
        "entities": ["evil@gmail.com"],
        "narrative": "granted roles/owner to an external user",
        "evidence_eventids": ["abc-123"],
        "why_not_benign": "external identity, owner role, off-hours",
    }
    base.update(kw)
    return FakeFinding(**base)


def _cost():
    return {"queries": 5, "bytes_scanned": 1024, "produced_report": True}


# --- report_to_doc ------------------------------------------------------------


def test_report_to_doc_with_findings():
    report = FakeReport("findings", "found something", [_finding()])
    doc = reporting.report_to_doc(
        run_id="r1", window={"since": "a", "until": "b"}, model="m",
        report=report, cost=_cost(),
    )
    assert doc["verdict"] == "findings"
    assert doc["produced_report"] is True
    assert len(doc["findings"]) == 1
    assert doc["findings"][0]["confidence"] == "high"


def test_report_to_doc_persists_transcript():
    report = FakeReport("nothing_of_concern", "quiet", [])
    transcript = [
        {"kind": "query_run", "n": 1, "sql": "SELECT * FROM feed_coverage", "row_count": 3},
        {"kind": "query_run", "n": 2, "sql": "SELECT * FROM iam_changes", "row_count": 0},
    ]
    doc = reporting.report_to_doc(
        run_id="r", window={}, model="m", report=report, cost=_cost(),
        transcript=transcript,
    )
    assert len(doc["transcript"]) == 2
    assert doc["transcript"][0]["sql"].startswith("SELECT")


def test_report_to_doc_trims_long_text_and_caps_records():
    big = [{"kind": "model_text", "text": "x" * 10000} for _ in range(500)]
    doc = reporting.report_to_doc(
        run_id="r", window={}, model="m", report=None, cost=_cost(), transcript=big
    )
    assert len(doc["transcript"]) == reporting.MAX_TRANSCRIPT_RECORDS
    assert doc["transcript"][0]["text"].endswith("…[truncated]")


def test_report_to_doc_handles_no_transcript():
    doc = reporting.report_to_doc(
        run_id="r", window={}, model="m", report=None, cost=_cost()
    )
    assert doc["transcript"] == []


def test_report_to_doc_nothing_of_concern():
    report = FakeReport("nothing_of_concern", "quiet window", [])
    doc = reporting.report_to_doc(
        run_id="r2", window={}, model="m", report=report, cost=_cost()
    )
    assert doc["verdict"] == "nothing_of_concern"
    assert doc["findings"] == []


def test_report_to_doc_no_report_is_its_own_state():
    # A run that never produced a report must NOT read as a clean bill of health.
    doc = reporting.report_to_doc(
        run_id="r3", window={}, model="m", report=None, cost=_cost()
    )
    assert doc["verdict"] == "no_report"
    assert doc["produced_report"] is False


def test_report_to_doc_model_unavailable_summary():
    cost = {"queries": 0, "attempts": 4, "model_unavailable": True}
    doc = reporting.report_to_doc(
        run_id="r4", window={}, model="m", report=None, cost=cost
    )
    assert doc["verdict"] == "no_report"
    assert "unavailable" in doc["summary"].lower()
    assert "NOT examined" in doc["summary"]


# --- should_notify: only surface things worth pursuing ------------------------


def test_should_notify_findings_above_threshold():
    doc = {"verdict": "findings", "findings": [_finding("high").model_dump()]}
    assert reporting.should_notify(doc, "HIGH") is True


def test_should_notify_findings_below_threshold():
    doc = {"verdict": "findings", "findings": [_finding("low").model_dump()]}
    # low confidence -> LOW severity, below a HIGH threshold
    assert reporting.should_notify(doc, "HIGH") is False
    # ...but surfaces if the threshold is lowered
    assert reporting.should_notify(doc, "LOW") is True


def test_should_notify_never_pages_on_quiet_or_no_report():
    assert reporting.should_notify({"verdict": "nothing_of_concern", "findings": []}, "LOW") is False
    assert reporting.should_notify({"verdict": "no_report", "findings": []}, "LOW") is False


def test_should_notify_uses_highest_confidence_finding():
    doc = {
        "verdict": "findings",
        "findings": [_finding("low").model_dump(), _finding("high").model_dump()],
    }
    assert reporting.should_notify(doc, "HIGH") is True


# --- notify_slack: injected post, no network ----------------------------------


def test_notify_slack_posts_when_appropriate():
    calls = []
    cfg = {"enabled": True, "webhook_url": "https://hooks.slack.com/x", "min_severity": "HIGH"}
    doc = {
        "verdict": "findings", "run_id": "r", "model": "m",
        "window": {"since": "a", "until": "b"},
        "summary": "s", "findings": [_finding("high").model_dump()],
    }
    posted = reporting.notify_slack(cfg, doc, post=lambda url, body: calls.append((url, body)))
    assert posted is True
    assert len(calls) == 1
    assert calls[0][0] == "https://hooks.slack.com/x"
    assert "blocks" in calls[0][1]


def test_notify_slack_silent_when_disabled_or_quiet():
    calls = []
    post = lambda url, body: calls.append((url, body))
    doc_quiet = {"verdict": "nothing_of_concern", "findings": []}
    assert reporting.notify_slack(
        {"enabled": True, "webhook_url": "https://hooks.slack.com/x"}, doc_quiet, post=post
    ) is False
    doc_find = {"verdict": "findings", "run_id": "r", "model": "m", "window": {},
                "summary": "s", "findings": [_finding("high").model_dump()]}
    assert reporting.notify_slack({"enabled": False}, doc_find, post=post) is False
    assert reporting.notify_slack({"enabled": True, "webhook_url": ""}, doc_find, post=post) is False
    assert calls == []


def test_build_slack_blocks_shape():
    doc = {
        "verdict": "findings", "run_id": "r1", "model": "gemini",
        "window": {"since": "a", "until": "b"}, "summary": "sum",
        "findings": [_finding("high").model_dump()],
    }
    payload = reporting.build_slack_blocks(doc)
    assert isinstance(payload["blocks"], list)
    texts = str(payload)
    assert "Hunt findings" in texts
    assert "external owner grant" in texts
