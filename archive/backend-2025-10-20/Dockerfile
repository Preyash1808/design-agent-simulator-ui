# Backend Dockerfile for Railway (FastAPI + simulations)

# Use AWS ECR Public mirror for Docker Hub official images to avoid rate-limit/TLS timeouts
FROM public.ecr.aws/docker/library/python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHON=python3

WORKDIR /app

# System deps (for asyncpg/cryptography wheels fallback)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc libpq-dev libffi-dev libssl-dev ca-certificates curl wget \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first for better layer caching
COPY requirements.txt ./
RUN pip install -r requirements.txt

# Copy backend app and supporting scripts
COPY server ./server
COPY scripts ./scripts
COPY users ./users
COPY config ./config

# Ensure runs directory exists (Railway volume can mount here)
RUN mkdir -p /app/runs

EXPOSE 8000

# Healthcheck (optional)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8000/health || exit 1

CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "12"]


