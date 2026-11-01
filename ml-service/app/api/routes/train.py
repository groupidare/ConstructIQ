from fastapi import APIRouter, HTTPException

from app.ml import model_registry
from app.services import training_jobs, training_service

router = APIRouter()


@router.post("/train", status_code=202)
def train():
    """Starts a background training run (see training_jobs) and returns its
    initial state at once — poll GET /forecast/model-status for the outcome."""
    try:
        return training_jobs.start()
    except training_jobs.TrainingAlreadyRunning as e:
        raise HTTPException(status_code=409, detail={"code": "training_in_progress", "message": str(e)})


@router.get("/model-status")
def model_status():
    """The active model (trained or not, plus its training metadata) and the
    latest training run's state."""
    return {"model": model_registry.status(), "training": training_jobs.snapshot()}


@router.get("/training-data")
def training_data():
    """Which completed projects/rows training can use, and why the rest can't."""
    return training_service.training_data_report()
