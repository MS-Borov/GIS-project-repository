from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user, require_teacher
from app.db.session import get_db
from app.models.course import Course, CourseMember
from app.models.user import User
from app.schemas.course import CourseCreate, CourseMemberCreate, CourseMemberRead, CourseRead, CourseUpdate
from app.services.auth import normalize_email

router = APIRouter(prefix="/courses", tags=["courses"])


def _can_manage_course(course: Course, user: User) -> bool:
    return user.role == "admin" or (user.role == "teacher" and course.teacher_id == user.id)


def _ensure_course_access(course: Course, user: User, db: Session) -> None:
    if _can_manage_course(course, user):
        return

    membership = (
        db.query(CourseMember)
        .filter(CourseMember.course_id == course.id, CourseMember.user_id == user.id)
        .first()
    )
    if membership:
        return

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Course access denied")


def _ensure_course_manager(course: Course, user: User) -> None:
    if not _can_manage_course(course, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Course manager role required")


@router.get("/", response_model=list[CourseRead])
def list_courses(
    include_archived: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Course)

    if current_user.role == "teacher":
        query = query.filter(Course.teacher_id == current_user.id)
    elif current_user.role == "student":
        course_ids = (
            db.query(CourseMember.course_id)
            .filter(CourseMember.user_id == current_user.id)
            .subquery()
        )
        query = query.filter(Course.id.in_(course_ids))

    if not include_archived:
        query = query.filter(Course.archived.is_(False))

    return query.order_by(Course.id.desc()).all()


@router.post("/", response_model=CourseRead, status_code=status.HTTP_201_CREATED)
def create_course(
    payload: CourseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    course = Course(
        title=payload.title,
        description=payload.description,
        teacher_id=current_user.id,
        archived=False,
    )
    db.add(course)
    db.flush()
    db.add(CourseMember(course_id=course.id, user_id=current_user.id, role="teacher"))
    db.commit()
    db.refresh(course)
    return course


@router.patch("/{course_id}", response_model=CourseRead)
def update_course(
    course_id: int,
    payload: CourseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    _ensure_course_manager(course, current_user)

    if payload.title is not None:
        course.title = payload.title
    if payload.description is not None:
        course.description = payload.description
    if payload.archived is not None:
        course.archived = payload.archived

    db.commit()
    db.refresh(course)
    return course


@router.get("/{course_id}/members", response_model=list[CourseMemberRead])
def list_course_members(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    _ensure_course_access(course, current_user, db)

    return (
        db.query(CourseMember)
        .filter(CourseMember.course_id == course_id)
        .order_by(CourseMember.id.asc())
        .all()
    )


@router.post("/{course_id}/members", response_model=CourseMemberRead, status_code=status.HTTP_201_CREATED)
def add_course_member(
    course_id: int,
    payload: CourseMemberCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    _ensure_course_manager(course, current_user)

    if payload.user_id is None and payload.email is None:
        raise HTTPException(status_code=422, detail="Either user_id or email is required")

    if payload.email is not None:
        user = db.query(User).filter(User.email == normalize_email(payload.email)).first()
    else:
        user = db.query(User).filter(User.id == payload.user_id).first()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    existing_member = (
        db.query(CourseMember)
        .filter(CourseMember.course_id == course_id, CourseMember.user_id == user.id)
        .first()
    )
    if existing_member:
        existing_member.role = payload.role
        db.commit()
        db.refresh(existing_member)
        return existing_member

    member = CourseMember(course_id=course_id, user_id=user.id, role=payload.role)
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.delete("/{course_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_course_member(
    course_id: int,
    member_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    _ensure_course_manager(course, current_user)

    member = (
        db.query(CourseMember)
        .filter(CourseMember.id == member_id, CourseMember.course_id == course_id)
        .first()
    )
    if not member:
        raise HTTPException(status_code=404, detail="Course member not found")

    if member.user_id == course.teacher_id:
        raise HTTPException(status_code=409, detail="Course owner cannot be removed from members")

    db.delete(member)
    db.commit()
    return None
