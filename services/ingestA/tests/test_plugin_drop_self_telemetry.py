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


def bq_completed_event(principal, statement_type):
    """Old-style jobservice.jobcompleted: statementType lives under
    servicedata.jobCompletedEvent, a DIFFERENT path than InsertJob."""
    return {
        "logName": DATA_ACCESS_LOG,
        "resource": {"type": "bigquery_resource", "labels": {"project_id": "prj-defenda-platform-adf"}},
        "protoPayload": {
            "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
            "authenticationInfo": {"principalEmail": principal},
            "serviceName": "bigquery.googleapis.com",
            "methodName": "jobservice.jobcompleted",
            "serviceData": {
                "@type": "type.googleapis.com/google.cloud.bigquery.logging.v1.AuditData",
                "jobCompletedEvent": {
                    "eventName": "query_job_completed",
                    "job": {"jobConfiguration": {"query": {"statementType": statement_type}}},
                },
            },
        },
    }


FIREBASE_RULES_AGENT = "service-56013939588@firebase-rules.iam.gserviceaccount.com"


def fs_event(principal, method, collection="users", service="firestore.googleapis.com"):
    """A Firestore data_access event whose document path names a collection.
    metadata.keys is where reads (Listen/Lookup) carry the doc path."""
    doc = f"projects/prj-defenda-platform-adf/databases/(default)/documents/{collection}/docid123"
    return {
        "logName": DATA_ACCESS_LOG,
        "protoPayload": {
            "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
            "authenticationInfo": {"principalEmail": principal},
            "serviceName": service,
            "methodName": method,
            "metadata": {
                "@type": "type.googleapis.com/google.cloud.audit.DatastoreServiceData",
                "keys": [doc],
            },
        },
    }


def fs_write_event(principal, collection):
    """A Firestore write (Commit) whose doc path lives under request.writes."""
    doc = f"projects/prj-defenda-platform-adf/databases/(default)/documents/{collection}/docid123"
    return {
        "logName": DATA_ACCESS_LOG,
        "protoPayload": {
            "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
            "authenticationInfo": {"principalEmail": principal},
            "serviceName": "firestore.googleapis.com",
            "methodName": "google.firestore.v1.Firestore.Commit",
            "request": {"writes": [{"update": {"name": doc}}]},
        },
    }


# --- DROP: the self-read noise we are here to shed -----------------------------

def test_platform_sa_bigquery_select_is_dropped():
    """The exact event from the report: alerta-sa running a SELECT against the
    lake. This is the per-minute heartbeat/rule-eval loop and it must not land."""
    assert _normalize(bq_event(SELF, "SELECT")) is None


def test_web_ui_presence_listen_is_dropped():
    """The exact event from the report: the firebase-rules web agent opening a
    realtime Listen on a users/ presence doc as a human moves around the UI. Pure
    plumbing, high volume, no security value."""
    assert _normalize(fs_event(FIREBASE_RULES_AGENT, "google.firestore.v1.Firestore.Listen", collection="users")) is None


def fs_query_listen_event(principal, collection):
    """A Listen/RunQuery over a COLLECTION (the UI subscribing to a list): the
    collection is named in structuredQuery.from, with no document path in
    metadata.keys."""
    return {
        "logName": DATA_ACCESS_LOG,
        "protoPayload": {
            "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
            "authenticationInfo": {"principalEmail": principal},
            "serviceName": "firestore.googleapis.com",
            "methodName": "google.firestore.v1.Firestore.Listen",
            "metadata": {"@type": "type.googleapis.com/google.cloud.audit.DatastoreServiceData"},
            "request": {
                "addTarget": {
                    "query": {
                        "parent": "projects/prj-defenda-platform-adf/databases/(default)/documents",
                        "structuredQuery": {"from": [{"collectionId": collection}]},
                    }
                }
            },
        },
    }


def test_web_ui_collection_query_listen_is_dropped():
    """The events/incidents page subscribing to a collection query. The collection
    is in structuredQuery.from, not a document path -- the extractor must find it
    there too, or this whole class of UI list-view noise slips through."""
    assert _normalize(fs_query_listen_event(FIREBASE_RULES_AGENT, "incidents")) is None
    assert _normalize(fs_query_listen_event(FIREBASE_RULES_AGENT, "processed_events")) is None


def test_query_listen_on_keep_collection_is_kept():
    """A collection-query subscription to a keep-list collection stays."""
    assert _normalize(fs_query_listen_event(FIREBASE_RULES_AGENT, "rules")) is not None


def test_platform_sa_operational_collection_crud_is_dropped():
    """Platform SAs churning internal bookkeeping collections -- reads AND writes."""
    assert _normalize(fs_event(SELF, "google.firestore.v1.Firestore.Lookup", collection="processed_events")) is None
    assert _normalize(fs_write_event(SELF, "inflight_alerts")) is None
    assert _normalize(fs_write_event(SELF, "processed_events")) is None


def test_config_collections_are_kept():
    """Only CONFIG collections (rules, settings) are kept -- changes to how the
    platform is configured. Keep read AND write."""
    for coll in ("rules", "settings"):
        assert _normalize(fs_write_event(SELF, coll)) is not None, f"write {coll}"
        assert _normalize(fs_event(SELF, "google.firestore.v1.Firestore.Lookup", collection=coll)) is not None, f"read {coll}"


def test_platform_record_crud_is_dropped():
    """Using the platform -- viewing OR updating alerts, incidents, events -- is
    normal activity, not audited. All of it drops, read and write."""
    for coll in ("alerts", "incidents", "events"):
        assert _normalize(fs_write_event(SELF, coll)) is None, f"write {coll}"
        assert _normalize(fs_event(SELF, "google.firestore.v1.Firestore.Lookup", collection=coll)) is None, f"read {coll}"


def test_external_identity_firestore_is_kept():
    """An identity that is neither a platform SA nor the web agent touching
    Firestore -- e.g. a compromised SA with direct datastore IAM -- is signal,
    kept regardless of collection."""
    assert _normalize(fs_event(OUTSIDER, "google.firestore.v1.Firestore.Lookup", collection="users")) is not None


def test_undeterminable_collection_is_kept():
    """Fail-safe: if we cannot parse a collection from the doc path, keep it rather
    than drop something we cannot classify."""
    e = fs_event(SELF, "google.firestore.v1.Firestore.Lookup")
    e["protoPayload"].pop("metadata", None)  # remove the only doc-path source
    assert _normalize(e) is not None


def test_platform_sa_bigquery_getqueryresults_is_dropped():
    """The SECOND half of every query loop: fetching results. It carries no
    statementType at the InsertJob path but physically cannot write, so it is a
    read regardless. Missing this left half the self-telemetry flowing."""
    e = bq_event(SELF, "SELECT", method="jobservice.getqueryresults")
    # getqueryresults has no jobChange.statementType -- prove we drop it anyway.
    del e["protoPayload"]["metadata"]
    assert _normalize(e) is None


def test_platform_sa_bigquery_jobcompleted_select_is_dropped():
    """jobservice.jobcompleted carries statementType at a different payload path
    than InsertJob. The statement-type-anywhere classifier must find it."""
    assert _normalize(bq_completed_event(SELF, "SELECT")) is None


def test_platform_sa_bigquery_jobcompleted_write_is_kept():
    """A write job's completion event (CTAS / EXPORT) must stay visible -- this is
    where you'd see a compromised SA exfiltrating to a new table."""
    for stype in ("CREATE_TABLE_AS_SELECT", "EXPORT", "INSERT", "DELETE"):
        assert _normalize(bq_completed_event(SELF, stype)) is not None, stype


def test_platform_sa_bigquery_pure_reads_are_dropped():
    """Result/metadata read methods drop unconditionally, old- and new-style names."""
    for method in (
        "jobservice.getjob",
        "tabledataservice.list",
        "google.cloud.bigquery.v2.JobService.GetQueryResults",
        "google.cloud.bigquery.v2.TableDataService.List",
    ):
        e = bq_event(SELF, "SELECT", method=method)
        e["protoPayload"].pop("metadata", None)
        assert _normalize(e) is None, method


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


# NOTE: Firestore writes are no longer unconditionally kept. Per the collection
# policy, writes to OPERATIONAL collections drop (see
# test_platform_sa_operational_collection_crud_is_dropped) while writes to the
# security-meaningful keep-list survive (test_security_meaningful_collections_are_kept).
# Structural changes (create database, deploy rules) are Admin Activity and never
# reach this plugin at all.


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
