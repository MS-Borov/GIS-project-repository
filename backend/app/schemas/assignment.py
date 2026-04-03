from pydantic import BaseModel, Field


class AssignmentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = None


class AssignmentRead(BaseModel):
    id: int
    title: str
    description: str | None = None

    model_config = {"from_attributes": True}