import base64
import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.config import settings


ALGORITHM = "HS256"
VALID_ROLES = {"admin", "teacher", "student"}


def normalize_email(email: str) -> str:
    return email.strip().lower()


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        120_000,
    )
    return f"pbkdf2_sha256$120000${_b64url_encode(salt)}${_b64url_encode(digest)}"


def verify_password(password: str, hashed_password: str) -> bool:
    try:
        algorithm, iterations_raw, salt_raw, digest_raw = hashed_password.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = _b64url_decode(salt_raw)
        expected_digest = _b64url_decode(digest_raw)
        actual_digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt,
            int(iterations_raw),
        )
        return hmac.compare_digest(actual_digest, expected_digest)
    except Exception:
        return False


def create_access_token(user_id: int, role: str) -> str:
    expire_at = datetime.now(timezone.utc) + timedelta(
        minutes=settings.auth_access_token_expire_minutes,
    )
    payload = {
        "sub": str(user_id),
        "role": role,
        "exp": int(expire_at.timestamp()),
    }
    return _encode_jwt(payload)


def decode_access_token(token: str) -> dict[str, Any] | None:
    try:
        header_raw, payload_raw, signature_raw = token.split(".", 2)
        signed_content = f"{header_raw}.{payload_raw}".encode("ascii")
        expected_signature = _sign(signed_content)
        actual_signature = _b64url_decode(signature_raw)
        if not hmac.compare_digest(actual_signature, expected_signature):
            return None

        payload = json.loads(_b64url_decode(payload_raw))
        expires_at = int(payload.get("exp", 0))
        if expires_at < int(datetime.now(timezone.utc).timestamp()):
            return None
        if payload.get("role") not in VALID_ROLES:
            return None
        return payload
    except Exception:
        return None


def _encode_jwt(payload: dict[str, Any]) -> str:
    header = {"alg": ALGORITHM, "typ": "JWT"}
    header_raw = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_raw = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = _b64url_encode(_sign(f"{header_raw}.{payload_raw}".encode("ascii")))
    return f"{header_raw}.{payload_raw}.{signature}"


def _sign(value: bytes) -> bytes:
    return hmac.new(
        settings.auth_secret_key.encode("utf-8"),
        value,
        hashlib.sha256,
    ).digest()


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)
