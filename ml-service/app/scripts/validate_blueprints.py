"""Accuracy table for blueprint extraction (Phase 7 validation).

For each CAD PDF/DXF: the drawing chosen, the plan's own stated total vs the
traced gross footprint (area error), clear room area, rooms labelled/traced,
ceiling heights found, and time taken. Optionally checks traced room areas
against expected values. Baseline vs AI vs actual purchase quantities are
reported by training itself (model status → "Model quality").

Usage (from ml-service/):
    python -m app.scripts.validate_blueprints plan1.pdf plan2.dxf [--expected expected.json]

expected.json: {"plan1.pdf": {"rooms": {"OFFICE": 20.0}, "drawing_id": "A-1:A"}}
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from app.services.blueprint_parser_service import parse_blueprint


def _row(path: Path, expected: dict) -> dict:
    t = time.time()
    r = parse_blueprint(str(path), path.name, drawing_id=expected.get("drawing_id"))
    seconds = time.time() - t
    check = r.get("schedule_check") or {}
    rooms = r.get("rooms", [])
    title = next((d["title"] for s in r.get("sheets", []) for d in s["drawings"] if d["id"] == r.get("selected_drawing")), "—")
    room_errors = []
    for name, area in (expected.get("rooms") or {}).items():
        got = next((x["floor_area_sqm"] for x in rooms if x["name"] == name), None)
        room_errors.append(f"{name}: {'missing' if got is None else f'{(got - area) / area * 100:+.1f}%'}")
    return {
        "file": path.name, "drawing": f"{r.get('selected_drawing')} {title}",
        "plan_total": check.get("plan_total_sqm"), "traced_gross": check.get("extracted_total_sqm"),
        "error_pct": check.get("difference_pct"), "clear_total": check.get("clear_total_sqm"),
        "rooms": f"{sum(1 for x in rooms if x['labels'])}/{len(rooms)}",
        "heights": ", ".join(str(h) for h in r.get("ceiling_heights_m", [])) or "—",
        "room_check": "; ".join(room_errors) or "—",
        "seconds": round(seconds, 1), "errors": "; ".join(r.get("errors", [])) or "—",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--expected", type=Path)
    args = parser.parse_args()
    expected = json.loads(args.expected.read_text()) if args.expected else {}

    rows = [_row(f, expected.get(f.name, {})) for f in args.files]
    cols = ["file", "drawing", "plan_total", "traced_gross", "error_pct", "clear_total", "rooms", "heights", "room_check", "seconds", "errors"]
    print("| " + " | ".join(cols) + " |")
    print("|" + "---|" * len(cols))
    for row in rows:
        print("| " + " | ".join("—" if row[c] is None else str(row[c]) for c in cols) + " |")


if __name__ == "__main__":
    main()
