from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field


UserRole = Literal["admin", "teacher", "student"]


class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=255)
    full_name: str | None = Field(default=None, max_length=255)
    role: UserRole = "student"


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=255)
    full_name: str | None = Field(default=None, max_length=255)
    role: UserRole
    is_active: bool = True


class UserLogin(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)
    password: str


class EmailVerificationCheck(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)
    code: str = Field(..., min_length=4, max_length=20)


class EmailVerificationResend(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = Field(default=None, max_length=255)


class UserRead(BaseModel):
    id: int
    email: str
    full_name: str | None = None
    role: UserRole
    is_active: bool
    email_verified: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TokenRead(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead


class RegisterRead(BaseModel):
    access_token: str | None = None
    token_type: str = "bearer"
    user: UserRead | None = None
    verification_required: bool = False
    email: str | None = None
    message: str | None = None
    dev_code: str | None = None


class EmailVerificationResendRead(BaseModel):
    verification_required: bool = True
    email: str
    message: str
    dev_code: str | None = None