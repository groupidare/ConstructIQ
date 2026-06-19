from fastapi import APIRouter
from app.models.schemas import ForecastRequest, ForecastResponse
from app.services.forecasting_service import run_forecast

router = APIRouter()


@router.post("/predict", response_model=ForecastResponse)
def predict(request: ForecastRequest) -> ForecastResponse:
    return run_forecast(request)
