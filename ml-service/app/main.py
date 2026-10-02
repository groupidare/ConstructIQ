from dotenv import load_dotenv
load_dotenv()  # loads ml-service/.env (e.g. DATABASE_URL) — must run before any DB access

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import forecast, document_parser, train
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


@app.get("/health")
def health():
    return {"status": "ok", "service": "ConstructIQ ML Service"}
