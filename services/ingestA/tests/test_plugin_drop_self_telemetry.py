"""Tests for the self-telemetry drop plugin.

The platform generates Data Access audit logs by operating -- alertA's per-minute
BigQuery queries against its own lake are the dominant example, and BigQuery Data
Access logs cannot be disabled at the source. This plugin sheds that self-read
noise. These tests pin BOTH halves of the contract, because the danger of a drop
filter is dropping too much:

  * the platform's own SELECT reads ARE dropped (the point);
  * writes, exports, other services, and non-platform identities are KEPT (so a
    compromised platform SA, or a real attacker, is never silenced).
"""

import os

# The plugin identifies "us" by service accounts in this project. Must be set
# BEFORE register_plugins instantiates the plugin (it reads env at construction).
os.environ["PLATFORM_PROJECT_ID"] = "prj-defenda-platform-adf"

from utils.plugins import register_plugins, send_event_to_plugins  # noqa: E402

SELF = "alerta-sa@prj-defenda-platform-adf.iam.gserviceaccount.com"
OUTSIDER = "attacker@evil.example.com"
DATA_ACCESS_LOG = "projects/prj-defenda-platform-adf/logs/cloudaudit.googleapis.com%2Fdata_access"
ACTIVITY_LOG = "projects/prj-defenda-platform-adf/logs/cloudaudit.googleapis.com%2Factivity"


def _normalize(event):
    plugins = register_plugins("normalization_plugins")
    result, _ = send_event_to_plugins(event, {"m": "m"}, plugins)
    return result  # None == dropped


def bq_event(principal, statement_type, method="google.cloud.bigquery.v2.JobService.InsertJob", log=DATA_ACCESS_LOG):
    return {
        "logName": log,
        "resource": {"type": "bigquery_project", "labels": {"project_id": "prj-defenda-platform-adf"}},
        "protoPayload": {
            "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
            "authenticationInfo": {"principalEmail": principal},
            "serviceName": "bigquery.googleapis.com",
            "methodName": method,
            "metadata": {
                "@type": "type.googleapis.com/google.cloud.audit.BigQueryAuditMetadata",
                "jobChange": {"job": {"jobConfig": {"queryConfig": {"statementType": statement_type}}}},
            },
        },
    }


def fs_event(principal, method, service="firestore.googleapis.com"):
    return {
        "logName": DATA_ACCESS_LOG,
        "protoPayload": {
            "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
            "authenticationInfo": {"principalEmail": principal},
            "serviceName": service,
            "methodName": method,
        },
    }


# --- DROP: the self-read noise we are here to shed -----------------------------

def test_platform_sa_bigquery_select_is_dropped():
    """The exact event from the report: alerta-sa running a SELECT against the
    lake. This is the per-minute heartbeat/rule-eval loop and it must not land."""
    assert _normalize(bq_event(SELF, "SELECT")) is None


def test_platform_sa_firestore_read_is_dropped():
    assert _normalize(fs_event(SELF, "google.firestore.v1.Firestore.RunQuery")) is None
    assert _normalize(fs_event(SELF, "google.firestore.v1.Firestore.Lookup")) is None


# --- KEEP: everything that could ever matter -----------------------------------

def test_outsider_bigquery_select_is_kept():
    """A NON-platform identity reading the lake is exactly the hunt signal (BQ
    exfil-by-query). Never drop it."""
    r = _normalize(bq_event(OUTSIDER, "SELECT"))
    assert r is not None
    assert r["details"]["user"] == OUTSIDER


def test_platform_sa_bigquery_write_is_kept():
    """A SELECT is a read; CTAS / EXPORT / DML are not. A compromised platform SA
    exfiltrating via CREATE TABLE AS SELECT or EXPORT DATA must stay visible."""
    for stype in ("CREATE_TABLE_AS_SELECT", "EXPORT", "INSERT", "DELETE", "MERGE"):
        assert _normalize(bq_event(SELF, stype)) is not None, stype


def test_platform_sa_firestore_write_is_kept():
    """Commit / BatchWrite are writes -- tampering or state manipulation stays visible."""
    assert _normalize(fs_event(SELF, "google.firestore.v1.Firestore.Commit")) is not None
    assert _normalize(fs_event(SELF, "google.firestore.v1.Firestore.BatchWrite")) is not None


def test_platform_sa_other_service_is_kept():
    """Only bigquery/firestore/datastore are in scope. iamcredentials
    (GenerateAccessToken -- impersonation) is a data_access event too, and is the
    single most important signal to KEEP."""
    impersonation = {
        "logName": DATA_ACCESS_LOG,
        "protoPayload": {
            "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
            "authenticationInfo": {"principalEmail": SELF},
            "serviceName": "iamcredentials.googleapis.com",
            "methodName": "GenerateAccessToken",
        },
    }
    assert _normalize(impersonation) is not None


def test_platform_sa_admin_activity_is_kept():
    """Only data_access is ever a drop candidate. An Admin Activity event (even a
    BQ one) from a platform SA is control-plane signal -- keep it."""
    e = bq_event(SELF, "SELECT", log=ACTIVITY_LOG)
    r = _normalize(e)
    assert r is not None
    assert r["details"]["audit_log_type"] == "activity"


def test_missing_statement_type_is_kept():
    """Fail-safe: if we cannot confirm it is a SELECT, we do not drop it."""
    e = bq_event(SELF, "SELECT")
    # remove the statementType so read-ness is unknowable
    del e["protoPayload"]["metadata"]["jobChange"]["job"]["jobConfig"]["queryConfig"]["statementType"]
    assert _normalize(e) is not None


def test_no_configured_project_keeps_everything():
    """If PLATFORM_PROJECT_ID is unset, we cannot identify 'us', so we must keep
    everything rather than guess. Verified by constructing the plugin directly."""
    import importlib
    import normalization_plugins.drop_self_telemetry as mod

    saved = os.environ.pop("PLATFORM_PROJECT_ID", None)
    os.environ.pop("PROJECT_ID", None)
    try:
        importlib.reload(mod)
        plug = mod.message()
        event = bq_event(SELF, "SELECT")
        # Feed it the normalized-ish shape the plugin expects.
        event.setdefault("details", {}).update(
            {"audit_log_type": "data_access", "user": SELF,
             "servicename": "bigquery.googleapis.com",
             "methodname": "google.cloud.bigquery.v2.jobservice.insertjob"}
        )
        result, _ = plug.onMessage(event, {})
        assert result is not None  # kept, because "us" is unknown
    finally:
        if saved is not None:
            os.environ["PLATFORM_PROJECT_ID"] = saved
        importlib.reload(mod)
