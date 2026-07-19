# Hugging Face Spaces Docker — full RiskPulse (API + UI) on free CPU, no credit card
# https://huggingface.co/docs/hub/spaces-sdks-docker

FROM node:22-alpine AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
# Same-origin API (empty base); WebSocket uses window.location.host
ENV VITE_API_URL=
ENV VITE_WS_URL=
RUN npm run build

FROM python:3.11-slim
RUN useradd -m -u 1000 user
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=user backend/app ./app
COPY --chown=user backend/models ./models
COPY --from=frontend --chown=user /fe/dist ./static

RUN mkdir -p /app/data && chown -R user:user /app
USER user

ENV PYTHONUNBUFFERED=1
ENV PORT=7860
EXPOSE 7860

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
