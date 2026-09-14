from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.services.forecasting_service import get_engine
from app.ml import random_forest, xgboost_model

# PhaseStatus enum (backend): Pending = 0, Active = 1, Completed = 2.
# Only completed phases have a final, trustworthy ActualQuantity to learn from.
_TRAINING_SQL = text("""
    SELECT
        m.Id         AS material_id,
        m.Name       AS material_name,
        m.Unit       AS unit,
        m.UnitCost   AS unit_cost,
        bi.EstimatedQuantity AS boq_quantity,
        bi.ActualQuantity   AS actual_used,
        COALESCE(ir.AvailableQuantity, 0) AS current_stock,
        COALESCE(ir.ExcessQuantity, 0)    AS excess_quantity,
        COALESCE(ir.WastedQuantity, 0)    AS wasted_quantity,
        ph.Name AS phase_name,
        p.Type  AS project_type_encoded,
        DATEDIFF(ph.EndDate, ph.StartDate) AS days_into_phase,
        DATEDIFF(ph.EndDate, ph.StartDate) AS phase_duration_days,
        ph.ProgressPercent AS progress_percent
    FROM boqitems bi
    JOIN phases ph   ON ph.Id = bi.PhaseId AND ph.Status = 2
    JOIN materials m ON m.Id = bi.MaterialId
    JOIN projects p  ON p.Id = bi.ProjectId
    LEFT JOIN inventoryrecords ir ON ir.ProjectId = bi.ProjectId AND ir.MaterialId = bi.MaterialId
""")


def fetch_training_data(engine: Engine) -> list[dict]:
    with engine.connect() as conn:
        rows = conn.execute(_TRAINING_SQL).mappings().all()
    return [dict(r) for r in rows]


def train_models(min_samples: int = 10) -> dict:
    engine  = get_engine()
    records = fetch_training_data(engine)

    if len(records) < min_samples:
        raise ValueError(
            f"Not enough completed-phase BOQ records to train on "
            f"({len(records)} found, need at least {min_samples})."
        )

    targets = [float(r["actual_used"]) for r in records]

    rf_metrics  = random_forest.train(records, targets)
    xgb_metrics = xgboost_model.train(records, targets)

    return {
        "sample_count":  len(records),
        "random_forest": rf_metrics,
        "xgboost":       xgb_metrics,
    }
