from fastapi import APIRouter
from app.models.schemas import DocumentParseRequest, DocumentParseResponse
from app.services.document_parser_service import parse_boq_document

router = APIRouter()


@router.post("/parse", response_model=DocumentParseResponse)
def parse(request: DocumentParseRequest) -> DocumentParseResponse:
    return parse_boq_document(request)
