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


def _load(name):
    with open(SAMPLES_DIR / name) as f:
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


class TestGcpAuditLogTypeDiscriminator(unittest.TestCase):
    """`audit_log_type` distinguishes the four Cloud Audit Log streams.

    Why this is load-bearing rather than metadata hygiene: the streams have
    totally different collection semantics. Admin Activity is always on and free;
    Data Access is OFF by default and only exists where explicitly enabled.

    Without the discriminator, `gcp_audit` is one undifferentiated source and a
    hunt skill cannot answer "is the feed I depend on actually flowing here?" A
    skill keyed on GenerateAccessToken (a Data Access event) would return empty
    wherever Data Access is not enabled -- and empty looks exactly like a quiet
    environment. It would still score perfectly against an eval fixture captured
    somewhere the logs DO flow. This field is what lets such a skill declare
    `requires: [gcp_data_access]` and get SKIPPED instead of silently detecting
    nothing.
    """

    def _with_log_name(self, log_name):
        event = _load_sample()
        event["logName"] = log_name
        return _normalize(event)

    def test_admin_activity(self):
        result = self._with_log_name(
            "projects/p/logs/cloudaudit.googleapis.com%2Factivity"
        )
        assert result["details"]["audit_log_type"] == "activity"
        assert "gcp_audit_activity" in result["tags"]

    def test_data_access(self):
        result = self._with_log_name(
            "projects/p/logs/cloudaudit.googleapis.com%2Fdata_access"
        )
        assert result["details"]["audit_log_type"] == "data_access"
        assert "gcp_audit_data_access" in result["tags"]

    def test_system_event(self):
        result = self._with_log_name(
            "projects/p/logs/cloudaudit.googleapis.com%2Fsystem_event"
        )
        assert result["details"]["audit_log_type"] == "system_event"

    def test_policy_denied_uses_policy_suffix_not_policy_denied(self):
        """The log name is %2Fpolicy, NOT %2Fpolicy_denied -- an easy filter bug."""
        result = self._with_log_name(
            "projects/p/logs/cloudaudit.googleapis.com%2Fpolicy"
        )
        assert result["details"]["audit_log_type"] == "policy_denied"

    def test_org_and_folder_scoped_log_names_still_resolve(self):
        """Aggregated org sinks deliver entries whose logName is org/folder-scoped,
        not project-scoped. Matching on the suffix rather than a project prefix is
        what makes collectA's include_children sink work."""
        for prefix in ("organizations/1234", "folders/5678", "billingAccounts/ABC"):
            result = self._with_log_name(
                f"{prefix}/logs/cloudaudit.googleapis.com%2Fdata_access"
            )
            assert result["details"]["audit_log_type"] == "data_access"


class TestGcpAuditKnownMappingGaps(unittest.TestCase):
    """Predicted mapping gaps, written BEFORE the phase 2a detonation.

    These assert the behavior we WANT and are marked expected-failure, so they
    document the gap without freezing the bug into the suite. When the plugin is
    fixed they flip to unexpected-pass and the decorator comes off.

    The live detonation confirms or refutes each one against real GCP payloads --
    which is the entire point of detonating before writing the first hunt skill.
    A hunt agent cannot find what ingest silently dropped, and a NULL column
    looks exactly like a quiet environment.
    """

    def test_multi_binding_policy_captures_every_delta(self):
        """FIXED (was GAP 1): the plugin used to read bindingDeltas[0] and drop the rest.

        A single SetIamPolicy call routinely carries several bindingDeltas. In this
        fixture the owner grant and the external-user grant both sit BEHIND a benign
        roles/viewer grant at index 0 -- so the old code reported the boring one and
        the external-grant hunt came back clean. Worse than a miss: a confidently
        wrong answer.
        """
        result = _normalize(_load("sample_gcp_audit_set_iam_policy_multi_binding.json"))
        details = result["details"]

        members = details.get("policy_members", [])
        assert (
            "serviceAccount:stratus-backdoor@sacrificial-project.iam.gserviceaccount.com"
            in members
        )
        assert "user:external-evil@gmail.com" in members
        assert "roles/owner" in details.get("policy_roles", [])
        assert "roles/owner" in details.get("policy_delta", "")
        assert details["policy_delta_count"] == 3
        assert "multi-binding-change" in result["tags"]

    def test_multi_binding_scalars_are_the_first_delta_only(self):
        """The scalar fields are a compatibility shim and a footgun. Pin the
        behavior so nobody mistakes them for the whole story: policy_member is
        bindingDeltas[0], which here is the BENIGN grant. Hunts must use the arrays.
        """
        result = _normalize(_load("sample_gcp_audit_set_iam_policy_multi_binding.json"))
        details = result["details"]

        assert details["policy_member"] == (
            "serviceAccount:benign-app@sacrificial-project.iam.gserviceaccount.com"
        )
        # ...while the array still carries the grant that actually matters.
        assert "user:external-evil@gmail.com" in details["policy_members"]

    def test_single_binding_scalars_unchanged(self):
        """Existing rules/views read the scalar fields. The multi-delta fix must not
        change what a single-delta event looks like."""
        result = _normalize(_load_sample())
        details = result["details"]

        assert details["policy_delta"] == "ADD roles/editor user:external-evil@gmail.com"
        assert details["policy_member"] == "user:external-evil@gmail.com"
        assert details["policy_members"] == ["user:external-evil@gmail.com"]
        assert "multi-binding-change" not in result["tags"]

    def test_service_account_scoped_policy_extracts_member(self):
        """SetIamPolicy on a service account (iam.googleapis.com), not a project.

        Originally feared as a gap: the plugin reads
        protoPayload.serviceData.policyDelta.bindingDeltas, and we suspected
        iam.googleapis.com might carry the policy only in request/response.
        Fact-check against stratus's published detection sample for
        backdoor-service-account-policy showed the iam.googleapis.com log DOES
        carry serviceData.policyDelta.bindingDeltas -- same shape as project
        events. So the existing path should work, and this asserts it does.

        Still confirmed by live detonation, but no longer a predicted failure.
        If this ever breaks, real GCP diverged from the documented sample --
        capture the payload and update the fixture.
        """
        result = _normalize(_load("sample_gcp_audit_sa_scoped_set_iam_policy.json"))
        details = result["details"]

        assert result["source"] == "gcp_audit"
        assert details["policy_member"] == "user:external-evil@gmail.com"
        assert "roles/iam.serviceAccountTokenCreator" in details.get("policy_delta", "")

    def test_service_account_scoped_policy_is_at_least_tagged(self):
        """Whatever the delta shape turns out to be, the event must still be
        claimed, attributed, and tagged -- otherwise it never even reaches the
        iam_changes view for the agent to reason about."""
        result = _normalize(_load("sample_gcp_audit_sa_scoped_set_iam_policy.json"))

        assert result["source"] == "gcp_audit"
        assert result["details"]["user"] == (
            "hunta-canary@sacrificial-project.iam.gserviceaccount.com"
        )
        assert "iam-policy-change" in result["tags"]
        assert result["category"] == "iam"
