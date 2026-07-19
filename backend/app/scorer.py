"""Rules + lightweight ML risk scorer for payment transactions."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest

MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "isolation_forest.joblib"

HIGH_RISK_COUNTRIES = {"NG", "RU", "MT", "EG", "UA"}
HIGH_RISK_CATEGORIES = {"gambling", "money_transfer", "marketplace"}


class RiskScorer:
    def __init__(self, model_path: Path = MODEL_PATH) -> None:
        self.model_path = model_path
        self.model: IsolationForest | None = None

    def ensure_model(self) -> None:
        if self.model_path.exists():
            self.model = joblib.load(self.model_path)
            return
        self.train_and_save()

    def train_and_save(self, n_samples: int = 800) -> None:
        rng = np.random.default_rng(42)
        normal = np.column_stack(
            [
                rng.uniform(5, 200, n_samples),
                rng.integers(1, 4, n_samples),
                rng.uniform(0.4, 1.8, n_samples),
                rng.integers(0, 1, n_samples),
                rng.integers(0, 1, n_samples),
                rng.integers(0, 1, n_samples),
                rng.integers(0, 2, n_samples),
            ]
        ).astype(float)
        anomaly = np.column_stack(
            [
                rng.uniform(800, 9000, n_samples // 5),
                rng.integers(7, 15, n_samples // 5),
                rng.uniform(5, 40, n_samples // 5),
                rng.integers(1, 2, n_samples // 5),
                rng.integers(1, 2, n_samples // 5),
                rng.integers(1, 2, n_samples // 5),
                np.ones(n_samples // 5),
            ]
        ).astype(float)
        X = np.vstack([normal, anomaly])
        model = IsolationForest(
            n_estimators=120,
            contamination=0.12,
            random_state=42,
        )
        model.fit(X)
        self.model_path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(model, self.model_path)
        self.model = model

    def _features(self, txn: dict[str, Any]) -> np.ndarray:
        avg = max(float(txn.get("avg_amount_7d") or 1.0), 1.0)
        amount = float(txn["amount"])
        country_risk = 1.0 if txn.get("country") in HIGH_RISK_COUNTRIES else 0.0
        category_risk = 1.0 if txn.get("merchant_category") in HIGH_RISK_CATEGORIES else 0.0
        new_merchant = 1.0 if txn.get("is_new_merchant") else 0.0
        channel_online = 1.0 if txn.get("channel") == "online" else 0.0
        return np.array(
            [
                [
                    amount,
                    float(txn.get("velocity_1h") or 1),
                    amount / avg,
                    country_risk,
                    category_risk,
                    new_merchant,
                    channel_online,
                ]
            ],
            dtype=float,
        )

    def _rule_score(self, txn: dict[str, Any]) -> tuple[int, list[str]]:
        score = 0
        reasons: list[str] = []
        amount = float(txn["amount"])
        avg = max(float(txn.get("avg_amount_7d") or 1.0), 1.0)
        velocity = int(txn.get("velocity_1h") or 1)

        if amount > avg * 6:
            score += 28
            reasons.append(f"Amount {amount:.0f} is {amount / avg:.1f}x 7-day average")
        elif amount > avg * 3:
            score += 16
            reasons.append(f"Amount elevated vs 7-day average ({amount / avg:.1f}x)")

        if velocity >= 8:
            score += 24
            reasons.append(f"High velocity: {velocity} txns in last hour")
        elif velocity >= 5:
            score += 14
            reasons.append(f"Elevated velocity: {velocity} txns in last hour")

        if txn.get("country") in HIGH_RISK_COUNTRIES:
            score += 18
            reasons.append(f"High-risk corridor: {txn.get('country')}")

        if txn.get("merchant_category") in HIGH_RISK_CATEGORIES:
            score += 16
            reasons.append(f"Risky merchant category: {txn.get('merchant_category')}")

        if txn.get("is_new_merchant") and amount > 200:
            score += 12
            reasons.append("First-time merchant with large ticket")

        if txn.get("channel") == "online" and amount > 1500:
            score += 10
            reasons.append("Large online payment")

        return min(score, 100), reasons

    def _ml_score(self, txn: dict[str, Any]) -> int:
        if self.model is None:
            self.ensure_model()
        assert self.model is not None
        raw = float(self.model.decision_function(self._features(txn))[0])
        risk = int(np.clip((0.25 - raw) * 120, 0, 100))
        return risk

    def score(self, txn: dict[str, Any]) -> dict[str, Any]:
        rule_pts, reasons = self._rule_score(txn)
        ml_pts = self._ml_score(txn)
        blended = int(np.clip(0.65 * rule_pts + 0.35 * ml_pts, 0, 100))

        if ml_pts >= 70 and "Anomaly model flagged unusual pattern" not in reasons:
            reasons.append("Anomaly model flagged unusual pattern")

        if not reasons:
            reasons = ["Within normal customer behavior"]

        if blended >= 80:
            recommended = "escalate"
        elif blended >= 60:
            recommended = "hold"
        else:
            recommended = "approve"

        return {
            "risk_score": blended,
            "risk_reasons": reasons[:4],
            "recommended_action": recommended,
            "components": {"rules": rule_pts, "ml": ml_pts},
        }
