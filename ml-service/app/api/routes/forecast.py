from fastapi import APIRouter, HTTPException
from app.models.schemas import ForecastRequest, ForecastResponse
from app.services.forecasting_service import run_forecast, ModelNotAvailable

router = APIRouter()


@router.post("/predict", response_model=ForecastResponse)
def predict(request: ForecastRequest) -> ForecastResponse:
    try:
        return run_forecast(request)
    except ModelNotAvailable as e:
        # 409, with a machine-readable code: the backend turns this into a
        # clear "train the model first" message instead of a generic failure.
        raise HTTPException(status_code=409, detail={"code": "model_not_trained", "message": str(e)})
