"""Format-independent geometry for blueprint extraction: rooms from wall
lines, gross footprint, labels → rooms. Everything here is in METRES — the
PDF/DXF readers convert before calling in.

Rooms are found by a morphological close of the walls: widen every wall line
by half the largest opening to bridge (doorways, glazing gaps), take the
enclosed holes, and grow each hole back by the same amount. CAD walls almost
never form closed outlines on their own, so plain polygonizing finds nothing.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import shapely
from shapely import Point, Polygon
from shapely.ops import unary_union

MIN_ROOM_SQM = 1.0           # smaller enclosed holes are wall cavities/columns, not rooms
DEFAULT_GAPS_M = (0.6, 1.0)  # opening widths to bridge, tried in order


@dataclass
class Label:
    text: str
    x: float
    y: float


@dataclass
class Room:
    name: str
    polygon: Polygon
    labels: list[str] = field(default_factory=list)
    confidence: float = 0.5

    @property
    def area_sqm(self) -> float:
        return self.polygon.area

    @property
    def perimeter_m(self) -> float:
        return self.polygon.length


@dataclass
class RoomResult:
    rooms: list[Room]
    gross_sqm: float | None
    gap_m: float
    unplaced_labels: list[str]

    @property
    def labelled_rooms(self) -> int:
        return sum(1 for r in self.rooms if r.labels)


def _widened(segments: list[tuple[float, float, float, float]], half: float):
    """Every wall segment widened by `half` on each side, merged. Buffers
    segment by segment then cascade-unions — buffering one big
    MultiLineString of overlapping CAD strokes is orders of magnitude slower."""
    coords = np.array([[[x0, y0], [x1, y1]] for x0, y0, x1, y1 in segments if (x0, y0) != (x1, y1)])
    if len(coords) == 0:
        return Polygon()
    pieces = shapely.buffer(shapely.linestrings(coords), half, cap_style="square", join_style="mitre")
    return shapely.union_all(pieces)


def rooms_from_walls(segments: list[tuple[float, float, float, float]], labels: list[Label],
                     gap_m: float) -> RoomResult:
    """Closed rooms from wall segments (metres). Labels inside the same hole
    are merged into one room (an open-plan space); holes with no label are
    kept as "Unlabelled room n" at low confidence."""
    if not segments:
        return RoomResult([], None, gap_m, [l.text for l in labels])
    half = gap_m / 2
    closed = _widened(segments, half)

    holes: list[Polygon] = []
    for poly in getattr(closed, "geoms", [closed]):
        for ring in poly.interiors:
            hole = Polygon(ring).buffer(half, join_style="mitre")
            if hole.area >= MIN_ROOM_SQM:
                holes.append(hole)

    rooms: list[Room] = []
    placed: set[int] = set()
    for hole in sorted(holes, key=lambda h: h.area):
        inside = [i for i, l in enumerate(labels) if i not in placed and hole.contains(Point(l.x, l.y))]
        placed.update(inside)
        names = [labels[i].text for i in inside]
        confidence = 0.92 if len(names) == 1 else 0.78 if names else 0.5
        if gap_m > DEFAULT_GAPS_M[0]:
            confidence -= 0.05
        rooms.append(Room(" / ".join(names) if names else "", hole, names, round(confidence, 2)))

    unlabelled = [r for r in rooms if not r.labels]
    for n, room in enumerate(sorted(unlabelled, key=lambda r: -r.area_sqm), start=1):
        room.name = f"Unlabelled room {n}"

    # Gross footprint: the closed walls' outer outline, only the parts that
    # hold a room (title blocks, legends and neighbouring units excluded).
    room_union = unary_union([r.polygon for r in rooms]) if rooms else None
    clear_total = sum(r.area_sqm for r in rooms)

    def footprint_area(outlines) -> float | None:
        parts = [o for o in outlines if not o.is_empty and room_union is not None and o.intersects(room_union)]
        return unary_union(parts).area if parts else None

    # Walls drawn with both faces (CAD): shrink the closed walls back to the
    # real wall bodies, then fill their outer outline — follows the building's
    # real outline, notches included.
    shell = closed.buffer(-half, join_style="mitre")
    gross = footprint_area([Polygon(p.exterior) for p in getattr(shell, "geoms", [shell]) if not p.is_empty])
    if gross is None or gross < clear_total:
        # Single centre-line walls vanish when shrunk: fill first, then shrink.
        gross = footprint_area([Polygon(p.exterior).buffer(-half, join_style="mitre")
                                for p in getattr(closed, "geoms", [closed]) if not p.is_empty])

    return RoomResult(
        rooms=sorted(rooms, key=lambda r: (not r.labels, -r.area_sqm)),
        gross_sqm=gross,
        gap_m=gap_m,
        unplaced_labels=[l.text for i, l in enumerate(labels) if i not in placed],
    )


def best_rooms(candidate_wall_sets: list[list[tuple[float, float, float, float]]], labels: list[Label],
               plan_total_sqm: float | None, gaps=DEFAULT_GAPS_M) -> RoomResult | None:
    """Tries each candidate wall set × gap and keeps the one that puts the
    labels into the most separate rooms (a set that swallows everything into
    one hole places every label but separates nothing); ties go to more
    labels placed, then the gross area closest to the plan's own stated
    total, then fewer unlabelled rooms."""
    best, best_score = None, None
    for walls in candidate_wall_sets:
        for gap in gaps:
            result = rooms_from_walls(walls, labels, gap)
            placed = len(labels) - len(result.unplaced_labels)
            total_error = (abs((result.gross_sqm or 0) - plan_total_sqm) / plan_total_sqm
                           if plan_total_sqm and result.gross_sqm else math.inf)
            unlabelled = len(result.rooms) - result.labelled_rooms
            score = (result.labelled_rooms, placed, -total_error, -unlabelled)
            if best_score is None or score > best_score:
                best, best_score = result, score
    return best
