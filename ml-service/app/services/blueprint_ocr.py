"""OCR for CAD plans whose text was exported as lines.

AutoCAD plots SHX-font text (titles, "SCALE 1:60", room names, dimensions)
as strokes, so the PDF holds no text for them — only the title block's
TrueType text is real. These pages are rendered and read — with Azure Read
when configured (more accurate on small labels; see azure_document), else
Tesseract, the engine the BOQ scanner uses. The words come back in PDF
points, like pdfplumber's, and join the normal text pipeline.
"""
from __future__ import annotations

import difflib
import logging
import math
import re
from concurrent.futures import ThreadPoolExecutor

from app.services import azure_document
from app.utils.pdf_render import page_image

logger = logging.getLogger(__name__)

MAX_PIXELS = 40_000_000   # ~A3 at 300 dpi; larger sheets get a lower dpi
MAX_DPI = 300
MIN_CONFIDENCE = 60
CAP_HEIGHT = 0.7          # an upper-case word's box height as a share of its font size
WORKERS = 4

# Tesseract drops the colon: "SCALE: 1 60". Only common scales are rebuilt,
# so a stray "1" beside a dimension never turns into a scale.
COMMON_SCALES = {5, 10, 20, 25, 30, 40, 50, 60, 75, 80, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000}
_TITLE_NUMBER = re.compile(r"^\(?\d{1,2}\)?\s+(?=[A-Z]{3,}\s+[A-Z])")
_LOOSE_SCALE = re.compile(r"(?:SCALE\s*:?\s*)?1\s*[:;,.]?\s+(\d{1,4})\.?", re.I)

# Words that name a room. Small room names drawn over tile hatching come
# back garbled ("TOLET", "TOILE", "TORET") or under the confidence cut; one
# close to a word here is read as that word (room_words) and kept.
ROOM_WORDS = frozenset("""
    TOILET TOILETS BATH BATHROOM CR POWDER SHOWER LAVATORY WC T&B
    BEDROOM BEDROOMS MASTER GUEST GUESTROOM ROOM ROOMS MAID MAIDS KIDS
    KITCHEN DIRTY PANTRY DINING LIVING FAMILY LOUNGE STUDY OFFICE LIBRARY GYM
    LAUNDRY SERVICE UTILITY STORAGE STORE STOCK CLOSET WALK-IN W.I.C. WIC
    BALCONY TERRACE LANAI PORCH VERANDA DECK PATIO FOYER LOBBY ENTRY RECEPTION
    HALL HALLWAY CORRIDOR PASSAGE STAIR STAIRS LANDING GARAGE CARPORT PARKING
    AREA SALES FITTING TILLS DATA ROOM MEZZANINE ATTIC ROOF
""".split())
# Plan notes a letter away from a room word ("STORM DRAIN" ~ STORE) — never corrected.
NOT_ROOM_WORDS = frozenset("""
    STORM DRAIN PIPE LINE PROPERTY SCALE PLAN FLOOR DOOR WINDOW WALL SLAB BEAM COLUMN TILE TILES FINISH
    CEILING LEVEL SINK SECTION DETAIL NOTE NOTES ELEVATION RAILING CANOPY GUTTER
""".split())
ROOM_WORD_CUTOFF = 0.7      # difflib ratio: TOLET/TOILE → TOILET, but PLAN ≠ LANAI
LOW_CONFIDENCE_ROOM_WORD = 0.4  # a room word is kept down to this confidence


def room_word(token: str) -> str | None:
    """The room word an OCR token is a misreading of, if any. Digits read
    for letters (BACONY with a zero) count as the letter."""
    if not any(ch.isalpha() for ch in token):
        return None
    t = token.upper().translate(str.maketrans("0156", "OISG")).strip(".,:;()'\"")
    if t in ROOM_WORDS:
        return t
    if len(t) < 4 or not t.isalpha() or t in NOT_ROOM_WORDS:
        return None
    # A misread keeps its first letter far more often than not: "TORET" is
    # TOILET, though STORE scores a little closer.
    matches = difflib.get_close_matches(t, ROOM_WORDS, n=3, cutoff=ROOM_WORD_CUTOFF)
    return next((m for m in matches if m[0] == t[0]), matches[0] if matches else None)


def room_words(text: str) -> str:
    """`text` with each garbled room word replaced by the word it reads as."""
    return " ".join(room_word(w) or w for w in text.split())


def _tesseract_available() -> bool:
    try:
        import pytesseract
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def available() -> bool:
    return azure_document.enabled() or _tesseract_available()


def render(page):
    """The page as a grayscale image, and PDF points per pixel."""
    dpi = min(MAX_DPI, 72 * math.sqrt(MAX_PIXELS / (page.width * page.height)))
    return page_image(page, dpi).convert("L"), 72 / dpi


def _confident(text: str, confidence: float) -> bool:
    return confidence >= MIN_CONFIDENCE / 100 or (confidence >= LOW_CONFIDENCE_ROOM_WORD and room_word(text) is not None)


def _covered(cx: float, cy: float, boxes: list[tuple]) -> bool:
    return any(x0 - 1 <= cx <= x1 + 1 and top - 1 <= cy <= bottom + 1 for x0, top, x1, bottom in boxes)


def _azure_words(image, pt_per_px: float, real_text: list[tuple]) -> list[dict]:
    """Azure Read's words, in PDF points. Only near-horizontal words: the
    rest of the pipeline (titles, scale, labels, dimensions) reads across."""
    result = azure_document.analyze_image(azure_document.encode_image(image), azure_document.READ)
    words = []
    for page in result.get("pages") or []:
        # encode_image may have shrunk the image to fit Azure's size limit.
        k = pt_per_px * image.width / float(page.get("width") or image.width)
        for w in page.get("words") or []:
            text, poly = (w.get("content") or "").strip(), w.get("polygon") or []
            if not text or len(poly) < 8 or not _confident(text, float(w.get("confidence", 1))):
                continue
            if not any(ch.isalnum() for ch in text):
                continue
            xs, ys = poly[0::2], poly[1::2]
            if abs(math.degrees(math.atan2(poly[3] - poly[1], poly[2] - poly[0]))) > 10:
                continue
            x0, top, x1, bottom = min(xs) * k, min(ys) * k, max(xs) * k, max(ys) * k
            if _covered((x0 + x1) / 2, (top + bottom) / 2, real_text):
                continue
            words.append({"text": text, "x0": x0, "top": top, "x1": x1, "bottom": bottom,
                          "size": (bottom - top) / CAP_HEIGHT})
    return words


def _words(image, pt_per_px: float, real_text: list[tuple]) -> list[dict]:
    if azure_document.enabled():
        try:
            return _azure_words(image, pt_per_px, real_text)
        except azure_document.AzureUnavailable as e:
            logger.warning("%s Using Tesseract for this page.", e)
        if not _tesseract_available():
            return []
    return _tesseract_words(image, pt_per_px, real_text)


def _tesseract_words(image, pt_per_px: float, real_text: list[tuple]) -> list[dict]:
    import pytesseract
    from pytesseract import Output

    # psm 11: sparse text — labels scattered over a drawing, not paragraphs.
    data = pytesseract.image_to_data(image, config="--psm 11", output_type=Output.DICT)
    words = []
    for i, text in enumerate(data["text"]):
        text = text.strip()
        if not text or not _confident(text, float(data["conf"][i]) / 100) or not any(ch.isalnum() for ch in text):
            continue
        x0, top = data["left"][i] * pt_per_px, data["top"][i] * pt_per_px
        x1, bottom = x0 + data["width"][i] * pt_per_px, top + data["height"][i] * pt_per_px
        if _covered((x0 + x1) / 2, (top + bottom) / 2, real_text):
            continue  # the PDF already has this as real text
        words.append({"text": text, "x0": x0, "top": top, "x1": x1, "bottom": bottom,
                      "size": (bottom - top) / CAP_HEIGHT})
    return words


def _normalise(text: str) -> str:
    m = _LOOSE_SCALE.fullmatch(text.strip())
    if m and int(m.group(1)) in COMMON_SCALES:
        return f"1:{m.group(1)}"
    # A title's drawing-number bubble read along with it: "(2) SECOND FLOOR PLAN".
    return _TITLE_NUMBER.sub("", text)


def _tag_words(words: list[dict]) -> set[int]:
    """Door/window tags — a short code over its number ("PD" over "2") in a
    small hexagon or circle. Their words never join a neighbour on the row,
    or a tag beside a room name turns "COMMON" into "COMMON 2"."""
    codes = [w for w in words if re.fullmatch(r"[A-Z]{1,3}", w["text"])]
    tags: set[int] = set()
    for w in words:
        if not re.fullmatch(r"\d{1,2}[A-Z]?", w["text"]):
            continue
        cx = (w["x0"] + w["x1"]) / 2
        for c in codes:
            size = max(c["size"], w["size"])
            if abs((c["x0"] + c["x1"]) / 2 - cx) < 0.8 * size and -0.4 * size <= w["top"] - c["bottom"] < 0.8 * size:
                tags.update((id(w), id(c)))
                break
    return tags


def _lines(words: list[dict]) -> list[tuple[str, float, float, float, float, float]]:
    """Words on one row, close together, as (text, x0, top, x1, bottom, size).
    No same-size rule (unlike real text): OCR box heights vary word to word."""
    tags = _tag_words(words)
    # Rows first, then left to right — sorting by top alone puts a word a
    # fraction higher ("60" of "1 60") ahead of its left neighbour.
    rows: list[list[dict]] = []
    for w in sorted(words, key=lambda w: w["top"]):
        row = next((r for r in rows if abs(r[0]["top"] - w["top"]) < 0.35 * max(r[0]["size"], w["size"])), None)
        (row.append(w) if row else rows.append([w]))
    lines: list[list[dict]] = []
    for row in rows:
        row.sort(key=lambda w: w["x0"])
        lines.append([row[0]])
        for w in row[1:]:
            last = lines[-1][-1]
            # "1 : 60" with the colon dropped leaves a wide gap after the "1".
            reach = 3.0 if last["text"].rstrip(":;") == "1" and w["text"].rstrip(".").isdigit() else 1.2
            if (id(w) not in tags and id(last) not in tags
                    and -0.2 * w["size"] <= w["x0"] - last["x1"] < reach * max(last["size"], w["size"])):
                lines[-1].append(w)
            else:
                lines.append([w])
    out = []
    for l in lines:
        sizes = sorted(w["size"] for w in l)
        out.append((_normalise(" ".join(w["text"] for w in l)), min(w["x0"] for w in l), min(w["top"] for w in l),
                    max(w["x1"] for w in l), max(w["bottom"] for w in l), sizes[len(sizes) // 2]))
    return out


def read_pages(jobs: list[tuple]) -> list[list[tuple]]:
    """jobs: (image, pt_per_px, real_text_boxes) per page → text lines per
    page. Tesseract runs as a subprocess, so pages are read in parallel."""
    def one(job):
        try:
            return _lines(_words(*job))
        except Exception:
            logger.exception("OCR failed on a blueprint page")
            return []
    # Azure's free tier is rate-limited — fewer pages in flight there.
    with ThreadPoolExecutor(max_workers=2 if azure_document.enabled() else WORKERS) as pool:
        return list(pool.map(one, jobs))
