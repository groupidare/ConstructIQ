"""Lazy-loaded EasyOCR reader — importing torch/easyocr is slow (~seconds) and
only needed when a blueprint page has no embedded text (i.e. it's a scanned
image), so we avoid paying that cost on every ML service startup."""
_reader = None


def get_reader():
    global _reader
    if _reader is None:
        import easyocr
        _reader = easyocr.Reader(["en"], gpu=False)
    return _reader
