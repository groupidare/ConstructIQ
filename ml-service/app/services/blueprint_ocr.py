"""OCR for CAD plans whose text was exported as lines.

AutoCAD plots SHX-font text (titles, "SCALE 1:60", room names, dimensions)
as strokes, so the PDF holds no text for them — only the title block's
TrueType text is real. These pages are rendered and read — with Azure Read
when configured (more accurate on small labels; see azure_document), else
Tesseract, the engine the BOQ scanner uses. The words come back in PDF
points, like pdfplumber's, and join the normal text pipeline.
"""
from __future__ import annotations

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
            if not text or len(poly) < 8 or float(w.get("confidence", 1)) < MIN_CONFIDENCE / 100:
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
        if not text or float(data["conf"][i]) < MIN_CONFIDENCE or not any(ch.isalnum() for ch in text):
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


def _lines(words: list[dict]) -> list[tuple[str, float, float, float, float, float]]:
    """Words on one row, close together, as (text, x0, top, x1, bottom, size).
    No same-size rule (unlike real text): OCR box heights vary word to word."""
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
            if -0.2 * w["size"] <= w["x0"] - last["x1"] < reach * max(last["size"], w["size"]):
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
