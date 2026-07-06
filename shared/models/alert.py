from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime
from enum import Enum
import uuid


class AlertStatus(str, Enum):
    OPEN = "OPEN"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    RESOLVED = "RESOLVED"


class Alert(BaseModel):
    alert_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    alert_name: str
    alert_type: str
    severity: str
    summary: str
    category: str
    tags: List[str] = []
    status: AlertStatus = AlertStatus.OPEN
    created_at: datetime = Field(default_factory=datetime.utcnow)
    events: List[Dict[str, Any]] = []  # Raw event data that triggered this
    # Deadman-only: repeated triggers fold into the open alert instead of
    # creating duplicates; hits counts how many cycles it has fired.
    deadman_hits: Optional[int] = None
    last_triggered_at: Optional[datetime] = None


class InflightSequenceAlert(BaseModel):
    inflight_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    alert_name: str
    alert_type: str = "sequence"
    severity: str
    summary: str
    category: Optional[str] = "general"
    tags: List[str] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    expiration: datetime
    slots: List[Dict[str, Any]] = []  # Tracks the state of each slot in the sequence


class RuleDefinition(BaseModel):
    alert_name: str
    alert_type: str
    severity: str
    summary: str
    category: str = "general"
    tags: List[str] = []
    criteria: Optional[str] = ""
    threshold: Optional[int] = 1
    aggregation_key: Optional[str] = ""
    event_snippet: Optional[str] = ""
    event_sample_count: Optional[int] = 3
    lookback_minutes: Optional[int] = 5  # BQ query window; deadman rules often want longer
    lifespan: Optional[str] = None  # For sequence alerts e.g. "3 days"
    slots: Optional[List[Dict[str, Any]]] = None  # For sequence alerts
