from datetime import datetime
from pydantic import BaseModel

class SubmissionAssetRead(BaseModel):
    id: int
    submission_id: int
    asset_name: str
    asset_type: str
    detected_format: str
    status: str
    message: str
    created_at: datetime

    model_config = {"from_attributes": True}
