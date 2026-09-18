import joblib
import numpy as np
from pathlib import Path
from xgboost import XGBRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error

from app.ml.feature_engineering import records_to_dataframe, FEATURE_COLS

MODEL_PATH = Path("trained_models/xgb_model.ubj")


def train(records: list[dict], targets: list[float]) -> dict:
    df = records_to_dataframe(records)
    X  = df[FEATURE_COLS].values
    y  = np.array(targets)

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    model = XGBRegressor(
        n_estimators=300,
        learning_rate=0.05,
        max_depth=6,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        tree_method="hist",
    )
    model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)

    preds = model.predict(X_test)
    mae   = mean_absolute_error(y_test, preds)
    rmse  = mean_squared_error(y_test, preds, squared=False)
    r2    = model.score(X_test, y_test)

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    model.save_model(str(MODEL_PATH))

    return {"mae": mae, "rmse": rmse, "r2": r2}


def predict(records: list[dict]) -> np.ndarray:
    if not MODEL_PATH.exists():
        return np.array([float(r.get("boq_quantity", 0)) for r in records])

    model = XGBRegressor()
    model.load_model(str(MODEL_PATH))
    df = records_to_dataframe(records)
    X  = df[FEATURE_COLS].values
    return model.predict(X)
