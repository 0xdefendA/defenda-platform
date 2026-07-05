# queryA

Ad-hoc event query API for the defendA platform. Lets respondA analysts
explore the `defenda_data_lake.events` BigQuery table using the same
criteria syntax as alertA rule YAML, so an exploratory query can be turned
directly into a detection rule.

## Endpoints

### `POST /query`

Requires a Firebase ID token (`Authorization: Bearer <token>`).

```json
{
  "criteria": "source='cloudtrail' AND STRING(details.eventname) = 'ConsoleLogin'",
  "minutes": 1440,
  "limit": 100
}
```

Response:

```json
{
  "events": [...],
  "count": 42,
  "sql": "SELECT * FROM ...",
  "elapsed_ms": 950,
  "bytes_processed": 1048576
}
```

* `minutes` — lookback window (default 60, max 612000 / 425 days).
* `limit` — max rows (default 100, max 1000).

## Safety

* Runs as `querya-sa` with read-only BigQuery access (`dataViewer` + `jobUser`).
* Criteria validation: single expression, no comments, keyword denylist.
* `maximum_bytes_billed` cap (1 GiB default, `MAX_BYTES_BILLED` env).
* Time filter always applied to `utctimestamp` so partition pruning holds.

## Local dev

```bash
uv sync
# port 8081 matches respondA's default VITE_QUERYA_URL fallback
PROJECT_ID=your-project uv run uvicorn main:app --app-dir src --reload --port 8081
uv run pytest
```
