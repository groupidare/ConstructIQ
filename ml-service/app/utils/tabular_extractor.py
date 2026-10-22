"""Format-dispatching table/text extraction shared by BOQ and PO parsing.
PDF prefers pdfplumber (real text layer) and falls back to OCR when there
isn't one — e.g. a photo of a document saved/exported as .pdf, which has no
extractable text at all as far as pdfplumber is concerned. .xlsx/.csv go
through pandas so they feed the exact same header-detection logic instead of
returning nothing.

Where OCR would run (a scanned or photographed BOQ/PO), Azure Document
Intelligence's Layout model reads it first when configured — it keeps table
rows/columns and merged cells far better than Tesseract — and Tesseract
stays the fallback (see app/services/azure_document.py)."""
import logging
from pathlib import Path

import pandas as pd

from app.services import azure_document
from app.utils.pdf_extractor import extract_tables_from_pdf, extract_text_from_pdf
from app.utils.ocr_extractor import IMAGE_EXTENSIONS, extract_text_with_ocr, extract_tables_with_ocr

Row = list[str | None]
Table = list[Row]

SUPPORTED_EXTENSIONS = {".pdf", ".xlsx", ".xls", ".csv", *IMAGE_EXTENSIONS}

logger = logging.getLogger(__name__)


def _azure_results(file_path: str) -> list[dict] | None:
    """Azure Layout for each page, or None to use Tesseract instead. Pages
    are cached, so extract_text and extract_tables share one set of calls."""
    if not azure_document.enabled():
        return None
    try:
        return [azure_document.analyze_image(image) for image in azure_document.file_page_images(file_path)]
    except azure_document.AzureUnavailable as e:
        logger.warning("%s Using the built-in OCR.", e)
        return None


def _ocr_tables(file_path: str) -> list["Table"]:
    results = _azure_results(file_path)
    if results:
        tables = [t for r in results for t in azure_document.tables_from(r)]
        if _has_usable_content(tables):
            return tables
    return extract_tables_with_ocr(file_path)


def _ocr_text(file_path: str) -> tuple[list[str], int]:
    results = _azure_results(file_path)
    if results:
        pages = [azure_document.page_text(r) for r in results]
        if any(p.strip() for p in pages):
            return pages, len(pages)
    return extract_text_with_ocr(file_path)


def _df_to_table(df: pd.DataFrame) -> Table:
    df = df.where(pd.notna(df), None)
    return [[None if v is None else str(v) for v in row] for row in df.values.tolist()]


def _has_usable_content(tables: list[Table]) -> bool:
    return any(any(c for c in row if c) for table in tables for row in table)


def _read_csv_resilient(path: Path) -> pd.DataFrame:
    """Real client-supplied CSVs are frequently exported from Excel/OCR tools
    in cp1252/latin-1, not UTF-8 — try common encodings before giving up, and
    fall back to lossy replacement rather than failing the whole scan over a
    handful of bad bytes (e.g. a peso sign that didn't round-trip cleanly)."""
    for encoding in ("utf-8", "utf-8-sig", "cp1252", "latin-1"):
        try:
            return pd.read_csv(path, header=None, dtype=str, encoding=encoding)
        except UnicodeDecodeError:
            continue
    return pd.read_csv(path, header=None, dtype=str, encoding="utf-8", encoding_errors="replace")


def extract_tables(file_path: str) -> list[Table]:
    """Returns one 'table' (list of rows) per sheet (.xlsx), per CSV file (one
    table), or per detected table on a PDF page — same shape regardless of
    source format, so downstream header-detection logic doesn't need to care."""
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    ext = path.suffix.lower()
    if ext == ".pdf":
        tables, _ = extract_tables_from_pdf(str(path))
        if _has_usable_content(tables):
            return tables
        # No real table structure found — likely a scanned photo saved as
        # .pdf (no text layer for pdfplumber to read at all). Fall back to
        # OCR rather than silently reporting zero line items.
        return _ocr_tables(file_path)

    if ext in (".xlsx", ".xls"):
        excel = pd.ExcelFile(path)
        tables = []
        for sheet_name in excel.sheet_names:
            df = excel.parse(sheet_name, header=None, dtype=str)
            if not df.empty:
                tables.append(_df_to_table(df))
        return tables

    if ext == ".csv":
        df = _read_csv_resilient(path)
        return [_df_to_table(df)] if not df.empty else []

    if ext in IMAGE_EXTENSIONS:
        return _ocr_tables(file_path)

    raise ValueError(f"Unsupported file type: {ext}")


def extract_text(file_path: str) -> tuple[list[str], int]:
    """Returns (text per 'page', page count). For .pdf this is real extracted
    text per page, falling back to OCR when there's no text layer at all
    (same scanned-photo-as-pdf case handled in extract_tables). For
    .xlsx/.csv there's no native text — synthesize one pseudo-page per table
    so phase/section keyword detection still has something to search, even
    though it's lower-signal for spreadsheets."""
    path = Path(file_path)
    ext = path.suffix.lower()
    if ext in IMAGE_EXTENSIONS:
        return _ocr_text(file_path)
    if ext == ".pdf":
        pages, count = extract_text_from_pdf(str(path), ocr_fallback=False)
        if sum(len(p.strip()) for p in pages) >= 20:
            return pages, count
        return _ocr_text(file_path)

    tables = extract_tables(file_path)
    pages = [
        "\n".join(" ".join(str(c) for c in row if c) for row in table)
        for table in tables
    ]
    return pages, len(pages)
