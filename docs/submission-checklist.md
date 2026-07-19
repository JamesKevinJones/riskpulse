# [ONLXXX] RiskPulse — Submission notes

Replace `ONLXXX` with your assigned team number everywhere before submit.

## Required submission package

1. **Project title:** `[ONLXXX] RiskPulse — Real-Time Payment Risk on IBM Z`
2. **Video (≤ 3 min):** follow [docs/pitch-script.md](docs/pitch-script.md)
3. **Code:** this GitHub/GitLab repo
4. **Optional:** architecture diagram from [docs/architecture.md](docs/architecture.md)

## Must show in video

- Problem statement
- Data supporting the problem
- Working solution (Detect → Decide → Respond)
- How it leverages IBM Z / LinuxONE (instance, stack, model)

## Pre-flight

```bash
docker compose up --build -d
# UI http://localhost
# API http://localhost:8000/health
```

Or local: backend `uvicorn app.main:app --port 8000` + frontend `npm run dev`.
