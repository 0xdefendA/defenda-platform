from utils.dotdict import DotDict
from utils.dates import toUTC
import logging

logger = logging.getLogger()

# Map GCP service names to human-readable categories
CATEGORY_MAP = {
    "iam.googleapis.com": "iam",
    "cloudresourcemanager.googleapis.com": "iam",
    "iamcredentials.googleapis.com": "iam",
    "sts.googleapis.com": "authentication",
    "login.googleapis.com": "authentication",
    "storage.googleapis.com": "storage",
    "bigquery.googleapis.com": "database",
    "spanner.googleapis.com": "database",
    "sqladmin.googleapis.com": "database",
    "firestore.googleapis.com": "database",
    "compute.googleapis.com": "compute",
    "run.googleapis.com": "compute",
    "container.googleapis.com": "compute",
    "cloudfunctions.googleapis.com": "compute",
    "cloudkms.googleapis.com": "encryption",
    "secretmanager.googleapis.com": "secrets",
    "logging.googleapis.com": "logging",
    "monitoring.googleapis.com": "monitoring",
    "pubsub.googleapis.com": "messaging",
    "cloudscheduler.googleapis.com": "infrastructure",
    "cloudbuild.googleapis.com": "infrastructure",
    "serviceusage.googleapis.com": "infrastructure",
    "dns.googleapis.com": "networking",
    "networkservices.googleapis.com": "networking",
}

DESTRUCTIVE_PREFIXES = ("delete", "remove", "destroy", "purge")


class message(object):
    def __init__(self):
        """
        Normalize GCP Cloud Audit Logs (LogEntry envelopes delivered by a
        Cloud Logging sink → Pub/Sub). Detects the AuditLog protoPayload
        shape, sets source/category/summary, and copies the high-value
        fields to convenient details.* locations for rules and hunting.
        """
        # LogEntry audit records always carry a protoPayload
        self.registration = ["protopayload"]
        self.priority = 20

    def onMessage(self, message, metadata):
        dot_message = DotDict(message)

        # Verify this is a GCP audit LogEntry: AuditLog payload type or a
        # cloudaudit logName. (Keys are lowercased by an earlier plugin;
        # values are untouched.)
        payload_type = str(dot_message.get("details.protopayload.@type", ""))
        log_name = str(dot_message.get("details.logname", ""))
        if (
            "google.cloud.audit.auditlog" not in payload_type.lower()
            and "cloudaudit.googleapis.com" not in log_name.lower()
        ):
            return (message, metadata)

        message["source"] = "gcp_audit"
        tags = message.get("tags", [])
        tags.append("gcp_audit")
        tags.append("gcp")

        # --- Which audit log stream is this? ---
        # Not cosmetic. These streams have wildly different collection semantics:
        #
        #   activity      always on, free, everywhere
        #   data_access   OFF by default, chargeable, only where explicitly enabled
        #   system_event  always on, free
        #   policy        always on, chargeable (note: %2Fpolicy, not %2Fpolicy_denied)
        #
        # Without this discriminator, "gcp_audit" is one undifferentiated source and
        # the question a hunt skill needs to ask -- "is the feed I depend on actually
        # flowing?" -- is unanswerable. A skill built on GenerateAccessToken
        # (data_access) would silently return empty anywhere data_access is not
        # enabled, and score perfectly on its eval fixture regardless. This field is
        # what lets a skill declare `requires: [gcp_data_access]` and be SKIPPED
        # rather than quietly finding nothing.
        audit_log_type = "unknown"
        lowered_log_name = log_name.lower()
        for suffix, label in (
            ("%2factivity", "activity"),
            ("%2fdata_access", "data_access"),
            ("%2fsystem_event", "system_event"),
            ("%2fpolicy", "policy_denied"),
        ):
            if suffix in lowered_log_name:
                audit_log_type = label
                break
        message["details"]["audit_log_type"] = audit_log_type
        tags.append(f"gcp_audit_{audit_log_type}")

        # GCP LogEntry severity uses its own scale (DEFAULT/NOTICE/…). Map it
        # into ours so downstream elevation logic has a known baseline.
        gcp_sev = str(dot_message.get("details.severity", "")).upper()
        message["severity"] = {
            "EMERGENCY": "CRITICAL",
            "ALERT": "CRITICAL",
            "CRITICAL": "CRITICAL",
            "ERROR": "WARNING",
            "WARNING": "WARNING",
        }.get(gcp_sev, "INFO")

        # --- Real event time (sink delivery adds lag; use the log's own) ---
        if dot_message.get("details.timestamp", None):
            try:
                message["utctimestamp"] = toUTC(
                    dot_message.get("details.timestamp")
                ).isoformat()
            except (ValueError, TypeError):
                pass

        # --- Convenience copies of the high-value fields ---
        principal = dot_message.get(
            "details.protopayload.authenticationinfo.principalemail", ""
        )
        method = dot_message.get("details.protopayload.methodname", "")
        service = dot_message.get("details.protopayload.servicename", "")
        resource = dot_message.get("details.protopayload.resourcename", "")
        caller_ip = dot_message.get(
            "details.protopayload.requestmetadata.callerip", ""
        )
        user_agent = dot_message.get(
            "details.protopayload.requestmetadata.callersupplieduseragent", ""
        )
        project = dot_message.get("details.resource.labels.project_id", "")

        if principal:
            message["details"]["user"] = principal
            if principal.endswith("gserviceaccount.com"):
                tags.append("service-account")
        if method:
            message["details"]["methodname"] = method
        if service:
            message["details"]["servicename"] = service
        if resource:
            message["details"]["resourcename"] = resource
        if caller_ip:
            message["details"]["sourceipaddress"] = caller_ip
        if user_agent:
            message["details"]["useragent"] = user_agent
        if project:
            message["details"]["project"] = project

        # --- Category ---
        short_service = service.replace(".googleapis.com", "") if service else ""
        message["category"] = CATEGORY_MAP.get(service, short_service or "gcp")

        # --- IAM policy changes get extra context ---
        # A single SetIamPolicy call routinely carries SEVERAL bindingDeltas. This
        # used to read bindingDeltas[0] and drop the rest, which is worse than a
        # miss -- it is a confidently wrong answer. stratus
        # create-admin-service-account is the canonical case: if a benign
        # roles/viewer grant happens to sort first, the roles/owner grant behind it
        # vanishes, iam_changes.granted_member reports the boring one, and the
        # external-grant hunt returns clean.
        #
        # Every delta is now captured. policy_member/policy_delta are kept as
        # scalars for backwards compatibility, but they are the FIRST delta only --
        # hunts should use the *_members / *_roles arrays. See docs/hunting_schema.md.
        extra_info = None
        if method.lower().endswith("setiampolicy"):
            tags.append("iam-policy-change")
            deltas = (
                dot_message.get(
                    "details.protopayload.servicedata.policydelta.bindingdeltas", []
                )
                or []
            )
            deltas = [d for d in deltas if isinstance(d, dict)]

            if deltas:
                rendered = [
                    " ".join(
                        str(d.get(k, "")) for k in ("action", "role", "member")
                    ).strip()
                    for d in deltas
                ]
                rendered = [r for r in rendered if r]

                members = [str(d.get("member", "")) for d in deltas if d.get("member")]
                roles = [str(d.get("role", "")) for d in deltas if d.get("role")]

                # Arrays: the truth. Hunt over these.
                if members:
                    message["details"]["policy_members"] = members
                if roles:
                    message["details"]["policy_roles"] = roles
                if len(deltas) > 1:
                    # Makes the multi-delta case findable, and stops a future
                    # reader assuming the scalar fields tell the whole story.
                    tags.append("multi-binding-change")
                    message["details"]["policy_delta_count"] = len(deltas)

                # Scalars: first delta only, retained for existing rules/views.
                if rendered:
                    extra_info = "; ".join(rendered)
                    message["details"]["policy_delta"] = extra_info
                if members:
                    message["details"]["policy_member"] = members[0]

        # --- Summary ---
        parts = [principal or "unknown", method or "unknown"]
        if resource:
            parts.append(resource)
        if extra_info:
            parts.append(f"({extra_info})")
        if caller_ip:
            parts.append(f"from IP {caller_ip}")
        message["summary"] = " ".join(parts)

        # --- Severity ---
        # Permission denied / errors are notable
        status_code = dot_message.get("details.protopayload.status.code", 0)
        auth_info = dot_message.get("details.protopayload.authorizationinfo", []) or []
        denied = any(a.get("granted") is False for a in auth_info if isinstance(a, dict))
        if denied or (isinstance(status_code, int) and status_code != 0):
            message["severity"] = "WARNING"
            tags.append("denied" if denied else "error")

        # Destructive actions get elevated severity
        method_leaf = method.split(".")[-1].lower() if method else ""
        if method_leaf.startswith(DESTRUCTIVE_PREFIXES):
            if message.get("severity") == "INFO":
                message["severity"] = "WARNING"

        message["tags"] = tags
        return (message, metadata)
