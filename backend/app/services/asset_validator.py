from botocore.exceptions import ClientError

from app.core.config import settings
from app.services.storage import get_s3_client
from app.services.submission_validator import validate_submission_file


def validate_asset_from_storage(asset) -> dict:
    """
    Повторно валидирует уже сохранённый asset по его storage_key.

    Возвращает тот же формат, что и validate_submission_file():
    {
        "status": ...,
        "file_type": ...,
        "detected_format": ...,
        "message": ...,
        "details": {...}
    }
    """
    if not asset.storage_key:
        return {
            "status": "failed",
            "file_type": asset.detected_format or "unknown",
            "detected_format": asset.detected_format or "unknown",
            "message": "У asset отсутствует storage_key, повторная проверка невозможна.",
            "details": {
                "reason": "missing_storage_key",
                "asset_id": getattr(asset, "id", None),
                "asset_name": getattr(asset, "asset_name", None),
            },
        }

    s3 = get_s3_client()

    try:
        obj = s3.get_object(
            Bucket=settings.s3_bucket_name,
            Key=asset.storage_key,
        )
        file_bytes = obj["Body"].read()
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "unknown")
        return {
            "status": "failed",
            "file_type": asset.detected_format or "unknown",
            "detected_format": asset.detected_format or "unknown",
            "message": (
                f"Не удалось получить asset из object storage. "
                f"bucket={settings.s3_bucket_name}, key={asset.storage_key}, code={error_code}"
            ),
            "details": {
                "reason": "storage_client_error",
                "bucket": settings.s3_bucket_name,
                "key": asset.storage_key,
                "code": error_code,
                "asset_id": getattr(asset, "id", None),
                "asset_name": getattr(asset, "asset_name", None),
            },
        }
    except Exception as e:
        return {
            "status": "failed",
            "file_type": asset.detected_format or "unknown",
            "detected_format": asset.detected_format or "unknown",
            "message": f"Ошибка чтения asset из storage: {str(e)}",
            "details": {
                "reason": "storage_read_error",
                "error": str(e),
                "asset_id": getattr(asset, "id", None),
                "asset_name": getattr(asset, "asset_name", None),
            },
        }

    validation = validate_submission_file(
        filename=asset.asset_name,
        file_bytes=file_bytes,
    )

    # Небольшое расширение:
    # добавляем метаинформацию об asset в details,
    # чтобы потом не приходилось собирать это отдельно.
    validation.setdefault("details", {})
    validation["details"]["asset_id"] = getattr(asset, "id", None)
    validation["details"]["asset_name"] = getattr(asset, "asset_name", None)
    validation["details"]["asset_type"] = getattr(asset, "asset_type", None)
    validation["details"]["storage_key"] = getattr(asset, "storage_key", None)

    return validation