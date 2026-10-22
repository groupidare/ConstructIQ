from dotenv import load_dotenv
load_dotenv()  # loads ml-service/.env (e.g. DATABASE_URL) — must run before any DB access

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import forecast, document_parser, train, boq_generation
from app.utils.auth import verify_api_key

app = FastAPI(
    title="ConstructIQ ML Service",
    description="Forecasting (Random Forest + XGBoost) and document parsing microservice",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(forecast.router,        prefix="/forecast",  tags=["Forecasting"],     dependencies=[Depends(verify_api_key)])
app.include_router(document_parser.router, prefix="/documents", tags=["Document Parsing"], dependencies=[Depends(verify_api_key)])
app.include_router(train.router,           prefix="/forecast",  tags=["Forecasting"],      dependencies=[Depends(verify_api_key)])
# /boq/templates, /boq/generate, /estimation/baseline
app.include_router(boq_generation.router,                       tags=["BOQ Generation"],   dependencies=[Depends(verify_api_key)])


@app.get("/health")
def health():
    from app.services import azure_document
    return {
        "status": "ok", "service": "ConstructIQ ML Service",
        # Optional Azure Document Intelligence for scanned BOQs/POs and line-text plans.
        "azure_document_intelligence": {
            "enabled": azure_document.enabled(),
            "pages_this_month": azure_document.pages_used_this_month(),
            "monthly_cap": azure_document.monthly_cap(),
        },
    }
