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
    storage_key: str | None = None
    group_key: str | None = None
    created_at: datetime
    updated_at: datetime
    download_url: str | None = None

    model_config = {"from_attributes": True}
