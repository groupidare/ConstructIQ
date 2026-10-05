import joblib
import numpy as np
from pathlib import Path
from xgboost import XGBRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error

from app.ml.feature_engineering import records_to_dataframe, FEATURE_COLS
from app.ml.material_ratios import ratio_estimates
from app.ml import r2_storage

MODEL_PATH = Path("trained_models/xgb_model.ubj")
R2_KEY = "models/xgb_model.ubj"


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
    """Fits on every given row and returns the model WITHOUT saving it —
    see random_forest.fit."""
    model = _new_model()
    model.fit(records_to_dataframe(records)[FEATURE_COLS].values, np.array(targets), verbose=False)
    return model


def train(records: list[dict], targets: list[float]) -> dict:
    df = records_to_dataframe(records)
    X  = df[FEATURE_COLS].values
    y  = np.array(targets)

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    model = _new_model()
    model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)

    preds = model.predict(X_test)
    mae   = mean_absolute_error(y_test, preds)
    rmse  = mean_squared_error(y_test, preds, squared=False)
    r2    = model.score(X_test, y_test)

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    model.save_model(str(MODEL_PATH))
    r2_storage.upload_file(MODEL_PATH, R2_KEY)

    return {"mae": mae, "rmse": rmse, "r2": r2}


def predict(records: list[dict], model: XGBRegressor | None = None) -> np.ndarray:
    """See random_forest.predict — same fold-model/persisted-model choice and
    the same naive fallbacks."""
    if model is None:
        if not MODEL_PATH.exists() and not r2_storage.download_file(R2_KEY, MODEL_PATH):
            return np.array(ratio_estimates(records))
        model = XGBRegressor()
        model.load_model(str(MODEL_PATH))

    if model.n_features_in_ != len(FEATURE_COLS):
        return np.array(ratio_estimates(records))

    df = records_to_dataframe(records)
    X  = df[FEATURE_COLS].values
    return model.predict(X)
