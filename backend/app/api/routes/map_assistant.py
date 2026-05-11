import json
import socket
import urllib.error
import urllib.request
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps.auth import get_current_user
from app.core.config import settings
from app.models.user import User

router = APIRouter(prefix="/map-assistant", tags=["map-assistant"])


class SegmentBoxRequest(BaseModel):
    assignment_id: int | None = None
    draft_layer_id: int | None = None
    image_data: str = Field(..., description="Base64 image data or data URL.")
    bbox_pixels: list[float] = Field(..., min_length=4, max_length=4)
    image_size: list[int] | None = Field(default=None, min_length=2, max_length=2)
    image_extent: list[float] | None = Field(
        default=None,
        min_length=4,
        max_length=4,
        description="Map extent of the image as [minx, miny, maxx, maxy].",
    )
    prompt_geometry: dict[str, Any] | None = None
    target_geometry_type: Literal["polygon", "line", "point"] = "polygon"


class SegmentBoxResponse(BaseModel):
    status: str
    geometry: dict[str, Any]
    confidence: float
    message: str
    meta: dict[str, Any] = {}


def _pixel_to_map(
    point: tuple[float, float],
    image_size: list[int],
    image_extent: list[float],
) -> list[float]:
    x, y = point
    width, height = image_size
    minx, miny, maxx, maxy = image_extent
    map_x = minx + (x / width) * (maxx - minx)
    map_y = maxy - (y / height) * (maxy - miny)
    return [map_x, map_y]


def _fallback_bbox_geometry(payload: SegmentBoxRequest) -> dict[str, Any] | None:
    if not payload.image_size or not payload.image_extent:
        return None

    x1, y1, x2, y2 = payload.bbox_pixels
    left, right = min(x1, x2), max(x1, x2)
    top, bottom = min(y1, y2), max(y1, y2)
    ring = [
        _pixel_to_map((left, top), payload.image_size, payload.image_extent),
        _pixel_to_map((right, top), payload.image_size, payload.image_extent),
        _pixel_to_map((right, bottom), payload.image_size, payload.image_extent),
        _pixel_to_map((left, bottom), payload.image_size, payload.image_extent),
        _pixel_to_map((left, top), payload.image_size, payload.image_extent),
    ]
    return {"type": "Polygon", "coordinates": [ring]}


@router.post("/segment-box", response_model=SegmentBoxResponse)
def segment_box(
    payload: SegmentBoxRequest,
    current_user: User = Depends(get_current_user),
) -> SegmentBoxResponse:
    del current_user
    url = f"{settings.ai_digitizer_url.rstrip('/')}/segment-box"
    data = json.dumps(payload.model_dump(exclude_none=True), ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=settings.ai_digitizer_timeout_seconds) as response:
            response_data = json.loads(response.read().decode("utf-8"))
            return SegmentBoxResponse(**response_data)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=502, detail=f"AI digitizer returned {exc.code}: {detail}") from exc
    except (urllib.error.URLError, socket.timeout, TimeoutError) as exc:
        fallback = _fallback_bbox_geometry(payload)
        if fallback is None:
            raise HTTPException(status_code=503, detail=f"AI digitizer service is unavailable: {exc}") from exc
        return SegmentBoxResponse(
            status="fallback",
            geometry=fallback,
            confidence=0.15,
            message="AI digitizer service is unavailable. Returned the selected box as a draft polygon.",
            meta={"backend": "backend-fallback", "reason": str(exc)},
        )
