"""Reference quantity + demand factor.

The models don't predict an absolute purchase quantity — trees can't
extrapolate past the largest quantity they were trained on. They predict a
scale-free DEMAND FACTOR on top of a reference quantity:

    reference = engineering baseline (baseline_engine) when the material has
                properties AND the baseline comes out in the row's purchase unit,
                else ratio_estimate (historical median ratio × boq_quantity)
    target    = actual purchase quantity ÷ reference
    forecast  = reference × predicted factor (clipped to a sane range)

Nothing new is stored: the baseline is computed from the catalog properties
every time (training and prediction alike).
"""
from __future__ import annotations

import math
import os

from app.ml import baseline_engine, material_ratios

FACTOR_MIN = float(os.getenv("DEMAND_FACTOR_MIN", "0.5"))
FACTOR_MAX = float(os.getenv("DEMAND_FACTOR_MAX", "2.0"))
FLAG_OUT_OF_RANGE = "factor_out_of_range"

SOURCE_BASELINE = "baseline"
SOURCE_RATIO = "historical_ratio"


def _material(record: dict) -> dict:
    return {
        "calculation_type":   record.get("calculation_type"),
        "length_mm":          record.get("length_mm"),
        "width_mm":           record.get("width_mm"),
        "thickness_mm":       record.get("thickness_mm"),
        "pieces_per_package": record.get("pieces_per_package"),
        "coverage_per_unit":  record.get("coverage_per_unit"),
        "coverage_unit":      record.get("coverage_unit"),
        "unit_length_m":      record.get("unit_length_m"),
        "coats":              record.get("coats"),
        "purchase_unit":      record.get("baseline_purchase_unit"),
        "unit":               record.get("material_unit") or record.get("unit"),
    }


def attach_reference(records: list[dict], table: dict | None = None) -> None:
    """Sets, per record: baseline_quantity, has_baseline, reference_quantity,
    reference_source, calculation_type_encoded. Needs material_ratio attached
    first (material_ratios.attach / attach_out_of_project).

    The target unit is the row's own purchase unit; with no purchase unit (a
    live row not filled in yet) it's the unit the forecast will be labelled
    with (material_ratios.resolve_output_unit), so the baseline is only used
    when it's in that same unit."""
    for r in records:
        target_unit = r.get("purchase_unit") or (material_ratios.resolve_output_unit(table, r) if table else "")
        boq_unit = r.get("boq_unit") or r.get("unit")
        result = baseline_engine.compute(_material(r), boq_unit, r.get("boq_quantity"))
        calc = baseline_engine.calculation_type_name(r.get("calculation_type"))

        has_baseline = (result.available and (result.baseline_quantity or 0) > 0
                        and baseline_engine.purchase_unit_key(result.purchase_unit)
                        == baseline_engine.purchase_unit_key(target_unit))
        ratio_estimate = float(r.get("boq_quantity") or 0) * float(r.get("material_ratio", 1.0))

        r["baseline_quantity"] = result.baseline_quantity if has_baseline else None
        r["has_baseline"] = 1 if has_baseline else 0
        r["reference_quantity"] = float(result.baseline_quantity) if has_baseline else ratio_estimate
        r["reference_source"] = SOURCE_BASELINE if has_baseline else SOURCE_RATIO
        r["calculation_type_encoded"] = (baseline_engine.CALCULATION_TYPES.index(calc) + 1) if calc else 0


def usable(records: list[dict], targets: list[float]) -> tuple[list[dict], list[float]]:
    """Drops rows whose reference is zero — no factor can be expressed for
    them (a BOQ quantity of 0)."""
    kept = [(r, t) for r, t in zip(records, targets) if float(r.get("reference_quantity") or 0) > 0]
    return [r for r, _ in kept], [t for _, t in kept]


def to_factors(records: list[dict], targets: list[float]) -> list[float]:
    return [float(t) / float(r["reference_quantity"]) for r, t in zip(records, targets)]


def to_quantities(records: list[dict], factors) -> tuple[list[float], list[float], list[str | None]]:
    """reference × clipped factor. Returns (quantities, clipped factors, flags)
    — flag is FLAG_OUT_OF_RANGE when the raw factor had to be clipped."""
    quantities, clipped, flags = [], [], []
    for r, f in zip(records, factors):
        f = float(f)
        c = min(max(f, FACTOR_MIN), FACTOR_MAX) if math.isfinite(f) else 1.0
        flags.append(FLAG_OUT_OF_RANGE if (not math.isfinite(f) or c != f) else None)
        clipped.append(c)
        quantities.append(float(r.get("reference_quantity") or 0) * c)
    return quantities, clipped, flags
