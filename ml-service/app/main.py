from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import forecast, document_parser

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

app.include_router(forecast.router,        prefix="/forecast",  tags=["Forecasting"])
app.include_router(document_parser.router, prefix="/documents", tags=["Document Parsing"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "ConstructIQ ML Service"}
