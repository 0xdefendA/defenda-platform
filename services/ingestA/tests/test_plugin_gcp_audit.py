import copy
import json
import unittest
from pathlib import Path

from utils.plugins import register_plugins, send_event_to_plugins

SAMPLES_DIR = Path(__file__).parent / "samples"


def _normalize(event):
    """Run an event through the full normalization pipeline."""
    metadata = {"something": "something"}
    plugins = register_plugins("normalization_plugins")
    result, metadata = send_event_to_plugins(event, metadata, plugins)
    return result


def _load_sample():
    with open(SAMPLES_DIR / "sample_gcp_audit_set_iam_policy.json") as f:
        return json.load(f)


class TestPluginGcpAudit(unittest.TestCase):
    """Tests for the GCP Cloud Audit Log normalization plugin.

    The sample is shaped like the LogEntry a Cloud Logging sink delivers to
    Pub/Sub for the stratus-red-team gcp.persistence.invite-external-user
    technique (SetIamPolicy granting a role to an external user).
    """

    def test_source_and_tags(self):
        result = _normalize(_load_sample())
        assert result["source"] == "gcp_audit"
        assert "gcp_audit" in result["tags"]
        assert "gcp" in result["tags"]
        assert "iam-policy-change" in result["tags"]
        assert "service-account" in result["tags"]  # gserviceaccount principal

    def test_category(self):
        result = _normalize(_load_sample())
        assert result["category"] == "iam"

    def test_convenience_fields(self):
        result = _normalize(_load_sample())
        details = result["details"]
        assert details["user"] == (
            "attacker@sacrificial-project.iam.gserviceaccount.com"
        )
        assert details["methodname"] == "SetIamPolicy"
        assert details["servicename"] == "cloudresourcemanager.googleapis.com"
        assert details["resourcename"] == "projects/sacrificial-project"
        assert details["sourceipaddress"] == "203.0.113.50"
        assert details["project"] == "sacrificial-project"
        assert "gcloud" in details["useragent"]

    def test_policy_delta_extracted(self):
        result = _normalize(_load_sample())
        assert result["details"]["policy_delta"] == (
            "ADD roles/editor user:external-evil@gmail.com"
        )
        assert result["details"]["policy_member"] == "user:external-evil@gmail.com"

    def test_summary(self):
        result = _normalize(_load_sample())
        assert result["summary"] == (
            "attacker@sacrificial-project.iam.gserviceaccount.com SetIamPolicy "
            "projects/sacrificial-project "
            "(ADD roles/editor user:external-evil@gmail.com) "
            "from IP 203.0.113.50"
        )

    def test_event_time_from_log_entry(self):
        result = _normalize(_load_sample())
        assert result["utctimestamp"].startswith("2026-07-05T21:44:12")

    def test_ip_addresses_plugin_picks_up_caller_ip(self):
        result = _normalize(_load_sample())
        assert "203.0.113.50" in result["details"].get("_ipaddresses", [])

    def test_denied_authorization_is_warning(self):
        event = _load_sample()
        event["protoPayload"]["authorizationInfo"][0]["granted"] = False
        result = _normalize(event)
        assert result["severity"] == "WARNING"
        assert "denied" in result["tags"]

    def test_destructive_method_is_warning(self):
        event = _load_sample()
        event["protoPayload"]["methodName"] = "google.iam.admin.v1.DeleteServiceAccount"
        result = _normalize(event)
        assert result["severity"] == "WARNING"

    def test_non_audit_protopayload_untouched(self):
        # A protoPayload that is not an AuditLog (and no cloudaudit logName)
        # should pass through without claiming the event
        event = {
            "logName": "projects/x/logs/some-other-log",
            "protoPayload": {"@type": "type.googleapis.com/other.Thing"},
        }
        result = _normalize(event)
        assert result["source"] != "gcp_audit"

    def test_plugin_recorded_in_plugins_list(self):
        result = _normalize(_load_sample())
        assert "normalization_gcp_audit" in result["plugins"]
