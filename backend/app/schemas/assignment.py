from datetime import datetime

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
    # Заполняется только в представлении корзины; для активных заданий — None.
    deleted_at: datetime | None = None
    # Статус последней сдачи студента по заданию (pending/returned/accepted) или
    # None, если студент ещё не сдавал. Для преподавателя/админа всегда None.
    my_submission_status: str | None = None

    model_config = {"from_attributes": True}