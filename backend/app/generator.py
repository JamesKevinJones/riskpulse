"""Synthetic payment transaction generator for RiskPulse demos."""

from __future__ import annotations

import random
from datetime import datetime, timezone
from typing import Any, Literal


MERCHANTS = [
    ("Amazon", "retail", "US"),
    ("Starbucks", "food", "US"),
    ("Uber", "travel", "US"),
    ("Shell", "fuel", "US"),
    ("Netflix", "subscription", "US"),
    ("Walmart", "retail", "US"),
    ("Apple", "electronics", "US"),
    ("Local Market", "retail", "IN"),
    ("Cairo Electronics", "electronics", "EG"),
    ("NightWire Casino", "gambling", "MT"),
    ("QuickWire Remit", "money_transfer", "NG"),
    ("DarkCart Marketplace", "marketplace", "RU"),
]

CHANNELS = ["online", "pos", "atm", "mobile"]
CUSTOMERS = [f"cust_{i:03d}" for i in range(1, 21)]


class TransactionGenerator:
    def generate(self, risky: bool | None = None) -> dict[str, Any]:
        if risky is None:
            risky = random.random() < 0.18

        if risky:
            return self._risky()
        return self._normal()

    def generate_attack_burst(
        self, intensity: Literal["medium", "high"] = "high"
    ) -> list[dict[str, Any]]:
        n = 6 if intensity == "high" else 4
        customer = random.choice(CUSTOMERS)
        card = f"{random.randint(1000, 9999)}"
        burst: list[dict[str, Any]] = []
        for i in range(n):
            merchant, category, country = random.choice(
                [
                    ("NightWire Casino", "gambling", "MT"),
                    ("QuickWire Remit", "money_transfer", "NG"),
                    ("DarkCart Marketplace", "marketplace", "RU"),
                    ("Cairo Electronics", "electronics", "EG"),
                ]
            )
            burst.append(
                {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "amount": round(
                        random.uniform(1800, 9500)
                        if intensity == "high"
                        else random.uniform(900, 3500),
                        2,
                    ),
                    "merchant": merchant,
                    "merchant_category": category,
                    "country": country,
                    "channel": "online",
                    "card_last4": card,
                    "customer_id": customer,
                    "velocity_1h": 8 + i,
                    "avg_amount_7d": round(random.uniform(35, 90), 2),
                    "is_new_merchant": True,
                }
            )
        return burst

    def _normal(self) -> dict[str, Any]:
        merchant, category, country = random.choice(MERCHANTS[:8])
        avg = round(random.uniform(20, 120), 2)
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "amount": round(max(5.0, random.gauss(avg, avg * 0.35)), 2),
            "merchant": merchant,
            "merchant_category": category,
            "country": country,
            "channel": random.choice(CHANNELS[:3]),
            "card_last4": f"{random.randint(1000, 9999)}",
            "customer_id": random.choice(CUSTOMERS),
            "velocity_1h": random.randint(1, 3),
            "avg_amount_7d": avg,
            "is_new_merchant": random.random() < 0.08,
        }

    def _risky(self) -> dict[str, Any]:
        merchant, category, country = random.choice(MERCHANTS[8:])
        avg = round(random.uniform(30, 100), 2)
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "amount": round(random.uniform(avg * 8, avg * 40), 2),
            "merchant": merchant,
            "merchant_category": category,
            "country": country,
            "channel": "online",
            "card_last4": f"{random.randint(1000, 9999)}",
            "customer_id": random.choice(CUSTOMERS),
            "velocity_1h": random.randint(6, 14),
            "avg_amount_7d": avg,
            "is_new_merchant": True,
        }

