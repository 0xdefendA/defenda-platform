# huntA

Scheduled AI threat-hunt service. Twice a day it hunts the last 12 hours of cloud
activity over the `defenda_hunting` views, using the **proven phase-2b agent loop**
(`shared/hunt/engine.py`) — the same loop the local harness runs. It persists a
report to Firestore and surfaces only findings worth pursuing to Slack.

This is the "industrialise" step of the huntA plan: the loop was proven locally
(`tools/hunt_harness.py`, blind-window eval), and this wraps it on a schedule.
Nothing about the hunt behaviour is reimplemented here — the engine is shared.

## Endpoint

### `POST /run`
Triggered by Cloud Scheduler (OIDC-verified, `PUSH_SA_EMAIL`). Computes a window
of `now − HUNT_LOOKBACK_HOURS .. now`, runs the hunt, then:

* writes a `hunt_reports/{run_id}` Firestore doc (verdict, summary, findings, cost)
* posts to Slack **only** when the verdict is `findings` above the configured
  severity threshold (reuses `settings/notifications`). `nothing_of_concern` and
  `no_report` never page — silence is the expected case.

The transcript is emitted to Cloud Logging (ephemeral temp dir otherwise), so a
run is inspectable without granting the service any storage write.

## Config (env)

| var | default | notes |
| --- | --- | --- |
| `PROJECT_ID` | `local-dev` | platform project (owns `defenda_hunting`) |
| `HUNT_MODEL` | engine default | Vertex Gemini model id — **validate it resolves in your location** |
| `HUNT_LOOKBACK_HOURS` | 12 | window size; 2×/day × 12h = continuous coverage |
| `PUSH_SA_EMAIL` | (unset) | Scheduler SA; unset skips OIDC (local dev) |
| `GOOGLE_GENAI_USE_VERTEXAI` | `TRUE` | route google-genai to Vertex (SA ADC), not the API-key path. `main.py` sets this if unset. |
| `GOOGLE_CLOUD_PROJECT` | `PROJECT_ID` | Vertex project |
| `GOOGLE_CLOUD_LOCATION` | `global` | Vertex location for Gemini calls |

Without `GOOGLE_GENAI_USE_VERTEXAI=TRUE` the SDK falls back to the Gemini
Developer API and fails with "No API key was provided" — `aiplatform.user` on the
SA is necessary but not sufficient. `main.py` sets these three defensively before
importing the engine so a local run works; Terraform sets them explicitly on the
container.

## Identity & containment

Runs as `hunta-runner` — the same read-only BigQuery + Vertex posture as the
pristine `hunta-agent`, plus `datastore.user` to persist reports. The agent's
*tools* remain read-only (BigQuery views + in-memory `write_report`); Firestore
and Slack writes happen in service code after the loop, on a validated report, so
the (potentially prompt-injected) agent gains no write capability. Containment is
the tool set, not the SA.

## Local dev

```bash
uv sync
PROJECT_ID=your-project HUNT_MODEL=gemini-3.5-flash \
  uv run uvicorn main:app --app-dir src --reload --port 8082
uv run pytest    # reporting + window logic (no Vertex needed)
```

The full agent loop needs Vertex + the ADK deps and application-default creds —
prefer the local harness (`tools/hunt_harness.py`) for iterating on hunt
behaviour, and this service for the scheduled path.
