from app.models.schemas import DocumentParseRequest, DocumentParseResponse, ParsedBOQItem
from app.utils.pdf_extractor import (
    extract_tables_from_pdf,
    detect_phase_from_text,
    parse_quantity_from_cell,
    extract_text_from_pdf,
)


UNIT_KEYWORDS = {"pcs", "pc", "bags", "bag", "m", "m2", "m3", "kg", "ltr", "gal", "roll", "set", "length", "sheets", "units"}


def _is_unit(value: str | None) -> bool:
    return str(value or "").strip().lower() in UNIT_KEYWORDS


def _looks_like_header(row: list) -> bool:
    header_words = {"item", "description", "material", "qty", "quantity", "unit", "cost", "amount"}
    return any(str(c or "").lower() in header_words for c in row)


def parse_boq_document(request: DocumentParseRequest) -> DocumentParseResponse:
    errors:  list[str]     = []
    items:   list[ParsedBOQItem] = []

    try:
        pages_text, _ = extract_text_from_pdf(request.file_path)
        all_text = "\n".join(pages_text)

        tables, _ = extract_tables_from_pdf(request.file_path)
        page_count = len(pages_text)

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

            desc_col = next((i for i, h in enumerate(headers) if "desc" in h or "material" in h or "item" in h), None)
            qty_col  = next((i for i, h in enumerate(headers) if "qty" in h or "quantity" in h), None)
            unit_col = next((i for i, h in enumerate(headers) if h == "unit" or "uom" in h), None)
            spec_col = next((i for i, h in enumerate(headers) if "spec" in h or "size" in h), None)

            if desc_col is None or qty_col is None:
                continue

            for row in table[header_row + 1:]:
                if not row or all(c is None for c in row):
                    continue
                if _looks_like_header(row):
                    phase_hint = detect_phase_from_text(" ".join(str(c or "") for c in row))
                    if phase_hint:
                        current_phase = phase_hint
                    continue

                desc = str(row[desc_col] or "").strip()
                qty  = parse_quantity_from_cell(row[qty_col] if qty_col < len(row) else None)
                unit = str(row[unit_col] or "").strip() if unit_col is not None and unit_col < len(row) else "pcs"
                spec = str(row[spec_col] or "").strip() if spec_col is not None and spec_col < len(row) else ""

                if not desc or qty is None or qty <= 0:
                    continue

                items.append(ParsedBOQItem(
                    material_name      = desc,
                    specification      = spec,
                    unit               = unit,
                    estimated_quantity = qty,
                    phase_hint         = current_phase,
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
