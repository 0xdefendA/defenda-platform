import os

from utils.dotdict import DotDict


# Services whose READ traffic from our own platform SAs is pure self-noise:
# the platform querying its own lake / state. Deliberately NOT iamcredentials
# (impersonation is crown-jewel signal) or any control-plane service.
SELF_READ_SERVICES = (
    "bigquery.googleapis.com",
    "firestore.googleapis.com",
    "datastore.googleapis.com",
)

# Firestore / Datastore READ method leaves. Writes (commit, batchwrite) are NOT
# here -- a compromised SA writing/deleting must stay visible.
DATASTORE_READ_METHODS = (
    "lookup",
    "runquery",
    "runaggregationquery",
    "batchget",
    "listen",
)


class message(object):
    def __init__(self):
        """
        Drop the platform's own self-referential read telemetry.

        The platform generates Data Access audit logs by OPERATING: alertA runs a
        BigQuery query every minute (the deadman heartbeat + rule evaluation), that
        query is a `JobService.InsertJob` Data Access event, it flows through the
        sink back into the lake, and next minute's query re-reads it. BigQuery Data
        Access logs cannot be disabled at the source and are billable, so the only
        lever is dropping them downstream. Dropping them reduces cost,
        solves for drowning real signal, and making the platform's own plumbing look like
        activity worth hunting.

        SCOPE (deliberately surgical):
        drop ONLY when ALL hold:
          * it is a data_access event,
          * from a service account in OUR OWN platform project,
          * on BigQuery / Firestore / Datastore,
          * and it is a READ (a BigQuery SELECT, or a datastore read method).

        KEPT (never dropped), so a compromised platform SA is not invisible:
          * writes, exports, CTAS, MERGE, DELETE -- potential exfil / tampering,
          * anything on iamcredentials, IAM, or any other service,
          * any Admin Activity event,
          * data_access by any NON-platform identity (the actual hunt signal).

        Fail-safe: if anything is uncertain, KEEP the event. We drop only what we
        are sure is our own routine self-read.

        Registers on the `gcp_audit_data_access` tag that the gcp_audit plugin adds
        (priority 20), so this runs after normalization has populated
        details.user / servicename / audit_log_type. Priority 30.
        """
        self.registration = ["gcp_audit_data_access"]
        self.priority = 30

        # The project whose service accounts are "us". A principal
        # <name>@<self_project>.iam.gserviceaccount.com is a platform SA.
        self.self_project = os.environ.get(
            "PLATFORM_PROJECT_ID", os.environ.get("PROJECT_ID", "")
        )
        self._self_sa_suffix = (
            f"@{self.self_project}.iam.gserviceaccount.com" if self.self_project else None
        )

    def _is_platform_sa(self, principal: str) -> bool:
        # No configured project => we cannot safely identify "us" => keep everything.
        if not self._self_sa_suffix:
            return False
        return principal.endswith(self._self_sa_suffix)

    def _is_self_read(self, dot, service: str, method: str) -> bool:
        method = method.lower()

        if service == "bigquery.googleapis.com":
            # A read query is InsertJob with statementType SELECT. Anything else
            # (CREATE_TABLE_AS_SELECT, MERGE, INSERT, UPDATE, DELETE, EXPORT, or a
            # missing/other statement type) is NOT dropped -- it could be exfil or
            # tampering.
            if "insertjob" not in method:
                return False
            stype = str(
                dot.get(
                    "details.protopayload.metadata.jobchange.job."
                    "jobconfig.queryconfig.statementtype",
                    "",
                )
            ).upper()
            return stype == "SELECT"

        if service in ("firestore.googleapis.com", "datastore.googleapis.com"):
            leaf = method.rsplit(".", 1)[-1]
            return leaf in DATASTORE_READ_METHODS

        return False

    def onMessage(self, message, metadata):
        dot = DotDict(message)

        # Belt-and-suspenders: the registration tag should guarantee this, but do
        # not trust it -- only ever consider data_access.
        if dot.get("details.audit_log_type", "") != "data_access":
            return (message, metadata)

        principal = str(dot.get("details.user", ""))
        service = str(dot.get("details.servicename", ""))
        method = str(dot.get("details.methodname", ""))

        if (
            service in SELF_READ_SERVICES
            and self._is_platform_sa(principal)
            and self._is_self_read(dot, service, method)
        ):
            # None signals the plugin runner to drop the event (see
            # utils/plugins.send_event_to_plugins and main.py's short-circuit).
            return (None, metadata)

        return (message, metadata)
