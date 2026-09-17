from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
import os
from datetime import datetime, date

from app.models.schemas import ForecastRequest, ForecastResponse, ForecastedMaterial, RiskLevel
from app.ml import random_forest, xgboost_model
from app.ml.model_evaluator import ensemble_predict, classify_risk


def get_engine() -> Engine:
    url = os.getenv(
        "DATABASE_URL",
        "mysql+pymysql://root:password@db:3306/constructiq"
    )
    return create_engine(url, pool_recycle=300)


def _fetch_records(engine: Engine, project_id: int, phase_id: int | None) -> list[dict]:
    phase_filter = "AND bi.PhaseId = :phase_id" if phase_id else ""
    sql = text(f"""
        SELECT
            m.Id         AS material_id,
            m.Name       AS material_name,
            m.Unit       AS unit,
            m.UnitCost   AS unit_cost,
            bi.EstimatedQuantity AS boq_quantity,
            COALESCE(bi.ActualQuantity, 0) AS actual_used,
            COALESCE(ir.AvailableQuantity, 0) AS current_stock,
            COALESCE(ir.ExcessQuantity, 0) AS excess_quantity,
            COALESCE(ir.WastedQuantity, 0) AS wasted_quantity,
            COALESCE(bi.PrimarySection, '') AS primary_section,
            p.Type AS project_type_encoded,
            DATEDIFF(NOW(), COALESCE(ph.StartDate, p.StartDate)) AS days_into_phase,
            DATEDIFF(COALESCE(ph.EndDate, p.TargetEndDate),
                     COALESCE(ph.StartDate, p.StartDate)) AS phase_duration_days,
            COALESCE(ph.ProgressPercent, 0) AS progress_percent
        FROM boqitems bi
        JOIN materials m ON m.Id = bi.MaterialId
        JOIN projects p  ON p.Id = bi.ProjectId
        LEFT JOIN phases ph ON ph.Id = bi.PhaseId
        LEFT JOIN inventoryrecords ir ON ir.ProjectId = bi.ProjectId AND ir.MaterialId = bi.MaterialId
        WHERE bi.ProjectId = :project_id
        {phase_filter}
        GROUP BY m.Id, bi.EstimatedQuantity, bi.ActualQuantity, ir.AvailableQuantity,
                 ir.ExcessQuantity, ir.WastedQuantity, bi.PrimarySection, p.Type,
                 ph.StartDate, ph.EndDate, p.StartDate, p.TargetEndDate, ph.ProgressPercent
    """)

    params: dict = {"project_id": project_id}
    if phase_id:
        params["phase_id"] = phase_id

    with engine.connect() as conn:
        rows = conn.execute(sql, params).mappings().all()
    return [dict(r) for r in rows]


def run_forecast(request: ForecastRequest) -> ForecastResponse:
    engine  = get_engine()
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
