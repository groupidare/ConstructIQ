from pydantic import BaseModel
from typing import Optional
from enum import Enum


class ForecastPeriod(str, Enum):
    weekly   = "Weekly"
    monthly  = "Monthly"
    phase_end= "PhaseEnd"


class RiskLevel(str, Enum):
    low      = "Low"
    medium   = "Medium"
    high     = "High"
    critical = "Critical"


class ForecastRequest(BaseModel):
    project_id:     int
    phase_id:       Optional[int] = None
    period:         ForecastPeriod = ForecastPeriod.monthly
    planning_weeks: int = 4


class ForecastedMaterial(BaseModel):
    material_id:          int
    material_name:        str
    unit:                 str
    forecasted_quantity:  float
    current_stock:        float
    shortage:             float
    reorder_suggestion:   float
    risk_level:           RiskLevel


class ForecastResponse(BaseModel):
    project_id:           int
    phase_id:             Optional[int]
    period:               str
    model_accuracy:       Optional[float]
    forecasted_materials: list[ForecastedMaterial]


class DocumentParseRequest(BaseModel):
    file_path: str
    project_id: int


class ParsedBOQItem(BaseModel):
    material_name:     str
    specification:     str
    unit:              str
    estimated_quantity:float
    phase_hint:        Optional[str] = None
    primary_section:   Optional[str] = None
    sub_category:      Optional[str] = None


class DocumentParseResponse(BaseModel):
    project_id:  int
    items:       list[ParsedBOQItem]
    page_count:  int
    parse_errors:list[str] = []


class ParsedPOItem(BaseModel):
    material_name:           str
    unit:                    str
    actual_quantity_ordered: float
    supplier_name:           Optional[str] = None
    order_date:              Optional[str] = None  # ISO date string, or None if not found/unparseable
    promised_delivery_date:  Optional[str] = None
    phase_hint:              Optional[str] = None


class DocumentParsePOResponse(BaseModel):
    project_id:  int
    items:       list[ParsedPOItem]
    page_count:  int
    parse_errors:list[str] = []
