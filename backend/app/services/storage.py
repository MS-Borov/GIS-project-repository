import uuid

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

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