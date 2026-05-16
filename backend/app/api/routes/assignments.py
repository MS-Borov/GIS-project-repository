import json
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user, require_teacher
from app.db.session import get_db
from app.models.assignment import Assignment
from app.models.assignment_material import AssignmentMaterial
from app.models.course import Course, CourseMember
from app.models.user import User
from app.schemas.assignment import AssignmentCreate, AssignmentRead
from app.schemas.assignment_material import AssignmentMaterialRead
from app.services.storage import build_assignment_material_storage_key, upload_bytes
from app.services.qgis_project_parser import extract_qgis_project_metadata_from_archive
from app.services.submission_archive_parser import parse_submission_archive
from app.services.submission_validator import validate_submission_file

router = APIRouter(prefix="/assignments", tags=["assignments"])


def _layer_key(value: str | None) -> str:
    if not value:
        return ""
    return Path(str(value).replace("\\", "/").split("|", 1)[0]).stem.lower()


def _filter_assets_by_qgis_project(layer_assets: list[dict], qgis_project: dict | None) -> list[dict]:
    project_layers = qgis_project.get("layers", []) if qgis_project else []
    project_keys = {
        key
        for layer in project_layers
        for key in (
            _layer_key(layer.get("source_basename")),
            _layer_key(layer.get("name")),
            _layer_key(layer.get("source")),
        )
        if key
    }
    if not project_keys:
        return layer_assets
    matched_assets = [
        asset
        for asset in layer_assets
        if _layer_key(asset.get("group_key") or asset.get("asset_name")) in project_keys
    ]
    return matched_assets or layer_assets


def _can_manage_assignment(assignment: Assignment, user: User, db: Session) -> bool:
    if user.role == "admin":
        return True
    if user.role != "teacher":
        return False
    if assignment.course_id is None:
        return True

    course = db.query(Course).filter(Course.id == assignment.course_id).first()
    return bool(course and course.teacher_id == user.id)


def _ensure_assignment_access(assignment: Assignment, user: User, db: Session) -> None:
    if _can_manage_assignment(assignment, user, db):
        return
    if user.role == "student":
        if assignment.course_id is None:
            return
        membership = (
            db.query(CourseMember)
            .filter(CourseMember.course_id == assignment.course_id, CourseMember.user_id == user.id)
            .first()
        )
        if membership:
            return
    raise HTTPException(status_code=403, detail="Assignment access denied")


def _to_material_read(material: AssignmentMaterial) -> AssignmentMaterialRead:
    return AssignmentMaterialRead(
        id=material.id,
        assignment_id=material.assignment_id,
        material_name=material.material_name,
        material_type=material.material_type,
        detected_format=material.detected_format,
        status=material.status,
        message=material.message,
        storage_key=material.storage_key,
        created_at=material.created_at,
        updated_at=material.updated_at,
        download_url=f"/downloads/assignment-materials/{material.id}",
    )


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


@router.get("/{assignment_id}", response_model=AssignmentRead)
def get_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    _ensure_assignment_access(assignment, current_user, db)
    return assignment


@router.get("/{assignment_id}/materials", response_model=list[AssignmentMaterialRead])
def list_assignment_materials(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    _ensure_assignment_access(assignment, current_user, db)

    materials = (
        db.query(AssignmentMaterial)
        .filter(AssignmentMaterial.assignment_id == assignment_id)
        .order_by(AssignmentMaterial.id.asc())
        .all()
    )
    return [_to_material_read(material) for material in materials]


@router.post("/{assignment_id}/materials", response_model=list[AssignmentMaterialRead], status_code=status.HTTP_201_CREATED)
def upload_assignment_material(
    assignment_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if not _can_manage_assignment(assignment, current_user, db):
        raise HTTPException(status_code=403, detail="Assignment manager role required")

    file_bytes = file.file.read()
    validation = validate_submission_file(file.filename, file_bytes)
    if validation["detected_format"] not in {"geojson", "shapefile_zip"}:
        raise HTTPException(status_code=422, detail="Only GeoJSON and shapefile ZIP materials are supported for map workspace")

    materials_to_create = []

    if file.filename.lower().endswith(".zip"):
        parsed_assets = parse_submission_archive(file_bytes)
        qgis_project = extract_qgis_project_metadata_from_archive(file_bytes)
        layer_assets = [
            asset
            for asset in parsed_assets
            if asset.get("asset_type") == "layer"
            and asset.get("detected_format") in {"geojson", "shapefile_zip"}
            and asset.get("file_bytes") is not None
        ]
        layer_assets = _filter_assets_by_qgis_project(layer_assets, qgis_project)

        if not layer_assets:
            raise HTTPException(status_code=422, detail="ZIP не содержит GeoJSON или shapefile-слои для карты")

        seen_layer_names: set[str] = set()
        for asset in layer_assets:
            layer_key = str(asset["asset_name"]).lower()
            if layer_key in seen_layer_names:
                continue
            seen_layer_names.add(layer_key)
            storage_key = build_assignment_material_storage_key(assignment_id, asset["asset_name"])
            upload_bytes(storage_key, asset["file_bytes"], "application/octet-stream")
            materials_to_create.append(
                AssignmentMaterial(
                    assignment_id=assignment_id,
                    material_name=asset["asset_name"],
                    material_type="layer",
                    detected_format=asset["detected_format"],
                    status=asset["status"],
                    message=asset["message"],
                    storage_key=storage_key,
                )
            )
        if qgis_project:
            project_name = f"{qgis_project.get('project_name') or file.filename}.qgis-project.json"
            storage_key = build_assignment_material_storage_key(assignment_id, project_name)
            upload_bytes(
                storage_key,
                json.dumps(qgis_project, ensure_ascii=False).encode("utf-8"),
                "application/json",
            )
            materials_to_create.append(
                AssignmentMaterial(
                    assignment_id=assignment_id,
                    material_name=project_name,
                    material_type="qgis_project",
                    detected_format="qgis_project",
                    status="uploaded",
                    message="QGIS project metadata recognized.",
                    storage_key=storage_key,
                )
            )
    else:
        storage_key = build_assignment_material_storage_key(assignment_id, file.filename)
        upload_bytes(storage_key, file_bytes, file.content_type or "application/octet-stream")
        materials_to_create.append(
            AssignmentMaterial(
                assignment_id=assignment_id,
                material_name=file.filename,
                material_type="layer",
                detected_format=validation["detected_format"],
                status=validation["status"],
                message=validation["message"],
                storage_key=storage_key,
            )
        )

    for material in materials_to_create:
        existing_materials = (
            db.query(AssignmentMaterial)
            .filter(
                AssignmentMaterial.assignment_id == assignment_id,
                AssignmentMaterial.material_name == material.material_name,
                AssignmentMaterial.detected_format == material.detected_format,
            )
            .all()
        )
        for existing_material in existing_materials:
            db.delete(existing_material)
        db.add(material)

    db.commit()
    for material in materials_to_create:
        db.refresh(material)
    return [_to_material_read(material) for material in materials_to_create]
