import re
from collections import Counter

import pandas as pd

from app.models.schemas import (
    DocumentParseRequest, DocumentParseResponse, ParsedBOQItem,
    DocumentParsePOResponse, ParsedPOItem, HistoricalSupplyLine,
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
# "PO No.: 2024-118", "P.O. # 0045", "Purchase Order Number: JSB-77" — the
# value must contain a digit, so a label followed by a word isn't taken.
# On scans OCR can turn the colon into a stray character ("PO No. 2 0002011"),
# so one lone character before the value is skipped.
_PO_NUMBER_RE = re.compile(
    r"\b(?:purchase\s*order|p\.?\s*o\.?)\s*(?:no\.?|number|#)\s*[:\-]?\s*(?:\S\s+)?([A-Za-z0-9][\w\-/]*\d[\w\-/]*)",
    re.IGNORECASE,
)
# A bare "Date : 03/07/2025" header field — the PO date when no "Order date"
# label is found. Never a delivery/expected date. Month first, as written in
# the Philippines.
_PLAIN_DATE_RE = re.compile(
    r"(?<![A-Za-z])(?<!delivery )(?<!expected )(?<!promised )date\s*[:\-;]?\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})",
    re.IGNORECASE,
)
# Common OCR misreads of a unit on scanned POs ("Pcs" read as "Pes").
_OCR_UNIT_FIX = {"pes": "pcs", "pe": "pc"}
_STRICT_NUMBER_RE = re.compile(r"^\s*[\d,]+(?:\.\d+)?\s*$")


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
_OCR_LINE_RE = re.compile(
    r"^(?P<description>.+?)\s+(?P<quantity>\d+(?:[.,]\d+)?)\s*"
    r"(?P<unit>pcs?|bags?|m(?:2|3)?|kg|ltr|liters?|gal(?:lons?)?|rolls?|sets?|"
    r"lengths?|sheets?|units?)\b",
    re.IGNORECASE,
)
_OCR_LINE_RE_REVERSED = re.compile(
    r"^(?P<quantity>\d+(?:[.,]\d+)?)\s*(?P<unit>pcs?|bags?|m(?:2|3)?|kg|ltr|"
    r"liters?|gal(?:lons?)?|rolls?|sets?|lengths?|sheets?|units?)\s+"
    r"(?P<description>.+)$",
    re.IGNORECASE,
)


def _looks_like_header(row: list) -> bool:
    return any(
        any(sub in str(c or "").strip().lower() for sub in _HEADER_SUBSTRINGS)
        for c in row
    )


def _column_avg_text_len(rows: list, col: int) -> float:
    texts = [
        str(r[col] or "").strip() for r in rows
        if col < len(r) and str(r[col] or "").strip() and not _NUMERIC_CELL_RE.fullmatch(str(r[col] or "").strip())
    ]
    return sum(len(t) for t in texts) / len(texts) if texts else 0.0


def _data_rows_sample(table: list, header_row: int, qty_col: int | None, limit: int = 15) -> list:
    """Rows that look like real line items, for sanity-checking column
    guesses. A naive table[header_row+1 : +15] window can reach past the
    last real row into a trailing footer/signature block ("Prepared by: ...
    Approved by: ...") that happens to contain long text — which skews a
    "does this column look descriptive" average toward the wrong answer.
    Requiring a valid positive quantity in the already-known qty column is
    the same signal the main parse loop uses to recognize a real row."""
    rows = []
    for r in table[header_row + 1:]:
        if not r or all(c is None for c in r):
            continue
        if qty_col is not None:
            qty = parse_quantity_from_cell(r[qty_col]) if qty_col < len(r) else None
            if qty is None or qty <= 0:
                continue
        rows.append(r)
        if len(rows) >= limit:
            break
    return rows


def _find_desc_column(headers: list[str], table: list, header_row: int, qty_col: int | None) -> int | None:
    sample = _data_rows_sample(table, header_row, qty_col)

    for i, h in enumerate(headers):
        if any(sub in h for sub in _DESC_HEADER_SUBSTRINGS):
            # OCR'd headers sometimes merge two real columns into one cell
            # (e.g. "Stock Number Description") when that header phrase has a
            # narrower gap than the data below it — shifting every data
            # column one to the right of where the header text suggests. If
            # this column's actual values don't look like descriptions but
            # the next one does, that's what happened; use the neighbor.
            if _column_avg_text_len(sample, i) >= 4:
                return i
            if _column_avg_text_len(sample, i + 1) >= 4:
                return i + 1
            return i

    # Unknown header vocabulary (e.g. "Scope of Works" spelled some other way) —
    # fall back to whichever column actually holds long, non-numeric text
    # across a sample of data rows. This is what a description column looks
    # like regardless of what its header is called.
    best_col, best_avg_len = None, 0.0
    for i in range(len(headers)):
        avg_len = _column_avg_text_len(sample, i)
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


def _looks_like_real_name(desc: str) -> bool:
    """Rejects noise rows OCR occasionally turns into a "row" with a
    plausible-looking quantity, e.g. a footer/signature-block scrap like
    "SS ee eee =" — its digit-confusion-corrected "quantity" is real enough
    to pass the qty>0 check, but its "description" is not a material name."""
    return len(desc) >= 2 and any(c.isalpha() for c in desc)


def _is_section_heading(desc: str) -> bool:
    text = desc.strip()
    return bool(text) and len(text) > 2 and text.upper() == text and any(c.isalpha() for c in text)


def _parse_price(cell) -> float | None:
    """A unit price cell: "1,250.50", "₱ 480", "PHP 95.00". None when blank or not a number."""
    if cell is None:
        return None
    text = re.sub(r"(?i)php|₱|\$", "", str(cell)).strip()
    value = parse_quantity_from_cell(text)
    return value if value is not None and value >= 0 else None


def _clean_unit(unit: str) -> str:
    return _OCR_UNIT_FIX.get(unit.strip().lower(), unit.strip())


def _infer_po_columns(rows: list) -> tuple[int | None, int | None, int | None, int | None]:
    """(qty, unit, description, unit price) columns worked out from the item
    rows themselves — for a scanned table whose header row doesn't line up
    with its item rows (OCR split "Stock Number  Description" into two cells
    on the items but kept one on the header). Qty is the first number
    column, the unit a short word column after it, the description the
    wordiest column, and the unit price the first number column after the
    description (PO layouts put the unit price before the line totals)."""
    width = max((len(r) for r in rows), default=0)
    if width < 3:
        return None, None, None, None

    def cells(col: int) -> list[str]:
        return [str(r[col] or "").strip() for r in rows if col < len(r)]

    def share(col: int, test) -> float:
        values = cells(col)
        return sum(1 for v in values if v and test(v)) / max(len(values), 1)

    def letters(col: int) -> float:
        values = cells(col)
        return sum(sum(ch.isalpha() for ch in v) for v in values) / max(len(values), 1)

    numeric = [share(c, lambda v: bool(_STRICT_NUMBER_RE.match(v))) >= 0.6 for c in range(width)]
    qty_col = next((c for c in range(width) if numeric[c]), None)
    if qty_col is None:
        return None, None, None, None
    unit_col = next((c for c in range(qty_col + 1, width)
                     if share(c, lambda v: v.replace(".", "").isalpha() and len(v) <= 8) >= 0.6), None)
    word_cols = [c for c in range(width) if not numeric[c] and c != unit_col]
    desc_col = max(word_cols, key=letters, default=None)
    price_col = None if desc_col is None else next((c for c in range(desc_col + 1, width) if numeric[c]), None)
    return qty_col, unit_col, desc_col, price_col


def _extract_po_number(text: str) -> str | None:
    match = _PO_NUMBER_RE.search(text)
    return match.group(1).strip()[:50] if match else None


def _extract_date(pattern: re.Pattern, text: str) -> str | None:
    match = pattern.search(text)
    if not match:
        return None
    raw = match.group(1).strip().splitlines()[0][:40]
    parsed = pd.to_datetime(raw, errors="coerce")
    return None if pd.isna(parsed) else parsed.date().isoformat()


def _ocr_line_items(pages_text: list[str]) -> list[tuple[str, float, str]]:
    """Recover simple line items when an image-only document has no table grid."""
    found: list[tuple[str, float, str]] = []
    for line in "\n".join(pages_text).splitlines():
        text = " ".join(line.split()).strip(" -|:")
        if not text:
            continue
        match = _OCR_LINE_RE.match(text) or _OCR_LINE_RE_REVERSED.match(text)
        if not match:
            continue
        quantity = parse_quantity_from_cell(match.group("quantity"))
        description = _clean_description(match.group("description").strip())
        if quantity and quantity > 0 and description:
            found.append((description, quantity, match.group("unit").lower()))
    return found


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

            # Substring match, not exact - real headers are often "Installation
            # Scope Unit"/"Unit of Measure", never the bare word alone.
            unit_col    = next((i for i, h in enumerate(headers) if "unit" in h or h == "um" or "uom" in h), None)
            # "qty"/"quantity"/"total area" are treated as strong, unambiguous
            # signals (checked first); "scope"/"area" alone are a weaker
            # fallback only used once those come up empty, and both tiers
            # exclude unit_col — a header like "Installation Scope Unit" can
            # itself contain "scope"/"area", so without the exclusion the
            # fallback tier would grab the unit column instead of the real
            # quantity column.
            qty_col     = next((i for i, h in enumerate(headers) if i != unit_col and ("qty" in h or "quantity" in h or "total area" in h)), None)
            if qty_col is None:
                qty_col = next((i for i, h in enumerate(headers) if i != unit_col and ("scope" in h or "area" in h)), None)
            desc_col    = _find_desc_column(headers, table, header_row, qty_col)
            spec_col    = next((i for i, h in enumerate(headers) if ("spec" in h or "size" in h) and i != desc_col), None)
            # "sub" + section/category checked first — a plain "section"/"category"
            # search would otherwise match "Sub Primary Section" too and leave
            # nothing distinct for the primary-section column.
            sub_section_col = next((i for i, h in enumerate(headers) if "sub" in h and ("section" in h or "category" in h)), None)
            section_col = next((i for i, h in enumerate(headers) if i != sub_section_col and ("section" in h or "category" in h)), None)

            # A historical project's combined BOQ+PO report has a second block
            # of columns after the plain BOQ ones: PO Number, PO Date, Material
            # Name (Supplier), Unit, Qty, Supplier, Unit Cost, Total Cost. "unit"
            # and "qty" both appear twice in the header row (once per block), so
            # this second pass is deliberately scoped to columns after po_col —
            # a second *global* scan would just re-find the first BOQ-side
            # column again. When po_col isn't found (a plain BOQ file — the
            # normal, non-historical case), none of this activates and parsing
            # behaves exactly as before.
            po_col = next((i for i, h in enumerate(headers) if "po number" in h or "po no" in h or "po#" in h.replace(" ", "")), None)
            po_desc_col = po_unit_col = po_qty_col = supplier_col = po_cost_col = None
            if po_col is not None:
                for i, h in enumerate(headers):
                    if i <= po_col:
                        continue
                    # Cost/price checked before the generic "unit" match, so
                    # "UNIT COST" can never be taken as the unit column.
                    # TOTAL COST is derived (qty × unit cost) and ignored.
                    if "cost" in h or "price" in h:
                        if po_cost_col is None and "total" not in h:
                            po_cost_col = i
                    elif po_desc_col is None and ("material" in h or "desc" in h):
                        po_desc_col = i
                    elif po_unit_col is None and ("unit" in h or h == "um" or "uom" in h):
                        po_unit_col = i
                    elif po_qty_col is None and ("qty" in h or "quantity" in h):
                        po_qty_col = i
                    elif supplier_col is None and ("supplier" in h or "vendor" in h):
                        supplier_col = i

            if desc_col is None or qty_col is None:
                continue

            current_section = None
            current_primary_section = None
            current_sub_category = None
            current_po_number = None
            last_boq_item = None  # for combined-format PO-only continuation rows
            for row in table[header_row + 1:]:
                if not row or all(c is None for c in row):
                    continue
                if _looks_like_header(row):
                    phase_hint = detect_phase_from_text(" ".join(str(c or "") for c in row))
                    if phase_hint:
                        current_phase = phase_hint
                    continue

                desc    = _clean_description(str(row[desc_col] or "").strip()) if desc_col < len(row) else ""
                qty     = parse_quantity_from_cell(row[qty_col] if qty_col < len(row) else None)
                unit    = str(row[unit_col] or "").strip() if unit_col is not None and unit_col < len(row) else "pcs"
                spec    = str(row[spec_col] or "").strip() if spec_col is not None and spec_col < len(row) else ""
                section = str(row[section_col] or "").strip() if section_col is not None and section_col < len(row) else None
                sub_section = str(row[sub_section_col] or "").strip() if sub_section_col is not None and sub_section_col < len(row) else None

                # Excel merges a section-spanning cell down to its first row —
                # pandas reads every row after that as blank in that column.
                # Carry the last real value forward so every item in the
                # section still gets tagged with it, not just the first.
                if section:
                    current_primary_section = section
                if sub_section:
                    current_sub_category = sub_section

                # Combined-format PO block, if this table has one — captured
                # regardless of whether the BOQ side of this same row has data,
                # since the sample report's BOQ estimate cell is merged down to
                # only the first row of a multi-supplier group (see below).
                supply_line = None
                if po_desc_col is not None:
                    if po_col is not None and po_col < len(row):
                        po_val = str(row[po_col] or "").strip()
                        if po_val:
                            current_po_number = po_val
                    supply_desc = _clean_description(str(row[po_desc_col] or "").strip()) if po_desc_col < len(row) else ""
                    supply_qty = parse_quantity_from_cell(row[po_qty_col]) if po_qty_col is not None and po_qty_col < len(row) else None
                    if supply_desc and supply_qty is not None and supply_qty > 0:
                        supply_unit = str(row[po_unit_col] or "").strip() if po_unit_col is not None and po_unit_col < len(row) else ""
                        supply_supplier = str(row[supplier_col] or "").strip() if supplier_col is not None and supplier_col < len(row) else ""
                        supply_cost = parse_quantity_from_cell(row[po_cost_col]) if po_cost_col is not None and po_cost_col < len(row) else None
                        supply_line = HistoricalSupplyLine(
                            material_name = supply_desc,
                            unit          = supply_unit,
                            quantity      = supply_qty,
                            supplier_name = supply_supplier or None,
                            po_number     = current_po_number,
                            unit_cost     = supply_cost if supply_cost is not None and supply_cost >= 0 else None,
                        )

                if qty is None or qty <= 0:
                    # No BOQ-side quantity on this row. In a combined report
                    # this is normal for the 2nd/3rd+ supplier line of a BOQ
                    # group whose estimate cell only appears once — attach it
                    # to the BOQ item that started the group instead of
                    # dropping it (the old plain-BOQ behavior, unchanged when
                    # there's no PO block at all).
                    if supply_line is not None and last_boq_item is not None:
                        last_boq_item.historical_supply.append(supply_line)
                        continue
                    if _is_section_heading(desc):
                        current_section = desc
                    continue
                if not _looks_like_real_name(desc):
                    continue

                new_item = ParsedBOQItem(
                    material_name      = desc,
                    specification      = spec,
                    unit               = unit,
                    estimated_quantity = qty,
                    phase_hint         = current_section or current_phase,
                    primary_section    = current_primary_section,
                    sub_category       = current_sub_category,
                    historical_supply  = [supply_line] if supply_line is not None else [],
                )
                items.append(new_item)
                last_boq_item = new_item

        if not items:
            items.extend(
                ParsedBOQItem(
                    material_name=description,
                    specification="",
                    unit=unit,
                    estimated_quantity=quantity,
                    phase_hint=current_phase,
                )
                for description, quantity, unit in _ocr_line_items(pages_text)
            )

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
        doc_order_date    = _extract_date(_ORDER_DATE_RE, all_text) or _extract_date(_PLAIN_DATE_RE, all_text)
        doc_delivery_date = _extract_date(_DELIVERY_DATE_RE, all_text)
        doc_po_number     = _extract_po_number(all_text)

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

            # Unit price is found first so "UNIT PRICE"/"UNIT COST" is never
            # taken as the unit column; line totals ("AMOUNT", "TOTAL") are
            # derived and ignored.
            price_col    = next((i for i, h in enumerate(headers)
                                 if ("price" in h or "cost" in h or "rate" in h) and "total" not in h and "amount" not in h), None)
            unit_col     = next((i for i, h in enumerate(headers)
                                 if i != price_col and ("unit" in h or h == "um" or "uom" in h)
                                 and not any(w in h for w in ("price", "cost", "rate", "amount", "total"))), None)
            qty_col      = next((i for i, h in enumerate(headers) if i not in (unit_col, price_col) and ("qty" in h or "quantity" in h)), None)
            if qty_col is None:
                qty_col = next((i for i, h in enumerate(headers) if i != unit_col and ("scope" in h or "area" in h)), None)
            desc_col     = _find_desc_column(headers, table, header_row, qty_col)
            supplier_col = next((i for i, h in enumerate(headers) if "supplier" in h or "vendor" in h), None)
            total_col    = next((i for i in reversed(range(len(headers)))
                                 if ("total" in headers[i] or "amount" in headers[i]) and "unit" not in headers[i]), None)

            # Item rows wider than the header: its columns don't line up with
            # the items (a scan), so the columns are read off the items.
            item_rows = [r for r in table[header_row + 1:] if r and sum(1 for c in r if str(c or "").strip()) >= 3]
            if item_rows and Counter(len(r) for r in item_rows).most_common(1)[0][0] > len(headers):
                inferred = _infer_po_columns(item_rows)
                if inferred[0] is not None and inferred[2] is not None:
                    qty_col, unit_col, desc_col, price_col = inferred
                    supplier_col = None
                    # The line total is the last number column.
                    last = max((c for c in range(len(item_rows[0]))
                                if all(_STRICT_NUMBER_RE.match(str(r[c] or "")) for r in item_rows if c < len(r))), default=None)
                    total_col = last if last not in (None, qty_col, price_col) else None

            if desc_col is None or qty_col is None:
                continue

            for row in table[header_row + 1:]:
                if not row or all(c is None for c in row):
                    continue
                if _looks_like_header(row):
                    continue

                desc = _clean_description(str(row[desc_col] or "").strip()) if desc_col < len(row) else ""
                qty  = parse_quantity_from_cell(row[qty_col] if qty_col < len(row) else None)
                unit = _clean_unit(str(row[unit_col] or "")) if unit_col is not None and unit_col < len(row) else "pcs"
                row_supplier = (
                    str(row[supplier_col] or "").strip()
                    if supplier_col is not None and supplier_col < len(row) else ""
                ) or doc_supplier

                if qty is None or qty <= 0 or not _looks_like_real_name(desc):
                    continue

                price = _parse_price(row[price_col]) if price_col is not None and price_col < len(row) else None
                total = _parse_price(row[total_col]) if total_col is not None and total_col < len(row) else None
                mismatch = price is not None and total is not None and abs(qty * price - total) > max(1.0, 0.01 * total)

                items.append(ParsedPOItem(
                    material_name            = desc,
                    unit                     = unit,
                    actual_quantity_ordered  = qty,
                    supplier_name            = row_supplier,
                    order_date               = doc_order_date,
                    promised_delivery_date   = doc_delivery_date,
                    phase_hint               = current_phase,
                    unit_price               = price,
                    po_number                = doc_po_number,
                    total_mismatch           = mismatch,
                ))

        if not items:
            items.extend(
                ParsedPOItem(
                    material_name=description,
                    unit=unit,
                    actual_quantity_ordered=quantity,
                    supplier_name=doc_supplier,
                    order_date=doc_order_date,
                    promised_delivery_date=doc_delivery_date,
                    phase_hint=current_phase,
                    po_number=doc_po_number,
                )
                for description, quantity, unit in _ocr_line_items(pages_text)
            )

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
