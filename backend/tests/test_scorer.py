import random

import pytest

from app.generator import TransactionGenerator
from app.main import RISK_THRESHOLD
from app.scorer import RiskScorer

COFFEE = dict(
    amount=45, merchant="Starbucks", merchant_category="food", country="US",
    channel="pos", velocity_1h=1, avg_amount_7d=40, is_new_merchant=False,
)
WIRE_FRAUD = dict(
    amount=6000, merchant="QuickWire Remit", merchant_category="money_transfer",
    country="NG", channel="online", velocity_1h=12, avg_amount_7d=50, is_new_merchant=True,
)


@pytest.fixture(scope="module")
def scorer():
    s = RiskScorer()
    s.ensure_model()
    return s


def test_everyday_purchase_is_approved_with_a_plain_reason(scorer):
    result = scorer.score(COFFEE)
    assert result["risk_score"] < RISK_THRESHOLD
    assert result["recommended_action"] == "approve"
    assert result["risk_reasons"] == ["Within normal customer behavior"]


def test_fraud_pattern_is_queued_and_explains_itself(scorer):
    result = scorer.score(WIRE_FRAUD)
    assert result["risk_score"] >= RISK_THRESHOLD
    assert result["recommended_action"] in {"hold", "escalate"}
    reasons = " | ".join(result["risk_reasons"])
    assert "120.0x 7-day average" in reasons
    assert "High velocity: 12" in reasons
    assert "High-risk corridor: NG" in reasons


def test_reasons_are_capped_at_four_and_rule_points_at_100(scorer):
    # Fires all six rules: amount, velocity, corridor, category, new merchant, large online.
    result = scorer.score(WIRE_FRAUD)
    assert len(result["risk_reasons"]) == 4
    assert result["components"]["rules"] == 100


def test_customer_with_no_history_does_not_crash_the_scorer(scorer):
    # avg_amount_7d of 0 is floored to 1, so the ratio stays finite.
    result = scorer.score({**COFFEE, "avg_amount_7d": 0, "velocity_1h": None})
    assert 0 <= result["risk_score"] <= 100


def test_missing_model_is_retrained_deterministically(tmp_path):
    first, second = RiskScorer(tmp_path / "a.joblib"), RiskScorer(tmp_path / "b.joblib")
    first.ensure_model()
    second.ensure_model()
    assert (tmp_path / "a.joblib").exists()
    assert first.score(WIRE_FRAUD) == second.score(WIRE_FRAUD)


def test_generated_traffic_separates_at_the_queue_threshold(scorer):
    random.seed(7)
    gen = TransactionGenerator()
    normal = [scorer.score(gen.generate(risky=False))["risk_score"] for _ in range(300)]
    risky = [scorer.score(gen.generate(risky=True))["risk_score"] for _ in range(300)]
    assert sum(s >= RISK_THRESHOLD for s in normal) == 0
    assert sum(s >= RISK_THRESHOLD for s in risky) >= 0.9 * len(risky)


@pytest.mark.xfail(
    strict=True,
    reason="Known gap: the anomaly score tops out near 43, so the 0.65/0.35 blend "
    "never reaches the escalate band (80) even for the most extreme input.",
)
def test_the_most_extreme_fraud_is_recommended_for_escalation(scorer):
    assert scorer.score(WIRE_FRAUD)["recommended_action"] == "escalate"
