import hashlib
import logging

from fastapi import HTTPException, Request, status
from redis import Redis

from app.core.config import settings

logger = logging.getLogger(__name__)

_redis_client: Redis | None = None


def build_rate_limit_key(scope: str, *parts: str | None) -> str:
    raw_value = ":".join(part or "-" for part in parts)
    digest = hashlib.sha256(raw_value.encode("utf-8")).hexdigest()
    return f"rate-limit:{scope}:{digest}"


def get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def enforce_rate_limit(
    key: str,
    *,
    max_requests: int,
    window_seconds: int,
) -> None:
    if not settings.rate_limit_enabled:
        return

    try:
        redis_client = _get_redis_client()
        current_count = redis_client.incr(key)
        if current_count == 1:
            redis_client.expire(key, window_seconds)

        if current_count > max_requests:
            retry_after = redis_client.ttl(key)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please try again later.",
                headers={"Retry-After": str(max(retry_after, 1))},
            )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Rate limiter is unavailable")


def _get_redis_client() -> Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = Redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=1,
            socket_timeout=1,
        )
    return _redis_client
