import json
import re
import tempfile
import zipfile
from collections import defaultdict
from pathlib import Path
from urllib.parse import quote
from typing import Any

import geopandas as gpd
from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from shapely.geometry import shape
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user, require_student
from app.core.config import settings
from app.db.session import get_db
from app.models.assignment import Assignment
from app.models.assignment_requirements import AssignmentRequirements
from app.models.course import CourseMember
from app.models.map_draft import MapDraft
from app.models.submission import Submission
from app.models.submission_asset import SubmissionAsset
from app.models.submission_check import SubmissionCheck
from app.models.user import User
from app.schemas.map_draft import MapDraftCreate, MapDraftRead, MapDraftShapefileArchiveRequest, MapDraftUpdate
from app.schemas.submission import SubmissionRead
from app.services.asset_requirement_evaluator import evaluate_asset_against_requirements
from app.services.asset_validator import validate_asset_from_storage
from app.services.expected_output_evaluator import evaluate_asset_against_expected_output
from app.services.multi_layer_requirement_matcher import match_assets_to_expected_outputs
from app.services.multi_layer_summary_builder import build_multi_layer_summary
from app.services.submission_archive_parser import parse_submission_archive
from app.services.submission_validator import validate_submission_file
from app.services.storage import (
    build_asset_storage_key,
    build_map_draft_storage_key,
    build_submission_storage_key,
    get_s3_client,
    upload_bytes,
)

router = APIRouter(prefix="/map-drafts", tags=["map-drafts"])


def _safe_archive_stem(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^\wа-яА-ЯёЁ.-]+", "_", value.strip(), flags=re.UNICODE).strip("._")
    return (cleaned or fallback)[:60]


def _json_safe_attribute(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return json.dumps(value, ensure_ascii=False)


def _feature_layer_name(feature: dict[str, Any], index: int) -> str:
    properties = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
    for key in ("draft_layer_name", "source_layer_name", "active_layer_name", "layer_name"):
        value = properties.get(key)
        if value:
            return str(value)
    return f"layer_{index + 1}"


def _geometry_suffix(geometry_type: str | None) -> str:
    value = (geometry_type or "geometry").lower()
    if "point" in value:
        return "points"
    if "line" in value:
        return "lines"
    if "polygon" in value:
        return "polygons"
    return "geometry"


def _style_manifest_layers(style_manifest: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(style_manifest, dict):
        return []
    layers = style_manifest.get("layers")
    if not isinstance(layers, list):
        return []
    return [layer for layer in layers if isinstance(layer, dict)]


def _manifest_match_key(value: Any) -> str:
    name = Path(str(value or "").replace("\\", "/")).name.lower().strip()
    return re.sub(r"\.(zip|geojson|shp)$", "", name)


def _find_style_manifest_layer(style_layers: list[dict[str, Any]], layer_name: str) -> dict[str, Any] | None:
    target = _manifest_match_key(layer_name)
    if not target:
        return None
    for layer in style_layers:
        candidates = [
            layer.get("source_layer_name"),
            layer.get("alias"),
            layer.get("asset_name"),
            layer.get("export_stem"),
        ]
        for candidate in candidates:
            key = _manifest_match_key(candidate)
            if key and (key == target or target.startswith(f"{key}_") or key.startswith(f"{target}_")):
                return layer
    return None


def _draft_geojson_to_shapefile_archive(
    geojson: dict[str, Any],
    archive_name: str,
    style_manifest: dict[str, Any] | None = None,
) -> bytes:
    if geojson.get("type") != "FeatureCollection" or not isinstance(geojson.get("features"), list):
        raise HTTPException(status_code=422, detail="Draft export expects GeoJSON FeatureCollection")

    grouped_features: dict[str, list[dict[str, Any]]] = defaultdict(list)
    grouped_layer_names: dict[str, str] = {}
    for index, feature in enumerate(geojson["features"]):
        if not isinstance(feature, dict) or not feature.get("geometry"):
            continue
        properties = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
        layer_name = _feature_layer_name(feature, index)
        try:
            geometry = shape(feature["geometry"])
        except Exception:
            continue
        group_name = f"{layer_name}_{_geometry_suffix(geometry.geom_type)}"
        grouped_layer_names.setdefault(group_name, layer_name)
        grouped_features[group_name].append(
            {
                "geometry": geometry,
                **{str(key): _json_safe_attribute(value) for key, value in properties.items()},
            }
        )

    if not grouped_features:
        raise HTTPException(status_code=422, detail="Draft export has no geometries")

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        archive_path = tmp_path / f"{_safe_archive_stem(archive_name, 'draft_layers')}.zip"
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            used_names: set[str] = set()
            style_layers = _style_manifest_layers(style_manifest)
            exported_style_layers: list[dict[str, Any]] = []
            for index, (group_name, rows) in enumerate(grouped_features.items(), start=1):
                stem = _safe_archive_stem(group_name, f"layer_{index}")
                base_stem = stem
                suffix = 2
                while stem.lower() in used_names:
                    stem = f"{base_stem[:54]}_{suffix}"
                    suffix += 1
                used_names.add(stem.lower())

                layer_dir = tmp_path / stem
                layer_dir.mkdir(parents=True, exist_ok=True)
                shp_path = layer_dir / f"{stem}.shp"
                gdf = gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")
                try:
                    gdf.to_file(shp_path, driver="ESRI Shapefile", encoding="UTF-8")
                except Exception as exc:
                    raise HTTPException(status_code=422, detail=f"Could not write shapefile '{stem}': {exc}") from exc

                for layer_file in layer_dir.iterdir():
                    if layer_file.is_file():
                        archive.write(layer_file, arcname=f"{stem}/{layer_file.name}")

                source_layer_name = grouped_layer_names.get(group_name, group_name)
                source_style = _find_style_manifest_layer(style_layers, source_layer_name)
                exported_style_layer = dict(source_style or {})
                exported_style_layer.update({
                    "source_layer_name": source_layer_name,
                    "asset_name": f"{stem}.zip",
                    "export_stem": stem,
                })
                exported_style_layers.append(exported_style_layer)

            archive.writestr(
                "style-manifest.json",
                json.dumps(
                    {
                        "version": 1,
                        "source": "gis-edu-platform",
                        "archive_name": archive_name,
                        "layers": exported_style_layers,
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
            )

        return archive_path.read_bytes()


def _geojson_style_manifest(geojson: dict[str, Any]) -> dict[str, Any] | None:
    properties = geojson.get("properties") if isinstance(geojson.get("properties"), dict) else {}
    manifest = properties.get("style_manifest")
    return manifest if isinstance(manifest, dict) else None


def _to_submission_read(submission: Submission) -> SubmissionRead:
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


def _feature_count(geojson: dict[str, Any]) -> int:
    if geojson.get("type") == "FeatureCollection":
        features = geojson.get("features")
        return len(features) if isinstance(features, list) else 0
    if geojson.get("type") == "Feature":
        return 1
    return 0


def _geojson_bytes(geojson: dict[str, Any]) -> bytes:
    return json.dumps(geojson, ensure_ascii=False).encode("utf-8")


def _read_storage_json(storage_key: str) -> dict[str, Any]:
    s3 = get_s3_client()
    try:
        obj = s3.get_object(Bucket=settings.s3_bucket_name, Key=storage_key)
        return json.loads(obj["Body"].read().decode("utf-8"))
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "unknown")
        raise HTTPException(status_code=404, detail=f"Draft GeoJSON object not found: {code}") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="Draft GeoJSON object is not valid JSON") from exc


def _ensure_student_assignment_access(assignment: Assignment, current_user: User, db: Session) -> None:
    if assignment.course_id is None:
        return

    membership = (
        db.query(CourseMember)
        .filter(CourseMember.course_id == assignment.course_id, CourseMember.user_id == current_user.id)
        .first()
    )
    if membership:
        return

    raise HTTPException(status_code=403, detail="Course membership required for this assignment")


def _ensure_teacher_assignment_access(assignment: Assignment, current_user: User, db: Session) -> None:
    if current_user.role == "admin":
        return
    if current_user.role != "teacher":
        raise HTTPException(status_code=403, detail="Teacher role required")
    if assignment.course_id is None:
        return

    membership = (
        db.query(CourseMember)
        .filter(
            CourseMember.course_id == assignment.course_id,
            CourseMember.user_id == current_user.id,
            CourseMember.role == "teacher",
        )
        .first()
    )
    if membership:
        return

    raise HTTPException(status_code=403, detail="Assignment access denied")


def _to_map_draft_read(draft: MapDraft, include_geojson: bool = False) -> MapDraftRead:
    return MapDraftRead(
        id=draft.id,
        assignment_id=draft.assignment_id,
        student_id=draft.student_id,
        last_submission_id=draft.last_submission_id,
        name=draft.name,
        geometry_type=draft.geometry_type,
        geojson_storage_key=draft.geojson_storage_key,
        feature_count=draft.feature_count,
        status=draft.status,
        created_at=draft.created_at,
        updated_at=draft.updated_at,
        geojson=_read_storage_json(draft.geojson_storage_key) if include_geojson else None,
    )


def _ensure_draft_owner(draft: MapDraft, current_user: User) -> None:
    if draft.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only draft owner can modify this draft")


def _evaluate_single_geojson_submission(
    *,
    db: Session,
    submission: Submission,
    asset: SubmissionAsset,
) -> None:
    validation = validate_asset_from_storage(asset)
    db.add(
        SubmissionCheck(
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
    )
    asset.status = validation["status"]
    asset.message = validation["message"]
    asset.detected_format = validation["detected_format"]
    db.flush()

    requirements = (
        db.query(AssignmentRequirements)
        .filter(AssignmentRequirements.assignment_id == submission.assignment_id)
        .first()
    )
    expected_outputs = requirements.expected_outputs_json if requirements else None

    if expected_outputs:
        match_result = match_assets_to_expected_outputs([asset], expected_outputs=expected_outputs)
        output_evaluations = []
        for match in match_result["matches"]:
            expected_output = match["expected_output"]
            if match["asset_id"] is None:
                output_evaluation = {
                    "status": "failed",
                    "message": f"Asset for expected output '{expected_output.get('name')}' was not found.",
                    "result_json": {
                        "mode": "expected_output_missing",
                        "expected_output": expected_output,
                        "problems": [
                            {
                                "code": "expected_output_missing",
                                "message": f"Asset for expected output '{expected_output.get('name')}' was not found.",
                            }
                        ],
                        "warnings": [],
                        "passed_rules": [],
                    },
                }
                output_evaluations.append(
                    {
                        "expected_output": expected_output,
                        "asset_id": None,
                        "status": output_evaluation["status"],
                        "message": output_evaluation["message"],
                    }
                )
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

            output_evaluation = evaluate_asset_against_expected_output(
                expected_output=expected_output,
                validation_result=validation,
            )
            output_evaluations.append(
                {
                    "expected_output": expected_output,
                    "asset_id": asset.id,
                    "asset_name": asset.asset_name,
                    "status": output_evaluation["status"],
                    "message": output_evaluation["message"],
                }
            )
            db.add(
                SubmissionCheck(
                    submission_id=submission.id,
                    submission_asset_id=asset.id,
                    status=output_evaluation["status"],
                    file_type="requirements_output",
                    message=output_evaluation["message"],
                    result_json=output_evaluation["result_json"],
                )
            )

        summary = build_multi_layer_summary(match_result=match_result, output_evaluations=output_evaluations)
        db.add(
            SubmissionCheck(
                submission_id=submission.id,
                submission_asset_id=None,
                status=summary["status"],
                file_type="requirements_summary",
                message=summary["message"],
                result_json=summary["result_json"],
            )
        )
    else:
        evaluation = evaluate_asset_against_requirements(
            requirements=requirements,
            validation_result=validation,
        )
        db.add(
            SubmissionCheck(
                submission_id=submission.id,
                submission_asset_id=asset.id,
                status=evaluation["status"],
                file_type="requirements",
                message=evaluation["message"],
                result_json=evaluation.get("result_json"),
            )
        )
        db.add(
            SubmissionCheck(
                submission_id=submission.id,
                submission_asset_id=None,
                status=evaluation["status"],
                file_type="requirements_summary",
                message=evaluation["message"],
                result_json=evaluation.get("result_json"),
            )
        )

    db.flush()
    checks = db.query(SubmissionCheck).filter(SubmissionCheck.submission_id == submission.id).all()
    statuses = {check.status.lower() for check in checks}
    if "failed" in statuses:
        submission.status = "failed"
    elif "warning" in statuses:
        submission.status = "warning"
    else:
        submission.status = "passed"


def _evaluate_submission_assets(
    *,
    db: Session,
    submission: Submission,
    assets: list[SubmissionAsset],
) -> None:
    asset_validation_map: dict[int, dict[str, Any]] = {}

    for asset in assets:
        validation = validate_asset_from_storage(asset)
        asset_validation_map[asset.id] = validation
        db.add(
            SubmissionCheck(
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
        )
        asset.status = validation["status"]
        asset.message = validation["message"]
        asset.detected_format = validation["detected_format"]

    db.flush()

    requirements = (
        db.query(AssignmentRequirements)
        .filter(AssignmentRequirements.assignment_id == submission.assignment_id)
        .first()
    )
    expected_outputs = requirements.expected_outputs_json if requirements else None

    layer_assets = [asset for asset in assets if asset.asset_type == "layer"]
    if expected_outputs:
        match_result = match_assets_to_expected_outputs(layer_assets, expected_outputs=expected_outputs)
        output_evaluations = []
        for match in match_result["matches"]:
            expected_output = match["expected_output"]
            asset_id = match["asset_id"]

            if asset_id is None:
                message = f"Asset for expected output '{expected_output.get('name')}' was not found."
                output_evaluations.append(
                    {
                        "expected_output": expected_output,
                        "asset_id": None,
                        "status": "failed",
                        "message": message,
                    }
                )
                db.add(
                    SubmissionCheck(
                        submission_id=submission.id,
                        submission_asset_id=None,
                        status="failed",
                        file_type="requirements_output",
                        message=message,
                        result_json={
                            "mode": "expected_output_missing",
                            "expected_output": expected_output,
                            "problems": [{"code": "expected_output_missing", "message": message}],
                            "warnings": [],
                            "passed_rules": [],
                        },
                    )
                )
                continue

            matched_asset = next((asset for asset in layer_assets if asset.id == asset_id), None)
            validation_result = asset_validation_map.get(asset_id, {})
            output_evaluation = evaluate_asset_against_expected_output(
                expected_output=expected_output,
                validation_result=validation_result,
            )
            output_evaluations.append(
                {
                    "expected_output": expected_output,
                    "asset_id": asset_id,
                    "asset_name": matched_asset.asset_name if matched_asset else None,
                    "status": output_evaluation["status"],
                    "message": output_evaluation["message"],
                }
            )
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

        summary = build_multi_layer_summary(match_result=match_result, output_evaluations=output_evaluations)
        db.add(
            SubmissionCheck(
                submission_id=submission.id,
                submission_asset_id=None,
                status=summary["status"],
                file_type="requirements_summary",
                message=summary["message"],
                result_json=summary["result_json"],
            )
        )
    elif layer_assets:
        statuses = {asset_validation_map.get(asset.id, {}).get("status", "warning") for asset in layer_assets}
        status_value = "failed" if "failed" in statuses else "warning" if "warning" in statuses else "passed"
        message = f"Submitted archive contains {len(layer_assets)} GIS layer(s). Technical validation completed."
        db.add(
            SubmissionCheck(
                submission_id=submission.id,
                submission_asset_id=None,
                status=status_value,
                file_type="requirements_summary",
                message=message,
                result_json={
                    "mode": "archive_layers_summary",
                    "layer_count": len(layer_assets),
                    "layers": [
                        {
                            "asset_id": asset.id,
                            "asset_name": asset.asset_name,
                            "status": asset_validation_map.get(asset.id, {}).get("status"),
                            "details": asset_validation_map.get(asset.id, {}).get("details", {}),
                        }
                        for asset in layer_assets
                    ],
                },
            )
        )
    else:
        db.add(
            SubmissionCheck(
                submission_id=submission.id,
                submission_asset_id=None,
                status="warning",
                file_type="requirements_summary",
                message="Submitted archive does not contain GIS layers.",
                result_json={"mode": "archive_without_layers", "warnings": ["No GIS layers found."]},
            )
        )

    db.flush()
    checks = db.query(SubmissionCheck).filter(SubmissionCheck.submission_id == submission.id).all()
    statuses = {check.status.lower() for check in checks}
    if "failed" in statuses:
        submission.status = "failed"
    elif "warning" in statuses:
        submission.status = "warning"
    else:
        submission.status = "passed"


@router.get("/", response_model=list[MapDraftRead])
def list_map_drafts(
    assignment_id: int | None = Query(default=None),
    student_id: int | None = Query(default=None),
    include_geojson: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(MapDraft)

    if assignment_id is not None:
        assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
        if not assignment:
            raise HTTPException(status_code=404, detail="Assignment not found")
        if current_user.role == "student":
            _ensure_student_assignment_access(assignment, current_user, db)
        else:
            _ensure_teacher_assignment_access(assignment, current_user, db)
        query = query.filter(MapDraft.assignment_id == assignment_id)

    if current_user.role == "student":
        query = query.filter(MapDraft.student_id == current_user.id)
    elif current_user.role == "teacher" and assignment_id is None:
        teacher_assignment_ids = (
            db.query(Assignment.id)
            .join(CourseMember, Assignment.course_id == CourseMember.course_id)
            .filter(CourseMember.user_id == current_user.id, CourseMember.role == "teacher")
            .subquery()
        )
        query = query.filter(MapDraft.assignment_id.in_(teacher_assignment_ids))
    elif student_id is not None:
        query = query.filter(MapDraft.student_id == student_id)

    drafts = query.order_by(MapDraft.updated_at.desc(), MapDraft.id.desc()).all()
    return [_to_map_draft_read(draft, include_geojson=include_geojson) for draft in drafts]


@router.post("/", response_model=MapDraftRead, status_code=status.HTTP_201_CREATED)
def create_map_draft(
    payload: MapDraftCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    assignment = db.query(Assignment).filter(Assignment.id == payload.assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    _ensure_student_assignment_access(assignment, current_user, db)

    data = _geojson_bytes(payload.geojson)
    storage_key = build_map_draft_storage_key(current_user.id, assignment.id, payload.name)
    upload_bytes(storage_key, data, "application/geo+json")

    draft = MapDraft(
        assignment_id=assignment.id,
        student_id=current_user.id,
        name=payload.name.strip(),
        geometry_type=payload.geometry_type.strip() or "mixed",
        geojson_storage_key=storage_key,
        feature_count=_feature_count(payload.geojson),
        status="draft",
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return _to_map_draft_read(draft, include_geojson=True)


@router.post("/export-shapefile-archive")
def export_map_draft_shapefile_archive(
    payload: MapDraftShapefileArchiveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    assignment = db.query(Assignment).filter(Assignment.id == payload.assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    _ensure_student_assignment_access(assignment, current_user, db)

    archive_bytes = _draft_geojson_to_shapefile_archive(payload.geojson, payload.name, payload.style_manifest)
    filename = f"{_safe_archive_stem(payload.name, 'draft_layers')}_shapefiles.zip"
    return StreamingResponse(
        iter([archive_bytes]),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.get("/{draft_id}", response_model=MapDraftRead)
def get_map_draft(
    draft_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    draft = db.query(MapDraft).filter(MapDraft.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Map draft not found")
    if current_user.role == "student":
        _ensure_draft_owner(draft, current_user)
    else:
        _ensure_teacher_assignment_access(draft.assignment, current_user, db)

    return _to_map_draft_read(draft, include_geojson=True)


@router.patch("/{draft_id}", response_model=MapDraftRead)
def update_map_draft(
    draft_id: int,
    payload: MapDraftUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    draft = db.query(MapDraft).filter(MapDraft.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Map draft not found")
    _ensure_draft_owner(draft, current_user)

    if payload.name is not None:
        draft.name = payload.name.strip()
    if payload.geometry_type is not None:
        draft.geometry_type = payload.geometry_type.strip() or "mixed"
    if payload.geojson is not None:
        data = _geojson_bytes(payload.geojson)
        storage_key = build_map_draft_storage_key(current_user.id, draft.assignment_id, draft.name)
        upload_bytes(storage_key, data, "application/geo+json")
        draft.geojson_storage_key = storage_key
        draft.feature_count = _feature_count(payload.geojson)
        draft.status = "draft"

    db.commit()
    db.refresh(draft)
    return _to_map_draft_read(draft, include_geojson=True)


@router.post("/{draft_id}/submit", response_model=SubmissionRead, status_code=status.HTTP_201_CREATED)
def submit_map_draft(
    draft_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    draft = db.query(MapDraft).filter(MapDraft.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Map draft not found")
    _ensure_draft_owner(draft, current_user)
    _ensure_student_assignment_access(draft.assignment, current_user, db)

    geojson = _read_storage_json(draft.geojson_storage_key)
    style_manifest = _geojson_style_manifest(geojson)
    data = _draft_geojson_to_shapefile_archive(geojson, draft.name, style_manifest)
    filename = f"{_safe_archive_stem(draft.name, 'draft_layers')}_shapefiles.zip"
    submission_key = build_submission_storage_key(filename)
    upload_bytes(submission_key, data, "application/zip")

    submission = Submission(
        assignment_id=draft.assignment_id,
        student_id=current_user.id,
        original_filename=filename,
        storage_key=submission_key,
        content_type="application/zip",
        size_bytes=len(data),
        status="uploaded",
    )
    db.add(submission)
    db.flush()

    created_assets: list[SubmissionAsset] = []
    for parsed_asset in parse_submission_archive(data):
        asset_bytes = parsed_asset.get("file_bytes")
        asset_storage_key = None
        if asset_bytes is not None:
            asset_storage_key = build_asset_storage_key(submission.id, parsed_asset["asset_name"])
            upload_bytes(asset_storage_key, asset_bytes, "application/octet-stream")

        db_asset = SubmissionAsset(
            submission_id=submission.id,
            asset_name=parsed_asset["asset_name"],
            asset_type=parsed_asset["asset_type"],
            detected_format=parsed_asset["detected_format"],
            status=parsed_asset["status"],
            message=parsed_asset["message"],
            storage_key=asset_storage_key,
            group_key=parsed_asset.get("group_key"),
        )
        db.add(db_asset)
        created_assets.append(db_asset)

    if not created_assets:
        validation = validate_submission_file(filename, data)
        db.add(
            SubmissionCheck(
                submission_id=submission.id,
                submission_asset_id=None,
                status="failed",
                file_type=validation["file_type"],
                message=f"Draft archive did not produce layer assets: {validation['message']}",
                result_json={"mode": "draft_archive_parse_failed", "details": validation.get("details", {})},
            )
        )
        submission.status = "failed"
    else:
        db.flush()
        _evaluate_submission_assets(db=db, submission=submission, assets=created_assets)

    draft.status = "submitted"
    draft.last_submission_id = submission.id

    db.commit()
    db.refresh(submission)
    return _to_submission_read(submission)
