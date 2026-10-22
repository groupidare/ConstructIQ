"""Blueprint extraction: CAD-exported (vector) PDF or DXF → sheets, drawings,
rooms (area/perimeter), openings, ceiling heights, finish notes, and a check
against the plan's own stated total area.

Scope (agreed): architectural works only — floor, wall, ceiling, doors,
windows. Scanned plans, structural quantities from floor plans and MEP are
out of scope; a provided BOQ or manual rows fill those gaps.

PDF: pdfplumber exposes no optional-content (layer) names, so walls are
found by pen style — the heaviest non-hatch line styles, combined and scored
by how many room labels they enclose (blueprint_geometry.best_rooms).
DXF: real layer names (WALL / DOOR / GLZ, WIN / ROOM…) are used directly.
"""
from __future__ import annotations

import hashlib
import logging
import math
import re
import statistics
from collections import Counter, OrderedDict, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.services import blueprint_ocr
from app.services.blueprint_geometry import Label, RoomResult, best_rooms

logger = logging.getLogger(__name__)

PT_TO_M = 25.4 / 72 / 1000          # one PDF point on paper, in metres
MAX_PAGES = 60
SCALE_TOLERANCE = 0.05             # stated vs measured scale before the measured one wins
DIMENSION_MIN_AGREE = 3
OCR_MAX_REAL_CHARS = 400           # real characters in the drawing area below which a page is OCR'd
OCR_MIN_OBJECTS = 500             # lines + curves + rects for a page to count as a drawing
SCANNED_PLAN_ERROR = "Scanned plan. Upload the CAD PDF or DXF."

_SHEET_CODE = re.compile(r"^([A-Z]{1,2})-(\d{1,3}[A-Z]?)$")
_SCALE = re.compile(r"\b1\s*:\s*(\d{1,4})(?!\d)")  # "1:50", "1 : 100", "1:50M"
_GRID_REF = re.compile(r"^[A-Z]{1,2}-\d+(\.\d+)?$")
_DRAWING_WORDS = re.compile(r"\b(PLAN|ELEVATION|SECTION|LAYOUT|DETAIL)S?\b", re.I)
_PLAN_TOTAL = re.compile(r"TOTAL\s+(?:FLOOR\s+|GROSS\s+)?AREA\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:SQ\.?\s*M|M2|M²)", re.I)
_CEILING_HEIGHT = [
    re.compile(r"\bC\.?\s?H\.?\s*[=:]\s*(\d{3,4})\s*MM\b", re.I),
    re.compile(r"CEILING\s+HEIGHT\s*[=:]?\s*(\d{3,4})\s*MM\b", re.I),
    re.compile(r"CEILING\s+HEIGHT\s*[=:]?\s*(\d(?:\.\d{1,2})?)\s*M\b", re.I),
]
_FINISH = re.compile(r"\b(TILES?|PAINT|GYPSUM|BOARD|CARPET|VINYL|EPOXY|ACOUSTIC|LAMINATE|SKIM\s*COAT|PLASTER|CERAMIC|"
                     r"PORCELAIN|GRANITE|MARBLE|SCREED|WALLPAPER|CEILING\s+PANEL)\b", re.I)
_WINDOW_TAG = re.compile(r"^(W|WD|WIN)[-\s]?\d{1,3}[A-Z]?$|\bWINDOW\b", re.I)
# Plan titles that are a floor plan but not the one to measure rooms on.
_NOT_THE_FLOOR_PLAN = re.compile(r"PATTERN|FINISH|DIMENSION|CEILING|ROOF|FURNITURE|LIGHTING|POWER|ELECTRICAL|"
                                 r"PLUMBING|SPRINKLER|FIRE|DEMOLITION|SITE|LOCATION|VICINITY", re.I)
_NON_ARCHITECTURAL = {"E", "M", "FP", "P", "S", "FA", "FD", "ME"}

DOOR_WIDTH_RANGE_M = (0.55, 1.3)
DEFAULT_DOOR_HEIGHT_M = 2.1
DEFAULT_WINDOW = (1.2, 1.2)  # width, height — editable in the wizard


class BlueprintError(ValueError):
    pass


# ── text ──────────────────────────────────────────────────────────────────────

@dataclass
class TextLine:
    text: str
    x0: float
    top: float
    x1: float
    bottom: float
    size: float
    ocr: bool = False  # read off the rendered page (blueprint_ocr), not the PDF's text

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.top + self.bottom) / 2


def _group_upright(words: list[dict]) -> list[TextLine]:
    lines: list[list[dict]] = []
    for w in sorted(words, key=lambda w: (round(w["top"]), w["x0"])):
        for line in lines:
            last = line[-1]
            if (abs(last["top"] - w["top"]) < 0.35 * w["size"]
                    and abs(last["size"] - w["size"]) < 0.15 * w["size"]
                    and 0 <= w["x0"] - last["x1"] < 1.6 * w["size"]):
                line.append(w)
                break
        else:
            lines.append([w])
    return [TextLine(_join_words(l), min(w["x0"] for w in l), min(w["top"] for w in l),
                     max(w["x1"] for w in l), max(w["bottom"] for w in l), statistics.median(w["size"] for w in l))
            for l in lines]


def _join_words(words: list[dict]) -> str:
    """Letter-spaced titles ("F I T T I N G") arrive one character per word:
    single characters closer together than half a character are one word."""
    text = words[0]["text"]
    for prev, w in zip(words, words[1:]):
        tight = (len(prev["text"]) == 1 or len(w["text"]) == 1) and w["x0"] - prev["x1"] < 0.5 * w["size"]
        text += ("" if tight else " ") + w["text"]
    return text


def _group_rotated(words: list[dict]) -> list[TextLine]:
    """Vertical text arrives one character per "word". Stack characters that
    share a column into words, read in the direction the text faces (the
    char matrix: b > 0 reads bottom-to-top, b < 0 top-to-bottom)."""
    # For a rotated glyph pdfplumber's "size" follows the glyph's advance,
    # not the font size — the box's width across the line is the font size.
    font = lambda c: c["x1"] - c["x0"]
    columns: dict[int, list[dict]] = defaultdict(list)
    for w in words:
        columns[round(w["x0"])].append(w)
    lines = []
    for chars in columns.values():
        chars.sort(key=lambda c: c["top"])
        run = [chars[0]]
        runs = [run]
        for c in chars[1:]:
            if c["top"] - run[-1]["bottom"] < 0.8 * font(c):
                run.append(c)
            else:
                run = [c]
                runs.append(run)
        for r in runs:
            matrix = r[0].get("matrix") or (1, 0, 0, 1, 0, 0)
            ordered = list(reversed(r)) if matrix[1] > 0 else r
            lines.append(TextLine("".join(c["text"] for c in ordered), min(c["x0"] for c in r), r[0]["top"],
                                  max(c["x1"] for c in r), r[-1]["bottom"], statistics.median(font(c) for c in r)))
    return lines


def _text_lines(page) -> list[TextLine]:
    # No "matrix" in extra_attrs: it carries each glyph's own position, so
    # pdfplumber would split every character into its own word. Rotated text
    # is rebuilt from the raw chars (which do carry their matrix) instead.
    words = page.extract_words(extra_attrs=["size", "upright"], keep_blank_chars=False)
    rotated = [dict(c, x1=c["x1"], bottom=c["bottom"]) for c in page.chars if not c.get("upright", True) and c["text"].strip()]
    return _group_upright([w for w in words if w["upright"]]) + (_group_rotated(rotated) if rotated else [])


def _rows(lines: list[TextLine]) -> list[str]:
    """Text lines that share a row, left to right — a schedule's label and
    value ("TOTAL AREA" … ":71.95 SQM.") are often far enough apart to come
    out as separate lines."""
    rows: list[list[TextLine]] = []
    for l in sorted(lines, key=lambda l: (l.top, l.x0)):
        row = next((r for r in rows if abs(r[0].top - l.top) < 0.5 * l.size and abs(r[0].size - l.size) < 0.2 * l.size), None)
        (row.append(l) if row else rows.append([l]))
    return [" ".join(l.text for l in sorted(r, key=lambda l: l.x0)) for r in rows]


def _scale_denominator(value: Any) -> int | None:
    if value is None or str(value).strip() == "":
        return None
    s = str(value).strip()
    m = _SCALE.search(s)
    n = int(m.group(1)) if m else (int(float(s)) if re.fullmatch(r"\d+(\.\d+)?", s) else None)
    return n if n and n > 0 else None


def _heights(texts: list[str]) -> list[float]:
    found = set()
    for t in texts:
        for pattern in _CEILING_HEIGHT:
            for m in pattern.finditer(t):
                v = float(m.group(1))
                metres = v / 1000 if v > 50 else v
                if 1.8 <= metres <= 8:
                    found.add(round(metres, 2))
    return sorted(found)


def _plan_total(texts: list[str]) -> float | None:
    for t in texts:
        m = _PLAN_TOTAL.search(t)
        if m:
            return float(m.group(1).replace(",", ""))
    return None


def _finish_notes(lines: list[str]) -> list[str]:
    notes, seen = [], set()
    for t in lines:
        t = " ".join(t.split())
        if 4 <= len(t) <= 90 and _FINISH.search(t) and t.upper() not in seen:
            seen.add(t.upper())
            notes.append(t)
    return notes[:25]


def _labels_from(lines: list[TextLine], exclude: list[TextLine]) -> list[TextLine]:
    """Room names: the largest in-drawing text (not titles, dimensions, grid
    callouts or annotations), stacked lines joined ("FITTING" over "ROOM")."""
    candidates = [l for l in lines if l not in exclude
                  and sum(ch.isalpha() for ch in l.text) >= max(3, 0.5 * len(l.text.replace(" ", "")))
                  and not _GRID_REF.match(l.text.strip()) and not _SCALE.search(l.text)]
    if not candidates:
        return []
    biggest = max(l.size for l in candidates)
    if all(l.ocr for l in candidates):
        # OCR box heights wobble — one word boxed with a nearby symbol comes
        # out twice the size. Room names share a size: take the largest one
        # that at least two labels have.
        shared = [size for size, n in Counter(round(l.size * 2) / 2 for l in candidates).items() if n >= 2]
        biggest = max(shared, default=biggest)
    big = sorted([l for l in candidates if l.size >= 0.85 * biggest], key=lambda l: (l.top, l.x0))
    merged: list[TextLine] = []
    for l in big:
        prev = next((m for m in reversed(merged)
                     if 0 <= l.top - m.bottom < 0.9 * l.size and abs(l.cx - m.cx) < 3 * l.size), None)
        if prev:
            prev.text = f"{prev.text} {l.text}"
            prev.x0, prev.x1, prev.bottom = min(prev.x0, l.x0), max(prev.x1, l.x1), l.bottom
        else:
            merged.append(TextLine(l.text, l.x0, l.top, l.x1, l.bottom, l.size))
    return merged


# ── PDF ───────────────────────────────────────────────────────────────────────

@dataclass
class Drawing:
    id: str
    title: TextLine
    scale: int | None
    region: tuple[float, float, float, float]  # x0, top, x1, bottom (PDF points)


@dataclass
class Sheet:
    id: str
    discipline: str | None
    title: str
    page_index: int
    lines: list[TextLine]
    drawings: list[Drawing]


def _sheet_code(lines: list[TextLine]) -> TextLine | None:
    codes = [l for l in lines if _SHEET_CODE.match(l.text.strip())]
    return max(codes, key=lambda l: l.size) if codes else None


def _drawings(sheet_id: str, page, lines: list[TextLine], code: TextLine | None) -> tuple[list[Drawing], str]:
    sizes = [l.size for l in lines] or [1.0]
    # 14 pt suits A1 sheets with real text; OCR'd sheets are often A3, so
    # there the floor follows the sheet width.
    floor = 14.0 * min(1.0, page.width / 2384) if any(l.ocr for l in lines) else 14.0
    big_cut = max(floor, 1.8 * statistics.median(sizes))
    big = [l for l in lines if l.size >= big_cut and l is not code and not _SHEET_CODE.match(l.text.strip())]

    # The sheet's own title sits in the title block, right above the code.
    sheet_title = None
    if code:
        near = [l for l in big if 0 < code.top - l.bottom < 250 and abs(l.cx - code.cx) < 300]
        sheet_title = min(near, key=lambda l: code.top - l.bottom) if near else None
    title_block_left = code.x0 - 150 if code and code.x0 > page.width * 0.6 else page.width

    title_lines = [l for l in big if l is not sheet_title and l.x0 < title_block_left
                   and sum(ch.isalpha() for ch in l.text) >= 4]
    scale_lines = [s for s in lines if _SCALE.search(s.text)]

    def nearest_title(s: TextLine) -> TextLine | None:
        """A scale note belongs to the title right above it (or beside it on
        the same line) — never to a neighbouring drawing's title."""
        near = [l for l in title_lines
                if (l.bottom - 2 <= s.top <= l.bottom + 60 or abs(s.top - l.top) < l.size)
                and s.x1 >= l.x0 - 100 and s.x0 <= l.x1 + 150]
        return min(near, key=lambda l: abs(s.cx - l.cx) + abs(s.top - l.bottom)) if near else None

    scale_of: dict[int, int | None] = {}
    for s in scale_lines:
        owner = nearest_title(s)
        if owner is not None and id(owner) not in scale_of:
            scale_of[id(owner)] = _scale_denominator(s.text)

    titles = [(l, scale_of.get(id(l))) for l in title_lines
              if id(l) in scale_of or _DRAWING_WORDS.search(l.text)]

    titles.sort(key=lambda t: (round(t[0].top / 80), t[0].x0))
    drawings = []
    for i, (t, scale) in enumerate(titles):
        same_row = [o for o, _ in titles if o is not t and abs(o.top - t.top) < 80]
        left = max([(o.cx + t.cx) / 2 for o in same_row if o.cx < t.cx], default=0.0)
        right = min([(o.cx + t.cx) / 2 for o in same_row if o.cx > t.cx], default=title_block_left)
        above = [o.bottom + 30 for o, _ in titles if o.top < t.top - 80 and o.x1 > left and o.x0 < right]
        drawings.append(Drawing(f"{sheet_id}:{chr(65 + i)}", t, scale, (left, max(above, default=0.0), right, t.top)))
    return drawings, (sheet_title.text if sheet_title else " / ".join(d.title.text for d in drawings)[:120])


def _scale_from_dimensions(lines: list[TextLine], objs: list[dict]) -> float | None:
    """The scale this PDF is really drawn at: each horizontal dimension
    string (millimetres) over the length of the dimension line just below it,
    measured between its extension lines. A plotted-to-fit PDF keeps the
    title's "1:60" while every length shrinks, so the stated scale can be
    wrong where the dimensions never are. Needs DIMENSION_MIN_AGREE readings
    within 3% of each other — OCR misreads ("5500" for "3500") fall out."""
    segs = [o for o in objs if o["object_type"] == "line" or len(o.get("pts") or []) == 2]
    horizontal = [(o["x0"], o["top"], o["x1"]) for o in segs if o["bottom"] - o["top"] < 0.3 and o["x1"] - o["x0"] > 5]
    vertical = [(o["x0"], o["top"], o["bottom"]) for o in segs if o["x1"] - o["x0"] < 0.3 and o["bottom"] - o["top"] > 2]
    readings = []
    for t in lines:
        value = t.text.replace(",", "").strip()
        if not re.fullmatch(r"\d{3,5}", value) or t.x1 - t.x0 < t.bottom - t.top:
            continue
        below = [h for h in horizontal if 0 <= h[1] - t.bottom <= 2.5 * t.size and h[0] < t.cx < h[2]
                 and abs((h[0] + h[2]) / 2 - t.cx) < 0.15 * (h[2] - h[0])]
        if not below:
            continue
        a, y, b = min(below, key=lambda h: h[1] - t.bottom)
        ticks = [v[0] for v in vertical if a - 0.5 <= v[0] <= b + 0.5 and v[1] - 0.5 <= y <= v[2] + 0.5]
        if len(ticks) >= 2:
            a, b = min(ticks), max(ticks)
        if b - a > 1:
            readings.append(int(value) / 1000 / ((b - a) * PT_TO_M))
    if len(readings) < DIMENSION_MIN_AGREE:
        return None
    middle = statistics.median(readings)
    agree = [r for r in readings if abs(r - middle) / middle < 0.03]
    return round(statistics.median(agree), 1) if len(agree) >= DIMENSION_MIN_AGREE else None


def _default_drawing(drawings: list[Drawing]) -> Drawing | None:
    def rank(d: Drawing):
        t = d.title.text.upper()
        return (0 if "FLOOR PLAN" in t and not _NOT_THE_FLOOR_PLAN.search(t)
                else 1 if "PLAN" in t and not _NOT_THE_FLOOR_PLAN.search(t)
                else 2 if "PLAN" in t else 3)
    return min(drawings, key=rank) if drawings else None


def _style(o: dict) -> tuple:
    # Whole-number widths: CAD exports scale pen weights, so one wall pen
    # comes out as 8.6/9.0/9.1… and finer rounding splits it apart.
    return (round(float(o.get("linewidth") or 0)), str(o.get("stroking_color")))


def _segments(objs: list[dict]) -> list[tuple[float, float, float, float]]:
    out = []
    for o in objs:
        pts = o.get("pts")
        if not pts:
            x0, t, x1, b = o["x0"], o["top"], o["x1"], o["bottom"]
            pts = [(x0, t), (x1, t), (x1, b), (x0, b), (x0, t)] if o.get("object_type") == "rect" else [(x0, t), (x1, b)]
        out.extend((a[0], a[1], b[0], b[1]) for a, b in zip(pts, pts[1:]) if a != b)
    return out


def _is_hatch(segs: list[tuple], m_per_pt: float) -> bool:
    """Material hatching: many short segments, almost all in ONE direction.
    (Walls run in two — horizontal and vertical — so a two-direction test
    would throw the walls out; dense two-way grids are caught by the
    segment-count cap in _wall_candidates instead.)"""
    if len(segs) < 200:
        return False
    angles = Counter(round(math.degrees(math.atan2(y1 - y0, x1 - x0)) % 180 / 5) for x0, y0, x1, y1 in segs)
    dominant = angles.most_common(1)[0][1] / len(segs)
    lengths = sorted(math.hypot(x1 - x0, y1 - y0) for x0, y0, x1, y1 in segs)
    return dominant >= 0.8 and lengths[len(lengths) // 2] * m_per_pt < 1.5


def _wall_candidates(objs: list[dict], m_per_pt: float) -> list[list[tuple]]:
    """Heaviest non-hatch pen styles first, as growing prefixes (1–3 styles),
    converted to metres."""
    by_style: dict[tuple, list[dict]] = defaultdict(list)
    for o in objs:
        by_style[_style(o)].append(o)
    styles = []
    for style, group in by_style.items():
        segs = _segments(group)
        if len(segs) < 4 or len(segs) > 3000 or _is_hatch(segs, m_per_pt):
            continue
        styles.append((style[0], len(segs), segs))
    styles.sort(key=lambda s: (-s[0], -s[1]))
    sets, acc = [], []
    for _, _, segs in styles[:3]:
        acc = acc + segs
        sets.append([(x0 * m_per_pt, y0 * m_per_pt, x1 * m_per_pt, y1 * m_per_pt) for x0, y0, x1, y1 in acc])
    return sets


def _doors_from_arcs(curves: list[dict], m_per_pt: float) -> list[float]:
    """Door swings drawn as quarter arcs: a roughly square bbox whose side is
    the leaf width. Overlapping arcs (double-drawn) count once."""
    widths, seen = [], []
    for c in curves:
        w, h = (c["x1"] - c["x0"]) * m_per_pt, (c["bottom"] - c["top"]) * m_per_pt
        side = max(w, h)
        if not (DOOR_WIDTH_RANGE_M[0] <= side <= DOOR_WIDTH_RANGE_M[1]) or min(w, h) < 0.7 * side:
            continue
        pts = c.get("pts") or []
        if len(pts) > 2 and math.dist(pts[0], pts[-1]) * m_per_pt < 0.2 * side:
            continue  # a closed circle (grid bubble, column), not a door swing
        centre = ((c["x0"] + c["x1"]) / 2, (c["top"] + c["bottom"]) / 2)
        if any(math.hypot(centre[0] - s[0], centre[1] - s[1]) * m_per_pt < 0.2 for s in seen):
            continue
        seen.append(centre)
        widths.append(round(side * 20) / 20)
    return widths


def _openings(door_widths: list[float], window_count: int, window_widths: list[float] | None = None) -> list[dict]:
    out = [{"type": "door", "count": n, "width_m": w, "height_m": DEFAULT_DOOR_HEIGHT_M, "assumed_height": True}
           for w, n in sorted(Counter(door_widths).items())]
    if window_widths:
        out += [{"type": "window", "count": n, "width_m": w, "height_m": DEFAULT_WINDOW[1], "assumed_height": True}
                for w, n in sorted(Counter(window_widths).items())]
    elif window_count:
        out.append({"type": "window", "count": window_count, "width_m": DEFAULT_WINDOW[0],
                    "height_m": DEFAULT_WINDOW[1], "assumed_width": True, "assumed_height": True})
    return out


def _rooms_json(result: RoomResult | None) -> list[dict]:
    if not result:
        return []
    def bbox(r):
        x0, y0, x1, y1 = r.polygon.bounds
        return round(max(x1 - x0, y1 - y0), 2), round(min(x1 - x0, y1 - y0), 2)
    # length_m/width_m: the room's bounding box — what a measurement row's
    # L × W holds; floor_area_sqm is the real (possibly non-rectangular) area.
    return [{"name": r.name, "floor_area_sqm": round(r.area_sqm, 2), "perimeter_m": round(r.perimeter_m, 2),
             "length_m": bbox(r)[0], "width_m": bbox(r)[1],
             "confidence": r.confidence, "labels": r.labels} for r in result.rooms]


def _schedule_check(plan_total: float | None, result: RoomResult | None) -> dict | None:
    if result is None:
        return None
    gross = round(result.gross_sqm, 2) if result.gross_sqm else None
    clear = round(sum(r.area_sqm for r in result.rooms), 2)
    diff = round(abs(gross - plan_total) / plan_total * 100, 2) if plan_total and gross else None
    return {"plan_total_sqm": plan_total, "extracted_total_sqm": gross, "clear_total_sqm": clear, "difference_pct": diff}


@dataclass
class _SheetScan:
    sheets: list[Sheet]
    all_text: list[str]
    warnings: list[str]


# Reading every page of a large plan set takes about a minute, and the wizard
# asks twice (sheet list, then the chosen drawing) — keep the last few scans.
_SCAN_CACHE: "OrderedDict[str, _SheetScan]" = OrderedDict()
_SCAN_CACHE_SIZE = 4


def _file_hash(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _needs_ocr(page, drawings: list[Drawing]) -> bool:
    """A drawing-heavy page with no titled, scaled drawing and next to no
    real text in its drawing area (the title block aside): its labels are
    drawn as lines. Plans with real text keep 600+ characters there."""
    if any(d.scale for d in drawings) or len(page.lines) + len(page.curves) + len(page.rects) < OCR_MIN_OBJECTS:
        return False
    w, h = page.width, page.height
    inner = sum(1 for c in page.chars if c["text"].strip()
                and 0.1 * w < (c["x0"] + c["x1"]) / 2 < 0.8 * w and 0.1 * h < (c["top"] + c["bottom"]) / 2 < 0.8 * h)
    return inner < OCR_MAX_REAL_CHARS


def _scan_sheets(pdf, pages) -> _SheetScan:
    warnings: list[str] = []
    if len(pdf.pages) > MAX_PAGES:
        warnings.append(f"Only the first {MAX_PAGES} pages were read.")
    if not any(len(p.lines) + len(p.curves) + len(p.rects) >= 50 for p in pages):
        raise BlueprintError(SCANNED_PLAN_ERROR)

    # Pass 1: the PDF's own text; pages that need it are rendered for OCR.
    can_ocr = blueprint_ocr.available()
    page_lines: list[list[TextLine]] = []
    ocr_jobs: dict[int, tuple] = {}
    unreadable = 0  # pages that needed OCR on a server without Tesseract
    for i, page in enumerate(pages):
        lines = _text_lines(page)
        page_lines.append(lines)
        code = _sheet_code(lines)
        if not (code and _SHEET_CODE.match(code.text.strip()).group(1) in _NON_ARCHITECTURAL):
            drawings, _ = _drawings(code.text.strip() if code else f"P{i + 1}", page, lines, code)
            if _needs_ocr(page, drawings):
                if can_ocr:
                    image, pt_per_px = blueprint_ocr.render(page)
                    ocr_jobs[i] = (image, pt_per_px, [(c["x0"], c["top"], c["x1"], c["bottom"]) for c in page.chars])
                else:
                    unreadable += 1
        page.flush_cache()  # pdfplumber keeps every parsed object otherwise
    if unreadable:
        warnings.append(f"{unreadable} page(s) have their labels drawn as lines, and no OCR is available on this server "
                        "(neither Azure Document Intelligence nor Tesseract) — titles, scales and room names on them can't be read.")

    if ocr_jobs:
        for i, found in zip(ocr_jobs, blueprint_ocr.read_pages(list(ocr_jobs.values()))):
            page_lines[i].extend(TextLine(*line, ocr=True) for line in found)
        warnings.append("Some labels on this plan are drawn as lines, so they were read from the drawing image (OCR). "
                        "Check the scale and room names.")

    # Pass 2: sheets and drawings from all the text.
    sheets: list[Sheet] = []
    skipped: list[str] = []
    all_text: list[str] = []
    for i, (page, lines) in enumerate(zip(pages, page_lines)):
        all_text.extend(_rows(lines))
        code = _sheet_code(lines)
        sid = code.text.strip() if code else f"P{i + 1}"
        discipline = _SHEET_CODE.match(sid).group(1) if code else None
        if discipline in _NON_ARCHITECTURAL:
            skipped.append(sid)
            continue
        drawings, title = _drawings(sid, page, lines, code)
        sheets.append(Sheet(sid, discipline, title, i, lines, drawings))
    if skipped:
        warnings.append(f"Skipped non-architectural sheet(s): {', '.join(dict.fromkeys(skipped))}.")
    return _SheetScan(sheets, all_text, warnings)


def _parse_pdf(path: str, sheet_id: str | None, drawing_id: str | None, scale_override: Any) -> dict:
    import pdfplumber

    key = _file_hash(path)
    with pdfplumber.open(path) as pdf:
        pages = pdf.pages[:MAX_PAGES]
        scan = _SCAN_CACHE.get(key)
        if scan is None:
            scan = _scan_sheets(pdf, pages)
            _SCAN_CACHE[key] = scan
            while len(_SCAN_CACHE) > _SCAN_CACHE_SIZE:
                _SCAN_CACHE.popitem(last=False)
        else:
            _SCAN_CACHE.move_to_end(key)
        sheets, all_text, warnings = scan.sheets, scan.all_text, list(scan.warnings)

        plan_sheets = [s for s in sheets if s.drawings]
        if not plan_sheets:
            raise BlueprintError("No drawings with a title were found on the architectural sheets.")

        sheet = next((s for s in plan_sheets if s.id == sheet_id), None) if sheet_id else None
        all_drawings = [d for s in plan_sheets for d in s.drawings]
        drawing = next((d for d in all_drawings if d.id == drawing_id), None) if drawing_id else None
        if drawing is None:
            pool = sheet.drawings if sheet else all_drawings
            drawing = _default_drawing(pool)
        sheet = next(s for s in plan_sheets if drawing in s.drawings)

        response = {
            "sheets": [{"id": s.id, "title": s.title,
                        "drawings": [{"id": d.id, "title": d.title.text, "scale": f"1:{d.scale}" if d.scale else None}
                                     for d in s.drawings]} for s in plan_sheets],
            "selected_drawing": drawing.id,
            "ceiling_heights_m": _heights(all_text),
            "finish_notes": _finish_notes([l.text for l in sheet.lines]),
            "warnings": warnings,
            "errors": [],
            "rooms": [], "openings": [], "schedule_check": None,
        }

        page = pages[sheet.page_index]
        x0, top, x1, bottom = drawing.region
        region = page.within_bbox((max(0, x0), max(0, top), min(page.width, x1), min(page.height, bottom)))
        objs = [dict(o, object_type="line") for o in region.lines] + [dict(o, object_type="curve") for o in region.curves] \
            + [dict(o, object_type="rect") for o in region.rects]
        region_lines = [l for l in sheet.lines if x0 <= l.cx <= x1 and top <= l.cy <= bottom]

        entered = _scale_denominator(scale_override)
        measured = _scale_from_dimensions(region_lines, objs)
        differs = lambda a, b: abs(a - b) / b > SCALE_TOLERANCE
        if entered:
            scale = entered
            if drawing.scale and entered != drawing.scale:
                warnings.append(f"Using the entered scale 1:{entered} instead of the drawing's 1:{drawing.scale}.")
            if measured and differs(entered, measured):
                warnings.append(f"The plan's dimensions measure 1:{measured:g} on this PDF, not the entered 1:{entered}.")
        elif drawing.scale and measured and differs(drawing.scale, measured):
            scale = measured
            warnings.append(f"The title says 1:{drawing.scale}, but the plan's dimensions measure 1:{measured:g} on this PDF "
                            f"(it was likely printed to fit the paper) — using 1:{measured:g}.")
        elif drawing.scale or measured:
            scale = drawing.scale or measured
            if not drawing.scale:
                warnings.append(f"No scale under the title — using 1:{measured:g}, measured from the plan's dimensions.")
        else:
            response["errors"].append(f"No scale found under \"{drawing.title.text}\". Enter the scale (e.g. 1:50).")
            return response
        m_per_pt = PT_TO_M * scale
        labels = _labels_from(region_lines, [drawing.title])
        label_pts = [Label(l.text, l.cx * m_per_pt, l.cy * m_per_pt) for l in labels]

        plan_total = _plan_total(_rows(sheet.lines)) or _plan_total(all_text)
        result = best_rooms(_wall_candidates(objs, m_per_pt), label_pts, plan_total)
        if result is None or not result.rooms:
            response["errors"].append("No closed rooms could be traced on this drawing — enter the measurements by hand.")
            result = None
        elif result.unplaced_labels:
            warnings.append("Room label(s) not inside a traced room: " + ", ".join(result.unplaced_labels[:8]) + ".")

        windows = sum(1 for l in region_lines if _WINDOW_TAG.search(l.text.strip()))
        response.update({
            "rooms": _rooms_json(result),
            "openings": _openings(_doors_from_arcs(region.curves, m_per_pt), windows),
            "schedule_check": _schedule_check(plan_total, result),
        })
        return response


# ── DXF ───────────────────────────────────────────────────────────────────────

_INSUNITS_TO_M = {0: 0.001, 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1.0}
_WALL_LAYER = re.compile(r"WALL", re.I)
_DOOR_LAYER = re.compile(r"DOOR", re.I)
_WINDOW_LAYER = re.compile(r"GLZ|GLAZ|GLASS|WIN", re.I)
_ROOM_LAYER = re.compile(r"ROOM|AREA|SPACE|TAG|NAME", re.I)
_NOT_WALL_LAYER = re.compile(r"FURN|DIM|HATCH|TEXT|GRID|ANNO|TITLE|DEFPOINTS|FIXT|EQUIP", re.I)


def _dxf_segments(entity, f: float) -> list[tuple]:
    t = entity.dxftype()
    if t == "LINE":
        s, e = entity.dxf.start, entity.dxf.end
        return [(s.x * f, s.y * f, e.x * f, e.y * f)]
    if t in ("LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "ELLIPSE", "SPLINE"):
        try:
            from ezdxf import path as ezpath
            pts = [(p.x * f, p.y * f) for p in ezpath.make_path(entity).flattening(0.01 / f if f else 0.01)]
        except Exception:
            return []
        return [(a[0], a[1], b[0], b[1]) for a, b in zip(pts, pts[1:]) if a != b]
    return []


def _parse_dxf(path: str) -> dict:
    import ezdxf
    from ezdxf import bbox, recover
    from shapely import Polygon

    try:
        doc, _ = recover.readfile(path)
    except (IOError, ezdxf.DXFStructureError) as e:
        raise BlueprintError(f"Couldn't read the DXF file ({e}).")
    warnings: list[str] = []
    units = int(doc.header.get("$INSUNITS", 0) or 0)
    if units not in _INSUNITS_TO_M or units == 0:
        warnings.append("The DXF has no drawing units set — millimetres assumed.")
    f = _INSUNITS_TO_M.get(units, 0.001)
    msp = doc.modelspace()

    texts: list[tuple[str, float, float, float, str]] = []  # text, x, y, height, layer
    for e in msp.query("TEXT MTEXT"):
        text = e.plain_text() if e.dxftype() == "MTEXT" else e.dxf.text
        ins = e.dxf.insert
        height = float(e.dxf.get("char_height" if e.dxftype() == "MTEXT" else "height", 0) or 0)
        texts.append((" ".join(str(text).split()), ins.x * f, ins.y * f, height * f, e.dxf.layer))
    all_text = [t[0] for t in texts]

    room_texts = [t for t in texts if _ROOM_LAYER.search(t[4])] or texts
    if room_texts:
        biggest = max(t[3] for t in room_texts)
        room_texts = [t for t in room_texts if t[3] >= 0.85 * biggest and sum(c.isalpha() for c in t[0]) >= 3]
    labels = [Label(t[0], t[1], t[2]) for t in room_texts]

    plan_total = _plan_total(all_text)
    result = None
    # Closed outlines drawn on a room/area layer are the rooms themselves.
    outlines = []
    for e in msp.query("LWPOLYLINE POLYLINE"):
        if not _ROOM_LAYER.search(e.dxf.layer):
            continue
        if e.dxftype() == "LWPOLYLINE":
            closed, pts = e.closed, [(x * f, y * f) for x, y, *_ in e.get_points()]
        else:
            closed, pts = e.is_closed, [(v.dxf.location.x * f, v.dxf.location.y * f) for v in e.vertices]
        if closed and len(pts) >= 3 and Polygon(pts).area >= 1.0:
            outlines.append(Polygon(pts))
    if outlines:
        from app.services.blueprint_geometry import Room, RoomResult
        from shapely import Point
        from shapely.ops import unary_union
        rooms, placed = [], set()
        for poly in sorted(outlines, key=lambda p: p.area):
            inside = [i for i, l in enumerate(labels) if i not in placed and poly.contains(Point(l.x, l.y))]
            placed.update(inside)
            names = [labels[i].text for i in inside]
            rooms.append(Room(" / ".join(names) or "", poly, names, 0.95 if names else 0.6))
        for n, r in enumerate([r for r in rooms if not r.labels], start=1):
            r.name = f"Unlabelled room {n}"
        result = RoomResult(rooms, unary_union(outlines).area, 0.0, [l.text for i, l in enumerate(labels) if i not in placed])
    else:
        by_layer: dict[str, list[tuple]] = defaultdict(list)
        for e in msp.query("LINE LWPOLYLINE POLYLINE ARC"):
            by_layer[e.dxf.layer].extend(_dxf_segments(e, f))
        wall_layers = [l for l in by_layer if _WALL_LAYER.search(l)]
        if wall_layers:
            closers = [l for l in by_layer if _DOOR_LAYER.search(l) or _WINDOW_LAYER.search(l)]
            candidates = [[s for l in wall_layers for s in by_layer[l]],
                          [s for l in wall_layers + closers for s in by_layer[l]]]
        else:
            warnings.append("No WALL layer found — walls were guessed from the drawing's line layers.")
            usable = sorted((l for l in by_layer if not _NOT_WALL_LAYER.search(l)), key=lambda l: -len(by_layer[l]))
            candidates = [[s for l in usable[:k] for s in by_layer[l]] for k in range(1, min(3, len(usable)) + 1)]
        result = best_rooms([c for c in candidates if c], labels, plan_total)

    errors = []
    if result is None or not result.rooms:
        errors.append("No closed rooms could be traced in this DXF — enter the measurements by hand.")
        result = None
    elif result.unplaced_labels:
        warnings.append("Room label(s) not inside a traced room: " + ", ".join(result.unplaced_labels[:8]) + ".")

    door_widths, window_widths = [], []
    for e in msp.query("INSERT"):
        name, layer = e.dxf.name, e.dxf.layer
        is_door = bool(_DOOR_LAYER.search(layer) or _DOOR_LAYER.search(name))
        is_window = not is_door and bool(_WINDOW_LAYER.search(layer) or _WINDOW_LAYER.search(name))
        if not (is_door or is_window):
            continue
        ext = bbox.extents(e.virtual_entities())
        width = round(max(ext.size.x, ext.size.y) * f * 20) / 20 if ext.has_data else (0.9 if is_door else DEFAULT_WINDOW[0])
        (door_widths if is_door else window_widths).append(width)
    if not door_widths:
        for e in msp.query("ARC"):
            if _DOOR_LAYER.search(e.dxf.layer):
                r = e.dxf.radius * f
                if DOOR_WIDTH_RANGE_M[0] <= r <= DOOR_WIDTH_RANGE_M[1]:
                    door_widths.append(round(r * 20) / 20)

    name = Path(path).stem
    return {
        "sheets": [{"id": "DXF", "title": name, "drawings": [{"id": "DXF:A", "title": "Model space", "scale": "1:1"}]}],
        "selected_drawing": "DXF:A",
        "rooms": _rooms_json(result),
        "openings": _openings(door_widths, 0, window_widths),
        "ceiling_heights_m": _heights(all_text),
        "finish_notes": _finish_notes(all_text),
        "schedule_check": _schedule_check(plan_total, result),
        "warnings": warnings,
        "errors": errors,
    }


# ── entry point ───────────────────────────────────────────────────────────────

def parse_blueprint(path: str, filename: str, sheet: str | None = None, drawing_id: str | None = None,
                    scale_override: Any = None) -> dict:
    """Never raises for a bad/unsupported file — the problem comes back in
    `errors` (with empty results), so the wizard can show it."""
    ext = Path(filename or path).suffix.lower()
    empty = {"sheets": [], "selected_drawing": None, "rooms": [], "openings": [], "ceiling_heights_m": [],
             "finish_notes": [], "schedule_check": None, "warnings": [], "errors": []}
    try:
        if ext == ".dxf":
            return _parse_dxf(path)
        if ext == ".pdf":
            return _parse_pdf(path, sheet, drawing_id, scale_override)
        raise BlueprintError("Only CAD-exported PDF and DXF blueprints can be read. Upload the PDF exported from CAD, or the DXF.")
    except BlueprintError as e:
        return {**empty, "errors": [str(e)]}
    except Exception as e:  # corrupt/odd file — report it, never a 500
        logger.exception("Blueprint extraction failed for %s", filename)
        return {**empty, "errors": [f"Couldn't read this file ({type(e).__name__}). Check it's a CAD-exported PDF or DXF."]}
