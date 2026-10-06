import math
from datetime import datetime, timezone

import numpy as np
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.services.forecasting_service import get_engine, fetch_records, build_response
from app.ml import random_forest, xgboost_model, material_ratios, model_registry
from app.ml.model_evaluator import ensemble_predict

# ProjectStatus enum (backend): Planning=0, Active=1, OnHold=2, Completed=3, Cancelled=4.
# PurchaseOrderStatus enum (backend): Pending=0, Approved=1, Delivered=2.
# Historical training data comes from whole completed projects (backfilled via the
# "add a completed project" flow), not individual completed phases.
# LEFT JOIN phases: a BOQ row without a phase assigned still has a usable target.
#
# Target quantity: the row's PO quantity — EstimatedPurchaseQuantity of a row
# backed by real PO-report lines (HistoricalMaterialSupply), which the backend
# sets to those lines' total when they're all in one unit (BOQService.
# BulkSaveAsync). That's what was actually BOUGHT for the BOQ line, and it's
# exactly what a live project's Est. Qty is: how much to order. Every
# historical row with PO lines is usable as-is — no hand-typed Actual Qty
# needed first.
#
# Only rows WITH PO-report lines: a project completed through the app is also
# IsHistorical, but its rows' EstimatedPurchaseQuantity is their Est. Qty —
# typed by hand or filled in by this very model on Run Forecast. Training on
# that would teach the model to predict its own past predictions.
#
# supplier_lead_time_days is a correlated scalar subquery, not a JOIN+GROUP BY —
# a BOQ row can match several PurchaseOrderMaterial rows (multiple deliveries of
# the same material), and a plain join would fan that out into duplicate BOQ
# rows, breaking the 1:1 alignment train_models() assumes between records/targets.
# Only Delivered POs count — Pending/Approved aren't real actuals yet.
#
# What's learned: BOQ quantity (sq.m/l.m/..., known at planning time) → PO
# quantity in the purchase unit (pcs/bag/box/...). So:
#  - Input boq_quantity is bi.EstimatedQuantity, never EstimatedPurchaseQuantity:
#    that's the target itself here (and, on a live project, the Est. Qty this
#    model fills in). Using it as an input would be leakage.
#  - Only rows whose purchase unit is known — both EstimatedPurchaseUnit and
#    EstimatedPurchaseQuantity set (mixed-unit PO lines leave both null) — so
#    the target's unit is never ambiguous.
#  - purchase_unit is returned with each row; material_ratios.py learns the
#    per-material conversion from it.
# One definition of "a row the model can learn from", shared by the training
# query and the eligibility report below, so the report can never disagree
# with what training actually uses.
_ELIGIBLE_ROW_PREDICATE = """
    EXISTS (SELECT 1 FROM HistoricalMaterialSupplies h WHERE h.BOQItemId = bi.Id)
    AND bi.EstimatedPurchaseQuantity IS NOT NULL AND bi.EstimatedPurchaseQuantity > 0
    AND bi.EstimatedPurchaseUnit IS NOT NULL AND TRIM(bi.EstimatedPurchaseUnit) <> ''
"""

_TRAINING_SQL = text(f"""
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
        bi.EstimatedPurchaseQuantity AS purchased_quantity,
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
    WHERE {_ELIGIBLE_ROW_PREDICATE}
""")


def fetch_training_data(engine: Engine) -> list[dict]:
    with engine.connect() as conn:
        rows = conn.execute(_TRAINING_SQL).mappings().all()
    return [dict(r) for r in rows]


# Quality gate. Below the reject thresholds a run is refused outright and the
# current model stays active; below the low-confidence ones it's accepted but
# marked "Low" (shown wherever the model's status/forecasts are).
MIN_ROWS            = 10
MIN_PROJECTS        = 2
LOW_CONF_PROJECTS   = 5
LOW_CONF_R2         = 0.50


class TrainingRejected(ValueError):
    """The data can't produce a trustworthy model — the message says why.
    The previously active model (if any) is left in place."""


_ELIGIBILITY_SQL = text(f"""
    SELECT
        p.Id   AS project_id,
        p.Name AS project_name,
        COUNT(bi.Id) AS boq_rows,
        COALESCE(SUM(CASE WHEN EXISTS (SELECT 1 FROM HistoricalMaterialSupplies h WHERE h.BOQItemId = bi.Id)
                          THEN 1 ELSE 0 END), 0) AS rows_with_po_lines,
        COALESCE(SUM(CASE WHEN {_ELIGIBLE_ROW_PREDICATE} THEN 1 ELSE 0 END), 0) AS eligible_rows
    FROM Projects p
    LEFT JOIN BOQItems bi ON bi.ProjectId = p.Id
    WHERE p.Status = 3
    GROUP BY p.Id, p.Name
    ORDER BY p.Name
""")


def training_data_report() -> dict:
    """Which completed projects/rows training can use, and why the rest
    can't — read-only, safe to call any time (GET /forecast/training-data)."""
    with get_engine().connect() as conn:
        rows = [dict(r) for r in conn.execute(_ELIGIBILITY_SQL).mappings().all()]

    projects = []
    for r in rows:
        boq_rows, with_lines, eligible = int(r["boq_rows"]), int(r["rows_with_po_lines"]), int(r["eligible_rows"])
        if boq_rows == 0:
            reason = "No BOQ rows."
        elif with_lines == 0:
            reason = "No PO-report lines — only projects uploaded from a combined BOQ+PO report can be learned from."
        elif eligible == 0:
            reason = ("Its PO lines haven't produced a purchase quantity — mixed units on every row, or saved "
                      "before purchase units were derived (run the purchase-unit backfill or re-save its Material Plan).")
        elif eligible < with_lines:
            reason = f"{with_lines - eligible} row(s) with PO lines skipped — mixed units or no purchase quantity."
        else:
            reason = None
        projects.append({
            "project_id":         r["project_id"],
            "project_name":       r["project_name"],
            "boq_rows":           boq_rows,
            "rows_with_po_lines": with_lines,
            "eligible_rows":      eligible,
            "eligible":           eligible > 0,
            "reason":             reason,
        })

    eligible_projects = [p for p in projects if p["eligible"]]
    eligible_rows = sum(p["eligible_rows"] for p in eligible_projects)
    return {
        "completed_projects": len(projects),
        "eligible_projects":  len(eligible_projects),
        "eligible_rows":      eligible_rows,
        "excluded_projects":  len(projects) - len(eligible_projects),
        "min_rows":           MIN_ROWS,
        "min_projects":       MIN_PROJECTS,
        "can_train":          eligible_rows >= MIN_ROWS and len(eligible_projects) >= MIN_PROJECTS,
        "projects":           projects,
    }


def _finite(x: float | None) -> float | None:
    """Metrics go out as JSON — NaN/inf (e.g. R² of a constant holdout) aren't
    valid JSON, so they become null ("couldn't be computed")."""
    if x is None:
        return None
    x = float(x)
    return x if math.isfinite(x) else None


def _metrics(y_true, y_pred) -> dict:
    y_true, y_pred = np.asarray(y_true, dtype=float), np.asarray(y_pred, dtype=float)
    r2 = r2_score(y_true, y_pred) if len(y_true) >= 2 and np.ptp(y_true) > 0 else None
    return {
        "mae":  _finite(mean_absolute_error(y_true, y_pred)),
        "rmse": _finite(math.sqrt(mean_squared_error(y_true, y_pred))),
        "r2":   _finite(r2),
        "n":    int(len(y_true)),
    }


def _row_holdout_metrics(records: list[dict], targets: list[float]) -> dict:
    """Random 80/20 row split: per-model and ensemble error on rows the
    models didn't see. Optimistic (other rows of the same project are in
    training) — the project-level holdout below is the stricter check."""
    idx = np.arange(len(records))
    train_idx, test_idx = train_test_split(idx, test_size=0.2, random_state=42)
    train_r = [records[i] for i in train_idx]
    train_t = [targets[i] for i in train_idx]
    test_r  = [records[i] for i in test_idx]
    test_t  = [targets[i] for i in test_idx]

    rf  = random_forest.fit(train_r, train_t)
    xgb = xgboost_model.fit(train_r, train_t)
    rf_pred, xgb_pred = random_forest.predict(test_r, rf), xgboost_model.predict(test_r, xgb)
    return {
        "random_forest": _metrics(test_t, rf_pred),
        "xgboost":       _metrics(test_t, xgb_pred),
        "ensemble":      _metrics(test_t, ensemble_predict(rf_pred, xgb_pred)),
    }


def train_models(min_rows: int = MIN_ROWS, min_projects: int = MIN_PROJECTS) -> dict:
    """One full training run: validate the data, measure quality, fit the
    final models on every eligible row, and publish them as the new active
    version (model_registry.publish — only after everything succeeded).
    Raises TrainingRejected when the data fails the quality gate."""
    engine  = get_engine()
    records = fetch_training_data(engine)
    project_ids = {r["project_id"] for r in records}

    if len(records) < min_rows or len(project_ids) < min_projects:
        raise TrainingRejected(
            f"Not enough training data: {len(records)} eligible row(s) across {len(project_ids)} project(s) "
            f"— need at least {min_rows} rows from at least {min_projects} projects. Eligible rows come from "
            f"completed projects uploaded from a combined BOQ+PO report, with PO lines in a single unit."
        )

    targets = [float(r["purchased_quantity"]) for r in records]

    # Feature: each row's material ratio from OTHER projects only (see
    # material_ratios.attach_out_of_project — the full table would leak the
    # target). The table persisted for forecasting is fitted on every row.
    material_ratios.attach_out_of_project(records, targets)
    table = material_ratios.fit(records, targets)

    row_holdout = _row_holdout_metrics(records, targets)
    evaluations, skipped, project_holdout = _leave_one_project_out(engine, records, targets, min_rows)

    # The models that actually forecast: fitted on every eligible row (the
    # holdout fits above exist only to measure quality).
    rf  = random_forest.fit(records, targets)
    xgb = xgboost_model.fit(records, targets)

    # Confidence is judged on the project-level holdout — a whole unseen
    # project, exactly what forecasting a new project is.
    reasons = []
    if len(project_ids) < LOW_CONF_PROJECTS:
        reasons.append(f"Trained on only {len(project_ids)} project(s) (fewer than {LOW_CONF_PROJECTS}).")
    holdout_r2 = project_holdout["r2"] if project_holdout else None
    if holdout_r2 is None:
        reasons.append("Project-level R² couldn't be computed.")
    elif holdout_r2 < LOW_CONF_R2:
        reasons.append(f"Project-level R² is {holdout_r2:.2f} (below {LOW_CONF_R2:.2f}).")

    version  = model_registry.new_version()
    manifest = model_registry.publish(version, rf, xgb, table, metadata={
        "trained_at":         datetime.now(timezone.utc).isoformat(),
        "sample_count":       len(records),
        "project_count":      len(project_ids),
        "metrics":            row_holdout,
        "project_holdout":    project_holdout,
        "evaluated_projects": len(evaluations),
        "skipped_evaluations": skipped,
        "confidence":         "Low" if reasons else "Normal",
        "confidence_reasons": reasons,
    })
    return {"model": manifest, "evaluations": evaluations}


def _leave_one_project_out(engine, records: list[dict], targets: list[float], min_rows: int):
    """An honest evaluation forecast for every historical project in the
    training set: its predictions come from models AND a ratio table fitted
    WITHOUT any of that project's own rows, so the chart's AI Predicted line
    for it is a genuine out-of-sample figure rather than the model echoing
    data it was trained on. Nothing here is persisted by this service — the
    backend (ForecastService) saves each as that project's evaluation
    ForecastResult, replacing the previous one.

    Predicted over the same rows and features an ordinary forecast run for
    that project uses (forecasting_service.fetch_records/build_response), so
    the two are directly comparable. Also scores each fold's models on the
    held-out project's own training rows — pooled, that's the project-level
    holdout metric.

    A project whose other projects together have fewer than min_rows rows
    gets NO evaluation (listed in `skipped`): no model can be fitted for it,
    and a non-model estimate must not be shown as AI Predicted."""
    evaluations, skipped = [], []
    holdout_true, holdout_pred = [], []
    historical_ids = sorted({r["project_id"] for r in records if r["is_historical"]})

    for project_id in historical_ids:
        fold = [(dict(r), t) for r, t in zip(records, targets) if r["project_id"] != project_id]
        fold_records = [r for r, _ in fold]
        fold_targets = [t for _, t in fold]
        if len(fold_records) < min_rows:
            skipped.append({
                "project_id": project_id,
                "reason": f"Only {len(fold_records)} training row(s) from other projects (need {min_rows}).",
            })
            continue

        material_ratios.attach_out_of_project(fold_records, fold_targets)
        table = material_ratios.fit(fold_records, fold_targets)
        rf  = random_forest.fit(fold_records, fold_targets)
        xgb = xgboost_model.fit(fold_records, fold_targets)

        held_out = [(dict(r), t) for r, t in zip(records, targets) if r["project_id"] == project_id]
        held_records = [r for r, _ in held_out]
        material_ratios.attach(held_records, table)
        holdout_true.extend(t for _, t in held_out)
        holdout_pred.extend(ensemble_predict(random_forest.predict(held_records, rf),
                                             xgboost_model.predict(held_records, xgb)))

        project_records = fetch_records(engine, project_id, None)
        if not project_records:
            continue
        material_ratios.attach(project_records, table)
        preds = ensemble_predict(random_forest.predict(project_records, rf),
                                 xgboost_model.predict(project_records, xgb))
        response = build_response(project_id, None, "Monthly", project_records, preds, table)
        evaluations.append({
            "project_id":           project_id,
            "forecasted_materials": [fm.model_dump(mode="json") for fm in response.forecasted_materials],
        })

    project_holdout = _metrics(holdout_true, holdout_pred) if holdout_true else None
    return evaluations, skipped, project_holdout
