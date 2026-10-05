import joblib
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error

from app.ml.feature_engineering import records_to_dataframe, FEATURE_COLS
from app.ml.material_ratios import ratio_estimates
from app.ml import r2_storage

MODEL_PATH = Path("trained_models/rf_model.pkl")
R2_KEY = "models/rf_model.pkl"


def _new_model() -> RandomForestRegressor:
    return RandomForestRegressor(
        n_estimators=200,
        max_depth=10,
        min_samples_split=5,
        random_state=42,
        n_jobs=-1,
    )


def fit(records: list[dict], targets: list[float]) -> RandomForestRegressor:
    """Fits on every given row and returns the model WITHOUT saving it —
    for training_service's leave-one-project-out evaluations, which must
    never replace the real persisted model."""
    model = _new_model()
    model.fit(records_to_dataframe(records)[FEATURE_COLS].values, np.array(targets))
    return model


def train(records: list[dict], targets: list[float]) -> dict:
    df = records_to_dataframe(records)
    X  = df[FEATURE_COLS].values
    y  = np.array(targets)

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    model = _new_model()
    model.fit(X_train, y_train)

    preds = model.predict(X_test)
    mae   = mean_absolute_error(y_test, preds)
    rmse  = mean_squared_error(y_test, preds, squared=False)
    r2    = model.score(X_test, y_test)

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    # Persisted so a later cold start (a fresh Render deploy/restart wipes
    # this container's own local disk) can self-restore instead of silently
    # degrading to the naive fallback in predict() below.
    r2_storage.upload_file(MODEL_PATH, R2_KEY)

    return {"mae": mae, "rmse": rmse, "r2": r2}


def predict(records: list[dict], model: RandomForestRegressor | None = None) -> np.ndarray:
    """Predicts with `model` when given (a leave-one-project-out fold),
    else with the persisted model. Records need material_ratio attached
    (material_ratios.attach) first."""
    if model is None:
        if not MODEL_PATH.exists() and not r2_storage.download_file(R2_KEY, MODEL_PATH):
            # Nothing locally AND nothing in R2 — genuinely never trained yet.
            # Fallback: BOQ quantity × material ratio as a naive forecast
            # (== the BOQ quantity itself when no ratio table exists either).
            return np.array(ratio_estimates(records))
        model = joblib.load(MODEL_PATH)

    if getattr(model, "n_features_in_", len(FEATURE_COLS)) != len(FEATURE_COLS):
        # Trained before FEATURE_COLS gained material_ratio/ratio_estimate —
        # its column layout no longer matches, so feeding it the new vector
        # would either error or silently misread every column. Same naive
        # fallback as "never trained" until /forecast/train is re-run.
        return np.array(ratio_estimates(records))

    df = records_to_dataframe(records)
    X  = df[FEATURE_COLS].values
    return model.predict(X)
