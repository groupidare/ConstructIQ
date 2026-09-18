"""Format-dispatching table/text extraction shared by BOQ and PO parsing.
PDF keeps using pdfplumber (unchanged); .xlsx/.csv go through pandas so they
feed the exact same header-detection logic instead of returning nothing."""
from pathlib import Path

import pandas as pd

from app.utils.pdf_extractor import extract_tables_from_pdf, extract_text_from_pdf

Row = list[str | None]
Table = list[Row]

SUPPORTED_EXTENSIONS = {".pdf", ".xlsx", ".xls", ".csv"}


def _df_to_table(df: pd.DataFrame) -> Table:
    df = df.where(pd.notna(df), None)
    return [[None if v is None else str(v) for v in row] for row in df.values.tolist()]


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
        return tables

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

    raise ValueError(f"Unsupported file type: {ext}")


def extract_text(file_path: str) -> tuple[list[str], int]:
    """Returns (text per 'page', page count). For .pdf this is real extracted
    text per page. For .xlsx/.csv there's no native text — synthesize one
    pseudo-page per table so phase/section keyword detection still has
    something to search, even though it's lower-signal for spreadsheets."""
    path = Path(file_path)
    if path.suffix.lower() == ".pdf":
        return extract_text_from_pdf(str(path))

    tables = extract_tables(file_path)
    pages = [
        "\n".join(" ".join(str(c) for c in row if c) for row in table)
        for table in tables
    ]
    return pages, len(pages)
