import numpy as np


def ensemble_predict(rf_preds: np.ndarray, xgb_preds: np.ndarray, rf_weight: float = 0.5) -> np.ndarray:
    """Weighted average of Random Forest and XGBoost predictions."""
    xgb_weight = 1.0 - rf_weight
    return rf_preds * rf_weight + xgb_preds * xgb_weight


def compute_accuracy(forecasted: float, actual: float) -> float:
    if actual == 0:
        return 100.0 if forecasted == 0 else 0.0
    return max(0.0, 100.0 - abs((forecasted - actual) / actual) * 100)


def classify_risk(shortage: float, current_stock: float) -> str:
    if current_stock <= 0:
        return "Critical"
    ratio = shortage / max(current_stock, 1)
    if ratio >= 1.0:
        return "Critical"
    if ratio >= 0.5:
        return "High"
    if ratio >= 0.2:
        return "Medium"
    return "Low"
