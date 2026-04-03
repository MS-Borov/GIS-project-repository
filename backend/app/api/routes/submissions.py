from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.assignment import Assignment
from app.models.submission import Submission
from app.models.submission_check import SubmissionCheck
from app.schemas.submission import SubmissionRead
from app.schemas.submission_check import SubmissionCheckRead
from app.services.storage import upload_submission_file
from app.services.submission_validator import validate_submission_file

router = APIRouter(prefix="/submissions", tags=["submissions"])


@router.post("/", response_model=SubmissionRead, status_code=status.HTTP_201_CREATED)
def create_submission(
    assignment_id: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    file_bytes = file.file.read()
    file.file.seek(0)

    storage_key = upload_submission_file(
        file_obj=file.file,
        filename=file.filename,
        content_type=file.content_type,
    )

    submission = Submission(
        assignment_id=assignment_id,
        original_filename=file.filename,
        storage_key=storage_key,
        content_type=file.content_type,
        size_bytes=len(file_bytes),
        status="uploaded",
    )

    db.add(submission)
    db.commit()
    db.refresh(submission)

    check_status, file_type, check_message = validate_submission_file(
        filename=file.filename,
        file_bytes=file_bytes,
    )

    check = SubmissionCheck(
        submission_id=submission.id,
        status=check_status,
        file_type=file_type,
        message=check_message,
    )

    db.add(check)
    db.commit()

    return submission


@router.get("/by-assignment/{assignment_id}", response_model=list[SubmissionRead])
def list_submissions_by_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
):
    submissions = (
        db.query(Submission)
        .filter(Submission.assignment_id == assignment_id)
        .order_by(Submission.id.desc())
        .all()
    )
    return submissions


@router.get("/{submission_id}/checks", response_model=list[SubmissionCheckRead])
def list_submission_checks(
    submission_id: int,
    db: Session = Depends(get_db),
):
    checks = (
        db.query(SubmissionCheck)
        .filter(SubmissionCheck.submission_id == submission_id)
        .order_by(SubmissionCheck.id.desc())
        .all()
    )
    return checks