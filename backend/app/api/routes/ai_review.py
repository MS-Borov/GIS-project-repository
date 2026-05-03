from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps.auth import ensure_submission_access, get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.assignment_requirements import AssignmentRequirements
from app.models.submission import Submission
from app.models.submission_asset import SubmissionAsset
from app.models.submission_check import SubmissionCheck
from app.models.user import User
from app.services.ai_review_service import generate_ai_review
from app.services.document_text_extractor import extract_document_text
from app.services.rate_limit import build_rate_limit_key, enforce_rate_limit, get_client_ip
from app.services.report_analysis_service import analyze_report_text
from app.services.storage import get_s3_client

router = APIRouter(prefix="/submissions", tags=["ai-review"])


REPORT_NAME_HINTS = ("отчет", "отчёт", "report")
ASSIGNMENT_NAME_HINTS = ("zadanie", "задание", "assignment", "task")
REPORT_FORMAT_SCORE = {
    "docx": 30,
    "txt": 25,
    "doc": 5,
}


def _load_asset_bytes(storage_key: str) -> bytes:
    s3 = get_s3_client()
    obj = s3.get_object(
        Bucket=settings.s3_bucket_name,
        Key=storage_key,
    )
    return obj["Body"].read()


def _normalized_name(value: str | None) -> str:
    return (value or "").strip().lower().replace("ё", "е")


def _report_asset_score(asset: SubmissionAsset) -> int:
    name = _normalized_name(asset.asset_name)
    detected_format = (asset.detected_format or "").strip().lower()

    score = REPORT_FORMAT_SCORE.get(detected_format, 0)

    if any(hint.replace("ё", "е") in name for hint in REPORT_NAME_HINTS):
        score += 100

    if any(hint in name for hint in ASSIGNMENT_NAME_HINTS):
        score -= 60

    return score


def _select_report_asset(assets: list[SubmissionAsset]) -> SubmissionAsset | None:
    report_assets = [
        asset for asset in assets
        if asset.asset_type == "report" and asset.storage_key
    ]
    if not report_assets:
        return None

    return max(
        report_assets,
        key=lambda asset: (_report_asset_score(asset), asset.id),
    )


@router.post("/{submission_id}/ai-review")
def create_ai_review(
    request: Request,
    submission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    AI review в multi-layer режиме.

    Источники для review:
    - report asset -> extract text -> report analysis
    - requirements_summary -> общий итог формальной многослойной проверки
    - requirements_output -> частные проверки по ожидаемым слоям

    Здесь больше нет центральной зависимости от одного target GIS asset.
    """
    submission = db.query(Submission).filter(Submission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    ensure_submission_access(submission, current_user)
    enforce_rate_limit(
        build_rate_limit_key("ai-review", get_client_ip(request), str(current_user.id)),
        max_requests=10,
        window_seconds=600,
    )

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

    report_asset = _select_report_asset(assets)

    report_document = None
    report_analysis = None

    if report_asset and report_asset.storage_key:
        report_bytes = _load_asset_bytes(report_asset.storage_key)
        report_document = extract_document_text(
            filename=report_asset.asset_name,
            file_bytes=report_bytes,
        )
        report_analysis = analyze_report_text(report_document)

    requirements_summary_check = (
        db.query(SubmissionCheck)
        .filter(
            SubmissionCheck.submission_id == submission_id,
            SubmissionCheck.file_type == "requirements_summary",
        )
        .order_by(SubmissionCheck.id.desc())
        .first()
    )

    legacy_requirements_check = None
    if requirements_summary_check is None:
        legacy_requirements_check = (
            db.query(SubmissionCheck)
            .filter(
                SubmissionCheck.submission_id == submission_id,
                SubmissionCheck.file_type == "requirements",
            )
            .order_by(SubmissionCheck.id.desc())
            .first()
        )

    formal_requirements_check = requirements_summary_check or legacy_requirements_check
    transient_requirements_summary = None
    if formal_requirements_check is None and report_asset is not None:
        has_layer_assets = any(asset.asset_type == "layer" for asset in assets)
        if not has_layer_assets:
            transient_requirements_summary = {
                "mode": "report_only_submission",
                "problems": [],
                "warnings": [],
                "passed_rules": [
                    "Report asset uploaded and recognized."
                ],
            }

    formal_requirements_check_kind = (
        "requirements_summary"
        if requirements_summary_check
        else "requirements"
        if legacy_requirements_check
        else "transient_report_only_summary"
        if transient_requirements_summary
        else None
    )

    requirements_output_checks = (
        db.query(SubmissionCheck)
        .filter(
            SubmissionCheck.submission_id == submission_id,
            SubmissionCheck.file_type == "requirements_output",
        )
        .order_by(SubmissionCheck.id.asc())
        .all()
    )

    technical_checks = (
        db.query(SubmissionCheck)
        .filter(
            SubmissionCheck.submission_id == submission_id,
            SubmissionCheck.file_type.notin_(["requirements", "requirements_output", "requirements_summary"]),
        )
        .order_by(SubmissionCheck.id.asc())
        .all()
    )

    requirements_dict = None
    if requirements:
        requirements_dict = {
            "submission_format": requirements.submission_format,
            "deliverable_format": requirements.deliverable_format,
            "expected_geometry_types": requirements.expected_geometry_types,
            "expected_crs": requirements.expected_crs,
            "required_attributes": requirements.required_attributes,
            "topology_rules": requirements.topology_rules,
            "expected_outputs_json": requirements.expected_outputs_json,
            "needs_reference_layer": requirements.needs_reference_layer,
            "report_required": requirements.report_required,
            "auto_checkable": requirements.auto_checkable,
        }

    result = generate_ai_review(
        assignment_title=assignment.title if assignment else f"Assignment #{submission.assignment_id}",
        requirements_dict=requirements_dict,
        report_context={
            "asset_name": report_asset.asset_name if report_asset else None,
            "asset_id": report_asset.id if report_asset else None,
            "document": report_document,
            "analysis": report_analysis,
        } if report_document or report_analysis else None,
        gis_technical_result={
            "mode": "technical_checks_collection",
            "checks": [check.result_json for check in technical_checks if check.result_json],
        } if technical_checks else None,
        requirements_result={
            "summary": formal_requirements_check.result_json if formal_requirements_check else transient_requirements_summary,
            "outputs": [check.result_json for check in requirements_output_checks if check.result_json],
        },
    )

    warnings = []

    if report_asset is None:
        warnings.append("В submission не найден report asset.")
    elif report_document and not report_document.get("can_analyze"):
        warnings.append(report_document.get("message", "Отчёт найден, но текст извлечь не удалось."))

    if not formal_requirements_check and not transient_requirements_summary:
        warnings.append("Не найден requirements_summary check для submission.")

    elif legacy_requirements_check and not requirements_summary_check:
        warnings.append("Используется legacy requirements check без requirements_summary.")

    if len(requirements_output_checks) == 0:
        warnings.append("Не найдены checks типа requirements_output для отдельных ожидаемых слоёв.")

    if len(technical_checks) == 0:
        warnings.append("Не найдены technical checks для layer-assets submission.")

    if settings.llm_backend == "openai" and settings.openai_api_key is None:
        warnings.append("OPENAI_API_KEY не задан, облачный LLM недоступен.")

    return {
        "submission_id": submission.id,
        "report_asset_id": report_asset.id if report_asset else None,
        "report_asset_name": report_asset.asset_name if report_asset else None,
        "requirements_summary_check_id": requirements_summary_check.id if requirements_summary_check else None,
        "requirements_formal_check_id": formal_requirements_check.id if formal_requirements_check else None,
        "requirements_formal_check_kind": formal_requirements_check_kind,
        "requirements_output_check_ids": [check.id for check in requirements_output_checks],
        "technical_check_ids": [check.id for check in technical_checks],
        "warnings": warnings,
        "report_analysis": report_analysis,
        "ai_review": result,
    }
