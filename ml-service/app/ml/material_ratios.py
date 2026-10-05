import json
from pathlib import Path
from statistics import median
from typing import Any

from app.ml import r2_storage

# Material-specific BOQ-quantity → purchase-unit conversion, learned from
# completed projects. The models predict ACTUAL usage in the purchase unit
# (pcs/bag/box/...) from the BOQ quantity (sq.m/l.m/...), but nothing else in
# FEATURE_COLS says WHICH material a row is — and the conversion is almost
# entirely material-specific (CHB ≈ 18 pcs per sq.m of wall, floor tile ≈
# 0.7 box per sq.m). So each (material_id, normalized purchase unit) gets the
# MEDIAN of actual ÷ boq_quantity across its training rows (median, not mean,
# so one typo'd row can't drag a whole material's ratio), with the global
# median over every training row as the fallback for a material/unit never
# seen before. The ratio itself and boq_quantity × ratio are both features
# (see feature_engineering.FEATURE_COLS).
#
# The table is persisted next to the models (same local dir + R2 mechanism),
# so forecasting looks up the exact values the models were trained against,
# and it also answers "what unit is this prediction in" for a row with no
# purchase unit of its own (that material's most common training unit).
TABLE_PATH = Path("trained_models/material_ratios.json")
R2_KEY = "models/material_ratios.json"

# Used only when there's no training data at all (never trained, or an empty
# fold) — makes ratio_estimate == boq_quantity, i.e. exactly the old naive
# "forecast = BOQ quantity" fallback rather than an invented conversion.
_NO_DATA_RATIO = 1.0


def normalize_unit(unit: Any) -> str:
    """Same label folding as the backend's CompletedProjectDemandRules.
    NormalizeUnit — trim + case, plus the pc/pcs/piece/pieces variants.
    Never a physical unit conversion."""
    lower = str(unit or "").strip().lower()
    return "pc" if lower in ("pcs", "piece", "pieces") else lower


def _key(material_id: Any, unit: str) -> str:
    # JSON object keys must be strings.
    return f"{int(material_id)}|{unit}"


def empty_table() -> dict:
    return {"ratios": {}, "default_unit": {}, "global_ratio": _NO_DATA_RATIO}


def fit(records: list[dict], targets: list[float]) -> dict:
    """Ratio table from training rows (records carry material_id,
    purchase_unit and boq_quantity; targets are the actual quantities used,
    in that purchase unit). Rows with no BOQ quantity can't give a ratio."""
    ratios_by_key: dict[str, list[float]] = {}
    unit_counts: dict[str, dict[str, int]] = {}
    unit_labels: dict[str, dict[str, str]] = {}
    all_ratios: list[float] = []

    for record, target in zip(records, targets):
        unit = normalize_unit(record.get("purchase_unit"))
        if not unit:
            continue
        material = str(int(record["material_id"]))
        unit_counts.setdefault(material, {}).setdefault(unit, 0)
        unit_counts[material][unit] += 1
        unit_labels.setdefault(material, {}).setdefault(unit, str(record.get("purchase_unit")).strip())

        boq = float(record.get("boq_quantity") or 0)
        if boq <= 0:
            continue
        ratio = float(target) / boq
        ratios_by_key.setdefault(_key(material, unit), []).append(ratio)
        all_ratios.append(ratio)

    default_unit = {
        material: unit_labels[material][max(counts, key=lambda u: (counts[u], u))]
        for material, counts in unit_counts.items()
    }
    return {
        "ratios":       {k: median(v) for k, v in ratios_by_key.items()},
        "default_unit": default_unit,
        "global_ratio": median(all_ratios) if all_ratios else _NO_DATA_RATIO,
    }


def lookup(table: dict, record: dict) -> float:
    """The row's own purchase unit when it has one, else the material's most
    common training unit; falls back to the global median ratio when that
    (material, unit) pair was never seen in training."""
    material = str(int(record["material_id"]))
    unit = normalize_unit(record.get("purchase_unit")) or normalize_unit(table["default_unit"].get(material))
    return float(table["ratios"].get(_key(material, unit), table["global_ratio"]))


def attach(records: list[dict], table: dict) -> None:
    """Sets record["material_ratio"] (read by build_feature_vector) in place."""
    for record in records:
        record["material_ratio"] = lookup(table, record)


def attach_out_of_project(records: list[dict], targets: list[float]) -> None:
    """Training-time version of attach(): each row's ratio comes from a table
    fitted WITHOUT its own project's rows. Using the full table instead would
    leak the target straight into the feature — a material seen on only one
    row would get ratio == actual ÷ boq_quantity exactly, so ratio_estimate
    would BE the target, and the models would learn to trust that feature far
    more than it deserves on a genuinely new project (which is never in the
    table). Out-of-project ratios are what a new project actually gets."""
    project_ids = {record["project_id"] for record in records}
    for project_id in project_ids:
        others = [(r, t) for r, t in zip(records, targets) if r["project_id"] != project_id]
        table = fit([r for r, _ in others], [t for _, t in others])
        attach([r for r in records if r["project_id"] == project_id], table)


def ratio_estimates(records: list[dict]) -> list[float]:
    """boq_quantity × material_ratio — the naive, model-free prediction (used
    when no trained model is available, or a fold is too small to fit one)."""
    return [float(r.get("boq_quantity") or 0) * float(r.get("material_ratio", _NO_DATA_RATIO)) for r in records]


def has_purchase_unit(table: dict, record: dict) -> bool:
    """False when resolve_output_unit had to fall back to the BOQ unit —
    the row has no purchase unit and its material never appeared in
    training, so there's no known purchase unit for the prediction to be in."""
    return bool(str(record.get("purchase_unit") or "").strip()) \
        or bool(table["default_unit"].get(str(int(record["material_id"]))))


def resolve_output_unit(table: dict, record: dict) -> str:
    """The unit a row's prediction is in: its own purchase unit if set, else
    the material's most common purchase unit among training rows, else the
    row's BOQ unit (no conversion known — the prediction is then just a
    ratio-scaled BOQ quantity)."""
    purchase_unit = str(record.get("purchase_unit") or "").strip()
    if purchase_unit:
        return purchase_unit
    default = table["default_unit"].get(str(int(record["material_id"])))
    if default:
        return default
    return str(record.get("boq_unit") or "")


def save(table: dict) -> None:
    TABLE_PATH.parent.mkdir(parents=True, exist_ok=True)
    TABLE_PATH.write_text(json.dumps(table, indent=2, sort_keys=True))
    r2_storage.upload_file(TABLE_PATH, R2_KEY)


def load() -> dict:
    """The table saved by the last training run (local copy, else R2 — same
    cold-start self-restore as the models). Never trained → empty table, so
    every ratio is 1.0 and predictions degrade to the old BOQ-quantity naive
    forecast instead of failing."""
    if not TABLE_PATH.exists() and not r2_storage.download_file(R2_KEY, TABLE_PATH):
        return empty_table()
    return json.loads(TABLE_PATH.read_text())
