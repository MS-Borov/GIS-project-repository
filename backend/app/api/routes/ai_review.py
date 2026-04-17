from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models.assignment_requirements import AssignmentRequirements
from app.models.submission import Submission
from app.models.submission_asset import SubmissionAsset
from app.models.submission_check import SubmissionCheck
from app.services.ai_review_service import generate_ai_review
from app.services.report_text_extractor import extract_report_text
from app.services.storage import get_s3_client
from app.services.target_asset_selector import choose_target_gis_asset

router = APIRouter(prefix="/submissions", tags=["ai-review"])


def _load_asset_bytes(storage_key: str) -> bytes:
    s3 = get_s3_client()
    obj = s3.get_object(
        Bucket=settings.s3_bucket_name,
        Key=storage_key,
    )
    return obj["Body"].read()


@router.post("/{submission_id}/ai-review")
def create_ai_review(
    submission_id: int,
    db: Session = Depends(get_db),
):
    """
    AI-review:
    - ищем отчёт
    - выбираем target GIS asset
    - находим technical GIS-check и requirements-check
    - если критичных данных нет, LLM не запускаем
    """
    submission = db.query(Submission).filter(Submission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

    assignment = submission.assignment

    requirements = (
        db.query(AssignmentRequirements)
        .filter(AssignmentRequirements.assignment_id == submission.assignment_id)
        .first()
    )

    assets = (
        db.query(SubmissionAsset)
        .filter(SubmissionAsset.submission_id == submission_id)
        .order_by(SubmissionAsset.id.asc())
        .all()
    )

    report_asset = next(
        (a for a in assets if a.asset_type == "report" and a.storage_key),
        None,
    )

    gis_asset = choose_target_gis_asset(assets, requirements)

    report_context = None
    if report_asset and report_asset.storage_key:
        report_bytes = _load_asset_bytes(report_asset.storage_key)
        report_context = extract_report_text(
            filename=report_asset.asset_name,
            file_bytes=report_bytes,
        )

    gis_technical_check = None
    requirements_check = None

    if gis_asset:
        asset_checks = (
            db.query(SubmissionCheck)
            .filter(
                SubmissionCheck.submission_id == submission_id,
                SubmissionCheck.submission_asset_id == gis_asset.id,
            )
            .order_by(SubmissionCheck.id.desc())
            .all()
        )

        # Берём именно technical check, а не любой последний.
        gis_technical_check = next(
            (check for check in asset_checks if check.file_type != "requirements"),
            None,
        )

        # Берём requirements-check отдельно.
        requirements_check = next(
            (check for check in asset_checks if check.file_type == "requirements"),
            None,
        )

    requirements_dict = None
    if requirements:
        requirements_dict = {
            "deliverable_format": requirements.deliverable_format,
            "expected_geometry_types": requirements.expected_geometry_types,
            "expected_crs": requirements.expected_crs,
            "required_attributes": requirements.required_attributes,
            "topology_rules": requirements.topology_rules,
            "needs_reference_layer": requirements.needs_reference_layer,
            "report_required": requirements.report_required,
            "auto_checkable": requirements.auto_checkable,
        }

    result = generate_ai_review(
        assignment_title=assignment.title if assignment else f"Assignment #{submission.assignment_id}",
        requirements_dict=requirements_dict,
        report_context=report_context,
        gis_technical_result=gis_technical_check.result_json if gis_technical_check else None,
        requirements_result=requirements_check.result_json if requirements_check else None,
    )

    warnings = []

    if report_asset is None:
        warnings.append("В submission не найден report asset.")
    elif report_context and not report_context.get("can_analyze"):
        warnings.append(report_context.get("message", "Отчёт найден, но текст извлечь не удалось."))

    if gis_asset is None:
        warnings.append("Не удалось выбрать целевой GIS asset для AI review.")
    if gis_technical_check is None and gis_asset is not None:
        warnings.append("Для целевого GIS asset не найден technical check.")
    if requirements_check is None and gis_asset is not None:
        warnings.append("Для целевого GIS asset не найден requirements check.")

    if settings.llm_backend == "openai" and settings.openai_api_key is None:
        warnings.append("OPENAI_API_KEY не задан, облачный LLM недоступен.")

    return {
        "submission_id": submission.id,
        "report_asset_id": report_asset.id if report_asset else None,
        "gis_asset_id": gis_asset.id if gis_asset else None,
        "technical_check_id": gis_technical_check.id if gis_technical_check else None,
        "requirements_check_id": requirements_check.id if requirements_check else None,
        "warnings": warnings,
        "ai_review": result,
    }