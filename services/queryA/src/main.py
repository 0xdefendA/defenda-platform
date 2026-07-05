import json
import logging
import os
import time
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google.auth.transport import requests as google_requests
from google.cloud import bigquery
from google.oauth2 import id_token
from pydantic import BaseModel

import query as query_mod

app = FastAPI(title="queryA", description="Ad-hoc event queries for defendA")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PROJECT_ID = os.environ.get("PROJECT_ID", "local-dev")
# 1 GiB cap per interactive query — keeps ad-hoc exploration cheap.
MAX_BYTES_BILLED = int(os.environ.get("MAX_BYTES_BILLED", 1024**3))
CORS_ORIGINS = [
    o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

try:
    bq_client = bigquery.Client(project=PROJECT_ID)
except Exception as e:
    logger.warning(f"Could not initialize GCP clients (normal during build): {e}")

_token_request = google_requests.Request()


def verify_user(authorization: Optional[str] = Header(None)) -> dict:
    """
    Verifies the Firebase ID token issued to a respondA analyst.
    Returns the decoded claims (email, uid, ...).
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        claims = id_token.verify_firebase_token(
            token, _token_request, audience=PROJECT_ID
        )
    except Exception as e:
        logger.warning(f"Token verification failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid token")
    if not claims:
        raise HTTPException(status_code=401, detail="Invalid token")
    return claims


class QueryRequest(BaseModel):
    criteria: str
    minutes: int = query_mod.DEFAULT_MINUTES
    limit: int = query_mod.DEFAULT_LIMIT


@app.get("/")
def health():
    return {"status": "ok", "service": "queryA"}


@app.post("/query")
def run_query(req: QueryRequest, user: dict = Depends(verify_user)):
    try:
        sql = query_mod.generate_query_sql(
            req.criteria, PROJECT_ID, minutes=req.minutes, limit=req.limit
        )
    except query_mod.InvalidCriteria as e:
        raise HTTPException(status_code=400, detail=str(e))

    logger.info(f"query by {user.get('email', 'unknown')}: {req.criteria!r}")

    started = time.monotonic()
    job_config = bigquery.QueryJobConfig(maximum_bytes_billed=MAX_BYTES_BILLED)
    try:
        query_job = bq_client.query(sql, job_config=job_config)
        results = query_job.result()
    except Exception as e:
        # Surface BigQuery syntax errors to the analyst; they're iterating
        # on criteria and need to see what's wrong.
        logger.warning(f"BQ query failed: {e}")
        raise HTTPException(status_code=400, detail=f"Query failed: {e}")

    events = []
    for row in results:
        event = dict(row)
        # Native JSON `details` may come back as a string depending on
        # client version; normalize to a dict (same handling as alertA).
        if isinstance(event.get("details"), str):
            try:
                event["details"] = json.loads(event["details"])
            except (ValueError, TypeError):
                pass
        if event.get("utctimestamp"):
            event["utctimestamp"] = str(event["utctimestamp"])
        events.append(event)

    return {
        "events": events,
        "count": len(events),
        "sql": sql,
        "elapsed_ms": int((time.monotonic() - started) * 1000),
        "bytes_processed": query_job.total_bytes_processed,
    }
