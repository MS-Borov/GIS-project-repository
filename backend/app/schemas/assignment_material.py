from datetime import datetime

from pydantic import BaseModel


class AssignmentMaterialRead(BaseModel):
    id: int
    assignment_id: int
    material_name: str
    material_type: str
    detected_format: str
    status: str
    message: str
    storage_key: str
    created_at: datetime
    updated_at: datetime
    download_url: str | None = None

    model_config = {"from_attributes": True}
