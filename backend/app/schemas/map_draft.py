from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class MapDraftCreate(BaseModel):
    assignment_id: int
    name: str = Field(default="draft-layer", min_length=1, max_length=255)
    geometry_type: str = Field(default="mixed", max_length=50)
    geojson: dict[str, Any]


class MapDraftUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    geometry_type: str | None = Field(default=None, max_length=50)
    geojson: dict[str, Any] | None = None


class MapDraftRead(BaseModel):
    id: int
    assignment_id: int
    student_id: int
    last_submission_id: int | None = None
    name: str
    geometry_type: str
    geojson_storage_key: str
    feature_count: int
    status: str
    created_at: datetime
    updated_at: datetime
    geojson: dict[str, Any] | None = None

    model_config = {"from_attributes": True}
