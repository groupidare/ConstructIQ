from fastapi import APIRouter, HTTPException

from app.services.training_service import train_models

router = APIRouter()


@router.post("/train")
def train():
    try:
        return train_models()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
