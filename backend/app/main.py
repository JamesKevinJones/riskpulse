"""RiskPulse — real-time payment risk decision API."""

from __future__ import annotations

import asyncio
import json
import sqlite3
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .generator import TransactionGenerator
from .scorer import RiskScorer

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "riskpulse.db"
RISK_THRESHOLD = 60


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS transactions (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            amount REAL NOT NULL,
            merchant TEXT NOT NULL,
            merchant_category TEXT NOT NULL,
            country TEXT NOT NULL,
            channel TEXT NOT NULL,
            card_last4 TEXT NOT NULL,
            customer_id TEXT NOT NULL,
            velocity_1h INTEGER NOT NULL,
            avg_amount_7d REAL NOT NULL,
            is_new_merchant INTEGER NOT NULL,
            risk_score INTEGER NOT NULL,
            risk_reasons TEXT NOT NULL,
            recommended_action TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS decisions (
            id TEXT PRIMARY KEY,
            transaction_id TEXT NOT NULL,
            action TEXT NOT NULL,
            operator TEXT NOT NULL,
            risk_score INTEGER NOT NULL,
            notes TEXT,
            decided_at TEXT NOT NULL,
            FOREIGN KEY (transaction_id) REFERENCES transactions(id)
        );
        """
    )
    conn.commit()


class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active:
            self.active.remove(websocket)

    async def broadcast(self, message: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        payload = json.dumps(message)
        for ws in self.active:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


class TransactionIn(BaseModel):
    amount: float = Field(..., gt=0)
    merchant: str
    merchant_category: str = "general"
    country: str = "US"
    channel: str = "online"
    card_last4: str = "4242"
    customer_id: str = "cust_001"
    velocity_1h: int = 1
    avg_amount_7d: float = 50.0
    is_new_merchant: bool = False
    timestamp: str | None = None


class DecisionIn(BaseModel):
    action: Literal["approve", "hold", "escalate"]
    operator: str = "ops_demo"
    notes: str = ""


class AttackScenarioIn(BaseModel):
    intensity: Literal["medium", "high"] = "high"


scorer = RiskScorer()
generator = TransactionGenerator()
manager = ConnectionManager()
db = get_conn()
_stream_task: asyncio.Task | None = None
_streaming = False


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db(db)
    scorer.ensure_model()
    yield
    global _stream_task
    if _stream_task and not _stream_task.done():
        _stream_task.cancel()
        try:
            await _stream_task
        except asyncio.CancelledError:
            pass
    db.close()


app = FastAPI(title="RiskPulse API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def row_to_txn(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "timestamp": row["timestamp"],
        "amount": row["amount"],
        "merchant": row["merchant"],
        "merchant_category": row["merchant_category"],
        "country": row["country"],
        "channel": row["channel"],
        "card_last4": row["card_last4"],
        "customer_id": row["customer_id"],
        "velocity_1h": row["velocity_1h"],
        "avg_amount_7d": row["avg_amount_7d"],
        "is_new_merchant": bool(row["is_new_merchant"]),
        "risk_score": row["risk_score"],
        "risk_reasons": json.loads(row["risk_reasons"]),
        "recommended_action": row["recommended_action"],
        "status": row["status"],
        "created_at": row["created_at"],
    }


def persist_transaction(payload: dict[str, Any]) -> dict[str, Any]:
    result = scorer.score(payload)
    txn_id = str(uuid.uuid4())
    created = utc_now()
    status = "pending" if result["risk_score"] >= RISK_THRESHOLD else "auto_cleared"
    record = {
        "id": txn_id,
        "timestamp": payload.get("timestamp") or created,
        "amount": payload["amount"],
        "merchant": payload["merchant"],
        "merchant_category": payload["merchant_category"],
        "country": payload["country"],
        "channel": payload["channel"],
        "card_last4": payload["card_last4"],
        "customer_id": payload["customer_id"],
        "velocity_1h": payload["velocity_1h"],
        "avg_amount_7d": payload["avg_amount_7d"],
        "is_new_merchant": int(bool(payload["is_new_merchant"])),
        "risk_score": result["risk_score"],
        "risk_reasons": json.dumps(result["risk_reasons"]),
        "recommended_action": result["recommended_action"],
        "status": status,
        "created_at": created,
    }
    db.execute(
        """
        INSERT INTO transactions (
            id, timestamp, amount, merchant, merchant_category, country, channel,
            card_last4, customer_id, velocity_1h, avg_amount_7d, is_new_merchant,
            risk_score, risk_reasons, recommended_action, status, created_at
        ) VALUES (
            :id, :timestamp, :amount, :merchant, :merchant_category, :country, :channel,
            :card_last4, :customer_id, :velocity_1h, :avg_amount_7d, :is_new_merchant,
            :risk_score, :risk_reasons, :recommended_action, :status, :created_at
        )
        """,
        record,
    )
    db.commit()
    return row_to_txn(db.execute("SELECT * FROM transactions WHERE id = ?", (txn_id,)).fetchone())


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "RiskPulse",
        "platform": "IBM Z / LinuxONE ready",
        "threshold": RISK_THRESHOLD,
        "streaming": _streaming,
    }


@app.post("/ingest")
async def ingest(txn: TransactionIn) -> dict[str, Any]:
    saved = persist_transaction(txn.model_dump())
    event_type = "alert" if saved["status"] == "pending" else "transaction"
    await manager.broadcast({"type": event_type, "transaction": saved})
    return saved


@app.get("/transactions")
def list_transactions(limit: int = 50) -> list[dict[str, Any]]:
    rows = db.execute(
        "SELECT * FROM transactions ORDER BY created_at DESC LIMIT ?",
        (min(limit, 200),),
    ).fetchall()
    return [row_to_txn(r) for r in rows]


@app.get("/queue")
def risk_queue() -> list[dict[str, Any]]:
    rows = db.execute(
        """
        SELECT * FROM transactions
        WHERE status = 'pending'
        ORDER BY risk_score DESC, created_at DESC
        """
    ).fetchall()
    return [row_to_txn(r) for r in rows]


@app.get("/transactions/{txn_id}")
def get_transaction(txn_id: str) -> dict[str, Any]:
    row = db.execute("SELECT * FROM transactions WHERE id = ?", (txn_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return row_to_txn(row)


@app.post("/transactions/{txn_id}/decide")
async def decide(txn_id: str, body: DecisionIn) -> dict[str, Any]:
    row = db.execute("SELECT * FROM transactions WHERE id = ?", (txn_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if row["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Transaction already {row['status']}")

    decided_at = utc_now()
    decision_id = str(uuid.uuid4())
    new_status = {"approve": "approved", "hold": "held", "escalate": "escalated"}[body.action]

    db.execute(
        "UPDATE transactions SET status = ? WHERE id = ?",
        (new_status, txn_id),
    )
    db.execute(
        """
        INSERT INTO decisions (id, transaction_id, action, operator, risk_score, notes, decided_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            decision_id,
            txn_id,
            body.action,
            body.operator,
            row["risk_score"],
            body.notes,
            decided_at,
        ),
    )
    db.commit()

    txn = row_to_txn(db.execute("SELECT * FROM transactions WHERE id = ?", (txn_id,)).fetchone())
    decision = {
        "id": decision_id,
        "transaction_id": txn_id,
        "action": body.action,
        "operator": body.operator,
        "risk_score": row["risk_score"],
        "notes": body.notes,
        "decided_at": decided_at,
    }
    await manager.broadcast({"type": "decision", "transaction": txn, "decision": decision})
    return {"transaction": txn, "decision": decision}


@app.get("/decisions")
def list_decisions(limit: int = 50) -> list[dict[str, Any]]:
    rows = db.execute(
        "SELECT * FROM decisions ORDER BY decided_at DESC LIMIT ?",
        (min(limit, 200),),
    ).fetchall()
    return [dict(r) for r in rows]


@app.get("/stats")
def stats() -> dict[str, Any]:
    total = db.execute("SELECT COUNT(*) AS c FROM transactions").fetchone()["c"]
    pending = db.execute(
        "SELECT COUNT(*) AS c FROM transactions WHERE status = 'pending'"
    ).fetchone()["c"]
    decided = db.execute("SELECT COUNT(*) AS c FROM decisions").fetchone()["c"]
    high = db.execute(
        "SELECT COUNT(*) AS c FROM transactions WHERE risk_score >= ?",
        (RISK_THRESHOLD,),
    ).fetchone()["c"]
    return {
        "total_transactions": total,
        "pending_queue": pending,
        "decisions_made": decided,
        "high_risk_seen": high,
        "threshold": RISK_THRESHOLD,
        "streaming": _streaming,
    }


async def _stream_loop(interval: float = 1.4) -> None:
    global _streaming
    _streaming = True
    try:
        while True:
            payload = generator.generate()
            saved = persist_transaction(payload)
            event_type = "alert" if saved["status"] == "pending" else "transaction"
            await manager.broadcast({"type": event_type, "transaction": saved})
            await asyncio.sleep(interval)
    finally:
        _streaming = False


@app.post("/stream/start")
async def stream_start() -> dict[str, Any]:
    global _stream_task
    if _streaming:
        return {"streaming": True, "message": "already running"}
    _stream_task = asyncio.create_task(_stream_loop())
    return {"streaming": True, "message": "transaction stream started"}


@app.post("/stream/stop")
async def stream_stop() -> dict[str, Any]:
    global _stream_task
    if _stream_task and not _stream_task.done():
        _stream_task.cancel()
        try:
            await _stream_task
        except asyncio.CancelledError:
            pass
    _stream_task = None
    return {"streaming": False, "message": "transaction stream stopped"}


@app.post("/demo/attack")
async def demo_attack(body: AttackScenarioIn = AttackScenarioIn()) -> dict[str, Any]:
    """Inject a dramatic high-risk burst for the pitch demo."""
    burst = generator.generate_attack_burst(intensity=body.intensity)
    saved_list = []
    for payload in burst:
        saved = persist_transaction(payload)
        saved_list.append(saved)
        await manager.broadcast({"type": "alert", "transaction": saved})
        await asyncio.sleep(0.15)
    return {"injected": len(saved_list), "transactions": saved_list}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await manager.connect(websocket)
    try:
        await websocket.send_text(
            json.dumps({"type": "connected", "message": "RiskPulse live feed"})
        )
        while True:
            # Keep alive; client messages ignored except disconnect
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)
