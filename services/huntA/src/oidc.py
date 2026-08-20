"""
OIDC verification for push-invoked endpoints.

Cloud Run services here are publicly invokable (allUsers) to keep Pub/Sub and
Cloud Scheduler routing simple, so endpoints must verify the OIDC bearer token
those services attach and confirm it was minted for our service account.
Without this, anyone with the URL could POST forged Pub/Sub envelopes.
"""

import logging
import os

from fastapi import HTTPException, Request
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

logger = logging.getLogger(__name__)

# The service account Pub/Sub / Cloud Scheduler mint OIDC tokens as.
# When unset (local dev), verification is skipped with a warning.
PUSH_SA_EMAIL = os.environ.get("PUSH_SA_EMAIL", "")

_token_request = google_requests.Request()


def verify_push_token(request: Request) -> None:
    """Raises 401/403 unless the request carries a valid Google-signed OIDC
    token for the expected service account."""
    if not PUSH_SA_EMAIL:
        logger.warning(
            "PUSH_SA_EMAIL not set — skipping OIDC verification (local dev only)"
        )
        return

    authorization = request.headers.get("Authorization", "")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()

    try:
        claims = id_token.verify_oauth2_token(token, _token_request)
    except Exception as e:
        logger.warning(f"OIDC verification failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid token")

    if not claims.get("email_verified") or claims.get("email") != PUSH_SA_EMAIL:
        logger.warning(f"OIDC token from unexpected caller: {claims.get('email')}")
        raise HTTPException(status_code=403, detail="Unexpected caller")
