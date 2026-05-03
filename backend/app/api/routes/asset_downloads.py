from urllib.parse import quote

from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps.auth import ensure_submission_access, get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.submission_asset import SubmissionAsset
from app.models.user import User
from app.services.geojson_preview import build_geojson_preview
from app.services.storage import get_s3_client

router = APIRouter(prefix="/downloads", tags=["asset-downloads"])


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
        )
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail=f"Failed to build GeoJSON preview: {str(e)}",
        )
