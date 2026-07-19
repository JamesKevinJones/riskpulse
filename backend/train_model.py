"""Train / refresh the IsolationForest model artifact."""

from app.scorer import RiskScorer


if __name__ == "__main__":
    scorer = RiskScorer()
    scorer.train_and_save()
    print(f"Model saved to {scorer.model_path}")
