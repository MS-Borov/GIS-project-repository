from fastapi import FastAPI

from app.api.routes.health import router as health_router
from app.api.routes.assignments import router as assignments_router
from app.api.routes.submissions import router as submissions_router
from app.api.routes.downloads import router as downloads_router
from app.api.routes.assignment_requirements import router as assignment_requirements_router
from app.db.session import Base, engine

from app.models.assignment import Assignment  # noqa: F401
from app.models.assignment_requirements import AssignmentRequirements  # noqa: F401
from app.models.submission import Submission  # noqa: F401
from app.models.submission_check import SubmissionCheck  # noqa: F401
from app.models.submission_asset import SubmissionAsset

app = FastAPI(title="GIS Education Platform API")

Base.metadata.create_all(bind=engine)

app.include_router(health_router)
app.include_router(assignments_router)
app.include_router(submissions_router)
app.include_router(downloads_router)
app.include_router(assignment_requirements_router)