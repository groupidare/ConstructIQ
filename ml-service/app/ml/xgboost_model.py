import numpy as np
from pathlib import Path
from xgboost import XGBRegressor

from app.ml.feature_engineering import records_to_dataframe, FEATURE_COLS

# See random_forest.py — persistence lives in model_registry.
FILE_NAME = "xgb_model.ubj"


def _new_model() -> XGBRegressor:
    return XGBRegressor(
        n_estimators=300,
        learning_rate=0.05,
        max_depth=6,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        tree_method="hist",
    )


def fit(records: list[dict], targets: list[float]) -> XGBRegressor:
    """Fits on every given row. Records need material_ratio attached first."""
    model = _new_model()
    model.fit(records_to_dataframe(records)[FEATURE_COLS].values, np.array(targets), verbose=False)
    return model


def predict(records: list[dict], model: XGBRegressor) -> np.ndarray:
    """Records need material_ratio attached (material_ratios.attach) first."""
    return model.predict(records_to_dataframe(records)[FEATURE_COLS].values)


def save(model: XGBRegressor, path: Path) -> None:
    model.save_model(str(path))


def load(path: Path) -> XGBRegressor:
    model = XGBRegressor()
    model.load_model(str(path))
    return model
