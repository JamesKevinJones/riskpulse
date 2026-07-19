# RiskPulse architecture

## Flow

1. **TransactionGenerator** emits normal + risky payment events (or `/demo/attack` burst).
2. **FastAPI** on LinuxONE ingests → **RiskScorer** (rules + IsolationForest) → SQLite.
3. Scores ≥ 60 enter the **Decide** queue; WebSocket pushes live alerts to the React desk.
4. Operator **Approve / Hold / Escalate** → immutable **decisions** audit rows.

## Components

| Piece | Role |
| --- | --- |
| `backend/app/main.py` | REST + WebSocket API |
| `backend/app/scorer.py` | Explainable risk blend |
| `backend/app/generator.py` | Synthetic stream + attack scenario |
| `frontend/src/App.jsx` | Detect / Decide / Respond desk |
| `docker-compose.yml` | API + nginx UI for LinuxONE |

## IBM Z story

- Inference and decisioning run on LinuxONE (s390x-capable containers / event VM).
- UI can be local or nginx on the same host; the differentiator is the API on Z.
- Narrative: payments trust Z → risk brain co-located with trust boundary.

## Local vs event

| Env | Command |
| --- | --- |
| Dev | `uvicorn` + `npm run dev` |
| LinuxONE | `docker compose up --build` then open port 80/5173 |
