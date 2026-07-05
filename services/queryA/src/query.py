"""
Criteria validation and SQL generation for ad-hoc event queries.

Criteria use the exact same BigQuery-native-JSON WHERE-clause syntax as
alertA rule YAML, e.g.:

    source='cloudtrail' AND STRING(details.eventname) = 'ConsoleLogin'

so anything an analyst builds here can be pasted directly into a rule.
"""

import re

# Hard ceilings, enforced regardless of what the caller asks for.
MAX_LIMIT = 1000
MAX_MINUTES = 612000  # 425 days, matches table retention
DEFAULT_LIMIT = 100
DEFAULT_MINUTES = 60

# Statements/keywords that have no business in a WHERE clause. The service
# account is read-only (bigquery.dataViewer + jobUser) so this is defense in
# depth, not the only line of defense.
_FORBIDDEN = re.compile(
    r"(?i)\b("
    r"insert|update|delete|merge|drop|create|alter|truncate|grant|revoke|"
    r"call|begin|commit|rollback|export|load|copy|"
    r"information_schema|session_user"
    r")\b"
)

_COMMENT = re.compile(r"(--|/\*|\*/|#)")


class InvalidCriteria(ValueError):
    pass


def validate_criteria(criteria: str) -> str:
    """
    Validates a criteria string, returning it stripped. Raises InvalidCriteria.
    An empty criteria is valid: it means "everything in the time window"
    (browse mode — most recent events first).
    """
    criteria = (criteria or "").strip()
    if not criteria:
        return ""
    if len(criteria) > 4000:
        raise InvalidCriteria("criteria too long (max 4000 chars)")
    if ";" in criteria:
        raise InvalidCriteria("criteria must be a single expression (no ';')")
    if _COMMENT.search(criteria):
        raise InvalidCriteria("comments are not allowed in criteria")
    match = _FORBIDDEN.search(criteria)
    if match:
        raise InvalidCriteria(f"forbidden keyword in criteria: {match.group(0)}")
    return criteria


def clamp_int(value, default: int, maximum: int) -> int:
    try:
        value = int(value)
    except (TypeError, ValueError):
        return default
    return max(1, min(value, maximum))


def generate_query_sql(
    criteria: str,
    project_id: str,
    minutes: int = DEFAULT_MINUTES,
    limit: int = DEFAULT_LIMIT,
) -> str:
    """
    Builds the events query. The time filter is always on utctimestamp so
    BigQuery partition pruning applies.
    """
    criteria = validate_criteria(criteria)
    minutes = clamp_int(minutes, DEFAULT_MINUTES, MAX_MINUTES)
    limit = clamp_int(limit, DEFAULT_LIMIT, MAX_LIMIT)

    predicate = f"({criteria}) AND " if criteria else ""

    query = f"""
    SELECT *
    FROM `{project_id}.defenda_data_lake.events`
    WHERE {predicate}utctimestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {minutes} MINUTE)
    ORDER BY utctimestamp DESC
    LIMIT {limit}
    """
    return query
