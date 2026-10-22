"""Engineering baseline: how many purchase units physically cover a BOQ work
quantity, from the material's physical properties. No waste allowance — the
ML models learn real waste on top of this (adding it here would count it twice).

Source of truth for the formula. backend/ConstructIQ.API/Algorithms/
BaselineCalculator.cs mirrors it for display/alerts; both run the shared
cases in tests/fixtures/baseline_cases.json so they can't drift.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

# Backend enum MaterialCalculationType, stored as these ints.
CALCULATION_TYPES = ["UnitArea", "CoverageRate", "Volume", "Count", "Length"]

_WORK_UNITS = {
    "area":   {"sq.m", "sqm", "sq m", "sq. m", "sq.m.", "m2", "m²", "sq.m coverage", "square meter", "square meters"},
    "volume": {"cu.m", "cum", "cu m", "cu. m", "cu.m.", "m3", "m³", "cbm", "cubic meter", "cubic meters"},
    "length": {"l.m", "lm", "l.m.", "m", "meter", "meters", "linear meter", "linear meters", "lin.m"},
    "count":  {"pc", "pcs", "piece", "pieces", "set", "sets", "unit", "units", "ea", "each", "nos", "no."},
}
_REQUIRED_WORK_UNIT = {"UnitArea": "area", "CoverageRate": "area", "Volume": "volume", "Count": "count", "Length": "length"}

REASON_NO_PROPERTIES = "no properties"
REASON_UNIT_MISMATCH = "unit mismatch"
REASON_NEEDS_VOLUME  = "needs thickness/volume"
REASON_NO_QUANTITY   = "no quantity"


@dataclass
class BaselineResult:
    baseline_quantity: float | None = None   # exact, 4 dp — the ML reference
    purchase_quantity: int | None = None      # rounded UP to whole purchase units
    purchase_unit: str | None = None
    formula_text: str | None = None
    reason: str | None = None

    @property
    def available(self) -> bool:
        return self.baseline_quantity is not None


def work_unit_kind(unit: Any) -> str | None:
    """'area' | 'volume' | 'length' | 'count' | None (unrecognized)."""
    u = " ".join(str(unit or "").strip().lower().split())
    for kind, aliases in _WORK_UNITS.items():
        if u in aliases:
            return kind
    return None


_PURCHASE_UNIT_ALIASES = {
    "pc": "pc", "pcs": "pc", "piece": "pc", "pieces": "pc",
    "sht": "sheet", "sheet": "sheet", "sheets": "sheet",
    "gal": "gal", "gallon": "gal", "gallons": "gal",
    "bag": "bag", "bags": "bag", "box": "box", "boxes": "box",
    "set": "set", "sets": "set", "roll": "roll", "rolls": "roll",
    "pail": "pail", "pails": "pail", "can": "can", "cans": "can",
}


def purchase_unit_key(unit: Any) -> str:
    """Folds label variants of one purchase unit (sht/sheet, pcs/pc, …) so a
    row's purchase unit can be compared with the baseline's. Same as C#
    BaselineCalculator.PurchaseUnitKey."""
    u = str(unit or "").strip().lower()
    if u in _PURCHASE_UNIT_ALIASES:
        return _PURCHASE_UNIT_ALIASES[u]
    return {"area": "sq.m", "volume": "cu.m", "length": "l.m"}.get(work_unit_kind(u), u)


def calculation_type_name(value: Any) -> str | None:
    """Accepts the enum name or its stored int."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        i = int(value)
        return CALCULATION_TYPES[i] if 0 <= i < len(CALCULATION_TYPES) else None
    s = str(value).strip()
    if s.isdigit():
        return calculation_type_name(int(s))
    return next((t for t in CALCULATION_TYPES if t.lower() == s.lower()), None)


def fmt(x: float) -> str:
    """Up to 4 decimals, no trailing zeros — same as C# "0.####"."""
    s = f"{x:.4f}".rstrip("0").rstrip(".")
    return s if s not in ("", "-0") else "0"


def _num(material: dict, key: str) -> float | None:
    v = material.get(key)
    if v is None or v == "":
        return None
    v = float(v)
    return v if v > 0 else None


def compute(material: dict, boq_unit: Any, boq_quantity: Any) -> BaselineResult:
    """material keys: calculation_type, length_mm, width_mm, thickness_mm,
    pieces_per_package, coverage_per_unit, coverage_unit, unit_length_m,
    coats, purchase_unit, unit (the catalog unit; the fallback purchase unit)."""
    calc = calculation_type_name(material.get("calculation_type"))
    if calc is None:
        return BaselineResult(reason=REASON_NO_PROPERTIES)

    length_mm, width_mm = _num(material, "length_mm"), _num(material, "width_mm")
    per_package = _num(material, "pieces_per_package") or 1.0
    coverage = _num(material, "coverage_per_unit")
    unit_length = _num(material, "unit_length_m")
    coats = int(material.get("coats") or 1) or 1
    if (calc == "UnitArea" and (length_mm is None or width_mm is None)) \
            or (calc in ("CoverageRate", "Volume") and coverage is None) \
            or (calc == "Length" and unit_length is None):
        return BaselineResult(reason=REASON_NO_PROPERTIES)

    kind = work_unit_kind(boq_unit)
    required = _REQUIRED_WORK_UNIT[calc]
    if kind != required:
        if required == "volume" and kind == "area":
            return BaselineResult(reason=REASON_NEEDS_VOLUME)
        return BaselineResult(reason=REASON_UNIT_MISMATCH)

    if boq_quantity is None or boq_quantity == "" or float(boq_quantity) < 0:
        return BaselineResult(reason=REASON_NO_QUANTITY)
    qty = float(boq_quantity)
    unit = str(material.get("purchase_unit") or material.get("unit") or "").strip()

    if calc == "UnitArea":
        face = round(length_mm * width_mm / 1_000_000, 6)
        raw = qty / face / per_package
        piece = "pc" if per_package > 1 else unit
        formula = f"{fmt(qty)} m² ÷ {fmt(face)} m²/{piece}"
        if per_package > 1:
            formula += f" ÷ {fmt(per_package)} pc/{unit}"
    elif calc == "CoverageRate":
        raw = qty * coats / coverage
        formula = f"{fmt(qty)} m²" + (f" × {coats} coats" if coats > 1 else "") + f" ÷ {fmt(coverage)} m²/{unit}"
    elif calc == "Volume":
        raw = qty / coverage
        formula = f"{fmt(qty)} m³ ÷ {fmt(coverage)} m³/{unit}"
    elif calc == "Count":
        raw = qty / per_package
        formula = f"{fmt(qty)} pc" + (f" ÷ {fmt(per_package)} pc/{unit}" if per_package > 1 else "")
    else:  # Length
        raw = qty / unit_length
        formula = f"{fmt(qty)} m ÷ {fmt(unit_length)} m/{unit}"

    baseline = round(raw, 4)
    return BaselineResult(
        baseline_quantity=baseline,
        purchase_quantity=int(math.ceil(baseline - 1e-6)),
        purchase_unit=unit,
        formula_text=formula,
    )
