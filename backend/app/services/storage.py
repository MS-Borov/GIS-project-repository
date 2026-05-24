import uuid
import io
import zipfile
import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from fastapi import HTTPException, UploadFile, status

from app.core.config import settings


def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=f"http://{settings.s3_endpoint}",
        aws_access_key_id=settings.s3_access_key_id,
        aws_secret_access_key=settings.s3_secret_access_key,
        region_name=settings.s3_region,
        use_ssl=settings.s3_use_ssl,
        config=Config(signature_version="s3v4"),
    )


def ensure_bucket_exists(bucket_name: str):
    client = get_s3_client()
    try:
        client.head_bucket(Bucket=bucket_name)
    except ClientError:
        client.create_bucket(Bucket=bucket_name)


def upload_submission_file(file_obj, filename: str, content_type: str | None = None) -> str:
    client = get_s3_client()
    bucket_name = settings.s3_bucket_name

    ensure_bucket_exists(bucket_name)

    file_extension = ""
    if "." in filename:
        file_extension = "." + filename.rsplit(".", 1)[-1].lower()

    object_key = f"submissions/{uuid.uuid4().hex}{file_extension}"

    extra_args = {}
    if content_type:
        extra_args["ContentType"] = content_type

    client.upload_fileobj(
        file_obj,
        bucket_name,
        object_key,
        ExtraArgs=extra_args,
    )

    return object_key

def upload_bytes(object_key: str, data: bytes, content_type: str | None = None) -> str:
    client = get_s3_client()
    bucket_name = settings.s3_bucket_name

    ensure_bucket_exists(bucket_name)

    extra_args = {}
    if content_type:
        extra_args["ContentType"] = content_type

    client.upload_fileobj(
        io.BytesIO(data),
        bucket_name,
        object_key,
        ExtraArgs=extra_args,
    )
    return object_key


def upload_fileobj_stream(
    object_key: str,
    file_obj,
    content_type: str | None = None,
) -> str:
    """Стримит file-like объект в S3 чанками (boto3 делает multipart автоматически
    для больших файлов). Использовать когда не нужно держать всё содержимое в памяти.

    Подходит для прямой загрузки UploadFile (FastAPI) → S3, без `.read()` целиком.
    """
    client = get_s3_client()
    bucket_name = settings.s3_bucket_name

    ensure_bucket_exists(bucket_name)

    extra_args = {}
    if content_type:
        extra_args["ContentType"] = content_type

    # Если caller уже что-то прочитал — отматываем в начало
    if hasattr(file_obj, "seek"):
        try:
            file_obj.seek(0)
        except Exception:
            pass

    client.upload_fileobj(
        file_obj,
        bucket_name,
        object_key,
        ExtraArgs=extra_args,
    )
    return object_key


def enforce_upload_size_limit(file: UploadFile, max_bytes: int) -> None:
    """Если Content-Length известен, сразу проверяем. Если нет — рассчитываем
    на nginx client_max_body_size и на чтение с лимитом ниже по стеку.
    """
    size = getattr(file, "size", None)
    if size is not None and size > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Файл слишком большой: {size} байт, "
                f"лимит {max_bytes} байт ({max_bytes // (1024 * 1024)} MB)."
            ),
        )


def read_upload_bounded(file: UploadFile, max_bytes: int) -> bytes:
    """Читает upload в память с жёстким верхним лимитом. Кидает 413 если
    превышен лимит, не успев положить файл в память целиком.
    """
    enforce_upload_size_limit(file, max_bytes)
    try:
        file.file.seek(0)
    except Exception:
        pass
    data = file.file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Файл превышает лимит {max_bytes} байт "
                f"({max_bytes // (1024 * 1024)} MB)."
            ),
        )
    return data

def build_asset_storage_key(submission_id: int, asset_name: str) -> str:
    safe_name = asset_name.replace("\\", "_").replace("/", "_").replace(" ", "_")
    return f"submission-assets/{submission_id}/{uuid.uuid4().hex}_{safe_name}"

def build_map_draft_storage_key(student_id: int, assignment_id: int, draft_name: str) -> str:
    safe_name = draft_name.replace("\\", "_").replace("/", "_").replace(" ", "_")
    return f"map-drafts/{assignment_id}/{student_id}/{uuid.uuid4().hex}_{safe_name}.geojson"

def build_assignment_material_storage_key(assignment_id: int, filename: str) -> str:
    safe_name = filename.replace("\\", "_").replace("/", "_").replace(" ", "_")
    return f"assignment-materials/{assignment_id}/{uuid.uuid4().hex}_{safe_name}"

def build_submission_storage_key(filename: str) -> str:
    safe_name = filename.replace("\\", "_").replace("/", "_").replace(" ", "_")
    return f"submissions/{uuid.uuid4().hex}_{safe_name}"

def build_shapefile_asset_zip(group_files: dict[str, bytes]) -> str:
    """
    Собирает один shapefile asset в отдельный zip:
    например roads.shp + roads.dbf + roads.shx + roads.prj
    """
    memory_zip = io.BytesIO()
    with zipfile.ZipFile(memory_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for filename, file_bytes in group_files.items():
            zf.writestr(filename, file_bytes)
    return memory_zip.getvalue()