from datetime import datetime

from pydantic import BaseModel, Field

class AssignmentRequirementsUpsert(BaseModel):
    source_doc_name: str | None = None
    source_text: str | None = None

    deliverable_format: str | None = Field(
        default=None,
        description="Например: geojson, shapefile_zip, txt, docx",
    )

    expected_geometry_types: list[str] | None = None
    expected_crs: str | None = None

    required_attributes: list[str] | None = None
    topology_rules: list[str] | None = None

    needs_reference_layer: bool = False
    report_required: bool = False

    auto_checkable: bool = True

    extraction_status: str = "draft"
    extraction_notes: str | None = None

class AssignmentRequirementsRead(BaseModel):
    id: int
    assignment_id: int

    source_doc_name: str | None = None
    source_text: str | None = None

    deliverable_format: str | None = None
    expected_geometry_types: list[str] | None = None
    expected_crs: str | None = None

    required_attributes: list[str] | None = None
    topology_rules: list[str] | None = None

    needs_reference_layer: bool 
    report_required: bool
    auto_checkable: bool

    extraction_status: str 
    extraction_notes: str | None = None

    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

class AssignmentRequirementsExtractRequest(BaseModel):
    source_text: str
    source_doc_name: str | None = None

class AssignmentRequirementsExtractResponse(AssignmentRequirementsRead):
    pass




