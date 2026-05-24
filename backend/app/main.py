import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app.api.routes.health import router as health_router
from app.api.routes.auth import router as auth_router
from app.api.routes.courses import router as courses_router
from app.api.routes.assignments import router as assignments_router
from app.api.routes.submissions import router as submissions_router
from app.api.routes.downloads import router as downloads_router
from app.api.routes.assignment_requirements import router as assignment_requirements_router
from app.api.routes.map_drafts import router as map_drafts_router
from app.api.routes.map_assistant import router as map_assistant_router
from app.db.session import Base, engine

from app.models.assignment import Assignment  # noqa: F401
from app.models.assignment_material import AssignmentMaterial  # noqa: F401
from app.models.assignment_requirements import AssignmentRequirements  # noqa: F401
from app.models.course import Course, CourseMember  # noqa: F401
from app.models.map_draft import MapDraft  # noqa: F401
from app.models.submission import Submission  # noqa: F401
from app.models.submission_check import SubmissionCheck  # noqa: F401
from app.models.submission_asset import SubmissionAsset
from app.models.user import User  # noqa: F401
from app.api.routes.asset_downloads import router as asset_downloads_router
from app.api.routes.ai_review import router as ai_review_router

logger = logging.getLogger(__name__)

from app.core.config import settings as _settings

# Жёсткая проверка секрета. Не даём подняться backend с дефолтным секретом,
# потому что с ним любой может подделать JWT и войти как admin.
# В dev-режиме можно явно разрешить через AUTH_SECRET_KEY=dev-default.
_DEFAULT_SECRET = "change-me-in-production"
if _settings.auth_secret_key == _DEFAULT_SECRET:
    logger.error(
        "BLOCKING: AUTH_SECRET_KEY оставлен дефолтным '%s'. "
        "Любой может подделать JWT-токен и зайти от имени любого пользователя. "
        "Сгенерируйте секрет: `openssl rand -hex 32` и поставьте в .env.",
        _DEFAULT_SECRET,
    )
    raise RuntimeError(
        "AUTH_SECRET_KEY не настроен. Подделка JWT-токенов возможна. "
        "См. .env.example."
    )

if len(_settings.auth_secret_key) < 32:
    logger.warning(
        "AUTH_SECRET_KEY короче 32 символов (%d). Это работает, но недостаточно "
        "стойко для production. Рекомендую `openssl rand -hex 32`.",
        len(_settings.auth_secret_key),
    )

app = FastAPI(title="GIS Education Platform API")


@app.exception_handler(OperationalError)
async def db_unavailable_handler(_request: Request, exc: OperationalError):
    """Когда БД временно недоступна (упала, перезагружается, нет коннекта) —
    отдаём понятный 503, а не 500 с пятиэтажным трейсом."""
    logger.exception("Database is unavailable", exc_info=exc)
    return JSONResponse(
        status_code=503,
        content={
            "detail": (
                "База данных временно недоступна. "
                "Это обычно проходит за минуту — попробуйте ещё раз."
            ),
        },
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_origin_regex=r"https://.*\.trycloudflare\.com",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)

with engine.begin() as connection:
    connection.execute(
        text(
            "ALTER TABLE assignment_requirements "
            "ADD COLUMN IF NOT EXISTS submission_format VARCHAR(100)"
        )
    )
    connection.execute(
        text(
            "UPDATE assignment_requirements "
            "SET submission_format = 'archive' "
            "WHERE submission_format IS NULL"
        )
    )
    connection.execute(
        text(
            "ALTER TABLE submissions "
            "ADD COLUMN IF NOT EXISTS student_id INTEGER"
        )
    )
    connection.execute(
        text(
            "ALTER TABLE assignments "
            "ADD COLUMN IF NOT EXISTS course_id INTEGER"
        )
    )
    connection.execute(
        text(
            "ALTER TABLE users "
            "ADD COLUMN IF NOT EXISTS email_verified BOOLEAN"
        )
    )
    connection.execute(
        text(
            "UPDATE users "
            "SET email_verified = TRUE "
            "WHERE email_verified IS NULL"
        )
    )
    connection.execute(
        text(
            "ALTER TABLE users "
            "ALTER COLUMN email_verified SET DEFAULT FALSE"
        )
    )
    connection.execute(
        text(
            "ALTER TABLE users "
            "ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP WITH TIME ZONE"
        )
    )
    connection.execute(
        text(
            "ALTER TABLE users "
            "ADD COLUMN IF NOT EXISTS email_verification_code_hash VARCHAR(512)"
        )
    )
    connection.execute(
        text(
            "ALTER TABLE users "
            "ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMP WITH TIME ZONE"
        )
    )
    connection.execute(
        text(
            "ALTER TABLE users "
            "ADD COLUMN IF NOT EXISTS email_verification_sent_at TIMESTAMP WITH TIME ZONE"
        )
    )

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(courses_router)
app.include_router(assignments_router)
app.include_router(submissions_router)
app.include_router(downloads_router)
app.include_router(assignment_requirements_router)
app.include_router(map_drafts_router)
app.include_router(map_assistant_router)
app.include_router(asset_downloads_router)
app.include_router(ai_review_router)