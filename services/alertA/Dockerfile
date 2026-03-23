FROM python:3.12-slim

WORKDIR /app

# Install uv
RUN pip install uv

# Copy project files
COPY services/alertA/pyproject.toml services/alertA/uv.lock ./ 

# Install dependencies
RUN uv sync

# Copy source code and shared module
COPY services/alertA/src/ ./services/alertA/src/
COPY services/alertA/rules/ ./services/alertA/rules/
COPY shared/ ./shared/

# Expose the port Cloud Run will listen on
ENV PORT 8080
ENV PYTHONPATH=/app/services/alertA/src:/app

WORKDIR /app/services/alertA/src

# Run the FastAPI application
CMD /app/.venv/bin/uvicorn main:app --host 0.0.0.0 --port $PORT
