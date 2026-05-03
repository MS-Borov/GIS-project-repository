from collections.abc import Callable

from fastapi import Request

from app.services.rate_limit import build_rate_limit_key, enforce_rate_limit, get_client_ip


def rate_limit(
    scope: str,
    *,
    max_requests: int,
    window_seconds: int,
) -> Callable[[Request], None]:
    def dependency(request: Request) -> None:
        key = build_rate_limit_key(scope, get_client_ip(request))
        enforce_rate_limit(
            key,
            max_requests=max_requests,
            window_seconds=window_seconds,
        )

    return dependency
