from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
import os
from datetime import datetime, date

from dotenv import load_dotenv
from app.models.schemas import ForecastRequest, ForecastResponse, ForecastedMaterial, RiskLevel
from app.ml import random_forest, xgboost_model
from app.ml.model_evaluator import ensemble_predict, classify_risk

# Loaded here (not just in main.py) so DB access works from any entrypoint —
# a standalone script/test, not just the running FastAPI app. Idempotent.
load_dotenv()


def get_engine() -> Engine:
    url = os.getenv(
        "DATABASE_URL",
        "mysql+pymysql://root:password@db:3306/constructiq"
    )
    # Aiven (and most managed MySQL hosts) require TLS. Set DB_SSL_CA to the
    # path of the provider's downloaded CA certificate to enable it — unset
    # by default, so local/docker-compose (no TLS configured) is unaffected.
    ssl_ca = os.getenv("DB_SSL_CA")
    connect_args = {"ssl": {"ca": ssl_ca}} if ssl_ca else {}
    return create_engine(url, pool_recycle=300, connect_args=connect_args)


def _fetch_records(engine: Engine, project_id: int, phase_id: int | None) -> list[dict]:
    phase_filter = "AND bi.PhaseId = :phase_id" if phase_id else ""
    sql = text(f"""
        SELECT
            m.Id         AS material_id,
            m.Name       AS material_name,
            -- Must match training_service.py's own EstimatedPurchaseUnit-first
            -- preference — the model is trained on boq_quantity in purchase
            -- units (pcs/bags/etc.) when available, so predicting from the
            -- raw BOQ unit (e.g. sq.m) here would feed it a different scale
            -- than it learned on. Falls back to the BOQ row's own unit, then
            -- the catalog unit, only when no purchase unit was ever set.
            COALESCE(NULLIF(bi.EstimatedPurchaseUnit, ''), NULLIF(bi.Unit, ''), m.Unit) AS unit,
            m.UnitCost   AS unit_cost,
            COALESCE(bi.EstimatedPurchaseQuantity, bi.EstimatedQuantity) AS boq_quantity,
            COALESCE(bi.ActualQuantity, 0) AS actual_used,
            COALESCE(ir.AvailableQuantity, 0) AS current_stock,
            COALESCE(ir.ExcessQuantity, 0) AS excess_quantity,
            COALESCE(ir.WastedQuantity, 0) AS wasted_quantity,
            COALESCE(bi.PrimarySection, '') AS primary_section,
            COALESCE(bi.CoverageArea, 0) AS coverage_area,
            p.Type AS project_type_encoded,
            DATEDIFF(NOW(), COALESCE(ph.StartDate, p.StartDate)) AS days_into_phase,
            DATEDIFF(COALESCE(ph.EndDate, p.TargetEndDate),
                     COALESCE(ph.StartDate, p.StartDate)) AS phase_duration_days,
            COALESCE(ph.ProgressPercent, 0) AS progress_percent,
            COALESCE((
                SELECT AVG(de.ActualLeadDays)
                FROM PurchaseOrderMaterials pom
                JOIN PurchaseOrders po ON po.Id = pom.PurchaseOrderId AND po.Status = 2
                JOIN DeliveryEvaluations de ON de.PurchaseOrderId = po.Id
                WHERE pom.BOQItemId = bi.Id
                   OR (pom.BOQItemId IS NULL AND pom.MaterialId = bi.MaterialId
                       AND (pom.PhaseId = bi.PhaseId OR (pom.PhaseId IS NULL AND bi.PhaseId IS NULL)))
            ), 7) AS supplier_lead_time_days
        FROM BOQItems bi
        JOIN Materials m ON m.Id = bi.MaterialId
        JOIN Projects p  ON p.Id = bi.ProjectId
        LEFT JOIN Phases ph ON ph.Id = bi.PhaseId
        LEFT JOIN InventoryRecords ir ON ir.ProjectId = bi.ProjectId AND ir.MaterialId = bi.MaterialId
        WHERE bi.ProjectId = :project_id
        {phase_filter}
        GROUP BY m.Id, bi.Id, bi.Unit, bi.EstimatedQuantity, bi.ActualQuantity, ir.AvailableQuantity,
                 ir.ExcessQuantity, ir.WastedQuantity, bi.PrimarySection, bi.CoverageArea, p.Type,
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

    # One prediction per BOQ line item (each carries its own section/phase/
    # coverage-area features), but the same material commonly shows up on
    # more than one line (e.g. CHB used for both "Exterior Wall" and
    # "Interior Partition") — collapse those into one entry per material_id
    # here so the API's contract (material_id/material_name, no line-item
    # identifier at all) actually holds, instead of silently returning
    # duplicate material_ids that predicted totals apart and duplicate rows
    # downstream (React key collisions, doubled-looking numbers in the UI).
    #
    # Grouped by (material_id, unit) rather than material_id alone — a BOQ
    # row's unit can legitimately differ from another row of the same
    # material (sq.m for one wall, l.m for a pipe run of the same CHB/pipe
    # material). Summing those raw quantities together under one label would
    # silently combine incompatible units into a single meaningless number;
    # keeping them as separate entries means each one only ever sums
    # same-unit quantities.
    by_material: dict[tuple[int, str], ForecastedMaterial] = {}
    for i, record in enumerate(records):
        qty      = float(max(preds[i], 0))
        stock    = float(record["current_stock"])
        material_id = record["material_id"]
        unit        = record["unit"]
        key = (material_id, unit)

        existing = by_material.get(key)
        if existing is not None:
            existing.forecasted_quantity += qty
        else:
            by_material[key] = ForecastedMaterial(
                material_id         = material_id,
                material_name       = record["material_name"],
                unit                = unit,
                forecasted_quantity = qty,
                current_stock       = stock,   # per-material fact — identical across this material's rows
                shortage            = 0,       # recomputed below, once the total is known
                reorder_suggestion  = 0,
                risk_level          = RiskLevel.low,
            )

    forecasted_materials = list(by_material.values())
    for fm in forecasted_materials:
        fm.shortage           = max(fm.forecasted_quantity - fm.current_stock, 0)
        fm.reorder_suggestion = fm.shortage * 1.1
        fm.risk_level         = RiskLevel(classify_risk(fm.shortage, fm.current_stock))
        # Material quantities are always whole units in practice — round only
        # after shortage/reorder/risk are derived from the precise float, so
        # the rounding itself never skews the risk classification.
        fm.forecasted_quantity = round(fm.forecasted_quantity)
        fm.current_stock       = round(fm.current_stock)
        fm.shortage            = round(fm.shortage)
        fm.reorder_suggestion  = round(fm.reorder_suggestion)

    return ForecastResponse(
        project_id=request.project_id,
        phase_id=request.phase_id,
        period=request.period.value,
        model_accuracy=None,
        forecasted_materials=forecasted_materials,
    )
