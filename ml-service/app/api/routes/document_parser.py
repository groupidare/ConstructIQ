import os
import tempfile
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Response
from starlette.concurrency import run_in_threadpool

from app.models.schemas import DocumentParseRequest, DocumentParseResponse, DocumentParsePOResponse
from app.services.blueprint_parser_service import parse_blueprint, page_sizes, render_page
from app.services.document_parser_service import parse_boq_document, parse_po_document

router = APIRouter()


async def _save_to_temp_file(file: UploadFile) -> str:
    # The parser dispatches on file extension (tabular_extractor.py checks
    # path.suffix), so the temp file must keep the uploaded file's real
    # extension, not just be an arbitrary temp name.
    suffix = os.path.splitext(file.filename or "")[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        return tmp.name


# Receives the actual file bytes (multipart) rather than a filesystem path —
# the backend and this service are separate processes/containers in any real
# deployment (Render, Docker) with no shared filesystem, so a path that's
# only valid on the backend's disk would never resolve here.
def _cleanup_temp_file(tmp_path: str) -> None:
    # Best-effort — a parsing library (openpyxl/pandas) can still hold its
    # own handle on the file for a moment after the parse call returns,
    # which makes an immediate delete fail with a PermissionError on
    # Windows. The actual parse result is already produced by this point,
    # so a cleanup failure here should never turn a successful request into
    # a 500; the OS temp-directory cleanup reclaims it eventually either way.
    try:
        os.unlink(tmp_path)
    except OSError:
        pass


@router.post("/parse", response_model=DocumentParseResponse)
async def parse(project_id: int = Form(...), file: UploadFile = File(...)) -> DocumentParseResponse:
    tmp_path = await _save_to_temp_file(file)
    try:
        return parse_boq_document(DocumentParseRequest(file_path=tmp_path, project_id=project_id))
    finally:
        _cleanup_temp_file(tmp_path)


@router.post("/parse-blueprint")
async def parse_blueprint_route(
    file: UploadFile = File(...),
    sheet: Optional[str] = Form(None),
    drawing_id: Optional[str] = Form(None),
    scale_override: Optional[str] = Form(None),
) -> dict:
    """Rooms/openings/heights from a CAD-exported PDF or DXF. A large plan set
    takes up to a minute or two the first time (repeat calls on the same file
    are cached), so it runs in a worker thread — never on the event loop,
    where it would stall every other request (including /health)."""
    tmp_path = await _save_to_temp_file(file)
    try:
        return await run_in_threadpool(parse_blueprint, tmp_path, file.filename or tmp_path, sheet, drawing_id, scale_override)
    finally:
        _cleanup_temp_file(tmp_path)


@router.post("/page-info")
async def page_info(file: UploadFile = File(...)) -> dict:
    """Each page's size in PDF points — for the Material Plan's plan viewer."""
    tmp_path = await _save_to_temp_file(file)
    try:
        return {"pages": await run_in_threadpool(page_sizes, tmp_path)}
    finally:
        _cleanup_temp_file(tmp_path)


@router.post("/render-page")
async def render_page_route(file: UploadFile = File(...), page: int = Form(...), width: int = Form(1400)) -> Response:
    """One page of a PDF as a PNG, `width` pixels wide."""
    tmp_path = await _save_to_temp_file(file)
    try:
        png = await run_in_threadpool(render_page, tmp_path, page, width)
    except IndexError:
        raise HTTPException(status_code=404, detail="No such page.")
    finally:
        _cleanup_temp_file(tmp_path)
    return Response(content=png, media_type="image/png")


@router.post("/parse-po", response_model=DocumentParsePOResponse)
async def parse_po(project_id: int = Form(...), file: UploadFile = File(...)) -> DocumentParsePOResponse:
    tmp_path = await _save_to_temp_file(file)
    try:
        return parse_po_document(DocumentParseRequest(file_path=tmp_path, project_id=project_id))
    finally:
        _cleanup_temp_file(tmp_path)
