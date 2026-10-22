"""Azure AI Document Intelligence (Layout / Read) — optional.

Switched on only when AZURE_DI_ENDPOINT and AZURE_DI_KEY are set; otherwise
`enabled()` is False and every caller keeps its built-in reader (pdfplumber,
Tesseract). Any Azure failure raises AzureUnavailable, which callers treat
the same way — scanning never fails because of Azure.

Cost controls (Azure for Students, free F0 tier):
- One page per request, sent as an image: F0 reads only the first two pages
  of whatever it is sent, so a whole multi-page file would be cut short.
- Results are cached on disk by page content + model, so the same page is
  never sent twice (the wizard reads a plan more than once, tests re-run).
- AZURE_MAX_PAGES_PER_MONTH (default 400, under F0's 500) is a hard cap;
  past it the built-in readers take over until the next month.

Plain REST over httpx (already a dependency) rather than the Azure SDK, so
deploying this needs no new package.
"""
from __future__ import annotations

import hashlib
import io
import json
import logging
import os
import threading
import time
from datetime import date
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

API_VERSION = "2024-11-30"
LAYOUT = "prebuilt-layout"   # tables + text
READ = "prebuilt-read"       # text only
REQUEST_TIMEOUT_S = 30
ANALYZE_DEADLINE_S = 90
MAX_IMAGE_BYTES = 3_800_000  # F0 accepts up to 4 MB per request
_CACHE_DIR = Path(os.getenv("AZURE_DI_CACHE_DIR") or Path(__file__).resolve().parents[2] / "azure_cache")
_lock = threading.Lock()


class AzureUnavailable(Exception):
    """Not configured, over the monthly cap, or the call failed."""


def _settings() -> tuple[str, str] | None:
    endpoint = (os.getenv("AZURE_DI_ENDPOINT") or "").strip().rstrip("/")
    key = (os.getenv("AZURE_DI_KEY") or "").strip()
    return (endpoint, key) if endpoint and key else None


def enabled() -> bool:
    return _settings() is not None


def monthly_cap() -> int:
    return int(os.getenv("AZURE_MAX_PAGES_PER_MONTH", "400"))


# ── usage + cache ─────────────────────────────────────────────────────────────

def _usage_path() -> Path:
    return _CACHE_DIR / "usage.json"


def pages_used_this_month() -> int:
    try:
        usage = json.loads(_usage_path().read_text(encoding="utf-8"))
        return int(usage.get("pages", 0)) if usage.get("month") == date.today().strftime("%Y-%m") else 0
    except (OSError, ValueError):
        return 0


def _reserve_page() -> None:
    """Counts a page before it is sent; refuses past the monthly cap."""
    with _lock:
        used = pages_used_this_month()
        if used >= monthly_cap():
            raise AzureUnavailable(f"Azure monthly page cap reached ({monthly_cap()} pages).")
        _write_usage(used + 1)


def _release_page() -> None:
    """Gives back a page Azure never accepted (refused or unreachable) — Azure
    doesn't count those either."""
    with _lock:
        _write_usage(max(pages_used_this_month() - 1, 0))


def _write_usage(pages: int) -> None:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _usage_path().write_text(json.dumps({"month": date.today().strftime("%Y-%m"), "pages": pages}), encoding="utf-8")


def _cache_get(key: str) -> dict | None:
    try:
        return json.loads((_CACHE_DIR / f"{key}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _cache_put(key: str, result: dict) -> None:
    try:
        _CACHE_DIR.mkdir(parents=True, exist_ok=True)
        (_CACHE_DIR / f"{key}.json").write_text(json.dumps(result), encoding="utf-8")
    except OSError:
        logger.warning("Couldn't cache an Azure result", exc_info=True)


# ── calls ─────────────────────────────────────────────────────────────────────

def _wait(response: httpx.Response, default: float) -> float:
    try:
        return min(float(response.headers.get("Retry-After", default)), 10.0)
    except ValueError:
        return default


def analyze_image(image_bytes: bytes, model: str = LAYOUT) -> dict:
    """One page image → Azure's analyzeResult (pages, lines, words, tables)."""
    settings = _settings()
    if settings is None:
        raise AzureUnavailable("Azure Document Intelligence isn't configured.")
    key = hashlib.sha256(model.encode() + b"\0" + image_bytes).hexdigest()
    cached = _cache_get(key)
    if cached is not None:
        return cached

    _reserve_page()
    endpoint, api_key = settings
    url = f"{endpoint}/documentintelligence/documentModels/{model}:analyze?api-version={API_VERSION}"
    headers = {"Ocp-Apim-Subscription-Key": api_key}
    accepted = False  # once Azure accepts a page it may count it, whatever happens after
    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT_S) as client:
            for attempt in range(4):
                submitted = client.post(url, content=image_bytes,
                                        headers={**headers, "Content-Type": "application/octet-stream"})
                if submitted.status_code != 429:
                    break
                time.sleep(_wait(submitted, 2.0 * (attempt + 1)))  # F0 is rate-limited
            if submitted.status_code != 202:
                raise AzureUnavailable(f"Azure refused the page ({submitted.status_code}).")
            accepted = True
            operation = submitted.headers["Operation-Location"]

            deadline = time.monotonic() + ANALYZE_DEADLINE_S
            while time.monotonic() < deadline:
                polled = client.get(operation, headers=headers)
                if polled.status_code == 429:
                    time.sleep(_wait(polled, 2.0))
                    continue
                body = polled.json()
                status = body.get("status")
                if status == "succeeded":
                    result = body.get("analyzeResult") or {}
                    _cache_put(key, result)
                    return result
                if status == "failed":
                    raise AzureUnavailable("Azure couldn't read the page.")
                time.sleep(_wait(polled, 1.0))
            raise AzureUnavailable("Azure took too long to read the page.")
    except AzureUnavailable:
        if not accepted:
            _release_page()
        raise
    except (httpx.HTTPError, KeyError, ValueError) as e:
        if not accepted:
            _release_page()
        raise AzureUnavailable(f"Azure call failed ({type(e).__name__}).") from e


# ── page images ───────────────────────────────────────────────────────────────

def encode_image(image) -> bytes:
    """A PIL image as the smaller of PNG (line drawings) and JPEG (photos),
    shrunk until it fits Azure's request size."""
    image = image.convert("L")
    while True:
        candidates = []
        for fmt, options in (("PNG", {"optimize": True}), ("JPEG", {"quality": 85})):
            buffer = io.BytesIO()
            image.save(buffer, fmt, **options)
            candidates.append(buffer.getvalue())
        best = min(candidates, key=len)
        if len(best) <= MAX_IMAGE_BYTES or min(image.size) < 600:
            return best
        image = image.resize((int(image.width * 0.8), int(image.height * 0.8)))


def file_page_images(path: str, max_pages: int = 30, dpi: int = 200) -> list[bytes]:
    """Each page of a PDF (or the image itself) as an encoded image."""
    if Path(path).suffix.lower() == ".pdf":
        import pdfplumber
        from app.utils.pdf_render import page_image
        with pdfplumber.open(path) as pdf:
            return [encode_image(page_image(page, dpi)) for page in pdf.pages[:max_pages]]
    from PIL import Image
    with Image.open(path) as image:
        return [encode_image(image)]


# ── results → our shapes ──────────────────────────────────────────────────────

def tables_from(result: dict) -> list[list[list[str | None]]]:
    """Azure tables as row lists. A merged cell's text sits in its top-left
    cell only — the same as a spreadsheet's merged cells, which the BOQ
    parser already carries forward (a merged quantity is never repeated)."""
    tables = []
    for t in result.get("tables") or []:
        grid: list[list[str | None]] = [[None] * t["columnCount"] for _ in range(t["rowCount"])]
        for cell in t.get("cells") or []:
            text = (cell.get("content") or "").replace(":selected:", "").replace(":unselected:", "").strip()
            grid[cell["rowIndex"]][cell["columnIndex"]] = text or None
        tables.append(grid)
    return tables


def page_text(result: dict) -> str:
    return "\n".join(line.get("content", "") for page in result.get("pages") or [] for line in page.get("lines") or [])
