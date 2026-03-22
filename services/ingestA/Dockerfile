FROM python:3.11-slim-buster

WORKDIR /app

# Install uv
RUN pip install uv

# Copy project files
COPY pyproject.toml uv.lock ./ 

# Install dependencies
RUN uv sync

COPY src/ ./src/

# Expose the port Cloud Run will listen on
ENV PORT 8080
ENV PYTHONPATH=/app/src

# Run the FastAPI application
CMD /app/.venv/bin/uvicorn src.main:app --host 0.0.0.0 --port $PORT
