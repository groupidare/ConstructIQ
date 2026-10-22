"""Page images from pdfplumber, one at a time.

pdfplumber renders with pdfium (pypdfium2), which isn't thread-safe: two
requests rendering at once — the wizard opening twice in React's dev mode, or
a blueprint read alongside a scanned-BOQ read — fail with PdfiumError. Every
render goes through this lock.
"""
import threading

_LOCK = threading.Lock()


def page_image(page, dpi: float):
    with _LOCK:
        return page.to_image(resolution=dpi).original
