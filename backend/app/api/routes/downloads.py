from urllib.parse import quote

from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps.auth import ensure_submission_access, get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.submission import Submission
from app.models.user import User
from app.services.storage import get_s3_client

router = APIRouter(prefix="/downloads", tags=["downloads"])


@router.get("/submissions/{submission_id}")
def download_submission(
    submission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    submission = db.query(Submission).filter(Submission.id == submission_id).first()
    if not submission:
        raise HTTPException(
            status_code=404,
            detail=f"Submission with id={submission_id} not found in DB",
        )
    ensure_submission_access(submission, current_user)

    s3 = get_s3_client()

    try:
        s3.head_object(
            Bucket=settings.s3_bucket_name,
            Key=submission.storage_key,
        )
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "unknown")
        raise HTTPException(
            status_code=404,
            detail=(
                f"Object not found in storage. "
                f"bucket={settings.s3_bucket_name}, key={submission.storage_key}, code={error_code}"
            ),
        )

    try:
        obj = s3.get_object(
            Bucket=settings.s3_bucket_name,
            Key=submission.storage_key,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to read object from storage: {str(e)}",
        )

    filename = submission.original_filename
    quoted_filename = quote(filename)

    return StreamingResponse(
        obj["Body"],
        media_type=submission.content_type or "application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quoted_filename}"
        },
    )
