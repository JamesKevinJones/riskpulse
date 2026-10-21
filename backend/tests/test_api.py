import importlib
import random
import shutil
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.main as main

COFFEE = dict(
    amount=45, merchant="Starbucks", merchant_category="food", country="US",
    channel="pos", velocity_1h=1, avg_amount_7d=40, is_new_merchant=False,
)
GAMBLING = dict(
    amount=400, merchant="NightWire Casino", merchant_category="gambling", country="MT",
    channel="online", velocity_1h=5, avg_amount_7d=60, is_new_merchant=True,
)
WIRE_FRAUD = dict(
    amount=6000, merchant="QuickWire Remit", merchant_category="money_transfer",
    country="NG", channel="online", velocity_1h=12, avg_amount_7d=50, is_new_merchant=True,
)


@pytest.fixture
def client(monkeypatch):
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    monkeypatch.setattr(main, "db", conn)
    with TestClient(main.app) as c:
        yield c


def test_everyday_payment_clears_without_reaching_the_queue(client):
    saved = client.post("/ingest", json=COFFEE).json()
    assert saved["status"] == "auto_cleared"
    assert client.get("/queue").json() == []


def test_risky_payments_queue_highest_score_first(client):
    client.post("/ingest", json=GAMBLING)
    client.post("/ingest", json=WIRE_FRAUD)
    queue = client.get("/queue").json()
    assert [t["merchant"] for t in queue] == ["QuickWire Remit", "NightWire Casino"]
    assert queue[0]["risk_score"] >= queue[1]["risk_score"]


def test_hold_decision_updates_status_and_audit_trail(client):
    txn = client.post("/ingest", json=WIRE_FRAUD).json()
    body = client.post(f"/transactions/{txn['id']}/decide",
                       json={"action": "hold", "operator": "analyst_1"}).json()
    assert body["transaction"]["status"] == "held"
    assert client.get("/queue").json() == []
    [decision] = client.get("/decisions").json()
    assert (decision["action"], decision["operator"], decision["risk_score"]) == (
        "hold", "analyst_1", txn["risk_score"])
    assert client.get("/stats").json()["decisions_made"] == 1


def test_a_decided_transaction_cannot_be_decided_again(client):
    txn = client.post("/ingest", json=WIRE_FRAUD).json()
    client.post(f"/transactions/{txn['id']}/decide", json={"action": "hold"})
    again = client.post(f"/transactions/{txn['id']}/decide", json={"action": "approve"})
    assert again.status_code == 400
    assert client.get(f"/transactions/{txn['id']}").json()["status"] == "held"


def test_deciding_an_unknown_transaction_is_404(client):
    assert client.post("/transactions/nope/decide", json={"action": "hold"}).status_code == 404


@pytest.mark.parametrize(
    ("path", "payload"),
    [("/ingest", {**COFFEE, "amount": 0}), ("/transactions/x/decide", {"action": "delete"})],
)
def test_invalid_input_is_rejected(client, path, payload):
    assert client.post(path, json=payload).status_code == 422


def test_attack_burst_lands_in_the_queue(client):
    random.seed(3)
    body = client.post("/demo/attack", json={"intensity": "high"}).json()
    assert body["injected"] == 6
    assert all(t["status"] == "pending" for t in body["transactions"])
    assert len(client.get("/queue").json()) == 6


@pytest.fixture
def spa_client():
    """The single-container image serves the built UI from backend/static."""
    static = Path(main.__file__).resolve().parent.parent / "static"
    if static.exists():
        pytest.skip("backend/static already exists; not touching a real build")
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text("<html>riskpulse</html>")
    try:
        with TestClient(importlib.reload(main).app) as c:
            yield c
    finally:
        shutil.rmtree(static)
        importlib.reload(main)


def test_spa_fallback_serves_the_app_for_client_routes(spa_client):
    assert spa_client.get("/queue/view").text == "<html>riskpulse</html>"


@pytest.mark.parametrize("path", ["/..%2Fapp%2Fmain.py", "/%2E%2E/app/main.py"])
def test_spa_fallback_never_serves_files_outside_static(spa_client, path):
    response = spa_client.get(path)
    assert "RiskPulse" not in response.text
    assert response.text == "<html>riskpulse</html>"
