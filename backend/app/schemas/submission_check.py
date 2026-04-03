from datetime import datetime

from pydantic import BaseModel


class SubmissionCheckRead(BaseModel):
    id: int
    submission_id: int
    status: str
    file_type: str
    message: str
    created_at: datetime

    model_config = {"from_attributes": True}