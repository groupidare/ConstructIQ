"""Suggest finish templates from historical BOQs, for an Admin to review.

Groups every completed historical project's BOQ rows by work item (Sub
Primary Section) and lists the materials that show up in that work item on
at least --min-share of the projects that have it, with their usual BOQ
unit. READ-ONLY: it prints JSON in the finish_templates.json row format
(match keywords from the material name) and never edits the templates file —
copy what makes sense into app/data/finish_templates.json by hand.

Usage (from ml-service/, with DATABASE_URL set as for the service):
    python -m app.scripts.build_templates_from_history [--min-projects 2] [--min-share 0.5]
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict

from sqlalchemy import text

from app.services.forecasting_service import get_engine

_SQL = text("""
    SELECT p.Id AS project_id, COALESCE(NULLIF(TRIM(bi.SubCategory), ''), TRIM(bi.PrimarySection)) AS work_item,
           m.Id AS material_id, m.Name AS material_name, COALESCE(NULLIF(bi.Unit, ''), m.Unit) AS boq_unit
    FROM BOQItems bi
    JOIN Materials m ON m.Id = bi.MaterialId
    JOIN Projects p ON p.Id = bi.ProjectId AND p.IsHistorical = 1 AND p.Status = 3
""")

_STOP = {"and", "with", "for", "the", "of", "on", "in", "x", "mm", "thick", "class", "a"}


def _keywords(name: str) -> list[str]:
    words = [w for w in re.findall(r"[a-z]+", name.lower()) if w not in _STOP and len(w) > 2]
    return words[:3]


def suggest(rows: list[dict], min_projects: int, min_share: float) -> list[dict]:
    projects_by_item: dict[str, set] = defaultdict(set)
    material_projects: dict[tuple[str, int], set] = defaultdict(set)
    names: dict[int, str] = {}
    units: dict[tuple[str, int], Counter] = defaultdict(Counter)
    for r in rows:
        item = (r["work_item"] or "").strip()
        if not item:
            continue
        projects_by_item[item].add(r["project_id"])
        material_projects[(item, r["material_id"])].add(r["project_id"])
        names[r["material_id"]] = r["material_name"]
        units[(item, r["material_id"])][str(r["boq_unit"] or "").strip()] += 1

    out = []
    for item, projects in sorted(projects_by_item.items()):
        if len(projects) < min_projects:
            continue
        rows_out = []
        for (it, material_id), used_in in material_projects.items():
            share = len(used_in) / len(projects)
            if it != item or share < min_share:
                continue
            rows_out.append({
                "name": names[material_id],
                "match": [_keywords(names[material_id])],
                "boq_unit": units[(it, material_id)].most_common(1)[0][0],
                "basis": "TODO: floor_area | ceiling_area | wall_net_area | wall_net_area_x2 | perimeter | door_count | window_count",
                "sub_category": item,
                "_used_in_projects": f"{len(used_in)} of {len(projects)}",
            })
        if rows_out:
            out.append({"key": re.sub(r"[^a-z0-9]+", "_", item.lower()).strip("_"), "surface": "TODO", "label": item,
                        "note_pattern": None, "rows": sorted(rows_out, key=lambda r: r["name"])})
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--min-projects", type=int, default=2)
    parser.add_argument("--min-share", type=float, default=0.5)
    args = parser.parse_args()
    with get_engine().connect() as conn:
        rows = [dict(r) for r in conn.execute(_SQL).mappings().all()]
    print(json.dumps({"suggested_templates": suggest(rows, args.min_projects, args.min_share)}, indent=2))


if __name__ == "__main__":
    main()
