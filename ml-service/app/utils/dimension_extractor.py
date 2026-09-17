"""Best-effort extraction of structural dimension callouts from an uploaded
blueprint PDF. This is NOT a trained model and does not understand drawings —
it pattern-matches numbers and element-type keywords out of whatever text is
in (or can be OCR'd from) the PDF, so every result must be reviewed/edited by
the user. Blueprints don't encode our project's phases, so results carry no
phase — the user assigns phase manually after review.

Real CAD-exported architectural sheets (as opposed to clean schedules/tables)
scramble reading order badly when pdfplumber joins characters into lines —
a dimension number can land many "lines" away from the wall/column label it
actually belongs to, even though it's right next to it on the drawing. So in
addition to a same-line regex pass (good for schedules and "L=12.5 W=8.2"
style callouts), this also does a spatial pass: it finds element-keyword
words and looks for numeric words within a pixel/point radius of them,
using actual word bounding boxes (from pdfplumber for native text, or from
EasyOCR boxes for scanned pages) rather than text order.
"""
import re
import math
from pathlib import Path
from dataclasses import dataclass, field

import pdfplumber

ELEMENT_TYPES = ["Wall", "Column", "Beam", "Slab", "Footing"]
_ELEMENT_KEYWORD_RE = re.compile(r"\b(wall|column|beam|slab|footing)\b", re.IGNORECASE)
_ELEMENT_KEYWORD_FULL_RE = re.compile(r"^(wall|column|beam|slab|footing)$", re.IGNORECASE)

_UNIT = r"(mm|cm|m|meters?)?"

# "12.5m x 8.2m x 3.0m" / "12500mm x 8200mm x 3000mm" / "12.5 x 8.2 x 3.0"
_TRIPLE_DIM_RE = re.compile(
    rf"(\d+(?:\.\d+)?)\s*{_UNIT}\s*[xX×]\s*(\d+(?:\.\d+)?)\s*{_UNIT}\s*[xX×]\s*(\d+(?:\.\d+)?)\s*{_UNIT}",
    re.IGNORECASE,
)
# "12.5m x 8.2m" / "300x300mm" / "12.5 x 8.2"
_DOUBLE_DIM_RE = re.compile(
    rf"(\d+(?:\.\d+)?)\s*{_UNIT}\s*[xX×]\s*(\d+(?:\.\d+)?)\s*{_UNIT}",
    re.IGNORECASE,
)
# "L=12.5" / "Length: 12.5" / "L 12.5m" / "T=200mm"
_LABELED_RE = {
    "length_m":    re.compile(rf"\bL(?:ength)?\b\s*[:=]?\s*(\d+(?:\.\d+)?)\s*{_UNIT}", re.IGNORECASE),
    "width_m":     re.compile(rf"\bW(?:idth)?\b\s*[:=]?\s*(\d+(?:\.\d+)?)\s*{_UNIT}", re.IGNORECASE),
    "height_m":    re.compile(rf"\bH(?:eight)?\b\s*[:=]?\s*(\d+(?:\.\d+)?)\s*{_UNIT}", re.IGNORECASE),
    "thickness_m": re.compile(rf"\b(?:T(?:hickness)?|THK)\b\s*[:=]?\s*(\d+(?:\.\d+)?)\s*{_UNIT}", re.IGNORECASE),
}

# Standalone numeric word, optionally with an attached unit: "4590", "12.5m", "300mm".
_NUMBER_WORD_RE = re.compile(r"^(\d+(?:\.\d+)?)\s*(mm|cm|m)?$", re.IGNORECASE)

MIN_NATIVE_TEXT_CHARS = 30  # below this, treat the page as scanned/image-only
SPATIAL_RADIUS_FRACTION = 0.06  # of the page's longer side — sheet size varies wildly (letter vs. A0)
OCR_RASTER_DPI = 200


def _to_m(num_str: str, unit_str: str | None) -> float:
    """Converts a captured number to meters. mm/cm are common for member
    sizes; many regional drafting conventions (incl. Philippine practice)
    figure dimensions in bare millimeters with no unit suffix at all, so an
    unusually large unitless number (>50) is assumed to be mm, not meters —
    a 4590 m wall isn't plausible, a 4590 mm one is."""
    value = float(num_str)
    unit = (unit_str or "").lower()
    if unit == "mm":
        return value / 1000
    if unit == "cm":
        return value / 100
    if unit in ("m", "meter", "meters"):
        return value
    return value / 1000 if value > 50 else value


@dataclass
class Candidate:
    element_type: str
    length_m: float = 0.0
    width_m: float = 0.0
    height_m: float = 0.0
    thickness_m: float = 0.0
    area_label: str = ""
    source_page: int = 0
    ocr_used: bool = False


@dataclass
class ExtractionResult:
    candidates: list[Candidate] = field(default_factory=list)
    page_count: int = 0
    ocr_pages_used: int = 0
    warnings: list[str] = field(default_factory=list)


@dataclass
class Word:
    text: str
    x0: float
    x1: float
    top: float
    bottom: float

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.top + self.bottom) / 2


def _get_page_data(file_path: str) -> tuple[list[str], list[list[Word]], list[bool], list[float]]:
    """Returns (line text per page, words per page, whether OCR was used per
    page, longer-side length per page in points)."""
    texts: list[str] = []
    native_words: list[list[Word]] = []
    needs_ocr: list[int] = []
    page_sizes: list[float] = []

    with pdfplumber.open(file_path) as pdf:
        for i, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            texts.append(text)
            words = [Word(w["text"], w["x0"], w["x1"], w["top"], w["bottom"]) for w in page.extract_words()]
            native_words.append(words)
            page_sizes.append(max(page.width, page.height))
            if len(text.strip()) < MIN_NATIVE_TEXT_CHARS:
                needs_ocr.append(i)

    ocr_used = [False] * len(texts)
    if needs_ocr:
        ocr_results = _ocr_pages(file_path, needs_ocr)
        for idx, (ocr_text, ocr_words, ocr_page_size) in ocr_results.items():
            if ocr_text.strip():
                texts[idx] = ocr_text
                native_words[idx] = ocr_words
                page_sizes[idx] = ocr_page_size
                ocr_used[idx] = True

    return texts, native_words, ocr_used, page_sizes


def _ocr_pages(file_path: str, page_indices: list[int]) -> dict[int, tuple[str, list[Word], float]]:
    """Rasterizes the given pages and OCRs them. Returns {} if OCR isn't
    available (missing deps) rather than failing the whole scan."""
    try:
        import fitz  # PyMuPDF
        from app.utils.ocr_reader import get_reader
    except ImportError:
        return {}

    results: dict[int, tuple[str, list[Word], float]] = {}
    scale = 72 / OCR_RASTER_DPI  # pixels (at raster DPI) -> PDF points
    try:
        reader = get_reader()
        doc = fitz.open(file_path)
        for idx in page_indices:
            if idx >= doc.page_count:
                continue
            page = doc.load_page(idx)
            pix = page.get_pixmap(dpi=OCR_RASTER_DPI)
            image_bytes = pix.tobytes("png")
            detections = reader.readtext(image_bytes, detail=1)
            words = []
            lines = []
            for bbox, text, _confidence in detections:
                xs = [p[0] for p in bbox]
                ys = [p[1] for p in bbox]
                words.append(Word(text, min(xs) * scale, max(xs) * scale, min(ys) * scale, max(ys) * scale))
                lines.append(text)
            page_size = max(pix.width, pix.height) * scale
            results[idx] = ("\n".join(lines), words, page_size)
        doc.close()
    except Exception:
        return results
    return results


def _dedupe(candidates: list[Candidate]) -> list[Candidate]:
    seen = set()
    unique = []
    for c in candidates:
        key = (c.source_page, c.element_type, round(c.length_m, 2), round(c.width_m, 2), round(c.height_m, 2), round(c.thickness_m, 2))
        if key in seen:
            continue
        seen.add(key)
        unique.append(c)
    return unique


def _drop_repeated_across_pages(candidates: list[Candidate], min_pages: int = 3) -> list[Candidate]:
    """The same exact values showing up identically on 3+ pages is almost
    always a title block, legend, or sheet border repeating verbatim on
    every drawing — not a real dimension recurring by coincidence."""
    counts: dict[tuple, set[int]] = {}
    for c in candidates:
        key = (c.element_type, round(c.length_m, 2), round(c.width_m, 2), round(c.height_m, 2), round(c.thickness_m, 2))
        counts.setdefault(key, set()).add(c.source_page)

    repeated = {key for key, pages in counts.items() if len(pages) >= min_pages}

    return [
        c for c in candidates
        if (c.element_type, round(c.length_m, 2), round(c.width_m, 2), round(c.height_m, 2), round(c.thickness_m, 2)) not in repeated
    ]


def _extract_from_line(line: str, page_num: int, ocr_used: bool) -> Candidate | None:
    keyword_match = _ELEMENT_KEYWORD_RE.search(line)
    element_type = keyword_match.group(1).title() if keyword_match else None

    # Single-letter labels (L=/W=/H=/T=) are common false-positive magnets in
    # garbled/rotated-text extractions — only trust them alongside an actual
    # element keyword on the same line, never as a standalone match.
    if not element_type:
        return None

    labeled = {}
    for field_name, pattern in _LABELED_RE.items():
        m = pattern.search(line)
        if m:
            labeled[field_name] = _to_m(m.group(1), m.group(2))

    if labeled:
        return Candidate(
            element_type=element_type,
            length_m=labeled.get("length_m", 0),
            width_m=labeled.get("width_m", 0),
            height_m=labeled.get("height_m", 0),
            thickness_m=labeled.get("thickness_m", 0),
            area_label=line.strip()[:80],
            source_page=page_num,
            ocr_used=ocr_used,
        )

    triple = _TRIPLE_DIM_RE.search(line)
    if triple and element_type:
        n1, u1, n2, u2, n3, u3 = triple.groups()
        shared = _shared_unit([u1, u2, u3])
        return Candidate(
            element_type=element_type, length_m=_to_m(n1, u1 or shared), width_m=_to_m(n2, u2 or shared), height_m=_to_m(n3, u3 or shared),
            thickness_m=0.10, area_label=line.strip()[:80], source_page=page_num, ocr_used=ocr_used,
        )

    double = _DOUBLE_DIM_RE.search(line)
    if double and element_type:
        n1, u1, n2, u2 = double.groups()
        shared = _shared_unit([u1, u2])
        return Candidate(
            element_type=element_type, length_m=_to_m(n1, u1 or shared), width_m=_to_m(n2, u2 or shared), height_m=0,
            thickness_m=0.10, area_label=line.strip()[:80], source_page=page_num, ocr_used=ocr_used,
        )

    return None


def _shared_unit(units: list[str | None]) -> str | None:
    """"300x300mm" style shorthand — only the last number carries a unit, and
    it applies to all of them. Use it to backfill units left blank earlier
    in the match."""
    for u in reversed(units):
        if u:
            return u
    return None


def _extract_from_words(words: list[Word], page_num: int, ocr_used: bool, page_size: float) -> list[Candidate]:
    """Spatial pass: find element-keyword words, then look for numeric words
    within a radius of them by actual position on the page — proximity in
    the reconstructed text stream is unreliable for dense CAD-exported
    sheets, but proximity on the page is a real (if noisy) signal.

    Each number is only claimed by its single NEAREST keyword (not every
    keyword within radius), so two labels sitting near each other on a
    schedule/table can't both grab the same figure."""
    keyword_words = [w for w in words if _ELEMENT_KEYWORD_FULL_RE.match(w.text)]
    if not keyword_words:
        return []

    number_words = []
    for w in words:
        m = _NUMBER_WORD_RE.match(w.text)
        if m:
            number_words.append((w, m.group(1), m.group(2)))
    if not number_words:
        return []

    radius = max(page_size * SPATIAL_RADIUS_FRACTION, 40)  # floor for tiny/degenerate pages

    claims: dict[int, list] = {i: [] for i in range(len(keyword_words))}
    for item in number_words:
        w = item[0]
        best_idx, best_dist = None, radius
        for i, kw in enumerate(keyword_words):
            d = math.hypot(w.cx - kw.cx, w.cy - kw.cy)
            if d <= best_dist:
                best_idx, best_dist = i, d
        if best_idx is not None:
            claims[best_idx].append((best_dist, item))

    candidates = []
    for i, kw in enumerate(keyword_words):
        nearby = sorted(claims[i], key=lambda t: t[0])[:2]
        # A single stray number near a label is mostly coincidence on a dense
        # sheet — only trust it once we see an L-and-W-shaped pair.
        if len(nearby) < 2:
            continue

        chosen = [item for _dist, item in nearby]
        chosen.sort(key=lambda item: item[0].x0)  # left-to-right reading order
        values = [_to_m(num, unit) for _w, num, unit in chosen]
        raw_texts = " / ".join(w.text for w, _n, _u in chosen)

        candidates.append(Candidate(
            element_type=kw.text.title(),
            length_m=values[0],
            width_m=values[1] if len(values) > 1 else 0,
            height_m=0,
            thickness_m=0.10,
            area_label=f"{kw.text} nearby: {raw_texts}"[:80],
            source_page=page_num,
            ocr_used=ocr_used,
        ))

    return candidates


def extract_measurement_candidates(file_path: str, max_candidates: int = 60) -> ExtractionResult:
    path = Path(file_path)
    if not path.exists():
        return ExtractionResult(warnings=[f"File not found: {file_path}"])

    result = ExtractionResult()
    texts, words_per_page, ocr_used_flags, page_sizes = _get_page_data(str(path))
    result.page_count = len(texts)
    result.ocr_pages_used = sum(1 for used in ocr_used_flags if used)

    if result.ocr_pages_used > 0:
        result.warnings.append(
            f"{result.ocr_pages_used} page(s) had no embedded text and were read via OCR — those results are lower-confidence."
        )

    candidates: list[Candidate] = []
    for page_idx, text in enumerate(texts):
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            candidate = _extract_from_line(line, page_idx + 1, ocr_used_flags[page_idx])
            if candidate:
                candidates.append(candidate)

    for page_idx, words in enumerate(words_per_page):
        candidates.extend(_extract_from_words(words, page_idx + 1, ocr_used_flags[page_idx], page_sizes[page_idx]))

    candidates = _dedupe(candidates)
    candidates = _drop_repeated_across_pages(candidates)[:max_candidates]
    result.candidates = candidates

    if not candidates:
        result.warnings.append("No dimension callouts were recognized in this document — enter measurements manually.")
    else:
        result.warnings.append(
            "These are best-effort matches from text/positions on the page, not verified readings — double-check every value before saving."
        )

    return result
