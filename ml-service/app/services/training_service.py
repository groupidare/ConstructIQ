from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.services.forecasting_service import get_engine, fetch_records, build_response
from app.ml import random_forest, xgboost_model, material_ratios
from app.ml.model_evaluator import ensemble_predict

# ProjectStatus enum (backend): Planning=0, Active=1, OnHold=2, Completed=3, Cancelled=4.
# PurchaseOrderStatus enum (backend): Pending=0, Approved=1, Delivered=2.
# Historical training data comes from whole completed projects (backfilled via the
# "add a completed project" flow), not individual completed phases — a project can
# have real actual-usage figures entered without every phase being marked Completed.
# LEFT JOIN phases: a BOQ row without a phase assigned still has a usable target.
#
# Target quantity: ActualQuantity, filtered to BOQItems.IsUsageConfirmed = 1 only
# (backend-computed — see BOQItem.IsUsageConfirmed). A row's ActualQuantity is
# only ever a genuine figure when it's confirmed: a real ExcessWasteRecord was
# logged against it, or a human actually typed a number while backfilling a
# historical project. An unconfirmed row's ActualQuantity is just its own
# EstimatedQuantity silently standing in (nothing was ever logged/entered) —
# training on that teaches the model to predict the estimate from the estimate,
# which is circular, not signal. Previously this query treated any IsHistorical
# row's EstimatedQuantity as if it were a confirmed actual by default; that's
# exactly the ambiguity IsUsageConfirmed now makes explicit instead of guessing.
#
# supplier_lead_time_days is a correlated scalar subquery, not a JOIN+GROUP BY —
# a BOQ row can match several PurchaseOrderMaterial rows (multiple deliveries of
# the same material), and a plain join would fan that out into duplicate BOQ
# rows, breaking the 1:1 alignment train_models() assumes between records/targets.
# Only Delivered POs count — Pending/Approved aren't real actuals yet.
#
# What's learned: BOQ quantity (sq.m/l.m/..., known at planning time) → actual
# quantity USED in the purchase unit (pcs/bag/box/...). So:
#  - Input boq_quantity is bi.EstimatedQuantity, never EstimatedPurchaseQuantity:
#    for a new project that's the unknown being forecast (the Est. Qty this
#    model fills in), and for a historical row it's the PO total — nearly the
#    answer itself. Training on it would be leakage.
#  - Only rows whose purchase unit is known — both EstimatedPurchaseUnit and
#    EstimatedPurchaseQuantity set, the same "purchase baseline in use" rule
#    the backend labels the row's Actual Qty unit with (CompletedProjectDemand
#    Rules.ResolveBoqLineUnit) — so the target's unit is never ambiguous.
#  - purchase_unit is returned with each row; material_ratios.py learns the
#    per-material conversion from it.
_TRAINING_SQL = text("""
    SELECT
        bi.Id        AS boq_item_id,
        bi.ProjectId AS project_id,
        p.IsHistorical AS is_historical,
        m.Id         AS material_id,
        m.Name       AS material_name,
        m.Unit       AS unit,
        TRIM(bi.EstimatedPurchaseUnit) AS purchase_unit,
        m.UnitCost   AS unit_cost,
        bi.EstimatedQuantity AS boq_quantity,
        bi.ActualQuantity AS actual_used,
        COALESCE(ir.AvailableQuantity, 0) AS current_stock,
        COALESCE(ir.ExcessQuantity, 0)    AS excess_quantity,
        COALESCE(ir.WastedQuantity, 0)    AS wasted_quantity,
        COALESCE(bi.PrimarySection, '') AS primary_section,
        COALESCE(bi.CoverageArea, 0) AS coverage_area,
        p.Type AS project_type_encoded,
        DATEDIFF(COALESCE(ph.EndDate, p.TargetEndDate), COALESCE(ph.StartDate, p.StartDate)) AS days_into_phase,
        DATEDIFF(COALESCE(ph.EndDate, p.TargetEndDate), COALESCE(ph.StartDate, p.StartDate)) AS phase_duration_days,
        COALESCE(ph.ProgressPercent, 100) AS progress_percent,
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
    JOIN Projects p  ON p.Id = bi.ProjectId AND p.Status = 3
    LEFT JOIN Phases ph ON ph.Id = bi.PhaseId
    LEFT JOIN InventoryRecords ir ON ir.ProjectId = bi.ProjectId AND ir.MaterialId = bi.MaterialId
    WHERE bi.IsUsageConfirmed = 1
      AND bi.EstimatedPurchaseQuantity IS NOT NULL
      AND bi.EstimatedPurchaseUnit IS NOT NULL AND TRIM(bi.EstimatedPurchaseUnit) <> ''
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

    # Feature: each row's material ratio from OTHER projects only (see
    # material_ratios.attach_out_of_project — the full table would leak the
    # target). The table persisted for forecasting is fitted on every row.
    material_ratios.attach_out_of_project(records, targets)
    table = material_ratios.fit(records, targets)

    rf_metrics  = random_forest.train(records, targets)
    xgb_metrics = xgboost_model.train(records, targets)
    material_ratios.save(table)

    return {
        "sample_count":  len(records),
        "random_forest": rf_metrics,
        "xgboost":       xgb_metrics,
        "evaluations":   _leave_one_project_out(engine, records, targets, min_samples),
    }


_LOO_GLOBAL_FALLBACK_NOTE = (
    "No other projects to learn from — predicted as BOQ quantity × the global median "
    "ratio, which includes this project's own rows (not a true out-of-sample figure)."
)


def _leave_one_project_out(engine, records: list[dict], targets: list[float], min_samples: int) -> list[dict]:
    """An honest evaluation forecast for every historical project in the
    training set: its predictions come from models AND a ratio table fitted
    WITHOUT any of that project's own rows, so the chart's AI Predicted line
    for it is a genuine out-of-sample figure rather than the model echoing
    data it was trained on. Nothing here is persisted by this service — the
    backend (ForecastService.TrainModelsAsync) saves each as that project's
    evaluation ForecastResult, replacing the previous one.

    Predicted over the same rows and features an ordinary forecast run for
    that project uses (forecasting_service.fetch_records/build_response), so
    the two are directly comparable. When the other projects together have
    fewer than min_samples rows, no model is fitted: the prediction is BOQ
    quantity × their median material ratio. With no other projects at all,
    the global median ratio stands in — `note` says which, for the run's
    Notes."""
    evaluations = []
    historical_ids = sorted({r["project_id"] for r in records if r["is_historical"]})

    for project_id in historical_ids:
        project_records = fetch_records(engine, project_id, None)
        if not project_records:
            continue

        fold = [(dict(r), t) for r, t in zip(records, targets) if r["project_id"] != project_id]
        fold_records = [r for r, _ in fold]
        fold_targets = [t for _, t in fold]
        models = None
        note = None

        if fold_records:
            material_ratios.attach_out_of_project(fold_records, fold_targets)
            table = material_ratios.fit(fold_records, fold_targets)
            if len(fold_records) >= min_samples:
                models = (random_forest.fit(fold_records, fold_targets),
                          xgboost_model.fit(fold_records, fold_targets))
            else:
                note = (
                    f"Only {len(fold_records)} training row(s) from other projects (need {min_samples} to fit a "
                    f"model) — predicted as BOQ quantity × the other projects' median material ratio."
                )
        else:
            full = material_ratios.fit(records, targets)
            table = {**material_ratios.empty_table(),
                     "default_unit": full["default_unit"], "global_ratio": full["global_ratio"]}
            note = _LOO_GLOBAL_FALLBACK_NOTE

        material_ratios.attach(project_records, table)
        if models is not None:
            preds = ensemble_predict(random_forest.predict(project_records, model=models[0]),
                                     xgboost_model.predict(project_records, model=models[1]))
        else:
            preds = material_ratios.ratio_estimates(project_records)

        response = build_response(project_id, None, "Monthly", project_records, preds, table)
        evaluations.append({
            "project_id":           project_id,
            "note":                 note,
            "forecasted_materials": [fm.model_dump(mode="json") for fm in response.forecasted_materials],
        })

    return evaluations
