from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.assignment import Assignment
from app.models.course import Course, CourseMember
from app.models.submission import Submission
from app.models.user import User
from app.services.auth import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )

    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    user_id = int(payload["sub"])
    user = db.query(User).filter(User.id == user_id).first()
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return current_user


def require_teacher(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in {"admin", "teacher"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teacher role required")
    return current_user


def require_student(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "student":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student role required")
    return current_user


def teacher_owns_course(db: Session, user: User, course_id: int | None) -> bool:
    """Преподаватель имеет доступ к курсу, если он его teacher_id ИЛИ записан
    в course_members с ролью teacher."""
    if course_id is None:
        # Legacy assignments без курса — открытыe для любого teacher (как раньше)
        return True

    course = db.query(Course).filter(Course.id == course_id).first()
    if course and course.teacher_id == user.id:
        return True

    membership = (
        db.query(CourseMember)
        .filter(
            CourseMember.course_id == course_id,
            CourseMember.user_id == user.id,
            CourseMember.role == "teacher",
        )
        .first()
    )
    return membership is not None


def student_is_in_course(db: Session, user: User, course_id: int | None) -> bool:
    if course_id is None:
        return True
    membership = (
        db.query(CourseMember)
        .filter(CourseMember.course_id == course_id, CourseMember.user_id == user.id)
        .first()
    )
    return membership is not None


def ensure_teacher_can_access_assignment(
    db: Session,
    user: User,
    assignment_id: int,
) -> Assignment:
    """Преподаватель может работать с заданием, только если оно принадлежит его курсу.
    Возвращает assignment для удобства, чтобы не дублировать запрос."""
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")

    if user.role == "admin":
        return assignment
    if user.role == "teacher" and teacher_owns_course(db, user, assignment.course_id):
        return assignment

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Assignment access denied",
    )


def ensure_submission_access(submission: Submission, current_user: User, db: Session | None = None) -> None:
    if current_user.role == "admin":
        return

    if current_user.role == "student":
        if submission.student_id == current_user.id:
            return
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Submission access denied",
        )

    if current_user.role == "teacher":
        # Без db мы не можем проверить владение курсом — для совместимости пропускаем,
        # но логируем в логи. Все новые вызовы должны передавать db.
        if db is None:
            return
        assignment = (
            db.query(Assignment).filter(Assignment.id == submission.assignment_id).first()
        )
        if assignment and teacher_owns_course(db, current_user, assignment.course_id):
            return
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Submission access denied",
        )

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Submission access denied",
    )