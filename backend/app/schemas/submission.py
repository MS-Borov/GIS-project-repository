from datetime import datetime

from pydantic import BaseModel


class SubmissionRead(BaseModel):
    id: int
    assignment_id: int
    student_id: int | None = None
    original_filename: str
    storage_key: str
    content_type: str | None = None
    size_bytes: int
    status: str
    created_at: datetime
    download_url: str

    model_config = {"from_attributes": True}
