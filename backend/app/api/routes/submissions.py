from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session
import logging

from app.db.session import get_db
from app.models.assignment import Assignment
from app.models.assignment_requirements import AssignmentRequirements
from app.models.submission import Submission
from app.models.submission_check import SubmissionCheck
from app.models.submission_asset import SubmissionAsset
from app.schemas.submission import SubmissionRead
from app.schemas.submission_asset import SubmissionAssetRead
from app.schemas.submission_check import SubmissionCheckRead
from app.services.storage import (
    upload_submission_file,
    upload_bytes,
    build_asset_storage_key,
)
from app.services.submission_archive_parser import parse_submission_archive
from app.services.submission_validator import validate_submission_file
from app.services.asset_validator import validate_asset_from_storage
from app.services.target_asset_selector import choose_target_gis_asset
from app.services.asset_requirement_evaluator import evaluate_asset_against_requirements

router = APIRouter(prefix="/submissions", tags=["submissions"])
logger = logging.getLogger(__name__)

def _asset_type_from_detected_format(detected_format: str) -> str:
    """
    Нормализуем тип asset по detected_format.
    """
    if detected_format in {"geojson", "shapefile_zip"}:
        return "layer"
    if detected_format in {"txt", "doc", "docx"}:
        return "report"
    return "other"


def to_submission_read(submission: Submission) -> SubmissionRead:
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
    try:
        """
        Pipeline:
        1. Проверяем, что assignment существует
        2. Сохраняем исходный файл submission в MinIO
        3. Создаём Submission
        4. Если zip -> разбираем архив на assets и сохраняем их отдельно
        5. Если не zip -> создаём один asset
        6. Делаем technical checks по asset-ам
        7. Выбираем target GIS asset
        8. Делаем requirements-check
        9. Обновляем итоговый статус submission
        """
        assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
        if not assignment:
            raise HTTPException(status_code=404, detail="Assignment not found")

        # Читаем файл целиком для проверки / парсинга
        file_bytes = file.file.read()
        file.file.seek(0)

        # Сохраняем исходный файл submission в MinIO
        storage_key = upload_submission_file(
            file_obj=file.file,
            filename=file.filename,
            content_type=file.content_type,
        )

        # Создаём запись Submission
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

        created_assets: list[SubmissionAsset] = []

        # -------------------------------------------------
        # 1. ZIP SUBMISSION -> parse into multiple assets
        # -------------------------------------------------
        if file.filename.lower().endswith(".zip"):
            parsed_assets = parse_submission_archive(file_bytes)

            for asset in parsed_assets:
                asset_storage_key = None
                asset_bytes = asset.get("file_bytes")

                # Если parser реально вернул bytes asset-а,
                # сохраняем этот asset отдельно в MinIO
                if asset_bytes is not None:
                    asset_storage_key = build_asset_storage_key(
                        submission_id=submission.id,
                        asset_name=asset["asset_name"],
                    )
                    upload_bytes(
                        object_key=asset_storage_key,
                        data=asset_bytes,
                        content_type="application/octet-stream",
                    )

                db_asset = SubmissionAsset(
                    submission_id=submission.id,
                    asset_name=asset["asset_name"],
                    asset_type=asset["asset_type"],
                    detected_format=asset["detected_format"],
                    status=asset["status"],
                    message=asset["message"],
                    storage_key=asset_storage_key,
                    group_key=asset.get("group_key"),
                )
                db.add(db_asset)
                created_assets.append(db_asset)

            db.commit()

            for db_asset in created_assets:
                db.refresh(db_asset)

        # -------------------------------------------------
        # 2. SINGLE FILE SUBMISSION -> create one asset
        # -------------------------------------------------
        else:
            validation = validate_submission_file(
                filename=file.filename,
                file_bytes=file_bytes,
            )

            db_asset = SubmissionAsset(
                submission_id=submission.id,
                asset_name=file.filename,
                asset_type=_asset_type_from_detected_format(validation["detected_format"]),
                detected_format=validation["detected_format"],
                status=validation["status"],
                message=validation["message"],
                storage_key=submission.storage_key,
                group_key=None,
            )
            db.add(db_asset)
            db.commit()
            db.refresh(db_asset)

            created_assets.append(db_asset)

        # -------------------------------------------------
        # 3. TECHNICAL CHECKS PER ASSET
        # -------------------------------------------------
        asset_validation_map: dict[int, dict] = {}

        for asset in created_assets:
            # Валидируем asset уже из MinIO по storage_key,
            # а не по промежуточным данным parser-а
            validation = validate_asset_from_storage(asset)

            asset_validation_map[asset.id] = validation

            technical_check = SubmissionCheck(
                submission_id=submission.id,
                submission_asset_id=asset.id,
                status=validation["status"],
                file_type=validation["file_type"],
                message=validation["message"],
                result_json={
                    "mode": "technical_asset_validation",
                    "detected_format": validation.get("detected_format"),
                    "details": validation.get("details", {}),
                },
            )
            db.add(technical_check)

            # Обновляем summary-поля asset-а
            asset.status = validation["status"]
            asset.message = validation["message"]
            asset.detected_format = validation["detected_format"]

        db.commit()

        # -------------------------------------------------
        # 4. REQUIREMENTS EVALUATION AGAINST TARGET GIS ASSET
        # -------------------------------------------------
        requirements = (
            db.query(AssignmentRequirements)
            .filter(AssignmentRequirements.assignment_id == assignment_id)
            .first()
        )

        target_asset = choose_target_gis_asset(created_assets, requirements)

        if target_asset is None:
            requirement_evaluation = {
                "status": "warning",
                "message": (
                    "Не удалось однозначно выбрать целевой GIS-asset для проверки по требованиям. "
                    "Выполнена только техническая проверка assets."
                ),
                "result_json": {
                    "mode": "target_asset_not_selected",
                    "problems": [],
                    "warnings": [
                        "Не удалось однозначно выбрать целевой GIS-asset."
                    ],
                    "passed_rules": [],
                },
            }
        else:
            validation_result = asset_validation_map.get(target_asset.id, {})
            requirement_evaluation = evaluate_asset_against_requirements(
                requirements=requirements,
                validation_result=validation_result,
            )

        requirements_check = SubmissionCheck(
            submission_id=submission.id,
            submission_asset_id=target_asset.id if target_asset else None,
            status=requirement_evaluation["status"],
            file_type="requirements",
            message=requirement_evaluation["message"],
            result_json=requirement_evaluation.get("result_json"),
        )
        db.add(requirements_check)
        db.commit()

        # -------------------------------------------------
        # 5. FINAL SUBMISSION STATUS
        # -------------------------------------------------
        all_checks = (
            db.query(SubmissionCheck)
            .filter(SubmissionCheck.submission_id == submission.id)
            .all()
        )

        statuses = {check.status.lower() for check in all_checks}

        if "failed" in statuses:
            submission.status = "failed"
        elif "warning" in statuses:
            submission.status = "warning"
        else:
            submission.status = "passed"

        db.commit()
        db.refresh(submission)

        return to_submission_read(submission)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("create_submission failed")
        raise HTTPException(
            status_code=500,
            detail=f"Submission processing failed: {str(e)}",
        )
    
@router.get("/{submission_id}/checks", response_model=list[SubmissionCheckRead])
def list_submission_checks(
    submission_id: int,
    db: Session = Depends(get_db),
):
    """
    Возвращает все checks для конкретной submission.
    """
    checks = (
        db.query(SubmissionCheck)
        .filter(SubmissionCheck.submission_id == submission_id)
        .order_by(SubmissionCheck.id.desc())
        .all()
    )
    return checks