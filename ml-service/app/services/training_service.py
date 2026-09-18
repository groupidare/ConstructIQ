from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.services.forecasting_service import get_engine
from app.ml import random_forest, xgboost_model

# ProjectStatus enum (backend): Planning=0, Active=1, OnHold=2, Completed=3, Cancelled=4.
# PurchaseOrderStatus enum (backend): Pending=0, Approved=1, Delivered=2.
# Historical training data comes from whole completed projects (backfilled via the
# "add a completed project" flow), not individual completed phases — a project can
# have real actual-usage figures entered without every phase being marked Completed.
# LEFT JOIN phases: a BOQ row without a phase assigned still has a usable target.
# ActualQuantity > 0 excludes rows that were never backfilled (default 0, not a
# real "zero used" reading).
#
# supplier_lead_time_days is a correlated scalar subquery, not a JOIN+GROUP BY —
# a BOQ row can match several PurchaseOrderMaterial rows (multiple deliveries of
# the same material), and a plain join would fan that out into duplicate BOQ
# rows, breaking the 1:1 alignment train_models() assumes between records/targets.
# Only Delivered POs count — Pending/Approved aren't real actuals yet.
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
        COALESCE(bi.PrimarySection, '') AS primary_section,
        COALESCE(bi.CoverageArea, 0) AS coverage_area,
        p.Type AS project_type_encoded,
        DATEDIFF(COALESCE(ph.EndDate, p.TargetEndDate), COALESCE(ph.StartDate, p.StartDate)) AS days_into_phase,
        DATEDIFF(COALESCE(ph.EndDate, p.TargetEndDate), COALESCE(ph.StartDate, p.StartDate)) AS phase_duration_days,
        COALESCE(ph.ProgressPercent, 100) AS progress_percent,
        COALESCE((
            SELECT AVG(de.ActualLeadDays)
            FROM purchaseordermaterials pom
            JOIN purchaseorders po ON po.Id = pom.PurchaseOrderId AND po.Status = 2
            JOIN deliveryevaluations de ON de.PurchaseOrderId = po.Id
            WHERE pom.BOQItemId = bi.Id
               OR (pom.BOQItemId IS NULL AND pom.MaterialId = bi.MaterialId
                   AND (pom.PhaseId = bi.PhaseId OR (pom.PhaseId IS NULL AND bi.PhaseId IS NULL)))
        ), 7) AS supplier_lead_time_days
    FROM boqitems bi
    JOIN materials m ON m.Id = bi.MaterialId
    JOIN projects p  ON p.Id = bi.ProjectId AND p.Status = 3
    LEFT JOIN phases ph ON ph.Id = bi.PhaseId
    LEFT JOIN inventoryrecords ir ON ir.ProjectId = bi.ProjectId AND ir.MaterialId = bi.MaterialId
    WHERE bi.ActualQuantity > 0
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
