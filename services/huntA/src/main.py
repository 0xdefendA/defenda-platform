import logging
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Route google-genai to Vertex (service-account ADC) rather than the Gemini
# Developer API (which needs an API key). MUST be set before the engine import
# pulls in google.genai. In Cloud Run these come from the container env
# (Terraform); setdefault keeps a local `uvicorn` run working too. aiplatform.user
# on the runner SA is necessary but not sufficient — without these the SDK never
# tries Vertex at all and fails with "No API key was provided".
os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "TRUE")
os.environ.setdefault(
    "GOOGLE_CLOUD_PROJECT", os.environ.get("PROJECT_ID", "local-dev")
)
os.environ.setdefault("GOOGLE_CLOUD_LOCATION", "global")

import requests
from fastapi import FastAPI, Request
from google.cloud import firestore

import reporting
from oidc import verify_push_token

# The shared engine holds the proven agent loop. Imported here so the scheduled
# service runs exactly what phase 2b proved locally.
from shared.hunt.engine import DEFAULT_MODEL, run_hunt

app = FastAPI(title="huntA", description="Scheduled AI threat hunts for defendA")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PROJECT_ID = os.environ.get("PROJECT_ID", "local-dev")
# The model string is passed straight to Vertex; validate it resolves in your
# region at deploy time. Overridable without a redeploy via env.
HUNT_MODEL = os.environ.get("HUNT_MODEL", DEFAULT_MODEL)
# Look-back window per run. Twice-daily × 12h = continuous coverage with overlap
# safety if a run is late.
LOOKBACK_HOURS = int(os.environ.get("HUNT_LOOKBACK_HOURS", "12"))

# The catalog is bundled into the container next to the source (see Dockerfile).
CATALOG_PATH = Path(__file__).resolve().parent / "hunting_schema.md"

try:
    fs_client = firestore.Client(project=PROJECT_ID)
except Exception as e:  # noqa: BLE001 - normal during build
    logger.warning(f"Could not initialize Firestore (normal during build): {e}")
    fs_client = None


def _load_notification_settings() -> dict:
    """Reuse the existing settings/notifications doc (webhook + min severity)."""
    try:
        snap = fs_client.collection("settings").document("notifications").get()
        return snap.to_dict() or {}
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Could not load notification settings: {e}")
        return {}


@app.get("/")
def health():
    return {"status": "ok", "service": "huntA", "model": HUNT_MODEL}


@app.post("/run")
async def handle_run(request: Request):
    """Triggered by Cloud Scheduler (OIDC). Hunts the last LOOKBACK_HOURS and
    persists/surfaces the result."""
    verify_push_token(request)

    now = datetime.now(timezone.utc)
    since = (now - timedelta(hours=LOOKBACK_HOURS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    until = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    run_id = f"scheduled-{now.strftime('%Y%m%dT%H%M%SZ')}"
    window = {"since": since, "until": until}

    logger.info(f"hunt {run_id}: {since} .. {until} model={HUNT_MODEL}")

    with tempfile.TemporaryDirectory() as tmp:
        result = await run_hunt(
            project=PROJECT_ID,
            since=since,
            until=until,
            run_id=run_id,
            catalog_text=CATALOG_PATH.read_text(),
            out_dir=Path(tmp) / run_id,
            model=HUNT_MODEL,
        )

    # The transcript is returned in memory (not read back from the temp dir) and
    # persisted onto the report doc. Also log a compact per-query line so a run is
    # greppable live -- one line each, not a single blank multi-line blob.
    records = result.transcript or []
    query_records = [r for r in records if r.get("kind") == "query_run"]
    for r in query_records:
        logger.info(
            f"hunt {run_id} q{r.get('n')}: rows={r.get('row_count')} "
            f"truncated={r.get('truncated')} :: {r.get('sql', '')[:500]}"
        )

    doc = reporting.report_to_doc(
        run_id=run_id,
        window=window,
        model=HUNT_MODEL,
        report=result.report,
        cost=result.cost,
        transcript=records,
    )
    if fs_client:
        reporting.persist_report(fs_client, doc)

    cfg = _load_notification_settings()
    notified = reporting.notify_slack(cfg, doc, post=lambda url, body: requests.post(
        url, json=body, timeout=5
    ))

    logger.info(
        f"hunt {run_id} done: verdict={doc['verdict']} "
        f"findings={len(doc['findings'])} queries={result.cost.get('queries')} "
        f"records={len(records)} notified={notified}"
    )
    return {
        "status": "ok",
        "run_id": run_id,
        "verdict": doc["verdict"],
        "findings": len(doc["findings"]),
        "notified": notified,
        "cost": result.cost,
    }
