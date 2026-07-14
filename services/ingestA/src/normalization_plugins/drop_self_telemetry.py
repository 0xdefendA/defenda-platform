import os
import re

from utils.dotdict import DotDict


FIRESTORE_SERVICES = ("firestore.googleapis.com", "datastore.googleapis.com")

# Google-managed service agent that evaluates Firestore security rules for our web
# clients. Its data_access events ARE the respondA UI being used by a human -- the
# noisiest of which is presence (folks moving around alerts sets a presence doc).
FIREBASE_RULES_AGENT_SUFFIX = "@firebase-rules.iam.gserviceaccount.com"

# Firestore collections that hold CONFIGURATION (detection rules, platform
# settings). We keep WRITES to these -- a config CHANGE -- and drop READS of them
# (viewing the rules page is just using the platform). Every other collection drops
# both reads and writes. Overridable via env for tuning without a code change.
#
# NOTE: the non-normal things worth logging -- deleting a database, changing
# security rules, IAM -- are Admin Activity, a different audit_log_type this plugin
# never sees, so they are kept automatically regardless of this list. This list is
# only for CONFIG that happens to be stored as Firestore documents.
FIRESTORE_CONFIG_COLLECTIONS = tuple(
    c.strip()
    for c in os.environ.get(
        "FIRESTORE_AUDIT_COLLECTIONS", "rules,settings"
    ).split(",")
    if c.strip()
)

# Firestore/Datastore write method leaves. A write to a config collection is the
# only Firestore data_access we keep; everything else (all reads, and writes to
# non-config collections) is normal platform use and drops.
FIRESTORE_WRITE_METHODS = ("commit", "batchwrite", "write")

# Pull the collection out of a Firestore document resource path
# (.../documents/<collection>/<docid>).
_DOC_COLLECTION_RE = re.compile(r"/documents/([^/]+)/")

# A BigQuery query emits several data_access events across its lifecycle
# (InsertJob "first"=jobInsertion / "last"=jobChange, JobCompleted, GetQueryResults),
# under BOTH an old audit format (servicedata.*) and a new one (metadata.*), with
# the method named old-style ("jobservice.insert") or new-style
# ("...JobService.InsertJob"). Enumerating every path/method is a losing game (it
# leaked for four rounds). Instead: the platform's SAs only ever QUERY the lake --
# they never write to BigQuery via jobs -- so for a platform SA, DROP by default and
# keep ONLY a positively-identified WRITE query (CTAS / EXPORT / DML), found by
# searching the payload for a statementType anywhere. A SELECT, or no statement at
# all (a bare read/fetch), is noise and drops.
BQ_WRITE_STATEMENT_TYPES = (
    "CREATE_TABLE_AS_SELECT",
    "CREATE_TABLE",
    "CREATE_VIEW",
    "CREATE_MATERIALIZED_VIEW",
    "INSERT",
    "UPDATE",
    "DELETE",
    "MERGE",
    "EXPORT",
    "DROP_TABLE",
    "TRUNCATE_TABLE",
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

        SCOPE (deliberately surgical), two shapes of self-noise:

        BigQuery -- our own platform SA reading our own lake:
          drop READS (SELECT queries, result/metadata reads: GetQueryResults,
          GetJob, get/list). KEEP writes/exports/CTAS/DML -- a compromised SA
          exfiltrating or tampering stays visible. (Accepted trade: that SA's
          plain reads and metadata recon of our own project go unlogged.)

        Firestore / Datastore -- our own identities USING the platform (platform
        SAs, and the firebase-rules web agent = the respondA UI driven by a human):
          drop READS AND WRITES of everything EXCEPT config. Viewing and updating
          alerts, incidents, events; presence; dedup markers; inflight churn --
          all normal platform usage, all dropped. We do not audit people using the
          platform.
          KEEP only the CONFIG collections (rules, settings) -- changes to how the
          platform is configured.

        KEPT (never dropped) across the board:
          * BigQuery writes/exports/DML,
          * anything on iamcredentials, IAM, or any other service,
          * ANY Admin Activity event -- so the non-normal things worth logging
            (deleting a database, deploying/altering security rules, IAM changes)
            are always kept (different audit_log_type; never seen here),
          * Firestore CRUD on the config keep-list,
          * data_access by any NON-self identity (the actual hunt signal).

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

    def _is_self_identity(self, principal: str) -> bool:
        """'Us' for Firestore purposes: our own platform SAs, plus the
        firebase-rules web agent (our UI being used by an authenticated human).
        Anything else touching Firestore -- a stray user or SA with direct
        datastore IAM -- is NOT us, and is kept as signal."""
        return self._is_platform_sa(principal) or principal.endswith(
            FIREBASE_RULES_AGENT_SUFFIX
        )

    def _firestore_collection(self, dot) -> str:
        """Best-effort collection name for the event. '' if undeterminable ->
        caller fail-safe KEEPs.

        Two shapes: document-targeted ops carry a .../documents/<collection>/<id>
        path; query/collection-targeted ops (a Listen or RunQuery over a
        collection, e.g. the UI subscribing to a list) name the collection
        directly as structuredQuery.from[].collectionId with no document path."""

        # 1) structured-query targets name the collection directly.
        for qpath in (
            "details.protopayload.request.addtarget.query.structuredquery.from",
            "details.protopayload.request.structuredquery.from",
            "details.protopayload.request.newtransaction.structuredquery.from",
        ):
            frm = dot.get(qpath, []) or []
            if isinstance(frm, list):
                for f in frm:
                    if isinstance(f, dict) and f.get("collectionid"):
                        return str(f["collectionid"])

        # 2) document-path targets: parse the collection out of the resource path.
        candidates = []

        keys = dot.get("details.protopayload.metadata.keys", []) or []
        if isinstance(keys, list):
            candidates += [k for k in keys if isinstance(k, str)]

        listen = (
            dot.get("details.protopayload.request.addtarget.documents.documents", [])
            or []
        )
        if isinstance(listen, list):
            candidates += [d for d in listen if isinstance(d, str)]

        writes = dot.get("details.protopayload.request.writes", []) or []
        if isinstance(writes, list):
            for w in writes:
                if isinstance(w, dict):
                    name = (w.get("update", {}) or {}).get("name") or w.get("delete")
                    if isinstance(name, str):
                        candidates.append(name)

        for c in candidates:
            m = _DOC_COLLECTION_RE.search(c)
            if m:
                return m.group(1)
        return ""

    def _find_statement_type(self, obj) -> str:
        """Recursively find a `statementtype` value ANYWHERE in the payload --
        robust to old vs new audit formats and lifecycle-event variety, where the
        field hides under different keys (jobInsertion / jobChange /
        jobCompletedEvent / jobInsertRequest / ...). '' if none present."""
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k.lower() == "statementtype" and isinstance(v, str):
                    return v.upper()
                found = self._find_statement_type(v)
                if found:
                    return found
        elif isinstance(obj, list):
            for item in obj:
                found = self._find_statement_type(item)
                if found:
                    return found
        return ""

    def _should_drop(self, dot, principal: str, service: str, method: str) -> bool:
        # --- BigQuery: our own SA querying our own lake ----------------------
        # Platform SAs only ever QUERY BigQuery (rule eval, UI, hunts); they never
        # write via jobs. So DROP by default and keep ONLY a positively-identified
        # WRITE query (CTAS / EXPORT / DML) -- the exfil/tampering signal. A SELECT,
        # or a bare read/fetch with no statement at all, is noise. This inverts the
        # usual fail-safe FOR THIS CASE, on purpose: enumerating every audit path /
        # method name to find the SELECTs was a losing game.
        if service == "bigquery.googleapis.com":
            if not self._is_platform_sa(principal):
                return False  # external identity querying our lake => keep (exfil)
            stype = self._find_statement_type(dot.get("details", {}))
            return stype not in BQ_WRITE_STATEMENT_TYPES  # keep only real writes

        # --- Firestore / Datastore: our own use of the platform ---------------
        # We audit CONFIG CHANGES, not platform usage. The only thing kept is a
        # WRITE to a config collection (editing a rule / setting). Everything else
        # -- reads of anything (viewing the rules page, listing alerts), and writes
        # to non-config collections (alert status, presence, dedup) -- is normal
        # usage and drops. Structural changes (create/delete database, security
        # rules, IAM) are Admin Activity and never reach this plugin.
        if service in FIRESTORE_SERVICES:
            if not self._is_self_identity(principal):
                return False  # external accessor => keep as signal
            collection = self._firestore_collection(dot)
            if not collection:
                return False  # cannot classify => fail-safe KEEP
            leaf = method.lower().rsplit(".", 1)[-1]
            is_config = collection in FIRESTORE_CONFIG_COLLECTIONS
            is_write = leaf in FIRESTORE_WRITE_METHODS
            if is_config and is_write:
                return False  # a config CHANGE => keep
            return True  # config views + all non-config usage => drop

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

        if self._should_drop(dot, principal, service, method):
            # None signals the plugin runner to drop the event (see
            # utils/plugins.send_event_to_plugins and main.py's short-circuit).
            return (None, metadata)

        return (message, metadata)
