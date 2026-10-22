"""Generated BOQ: confirmed room measurements × chosen finish templates →
BOQ rows (work quantities in the BOQ unit), each with its engineering
baseline. Nothing is saved here — the backend shows a preview and saves
only what the user confirms.

Rows are aggregated per template row + material across the rooms that use
that finish (one "Floor tile 600×600" row for the whole plan, its source note
listing the rooms), so they line up with how a provided BOQ is written —
needed for the merge preview's same-material + work-item comparison.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.ml import baseline_engine

TEMPLATES_PATH = Path(__file__).resolve().parent.parent / "data" / "finish_templates.json"
DEFAULT_PRIMARY_SECTION = "Architectural Works"
BASES = {"floor_area", "ceiling_area", "wall_net_area", "wall_net_area_x2", "perimeter", "door_count", "window_count"}


@lru_cache(maxsize=1)
def load_templates() -> list[dict]:
    templates = json.loads(TEMPLATES_PATH.read_text(encoding="utf-8"))["templates"]
    for t in templates:
        for row in t["rows"]:
            if row["basis"] not in BASES:
                raise ValueError(f"Template {t['key']}: unknown basis {row['basis']}")
    return templates


def templates_by_key() -> dict[str, dict]:
    return {t["key"]: t for t in load_templates()}


def suggest_finishes(finish_notes: list[str]) -> dict[str, str]:
    """{surface: template key} pre-selected from the plan's finish notes."""
    out: dict[str, str] = {}
    for t in load_templates():
        if t["surface"] in out or not t.get("note_pattern"):
            continue
        if any(re.search(t["note_pattern"], n, re.I) for n in finish_notes):
            out[t["surface"]] = t["key"]
    return out


def match_material(options: list[list[str]], materials: list[dict], boq_unit: str) -> dict | None:
    """First option whose words all appear in a catalog name. Among several
    matches: one with physical properties, then one already in the BOQ unit
    or a purchase unit, then the shortest (most generic) name."""
    want_kind = baseline_engine.work_unit_kind(boq_unit)
    for words in options:
        hits = [m for m in materials if all(w.lower() in str(m.get("name", "")).lower() for w in words)]
        if hits:
            return min(hits, key=lambda m: (
                baseline_engine.calculation_type_name(m.get("calculation_type")) is None,
                baseline_engine.work_unit_kind(m.get("unit")) not in (want_kind, "count", None),
                len(str(m.get("name", ""))),
            ))
    return None


def _quantity(basis: str, room: dict, openings: dict[str, int]) -> float | None:
    area = float(room.get("floor_area_sqm") or 0)
    perimeter = float(room.get("perimeter_m") or 0)
    height = room.get("height_m")
    if basis in ("floor_area", "ceiling_area"):
        return area
    if basis == "perimeter":
        return perimeter
    if basis in ("wall_net_area", "wall_net_area_x2"):
        if not height:
            return None
        net = max(perimeter * float(height) - float(room.get("openings_sqm") or 0), 0.0)
        return net * (2 if basis == "wall_net_area_x2" else 1)
    if basis == "door_count":
        return float(openings.get("door", 0))
    if basis == "window_count":
        return float(openings.get("window", 0))
    return None


def _baseline_json(material: dict | None, boq_unit: str, quantity: float) -> dict:
    if material is None:
        return {"baseline_quantity": None, "purchase_quantity": None, "purchase_unit": None,
                "formula_text": None, "reason": "no material"}
    props = dict(material)
    props["unit"] = material.get("unit")
    r = baseline_engine.compute(props, boq_unit, quantity)
    return {"baseline_quantity": r.baseline_quantity, "purchase_quantity": r.purchase_quantity,
            "purchase_unit": r.purchase_unit, "formula_text": r.formula_text, "reason": r.reason}


def generate(measurements: list[dict], finishes: list[dict], materials: list[dict],
             openings: list[dict] | None = None, source: str | None = None,
             primary_section: str = DEFAULT_PRIMARY_SECTION, per_room_floor: bool = False) -> dict:
    """per_room_floor: the floor finish itself (each floor template's first
    row) becomes one row per room, its work item named after the room — the
    way a Material Plan lists flooring. Adhesive, grout, walls, ceilings and
    openings stay one row per work item."""
    templates = templates_by_key()
    warnings: list[str] = []
    finish_by_room = {f["room"]: f for f in finishes}
    opening_counts: dict[str, int] = {}
    for o in openings or []:
        opening_counts[o["type"]] = opening_counts.get(o["type"], 0) + int(o.get("count") or 0)

    rows: dict[tuple, dict] = {}

    def add(template: dict, row_index: int, room_name: str | None, quantity: float):
        spec = template["rows"][row_index]
        material = match_material(spec["match"], materials, spec["boq_unit"])
        per_room = per_room_floor and room_name and template["surface"] == "floor" and row_index == 0
        # Shared rows merge by work item + material across templates (one
        # "Floor Adhesive" row whether rooms got 600×600 or 300×300 tiles).
        key = ((template["key"], row_index, room_name) if per_room
               else (spec["sub_category"], material["id"] if material else spec["name"]))
        entry = rows.get(key)
        if entry is None:
            entry = rows[key] = {
                "material_id": material["id"] if material else None,
                "material_name": material["name"] if material else None,
                "specification": spec["name"],
                "boq_unit": spec["boq_unit"],
                "boq_quantity": 0.0,
                "primary_section": primary_section,
                "sub_category": room_name if per_room else spec["sub_category"],
                "basis": spec["basis"],
                "template_key": template["key"],
                "rooms": [],
                "_material": material,
            }
        entry["boq_quantity"] += quantity
        if room_name and room_name not in entry["rooms"]:
            entry["rooms"].append(room_name)

    for room in measurements:
        name = room.get("room") or "Room"
        choice = finish_by_room.get(name, {})
        for surface in ("floor", "wall", "ceiling"):
            key = choice.get(surface)
            if not key:
                continue
            template = templates.get(key)
            if template is None:
                warnings.append(f"Unknown finish template '{key}' for {name}.")
                continue
            for i, spec in enumerate(template["rows"]):
                q = _quantity(spec["basis"], room, opening_counts)
                if q is None:
                    warnings.append(f"No ceiling height for {name} — its {template['label']} wall rows were skipped.")
                    break
                if q > 0:
                    add(template, i, name, q)

    for kind, key in (("door", "doors"), ("window", "windows")):
        if opening_counts.get(kind) and key in templates:
            add(templates[key], 0, None, float(opening_counts[kind]))

    out = []
    where = f"From blueprint {source}" if source else "From blueprint"
    for entry in rows.values():
        material = entry.pop("_material")
        entry["boq_quantity"] = round(entry["boq_quantity"], 2)
        entry["source_note"] = f"{where} · {', '.join(entry['rooms'])}" if entry["rooms"] else where
        entry["baseline"] = _baseline_json(material, entry["boq_unit"], entry["boq_quantity"])
        if material is None:
            warnings.append(f"No catalog material matches \"{entry['specification']}\" — pick one in the preview.")
        out.append(entry)
    return {"rows": out, "warnings": list(dict.fromkeys(warnings))}
