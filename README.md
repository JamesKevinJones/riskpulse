# RiskPulse

**Track:** Real-Time AI for Critical Decisions · IBM Z Datathon 2026

Live payment-risk co-pilot: stream transactions, score risk with rules + IsolationForest, and let operators **Approve / Hold / Escalate** — ready to run on **IBM Z / LinuxONE**.

> Replace `[ONLXXX]` with your team number before submission.

## Repository

**GitHub:** https://github.com/JamesKevinJones/riskpulse

**Recommended setup:** clone this repo and run the **backend locally** (and frontend locally). No paid cloud API host required.

Optional shareable UI-only demo: https://frontend-iota-liart-1hrf2xeg9u.vercel.app (browser demo mode). On datathon day, point the same app at your LinuxONE backend.

## Quick start (local backend + local UI)

### 1. Backend (keep this local)

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

API: http://localhost:8000/health

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 — Vite proxies `/api` and `/ws` to your local backend.

## Docker (LinuxONE / any Linux host)

```bash
docker compose up --build
```

- API: http://\<host\>:8000  
- UI: http://\<host\>:5173 (or nginx port 80 if using production profile)

On LinuxONE, SSH in, clone the repo, run `docker compose up --build`, then screenshot the instance + `/health` proving the decision brain runs on Z.

## Demo flow (3-minute pitch)

1. Click **Start stream** — live Detect feed
2. Click **Simulate attack** — high-risk burst fills Decide queue
3. Select an alert → **Hold** or **Escalate** — Respond + audit log
4. Show LinuxONE terminal / health endpoint

Full script: [docs/pitch-script.md](docs/pitch-script.md) · Submit checklist: [docs/submission-checklist.md](docs/submission-checklist.md) · LinuxONE: [docs/linuxone-runbook.md](docs/linuxone-runbook.md)

## API highlights

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Liveness + platform banner |
| `POST /ingest` | Score a transaction |
| `GET /queue` | Pending high-risk items |
| `POST /transactions/{id}/decide` | Approve / hold / escalate |
| `POST /stream/start` | Synthetic live feed |
| `POST /demo/attack` | Dramatic fraud burst |
| `WS /ws` | Realtime alerts |

## Why IBM Z

Payments already trust Z for security, crypto, and always-on scale. RiskPulse’s scoring and decision API sit where the money lives — human-in-the-loop, explainable reasons, immutable audit.

## Stack

React + Vite · FastAPI · scikit-learn · SQLite · WebSockets · Docker
