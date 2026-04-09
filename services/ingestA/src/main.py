import base64
import json
import os
from typing import Any, Dict, List

from fastapi import FastAPI, Request
from google.cloud import bigquery

from normalization_plugins import run_normalization_plugins
from enrichment_plugins import run_enrichment_plugins
from utils.dotdict import DotDict

app = FastAPI()
client = bigquery.Client()

# BigQuery configuration
PROJECT_ID = os.environ.get("PROJECT_ID")
DATASET_ID = os.environ.get("DATASET_ID", "defenda_data_lake")
TABLE_ID = os.environ.get("TABLE_ID", "events")
TABLE_REF = f"{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}"


@app.post("/")
async def index(request: Request):
    envelope = await request.json()

    # Check if the message is a Pub/Sub message
    if not envelope or "message" not in envelope:
        return {"status": "error", "message": "Invalid Pub/Sub message format"}

    pubsub_message = envelope["message"]

    if "data" in pubsub_message:
        # Decode the Pub/Sub message
        data = base64.b64decode(pubsub_message["data"]).decode("utf-8").strip()
        try:
            event = json.loads(data)
        except json.JSONDecodeError:
            event = {"raw_log": data}  # Handle cases where raw data is not JSON
    else:
        event = {"raw_log": "No data in Pub/Sub message"}

    # Convert event to dotdict for plugin compatibility
    event_dotdict = DotDict(event)

    # Run normalization plugins
    normalized_event, metadata = run_normalization_plugins(event_dotdict)

    # Run enrichment plugins
    enriched_event, metadata = run_enrichment_plugins(normalized_event, metadata)

    from datetime import datetime, timezone

    # Prepare record for BigQuery
    utctimestamp = enriched_event.get("utctimestamp")
    if not utctimestamp:
        utctimestamp = datetime.now(timezone.utc).isoformat()

    record = {
        "utctimestamp": utctimestamp,
        "eventid": enriched_event.get("eventid", ""),
        "severity": enriched_event.get("severity", "INFO"),
        "summary": enriched_event.get("summary", "UNKNOWN"),
        "category": enriched_event.get("category", "UNKNOWN"),
        "source": enriched_event.get("source", "UNKNOWN"),
        "tags": enriched_event.get("tags", []),
        "plugins": enriched_event.get("plugins", []),
        "details": json.dumps(enriched_event.get("details", {})),
    }

    errors = client.insert_rows_json(TABLE_REF, [record])

    if errors:
        print(f"BigQuery insert errors: {errors}")
        return {"status": "error", "message": f"BigQuery insert errors: {errors}"}
    else:
        return {"status": "success", "message": "Event processed and sent to BigQuery"}
