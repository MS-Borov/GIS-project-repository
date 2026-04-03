from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.assignment import Assignment
from app.schemas.assignment import AssignmentCreate, AssignmentRead

router = APIRouter(prefix="/assignments", tags=["assignments"])


@router.get("/", response_model=list[AssignmentRead])
def list_assignments(db: Session = Depends(get_db)):
    assignments = db.query(Assignment).order_by(Assignment.id.desc()).all()
    return assignments


@router.post("/", response_model=AssignmentRead, status_code=status.HTTP_201_CREATED)
def create_assignment(payload: AssignmentCreate, db: Session = Depends(get_db)):
    assignment = Assignment(
        title=payload.title,
        description=payload.description,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return assignment