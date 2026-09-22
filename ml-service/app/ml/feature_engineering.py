import pandas as pd
import numpy as np
from typing import Any


# Must match the Primary Section taxonomy used by the BOQ/Material Plan UI
# (frontend types/boq.ts PRIMARY_SECTIONS) — the real construction-category
# breakdown, unlike the old free-text Phase name it replaces here.
PRIMARY_SECTIONS = [
    "Architectural Works", "Electrical Works", "Fire Detection & Alarm System Works",
    "Mechanical Works", "Fire Protection Works", "Special Fabrication Works", "Others",
]
_PRIMARY_SECTION_INDEX = {name: i + 1 for i, name in enumerate(PRIMARY_SECTIONS)}  # 0 = unset/unrecognized

# Single canonical feature-column list — both random_forest.py and xgboost_model.py
# import this instead of keeping their own copy, so the two models and
# build_feature_vector's output keys can never silently drift apart.
#
# "actual_used" is NOT a feature — it's the training target. It used to appear
# in this list (and the old "usage_rate" was actual_used / days_into_phase,
# which leaks the target almost as directly as including it outright: a model
# can trivially back out actual_used from usage_rate * days_into_phase). Fixed
# by dropping actual_used entirely and redefining usage_rate from boq_quantity
# (the estimate, legitimately known before the actual is) instead.
FEATURE_COLS = [
    "boq_quantity", "current_stock", "excess_quantity",
    "wasted_quantity", "primary_section_encoded", "coverage_area",
    "project_type_encoded", "days_into_phase", "phase_duration_days",
    "progress_percent", "supplier_lead_time_days", "planned_usage_rate",
]


def build_feature_vector(record: dict[str, Any]) -> dict[str, float]:
    """
    Build the feature vector used by both Random Forest and XGBoost models.

    Expected keys in `record`:
        boq_quantity, current_stock, excess_quantity, wasted_quantity,
        primary_section, coverage_area, project_type_encoded, days_into_phase,
        phase_duration_days, progress_percent, supplier_lead_time_days
    """
    primary_section_encoded = _PRIMARY_SECTION_INDEX.get(record.get("primary_section", ""), 0)
    days_into_phase = float(record.get("days_into_phase", 0))

    return {
        "boq_quantity":            float(record.get("boq_quantity", 0)),
        "current_stock":           float(record.get("current_stock", 0)),
        "excess_quantity":         float(record.get("excess_quantity", 0)),
        "wasted_quantity":         float(record.get("wasted_quantity", 0)),
        "primary_section_encoded": float(primary_section_encoded),
        "coverage_area":           float(record.get("coverage_area", 0)),
        "project_type_encoded":    float(record.get("project_type_encoded", 0)),
        "days_into_phase":         days_into_phase,
        "phase_duration_days":     float(record.get("phase_duration_days", 30)),
        "progress_percent":        float(record.get("progress_percent", 0)),
        "supplier_lead_time_days": float(record.get("supplier_lead_time_days", 7)),
        "planned_usage_rate":      float(record.get("boq_quantity", 0)) / max(days_into_phase, 1),
    }


def records_to_dataframe(records: list[dict[str, Any]]) -> pd.DataFrame:
    vectors = [build_feature_vector(r) for r in records]
    return pd.DataFrame(vectors)
