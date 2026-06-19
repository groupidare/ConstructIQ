from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
import os
from datetime import datetime, date

from app.models.schemas import ForecastRequest, ForecastResponse, ForecastedMaterial, RiskLevel
from app.ml import random_forest, xgboost_model
from app.ml.model_evaluator import ensemble_predict, classify_risk


PROJECT_TYPE_MAP = {
    "Residential": 0, "Commercial": 1, "Industrial": 2, "Infrastructure": 3, "Mixed": 4,
}


def _get_engine() -> Engine:
    url = os.getenv(
        "DATABASE_URL",
        "mysql+pymysql://root:password@db:3306/constructiq"
    )
    return create_engine(url, pool_recycle=300)


def _fetch_records(engine: Engine, project_id: int, phase_id: int | None) -> list[dict]:
    phase_filter = "AND bi.phase_id = :phase_id" if phase_id else ""
    sql = text(f"""
        SELECT
            m.id         AS material_id,
            m.name       AS material_name,
            m.unit       AS unit,
            m.unit_cost  AS unit_cost,
            bi.estimated_quantity AS boq_quantity,
            COALESCE(bi.actual_quantity, 0) AS actual_used,
            COALESCE(ir.available_quantity, 0) AS current_stock,
            COALESCE(ir.excess_quantity, 0) AS excess_quantity,
            COALESCE(ir.wasted_quantity, 0) AS wasted_quantity,
            COALESCE(ph.name, '') AS phase_name,
            p.type AS project_type,
            DATEDIFF(NOW(), COALESCE(ph.start_date, p.start_date)) AS days_into_phase,
            DATEDIFF(COALESCE(ph.end_date, p.target_end_date),
                     COALESCE(ph.start_date, p.start_date)) AS phase_duration_days,
            COALESCE(ph.progress_percent, 0) AS progress_percent
        FROM boq_items bi
        JOIN materials m ON m.id = bi.material_id
        JOIN projects p  ON p.id = bi.project_id
        LEFT JOIN phases ph ON ph.id = bi.phase_id
        LEFT JOIN inventory_records ir ON ir.project_id = bi.project_id AND ir.material_id = bi.material_id
        WHERE bi.project_id = :project_id
        {phase_filter}
        GROUP BY m.id, bi.estimated_quantity, bi.actual_quantity, ir.available_quantity,
                 ir.excess_quantity, ir.wasted_quantity, ph.name, p.type,
                 ph.start_date, ph.end_date, p.start_date, p.target_end_date, ph.progress_percent
    """)

    params: dict = {"project_id": project_id}
    if phase_id:
        params["phase_id"] = phase_id

    with engine.connect() as conn:
        rows = conn.execute(sql, params).mappings().all()
    return [dict(r) for r in rows]


def run_forecast(request: ForecastRequest) -> ForecastResponse:
    engine  = _get_engine()
    records = _fetch_records(engine, request.project_id, request.phase_id)

    if not records:
        return ForecastResponse(
            project_id=request.project_id,
            phase_id=request.phase_id,
            period=request.period.value,
            model_accuracy=None,
            forecasted_materials=[],
        )

    rf_preds  = random_forest.predict(records)
    xgb_preds = xgboost_model.predict(records)
    preds     = ensemble_predict(rf_preds, xgb_preds)

    forecasted_materials = []
    for i, record in enumerate(records):
        qty     = float(max(preds[i], 0))
        stock   = float(record["current_stock"])
        shortage= max(qty - stock, 0)

        forecasted_materials.append(ForecastedMaterial(
            material_id         = record["material_id"],
            material_name       = record["material_name"],
            unit                = record["unit"],
            forecasted_quantity = qty,
            current_stock       = stock,
            shortage            = shortage,
            reorder_suggestion  = shortage * 1.1,
            risk_level          = RiskLevel(classify_risk(shortage, stock)),
        ))

    return ForecastResponse(
        project_id=request.project_id,
        phase_id=request.phase_id,
        period=request.period.value,
        model_accuracy=None,
        forecasted_materials=forecasted_materials,
    )
