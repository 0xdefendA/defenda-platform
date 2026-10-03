FROM python:3.12-slim

WORKDIR /app

# Install uv
RUN pip install uv

# Copy project files (uv.lock optional; recommended to commit)
COPY services/huntA/pyproject.toml services/huntA/uv.lock* ./

# Install dependencies
RUN uv sync

# Source, shared engine, and the hunting-schema catalog. The catalog is the
# agent's map + the contract; docs/hunting_schema.md is the single source of
# truth, bundled next to the source so run_hunt can read it at runtime.
COPY services/huntA/src/ ./services/huntA/src/
COPY shared/ ./shared/
COPY docs/hunting_schema.md ./services/huntA/src/hunting_schema.md

# Expose the port Cloud Run will listen on
ENV PORT 8080
ENV PYTHONPATH=/app/services/huntA/src:/app

WORKDIR /app/services/huntA/src

# Run the FastAPI application
CMD /app/.venv/bin/uvicorn main:app --host 0.0.0.0 --port $PORT
