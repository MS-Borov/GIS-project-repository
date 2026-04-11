from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.assignment import Assignment
from app.models.assignment_requirements import AssignmentRequirements
from app.models.submission import Submission
from app.models.submission_check import SubmissionCheck
from app.schemas.submission import SubmissionRead
from app.schemas.submission_check import SubmissionCheckRead
from app.services.storage import upload_submission_file
from app.services.submission_validator import validate_submission_file
from app.services.submission_requirement_evaluator import (
    evaluate_submission_against_requirements,
)
from app.models.submission_asset import SubmissionAsset
from app.schemas.submission_asset import SubmissionAssetRead
from app.services.submission_archive_parser import parse_submission_archive


router = APIRouter(prefix="/submissions", tags=["submissions"])


def to_submission_read(submission: Submission) -> SubmissionRead:
    """
    Преобразование модели SQLAlchemy в ответ API.
    """
    return SubmissionRead(
        id=submission.id,
        assignment_id=submission.assignment_id,
        original_filename=submission.original_filename,
        storage_key=submission.storage_key,
        content_type=submission.content_type,
        size_bytes=submission.size_bytes,
        status=submission.status,
        created_at=submission.created_at,
        download_url=f"/downloads/submissions/{submission.id}",
    )


@router.post("/", response_model=SubmissionRead, status_code=status.HTTP_201_CREATED)
def create_submission(
    assignment_id: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    Создание submission:
    1. проверяем, что задание существует
    2. сохраняем файл в MinIO
    3. создаём запись Submission в БД
    4. выполняем техническую/GIS-проверку
    5. если есть AssignmentRequirements — сравниваем submission с требованиями
    """
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # Читаем байты файла полностью для проверки.
    # Потом перематываем поток обратно, чтобы отправить его в MinIO.
    file_bytes = file.file.read()
    file.file.seek(0)

    # Сохраняем файл в MinIO
    storage_key = upload_submission_file(
        file_obj=file.file,
        filename=file.filename,
        content_type=file.content_type,
    )

    # Создаём submission
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

    # ---------------------------------------------------------
    # Если студент загрузил архив, пытаемся разобрать его как
    # контейнер submission и найти внутри отдельные assets.
    # ---------------------------------------------------------
    if file.filename.lower().endswith(".zip"):
        parsed_assets = parse_submission_archive(file_bytes)

        for asset in parsed_assets:
            db_asset = SubmissionAsset(
                submission_id=submission.id,
                asset_name=asset["asset_name"],
                asset_type=asset["asset_type"],
                detected_format=asset["detected_format"],
                status=asset["status"],
                message=asset["message"],
            )
            db.add(db_asset)

        db.commit()

    # --- Шаг 1. Базовая техническая/GIS-проверка файла ---
    technical_validation = validate_submission_file(
        filename=file.filename,
        file_bytes=file_bytes,
    )

    technical_check = SubmissionCheck(
        submission_id=submission.id,
        status=technical_validation["status"],
        file_type=technical_validation["file_type"],
        message=technical_validation["message"],
    )
    db.add(technical_check)

    # --- Шаг 2. Проверка на соответствие требованиям задания ---
    requirements = (
        db.query(AssignmentRequirements)
        .filter(AssignmentRequirements.assignment_id == assignment_id)
        .first()
    )

    requirement_evaluation = evaluate_submission_against_requirements(
        requirements=requirements,
        validation_result=technical_validation,
    )

    requirements_check = SubmissionCheck(
        submission_id=submission.id,
        status=requirement_evaluation["status"],
        file_type="requirements",
        message=requirement_evaluation["message"],
    )
    db.add(requirements_check)

    # Можно обновить итоговый статус самой submission:
    # если хотя бы одна проверка failed, то submission помечаем как failed
    if technical_validation["status"] == "failed" or requirement_evaluation["status"] == "failed":
        submission.status = "failed"
    elif technical_validation["status"] == "warning" or requirement_evaluation["status"] == "warning":
        submission.status = "warning"
    else:
        submission.status = "passed"

    db.commit()
    db.refresh(submission)

    return to_submission_read(submission)


@router.get("/by-assignment/{assignment_id}", response_model=list[SubmissionRead])
def list_submissions_by_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
):
    """
    Получение всех submission для одного задания.
    """
    submissions = (
        db.query(Submission)
        .filter(Submission.assignment_id == assignment_id)
        .order_by(Submission.id.desc())
        .all()
    )
    return [to_submission_read(submission) for submission in submissions]


@router.get("/{submission_id}/checks", response_model=list[SubmissionCheckRead])
def list_submission_checks(
    submission_id: int,
    db: Session = Depends(get_db),
):
    """
    Получение всех check-ов для конкретной submission.
    Здесь теперь ты увидишь минимум две записи:
    - technical/GIS-check
    - requirements-check
    """
    checks = (
        db.query(SubmissionCheck)
        .filter(SubmissionCheck.submission_id == submission_id)
        .order_by(SubmissionCheck.id.desc())
        .all()
    )
    return checks

@router.get("/{submission_id}/assets", response_model=list[SubmissionAssetRead])
def list_submission_assets(
    submission_id: int,
    db: Session = Depends(get_db),
):
    """
    Возвращает логические объекты, найденные внутри submission.
    Особенно полезно для архивов:
    - отчёты
    - shapefile-слои
    - geojson-слои
    """
    assets = (
        db.query(SubmissionAsset)
        .filter(SubmissionAsset.submission_id == submission_id)
        .order_by(SubmissionAsset.id.desc())
        .all()
    )
    return assets