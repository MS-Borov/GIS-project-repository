from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.routes.health import router as health_router
from app.api.routes.auth import router as auth_router
from app.api.routes.courses import router as courses_router
from app.api.routes.assignments import router as assignments_router
from app.api.routes.submissions import router as submissions_router
from app.api.routes.downloads import router as downloads_router
from app.api.routes.assignment_requirements import router as assignment_requirements_router
from app.db.session import Base, engine

from app.models.assignment import Assignment  # noqa: F401
from app.models.assignment_requirements import AssignmentRequirements  # noqa: F401
from app.models.course import Course, CourseMember  # noqa: F401
from app.models.submission import Submission  # noqa: F401
from app.models.submission_check import SubmissionCheck  # noqa: F401
from app.models.submission_asset import SubmissionAsset
from app.models.user import User  # noqa: F401
from app.api.routes.asset_downloads import router as asset_downloads_router
from app.api.routes.ai_review import router as ai_review_router

app = FastAPI(title="GIS Education Platform API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
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

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(courses_router)
app.include_router(assignments_router)
app.include_router(submissions_router)
app.include_router(downloads_router)
app.include_router(assignment_requirements_router)
app.include_router(asset_downloads_router)
app.include_router(ai_review_router)
