from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user, require_admin
from app.db.session import get_db
from app.models.user import User
from app.schemas.user import TokenRead, UserCreate, UserLogin, UserRead, UserRegister, UserUpdate
from app.services.auth import create_access_token, hash_password, normalize_email, verify_password
from app.services.rate_limit import build_rate_limit_key, enforce_rate_limit, get_client_ip

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenRead, status_code=status.HTTP_201_CREATED)
def register_user(
    payload: UserRegister,
    request: Request,
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
        raise HTTPException(status_code=409, detail="User already exists")

    user = User(
        email=email,
        full_name=payload.full_name,
        role="student",
        hashed_password=hash_password(payload.password),
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return TokenRead(
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

    return TokenRead(
        access_token=create_access_token(user_id=user.id, role=user.role),
        user=user,
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
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return user
