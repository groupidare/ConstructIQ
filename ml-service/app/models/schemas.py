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


class ForecastedLine(BaseModel):
    """One BOQ row's own prediction (PO/purchase quantity, in `unit` — the row's
    purchase unit when it has one). forecasted_materials sums these per
    (material, unit); this keeps them per row."""
    boq_item_id:          int
    material_id:          int
    unit:                 str
    forecasted_quantity:  float
    # False when `unit` is only the row's BOQ unit (no purchase unit on the
    # row, material never seen in training) — the figure is then not a
    # known purchase-unit quantity, and callers filling a purchase-unit
    # Est. Qty should not use it.
    purchase_unit_known:  bool = True


class ForecastResponse(BaseModel):
    project_id:           int
    phase_id:             Optional[int]
    period:               str
    model_accuracy:       Optional[float]
    forecasted_materials: list[ForecastedMaterial]
    # Optional/additive — older callers that only read forecasted_materials
    # are unaffected.
    line_forecasts:       list[ForecastedLine] = []
    # Which trained model version produced this (see model_registry), and its
    # training-time confidence ("Normal"/"Low"). Every AI forecast carries one.
    model_version:        Optional[str] = None
    model_confidence:     Optional[str] = None


class DocumentParseRequest(BaseModel):
    file_path: str
    project_id: int


class HistoricalSupplyLine(BaseModel):
    """One real, already-happened purchase line extracted from a historical
    project's combined BOQ+PO report — only populated when the source sheet
    has a PO block after the plain BOQ columns; empty for a plain BOQ file."""
    material_name: str
    unit:          str
    quantity:      float
    supplier_name: Optional[str] = None
    po_number:     Optional[str] = None


class ParsedBOQItem(BaseModel):
    material_name:     str
    specification:     str
    unit:              str
    estimated_quantity:float
    phase_hint:        Optional[str] = None
    primary_section:   Optional[str] = None
    sub_category:      Optional[str] = None
    historical_supply: list[HistoricalSupplyLine] = []


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
