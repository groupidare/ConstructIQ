import os
import tempfile

from fastapi import APIRouter, UploadFile, File, Form

from app.models.schemas import DocumentParseRequest, DocumentParseResponse, DocumentParsePOResponse
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


@router.post("/parse-po", response_model=DocumentParsePOResponse)
async def parse_po(project_id: int = Form(...), file: UploadFile = File(...)) -> DocumentParsePOResponse:
    tmp_path = await _save_to_temp_file(file)
    try:
        return parse_po_document(DocumentParseRequest(file_path=tmp_path, project_id=project_id))
    finally:
        _cleanup_temp_file(tmp_path)
