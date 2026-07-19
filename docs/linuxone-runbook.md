# LinuxONE demo capture

Use this during Hours 16–20 of the datathon when you have the event LinuxONE instance.

## Deploy

```bash
git clone <your-repo-url> riskpulse
cd riskpulse
docker compose up --build -d
curl http://127.0.0.1:8000/health
```

Expected health snippet:

```json
{
  "status": "ok",
  "service": "RiskPulse",
  "platform": "IBM Z / LinuxONE ready"
}
```

## Screenshots / clips for the video

1. SSH banner or `uname -m` / instance dashboard showing LinuxONE / s390x
2. `docker ps` with `riskpulse` api + web containers
3. Browser ops desk hitting the LinuxONE host IP
4. `/health` in browser or curl

## If Docker is unavailable

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Run the frontend against `VITE_API_URL=http://<linuxone-ip>:8000` and
`VITE_WS_URL=ws://<linuxone-ip>:8000/ws`.

## Note

Actual LinuxONE credentials are provided by the datathon — this repo is ready to deploy the moment the instance is available.
