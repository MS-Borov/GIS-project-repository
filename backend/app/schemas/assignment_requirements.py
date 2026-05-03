from datetime import datetime
from pydantic import BaseModel


class AssignmentRequirementsExtractRequest(BaseModel):
    source_doc_name: str | None = None
    source_text: str


class AssignmentRequirementsUpsert(BaseModel):
    source_doc_name: str | None = None
    source_text: str | None = None

    submission_format: str | None = "archive"
    deliverable_format: str | None = None
    expected_geometry_types: list[str] | None = None
    expected_crs: str | None = None
    required_attributes: list[str] | None = None
    topology_rules: list[str] | None = None

    expected_outputs_json: list[dict] | None = None

    needs_reference_layer: bool = False
    report_required: bool = False
    auto_checkable: bool = True

    extraction_status: str | None = None
    extraction_notes: str | None = None


class AssignmentRequirementsPatch(BaseModel):
    source_doc_name: str | None = None
    source_text: str | None = None

    submission_format: str | None = None
    deliverable_format: str | None = None
    expected_geometry_types: list[str] | None = None
    expected_crs: str | None = None
    required_attributes: list[str] | None = None
    topology_rules: list[str] | None = None

    expected_outputs_json: list[dict] | None = None

    needs_reference_layer: bool | None = None
    report_required: bool | None = None
    auto_checkable: bool | None = None

    extraction_status: str | None = None
    extraction_notes: str | None = None


class AssignmentRequirementsRead(BaseModel):
    id: int
    assignment_id: int

    source_doc_name: str | None = None
    source_text: str | None = None

    submission_format: str | None = None
    deliverable_format: str | None = None
    expected_geometry_types: list[str] | None = None
    expected_crs: str | None = None
    required_attributes: list[str] | None = None
    topology_rules: list[str] | None = None

    expected_outputs_json: list[dict] | None = None

    needs_reference_layer: bool
    report_required: bool
    auto_checkable: bool

    extraction_status: str | None = None
    extraction_notes: str | None = None

    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
