"""What the company's completed historical projects used — for a blueprint
BOQ where the drawing is silent.

Two answers, both counted in projects (not rows, so one big project doesn't
outvote the rest):
  * finishes: per surface (floor / wall / ceiling), how many projects used
    each finish template — a project uses a template when one of its BOQ rows
    for that surface is the template's main material (its first row);
  * materials: per catalog material, how many projects used it — the
    tie-break when several catalog materials fit a template row.

Read-only, cached for a few minutes. Without a database (tests, a local run
with no DB) it answers with nothing and the generator falls back to its
defaults.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

CACHE_SECONDS = 600

# A historical row's surface, from its work item and material.
_SURFACE = [
    ("ceiling", re.compile(r"ceil|soffit", re.I)),
    ("wall", re.compile(r"\bwall|partition|paint|skim|plaster|primer", re.I)),
    ("floor", re.compile(r"floor|til(e|ing)|vinyl|adhesive|grout|granite|marble", re.I)),
]
# Main rows that are only paint: a project with a board or tile of its own for
# the surface used that, not "just paint".
_GENERIC_MAIN = {"Paint"}


@dataclass
class History:
    finishes: dict[str, dict[str, int]] = field(default_factory=dict)  # surface → template key → projects
    projects: dict[str, int] = field(default_factory=dict)              # surface → projects with any template of it
    materials: dict[int, int] = field(default_factory=dict)             # material id → projects

    def best_finish(self, surface: str, allowed: set[str] | None = None) -> tuple[str, int, int] | None:
        """(template key, projects using it, projects with that surface), the most used one."""
        counts = {k: n for k, n in self.finishes.get(surface, {}).items() if allowed is None or k in allowed}
        if not counts:
            return None
        key = max(counts, key=lambda k: counts[k])
        return key, counts[key], self.projects.get(surface, 0)


_EMPTY = History()
_cache: tuple[float, History] | None = None
_lock = threading.Lock()


def _surface(text: str) -> str | None:
    return next((s for s, pattern in _SURFACE if pattern.search(text)), None)


def _matches(options: list[list[str]], name: str) -> bool:
    name = name.lower()
    return any(all(w.lower() in name for w in words) for words in options)


def build(rows: list[dict], templates: list[dict]) -> History:
    """History from historical BOQ rows: {project_id, work_item, material_id, material_name, specification}."""
    by_surface = defaultdict(list)
    for t in templates:
        if t["surface"] in ("floor", "wall", "ceiling") and t["rows"]:
            by_surface[t["surface"]].append(t)

    used: dict[tuple[int, str], set[str]] = defaultdict(set)  # (project, surface) → templates
    material_projects: dict[int, set[int]] = defaultdict(set)
    for r in rows:
        if r.get("material_id") is not None:
            material_projects[int(r["material_id"])].add(r["project_id"])
        name = f"{r.get('material_name') or ''} {r.get('specification') or ''}"
        surface = _surface(f"{r.get('work_item') or ''} {name}")
        if surface is None:
            continue
        for t in by_surface[surface]:
            if _matches(t["rows"][0]["match"], name):
                used[(r["project_id"], surface)].add(t["key"])

    names = {t["key"]: t["rows"][0]["name"] for ts in by_surface.values() for t in ts}
    finishes: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    projects: dict[str, int] = defaultdict(int)
    for (_, surface), keys in used.items():
        specific = {k for k in keys if names[k] not in _GENERIC_MAIN}
        for k in specific or keys:
            finishes[surface][k] += 1
        projects[surface] += 1
    return History({s: dict(c) for s, c in finishes.items()}, dict(projects),
                   {m: len(p) for m, p in material_projects.items()})


_SQL = """
    SELECT p.Id AS project_id, COALESCE(NULLIF(TRIM(bi.SubCategory), ''), TRIM(bi.PrimarySection)) AS work_item,
           m.Id AS material_id, m.Name AS material_name, bi.Specification AS specification
    FROM BOQItems bi
    JOIN Materials m ON m.Id = bi.MaterialId
    JOIN Projects p ON p.Id = bi.ProjectId AND p.IsHistorical = 1 AND p.Status = 3
"""


def load(templates: list[dict]) -> History:
    """The cached history; nothing when the database can't be read."""
    global _cache
    with _lock:
        if _cache and time.monotonic() - _cache[0] < CACHE_SECONDS:
            return _cache[1]
        try:
            from sqlalchemy import text
            from app.services.forecasting_service import get_engine
            with get_engine().connect() as conn:
                rows = [dict(r._mapping) for r in conn.execute(text(_SQL))]
            history = build(rows, templates)
        except Exception as e:  # no database here — the defaults stand in
            logger.warning("Historical finishes unavailable: %s", e)
            history = _EMPTY
        _cache = (time.monotonic(), history)
        return history
