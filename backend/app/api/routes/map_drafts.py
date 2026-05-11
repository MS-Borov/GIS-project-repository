import json
from typing import Any

from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user, require_student
from app.core.config import settings
from app.db.session import get_db
from app.models.assignment import Assignment
from app.models.assignment_requirements import AssignmentRequirements
from app.models.course import CourseMember
from app.models.map_draft import MapDraft
from app.models.submission import Submission
from app.models.submission_asset import SubmissionAsset
from app.models.submission_check import SubmissionCheck
from app.models.user import User
from app.schemas.map_draft import MapDraftCreate, MapDraftRead, MapDraftUpdate
from app.schemas.submission import SubmissionRead
from app.services.asset_requirement_evaluator import evaluate_asset_against_requirements
from app.services.asset_validator import validate_asset_from_storage
from app.services.expected_output_evaluator import evaluate_asset_against_expected_output
from app.services.multi_layer_requirement_matcher import match_assets_to_expected_outputs
from app.services.multi_layer_summary_builder import build_multi_layer_summary
from app.services.storage import (
    build_asset_storage_key,
    build_map_draft_storage_key,
    build_submission_storage_key,
    get_s3_client,
    upload_bytes,
)

router = APIRouter(prefix="/map-drafts", tags=["map-drafts"])


def _to_submission_read(submission: Submission) -> SubmissionRead:
    return SubmissionRead(
        id=submission.id,
        assignment_id=submission.assignment_id,
        student_id=submission.student_id,
        original_filename=submission.original_filename,
        storage_key=submission.storage_key,
        content_type=submission.content_type,
        size_bytes=submission.size_bytes,
        status=submission.status,
        created_at=submission.created_at,
        download_url=f"/downloads/submissions/{submission.id}",
    )


def _feature_count(geojson: dict[str, Any]) -> int:
    if geojson.get("type") == "FeatureCollection":
        features = geojson.get("features")
        return len(features) if isinstance(features, list) else 0
    if geojson.get("type") == "Feature":
        return 1
    return 0


def _geojson_bytes(geojson: dict[str, Any]) -> bytes:
    return json.dumps(geojson, ensure_ascii=False).encode("utf-8")


def _read_storage_json(storage_key: str) -> dict[str, Any]:
    s3 = get_s3_client()
    try:
        obj = s3.get_object(Bucket=settings.s3_bucket_name, Key=storage_key)
        return json.loads(obj["Body"].read().decode("utf-8"))
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "unknown")
        raise HTTPException(status_code=404, detail=f"Draft GeoJSON object not found: {code}") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="Draft GeoJSON object is not valid JSON") from exc


def _ensure_student_assignment_access(assignment: Assignment, current_user: User, db: Session) -> None:
    if assignment.course_id is None:
        return

    membership = (
        db.query(CourseMember)
        .filter(CourseMember.course_id == assignment.course_id, CourseMember.user_id == current_user.id)
        .first()
    )
    if membership:
        return

    raise HTTPException(status_code=403, detail="Course membership required for this assignment")


def _ensure_teacher_assignment_access(assignment: Assignment, current_user: User, db: Session) -> None:
    if current_user.role == "admin":
        return
    if current_user.role != "teacher":
        raise HTTPException(status_code=403, detail="Teacher role required")
    if assignment.course_id is None:
        return

    membership = (
        db.query(CourseMember)
        .filter(
            CourseMember.course_id == assignment.course_id,
            CourseMember.user_id == current_user.id,
            CourseMember.role == "teacher",
        )
        .first()
    )
    if membership:
        return

    raise HTTPException(status_code=403, detail="Assignment access denied")


def _to_map_draft_read(draft: MapDraft, include_geojson: bool = False) -> MapDraftRead:
    return MapDraftRead(
        id=draft.id,
        assignment_id=draft.assignment_id,
        student_id=draft.student_id,
        last_submission_id=draft.last_submission_id,
        name=draft.name,
        geometry_type=draft.geometry_type,
        geojson_storage_key=draft.geojson_storage_key,
        feature_count=draft.feature_count,
        status=draft.status,
        created_at=draft.created_at,
        updated_at=draft.updated_at,
        geojson=_read_storage_json(draft.geojson_storage_key) if include_geojson else None,
    )


def _ensure_draft_owner(draft: MapDraft, current_user: User) -> None:
    if draft.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only draft owner can modify this draft")


def _evaluate_single_geojson_submission(
    *,
    db: Session,
    submission: Submission,
    asset: SubmissionAsset,
) -> None:
    validation = validate_asset_from_storage(asset)
    db.add(
        SubmissionCheck(
            submission_id=submission.id,
            submission_asset_id=asset.id,
            status=validation["status"],
            file_type=validation["file_type"],
            message=validation["message"],
            result_json={
                "mode": "technical_asset_validation",
                "detected_format": validation.get("detected_format"),
                "details": validation.get("details", {}),
            },
        )
    )
    asset.status = validation["status"]
    asset.message = validation["message"]
    asset.detected_format = validation["detected_format"]
    db.flush()

    requirements = (
        db.query(AssignmentRequirements)
        .filter(AssignmentRequirements.assignment_id == submission.assignment_id)
        .first()
    )
    expected_outputs = requirements.expected_outputs_json if requirements else None

    if expected_outputs:
        match_result = match_assets_to_expected_outputs([asset], expected_outputs=expected_outputs)
        output_evaluations = []
        for match in match_result["matches"]:
            expected_output = match["expected_output"]
            if match["asset_id"] is None:
                output_evaluation = {
                    "status": "failed",
                    "message": f"Asset for expected output '{expected_output.get('name')}' was not found.",
                    "result_json": {
                        "mode": "expected_output_missing",
                        "expected_output": expected_output,
                        "problems": [
                            {
                                "code": "expected_output_missing",
                                "message": f"Asset for expected output '{expected_output.get('name')}' was not found.",
                            }
                        ],
                        "warnings": [],
                        "passed_rules": [],
                    },
                }
                output_evaluations.append(
                    {
                        "expected_output": expected_output,
                        "asset_id": None,
                        "status": output_evaluation["status"],
                        "message": output_evaluation["message"],
                    }
                )
                db.add(
                    SubmissionCheck(
                        submission_id=submission.id,
                        submission_asset_id=None,
                        status=output_evaluation["status"],
                        file_type="requirements_output",
                        message=output_evaluation["message"],
                        result_json=output_evaluation["result_json"],
                    )
                )
                continue

            output_evaluation = evaluate_asset_against_expected_output(
                expected_output=expected_output,
                validation_result=validation,
            )
            output_evaluations.append(
                {
                    "expected_output": expected_output,
                    "asset_id": asset.id,
                    "asset_name": asset.asset_name,
                    "status": output_evaluation["status"],
                    "message": output_evaluation["message"],
                }
            )
            db.add(
                SubmissionCheck(
                    submission_id=submission.id,
                    submission_asset_id=asset.id,
                    status=output_evaluation["status"],
                    file_type="requirements_output",
                    message=output_evaluation["message"],
                    result_json=output_evaluation["result_json"],
                )
            )

        summary = build_multi_layer_summary(match_result=match_result, output_evaluations=output_evaluations)
        db.add(
            SubmissionCheck(
                submission_id=submission.id,
                submission_asset_id=None,
                status=summary["status"],
                file_type="requirements_summary",
                message=summary["message"],
                result_json=summary["result_json"],
            )
        )
    else:
        evaluation = evaluate_asset_against_requirements(
            requirements=requirements,
            validation_result=validation,
        )
        db.add(
            SubmissionCheck(
                submission_id=submission.id,
                submission_asset_id=asset.id,
                status=evaluation["status"],
                file_type="requirements",
                message=evaluation["message"],
                result_json=evaluation.get("result_json"),
            )
        )
        db.add(
            SubmissionCheck(
                submission_id=submission.id,
                submission_asset_id=None,
                status=evaluation["status"],
                file_type="requirements_summary",
                message=evaluation["message"],
                result_json=evaluation.get("result_json"),
            )
        )

    db.flush()
    checks = db.query(SubmissionCheck).filter(SubmissionCheck.submission_id == submission.id).all()
    statuses = {check.status.lower() for check in checks}
    if "failed" in statuses:
        submission.status = "failed"
    elif "warning" in statuses:
        submission.status = "warning"
    else:
        submission.status = "passed"


@router.get("/", response_model=list[MapDraftRead])
def list_map_drafts(
    assignment_id: int | None = Query(default=None),
    student_id: int | None = Query(default=None),
    include_geojson: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(MapDraft)

    if assignment_id is not None:
        assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
        if not assignment:
            raise HTTPException(status_code=404, detail="Assignment not found")
        if current_user.role == "student":
            _ensure_student_assignment_access(assignment, current_user, db)
        else:
            _ensure_teacher_assignment_access(assignment, current_user, db)
        query = query.filter(MapDraft.assignment_id == assignment_id)

    if current_user.role == "student":
        query = query.filter(MapDraft.student_id == current_user.id)
    elif current_user.role == "teacher" and assignment_id is None:
        teacher_assignment_ids = (
            db.query(Assignment.id)
            .join(CourseMember, Assignment.course_id == CourseMember.course_id)
            .filter(CourseMember.user_id == current_user.id, CourseMember.role == "teacher")
            .subquery()
        )
        query = query.filter(MapDraft.assignment_id.in_(teacher_assignment_ids))
    elif student_id is not None:
        query = query.filter(MapDraft.student_id == student_id)

    drafts = query.order_by(MapDraft.updated_at.desc(), MapDraft.id.desc()).all()
    return [_to_map_draft_read(draft, include_geojson=include_geojson) for draft in drafts]


@router.post("/", response_model=MapDraftRead, status_code=status.HTTP_201_CREATED)
def create_map_draft(
    payload: MapDraftCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    assignment = db.query(Assignment).filter(Assignment.id == payload.assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    _ensure_student_assignment_access(assignment, current_user, db)

    data = _geojson_bytes(payload.geojson)
    storage_key = build_map_draft_storage_key(current_user.id, assignment.id, payload.name)
    upload_bytes(storage_key, data, "application/geo+json")

    draft = MapDraft(
        assignment_id=assignment.id,
        student_id=current_user.id,
        name=payload.name.strip(),
        geometry_type=payload.geometry_type.strip() or "mixed",
        geojson_storage_key=storage_key,
        feature_count=_feature_count(payload.geojson),
        status="draft",
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return _to_map_draft_read(draft, include_geojson=True)


@router.get("/{draft_id}", response_model=MapDraftRead)
def get_map_draft(
    draft_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    draft = db.query(MapDraft).filter(MapDraft.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Map draft not found")
    if current_user.role == "student":
        _ensure_draft_owner(draft, current_user)
    else:
        _ensure_teacher_assignment_access(draft.assignment, current_user, db)

    return _to_map_draft_read(draft, include_geojson=True)


@router.patch("/{draft_id}", response_model=MapDraftRead)
def update_map_draft(
    draft_id: int,
    payload: MapDraftUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    draft = db.query(MapDraft).filter(MapDraft.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Map draft not found")
    _ensure_draft_owner(draft, current_user)

    if payload.name is not None:
        draft.name = payload.name.strip()
    if payload.geometry_type is not None:
        draft.geometry_type = payload.geometry_type.strip() or "mixed"
    if payload.geojson is not None:
        data = _geojson_bytes(payload.geojson)
        storage_key = build_map_draft_storage_key(current_user.id, draft.assignment_id, draft.name)
        upload_bytes(storage_key, data, "application/geo+json")
        draft.geojson_storage_key = storage_key
        draft.feature_count = _feature_count(payload.geojson)
        draft.status = "draft"

    db.commit()
    db.refresh(draft)
    return _to_map_draft_read(draft, include_geojson=True)


@router.post("/{draft_id}/submit", response_model=SubmissionRead, status_code=status.HTTP_201_CREATED)
def submit_map_draft(
    draft_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    draft = db.query(MapDraft).filter(MapDraft.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Map draft not found")
    _ensure_draft_owner(draft, current_user)
    _ensure_student_assignment_access(draft.assignment, current_user, db)

    geojson = _read_storage_json(draft.geojson_storage_key)
    data = _geojson_bytes(geojson)
    filename = f"{draft.name}.geojson" if not draft.name.lower().endswith(".geojson") else draft.name
    submission_key = build_submission_storage_key(filename)
    upload_bytes(submission_key, data, "application/geo+json")

    submission = Submission(
        assignment_id=draft.assignment_id,
        student_id=current_user.id,
        original_filename=filename,
        storage_key=submission_key,
        content_type="application/geo+json",
        size_bytes=len(data),
        status="uploaded",
    )
    db.add(submission)
    db.flush()

    asset_key = build_asset_storage_key(submission.id, filename)
    upload_bytes(asset_key, data, "application/geo+json")
    asset = SubmissionAsset(
        submission_id=submission.id,
        asset_name=filename,
        asset_type="layer",
        detected_format="geojson",
        status="uploaded",
        message="Draft GeoJSON submitted from map editor.",
        storage_key=asset_key,
        group_key=None,
    )
    db.add(asset)
    db.flush()

    _evaluate_single_geojson_submission(db=db, submission=submission, asset=asset)
    draft.status = "submitted"
    draft.last_submission_id = submission.id

    db.commit()
    db.refresh(submission)
    return _to_submission_read(submission)
