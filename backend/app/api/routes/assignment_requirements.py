from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

from app.api.deps.auth import require_teacher
from app.db.session import get_db
from app.models.assignment import Assignment
from app.models.assignment_requirements import AssignmentRequirements
from app.models.user import User
from app.schemas.assignment_requirements import (
    AssignmentRequirementsExtractRequest,
    AssignmentRequirementsPatch,
    AssignmentRequirementsRead,
    AssignmentRequirementsUpsert,
)
from app.services.assignment_llm_extractor import extract_requirements_from_assignment_document
from app.services.assignment_requirement_extractor import extract_requirements_from_text
from app.services.document_text_extractor import extract_document_text
from app.services.rate_limit import build_rate_limit_key, enforce_rate_limit, get_client_ip

router = APIRouter(prefix="/assignments", tags=["assignment-requirements"])


@router.get(
    "/{assignment_id}/requirements",
    response_model=AssignmentRequirementsRead,
)
def get_assignment_requirements(
    assignment_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_teacher),
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
    _: User = Depends(require_teacher),
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
        requirements = AssignmentRequirements(assignment_id=assignment_id)
        db.add(requirements)

    requirements.source_doc_name = payload.source_doc_name
    requirements.source_text = payload.source_text
    requirements.submission_format = payload.submission_format
    requirements.deliverable_format = payload.deliverable_format
    requirements.expected_geometry_types = payload.expected_geometry_types
    requirements.expected_crs = payload.expected_crs
    requirements.required_attributes = payload.required_attributes
    requirements.topology_rules = payload.topology_rules

    # ВАЖНО: в прошлой версии это поле не сохранялось при PUT
    requirements.expected_outputs_json = payload.expected_outputs_json

    requirements.needs_reference_layer = payload.needs_reference_layer
    requirements.report_required = payload.report_required
    requirements.auto_checkable = payload.auto_checkable
    requirements.extraction_status = payload.extraction_status
    requirements.extraction_notes = payload.extraction_notes

    db.commit()
    db.refresh(requirements)

    return requirements


@router.patch(
    "/{assignment_id}/requirements",
    response_model=AssignmentRequirementsRead,
)
def patch_assignment_requirements(
    assignment_id: int,
    payload: AssignmentRequirementsPatch,
    db: Session = Depends(get_db),
    _: User = Depends(require_teacher),
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
        requirements = AssignmentRequirements(assignment_id=assignment_id)
        db.add(requirements)

    allowed_fields = {
        "source_doc_name",
        "source_text",
        "submission_format",
        "deliverable_format",
        "expected_geometry_types",
        "expected_crs",
        "required_attributes",
        "topology_rules",
        "expected_outputs_json",
        "needs_reference_layer",
        "report_required",
        "auto_checkable",
        "extraction_status",
        "extraction_notes",
    }

    for field_name in payload.model_fields_set & allowed_fields:
        setattr(requirements, field_name, getattr(payload, field_name))

    db.commit()
    db.refresh(requirements)

    return requirements


@router.post(
    "/{assignment_id}/requirements/extract",
    response_model=AssignmentRequirementsRead,
)
def extract_assignment_requirements_from_text(
    request: Request,
    assignment_id: int,
    payload: AssignmentRequirementsExtractRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    enforce_rate_limit(
        build_rate_limit_key("requirements-extract", get_client_ip(request), str(current_user.id)),
        max_requests=5,
        window_seconds=600,
    )

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

    _apply_extracted_requirements(requirements, extracted)

    db.commit()
    db.refresh(requirements)

    return requirements


@router.post(
    "/{assignment_id}/requirements/extract-from-file",
    response_model=AssignmentRequirementsRead,
)
def extract_assignment_requirements_from_file(
    request: Request,
    assignment_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    """
    Основной сценарий для преподавателя:
    загружается файл задания, система извлекает текст
    и создаёт draft requirements, включая expected_outputs_json.
    """
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    enforce_rate_limit(
        build_rate_limit_key("requirements-extract-file", get_client_ip(request), str(current_user.id)),
        max_requests=5,
        window_seconds=600,
    )

    file_bytes = file.file.read()

    document = extract_document_text(
        filename=file.filename,
        file_bytes=file_bytes,
    )

    if not document["can_analyze"]:
        raise HTTPException(
            status_code=400,
            detail=document["message"],
        )

    extracted = extract_requirements_from_assignment_document(
        text=document["text"],
        source_doc_name=file.filename,
    )

    requirements = (
        db.query(AssignmentRequirements)
        .filter(AssignmentRequirements.assignment_id == assignment_id)
        .first()
    )

    if requirements is None:
        requirements = AssignmentRequirements(assignment_id=assignment_id)
        db.add(requirements)

    _apply_extracted_requirements(requirements, extracted)

    db.commit()
    db.refresh(requirements)

    return requirements


def _apply_extracted_requirements(requirements: AssignmentRequirements, extracted: dict) -> None:
    requirements.source_doc_name = extracted.get("source_doc_name")
    requirements.source_text = extracted.get("source_text")

    requirements.submission_format = extracted.get("submission_format", "archive")
    requirements.deliverable_format = extracted.get("deliverable_format")
    requirements.expected_geometry_types = extracted.get("expected_geometry_types")
    requirements.expected_crs = extracted.get("expected_crs")
    requirements.required_attributes = extracted.get("required_attributes")
    requirements.topology_rules = extracted.get("topology_rules")

    requirements.expected_outputs_json = extracted.get("expected_outputs_json")

    requirements.needs_reference_layer = extracted.get("needs_reference_layer", False)
    requirements.report_required = extracted.get("report_required", False)
    requirements.auto_checkable = extracted.get("auto_checkable", True)
    requirements.extraction_status = extracted.get("extraction_status", "draft")
    requirements.extraction_notes = extracted.get("extraction_notes")
