import os
import copy
import glob
import uuid
import yaml
import json
import base64
import logging
import requests
from datetime import datetime, timedelta
from typing import Any, Optional
from fastapi import FastAPI, Request, HTTPException
from google.cloud import bigquery, firestore, pubsub_v1
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import ValidationError
import sys

# Update path to import shared models
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))
from shared.models.alert import Alert, InflightSequenceAlert, AlertStatus

import evaluator
from oidc import verify_push_token

app = FastAPI()

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PROJECT_ID = os.environ.get("PROJECT_ID", "local-dev")
TOPIC_NAME = f"projects/{PROJECT_ID}/topics/defenda-alerta-evaluate"
# The heartbeat goes through the NORMAL ingest path, not a side channel. That is
# the whole point: it exercises pubsub -> ingestA -> BigQuery and lands in the
# same events table the rules read. A deadman rule on it therefore tests the
# entire chain end to end, not just "is alertA's process alive".
INGEST_TOPIC = f"projects/{PROJECT_ID}/topics/defenda-event-ingest"

# Initialize GCP clients
try:
    bq_client = bigquery.Client(project=PROJECT_ID)
    fs_client = firestore.Client(project=PROJECT_ID)
    publisher = pubsub_v1.PublisherClient()
except Exception as e:
    logger.warning(f"Could not initialize GCP clients (normal during build): {e}")


def _json_default(obj: Any):
    """JSON encoder for the types Firestore hands back that json.dumps cannot eat.

    The one that bites: Firestore stores `expiration` as a native timestamp, and
    doc.to_dict() returns it as DatetimeWithNanoseconds (a datetime subclass).
    json.dumps has no encoder for it and raises TypeError. ISO strings round-trip
    fine on the consumer side -- pydantic coerces them straight back to datetime,
    and evaluator.is_expired() already accepts both shapes.
    """
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, (bytes, bytearray)):
        return base64.b64encode(obj).decode("ascii")
    # Never let an unexpected Firestore type take down the whole cron (see
    # _publish). A stringified field is a degraded payload; a TypeError here is a
    # total detection outage.
    return str(obj)


def _publish(payload: dict) -> None:
    publisher.publish(
        TOPIC_NAME, json.dumps(payload, default=_json_default).encode("utf-8")
    )


def emit_heartbeat(published: int, failed: int, rules_loaded: int) -> None:
    """Publish a cron heartbeat through the normal ingest path.

    This is the deadman's canary. It travels alertA -> defenda-event-ingest ->
    ingestA -> BigQuery, and lands in the same `events` table the rules query. A
    deadman rule watching for its ABSENCE therefore covers the whole chain: if
    Pub/Sub, ingestA, the BQ writer, or the scheduler breaks, the heartbeat stops
    arriving and the deadman fires. A liveness ping that skipped the pipeline
    would only prove alertA's process was running -- which is the least
    interesting thing that can be true.

    Known limit, stated plainly: this cannot catch alertA dying OUTRIGHT. If
    /cron never runs, no heartbeat is emitted AND no rules are evaluated --
    including this deadman. A watchdog cannot watch itself. That case is covered
    outside the platform, by the Cloud Monitoring alert policy on 5xx and failed
    scheduler jobs (cicd/modules/gcp_project_setup/monitoring.tf).

    Best-effort by construction: a heartbeat failure must never be the thing that
    breaks the cron it is reporting on.
    """
    try:
        publisher.publish(
            INGEST_TOPIC,
            json.dumps(
                {
                    "source": "defenda_platform",
                    "category": "deadman",
                    "severity": "INFO",
                    "summary": (
                        f"alertA cron heartbeat: {published} published, "
                        f"{failed} failed, {rules_loaded} rules loaded"
                    ),
                    "tags": ["heartbeat", "alerta"],
                    "details": {
                        "service": "alerta",
                        "heartbeat": "cron",
                        "published": published,
                        "failed": failed,
                        "rules_loaded": rules_loaded,
                    },
                }
            ).encode("utf-8"),
        )
    except Exception as e:
        logger.error(f"Failed to emit cron heartbeat: {e}")


def load_rules():
    rules = []
    # File-based rules (detections-as-code, shipped in the container)
    # Assuming running from services/alertA
    rules_dir = os.path.join(os.path.dirname(__file__), "../rules/*.yml")
    for rule_file in glob.glob(rules_dir):
        with open(rule_file, "r") as f:
            try:
                rule = yaml.safe_load(f)
                rules.append(rule)
            except Exception as e:
                logger.error(f"Error loading rule {rule_file}: {e}")

    # Firestore-based rules (created live from the respondA UI).
    # Documents in the `rules` collection carry the same YAML format in a
    # `yaml` field. A bad Firestore rule is logged and skipped so it can
    # never break file-based rules.
    try:
        for doc in fs_client.collection("rules").stream():
            data = doc.to_dict() or {}
            if not data.get("enabled", True):
                continue
            try:
                rule = yaml.safe_load(data.get("yaml", ""))
                if isinstance(rule, dict) and rule.get("alert_name"):
                    rules.append(rule)
                else:
                    logger.error(f"Firestore rule {doc.id} is not a valid rule document")
            except Exception as e:
                logger.error(f"Error parsing Firestore rule {doc.id}: {e}")
    except Exception as e:
        logger.error(f"Error loading rules from Firestore: {e}")

    return rules


@app.post("/cron")
async def handle_cron(request: Request):
    """
    Triggered by Cloud Scheduler every minute.
    Fans out evaluation to Pub/Sub.
    """
    verify_push_token(request)
    rules = load_rules()
    published_count = 0
    failed_count = 0

    # Fan-out is per-item guarded on purpose. Before this, a single undeliverable
    # document raised out of the loop and 500'd the whole /cron call -- so NO
    # rules got evaluated at all, every minute, for as long as that one document
    # existed. One malformed doc was a total detection outage, and a silent one:
    # the only symptom was a 500 in the Cloud Run log.
    #
    # Fail per-item, keep the fan-out alive, and make the failure countable so a
    # deadman rule can alert on it. Detection systems must degrade, not stop.

    # 1. Fan out base rules
    for rule in rules:
        try:
            _publish({"type": "rule", "data": rule})
            published_count += 1
        except Exception as e:
            failed_count += 1
            logger.error(
                f"Failed to publish rule {rule.get('alert_name', '<unnamed>')}: {e}"
            )

    # 2. Fan out active inflight sequence alerts
    inflight_ref = fs_client.collection("inflight_alerts")
    for doc in inflight_ref.stream():
        try:
            _publish({"type": "inflight", "data": doc.to_dict()})
            published_count += 1
        except Exception as e:
            failed_count += 1
            logger.error(f"Failed to publish inflight alert {doc.id}: {e}")

    # 3. Housekeeping (Expire old inflight alerts). This enforces sequence
    # lifespans; guarded so a bad document can never fail the whole cron.
    try:
        for doc in inflight_ref.stream():
            data = doc.to_dict() or {}
            if evaluator.is_expired(data.get("expiration")):
                logger.info(f"Expiring inflight sequence alert {doc.id}")
                doc.reference.delete()
    except Exception as e:
        logger.error(f"Inflight housekeeping failed: {e}")

    # `failed` is deliberately surfaced rather than swallowed. A cron that
    # publishes 0 of 12 rules should not look like a cron that published 12 --
    # that is exactly the "pipeline health is a determinism problem" case the
    # huntA plan reserves deadman rules for. Alert on failed > 0, and on
    # published == 0.
    if failed_count:
        logger.error(
            f"/cron fan-out degraded: {published_count} published, {failed_count} failed"
        )

    emit_heartbeat(published_count, failed_count, len(rules))

    return {
        "status": "ok" if not failed_count else "degraded",
        "published": published_count,
        "failed": failed_count,
    }


def is_event_processed(event_id: str) -> bool:
    """Check if an event ID has already triggered an alert."""
    if not event_id:
        return False
    doc_ref = fs_client.collection("processed_events").document(event_id)
    return doc_ref.get().exists


def mark_event_processed(event_id: str, transaction: firestore.Transaction):
    """Mark an event ID as processed within a transaction."""
    if not event_id:
        return
    doc_ref = fs_client.collection("processed_events").document(event_id)
    transaction.set(doc_ref, {"processed_at": firestore.SERVER_TIMESTAMP})


@firestore.transactional
def process_new_alert_tx(transaction, alert_data: dict, events: list):
    """
    Transaction to create a new alert, ensuring events haven't been processed.
    """
    # Verify events
    for event in events:
        event_id = event.get("eventid")
        if event_id:
            doc_ref = fs_client.collection("processed_events").document(event_id)
            snapshot = doc_ref.get(transaction=transaction)
            if snapshot.exists:
                return False  # Already processed

    # Mark events and create alert
    for event in events:
        event_id = event.get("eventid")
        mark_event_processed(event_id, transaction)

    alert_obj = Alert(**alert_data)
    alert_ref = fs_client.collection("alerts").document(alert_obj.alert_id)
    transaction.set(alert_ref, alert_obj.model_dump())
    return True


@firestore.transactional
def process_inflight_update_tx(
    transaction, inflight_id: str, inflight_data: dict, events: list, is_complete: bool
):
    """
    Transaction to update or complete an inflight sequence alert.
    """
    # Verify events
    for event in events:
        event_id = event.get("eventid")
        if event_id:
            doc_ref = fs_client.collection("processed_events").document(event_id)
            snapshot = doc_ref.get(transaction=transaction)
            if snapshot.exists:
                return False

    # Mark events
    for event in events:
        event_id = event.get("eventid")
        mark_event_processed(event_id, transaction)

    inflight_ref = fs_client.collection("inflight_alerts").document(inflight_id)

    if is_complete:
        # Convert to final alert
        alert_obj = Alert(**inflight_data)
        alert_ref = fs_client.collection("alerts").document(alert_obj.alert_id)
        transaction.set(alert_ref, alert_obj.model_dump())
        # Delete inflight
        transaction.delete(inflight_ref)
    else:
        # Update or create inflight
        transaction.set(inflight_ref, inflight_data)

    return True


# Fallback when settings/notifications has no template
DEFAULT_SLACK_TEMPLATE = {
    "blocks": [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": "{{severity}}: {{alert_name}}"},
        },
        {"type": "section", "text": {"type": "mrkdwn", "text": "{{summary}}"}},
        {
            "type": "context",
            "elements": [
                {"type": "mrkdwn", "text": "category: {{category}} · alert {{alert_id}}"}
            ],
        },
    ]
}


def notify_slack(alert_data: dict):
    """
    Posts a newly created alert to Slack, driven by the Firestore
    settings/notifications doc (enabled, webhook_url, min_severity,
    template). Best-effort only: failures are logged, never raised, so
    notification problems can't break alert creation.
    """
    try:
        doc = fs_client.collection("settings").document("notifications").get()
        if not doc.exists:
            return
        cfg = doc.to_dict() or {}
        if not cfg.get("enabled") or not cfg.get("webhook_url"):
            return
        if not evaluator.severity_allows(
            alert_data.get("severity", "INFO"), cfg.get("min_severity", "HIGH")
        ):
            return

        template = DEFAULT_SLACK_TEMPLATE
        if cfg.get("template"):
            try:
                template = json.loads(cfg["template"])
            except (ValueError, TypeError) as e:
                logger.warning(f"Bad Slack template in settings, using default: {e}")

        payload = evaluator.render_slack_template(template, alert_data)
        resp = requests.post(cfg["webhook_url"], json=payload, timeout=5)
        if resp.status_code >= 300:
            logger.warning(
                f"Slack notify failed: {resp.status_code} {resp.text[:200]}"
            )
    except Exception as e:
        logger.error(f"Slack notify error: {e}")


def process_deadman_alert(alert_data: dict):
    """
    Deadman alerts fire on ABSENCE, so there are no event IDs to dedup on —
    left alone they'd create a new alert every cron cycle until the feed
    recovers. Instead, repeated triggers fold into the existing OPEN alert:
    increment `deadman_hits`, refresh `last_triggered_at`, and keep a capped
    sample of the synthetic events. Resolving the alert resets the cycle.

    Single-writer by design (one cron pipeline, one message per rule), so a
    read-then-write is safe here without a transaction.
    """
    alerts_ref = fs_client.collection("alerts")
    query = (
        alerts_ref
        .where(filter=FieldFilter("alert_name", "==", alert_data.get("alert_name")))
        .where(filter=FieldFilter("alert_type", "==", "deadman"))
        .where(filter=FieldFilter("status", "==", "OPEN"))
        .limit(1)
    )
    existing = list(query.stream())
    now = evaluator.datetime.utcnow()

    if existing:
        doc = existing[0]
        data = doc.to_dict() or {}
        hits = int(data.get("deadman_hits") or 1) + 1
        try:
            cap = max(1, int(alert_data.get("event_sample_count", 3)))
        except (TypeError, ValueError):
            cap = 3
        events = (data.get("events") or []) + (alert_data.get("events") or [])
        doc.reference.update({
            "deadman_hits": hits,
            "last_triggered_at": now,
            "events": events[-cap:],
        })
        logger.info(f"deadman {alert_data.get('alert_name')} hit #{hits}")
    else:
        alert_data = dict(alert_data)
        alert_data["deadman_hits"] = 1
        alert_data["last_triggered_at"] = now
        alert_obj = Alert(**alert_data)
        alerts_ref.document(alert_obj.alert_id).set(alert_obj.model_dump())
        # Notify on the first hit only; subsequent hits fold into this alert
        notify_slack({**alert_data, "alert_id": alert_obj.alert_id})


@app.post("/evaluate")
async def handle_evaluate(request: Request):
    """
    Triggered by Pub/Sub push.
    Evaluates a specific rule or inflight alert.
    """
    verify_push_token(request)
    envelope = await request.json()
    if not envelope:
        raise HTTPException(
            status_code=400, detail="Bad Request: No Pub/Sub message received"
        )

    pubsub_message = envelope.get("message")
    if not pubsub_message:
        raise HTTPException(
            status_code=400, detail="Bad Request: Invalid Pub/Sub format"
        )

    data = pubsub_message.get("data")
    if not data:
        return {"status": "ignored", "reason": "No data"}

    try:
        payload = json.loads(base64.b64decode(data).decode("utf-8"))
    except Exception as e:
        logger.error(f"Error decoding payload: {e}")
        return {"status": "error", "reason": "Decode failed"}

    msg_type = payload.get("type")
    rule = payload.get("data")

    if msg_type == "rule":
        alert_type = rule.get("alert_type")
        if alert_type == "threshold":
            events = get_events(rule.get("criteria", ""), rule_lookback(rule))
            for alert in evaluator.determine_threshold_trigger(rule, events):
                # Filter out previously alerted events locally first
                new_events = [
                    e
                    for e in alert.get("events", [])
                    if not is_event_processed(e.get("eventid"))
                ]
                if new_events:
                    alert["events"] = new_events
                    # Pre-generate the ID so the notification can reference it
                    alert["alert_id"] = alert.get("alert_id") or str(uuid.uuid4())
                    transaction = fs_client.transaction()
                    if process_new_alert_tx(transaction, alert, new_events):
                        notify_slack(alert)

        elif alert_type == "deadman":
            events = get_events(rule.get("criteria", ""), rule_lookback(rule))
            for alert in evaluator.determine_deadman_trigger(rule, events):
                process_deadman_alert(alert)

        elif alert_type == "sequence":
            # For a new sequence, we try to fulfill the first slot
            slots = rule.get("slots", [])
            if not slots:
                return {"status": "ignored", "reason": "No slots in sequence"}

            first_slot = slots[0]
            events = get_events(first_slot.get("criteria", ""), rule_lookback(first_slot))

            # Slot dispatch handles threshold and deadman slots alike
            for alert in evaluator.determine_slot_trigger(first_slot, events):
                new_events = [
                    e
                    for e in alert.get("events", [])
                    if not is_event_processed(e.get("eventid"))
                ]
                if new_events:
                    alert["events"] = new_events
                    # Create inflight alert. Deep copy: a shallow copy
                    # shares the slots list with the rule dict, so slot
                    # updates would leak into subsequent triggers.
                    inflight = copy.deepcopy(rule)
                    inflight["slots"][0] = alert

                    # Calculate expiration from the rule lifespan
                    offset = 3 * 86400  # 3 days default
                    lifespan = rule.get("lifespan", "3 days")
                    if "day" in lifespan:
                        try:
                            offset = int(lifespan.split()[0]) * 86400
                        except (ValueError, IndexError):
                            pass

                    inflight["expiration"] = evaluator.datetime.utcnow() + timedelta(
                        seconds=offset
                    )

                    inflight_obj = InflightSequenceAlert(**inflight)
                    inflight_dict = inflight_obj.model_dump()

                    transaction = fs_client.transaction()
                    process_inflight_update_tx(
                        transaction,
                        inflight_obj.inflight_id,
                        inflight_dict,
                        new_events,
                        False,
                    )

    elif msg_type == "inflight":
        # Process an existing inflight alert
        slots = rule.get("slots", [])

        # Find first unfilled slot
        target_index = -1
        target_slot = None
        for i, s in enumerate(slots):
            if not s.get("triggered"):
                target_index = i
                target_slot = s
                break

        if target_slot:
            # We must render the criteria in case it references previous slots
            import chevron

            criteria = chevron.render(target_slot.get("criteria", ""), rule)
            events = get_events(criteria, rule_lookback(target_slot))

            # Slot dispatch handles threshold and deadman slots alike
            for alert in evaluator.determine_slot_trigger(target_slot, events):
                new_events = [
                    e
                    for e in alert.get("events", [])
                    if not is_event_processed(e.get("eventid"))
                ]
                if new_events:
                    alert["events"] = new_events
                    rule["slots"][target_index] = alert

                    # Check if this was the last slot
                    is_complete = target_index == len(slots) - 1
                    if is_complete:
                        # Render final summary
                        rule["summary"] = chevron.render(
                            rule.get("summary", ""), rule
                        )

                    if is_complete:
                        # Pre-generate the ID so the notification can reference it
                        rule["alert_id"] = rule.get("alert_id") or str(uuid.uuid4())

                    transaction = fs_client.transaction()
                    if (
                        process_inflight_update_tx(
                            transaction,
                            rule.get("inflight_id"),
                            rule,
                            new_events,
                            is_complete,
                        )
                        and is_complete
                    ):
                        notify_slack(rule)
                    # We break here to avoid processing multiple triggers for the same slot in one run
                    break

    return {"status": "ok"}


def rule_lookback(rule: dict) -> int:
    """Lookback window in minutes for a rule or sequence slot (default 5)."""
    try:
        return int(rule.get("lookback_minutes", 5))
    except (TypeError, ValueError):
        return 5


def get_events(criteria: str, lookback_minutes: int = 5) -> list:
    """Executes BQ query and returns list of events."""
    if not criteria:
        return []
    try:
        sql = evaluator.generate_bigquery_sql(criteria, PROJECT_ID, lookback_minutes)
        query_job = bq_client.query(sql)
        results = query_job.result()
        events = []
        for row in results:
            event = dict(row)
            # BigQuery native JSON is returned as a string in the Python client or dict depending on version
            # If it's a string, load it.
            if isinstance(event.get("details"), str):
                try:
                    event["details"] = json.loads(event["details"])
                except:
                    pass

            # Unpack top level string representation of timestamp to string if needed
            if event.get("utctimestamp"):
                event["utctimestamp"] = str(event["utctimestamp"])

            events.append(event)
        return events
    except Exception as e:
        logger.error(f"BQ Query failed: {e}")
        return []
