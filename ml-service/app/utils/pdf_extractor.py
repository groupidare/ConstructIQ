import pdfplumber
import re
from pathlib import Path


QUANTITY_PATTERN  = re.compile(r'\b(\d+(?:\.\d+)?)\s*(pcs?|bags?|m\d?|kg|liters?|gallons?|rolls?|sets?|lengths?|sheets?|units?)\b', re.IGNORECASE)
PHASE_KEYWORDS    = ["Foundation", "Structural", "Framing", "Roofing", "Walling", "Finishing", "Electrical", "Plumbing", "HVAC"]


def extract_text_from_pdf(file_path: str) -> tuple[list[str], int]:
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"PDF not found: {file_path}")

    pages = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            pages.append(text)
    return pages, len(pages)


def extract_tables_from_pdf(file_path: str) -> tuple[list[list[list[str | None]]], int]:
    path = Path(file_path)
    all_tables = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            all_tables.extend(tables)
    return all_tables, len(all_tables)


def detect_phase_from_text(text: str) -> str | None:
    upper = text.upper()
    for kw in PHASE_KEYWORDS:
        if kw.upper() in upper:
            return kw
    return None


_OCR_DIGIT_FIX = str.maketrans({"O": "0", "o": "0", "S": "5", "I": "1", "l": "1", "B": "8", "Z": "2"})


def parse_quantity_from_cell(cell: str | None) -> float | None:
    if not cell:
        return None
    cell = str(cell).strip()
    digits = re.sub(r"[,\s]", "", cell)
    try:
        return float(digits)
    except ValueError:
        pass
    # Scanned/OCR-sourced documents commonly confuse letters and digits
    # (O/0, S/5, I or l/1, B/8) — retry once with the common substitutions
    # before giving up on an otherwise plausible-looking numeric cell.
    fixed = digits.translate(_OCR_DIGIT_FIX)
    try:
        return float(fixed)
    except ValueError:
        return None
