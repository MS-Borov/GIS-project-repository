from pydantic import BaseModel, Field


class AssignmentCreate(BaseModel):
    course_id: int | None = None
    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = None


class AssignmentRead(BaseModel):
    id: int
    course_id: int | None = None
    title: str
    description: str | None = None

    model_config = {"from_attributes": True}
