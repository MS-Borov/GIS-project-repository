from pydantic import BaseModel


class AssignmentBase(BaseModel):
    title: str
    description: str | None = None


class AssignmentCreate(AssignmentBase):
    pass


class AssignmentRead(AssignmentBase):
    id: int

    model_config = {"from_attributes": True}