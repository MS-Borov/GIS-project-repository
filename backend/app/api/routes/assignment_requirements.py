from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.assignment import Assignment
from app.models.assignment_requirements import AssignmentRequirements
from app.schemas.assignment_requirements import (
    AssignmentRequirementsRead,
    AssignmentRequirementsUpsert,
)
from app.services.assignment_requirement_extractor import extract_requirements_from_text

router = APIRouter(prefix="/assignments", tags=["assignment-requirements"])


@router.get(
    "/{assignment_id}/requirements",
    response_model=AssignmentRequirementsRead,
)

def get_assignment_requirements(
    assignment_id: int,
    db: Session = Depends(get_db),
):
    requirements = (
        db.query(AssignmentRequirements)
        .filter(AssignmentRequirements.assignment_id == assignment_id)
        .first()
    )

    if not requirements:
        raise HTTPException(status_code=404, detail="Requirements not found")
    return requirements

@router.put(
    "/{assignment_id}/requirements",
    response_model=AssignmentRequirementsRead,
)

def upsert_assignment_requirements(
    assignment_id: int,
    payload: AssignmentRequirementsUpsert,
    db: Session = Depends(get_db),
):
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    
    requirements = (
        db.query(AssignmentRequirements)
        .filter(AssignmentRequirements.assignment_id == assignment_id)
        .first()
    )

    if requirements is None:
        requirements = AssignmentRequirements(
            assignment_id=assignment_id,
        )
        db.add(requirements)
    
    requirements.source_doc_name = payload.source_doc_name
    requirements.source_text = payload.source_text

    requirements.deliverable_format = payload.deliverable_format
    requirements.expected_geometry_types = payload.expected_geometry_types
    requirements.expected_crs = payload.expected_crs

    requirements.required_attributes = payload.required_attributes
    requirements.topology_rules = payload.topology_rules

    requirements.needs_reference_layer = payload.needs_reference_layer
    requirements.report_required = payload.report_required

    requirements.auto_checkable = payload.auto_checkable
    requirements.extraction_status = payload.extraction_status
    requirements.extraction_notes = payload.extraction_notes

    db.commit()
    db.refresh(requirements)

    return requirements

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.assignment import Assignment
from app.models.assignment_requirements import AssignmentRequirements
from app.schemas.assignment_requirements import (
    AssignmentRequirementsExtractRequest,
    AssignmentRequirementsRead,
    AssignmentRequirementsUpsert,
)
from app.services.assignment_requirement_extractor import extract_requirements_from_text

router = APIRouter(prefix="/assignments", tags=["assignment-requirements"])


@router.get(
    "/{assignment_id}/requirements",
    response_model=AssignmentRequirementsRead,
)
def get_assignment_requirements(
    assignment_id: int,
    db: Session = Depends(get_db),
):
    requirements = (
        db.query(AssignmentRequirements)
        .filter(AssignmentRequirements.assignment_id == assignment_id)
        .first()
    )

    if not requirements:
        raise HTTPException(status_code=404, detail="Requirements not found")

    return requirements


@router.put(
    "/{assignment_id}/requirements",
    response_model=AssignmentRequirementsRead,
)
def upsert_assignment_requirements(
    assignment_id: int,
    payload: AssignmentRequirementsUpsert,
    db: Session = Depends(get_db),
):
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    requirements = (
        db.query(AssignmentRequirements)
        .filter(AssignmentRequirements.assignment_id == assignment_id)
        .first()
    )

    if requirements is None:
        requirements = AssignmentRequirements(
            assignment_id=assignment_id,
        )
        db.add(requirements)

    requirements.source_doc_name = payload.source_doc_name
    requirements.source_text = payload.source_text

    requirements.deliverable_format = payload.deliverable_format
    requirements.expected_geometry_types = payload.expected_geometry_types
    requirements.expected_crs = payload.expected_crs

    requirements.required_attributes = payload.required_attributes
    requirements.topology_rules = payload.topology_rules

    requirements.needs_reference_layer = payload.needs_reference_layer
    requirements.report_required = payload.report_required

    requirements.auto_checkable = payload.auto_checkable
    requirements.extraction_status = payload.extraction_status
    requirements.extraction_notes = payload.extraction_notes

    db.commit()
    db.refresh(requirements)

    return requirements


@router.post(
    "/{assignment_id}/requirements/extract",
    response_model=AssignmentRequirementsRead,
)
def extract_assignment_requirements(
    assignment_id: int,
    payload: AssignmentRequirementsExtractRequest,
    db: Session = Depends(get_db),
):
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    extracted = extract_requirements_from_text(
        text=payload.source_text,
        source_doc_name=payload.source_doc_name,
    )

    requirements = (
        db.query(AssignmentRequirements)
        .filter(AssignmentRequirements.assignment_id == assignment_id)
        .first()
    )

    if requirements is None:
        requirements = AssignmentRequirements(assignment_id=assignment_id)
        db.add(requirements)

    requirements.source_doc_name = extracted["source_doc_name"]
    requirements.source_text = extracted["source_text"]

    requirements.deliverable_format = extracted["deliverable_format"]
    requirements.expected_geometry_types = extracted["expected_geometry_types"]
    requirements.expected_crs = extracted["expected_crs"]

    requirements.required_attributes = extracted["required_attributes"]
    requirements.topology_rules = extracted["topology_rules"]

    requirements.needs_reference_layer = extracted["needs_reference_layer"]
    requirements.report_required = extracted["report_required"]
    requirements.auto_checkable = extracted["auto_checkable"]

    requirements.extraction_status = extracted["extraction_status"]
    requirements.extraction_notes = extracted["extraction_notes"]

    db.commit()
    db.refresh(requirements)

    return requirements