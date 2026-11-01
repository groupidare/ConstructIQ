from pathlib import Path

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"}

Row = list[str | None]
Table = list[Row]


def _ocr_image(image) -> str:
    from PIL import ImageOps
    import pytesseract

    grayscale = ImageOps.grayscale(image)
    return pytesseract.image_to_string(grayscale, config="--psm 6").strip()


def _ocr_image_words(image) -> list[dict]:
    from PIL import ImageOps
    import pytesseract
    from pytesseract import Output

    grayscale = ImageOps.grayscale(image)
    data = pytesseract.image_to_data(grayscale, config="--psm 6", output_type=Output.DICT)
    words = []
    for i in range(len(data["text"])):
        text = data["text"][i].strip()
        if not text:
            continue
        words.append({
            "text": text,
            "left": data["left"][i],
            "width": data["width"][i],
            "line_key": (data["block_num"][i], data["par_num"][i], data["line_num"][i]),
        })
    return words


def _words_to_table(words: list[dict]) -> Table:
    """Reconstruct a table's row/column structure from OCR word boxes.
    tesseract's plain-text output collapses every gap — wide (a column
    boundary) or narrow (a space within a cell) — down to a single space,
    destroying the layout. Rebuilding from each word's actual pixel position
    is the standard way to recover columns from OCR without real table
    detection.

    The gap threshold is computed once, over every word on the page, rather
    than per line: a per-line threshold made the header row's own average
    character width (often larger/bolder text) split cells at a different
    point than the data rows below it, so a header phrase like "Stock Number
    Description" would merge into one cell while the same-looking gap in a
    data row split into two — silently shifting every column after it out
    of alignment with the header."""
    if not words:
        return []

    avg_char_width = sum(w["width"] / max(len(w["text"]), 1) for w in words) / len(words)
    gap_threshold = max(avg_char_width * 2.5, 20)

    rows: dict[tuple, list[dict]] = {}
    for w in words:
        rows.setdefault(w["line_key"], []).append(w)

    table: Table = []
    for key in sorted(rows.keys()):
        line_words = sorted(rows[key], key=lambda w: w["left"])

        row: Row = []
        current_cell = [line_words[0]["text"]]
        prev_right = line_words[0]["left"] + line_words[0]["width"]
        for w in line_words[1:]:
            if w["left"] - prev_right > gap_threshold:
                row.append(" ".join(current_cell))
                current_cell = [w["text"]]
            else:
                current_cell.append(w["text"])
            prev_right = w["left"] + w["width"]
        row.append(" ".join(current_cell))
        table.append(row)
    return table


def extract_text_with_ocr(file_path: str) -> tuple[list[str], int]:
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    if path.suffix.lower() in IMAGE_EXTENSIONS:
        from PIL import Image

        text = _ocr_image(Image.open(path))
        return [text], 1

    if path.suffix.lower() != ".pdf":
        raise ValueError(f"OCR is not supported for file type: {path.suffix}")

    from pdf2image import convert_from_path

    pages = convert_from_path(str(path), dpi=250)
    return [_ocr_image(page) for page in pages], len(pages)


def extract_tables_with_ocr(file_path: str) -> list[Table]:
    """Same source images as extract_text_with_ocr, but preserves column
    structure via word bounding boxes instead of flattening to plain text —
    use this when the caller needs distinct cells (BOQ/PO line-item
    parsing), not just searchable text."""
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    if path.suffix.lower() in IMAGE_EXTENSIONS:
        from PIL import Image
        return [_words_to_table(_ocr_image_words(Image.open(path)))]

    if path.suffix.lower() != ".pdf":
        raise ValueError(f"OCR is not supported for file type: {path.suffix}")

    from pdf2image import convert_from_path

    pages = convert_from_path(str(path), dpi=250)
    return [_words_to_table(_ocr_image_words(page)) for page in pages]