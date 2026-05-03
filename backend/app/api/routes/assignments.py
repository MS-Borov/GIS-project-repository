from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user, require_teacher
from app.db.session import get_db
from app.models.assignment import Assignment
from app.models.course import Course, CourseMember
from app.models.user import User
from app.schemas.assignment import AssignmentCreate, AssignmentRead

router = APIRouter(prefix="/assignments", tags=["assignments"])


@router.get("/", response_model=list[AssignmentRead])
def list_assignments(
    course_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Assignment)

    if course_id is not None:
        course = db.query(Course).filter(Course.id == course_id).first()
        if not course:
            raise HTTPException(status_code=404, detail="Course not found")

        if current_user.role == "student":
            membership = (
                db.query(CourseMember)
                .filter(CourseMember.course_id == course_id, CourseMember.user_id == current_user.id)
                .first()
            )
            if not membership:
                raise HTTPException(status_code=403, detail="Course access denied")
        elif current_user.role == "teacher" and course.teacher_id != current_user.id:
            raise HTTPException(status_code=403, detail="Course access denied")

        query = query.filter(Assignment.course_id == course_id)
    elif current_user.role == "teacher":
        teacher_course_ids = (
            db.query(Course.id)
            .filter(Course.teacher_id == current_user.id)
            .subquery()
        )
        query = query.filter(or_(Assignment.course_id.in_(teacher_course_ids), Assignment.course_id.is_(None)))
    elif current_user.role == "student":
        member_course_ids = (
            db.query(CourseMember.course_id)
            .filter(CourseMember.user_id == current_user.id)
            .subquery()
        )
        query = query.filter(or_(Assignment.course_id.in_(member_course_ids), Assignment.course_id.is_(None)))

    assignments = query.order_by(Assignment.id.desc()).all()
    return assignments


@router.post("/", response_model=AssignmentRead, status_code=status.HTTP_201_CREATED)
def create_assignment(
    payload: AssignmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    if payload.course_id is not None:
        course = db.query(Course).filter(Course.id == payload.course_id).first()
        if not course:
            raise HTTPException(status_code=404, detail="Course not found")
        if current_user.role != "admin" and course.teacher_id != current_user.id:
            raise HTTPException(status_code=403, detail="Course access denied")

    assignment = Assignment(
        course_id=payload.course_id,
        title=payload.title,
        description=payload.description,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return assignment
