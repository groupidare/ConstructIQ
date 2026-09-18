import re

import pandas as pd

from app.models.schemas import (
    DocumentParseRequest, DocumentParseResponse, ParsedBOQItem,
    DocumentParsePOResponse, ParsedPOItem,
)
from app.utils.pdf_extractor import detect_phase_from_text, parse_quantity_from_cell
from app.utils.tabular_extractor import extract_tables, extract_text


UNIT_KEYWORDS = {"pcs", "pc", "bags", "bag", "m", "m2", "m3", "kg", "ltr", "gal", "roll", "set", "length", "sheets", "units"}

_SUPPLIER_RE = re.compile(
    r"(?:supplier|vendor|name)\s*[:\-]\s*(.+?)(?=\s+(?:PO\s*No|P\.?O\.?\s*#|Date|Terms?)\b|$)",
    re.IGNORECASE,
)
_ORDER_DATE_RE = re.compile(r"(?:order\s*date|po\s*date|date\s*ordered)\s*[:\-]\s*([\w/,\- ]+)", re.IGNORECASE)
_DELIVERY_DATE_RE = re.compile(r"(?:expected\s*date|delivery\s*date|promised\s*date|eta)\s*[:\-]\s*([\w/,\- ]+)", re.IGNORECASE)


def _is_unit(value: str | None) -> bool:
    return str(value or "").strip().lower() in UNIT_KEYWORDS


# Substrings, not exact words — real headers come back as "Qty.", "Item No.",
# "Unit Cost", "Scope of Works", etc., never the bare dictionary word alone.
_HEADER_SUBSTRINGS = (
    "item", "desc", "material", "scope of work", "particular", "narration",
    "qty", "quantity", "unit", "cost", "amount", "supplier", "vendor",
)

# Desc/material-name columns in real BOQs/POs go by many names — checked in
# order, "item" last since it's usually just a row number, not a description.
_DESC_HEADER_SUBSTRINGS = (
    "desc", "material", "scope of work", "particular", "work item", "narration",
)

_NUMERIC_CELL_RE = re.compile(r"[\d.,]+")


def _looks_like_header(row: list) -> bool:
    return any(
        any(sub in str(c or "").strip().lower() for sub in _HEADER_SUBSTRINGS)
        for c in row
    )


def _find_desc_column(headers: list[str], table: list, header_row: int) -> int | None:
    for i, h in enumerate(headers):
        if any(sub in h for sub in _DESC_HEADER_SUBSTRINGS):
            return i

    # Unknown header vocabulary (e.g. "Scope of Works" spelled some other way) —
    # fall back to whichever column actually holds long, non-numeric text
    # across a sample of data rows. This is what a description column looks
    # like regardless of what its header is called.
    sample = [r for r in table[header_row + 1: header_row + 15] if r]
    best_col, best_avg_len = None, 0.0
    for i in range(len(headers)):
        texts = []
        for r in sample:
            if i >= len(r):
                continue
            v = str(r[i] or "").strip()
            if v and not _NUMERIC_CELL_RE.fullmatch(v):
                texts.append(v)
        if not texts:
            continue
        avg_len = sum(len(t) for t in texts) / len(texts)
        if avg_len > best_avg_len:
            best_avg_len, best_col = avg_len, i
    if best_col is not None and best_avg_len >= 4:
        return best_col

    # Last resort — a row-number/"item" column beats nothing at all.
    return next((i for i, h in enumerate(headers) if "item" in h), None)


# Cost-estimate sheets converted from PDF/OCR often merge a short stock/item
# code and the real description into one cell, separated by a wide gap
# (e.g. "03bB6                     Marine Plywood 3/4 Local") because the
# source had them in separate columns that didn't survive the conversion.
_LEADING_CODE_RE = re.compile(r"^\S{1,12}\s{3,}(.+)$")


def _clean_description(desc: str) -> str:
    match = _LEADING_CODE_RE.match(desc)
    return match.group(1).strip() if match else desc


def _is_section_heading(desc: str) -> bool:
    text = desc.strip()
    return bool(text) and len(text) > 2 and text.upper() == text and any(c.isalpha() for c in text)


def _extract_date(pattern: re.Pattern, text: str) -> str | None:
    match = pattern.search(text)
    if not match:
        return None
    raw = match.group(1).strip().splitlines()[0][:40]
    parsed = pd.to_datetime(raw, errors="coerce")
    return None if pd.isna(parsed) else parsed.date().isoformat()


def parse_boq_document(request: DocumentParseRequest) -> DocumentParseResponse:
    errors:  list[str]     = []
    items:   list[ParsedBOQItem] = []
    page_count = 0

    try:
        pages_text, page_count = extract_text(request.file_path)
        all_text = "\n".join(pages_text)

        tables = extract_tables(request.file_path)
        current_phase = detect_phase_from_text(all_text)

        for table in tables:
            if not table:
                continue

            header_row = None
            for i, row in enumerate(table):
                if _looks_like_header(row):
                    header_row = i
                    break

            if header_row is None:
                continue

            headers = [str(c or "").strip().lower() for c in table[header_row]]

            desc_col    = _find_desc_column(headers, table, header_row)
            qty_col     = next((i for i, h in enumerate(headers) if "qty" in h or "quantity" in h), None)
            unit_col    = next((i for i, h in enumerate(headers) if h == "unit" or "uom" in h), None)
            spec_col    = next((i for i, h in enumerate(headers) if "spec" in h or "size" in h), None)
            section_col = next((i for i, h in enumerate(headers) if "section" in h or "category" in h), None)

            if desc_col is None or qty_col is None:
                continue

            current_section = None
            for row in table[header_row + 1:]:
                if not row or all(c is None for c in row):
                    continue
                if _looks_like_header(row):
                    phase_hint = detect_phase_from_text(" ".join(str(c or "") for c in row))
                    if phase_hint:
                        current_phase = phase_hint
                    continue

                desc    = _clean_description(str(row[desc_col] or "").strip())
                qty     = parse_quantity_from_cell(row[qty_col] if qty_col < len(row) else None)
                unit    = str(row[unit_col] or "").strip() if unit_col is not None and unit_col < len(row) else "pcs"
                spec    = str(row[spec_col] or "").strip() if spec_col is not None and spec_col < len(row) else ""
                section = str(row[section_col] or "").strip() if section_col is not None and section_col < len(row) else None

                if qty is None or qty <= 0:
                    # No quantity — usually a section/sub-section heading
                    # ("I. GENERAL REQUIREMENTS") rather than a real line item.
                    # Remember it so later real rows inherit the right section.
                    if _is_section_heading(desc):
                        current_section = desc
                    continue
                if not desc:
                    continue

                items.append(ParsedBOQItem(
                    material_name      = desc,
                    specification      = spec,
                    unit               = unit,
                    estimated_quantity = qty,
                    phase_hint         = section or current_section or current_phase,
                ))

    except FileNotFoundError as e:
        errors.append(str(e))
        page_count = 0
    except Exception as e:
        errors.append(f"Parse error: {str(e)}")
        page_count = 0

    return DocumentParseResponse(
        project_id  = request.project_id,
        items       = items,
        page_count  = page_count,
        parse_errors= errors,
    )


def parse_po_document(request: DocumentParseRequest) -> DocumentParsePOResponse:
    errors: list[str] = []
    items:  list[ParsedPOItem] = []
    page_count = 0

    try:
        pages_text, page_count = extract_text(request.file_path)
        all_text = "\n".join(pages_text)

        tables = extract_tables(request.file_path)
        current_phase = detect_phase_from_text(all_text)

        # Supplier/dates are almost always stated once at the document level
        # (a header block), not repeated per line — fall back to this for any
        # row that has no per-row supplier column.
        doc_supplier    = None
        supplier_match  = _SUPPLIER_RE.search(all_text)
        if supplier_match:
            doc_supplier = supplier_match.group(1).strip().splitlines()[0][:200]
        doc_order_date    = _extract_date(_ORDER_DATE_RE, all_text)
        doc_delivery_date = _extract_date(_DELIVERY_DATE_RE, all_text)

        for table in tables:
            if not table:
                continue

            header_row = None
            for i, row in enumerate(table):
                if _looks_like_header(row):
                    header_row = i
                    break

            if header_row is None:
                continue

            headers = [str(c or "").strip().lower() for c in table[header_row]]

            desc_col     = _find_desc_column(headers, table, header_row)
            qty_col      = next((i for i, h in enumerate(headers) if "qty" in h or "quantity" in h), None)
            unit_col     = next((i for i, h in enumerate(headers) if h == "unit" or "uom" in h), None)
            supplier_col = next((i for i, h in enumerate(headers) if "supplier" in h or "vendor" in h), None)

            if desc_col is None or qty_col is None:
                continue

            for row in table[header_row + 1:]:
                if not row or all(c is None for c in row):
                    continue
                if _looks_like_header(row):
                    continue

                desc = _clean_description(str(row[desc_col] or "").strip())
                qty  = parse_quantity_from_cell(row[qty_col] if qty_col < len(row) else None)
                unit = str(row[unit_col] or "").strip() if unit_col is not None and unit_col < len(row) else "pcs"
                row_supplier = (
                    str(row[supplier_col] or "").strip()
                    if supplier_col is not None and supplier_col < len(row) else ""
                ) or doc_supplier

                if not desc or qty is None or qty <= 0:
                    continue

                items.append(ParsedPOItem(
                    material_name            = desc,
                    unit                     = unit,
                    actual_quantity_ordered  = qty,
                    supplier_name            = row_supplier,
                    order_date               = doc_order_date,
                    promised_delivery_date   = doc_delivery_date,
                    phase_hint               = current_phase,
                ))

    except FileNotFoundError as e:
        errors.append(str(e))
        page_count = 0
    except Exception as e:
        errors.append(f"Parse error: {str(e)}")
        page_count = 0

    return DocumentParsePOResponse(
        project_id  = request.project_id,
        items       = items,
        page_count  = page_count,
        parse_errors= errors,
    )
