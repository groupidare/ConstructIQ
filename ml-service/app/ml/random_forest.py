import joblib
import numpy as np
from pathlib import Path
from sklearn.ensemble import RandomForestRegressor

from app.ml.feature_engineering import records_to_dataframe, FEATURE_COLS

# Persisting/loading is model_registry's job (versioned files + manifest, so a
# half-finished training run can never become the active model) — this module
# only builds, fits, saves/loads a given path, and predicts.
FILE_NAME = "rf_model.pkl"


def _new_model() -> RandomForestRegressor:
    return RandomForestRegressor(
        n_estimators=200,
        max_depth=10,
        min_samples_split=5,
        random_state=42,
        n_jobs=-1,
    )


def fit(records: list[dict], targets: list[float]) -> RandomForestRegressor:
    """Fits on every given row. Records need material_ratio attached
    (material_ratios.attach / attach_out_of_project) first."""
    model = _new_model()
    model.fit(records_to_dataframe(records)[FEATURE_COLS].values, np.array(targets))
    return model


def predict(records: list[dict], model: RandomForestRegressor) -> np.ndarray:
    """Records need material_ratio attached (material_ratios.attach) first."""
    return model.predict(records_to_dataframe(records)[FEATURE_COLS].values)


def save(model: RandomForestRegressor, path: Path) -> None:
    joblib.dump(model, path)


def load(path: Path) -> RandomForestRegressor:
    return joblib.load(path)
