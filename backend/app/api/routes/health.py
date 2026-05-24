import logging

from fastapi import APIRouter, Response
from sqlalchemy import text

from app.db.session import SessionLocal

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/health")
def liveness():
    """Liveness — приложение поднято и отвечает.
    Используется для healthcheck в docker-compose.
    """
    return {"status": "ok"}


@router.get("/health/ready")
def readiness(response: Response):
    """Readiness — проверка реальных зависимостей.
    Возвращает 503, если критичная зависимость (БД) недоступна.
    Redis и SMTP считаются опциональными и не валят статус.
    """
    checks: dict[str, str] = {}
    is_ready = True

    # БД — критична
    try:
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
            checks["db"] = "ok"
        finally:
            db.close()
    except Exception as exc:
        logger.warning("Readiness: DB check failed: %s", exc)
        checks["db"] = f"failed: {exc.__class__.__name__}"
        is_ready = False

    # Redis — нужен только для rate-limit и фоновых задач; не критичен для базовой работы
    try:
        from app.services.rate_limit import _get_redis_client

        _get_redis_client().ping()
        checks["redis"] = "ok"
    except Exception as exc:
        logger.warning("Readiness: Redis check failed: %s", exc)
        checks["redis"] = f"degraded: {exc.__class__.__name__}"

    if not is_ready:
        response.status_code = 503
    return {
        "status": "ok" if is_ready else "degraded",
        "checks": checks,
    }