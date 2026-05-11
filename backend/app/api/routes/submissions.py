from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from sqlalchemy.orm import Session
import io
import logging
import json
import zipfile
from pathlib import Path
from uuid import uuid4

from app.core.config import settings
from app.api.deps.auth import ensure_submission_access, get_current_user, require_student
from app.services.document_text_extractor import extract_document_text
from app.services.rate_limit import build_rate_limit_key, enforce_rate_limit, get_client_ip
from app.services.storage import get_s3_client

from app.services.multi_layer_requirement_matcher import match_assets_to_expected_outputs
from app.services.expected_output_evaluator import evaluate_asset_against_expected_output
from app.services.multi_layer_summary_builder import build_multi_layer_summary

from app.db.session import get_db
from app.models.assignment import Assignment
from app.models.assignment_requirements import AssignmentRequirements
from app.models.course import CourseMember
from app.models.submission import Submission
from app.models.submission_check import SubmissionCheck
from app.models.submission_asset import SubmissionAsset
from app.models.user import User
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
from app.services.geojson_preview import build_geojson_preview
from app.services.target_asset_selector import choose_target_gis_asset
from app.services.asset_requirement_evaluator import evaluate_asset_against_requirements

router = APIRouter(prefix="/submissions", tags=["submissions"])
logger = logging.getLogger(__name__)

LOCAL_SHAPEFILE_EXTENSIONS = {".shp", ".dbf", ".shx", ".prj", ".cpg", ".qix", ".sbn", ".sbx"}

def _asset_type_from_detected_format(detected_format: str) -> str:
    """
    Нормализуем тип asset по detected_format.
    """
    if detected_format in {"geojson", "shapefile_zip"}:
        return "layer"
    if detected_format in {"txt", "doc", "docx"}:
        return "report"
    return "other"

def _load_asset_bytes(storage_key: str) -> bytes:
    """
    Загружает asset из MinIO по storage_key.
    """
    s3 = get_s3_client()
    obj = s3.get_object(
        Bucket=settings.s3_bucket_name,
        Key=storage_key,
    )
    return obj["Body"].read()


def _extract_report_text_for_target_selection(assets: list[SubmissionAsset]) -> str | None:
    """
    Пытаемся извлечь текст первого найденного report asset,
    чтобы использовать его при выборе target GIS asset.
    """
    report_asset = next(
        (asset for asset in assets if asset.asset_type == "report" and asset.storage_key),
        None,
    )

    if not report_asset:
        return None

    try:
        report_bytes = _load_asset_bytes(report_asset.storage_key)
        extracted = extract_document_text(
            filename=report_asset.asset_name,
            file_bytes=report_bytes,
        )
        if extracted.get("can_analyze"):
            return extracted.get("text")
    except Exception:
        # Не валим pipeline только из-за невозможности извлечь текст отчёта
        return None

    return None


def _has_report_asset(assets: list[SubmissionAsset]) -> bool:
    return any(asset.asset_type == "report" for asset in assets)


def _has_layer_asset(assets: list[SubmissionAsset]) -> bool:
    return any(asset.asset_type == "layer" for asset in assets)


def _ensure_student_can_submit_assignment(
    assignment: Assignment,
    current_user: User,
    db: Session,
) -> None:
    if assignment.course_id is None:
        return

    membership = (
        db.query(CourseMember)
        .filter(
            CourseMember.course_id == assignment.course_id,
            CourseMember.user_id == current_user.id,
        )
        .first()
    )
    if membership:
        return

    raise HTTPException(status_code=403, detail="Course membership required to submit this assignment")


def to_submission_read(submission: Submission) -> SubmissionRead:
    return SubmissionRead(
        id=submission.id,
        assignment_id=submission.assignment_id,
        student_id=submission.student_id,
        original_filename=submission.original_filename,
        storage_key=submission.storage_key,
        content_type=submission.content_type,
        size_bytes=submission.size_bytes,
        status=submission.status,
        created_at=submission.created_at,
        download_url=f"/downloads/submissions/{submission.id}",
    )


def to_submission_asset_read(asset: SubmissionAsset) -> SubmissionAssetRead:
    return SubmissionAssetRead(
        id=asset.id,
        submission_id=asset.submission_id,
        asset_name=asset.asset_name,
        asset_type=asset.asset_type,
        detected_format=asset.detected_format,
        status=asset.status,
        message=asset.message,
        storage_key=asset.storage_key,
        group_key=asset.group_key,
        created_at=asset.created_at,
        updated_at=asset.updated_at,
        download_url=f"/downloads/submission-assets/{asset.id}",
    )


@router.post("/local-layer-preview")
def preview_local_layer_files(
    request: Request,
    files: list[UploadFile] = File(...),
    max_features: int = Query(500, ge=1, le=1000),
    current_user: User = Depends(get_current_user),
):
    """
    Preview for locally selected GIS files.

    This is intentionally separate from submission upload: selected .shp/.dbf/.shx/.prj parts
    are grouped by basename, packed in memory as shapefile_zip, and converted to GeoJSON preview.
    Nothing is saved as a student submission.
    """
    enforce_rate_limit(
        build_rate_limit_key("local-layer-preview", get_client_ip(request), str(current_user.id)),
        max_requests=40,
        window_seconds=600,
    )

    if not files:
        raise HTTPException(status_code=400, detail="No files selected.")

    grouped_files: dict[str, list[tuple[str, bytes]]] = {}
    ignored_files: list[str] = []

    for upload in files:
        filename = Path(upload.filename or "").name
        suffix = Path(filename).suffix.lower()
        data = upload.file.read()

        if suffix not in LOCAL_SHAPEFILE_EXTENSIONS:
            ignored_files.append(filename)
            continue

        grouped_files.setdefault(Path(filename).stem.lower(), []).append((filename, data))

    assets: list[dict] = []
    previews: list[dict] = []
    layer_summaries: list[dict] = []
    warnings: list[str] = []
    next_asset_id = 1

    for group_key, group_files in sorted(grouped_files.items()):
        suffixes = {Path(filename).suffix.lower() for filename, _ in group_files}
        if ".shp" not in suffixes:
            warnings.append(f"Комплект '{group_key}' пропущен: нет .shp файла.")
            continue
        if ".dbf" not in suffixes or ".shx" not in suffixes:
            warnings.append(f"Комплект '{group_key}' может не открыться: обычно нужны .shp, .dbf и .shx.")

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as layer_zip:
            for filename, data in sorted(group_files, key=lambda item: item[0].lower()):
                layer_zip.writestr(filename, data)

        asset_id = next_asset_id
        next_asset_id += 1
        asset_name = f"{group_key}.zip"
        file_bytes = buffer.getvalue()
        validation = validate_submission_file(asset_name, file_bytes)
        details = validation.get("details", {})

        asset = {
            "id": asset_id,
            "submission_id": 0,
            "asset_name": asset_name,
            "asset_type": "layer",
            "detected_format": "shapefile_zip",
            "status": validation.get("status", "uploaded"),
            "message": validation.get("message") or f"Shapefile '{group_key}' собран из выбранных файлов.",
            "download_url": None,
            "storage_key": None,
        }
        assets.append(asset)
        layer_summaries.append({
            "asset_id": asset_id,
            "asset_name": asset_name,
            "detected_format": "shapefile_zip",
            "status": validation.get("status"),
            "message": validation.get("message"),
            "feature_count": details.get("feature_count"),
            "geometry_types": details.get("geometry_types", []),
            "crs": details.get("crs"),
            "attribute_fields": details.get("attribute_fields", []),
            "invalid_geometry_count": details.get("invalid_geometry_count", 0),
            "has_prj": details.get("has_prj"),
        })

        try:
            previews.append(build_geojson_preview(
                asset_id=asset_id,
                asset_name=asset_name,
                detected_format="shapefile_zip",
                file_bytes=file_bytes,
                max_features=max_features,
            ))
        except Exception as exc:
            warnings.append(f"Не удалось построить preview слоя '{group_key}': {exc}")

    if not assets:
        raise HTTPException(
            status_code=400,
            detail="Не найден shapefile-комплект. Выберите .shp вместе с .dbf/.shx/.prj или загрузите ZIP/GeoJSON.",
        )

    if ignored_files:
        warnings.append(f"Пропущены не-shapefile файлы: {', '.join(ignored_files[:8])}.")

    return {
        "preview_token": None,
        "source_filename": "local-shapefile-files",
        "assignment_id": 0,
        "assets": assets,
        "previews": previews,
        "layer_count": len(assets),
        "layer_summaries": layer_summaries,
        "warnings": warnings,
    }


@router.post("/archive-preview")
def preview_submission_archive_before_submit(
    request: Request,
    assignment_id: int = Form(...),
    file: UploadFile = File(...),
    max_features: int = Query(500, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    """
    Временный preview ZIP-архива до сдачи.

    Ничего не создаёт в submissions и не сохраняет файл как работу студента:
    архив разбирается в памяти, layer assets конвертируются в GeoJSON preview.
    """
    enforce_rate_limit(
        build_rate_limit_key("submission-preview", get_client_ip(request), str(current_user.id)),
        max_requests=20,
        window_seconds=600,
    )

    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    _ensure_student_can_submit_assignment(assignment, current_user, db)

    file_bytes = file.file.read()
    validation = validate_submission_file(filename=file.filename, file_bytes=file_bytes)
    if validation["status"] == "failed":
        raise HTTPException(status_code=400, detail=validation["message"])

    if not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Предпросмотр до сдачи сейчас поддерживает ZIP-архивы.")

    parsed_assets = parse_submission_archive(file_bytes)
    assets = []
    layer_summaries = []
    warnings = []
    preview_token = uuid4().hex

    next_asset_id = 1
    for parsed in parsed_assets:
        if parsed.get("asset_type") != "layer" or parsed.get("detected_format") not in {"geojson", "shapefile_zip"}:
            continue

        asset_id = next_asset_id
        next_asset_id += 1
        asset_name = parsed["asset_name"]
        detected_format = parsed["detected_format"]
        layer_validation = validate_submission_file(asset_name, parsed["file_bytes"])
        layer_details = layer_validation.get("details", {})
        storage_key = f"archive-previews/{current_user.id}/{preview_token}/{asset_id}.bin"
        upload_bytes(
            object_key=storage_key,
            data=parsed["file_bytes"],
            content_type="application/octet-stream",
        )

        assets.append({
            "id": asset_id,
            "submission_id": 0,
            "asset_name": asset_name,
            "asset_type": "layer",
            "detected_format": detected_format,
            "status": parsed.get("status", "uploaded"),
            "message": parsed.get("message", ""),
            "download_url": None,
            "storage_key": storage_key,
        })
        layer_summaries.append({
            "asset_id": asset_id,
            "asset_name": asset_name,
            "detected_format": detected_format,
            "status": layer_validation.get("status"),
            "message": layer_validation.get("message"),
            "feature_count": layer_details.get("feature_count"),
            "geometry_types": layer_details.get("geometry_types", []),
            "crs": layer_details.get("crs"),
            "attribute_fields": layer_details.get("attribute_fields", []),
            "invalid_geometry_count": layer_details.get("invalid_geometry_count", 0),
            "has_prj": layer_details.get("has_prj"),
        })

    metadata = {
        "preview_token": preview_token,
        "user_id": current_user.id,
        "source_filename": file.filename,
        "assignment_id": assignment_id,
        "assets": assets,
        "layer_summaries": layer_summaries,
    }
    upload_bytes(
        object_key=f"archive-previews/{current_user.id}/{preview_token}/metadata.json",
        data=json.dumps(metadata, ensure_ascii=False).encode("utf-8"),
        content_type="application/json",
    )

    return {
        "preview_token": preview_token,
        "source_filename": file.filename,
        "assignment_id": assignment_id,
        "assets": assets,
        "previews": [],
        "layer_count": len(assets),
        "layer_summaries": layer_summaries,
        "warnings": warnings,
    }


@router.get("/archive-preview/{preview_token}/assets/{asset_id}/geojson-preview")
def preview_temporary_archive_asset_geojson(
    preview_token: str,
    asset_id: int,
    max_features: int = Query(500, ge=1, le=1000),
    current_user: User = Depends(get_current_user),
):
    metadata_key = f"archive-previews/{current_user.id}/{preview_token}/metadata.json"
    s3 = get_s3_client()
    try:
        metadata_obj = s3.get_object(Bucket=settings.s3_bucket_name, Key=metadata_key)
        metadata = json.loads(metadata_obj["Body"].read().decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=404, detail="Archive preview token not found or expired.")

    if metadata.get("user_id") != current_user.id:
        raise HTTPException(status_code=403, detail="Archive preview belongs to another user.")

    asset = next((item for item in metadata.get("assets", []) if item.get("id") == asset_id), None)
    if not asset:
        raise HTTPException(status_code=404, detail="Archive preview asset not found.")

    try:
        obj = s3.get_object(Bucket=settings.s3_bucket_name, Key=asset["storage_key"])
        file_bytes = obj["Body"].read()
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"Archive preview asset object not found: {exc}")

    try:
        return build_geojson_preview(
            asset_id=asset["id"],
            asset_name=asset["asset_name"],
            detected_format=asset["detected_format"],
            file_bytes=file_bytes,
            max_features=max_features,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Failed to build archive asset preview: {exc}")



@router.post("/", response_model=SubmissionRead, status_code=status.HTTP_201_CREATED)
def create_submission(
    request: Request,
    assignment_id: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
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
    try:
        enforce_rate_limit(
            build_rate_limit_key("submission-upload", get_client_ip(request), str(current_user.id)),
            max_requests=10,
            window_seconds=600,
        )

        assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
        if not assignment:
            raise HTTPException(status_code=404, detail="Assignment not found")
        _ensure_student_can_submit_assignment(assignment, current_user, db)

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
            student_id=current_user.id,
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
        # 4. REQUIREMENTS EVALUATION FOR MULTIPLE EXPECTED OUTPUTS
        # -------------------------------------------------
        requirements = (
            db.query(AssignmentRequirements)
            .filter(AssignmentRequirements.assignment_id == assignment_id)
            .first()
        )

        expected_outputs = requirements.expected_outputs_json if requirements else None

        if expected_outputs:
            match_result = match_assets_to_expected_outputs(
                created_assets,
                expected_outputs=expected_outputs,
            )

            output_evaluations = []

            for match in match_result["matches"]:
                expected_output = match["expected_output"]
                asset_id = match["asset_id"]

                if asset_id is None:
                    output_evaluation = {
                        "status": "failed",
                        "message": f"Не найден asset для ожидаемого output '{expected_output.get('name')}'.",
                        "result_json": {
                            "mode": "expected_output_missing",
                            "expected_output": expected_output,
                            "problems": [
                                {
                                    "code": "expected_output_missing",
                                    "message": f"Не найден asset для ожидаемого output '{expected_output.get('name')}'.",
                                }
                            ],
                            "warnings": [],
                            "passed_rules": [],
                        },
                    }

                    output_evaluations.append({
                        "expected_output": expected_output,
                        "asset_id": None,
                        "status": output_evaluation["status"],
                        "message": output_evaluation["message"],
                    })

                    db.add(
                        SubmissionCheck(
                            submission_id=submission.id,
                            submission_asset_id=None,
                            status=output_evaluation["status"],
                            file_type="requirements_output",
                            message=output_evaluation["message"],
                            result_json=output_evaluation["result_json"],
                        )
                    )
                    continue

                matched_asset = next((asset for asset in created_assets if asset.id == asset_id), None)
                validation_result = asset_validation_map.get(asset_id, {})

                output_evaluation = evaluate_asset_against_expected_output(
                    expected_output=expected_output,
                    validation_result=validation_result,
                )

                output_evaluations.append({
                    "expected_output": expected_output,
                    "asset_id": asset_id,
                    "asset_name": matched_asset.asset_name if matched_asset else None,
                    "status": output_evaluation["status"],
                    "message": output_evaluation["message"],
                })

                db.add(
                    SubmissionCheck(
                        submission_id=submission.id,
                        submission_asset_id=asset_id,
                        status=output_evaluation["status"],
                        file_type="requirements_output",
                        message=output_evaluation["message"],
                        result_json=output_evaluation["result_json"],
                    )
                )

            multi_layer_summary = build_multi_layer_summary(
                match_result=match_result,
                output_evaluations=output_evaluations,
            )

            db.add(
                SubmissionCheck(
                    submission_id=submission.id,
                    submission_asset_id=None,
                    status=multi_layer_summary["status"],
                    file_type="requirements_summary",
                    message=multi_layer_summary["message"],
                    result_json=multi_layer_summary["result_json"],
                )
            )
            db.commit()

        else:
            # Старый упрощённый режим можно временно оставить для заданий с одним слоем
            target_asset = choose_target_gis_asset(created_assets, requirements)

            if target_asset is None:
                report_only_mode = _has_report_asset(created_assets) and not _has_layer_asset(created_assets)
                requirement_evaluation = {
                    "status": "passed" if report_only_mode else "warning",
                    "message": (
                        "Submission содержит только report asset. Выполняется report-only review без GIS-layer formal-check."
                        if report_only_mode
                        else (
                            "Не удалось однозначно выбрать целевой GIS-asset для проверки по требованиям. "
                            "Выполнена только техническая проверка assets."
                        )
                    ),
                    "result_json": {
                        "mode": "report_only_submission" if report_only_mode else "target_asset_not_selected",
                        "problems": [],
                        "warnings": []
                        if report_only_mode
                        else [
                            "Не удалось однозначно выбрать целевой GIS-asset."
                        ],
                        "passed_rules": [
                            "Report asset uploaded and recognized."
                        ] if report_only_mode else [],
                    },
                }
            else:
                validation_result = asset_validation_map.get(target_asset.id, {})
                requirement_evaluation = evaluate_asset_against_requirements(
                    requirements=requirements,
                    validation_result=validation_result,
                )

            db.add(
                SubmissionCheck(
                    submission_id=submission.id,
                    submission_asset_id=target_asset.id if target_asset else None,
                    status=requirement_evaluation["status"],
                    file_type="requirements",
                    message=requirement_evaluation["message"],
                    result_json=requirement_evaluation.get("result_json"),
                )
            )
            db.add(
                SubmissionCheck(
                    submission_id=submission.id,
                    submission_asset_id=None,
                    status=requirement_evaluation["status"],
                    file_type="requirements_summary",
                    message=requirement_evaluation["message"],
                    result_json=requirement_evaluation.get("result_json"),
                )
            )
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


@router.get("/", response_model=list[SubmissionRead])
def list_submissions(
    assignment_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Submission)
    if assignment_id is not None:
        query = query.filter(Submission.assignment_id == assignment_id)
    if current_user.role == "student":
        query = query.filter(Submission.student_id == current_user.id)

    submissions = query.order_by(Submission.id.desc()).all()
    return [to_submission_read(submission) for submission in submissions]


@router.get("/{submission_id}", response_model=SubmissionRead)
def get_submission(
    submission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    submission = db.query(Submission).filter(Submission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    ensure_submission_access(submission, current_user)
    return to_submission_read(submission)


@router.get("/{submission_id}/assets", response_model=list[SubmissionAssetRead])
def list_submission_assets(
    submission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    submission = db.query(Submission).filter(Submission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    ensure_submission_access(submission, current_user)

    assets = (
        db.query(SubmissionAsset)
        .filter(SubmissionAsset.submission_id == submission_id)
        .order_by(SubmissionAsset.id.asc())
        .all()
    )
    return [to_submission_asset_read(asset) for asset in assets]


@router.get("/{submission_id}/checks", response_model=list[SubmissionCheckRead])
def list_submission_checks(
    submission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Возвращает все checks для конкретной submission.
    """
    submission = db.query(Submission).filter(Submission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    ensure_submission_access(submission, current_user)

    checks = (
        db.query(SubmissionCheck)
        .filter(SubmissionCheck.submission_id == submission_id)
        .order_by(SubmissionCheck.id.desc())
        .all()
    )
    return checks
