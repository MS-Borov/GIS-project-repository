from urllib.parse import quote
import json

from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps.auth import ensure_submission_access, get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.assignment import Assignment
from app.models.assignment_material import AssignmentMaterial
from app.models.course import CourseMember
from app.models.submission_asset import SubmissionAsset
from app.models.user import User
from app.services.geojson_preview import build_geojson_preview, parse_preview_bbox
from app.services.storage import get_s3_client

router = APIRouter(prefix="/downloads", tags=["asset-downloads"])


def _ensure_assignment_material_access(material: AssignmentMaterial, current_user: User, db: Session) -> None:
    if current_user.role == "admin":
        return

    assignment = db.query(Assignment).filter(Assignment.id == material.assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    if assignment.course_id is None:
        return

    if current_user.role == "teacher":
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

    if current_user.role == "student":
        membership = (
            db.query(CourseMember)
            .filter(CourseMember.course_id == assignment.course_id, CourseMember.user_id == current_user.id)
            .first()
        )
        if membership:
            return

    raise HTTPException(status_code=403, detail="Assignment material access denied")


@router.get("/submission-assets/{asset_id}")
def download_submission_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Скачать конкретный asset по его ID.
    Полезно для:
    - отладки
    - фронтенда
    - демонстрации на защите
    """
    asset = db.query(SubmissionAsset).filter(SubmissionAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(
            status_code=404,
            detail=f"SubmissionAsset with id={asset_id} not found in DB",
        )
    ensure_submission_access(asset.submission, current_user)

    if not asset.storage_key:
        raise HTTPException(
            status_code=400,
            detail="Asset does not have storage_key, file download is unavailable.",
        )

    s3 = get_s3_client()

    try:
        s3.head_object(
            Bucket=settings.s3_bucket_name,
            Key=asset.storage_key,
        )
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "unknown")
        raise HTTPException(
            status_code=404,
            detail=(
                f"Asset object not found in storage. "
                f"bucket={settings.s3_bucket_name}, key={asset.storage_key}, code={error_code}"
            ),
        )

    try:
        obj = s3.get_object(
            Bucket=settings.s3_bucket_name,
            Key=asset.storage_key,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to read asset object from storage: {str(e)}",
        )

    filename = asset.asset_name
    quoted_filename = quote(filename)

    return StreamingResponse(
        obj["Body"],
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quoted_filename}"
        },
    )


@router.get("/submission-assets/{asset_id}/geojson-preview")
def preview_submission_asset_geojson(
    asset_id: int,
    max_features: int = 500,
    bbox: str | None = None,
    clip_boundary: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = db.query(SubmissionAsset).filter(SubmissionAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(
            status_code=404,
            detail=f"SubmissionAsset with id={asset_id} not found in DB",
        )
    ensure_submission_access(asset.submission, current_user)

    if asset.detected_format not in {"geojson", "shapefile_zip"}:
        raise HTTPException(
            status_code=400,
            detail=f"GeoJSON preview is unavailable for format '{asset.detected_format}'.",
        )

    if not asset.storage_key:
        raise HTTPException(
            status_code=400,
            detail="Asset does not have storage_key, preview is unavailable.",
        )

    if max_features < 1:
        max_features = 1
    if max_features > 1000:
        max_features = 1000
    try:
        bbox_wgs84 = parse_preview_bbox(bbox)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    s3 = get_s3_client()

    try:
        obj = s3.get_object(
            Bucket=settings.s3_bucket_name,
            Key=asset.storage_key,
        )
        file_bytes = obj["Body"].read()
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "unknown")
        raise HTTPException(
            status_code=404,
            detail=(
                f"Asset object not found in storage. "
                f"bucket={settings.s3_bucket_name}, key={asset.storage_key}, code={error_code}"
            ),
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to read asset object from storage: {str(e)}",
        )

    try:
        return build_geojson_preview(
            asset_id=asset.id,
            asset_name=asset.asset_name,
            detected_format=asset.detected_format,
            file_bytes=file_bytes,
            max_features=max_features,
            bbox_wgs84=bbox_wgs84,
            clip_boundary=clip_boundary,
        )
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail=f"Failed to build GeoJSON preview: {str(e)}",
        )


@router.get("/assignment-materials/{material_id}/geojson-preview")
def preview_assignment_material_geojson(
    material_id: int,
    max_features: int = 500,
    bbox: str | None = None,
    clip_boundary: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    material = db.query(AssignmentMaterial).filter(AssignmentMaterial.id == material_id).first()
    if not material:
        raise HTTPException(status_code=404, detail="AssignmentMaterial not found")
    _ensure_assignment_material_access(material, current_user, db)

    if material.detected_format not in {"geojson", "shapefile_zip"}:
        raise HTTPException(status_code=400, detail=f"GeoJSON preview is unavailable for format '{material.detected_format}'.")

    if max_features < 1:
        max_features = 1
    if max_features > 1000:
        max_features = 1000
    try:
        bbox_wgs84 = parse_preview_bbox(bbox)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    s3 = get_s3_client()
    try:
        obj = s3.get_object(Bucket=settings.s3_bucket_name, Key=material.storage_key)
        file_bytes = obj["Body"].read()
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "unknown")
        raise HTTPException(
            status_code=404,
            detail=f"Assignment material object not found in storage. bucket={settings.s3_bucket_name}, key={material.storage_key}, code={error_code}",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read assignment material object from storage: {str(e)}")

    try:
        return build_geojson_preview(
            asset_id=material.id,
            asset_name=material.material_name,
            detected_format=material.detected_format,
            file_bytes=file_bytes,
            max_features=max_features,
            bbox_wgs84=bbox_wgs84,
            clip_boundary=clip_boundary,
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to build GeoJSON preview: {str(e)}")


@router.get("/assignment-materials/{material_id}/qgis-project")
def get_assignment_material_qgis_project(
    material_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    material = db.query(AssignmentMaterial).filter(AssignmentMaterial.id == material_id).first()
    if not material:
        raise HTTPException(status_code=404, detail="AssignmentMaterial not found")
    _ensure_assignment_material_access(material, current_user, db)

    if material.detected_format != "qgis_project":
        raise HTTPException(status_code=400, detail=f"QGIS project metadata is unavailable for format '{material.detected_format}'.")

    s3 = get_s3_client()
    try:
        obj = s3.get_object(Bucket=settings.s3_bucket_name, Key=material.storage_key)
        return json.loads(obj["Body"].read().decode("utf-8"))
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "unknown")
        raise HTTPException(
            status_code=404,
            detail=f"Assignment material object not found in storage. bucket={settings.s3_bucket_name}, key={material.storage_key}, code={error_code}",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read QGIS project metadata: {str(e)}")
