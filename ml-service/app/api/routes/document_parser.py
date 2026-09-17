from fastapi import APIRouter
from app.models.schemas import DocumentParseRequest, DocumentParseResponse, DocumentParseMeasurementsResponse
from app.services.document_parser_service import parse_boq_document, parse_measurements_document

router = APIRouter()


@router.post("/parse", response_model=DocumentParseResponse)
def parse(request: DocumentParseRequest) -> DocumentParseResponse:
    return parse_boq_document(request)


@router.post("/parse-measurements", response_model=DocumentParseMeasurementsResponse)
def parse_measurements(request: DocumentParseRequest) -> DocumentParseMeasurementsResponse:
    return parse_measurements_document(request)
