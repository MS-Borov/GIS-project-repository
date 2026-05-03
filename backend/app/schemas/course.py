from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.user import UserRead


CourseMemberRole = Literal["teacher", "student"]


class CourseCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = None


class CourseUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    archived: bool | None = None


class CourseRead(BaseModel):
    id: int
    title: str
    description: str | None = None
    teacher_id: int | None = None
    archived: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CourseMemberCreate(BaseModel):
    user_id: int | None = None
    email: str | None = Field(default=None, min_length=3, max_length=255)
    role: CourseMemberRole = "student"


class CourseMemberRead(BaseModel):
    id: int
    course_id: int
    user_id: int
    role: CourseMemberRole
    created_at: datetime
    user: UserRead

    model_config = {"from_attributes": True}
