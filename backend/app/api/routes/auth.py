from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user, require_admin
from app.db.session import get_db
from app.models.user import User
from app.schemas.user import (
    EmailVerificationCheck,
    EmailVerificationResend,
    EmailVerificationResendRead,
    RegisterRead,
    TokenRead,
    UserCreate,
    UserLogin,
    UserRead,
    UserRegister,
    UserUpdate,
)
from app.services.auth import create_access_token, hash_password, normalize_email, verify_password
from app.services.email_verification import (
    apply_email_verification_code,
    create_email_verification_code,
    deliver_verification_email,
    email_verification_is_enabled,
    ensure_smtp_is_configured,
    mark_email_verified,
    optional_dev_code,
    seconds_until_resend_allowed,
    verify_email_code,
)
from app.services.rate_limit import build_rate_limit_key, enforce_rate_limit, get_client_ip

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=RegisterRead, status_code=status.HTTP_201_CREATED)
def register_user(
    payload: UserRegister,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    email = normalize_email(payload.email)
    enforce_rate_limit(
        build_rate_limit_key("auth-register", get_client_ip(request)),
        max_requests=3,
        window_seconds=600,
    )

    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        if existing_user.email_verified or not email_verification_is_enabled():
            raise HTTPException(status_code=409, detail="User already exists")

        remaining_seconds = seconds_until_resend_allowed(existing_user)
        if remaining_seconds > 0:
            raise HTTPException(
                status_code=429,
                detail=f"Verification code can be resent in {remaining_seconds} seconds",
                headers={"Retry-After": str(remaining_seconds)},
            )

        ensure_smtp_is_configured()
        code = create_email_verification_code()
        apply_email_verification_code(existing_user, code)
        db.commit()
        background_tasks.add_task(deliver_verification_email, existing_user.email, code)
        return RegisterRead(
            verification_required=True,
            email=existing_user.email,
            message="Verification code sent",
            dev_code=optional_dev_code(code),
        )

    if email_verification_is_enabled():
        ensure_smtp_is_configured()

    user = User(
        email=email,
        full_name=payload.full_name,
        role="student",
        hashed_password=hash_password(payload.password),
        is_active=True,
        email_verified=not email_verification_is_enabled(),
    )
    code: str | None = None
    if email_verification_is_enabled():
        code = create_email_verification_code()
        apply_email_verification_code(user, code)

    db.add(user)
    db.commit()
    db.refresh(user)

    if code:
        background_tasks.add_task(deliver_verification_email, user.email, code)
        return RegisterRead(
            verification_required=True,
            email=user.email,
            message="Verification code sent",
            dev_code=optional_dev_code(code),
        )

    return RegisterRead(
        access_token=create_access_token(user_id=user.id, role=user.role),
        user=user,
    )


@router.post("/bootstrap-admin", response_model=TokenRead, status_code=status.HTTP_201_CREATED)
def bootstrap_admin(
    payload: UserRegister,
    request: Request,
    db: Session = Depends(get_db),
):
    enforce_rate_limit(
        build_rate_limit_key("auth-bootstrap-admin", get_client_ip(request)),
        max_requests=3,
        window_seconds=600,
    )

    if db.query(User).count() > 0:
        raise HTTPException(status_code=409, detail="Bootstrap is available only before the first user is created")

    user = User(
        email=normalize_email(payload.email),
        full_name=payload.full_name,
        role="admin",
        hashed_password=hash_password(payload.password),
        is_active=True,
        email_verified=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return TokenRead(
        access_token=create_access_token(user_id=user.id, role=user.role),
        user=user,
    )


@router.post("/login", response_model=TokenRead)
def login_user(
    payload: UserLogin,
    request: Request,
    db: Session = Depends(get_db),
):
    email = normalize_email(payload.email)
    enforce_rate_limit(
        build_rate_limit_key("auth-login", get_client_ip(request), email),
        max_requests=5,
        window_seconds=60,
    )

    user = db.query(User).filter(User.email == email).first()
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User is inactive")
    if email_verification_is_enabled() and not user.email_verified:
        raise HTTPException(status_code=403, detail="Email is not verified")

    return TokenRead(
        access_token=create_access_token(user_id=user.id, role=user.role),
        user=user,
    )


@router.post("/verify-email", response_model=TokenRead)
def verify_email(
    payload: EmailVerificationCheck,
    request: Request,
    db: Session = Depends(get_db),
):
    email = normalize_email(payload.email)
    enforce_rate_limit(
        build_rate_limit_key("auth-verify-email", get_client_ip(request), email),
        max_requests=6,
        window_seconds=600,
    )

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.email_verified:
        raise HTTPException(
            status_code=409,
            detail="Email is already verified, please sign in with your password",
        )
    if not verify_email_code(user, payload.code):
        raise HTTPException(status_code=400, detail="Invalid or expired verification code")

    mark_email_verified(user)
    db.commit()
    db.refresh(user)

    return TokenRead(
        access_token=create_access_token(user_id=user.id, role=user.role),
        user=user,
    )


@router.post("/resend-verification", response_model=EmailVerificationResendRead)
def resend_email_verification(
    payload: EmailVerificationResend,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    email = normalize_email(payload.email)
    enforce_rate_limit(
        build_rate_limit_key("auth-resend-verification", get_client_ip(request), email),
        max_requests=4,
        window_seconds=600,
    )

    if not email_verification_is_enabled():
        return EmailVerificationResendRead(
            verification_required=False,
            email=email,
            message="Email verification is disabled",
        )

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.email_verified:
        return EmailVerificationResendRead(
            verification_required=False,
            email=email,
            message="Email is already verified",
        )

    remaining_seconds = seconds_until_resend_allowed(user)
    if remaining_seconds > 0:
        raise HTTPException(
            status_code=429,
            detail=f"Verification code can be resent in {remaining_seconds} seconds",
            headers={"Retry-After": str(remaining_seconds)},
        )

    ensure_smtp_is_configured()
    code = create_email_verification_code()
    apply_email_verification_code(user, code)
    db.commit()
    background_tasks.add_task(deliver_verification_email, user.email, code)

    return EmailVerificationResendRead(
        verification_required=True,
        email=email,
        message="Verification code sent",
        dev_code=optional_dev_code(code),
    )


@router.get("/me", response_model=UserRead)
def read_current_user(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserRead)
def update_current_user(
    payload: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.email is not None:
        email = normalize_email(payload.email)
        existing_user = db.query(User).filter(User.email == email, User.id != current_user.id).first()
        if existing_user:
            raise HTTPException(status_code=409, detail="User already exists")
        if email != current_user.email and email_verification_is_enabled():
            raise HTTPException(
                status_code=400,
                detail="Email change is disabled while verification is enabled",
            )
        current_user.email = email

    if payload.full_name is not None:
        current_user.full_name = payload.full_name.strip() or None

    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user_by_admin(
    payload: UserCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    email = normalize_email(payload.email)
    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        raise HTTPException(status_code=409, detail="User already exists")

    user = User(
        email=email,
        full_name=payload.full_name,
        role=payload.role,
        hashed_password=hash_password(payload.password),
        is_active=payload.is_active,
        email_verified=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return user
