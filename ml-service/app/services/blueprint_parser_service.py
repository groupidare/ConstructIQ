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

import base64
import hashlib
import io
import logging
import math
import re
import statistics
import threading
from collections import Counter, OrderedDict, defaultdict
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from app.services import blueprint_ocr
from app.services.blueprint_geometry import Label, RoomResult, TOILET_WORD, best_rooms, refine_rooms, rooms_from_walls
from app.utils.pdf_render import page_image

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
# No leading \b: titles stored without spaces ("GROUNDFLOORPLAN") still count.
_DRAWING_WORDS = re.compile(r"(PLAN|ELEVATION|SECTION|LAYOUT|DETAIL)S?\b", re.I)
_TITLE_WORD_START = re.compile(r"(?<=[A-Z])(?=FLOOR|PLAN|ELEVATION|SECTION|SIDE|SCHEDULE|LAYOUT|DETAIL|CEILING|"
                               r"DEVELOPMENT|FRAMING)")
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


def _stack_letters(lines: list[TextLine]) -> list[TextLine]:
    """A name written down a narrow space one upright letter per line ("B"
    over "A" over "L"… beside a balcony) joined into one word."""
    singles = sorted((l for l in lines if len(l.text.strip()) == 1 and l.text.strip().isalnum()), key=lambda l: l.top)
    used: set[int] = set()
    stacks: list[TextLine] = []
    for first in singles:
        if id(first) in used:
            continue
        run = [first]
        for c in singles:
            last = run[-1]
            size = max(c.size, last.size)
            if (id(c) not in used and c is not last and c.top > last.top and abs(c.cx - last.cx) < 0.6 * size
                    and -0.5 * size <= c.top - last.bottom < 1.3 * size and 0.6 < c.size / last.size < 1.6):
                run.append(c)
        if len(run) >= 3 and sum(c.text.strip().isalpha() for c in run) >= 2:
            used.update(id(c) for c in run)
            stacks.append(TextLine("".join(c.text.strip() for c in run), min(c.x0 for c in run), run[0].top,
                                   max(c.x1 for c in run), run[-1].bottom, statistics.median(c.size for c in run),
                                   ocr=any(c.ocr for c in run)))
    return [l for l in lines if id(l) not in used] + stacks


# Room words too general to name a room on their own when written small.
_GENERIC_ROOM_WORDS = {"AREA", "ROOM", "ROOMS", "DATA", "SALES", "STOCK", "ROOF"}


def _is_room_word(text: str) -> bool:
    return any(w in blueprint_ocr.ROOM_WORDS and w not in _GENERIC_ROOM_WORDS
               for w in re.split(r"[\s/]+", text.upper()))


def _labels_from(lines: list[TextLine], exclude: list[TextLine]) -> list[tuple[TextLine, bool]]:
    """Room names, as (label, minor): the largest in-drawing text (not
    titles, dimensions, grid callouts or annotations), stacked lines joined
    ("FITTING" over "ROOM"). Smaller text that reads as a room word —
    "TOILET" lettered smaller than "BEDROOM" — comes back as a minor label.
    OCR'd labels are read through the room vocabulary first, so a garbled
    "TOLET" or a stacked "BAC0NY" names the room it belongs to."""
    lines = [replace(l, text=blueprint_ocr.room_words(l.text)) if l.ocr else l
             for l in _stack_letters([l for l in lines if l not in exclude])]
    candidates = [l for l in lines
                  # A short room word ("T&B", "CR") is a name despite its few letters.
                  if (sum(ch.isalpha() for ch in l.text) >= max(3, 0.5 * len(l.text.replace(" ", ""))) or _is_room_word(l.text))
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
    labels = [(l, False) for l in candidates if l.size >= 0.85 * biggest]
    labels += [(l, True) for l in candidates if 0.45 * biggest <= l.size < 0.85 * biggest and _is_room_word(l.text)]
    merged: list[tuple[TextLine, bool]] = []
    for l, minor in sorted(labels, key=lambda x: (x[0].top, x[0].x0)):
        k = next((k for k in range(len(merged) - 1, -1, -1)
                  if 0 <= l.top - merged[k][0].bottom < 0.9 * l.size and abs(l.cx - merged[k][0].cx) < 3 * l.size), None)
        if k is not None:
            prev, prev_minor = merged[k]
            prev.text = f"{prev.text} {l.text}"
            prev.x0, prev.x1, prev.bottom = min(prev.x0, l.x0), max(prev.x1, l.x1), l.bottom
            merged[k] = (prev, prev_minor and minor)
        else:
            merged.append((TextLine(l.text, l.x0, l.top, l.x1, l.bottom, l.size, l.ocr), minor))
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


def _spaced_title(text: str) -> str:
    """Some CAD exports store a title's letters with no spaces at all
    ("GROUNDFLOORPLAN") — put spaces back before the usual title words."""
    if " " in text.strip() or len(text) < 6:
        return text
    return _TITLE_WORD_START.sub(" ", text)


def _drawings(sheet_id: str, page, lines: list[TextLine], code: TextLine | None) -> tuple[list[Drawing], str]:
    sizes = [l.size for l in lines] or [1.0]
    median = statistics.median(sizes)
    # 14 pt suits A1 sheets with real text; on smaller sheets (A3) the floor
    # follows the sheet width.
    sheet_floor = 14.0 * min(1.0, page.width / 2384)
    floor = sheet_floor if any(l.ocr for l in lines) else 14.0
    big_cut = max(floor, 1.8 * median)
    # A title with its own scale note under it may be smaller than that —
    # an A3 sheet's 11 pt "GROUND FLOOR PLAN" over 6.7 pt body text.
    scaled_cut = min(big_cut, max(sheet_floor, 1.4 * median))
    candidates = [l for l in lines if l.size >= scaled_cut and l is not code and not _SHEET_CODE.match(l.text.strip())]
    big = [l for l in candidates if l.size >= big_cut]

    # The sheet's own title sits in the title block, right above the code.
    sheet_title = None
    if code:
        near = [l for l in big if 0 < code.top - l.bottom < 250 and abs(l.cx - code.cx) < 300]
        sheet_title = min(near, key=lambda l: code.top - l.bottom) if near else None
    title_block_left = code.x0 - 150 if code and code.x0 > page.width * 0.6 else page.width

    title_lines = [l for l in candidates if l is not sheet_title and l.x0 < title_block_left
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
              if id(l) in scale_of or (l.size >= big_cut and _DRAWING_WORDS.search(l.text))]
    # A title drawn twice on top of itself (CAD text duplicated) is one drawing.
    titles = [(t, s) for i, (t, s) in enumerate(titles)
              if not any(o.text == t.text and abs(o.x0 - t.x0) < 2 and abs(o.top - t.top) < 2 for o, _ in titles[:i])]
    for t, _ in titles:
        t.text = _spaced_title(t.text)

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


# ── floors ────────────────────────────────────────────────────────────────────

# (title pattern, key, name, order) — the level a floor plan's title names.
_LEVELS = [
    (re.compile(r"\bBASEMENT\b"), "B1", "Basement", -1),
    (re.compile(r"\bGROUND\b|\bG/F\b"), "GF", "Ground Floor", 0),
    (re.compile(r"\b(FIRST|1ST)\b"), "1F", "First Floor", 1),
    (re.compile(r"\bMEZZANINE\b"), "MZ", "Mezzanine", 1.5),
    (re.compile(r"\b(SECOND|2ND)\b"), "2F", "Second Floor", 2),
    (re.compile(r"\b(THIRD|3RD)\b"), "3F", "Third Floor", 3),
    (re.compile(r"\b(FOURTH|4TH)\b"), "4F", "Fourth Floor", 4),
    (re.compile(r"\b(FIFTH|5TH)\b"), "5F", "Fifth Floor", 5),
    (re.compile(r"\bATTIC\b"), "AT", "Attic", 80),
    (re.compile(r"\bROOF\s*DECK\b"), "RD", "Roof Deck", 90),
]
# Plan views of a floor drawn for another trade or another purpose — the
# same walls again (ceiling, framing, power…), or not a floor at all.
_NOT_A_FLOOR = re.compile(_NOT_THE_FLOOR_PLAN.pattern + r"|FRAMING|FOUNDATION|STRUCTURAL|BEAM|SLAB|FOOTING|KEY|"
                          r"\bLOT\b|DRAINAGE|SEWER|WATER|SEPTIC|DETAIL|BLOW|TILE|ENLARGED|STAIR|SCHEDULE|ELEVATION|"
                          r"SECTION|CELING|REFLECTED", re.I)
_PLAN_VIEW = re.compile(r"\bPLAN\b|LAYOUT", re.I)
_NOT_A_PLAN_VIEW = re.compile(r"ELEVATION|SECTION|DETAIL|SCHEDULE|ISOMETRIC|ISOMENTRIC", re.I)
DETAIL_SCALE_BELOW = 40  # 1:25, 1:20… are enlarged details, not a whole floor


def _level(title: str) -> tuple[str, str, float] | None:
    t = title.upper()
    return next(((key, name, order) for pattern, key, name, order in _LEVELS if pattern.search(t)), None)


def _is_floor_plan(d: Drawing) -> bool:
    t = d.title.text.upper()
    if not re.search(r"\bPLAN\b", t) or (d.scale and d.scale < DETAIL_SCALE_BELOW):
        return False
    if _NOT_A_FLOOR.search(re.sub(r"ROOF\s*DECK", "", t)):
        return False
    return "FLOOR" in t or _level(t) is not None


def _floor_plans(sheets: list[Sheet]) -> tuple[list[dict], list[str]]:
    """One drawing per floor, to read every floor of the plan set at once,
    and the plan views left out. A floor is drawn several times — floor
    plan, ceiling plan, framing, power layout — and reading more than one
    would count it again, so only floor-plan titles count and each level
    ("GROUND", "SECOND"…) is taken once. A second drawing with the same
    level, or titled just "FLOOR PLAN" when other floors are named, comes
    back unticked (`confirm`) for the user to decide — never guessed."""
    drawings = [(d, s) for s in sheets for d in s.drawings]
    candidates = [(d, s) for d, s in drawings if _is_floor_plan(d)]
    if not candidates:
        d = _default_drawing([d for d, _ in drawings])
        return ([{"floor": "Floor plan", "drawing_id": d.id, "confirm": False, "note": None, "alternatives": []}]
                if d else []), []

    main: dict[str | None, tuple[Drawing, Sheet]] = {}
    extra: list[tuple[Drawing, Sheet]] = []
    for d, s in candidates:
        level = _level(d.title.text)
        key = level[0] if level else None
        if key in main:
            extra.append((d, s))
        else:
            main[key] = (d, s)
    if None in main and len(main) > 1:
        extra.insert(0, main.pop(None))

    def same_floor(o: Drawing, o_sheet: Sheet, level, sheet: Sheet) -> bool:
        """Another plan view that can stand in for this floor's drawing: one
        naming the same level, or naming none and on the same sheet."""
        if not _PLAN_VIEW.search(o.title.text) or _NOT_A_PLAN_VIEW.search(o.title.text):
            return False
        other = _level(o.title.text)
        if other:
            return other == level
        return o_sheet is sheet or level is None

    def entry(d: Drawing, s: Sheet, confirm: bool, name: str, note: str | None) -> dict:
        level = _level(d.title.text)
        alternatives = [o.id for o, o_sheet in sorted(drawings, key=lambda x: x[1] is not s)
                        if o is not d and same_floor(o, o_sheet, level, s)]
        return {"floor": name, "drawing_id": d.id, "confirm": confirm, "note": note, "alternatives": alternatives}

    floors = []
    for key, (d, s) in sorted(main.items(), key=lambda kv: _level(kv[1][0].title.text)[2] if kv[0] else 0):
        floors.append(entry(d, s, False, _level(d.title.text)[1] if key else "Floor plan", None))
    names = [f["floor"] for f in floors]
    for d, s in extra:
        level = _level(d.title.text)
        base = level[1] if level else "Floor plan"
        n = 2
        while f"{base} ({n})" in names:
            n += 1
        names.append(f"{base} ({n})")
        floors.append(entry(d, s, True, names[-1],
                            f"Also titled \"{d.title.text}\" (sheet {s.id}) — tick it only if it's a different floor."))
    used = {f["drawing_id"] for f in floors}
    skipped = [d.id for d, _ in drawings if d.id not in used and _PLAN_VIEW.search(d.title.text)
               and not _NOT_A_PLAN_VIEW.search(d.title.text)]
    return floors, skipped


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


_WIDE_DOOR_TAG = re.compile(r"^(RD|SD)\W*\d?\W*$", re.I)
REFINE_GAP_M = 0.3            # thin pens draw the door lines themselves: nothing wide to bridge
REFINE_MID_PEN = 2            # mid-weight: walls and fixtures, not tile patterns or grid lines
REFINE_ALL_PENS = 1


def _refined(result: RoomResult, walls: list[dict], labels: list[Label], lines: list[TextLine], m_per_pt: float) -> RoomResult:
    """Rooms corrected with the thinner pens, where the plan gives a reason
    (see refine_rooms). Traced only then: the thinnest pens are slow."""
    def traced(pen: int) -> RoomResult:
        segs = _segments([o for o in walls if round(float(o.get("linewidth") or 0)) >= pen])
        return rooms_from_walls([(a * m_per_pt, b * m_per_pt, c * m_per_pt, d * m_per_pt) for a, b, c, d in segs], labels, REFINE_GAP_M)

    tags = [(l.cx * m_per_pt, l.cy * m_per_pt) for l in lines if _WIDE_DOOR_TAG.match(l.text.strip())]
    mixed = any(len(r.labels) > 1 and any(TOILET_WORD.search(n) for n in r.labels) and not all(TOILET_WORD.search(n) for n in r.labels)
                for r in result.rooms)
    if not tags and not mixed:
        return result
    return refine_rooms(result, labels, tags, traced(REFINE_MID_PEN) if mixed else None, traced(REFINE_ALL_PENS) if tags else None)


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


def _rooms_json(result: RoomResult | None, to_px=None, ceilings: dict[int, dict] | None = None, to_pt=None,
                glass: dict[int, float] | None = None) -> list[dict]:
    """to_px: metres → preview-image pixels, for each room's outline; to_pt:
    metres → PDF points on its page (where the Material Plan's plan viewer
    draws it). ceilings: room index → what the ceiling plan says about it.
    glass: room index → metres of its perimeter that are glass."""
    ceilings = ceilings or {}
    glass = glass or {}
    if not result:
        return []
    def bbox(r):
        x0, y0, x1, y1 = r.polygon.bounds
        return round(max(x1 - x0, y1 - y0), 2), round(min(x1 - x0, y1 - y0), 2)
    def outline(r, f=to_px):
        if f is None:
            return []
        return [[round(v, 1) for v in f(x, y)] for x, y in r.polygon.simplify(0.02).exterior.coords]
    # length_m/width_m: the room's bounding box — what a measurement row's
    # L × W holds; floor_area_sqm is the real (possibly non-rectangular) area.
    return [{"name": r.name, "floor_area_sqm": round(r.area_sqm, 2), "perimeter_m": round(r.perimeter_m, 2),
             "length_m": bbox(r)[0], "width_m": bbox(r)[1],
             "confidence": r.confidence, "labels": r.labels, "outline": outline(r), "outline_pt": outline(r, to_pt),
             "ceiling_notes": ceilings.get(i, {}).get("notes", []), "ceiling_height_m": ceilings.get(i, {}).get("height_m"),
             "ceiling_note_details": ceilings.get(i, {}).get("details", []),
             "wall_height_m": ceilings.get(i, {}).get("wall_height_m"), "glass_length_m": glass.get(i, 0)}
            for i, r in enumerate(result.rooms)]


# ── preview ───────────────────────────────────────────────────────────────────

PREVIEW_MAX_PX = 1600   # the drawing's longer side in the wizard's preview
PREVIEW_MAX_DPI = 200


def _png_data_url(image) -> str:
    buf = io.BytesIO()
    image.convert("L").save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _pdf_preview(region, width_pt: float, height_pt: float) -> tuple[dict | None, float]:
    """The drawing's area of the sheet as an image, and its pixels per PDF
    point. A failed render costs the preview, never the result."""
    dpi = min(PREVIEW_MAX_DPI, PREVIEW_MAX_PX * 72 / max(width_pt, height_pt, 1))
    try:
        image = page_image(region, dpi)
    except Exception:
        logger.exception("Blueprint preview render failed")
        return None, dpi / 72
    return {"image": _png_data_url(image), "width": image.width, "height": image.height}, image.width / width_pt


VIEWER_MAX_PX = 5000


def page_sizes(path: str) -> list[dict]:
    """Every page's size in PDF points (what outlines and note boxes are in)."""
    import pdfplumber
    with pdfplumber.open(path) as pdf:
        return [{"width": round(float(p.width), 1), "height": round(float(p.height), 1)} for p in pdf.pages[:MAX_PAGES]]


def render_page(path: str, page: int, width: int) -> bytes:
    """Page `page` (1-based) as a greyscale PNG `width` pixels wide."""
    import pdfplumber
    with pdfplumber.open(path) as pdf:
        if not 1 <= page <= min(len(pdf.pages), MAX_PAGES):
            raise IndexError(page)
        p = pdf.pages[page - 1]
        dpi = max(20.0, min(VIEWER_MAX_PX, width) * 72 / float(p.width))
        buf = io.BytesIO()
        page_image(p, dpi).convert("L").save(buf, "PNG", optimize=True)
        return buf.getvalue()


def _segments_preview(segments: list[tuple], rooms: list) -> tuple[dict | None, Any]:
    """A DXF has no page to render: its line work drawn as an image, fitted
    around the rooms (or all of it), y flipped to point down."""
    from PIL import Image, ImageDraw
    from shapely import box
    from shapely.ops import unary_union

    if not segments:
        return None, None
    if rooms:
        x0, y0, x1, y1 = unary_union([r.polygon for r in rooms]).buffer(2.0).bounds
        area = box(x0, y0, x1, y1)
        segments = [s for s in segments if area.intersects(box(min(s[0], s[2]), min(s[1], s[3]), max(s[0], s[2]), max(s[1], s[3])))]
    else:
        xs = [v for s in segments for v in (s[0], s[2])]
        ys = [v for s in segments for v in (s[1], s[3])]
        x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    k = PREVIEW_MAX_PX / max(x1 - x0, y1 - y0, 1e-6)
    to_px = lambda x, y: ((x - x0) * k, (y1 - y) * k)
    image = Image.new("L", (max(1, round((x1 - x0) * k)), max(1, round((y1 - y0) * k))), 255)
    draw = ImageDraw.Draw(image)
    for s in segments:
        draw.line((*to_px(s[0], s[1]), *to_px(s[2], s[3])), fill=40, width=1)
    return {"image": _png_data_url(image), "width": image.width, "height": image.height}, to_px


# ── walls ─────────────────────────────────────────────────────────────────────

SMALL_CURVE_M = 1.5  # arcs smaller than this are fixtures and door swings, never walls
CALLOUT_MAX_M = 1.5        # a box around text bigger than this may be a small room with its name
CALLOUT_AREA_RATIO = 6.0   # a callout box is at most this many times the area of its text
ARROWHEAD_MAX_PT = 6.0     # a leader's filled arrowhead: about 1–2 mm on paper…
ARROWHEAD_MAX_M = 0.3      # …and small at the drawing's scale (a filled column is bigger)
ARROWHEAD_REACH_PT = 1.5   # a leader stops this close to its arrowhead


def _wall_objects(objs: list[dict], region_lines: list[TextLine], m_per_pt: float) -> list[dict]:
    """The drawing's objects that can be walls. Left out: the strokes of
    text drawn as lines — an OCR'd label, a door tag's "SD 2" — which drawn
    with the wall pen fence a narrow balcony in two; and door swings and
    other small arcs (WC bowls, basins). Fixtures drawn as straight pieces
    stay: telling a WC's tank from a column or a wall stub takes more than
    its size, and dropping columns pushes the footprint out."""
    ocr = [l for l in region_lines if l.ocr]
    boxes = []
    if ocr:
        median = statistics.median(l.size for l in ocr)
        for l in ocr:
            if l.size > 3 * median:
                continue  # a "word" boxed around a symbol or a car, not text
            pad = (0.6 if len(l.text.replace(" ", "")) <= 3 else 0.3) * l.size
            boxes.append((l.x0 - pad, l.top - pad, l.x1 + pad, l.bottom + pad))

    def is_text(o: dict) -> bool:
        return any(o["x0"] >= b[0] and o["x1"] <= b[2] and o["top"] >= b[1] and o["bottom"] <= b[3] for b in boxes)

    # Callout boxes drawn tight around their text ("CURTAIN COVE J-04",
    # "C&C KIOSK") — walling them would cut a hole in the room's floor.
    texts = [l for l in region_lines if l.text.strip()]

    def is_callout(o: dict) -> bool:
        w, h = o["x1"] - o["x0"], o["bottom"] - o["top"]
        if o["object_type"] not in ("rect", "curve") or max(w, h) * m_per_pt > CALLOUT_MAX_M:
            return False
        inside = [l for l in texts if o["x0"] <= l.x0 and l.x1 <= o["x1"] and o["top"] <= l.top and l.bottom <= o["bottom"]]
        return bool(inside) and w * h <= CALLOUT_AREA_RATIO * sum((l.x1 - l.x0) * (l.bottom - l.top) for l in inside)

    def is_swing(o: dict) -> bool:
        # pdfplumber calls every multi-segment path a curve — walls drawn as
        # polylines included; only one with real arcs ("c") is curved.
        return (o["object_type"] == "curve" and any(step[0] == "c" for step in o.get("path") or [])
                and max(o["x1"] - o["x0"], o["bottom"] - o["top"]) * m_per_pt < SMALL_CURVE_M)

    leaders = _leaders(objs, m_per_pt)
    return [o for i, o in enumerate(objs)
            if i not in leaders and not is_text(o) and not is_swing(o) and not is_callout(o)]


def _leaders(objs: list[dict], m_per_pt: float) -> set[int]:
    heads, lines = _leader_lines(objs, m_per_pt)
    return heads | {i for i, _, _ in lines}


def _leader_lines(objs: list[dict], m_per_pt: float) -> tuple[set[int], list[tuple[int, tuple, tuple]]]:
    """The arrowheads, and each leader as (index, tip, tail) — tip at the
    arrowhead.

    Callout leaders and dimension lines: a straight line whose end runs
    on into a small filled arrowhead pointing the same way. Drawn with the
    wall pen, a leader crossing a room ("SHELVES – WORKTOP", an elevation
    marker's line) fences part of its floor off. Walls never end in an
    arrowhead. An extension line also stops at a dimension's arrowhead, but
    one lying across it — and it often runs over a wall's end, so it stays."""
    from shapely import STRtree, Point, box

    def size(o):
        return max(o["x1"] - o["x0"], o["bottom"] - o["top"])

    heads = [i for i, o in enumerate(objs)
             if o.get("fill") and o["object_type"] in ("curve", "rect")
             and size(o) <= ARROWHEAD_MAX_PT and size(o) * m_per_pt <= ARROWHEAD_MAX_M]
    if not heads:
        return set(), []
    boxes = [box(objs[i]["x0"], objs[i]["top"], objs[i]["x1"], objs[i]["bottom"]) for i in heads]
    tree = STRtree([b.buffer(ARROWHEAD_REACH_PT) for b in boxes])

    def points_on(end, other) -> bool:
        near = tree.query(Point(end), predicate="intersects")
        if len(near) == 0:
            return False
        # One arrowhead is often several filled pieces: take them together.
        bounds = [boxes[k].bounds for k in near]
        x0, y0 = min(b[0] for b in bounds), min(b[1] for b in bounds)
        x1, y1 = max(b[2] for b in bounds), max(b[3] for b in bounds)
        length = math.dist(end, other)
        if length == 0:
            return False
        dx, dy = (end[0] - other[0]) / length, (end[1] - other[1]) / length
        vx, vy = (x0 + x1) / 2 - end[0], (y0 + y1) / 2 - end[1]
        head = max(x1 - x0, y1 - y0)
        return vx * dx + vy * dy > 0.2 * head and abs(vx * dy - vy * dx) < 0.35 * head

    head_set, lines = set(heads), []
    for i, o in enumerate(objs):
        pts = [tuple(p) for p in o.get("pts") or []]
        # A straight line, or a leader bent once or twice drawn as one polyline.
        bent = o["object_type"] == "curve" and not any(step[0] == "c" for step in o.get("path") or [])
        if len(pts) < 2 or (len(pts) > 2 and not bent) or len(pts) > 4 or i in head_set or size(o) * m_per_pt < ARROWHEAD_MAX_M:
            continue
        if points_on(pts[-1], pts[-2]):
            lines.append((i, pts[-1], pts[0]))
        elif points_on(pts[0], pts[1]):
            lines.append((i, pts[0], pts[-1]))
    return head_set, lines


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
# One scan per file at a time: a second request for the same plan (the wizard
# opened twice) waits and reuses the first one's result instead of scanning —
# and paying Azure for — the same pages again.
_SCAN_LOCKS: dict[str, threading.Lock] = {}
_SCAN_LOCKS_GUARD = threading.Lock()


def _scan_lock(key: str) -> threading.Lock:
    with _SCAN_LOCKS_GUARD:
        return _SCAN_LOCKS.setdefault(key, threading.Lock())


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


def _drawing_area(page, sheet: Sheet, drawing: Drawing):
    """A drawing's part of its sheet: the cropped page, its line work, its
    text, and the crop (x, y, width, height) in PDF points."""
    x0, top, x1, bottom = drawing.region
    ox, oy = max(0, x0), max(0, top)
    w, h = min(page.width, x1) - ox, min(page.height, bottom) - oy
    region = page.within_bbox((ox, oy, ox + w, oy + h))
    objs = [dict(o, object_type="line") for o in region.lines] + [dict(o, object_type="curve") for o in region.curves] \
        + [dict(o, object_type="rect") for o in region.rects]
    lines = [l for l in sheet.lines if x0 <= l.cx <= x1 and top <= l.cy <= bottom]
    return region, objs, lines, (ox, oy, w, h)


def _drawing_scale(drawing: Drawing, lines: list[TextLine], objs: list[dict]) -> float | None:
    """The scale a drawing is really at: the measured one where it disagrees with the title."""
    measured = _scale_from_dimensions(lines, objs)
    if drawing.scale and measured and abs(drawing.scale - measured) / measured > SCALE_TOLERANCE:
        return measured
    return drawing.scale or measured


# ── ceiling plan ──────────────────────────────────────────────────────────────

_CEILING_TITLE = re.compile(r"CEILING|CELING|\bRCP\b", re.I)
# Ceiling finishes and heights — not fixtures that merely say "ceiling".
_CEILING_NOTE = re.compile(r"ACOUSTIC|GYPSUM|FIB(ER|RE)\s*CEMENT|EXPOSED|OPEN[-\s]?UTILIT|SOFFIT|PLYWOOD|PVC|"
                           r"METAL\s+(DECK|PANEL)|CEILING\s+(BOARD|PANEL|FINISH)|\bC\.?\s?H\.?\s*[=:]", re.I)
_NOT_CEILING_NOTE = re.compile(r"LIGHT|LAMP|DIFFUSER|GRILLE|SPEAKER|DETECTOR|SPRINKLER|CAMERA|\bBEAM", re.I)
_ROOM_CEILING_HEIGHT = [
    re.compile(r"\bC\.?\s?H\.?\s*[=:]\s*(\d{3,4})\s*MM", re.I),
    re.compile(r"SOFFIT\s*:?\s*H\s*[=:]\s*(\d{3,4})\s*MM", re.I),
]
EXTENT_TOLERANCE = 0.04     # floor plan and ceiling plan outlines this close in size are the same floor
NOTE_LEADER_REACH_PT = 8.0  # a leader starts this close to its callout text
ROOM_NOTE_REACH_M = 0.3     # a note this close to a room's edge belongs to it


def _extents(wall_sets: list[list[tuple]]) -> list[tuple[float, float, float, float]]:
    """The outline extents (metres) of each candidate wall set — what lines a
    floor plan up with its ceiling plan (same walls, elsewhere on the sheet)."""
    out = []
    for segs in wall_sets:
        xs = [v for s in segs for v in (s[0], s[2])]
        ys = [v for s in segs for v in (s[1], s[3])]
        if xs:
            out.append((min(xs), min(ys), max(xs), max(ys)))
    return out


def _text_blocks(lines: list[TextLine]) -> list[TextLine]:
    """Notes as written: stacked lines of one size joined ("600mmx600mm
    ACOUSTIC" over "CEILING PANEL IN WHITE")."""
    blocks: list[TextLine] = []
    for l in sorted(lines, key=lambda l: (l.top, l.x0)):
        prev = next((b for b in reversed(blocks)
                     if 0 <= l.top - b.bottom < 0.9 * l.size and l.x0 < b.x1 and b.x0 < l.x1 and abs(b.size - l.size) < 0.3 * l.size), None)
        if prev:
            prev.text, prev.bottom = f"{prev.text} {l.text}", l.bottom
            prev.x0, prev.x1 = min(prev.x0, l.x0), max(prev.x1, l.x1)
        else:
            blocks.append(TextLine(l.text, l.x0, l.top, l.x1, l.bottom, l.size, l.ocr))
    return blocks


def _note_blocks(lines: list[TextLine]) -> list[TextLine]:
    """A drawing's ceiling finishes and heights, stacked lines joined."""
    return [b for b in _text_blocks(lines) if _CEILING_NOTE.search(b.text) and not _NOT_CEILING_NOTE.search(b.text)]


def _box(l: TextLine) -> list[float]:
    return [round(l.x0, 1), round(l.top, 1), round(l.x1, 1), round(l.bottom, 1)]


PLAN_NOTES_MAX = 150


def _plan_notes(sheets: list[Sheet], first: Sheet | None) -> list[dict]:
    """Every finish note on the architectural sheets — floor plan, finishing
    plans, ceiling plan, elevations — with its page and place on the page, the
    floor plan's own sheet first. What finish a room gets is decided from
    these (boq_generator_service), and each row shows the note it came from."""
    out, seen = [], set()
    for s in sorted(sheets, key=lambda s: s is not first):
        for b in _text_blocks(s.lines):
            text = " ".join(b.text.split())
            key = (text.upper(), s.page_index)
            if 4 <= len(text) <= 140 and _FINISH.search(text) and key not in seen:
                seen.add(key)
                out.append({"text": text, "page": s.page_index + 1, "sheet": s.id, "box": _box(b)})
    return out[:PLAN_NOTES_MAX]


def _leader_target(block: TextLine, objs: list[dict], leaders: list[tuple[int, tuple, tuple]]) -> tuple | None:
    """Where a callout points: follow the leader that starts at the note, piece
    by piece if it bends, to its arrowhead."""
    ends: dict[tuple, list[tuple]] = defaultdict(list)
    for o in objs:
        pts = o.get("pts") or []
        if len(pts) == 2:
            a, b = tuple(pts[0]), tuple(pts[1])
            ends[(round(a[0]), round(a[1]))].append(b)
            ends[(round(b[0]), round(b[1]))].append(a)

    def near_block(p) -> bool:
        return (block.x0 - NOTE_LEADER_REACH_PT <= p[0] <= block.x1 + NOTE_LEADER_REACH_PT
                and block.top - NOTE_LEADER_REACH_PT <= p[1] <= block.bottom + NOTE_LEADER_REACH_PT)

    for _, tip, tail in leaders:
        point, seen = tail, {tip}
        for _ in range(6):
            if near_block(point):
                return tip
            seen.add(point)
            onward = [q for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                      for q in ends.get((round(point[0]) + dx, round(point[1]) + dy), []) if q not in seen and math.dist(q, point) > 0.5]
            if not onward:
                break
            point = onward[0]
    return None


_GLASS_WALL = re.compile(r"\b(GLASS|GLAZED)\s+(WALL|PARTITION)|\bCURTAIN\s+WALL|\bSTOREFRONT\s+(GLASS|GLAZING)", re.I)
GLASS_LABEL_REACH_M = 1.5    # a wall's label sits this close to it
GLASS_MIN_EDGE_M = 1.0       # shorter edges are returns and notches, not the glazed run
GLASS_MAX_SHARE = 0.6        # more of a room's perimeter than this is a misread label, not a glazed side
_FINISH_HEIGHT = re.compile(r"^\+\s*(\d{4})\s*MM$", re.I)
_CEILING_LINE = re.compile(r"CEILING\s+LINE", re.I)


def _glass_lengths(result: RoomResult, lines: list[TextLine], m_per_pt: float) -> dict[int, float]:
    """room index → metres of its perimeter that are glass, so not painted: for
    each "PERIMETER GLASS WALL" on the plan, the room edge it runs along. A
    label with no clear edge beside it counts nothing, and neither does a room
    with most of its perimeter marked: walls then stay as traced."""
    from shapely import LineString, Point
    edges = []
    for i, room in enumerate(result.rooms):
        ring = list(room.polygon.simplify(0.02).exterior.coords)
        for a, b in zip(ring, ring[1:]):
            if math.dist(a, b) >= GLASS_MIN_EDGE_M:
                edges.append((i, a, b, LineString([a, b])))
    found: dict[int, set[tuple]] = defaultdict(set)
    for l in lines:
        if not _GLASS_WALL.search(l.text):
            continue
        across = l.x1 - l.x0 >= l.bottom - l.top  # the label runs along its wall
        point = Point(l.cx * m_per_pt, l.cy * m_per_pt)
        along = [e for e in edges if (abs(e[1][0] - e[2][0]) >= abs(e[1][1] - e[2][1])) == across]
        near = min(along, key=lambda e: e[3].distance(point), default=None)
        if near is not None and near[3].distance(point) <= GLASS_LABEL_REACH_M:
            found[near[0]].add((near[1], near[2]))
    out = {}
    for i, sides in found.items():
        length = sum(math.dist(a, b) for a, b in sides)
        if length <= GLASS_MAX_SHARE * result.rooms[i].perimeter_m:
            out[i] = round(length, 2)
    return out


def _finish_ceiling_heights(sheets: list[Sheet]) -> list[float]:
    """Heights the sections and elevations mark as a ceiling line ("+4000mm"
    over "MALL FINISH CEILING LINE"), in metres."""
    heights = set()
    for s in sheets:
        marks = [l for l in s.lines if _CEILING_LINE.search(l.text)]
        for l in s.lines:
            m = _FINISH_HEIGHT.match(l.text.strip())
            if m and 1800 <= int(m.group(1)) <= 8000 and any(
                    0 <= c.top - l.top <= 2.5 * l.size and c.x0 < l.x1 and l.x0 < c.x1 for c in marks):
                heights.add(int(m.group(1)) / 1000)
    return sorted(heights)


def _wall_height(notes: list[str], finish_heights: list[float]) -> float | None:
    """How high a room's walls are finished. Its own ceiling height when it has
    one; an open ceiling only notes the slab far above, so its walls stop at the
    highest ceiling line drawn below that slab."""
    own = _room_height(notes[:0] + [n for n in notes if _ROOM_CEILING_HEIGHT[0].search(n)])
    if own:
        return own
    soffit = _room_height(notes)
    if soffit is None:
        return None
    return max((h for h in finish_heights if h < soffit), default=soffit)


def _room_height(notes: list[str]) -> float | None:
    for pattern in _ROOM_CEILING_HEIGHT:
        for n in notes:
            m = pattern.search(n)
            if m and 1800 <= int(m.group(1)) <= 8000:
                return int(m.group(1)) / 1000
    return None


def _ceilings_from_plan(pages, sheets: list[Sheet], floor: Drawing, floor_walls: list[dict], m_per_pt: float,
                        result: RoomResult) -> tuple[str | None, dict[int, dict], str | None]:
    """The floor's reflected ceiling plan, read room by room: its finish notes
    ("ACOUSTIC CEILING PANEL", "OPEN-UTILITIES CEILING PAINTED IN BLACK") and
    heights ("CH=2600mm", "SLAB SOFFIT: H=4745mm") placed in the floor plan's
    rooms. The ceiling plan is the same walls drawn elsewhere on a sheet, so
    the two are lined up by their wall outlines; a note outside every room is
    followed along its leader to the room it points at. Returns the plan's
    drawing id, room index → {notes, height_m}, and a note for the user."""
    level = _level(floor.title.text)
    candidates = [(d, s) for s in sheets for d in s.drawings
                  if d is not floor and _CEILING_TITLE.search(d.title.text) and not _NOT_A_PLAN_VIEW.search(d.title.text)
                  and (_level(d.title.text) in (None, level))]
    if not candidates:
        return None, {}, None
    floor_extents = _extents(_wall_candidates(floor_walls, m_per_pt))

    best = None
    for d, s in candidates:
        page = pages[s.page_index]
        _, objs, lines, _ = _drawing_area(page, s, d)
        scale = _drawing_scale(d, lines, objs)
        if not scale:
            continue
        rcp_m = PT_TO_M * scale
        rcp_extents = _extents(_wall_candidates(_wall_objects(objs, lines, rcp_m), rcp_m))
        for fe in floor_extents:
            for re_ in rcp_extents:
                fw, fh, rw, rh = fe[2] - fe[0], fe[3] - fe[1], re_[2] - re_[0], re_[3] - re_[1]
                if min(fw, fh, rw, rh) <= 0:
                    continue
                off = max(abs(fw - rw) / fw, abs(fh - rh) / fh)
                if off <= EXTENT_TOLERANCE and (best is None or off < best[0]):
                    best = (off, d, objs, lines, rcp_m, (fe[0] - re_[0] + fe[2] - re_[2]) / 2, (fe[1] - re_[1] + fe[3] - re_[3]) / 2)
    if best is None:
        return None, {}, ("Found a reflected ceiling plan but couldn't line it up with this floor plan — "
                          "ceiling finishes use the floor plan's notes.")
    _, rcp, objs, lines, rcp_m, dx, dy = best
    from shapely import Point
    _, leaders = _leader_lines(objs, rcp_m)

    def room_at(pt) -> int | None:
        p = Point(pt[0] * rcp_m + dx, pt[1] * rcp_m + dy)
        inside = [i for i, r in enumerate(result.rooms) if r.polygon.contains(p)]
        if inside:
            return inside[0]
        near = min(range(len(result.rooms)), key=lambda i: result.rooms[i].polygon.distance(p), default=None)
        return near if near is not None and result.rooms[near].polygon.distance(p) <= ROOM_NOTE_REACH_M else None

    found: dict[int, list[str]] = defaultdict(list)
    details: dict[int, list[dict]] = defaultdict(list)
    page = next(s.page_index for s in sheets if rcp in s.drawings) + 1
    for block in _note_blocks(lines):
        i = room_at((block.cx, block.cy))
        if i is None and (tip := _leader_target(block, objs, leaders)):
            i = room_at(tip)
        if i is not None and block.text not in found[i]:
            found[i].append(block.text)
            details[i].append({"text": block.text, "page": page, "box": _box(block)})
    ceilings = {i: {"notes": notes, "height_m": _room_height(notes), "details": details[i]} for i, notes in found.items()}
    return rcp.id, ceilings, None


def _parse_pdf(path: str, sheet_id: str | None, drawing_id: str | None, scale_override: Any) -> dict:
    import pdfplumber

    key = _file_hash(path)
    with pdfplumber.open(path) as pdf:
        pages = pdf.pages[:MAX_PAGES]
        with _scan_lock(key):
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
        floors, skipped_plans = _floor_plans(plan_sheets)
        drawing = next((d for d in all_drawings if d.id == drawing_id), None) if drawing_id else None
        if drawing is None and sheet is None and floors:
            # The plan set's first floor — the wizard then reads the others.
            drawing = next(d for d in all_drawings if d.id == floors[0]["drawing_id"])
        if drawing is None:
            pool = sheet.drawings if sheet else all_drawings
            drawing = _default_drawing(pool)
        sheet = next(s for s in plan_sheets if drawing in s.drawings)

        response = {
            "sheets": [{"id": s.id, "title": s.title,
                        "drawings": [{"id": d.id, "title": d.title.text, "scale": f"1:{d.scale}" if d.scale else None}
                                     for d in s.drawings]} for s in plan_sheets],
            "selected_drawing": drawing.id,
            "floor_plans": floors,
            "skipped_plans": skipped_plans,
            "ceiling_heights_m": _heights(all_text),
            "finish_notes": _finish_notes([l.text for l in sheet.lines]),
            "plan_notes": _plan_notes(plan_sheets, sheet),
            "warnings": warnings,
            "errors": [],
            "rooms": [], "openings": [], "schedule_check": None, "preview": None, "scale_used": None, "ceiling_plan": None,
            "page": sheet.page_index + 1, "ceiling_plan_page": None,
        }

        page = pages[sheet.page_index]
        region, objs, region_lines, (ox, oy, ow, oh) = _drawing_area(page, sheet, drawing)
        response["preview"], px_per_pt = _pdf_preview(region, ow, oh)

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
        response["scale_used"] = f"1:{scale:g}"
        labels = _labels_from(region_lines, [drawing.title])
        label_pts = [Label(l.text, l.cx * m_per_pt, l.cy * m_per_pt, minor) for l, minor in labels]

        plan_total = _plan_total(_rows(sheet.lines)) or _plan_total(all_text)
        walls = _wall_objects(objs, region_lines, m_per_pt)
        result = best_rooms(_wall_candidates(walls, m_per_pt), label_pts, plan_total)
        if result and result.rooms:
            result = _refined(result, walls, label_pts, region_lines, m_per_pt)
        if result is None or not result.rooms:
            response["errors"].append("No closed rooms could be traced on this drawing — enter the measurements by hand.")
            result = None
        elif result.unplaced_labels:
            warnings.append("Room label(s) not inside a traced room: " + ", ".join(result.unplaced_labels[:8]) + ".")

        ceilings: dict[int, dict] = {}
        if result:
            # The floor's reflected ceiling plan: each room's finish and height.
            plan, ceilings, note = _ceilings_from_plan(pages, plan_sheets, drawing, walls, m_per_pt, result)
            response["ceiling_plan"] = plan
            response["ceiling_plan_page"] = next((s.page_index + 1 for s in plan_sheets for d in s.drawings if d.id == plan), None)
            finish_heights = _finish_ceiling_heights(plan_sheets)
            for ceiling in ceilings.values():
                ceiling["wall_height_m"] = _wall_height(ceiling["notes"], finish_heights)
            if note:
                warnings.append(note)

        windows = sum(1 for l in region_lines if _WINDOW_TAG.search(l.text.strip()))
        to_px = lambda x, y: ((x / m_per_pt - ox) * px_per_pt, (y / m_per_pt - oy) * px_per_pt)
        response.update({
            "rooms": _rooms_json(result, to_px if response["preview"] else None, ceilings,
                                 lambda x, y: (x / m_per_pt, y / m_per_pt),
                                 _glass_lengths(result, region_lines, m_per_pt) if result else None),
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
    by_layer: dict[str, list[tuple]] = defaultdict(list)
    for e in msp.query("LINE LWPOLYLINE POLYLINE ARC"):
        by_layer[e.dxf.layer].extend(_dxf_segments(e, f))
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
    preview, to_px = _segments_preview([s for l, segs in by_layer.items() if not re.search(r"HATCH", l, re.I) for s in segs],
                                       result.rooms if result else [])
    return {
        "sheets": [{"id": "DXF", "title": name, "drawings": [{"id": "DXF:A", "title": "Model space", "scale": "1:1"}]}],
        "selected_drawing": "DXF:A",
        "floor_plans": [{"floor": "Floor plan", "drawing_id": "DXF:A", "confirm": False, "note": None, "alternatives": []}],
        "skipped_plans": [],
        "preview": preview,
        "scale_used": "1:1",
        "rooms": _rooms_json(result, to_px),
        "openings": _openings(door_widths, 0, window_widths),
        "ceiling_heights_m": _heights(all_text),
        "finish_notes": _finish_notes(all_text),
        # A DXF has no pages: notes carry no place to show them.
        "plan_notes": [{"text": t, "page": None, "sheet": None, "box": None} for t in _finish_notes(all_text)],
        "page": None, "ceiling_plan_page": None,
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
    empty = {"sheets": [], "selected_drawing": None, "floor_plans": [], "skipped_plans": [], "preview": None,
             "scale_used": None, "rooms": [], "openings": [], "ceiling_heights_m": [],
             "finish_notes": [], "plan_notes": [], "page": None, "ceiling_plan_page": None,
             "schedule_check": None, "warnings": [], "errors": []}
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
