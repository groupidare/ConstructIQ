"""Generated BOQ: confirmed room measurements × finish templates → BOQ rows
(work quantities in the BOQ unit), each with its engineering baseline.
Nothing is saved here — the backend shows a preview and saves only what the
user confirms.

Each room's floor, wall and ceiling finish is decided here (resolve_finishes),
first source that has one:
  1. picked by the user;
  2. the drawing — the room's own note on the reflected ceiling plan, else a
     finish note anywhere on the plan set (floor plan, finishing plans,
     elevations): the template most of the notes name;
  3. the company's completed historical projects — the finish most of them
     used for that surface (finish_history);
  4. a standard default.
Every row says which one it came from (its `source`), with the note's words
and page, so it can be checked against the drawing.

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
from app.services import finish_history

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


def match_material(options: list[list[str]], materials: list[dict], boq_unit: str,
                   used: dict[int, int] | None = None) -> dict | None:
    """First option whose words all appear in a catalog name. Among several
    matches: the one most past projects used (`used`: material id → projects),
    then one with physical properties, then one already in the BOQ unit or a
    purchase unit, then the shortest (most generic) name."""
    want_kind = baseline_engine.work_unit_kind(boq_unit)
    used = used or {}
    for words in options:
        hits = [m for m in materials if all(w.lower() in str(m.get("name", "")).lower() for w in words)]
        if hits:
            return min(hits, key=lambda m: (
                -used.get(m.get("id"), 0),
                baseline_engine.calculation_type_name(m.get("calculation_type")) is None,
                baseline_engine.work_unit_kind(m.get("unit")) not in (want_kind, "count", None),
                len(str(m.get("name", ""))),
            ))
    return None


WET_ROOM = re.compile(r"\b(c\.?r\.?|toilet|t\s*&\s*b|bath|wc|lavatory|kitchen|laundry|powder|shower|balcony|terrace|lanai|porch)\b", re.I)
DEFAULTS = {"floor": "floor_tile_600", "wet_floor": "floor_tile_300", "wall": "painted_plaster", "ceiling": "fiber_cement_ceiling"}
WET_FLOORS = {"floor_tile_300", "vinyl_floor"}


def is_wet_room(name: str) -> bool:
    """Every label of the room is a wet one. An open-plan "Kitchen / Dining /
    Living" is finished as its living space; a kitchen on its own is wet. A
    word that only qualifies the next ("Common / Toilet") doesn't count."""
    parts = [p for p in re.split(r"/", name) if p.strip() and not re.fullmatch(r"\s*(.*·\s*)?(common|master)\s*", p, re.I)]
    return bool(parts) and all(WET_ROOM.search(p) for p in parts)


_SMALL_WORDS = {"in", "of", "on", "at", "the", "and", "with", "to", "for", "c/w", "w/", "or", "a"}


def _note_template(text: str, templates: list[dict]) -> str | None:
    """The template a note names — the first that matches, in file order."""
    for t in templates:
        try:
            if t.get("note_pattern") and re.search(t["note_pattern"], text, re.I):
                return t["key"]
        except re.error:
            continue
    return None


def _by_template(notes: list[dict], templates: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for n in notes:
        key = _note_template(n.get("text") or "", templates)
        if key:
            out.setdefault(key, []).append(n)
    return out


def _most_noted(noted: dict[str, list[dict]], prefer: set[str] | None = None, avoid: set[str] | None = None) -> str | None:
    """The template most notes name (ties: the one noted first)."""
    keys = [k for k in noted if (prefer is None or k in prefer) and (avoid is None or k not in avoid)]
    return max(keys, key=lambda k: len(noted[k]), default=None)


def spec_from_note(text: str) -> str:
    """A drawing note as a material specification: its tag ("L-01") and
    heights ("CH=2600mm", "SLAB SOFFIT:H=4745mm") dropped, in title case with
    abbreviations (MDF, RAL) and sizes (600x600mm) kept."""
    t = re.sub(r"^[A-Z]{1,3}-\d+[A-Z]?\s+", "", text.strip())
    t = re.sub(r"(SLAB\s+SOFFIT\s*:?\s*)?\bH\s*[=:]\s*\d{3,5}\s*MM\b|\bC\.?\s?H\.?\s*[=:]\s*\d{3,5}\s*MM\b", "", t, flags=re.I)
    words: list[str] = []
    for w in " ".join(t.split()).strip(" ,;:-").split(" "):
        low = w.lower()
        if any(c.isdigit() for c in w):
            words.append(low)
        elif low in _SMALL_WORDS and words:
            words.append(low)
        elif (core := w.strip("()[],;:\"'")).isalpha() and len(core) <= 3 and core.isupper():
            words.append(w)
        else:
            # Capitalise the first letter, past any opening bracket or quote.
            i = next((k for k, c in enumerate(w) if c.isalpha()), 0)
            words.append(w[:i] + w[i:i + 1].upper() + w[i + 1:].lower())
    return " ".join(words)


def _source(surface: str, kind: str, notes: list[dict] | None = None, reason: str | None = None,
            projects: int | None = None, of: int | None = None) -> dict:
    return {"surface": surface, "kind": kind,
            "notes": [{"text": n.get("text"), "page": n.get("page"), "box": n.get("box")} for n in (notes or [])][:3],
            "reason": reason, "projects": projects, "of": of}


def resolve_finishes(measurements: list[dict], finishes: list[dict], plan_notes: list[dict],
                     templates: list[dict], history: "finish_history.History") -> dict[str, dict[str, tuple[str, dict]]]:
    """room → surface → (template key, source). See the module docstring."""
    by_surface = {s: [t for t in templates if t["surface"] == s] for s in ("floor", "wall", "ceiling")}
    noted = {s: _by_template(plan_notes, ts) for s, ts in by_surface.items()}
    chosen = {f["room"]: f for f in finishes}
    labels = {t["key"]: t["label"] for t in templates}

    def from_history(surface: str, why: str, allowed: set[str] | None = None) -> tuple[str, dict] | None:
        best = history.best_finish(surface, allowed)
        if not best:
            return None
        key, n, of = best
        return key, _source(surface, "history", projects=n, of=of,
                            reason=f"{why} — your past projects used {labels.get(key, key)} ({n} of {of} project{'s' if of != 1 else ''})")

    def fallback(surface: str, why: str, allowed: set[str] | None = None, default: str | None = None,
                 default_reason: str = "standard finish used") -> tuple[str, dict]:
        return from_history(surface, why, allowed) or (default or DEFAULTS[surface], _source(
            surface, "default", reason=f"{why} — {default_reason}, please check"))

    out: dict[str, dict[str, tuple[str, dict]]] = {}
    for room in measurements:
        name = room.get("room") or "Room"
        mine = chosen.get(name, {})
        wet = is_wet_room(name)
        picks: dict[str, tuple[str, dict]] = {}
        for surface in ("floor", "wall", "ceiling"):
            if mine.get(surface):
                picks[surface] = (mine[surface], _source(surface, "chosen", reason="Picked by you"))
                continue
            if surface == "ceiling":
                # The room's own notes on the reflected ceiling plan come first;
                # a ceiling plan with nothing for the room says nothing about it.
                own = _by_template(room.get("ceiling_notes") or [], by_surface["ceiling"])
                if own:
                    key = _most_noted(own)
                    picks[surface] = (key, _source(surface, "drawing", own[key], "On the reflected ceiling plan, in this room"))
                    continue
                if room.get("has_ceiling_plan"):
                    picks[surface] = fallback(surface, "The ceiling plan has no finish note for this room")
                    continue
            if surface == "floor":
                # A wet room takes only a wet-area floor note — a plan's
                # general "600x600 floor tiles" isn't the toilet's.
                key = (_most_noted(noted["floor"], prefer=WET_FLOORS) if wet
                       else _most_noted(noted["floor"], avoid={"floor_tile_300"}) or _most_noted(noted["floor"]))
            else:
                key = _most_noted(noted[surface])
            if key:
                # Notes across the plan set: the plainest first — it names the row.
                notes = sorted(noted[surface][key], key=lambda n: len(n.get("text") or ""))
                picks[surface] = (key, _source(surface, "drawing", notes, "Finish note on the plan"))
            elif surface == "floor" and wet:
                picks[surface] = fallback(surface, "Not on the drawing", WET_FLOORS, DEFAULTS["wet_floor"],
                                          "wet room, non-slip 300×300 tiles used")
            else:
                picks[surface] = fallback(surface, "Not on the drawing")
        out[name] = picks
    return out


DEFAULT_OPENING_M = {"door": (0.9, 2.1), "window": (1.2, 1.2)}


def _opening_shares(measurements: list[dict], openings: list[dict] | None) -> dict[str, float]:
    """room → sq.m of the plan's doors and windows to take off its walls. Which
    room an opening is in isn't known, so each room takes its share of the total
    by wall area. A room given its own openings_sqm keeps that."""
    total = 0.0
    for o in openings or []:
        width, height = DEFAULT_OPENING_M.get(o.get("type"), (0.0, 0.0))
        total += int(o.get("count") or 0) * float(o.get("width_m") or width) * float(o.get("height_m") or height)
    walls = {(r.get("room") or "Room"): _gross_wall(r) for r in measurements if not r.get("openings_sqm")}
    all_walls = sum(walls.values())
    return {name: total * area / all_walls for name, area in walls.items()} if total > 0 and all_walls > 0 else {}


def _gross_wall(room: dict) -> float:
    """Wall area before openings: the perimeter less any glass, × the height."""
    perimeter = float(room.get("perimeter_m") or 0) - float(room.get("glass_length_m") or 0)
    return max(perimeter, 0.0) * float(room.get("height_m") or 0)


def _wall_note(room: dict, opening_share: float) -> str | None:
    """What was taken into account for a room's wall area, for its rows' hover text."""
    parts = []
    if room.get("glass_length_m"):
        parts.append(f"{float(room['glass_length_m']):g} m of glass wall left out")
    if room.get("height_note"):
        parts.append(room["height_note"])
    if opening_share > 0:
        parts.append(f"{opening_share:.2f} sq.m of doors and windows subtracted")
    return "; ".join(parts) or None


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
        net = max(_gross_wall(room) - float(room.get("openings_sqm") or 0), 0.0)
        return net * (2 if basis == "wall_net_area_x2" else 1)
    if basis == "door_count":
        return float(openings.get("door", 0))
    if basis == "window_count":
        return float(openings.get("window", 0))
    return None


_WEAKEST = ["default", "history", "chosen", "drawing"]


def _row_source(sources: list[tuple[str | None, dict]], material: dict | None, used: dict[int, int]) -> dict:
    """One row's source across the rooms it covers: the weakest of them (a
    row partly guessed is a guess), with each room's own source listed."""
    kind = min((s["kind"] for _, s in sources), key=_WEAKEST.index)
    notes, seen = [], set()
    for _, s in sources:
        for n in s["notes"]:
            if (n["text"], n["page"]) not in seen:
                seen.add((n["text"], n["page"]))
                notes.append(n)
    first = next(s for _, s in sources if s["kind"] == kind)
    n = used.get(material["id"], 0) if material else 0
    return {"kind": kind, "surface": first["surface"], "reason": first["reason"], "notes": notes[:4],
            "projects": first["projects"], "of": first["of"],
            "rooms": [{"room": room, "kind": s["kind"], "reason": s["reason"], "template": s["template"], "wall_note": s.get("wall_note")}
                      for room, s in sources if room],
            "template": first["template"],
            "material_reason": f"Catalog material used in {n} past project{'s' if n != 1 else ''}" if n else None}


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
             primary_section: str = DEFAULT_PRIMARY_SECTION, per_room_floor: bool = False,
             plan_notes: list[dict] | None = None, history: "finish_history.History | None" = None) -> dict:
    """per_room_floor: the floor finish itself (each floor template's first
    row) becomes one row per room, its work item named after the room — the
    way a Material Plan lists flooring. Adhesive, grout, walls, ceilings and
    openings stay one row per work item. A room's surface with no finish in
    `finishes` is decided by resolve_finishes."""
    templates = templates_by_key()
    if history is None:
        history = finish_history.load(load_templates())
    warnings: list[str] = []
    resolved = resolve_finishes(measurements, finishes, plan_notes or [], load_templates(), history)
    opening_counts: dict[str, int] = {}
    for o in openings or []:
        opening_counts[o["type"]] = opening_counts.get(o["type"], 0) + int(o.get("count") or 0)

    rows: dict[tuple, dict] = {}

    def add(template: dict, row_index: int, room_name: str | None, quantity: float, why: dict):
        spec = template["rows"][row_index]
        material = match_material(spec["match"], materials, spec["boq_unit"], history.materials)
        per_room = per_room_floor and room_name and template["surface"] == "floor" and row_index == 0
        # Shared rows merge by work item + material across templates (one
        # "Floor Adhesive" row whether rooms got 600×600 or 300×300 tiles).
        # The main material of a finish read off the drawing is named in the
        # drawing's own words — and kept apart from the same material used by
        # another finish (the painted slab's paint vs a board ceiling's paint).
        worded = row_index == 0 and why["kind"] == "drawing" and bool(why["notes"])
        key = ((template["key"], row_index, room_name) if per_room
               else (spec["sub_category"], material["id"] if material else spec["name"],
                     template["key"] if worded else None))
        entry = rows.get(key)
        if entry is None:
            entry = rows[key] = {
                "material_id": material["id"] if material else None,
                "material_name": material["name"] if material else None,
                "specification": spec_from_note(why["notes"][0]["text"]) if worded else spec["name"],
                "specification_from_drawing": worded,
                "boq_unit": spec["boq_unit"],
                "boq_quantity": 0.0,
                "primary_section": primary_section,
                "sub_category": room_name if per_room else spec["sub_category"],
                "basis": spec["basis"],
                "template_key": template["key"],
                "rooms": [],
                "_material": material,
                "_sources": [],
            }
        entry["boq_quantity"] += quantity
        if room_name and room_name not in entry["rooms"]:
            entry["rooms"].append(room_name)
        entry["_sources"].append((room_name, {**why, "template": template["key"]}))

    shares = _opening_shares(measurements, openings)
    for room in measurements:
        name = room.get("room") or "Room"
        share = shares.get(name, 0.0)
        if share:
            room = {**room, "openings_sqm": share}
        for surface in ("floor", "wall", "ceiling"):
            key, why = resolved[name][surface]
            if surface == "wall":
                why = {**why, "wall_note": _wall_note(room, share)}
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
                    add(template, i, name, q, why)

    for kind, key in (("door", "doors"), ("window", "windows")):
        if opening_counts.get(kind) and key in templates:
            add(templates[key], 0, None, float(opening_counts[kind]),
                _source("openings", "drawing", reason=f"{kind.title()} count from the plan, as checked in the wizard"))

    out = []
    where = f"From blueprint {source}" if source else "From blueprint"
    for entry in rows.values():
        material = entry.pop("_material")
        entry["source"] = _row_source(entry.pop("_sources"), material, history.materials)
        entry["boq_quantity"] = round(entry["boq_quantity"], 2)
        entry["source_note"] = f"{where} · {', '.join(entry['rooms'])}" if entry["rooms"] else where
        entry["baseline"] = _baseline_json(material, entry["boq_unit"], entry["boq_quantity"])
        if material is None:
            warnings.append(f"No catalog material matches \"{entry['specification']}\" — pick one in the preview.")
        out.append(entry)
    return {"rows": out, "warnings": list(dict.fromkeys(warnings))}
