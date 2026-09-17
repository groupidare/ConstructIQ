import joblib
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error

from app.ml.feature_engineering import records_to_dataframe

MODEL_PATH = Path("trained_models/rf_model.pkl")
FEATURE_COLS = [
    "boq_quantity", "actual_used", "current_stock", "excess_quantity",
    "wasted_quantity", "primary_section_encoded", "project_type_encoded",
    "days_into_phase", "phase_duration_days", "progress_percent", "usage_rate",
]


def train(records: list[dict], targets: list[float]) -> dict:
    df = records_to_dataframe(records)
    X  = df[FEATURE_COLS].values
    y  = np.array(targets)

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    model = RandomForestRegressor(
        n_estimators=200,
        max_depth=10,
        min_samples_split=5,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    preds = model.predict(X_test)
    mae   = mean_absolute_error(y_test, preds)
    rmse  = mean_squared_error(y_test, preds, squared=False)
    r2    = model.score(X_test, y_test)

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_PATH)

    return {"mae": mae, "rmse": rmse, "r2": r2}


def predict(records: list[dict]) -> np.ndarray:
    if not MODEL_PATH.exists():
        # Fallback: return BOQ quantity as naive forecast
        return np.array([float(r.get("boq_quantity", 0)) for r in records])

    model = joblib.load(MODEL_PATH)
    df    = records_to_dataframe(records)
    X     = df[FEATURE_COLS].values
    return model.predict(X)
