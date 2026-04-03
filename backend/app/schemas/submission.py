from datetime import datetime

from pydantic import BaseModel


class SubmissionRead(BaseModel):
    id: int
    assignment_id: int
    original_filename: str
    storage_key: str
    content_type: str | None = None
    size_bytes: int
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}