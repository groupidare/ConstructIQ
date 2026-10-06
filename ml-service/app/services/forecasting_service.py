from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
import os
from datetime import datetime, date

from dotenv import load_dotenv
from app.models.schemas import ForecastRequest, ForecastResponse, ForecastedMaterial, ForecastedLine, RiskLevel
from app.ml import random_forest, xgboost_model, material_ratios, model_registry
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


def fetch_records(engine: Engine, project_id: int, phase_id: int | None) -> list[dict]:
    phase_filter = "AND bi.PhaseId = :phase_id" if phase_id else ""
    sql = text(f"""
        SELECT
            bi.Id        AS boq_item_id,
            m.Id         AS material_id,
            m.Name       AS material_name,
            -- The row's purchase unit (pcs/bag/box/...) when it has one —
            -- the unit the models predict in (see training_service.py's
            -- target). Final output unit is decided in Python
            -- (material_ratios.resolve_output_unit): this, else the
            -- material's most common training unit, else boq_unit below.
            NULLIF(TRIM(bi.EstimatedPurchaseUnit), '') AS purchase_unit,
            -- The BOQ row's own unit, not the catalog Material's default
            -- unit, unless the row has none — the unit boq_quantity is in.
            COALESCE(NULLIF(bi.Unit, ''), m.Unit) AS boq_unit,
            m.UnitCost   AS unit_cost,
            -- The BOQ measure (sq.m/l.m/...), exactly as training_service.py
            -- feeds it — NOT EstimatedPurchaseQuantity. On a live project
            -- that's the very Est. Qty this forecast is about to fill in, and
            -- on a historical one it's the PO total (≈ the answer); the
            -- models are trained on the BOQ quantity known at planning time.
            bi.EstimatedQuantity AS boq_quantity,
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
        GROUP BY m.Id, bi.Id, bi.Unit, bi.EstimatedPurchaseUnit, bi.EstimatedQuantity, bi.ActualQuantity, ir.AvailableQuantity,
                 ir.ExcessQuantity, ir.WastedQuantity, bi.PrimarySection, bi.CoverageArea, p.Type,
                 ph.StartDate, ph.EndDate, p.StartDate, p.TargetEndDate, ph.ProgressPercent
    """)

    params: dict = {"project_id": project_id}
    if phase_id:
        params["phase_id"] = phase_id

    with engine.connect() as conn:
        rows = conn.execute(sql, params).mappings().all()
    return [dict(r) for r in rows]


def build_response(
    project_id: int, phase_id: int | None, period: str,
    records: list[dict], preds, table: dict,
) -> ForecastResponse:
    """Shapes one prediction per BOQ row into the API response — shared by
    run_forecast (persisted models) and training_service's leave-one-
    project-out evaluations (fold models), so both come out identically."""
    # One prediction per BOQ line item (each carries its own section/phase/
    # coverage-area features), but the same material commonly shows up on
    # more than one line (e.g. CHB used for both "Exterior Wall" and
    # "Interior Partition") — collapse those into one entry per material
    # here, as the forecasted_materials contract has always been.
    #
    # Grouped by (material_id, output unit) rather than material_id alone —
    # two rows of the same material can still predict in different units
    # (one row's own purchase unit is "box", another's "pc"). Summing those
    # together under one label would silently combine incompatible units
    # into a single meaningless number. The unit is folded the same way the
    # backend folds it (pc/pcs/piece/pieces, case, whitespace) so label
    # variants of one unit don't split into separate entries.
    #
    # line_forecasts keeps the same predictions un-collapsed, one per BOQ
    # row (boq_item_id), for callers that need a row's own figure — e.g.
    # filling a live row's Est. Qty with ITS prediction, not the material's
    # total repeated on every row of that material.
    by_material: dict[tuple[int, str], ForecastedMaterial] = {}
    line_forecasts: list[ForecastedLine] = []
    for i, record in enumerate(records):
        qty         = float(max(preds[i], 0))
        stock       = float(record["current_stock"])
        material_id = record["material_id"]
        unit        = material_ratios.resolve_output_unit(table, record)
        key = (material_id, material_ratios.normalize_unit(unit))

        line_forecasts.append(ForecastedLine(
            boq_item_id         = record["boq_item_id"],
            material_id         = material_id,
            unit                = unit,
            forecasted_quantity = round(qty),
            purchase_unit_known = material_ratios.has_purchase_unit(table, record),
        ))

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
        project_id=project_id,
        phase_id=phase_id,
        period=period,
        model_accuracy=None,
        forecasted_materials=forecasted_materials,
        line_forecasts=line_forecasts,
    )


class ModelNotAvailable(Exception):
    """No trained model to forecast with (never trained, or the active one
    can't be loaded) — the route turns this into a 409 so the caller can tell
    it apart from a real failure. AI forecasting is blocked rather than
    answered with a fallback calculation dressed up as a model prediction."""


def run_forecast(request: ForecastRequest) -> ForecastResponse:
    active, problem = model_registry.load_active()
    if active is None:
        raise ModelNotAvailable(problem or "No trained model is available.")

    engine  = get_engine()
    records = fetch_records(engine, request.project_id, request.phase_id)

    if not records:
        return ForecastResponse(
            project_id=request.project_id,
            phase_id=request.phase_id,
            period=request.period.value,
            model_accuracy=None,
            forecasted_materials=[],
            model_version=active.version,
            model_confidence=active.manifest.get("confidence"),
        )

    # The same ratio table the active models were trained against.
    material_ratios.attach(records, active.ratio_table)

    rf_preds  = random_forest.predict(records, active.rf)
    xgb_preds = xgboost_model.predict(records, active.xgb)
    preds     = ensemble_predict(rf_preds, xgb_preds)

    response = build_response(request.project_id, request.phase_id, request.period.value, records, preds, active.ratio_table)
    response.model_version    = active.version
    response.model_confidence = active.manifest.get("confidence")
    return response
