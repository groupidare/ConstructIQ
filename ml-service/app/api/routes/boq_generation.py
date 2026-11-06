from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.ml import baseline_engine
from app.services import boq_generator_service

router = APIRouter()


class NoteRef(BaseModel):
    """A note on the drawing: its words, page (1-based) and box on the page (PDF points)."""
    text: str
    page: Optional[int] = None
    box: Optional[list[float]] = None


class RoomMeasurement(BaseModel):
    room: str
    floor_area_sqm: float
    perimeter_m: float = 0
    height_m: Optional[float] = None
    openings_sqm: float = 0
    # What the floor's reflected ceiling plan says in this room; has_ceiling_plan:
    # the floor had one, so a room with no note there has no ceiling on the drawing.
    ceiling_notes: list[NoteRef] = []
    has_ceiling_plan: bool = False
    # Metres of the perimeter that are glass (not painted), and why the height
    # isn't the room's ceiling height, when it isn't.
    glass_length_m: float = 0
    height_note: Optional[str] = None


class RoomFinish(BaseModel):
    room: str
    floor: Optional[str] = None
    wall: Optional[str] = None
    ceiling: Optional[str] = None


class Opening(BaseModel):
    type: str
    count: int
    width_m: Optional[float] = None
    height_m: Optional[float] = None


class GenerateRequest(BaseModel):
    measurements: list[RoomMeasurement]
    finishes: list[RoomFinish]
    materials: list[dict]
    openings: list[Opening] = []
    source: Optional[str] = None
    per_room_floor: bool = False
    plan_notes: list[NoteRef] = []


class BaselineItem(BaseModel):
    material: dict
    boq_unit: Optional[str] = None
    boq_quantity: Optional[float] = None


class BaselineRequest(BaseModel):
    items: list[BaselineItem]


@router.get("/boq/templates")
def templates() -> dict:
    return {"templates": boq_generator_service.load_templates()}


@router.post("/boq/generate")
def generate(request: GenerateRequest) -> dict:
    return boq_generator_service.generate(
        [m.model_dump() for m in request.measurements],
        [f.model_dump() for f in request.finishes],
        request.materials,
        [o.model_dump() for o in request.openings],
        request.source,
        per_room_floor=request.per_room_floor,
        plan_notes=[n.model_dump() for n in request.plan_notes],
    )


@router.post("/estimation/baseline")
def baseline(request: BaselineRequest) -> dict:
    results = []
    for item in request.items:
        r = baseline_engine.compute(item.material, item.boq_unit, item.boq_quantity)
        results.append({"baseline_quantity": r.baseline_quantity, "purchase_quantity": r.purchase_quantity,
                        "purchase_unit": r.purchase_unit, "formula_text": r.formula_text, "reason": r.reason})
    return {"results": results}
