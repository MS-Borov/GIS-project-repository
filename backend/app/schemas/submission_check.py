from datetime import datetime

from pydantic import BaseModel


class SubmissionCheckRead(BaseModel):
    id: int
    submission_id: int
    submission_asset_id: int | None = None
    status: str
    file_type: str
    message: str
    result_json: dict | None = None
    created_at: datetime

    model_config = {"from_attributes": True}