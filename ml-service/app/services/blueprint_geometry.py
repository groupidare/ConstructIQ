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
SPLIT_GAPS_M = (0.8, 1.0)    # wider bridges tried on a room holding several labels
# Growing a hole back with sharp mitres turns every acute corner of a text
# stroke or fixture into a long spike; 2 keeps right-angle corners exact.
MITRE_LIMIT = 2.0


@dataclass
class Label:
    text: str
    x: float
    y: float
    # A minor label is smaller text that names a room only because it reads
    # as a room word ("TOILET" under the room-name size) — see _labels_from.
    minor: bool = False


@dataclass
class Room:
    name: str
    polygon: Polygon
    labels: list[str] = field(default_factory=list)
    confidence: float = 0.5
    label_ids: list[int] = field(default_factory=list)

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
    pieces = shapely.buffer(shapely.linestrings(coords), half, cap_style="square", join_style="mitre",
                            mitre_limit=MITRE_LIMIT)
    return shapely.union_all(pieces)


def _room(polygon: Polygon, label_ids: list[int], labels: list[Label], gap_m: float) -> Room:
    names = [labels[i].text for i in label_ids]
    confidence = 0.92 if len(names) == 1 else 0.78 if names else 0.5
    if gap_m > DEFAULT_GAPS_M[0]:
        confidence -= 0.05
    return Room(" / ".join(names), polygon, names, round(confidence, 2), list(label_ids))


def _number_unlabelled(rooms: list[Room]) -> None:
    unlabelled = [r for r in rooms if not r.labels]
    for n, room in enumerate(sorted(unlabelled, key=lambda r: -r.area_sqm), start=1):
        room.name = f"Unlabelled room {n}"


def _split(room: Room, finer: RoomResult, labels: list[Label]) -> list[Room] | None:
    """`room` cut along the rooms a wider bridge finds inside it — when that
    separates its labels into two or more rooms. A doorway a little wider
    than the bridge lets one room leak into the next (a bedroom into the
    dining area); the wider bridge closes it, but would also close up a
    narrow room elsewhere, so it is applied only here. Open-plan labels with
    no wall between them (kitchen / living / dining) stay together. A label
    whose space the wider bridge closes up (a toilet too narrow for it)
    stays with the piece it sits in. The leftover strips between the pieces
    (the doorway, wall faces the wider bridge eats into) go to the piece
    they touch most, so the total area is unchanged."""
    inside = [r for r in finer.rooms if r.label_ids and room.polygon.contains(r.polygon.representative_point())]
    found = {i for r in inside for i in r.label_ids}
    missing = [i for i in room.label_ids if i not in found]
    if len(inside) < 2 or not found <= set(room.label_ids):
        return None
    parts = [room.polygon.intersection(r.polygon) for r in inside]
    rest = room.polygon.difference(unary_union(parts))
    for piece in getattr(rest, "geoms", [rest]):
        if piece.is_empty or piece.area == 0:
            continue
        touch = [piece.buffer(0.05).intersection(p).area for p in parts]
        best = max(range(len(parts)), key=lambda k: (touch[k], -piece.distance(parts[k])))
        parts[best] = unary_union([parts[best], piece])
    ids = [list(r.label_ids) for r in inside]
    for i in missing:
        point = Point(labels[i].x, labels[i].y)
        ids[min(range(len(parts)), key=lambda k: parts[k].distance(point))].append(i)
    out = []
    for r, part, label_ids in zip(inside, parts, ids):
        # Fuse pieces that only touch at a corner; a stray sliver that still
        # doesn't join is dropped.
        part = part.buffer(0.01, join_style="mitre").buffer(-0.01, join_style="mitre")
        polygon = max(getattr(part, "geoms", [part]), key=lambda g: g.area)
        label_ids.sort(key=lambda i: labels[i].minor)
        piece = _room(polygon, label_ids, labels, finer.gap_m)
        piece.confidence = max(piece.confidence, room.confidence)
        out.append(piece)
    return out


def split_merged_rooms(result: RoomResult, finer_results: list[RoomResult], labels: list[Label]) -> RoomResult:
    """Each room holding several labels, split with the narrowest wider
    bridge that separates them (see _split)."""
    rooms: list[Room] = []
    for room in result.rooms:
        pieces = None
        if len(room.label_ids) > 1:
            pieces = next((p for f in finer_results if (p := _split(room, f, labels))), None)
        rooms.extend(pieces or [room])
    if len(rooms) == len(result.rooms):
        return result
    _number_unlabelled(rooms)
    return RoomResult(sorted(rooms, key=lambda r: (not r.labels, -r.area_sqm)), result.gross_sqm, result.gap_m,
                      result.unplaced_labels)


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
            hole = Polygon(ring).buffer(half, join_style="mitre", mitre_limit=MITRE_LIMIT)
            if hole.area >= MIN_ROOM_SQM:
                holes.append(hole)

    rooms: list[Room] = []
    placed: set[int] = set()
    for hole in sorted(holes, key=lambda h: h.area):
        inside = [i for i, l in enumerate(labels) if i not in placed and hole.contains(Point(l.x, l.y))]
        placed.update(inside)
        # Room-name-size labels first; a minor one ("TOILET") names the room
        # only alongside them or on its own.
        inside.sort(key=lambda i: labels[i].minor)
        rooms.append(_room(hole, inside, labels, gap_m))

    _number_unlabelled(rooms)

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
    total, then fewer unlabelled rooms. Each candidate's merged rooms are
    split first where a wider bridge separates them (split_merged_rooms)."""
    best, best_score = None, None
    for walls in candidate_wall_sets:
        cache: dict[float, RoomResult] = {}

        def traced(gap: float) -> RoomResult:
            if gap not in cache:
                cache[gap] = rooms_from_walls(walls, labels, gap)
            return cache[gap]

        for gap in gaps:
            result = traced(gap)
            if any(len(r.label_ids) > 1 for r in result.rooms):
                result = split_merged_rooms(result, [traced(g) for g in SPLIT_GAPS_M if g > gap], labels)
            placed = len(labels) - len(result.unplaced_labels)
            total_error = (abs((result.gross_sqm or 0) - plan_total_sqm) / plan_total_sqm
                           if plan_total_sqm and result.gross_sqm else math.inf)
            unlabelled = len(result.rooms) - result.labelled_rooms
            score = (result.labelled_rooms, placed, -total_error, -unlabelled)
            if best_score is None or score > best_score:
                best, best_score = result, score
    return best
