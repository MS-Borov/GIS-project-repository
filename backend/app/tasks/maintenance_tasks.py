"""Периодические задачи обслуживания платформы (выполняются worker'ом по расписанию).

Это фоновая уборка, которой никто не ждёт: если worker недоступен, на работе
пользователей это не сказывается — обслуживание просто выполнится позже.
"""
import asyncio
from datetime import datetime, timedelta, timezone

from app.tasks.broker import broker


@broker.task(schedule=[{"cron": "0 * * * *"}])  # ежечасно
async def cleanup_expired_verification_codes() -> dict:
    """Очистка просроченных кодов подтверждения e-mail.

    Затрагивает только истёкшие (уже недействительные) коды: обнуляет их хеш и
    срок действия. Учётные записи и любые пользовательские данные не удаляются.
    """
    return await asyncio.to_thread(_run_cleanup)


def _run_cleanup() -> dict:
    # Импорты внутри функции — задача выполняется в worker'е со своей сессией БД.
    from app.db.session import SessionLocal
    from app.models.user import User

    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        stale_users = (
            db.query(User)
            .filter(
                User.email_verification_expires_at.isnot(None),
                User.email_verification_expires_at < now,
            )
            .all()
        )
        cleared = 0
        for user in stale_users:
            user.email_verification_code_hash = None
            user.email_verification_expires_at = None
            cleared += 1
        db.commit()
        return {"cleared_expired_codes": cleared}
    finally:
        db.close()


@broker.task(schedule=[{"cron": "30 3 * * *"}])  # раз в сутки, 03:30
async def purge_trashed_assignments() -> dict:
    """Физически удаляет задания, пролежавшие в корзине дольше срока хранения.

    Удаляется само задание и (каскадом в БД) его сдачи. Активные задания и
    задания, лежащие в корзине меньше срока, не затрагиваются.
    """
    return await asyncio.to_thread(_run_purge_trashed_assignments)


def _run_purge_trashed_assignments() -> dict:
    from app.core.config import settings
    from app.db.session import SessionLocal
    from app.models.assignment import Assignment

    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(
            days=settings.assignment_trash_retention_days
        )
        expired = (
            db.query(Assignment)
            .filter(Assignment.deleted_at.isnot(None), Assignment.deleted_at < cutoff)
            .all()
        )
        purged = 0
        for assignment in expired:
            db.delete(assignment)
            purged += 1
        db.commit()
        return {"purged_trashed_assignments": purged}
    finally:
        db.close()