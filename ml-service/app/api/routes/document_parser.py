from fastapi import APIRouter
from app.models.schemas import DocumentParseRequest, DocumentParseResponse, DocumentParsePOResponse
from app.services.document_parser_service import parse_boq_document, parse_po_document

router = APIRouter()


@router.post("/parse", response_model=DocumentParseResponse)
def parse(request: DocumentParseRequest) -> DocumentParseResponse:
    return parse_boq_document(request)


@router.post("/parse-po", response_model=DocumentParsePOResponse)
def parse_po(request: DocumentParseRequest) -> DocumentParsePOResponse:
    return parse_po_document(request)
