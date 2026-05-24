import logging
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formataddr

from fastapi import HTTPException, status

from app.core.config import settings
from app.models.user import User
from app.services.auth import hash_password, verify_password

logger = logging.getLogger(__name__)


def email_verification_is_enabled() -> bool:
    return settings.email_verification_required


def create_email_verification_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def apply_email_verification_code(user: User, code: str) -> None:
    now = datetime.now(timezone.utc)
    user.email_verified = False
    user.email_verified_at = None
    user.email_verification_code_hash = hash_password(code)
    user.email_verification_expires_at = now + timedelta(
        minutes=settings.email_verification_code_ttl_minutes,
    )
    user.email_verification_sent_at = now


def verify_email_code(user: User, code: str) -> bool:
    expires_at = _as_aware_utc(user.email_verification_expires_at)
    if not user.email_verification_code_hash or not expires_at:
        return False
    if expires_at < datetime.now(timezone.utc):
        return False
    return verify_password(code.strip(), user.email_verification_code_hash)


def mark_email_verified(user: User) -> None:
    user.email_verified = True
    user.email_verified_at = datetime.now(timezone.utc)
    user.email_verification_code_hash = None
    user.email_verification_expires_at = None
    user.email_verification_sent_at = None


def seconds_until_resend_allowed(user: User) -> int:
    sent_at = _as_aware_utc(user.email_verification_sent_at)
    if not sent_at:
        return 0
    elapsed = (datetime.now(timezone.utc) - sent_at).total_seconds()
    remaining = settings.email_verification_resend_seconds - int(elapsed)
    return max(0, remaining)


def ensure_smtp_is_configured() -> None:
    if not email_verification_is_enabled():
        return

    from_email = settings.smtp_from_email or settings.smtp_username
    if not settings.smtp_host or not from_email:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email verification is enabled, but SMTP is not configured",
        )


def deliver_verification_email(recipient_email: str, code: str) -> None:
    """Send a verification email. Safe to run as a background task.

    Errors are logged, not raised, since the response has already been sent.
    The user can request a resend if delivery fails.
    """
    if not email_verification_is_enabled():
        return

    from_email = settings.smtp_from_email or settings.smtp_username
    if not settings.smtp_host or not from_email:
        logger.error("SMTP is not configured; skipping verification email")
        return

    message = EmailMessage()
    message["Subject"] = "Код подтверждения регистрации"
    message["From"] = formataddr((settings.smtp_from_name, from_email))
    message["To"] = recipient_email
    message.set_content(
        "\n".join(
            [
                "Здравствуйте!",
                "",
                "Для завершения регистрации в GIS-платформе введите код:",
                "",
                code,
                "",
                f"Код действует {settings.email_verification_code_ttl_minutes} минут.",
                "Если вы не регистрировались, просто проигнорируйте это письмо.",
            ],
        ),
    )

    try:
        if settings.smtp_use_ssl:
            with smtplib.SMTP_SSL(
                settings.smtp_host,
                settings.smtp_port,
                timeout=settings.smtp_timeout_seconds,
            ) as smtp:
                _login_if_needed(smtp)
                smtp.send_message(message)
            return

        with smtplib.SMTP(
            settings.smtp_host,
            settings.smtp_port,
            timeout=settings.smtp_timeout_seconds,
        ) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            _login_if_needed(smtp)
            smtp.send_message(message)
    except Exception:
        logger.exception(
            "Failed to deliver verification email to %s", recipient_email,
        )


def optional_dev_code(code: str) -> str | None:
    if settings.email_verification_dev_return_code:
        return code
    return None


def _login_if_needed(smtp: smtplib.SMTP) -> None:
    if settings.smtp_username and settings.smtp_password:
        smtp.login(settings.smtp_username, settings.smtp_password)


def _as_aware_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
