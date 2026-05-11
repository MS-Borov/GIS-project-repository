import base64
import binascii
from io import BytesIO
from typing import Literal

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field


app = FastAPI(title="GIS AI Digitizer Service")


class SegmentBoxRequest(BaseModel):
    image_data: str = Field(..., description="Base64 image data or data URL.")
    bbox_pixels: list[float] = Field(..., min_length=4, max_length=4)
    image_extent: list[float] | None = Field(
        default=None,
        min_length=4,
        max_length=4,
        description="Map extent of the image as [minx, miny, maxx, maxy].",
    )
    prompt_geometry: dict | None = None
    target_geometry_type: Literal["polygon", "line", "point"] = "polygon"


class SegmentBoxResponse(BaseModel):
    status: Literal["passed", "fallback"]
    geometry: dict
    confidence: float
    message: str
    meta: dict


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _decode_image(image_data: str) -> Image.Image:
    if "," in image_data and image_data.strip().lower().startswith("data:"):
        image_data = image_data.split(",", 1)[1]

    try:
        raw = base64.b64decode(image_data, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=422, detail="image_data is not valid base64") from exc

    try:
        return Image.open(BytesIO(raw)).convert("RGB")
    except UnidentifiedImageError as exc:
        raise HTTPException(status_code=422, detail="image_data is not a supported image") from exc


def _clip_bbox(bbox: list[float], width: int, height: int) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = bbox
    left = max(0, min(width - 1, int(round(min(x1, x2)))))
    right = max(0, min(width, int(round(max(x1, x2)))))
    top = max(0, min(height - 1, int(round(min(y1, y2)))))
    bottom = max(0, min(height, int(round(max(y1, y2)))))
    if right - left < 4 or bottom - top < 4:
        raise HTTPException(status_code=422, detail="bbox_pixels is too small")
    return left, top, right, bottom


def _pixel_to_map(
    point: tuple[float, float],
    image_size: tuple[int, int],
    image_extent: list[float] | None,
) -> list[float]:
    x, y = point
    width, height = image_size
    if not image_extent:
        return [round(x, 2), round(y, 2)]

    minx, miny, maxx, maxy = image_extent
    map_x = minx + (x / width) * (maxx - minx)
    map_y = maxy - (y / height) * (maxy - miny)
    return [map_x, map_y]


def _bbox_polygon(
    bbox: tuple[int, int, int, int],
    image_size: tuple[int, int],
    image_extent: list[float] | None,
) -> dict:
    left, top, right, bottom = bbox
    ring = [
        _pixel_to_map((left, top), image_size, image_extent),
        _pixel_to_map((right, top), image_size, image_extent),
        _pixel_to_map((right, bottom), image_size, image_extent),
        _pixel_to_map((left, bottom), image_size, image_extent),
        _pixel_to_map((left, top), image_size, image_extent),
    ]
    return {"type": "Polygon", "coordinates": [ring]}


def _segment_largest_contour(image: Image.Image, bbox: tuple[int, int, int, int]) -> tuple[list[tuple[float, float]], float] | None:
    left, top, right, bottom = bbox
    crop = np.array(image.crop((left, top, right, bottom)))
    if crop.size == 0:
        return None

    # Lightweight prototype: GrabCut often gives a usable object mask for a user-provided box.
    mask = np.zeros(crop.shape[:2], np.uint8)
    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)
    rect_margin = max(2, min(crop.shape[0], crop.shape[1]) // 20)
    rect = (
        rect_margin,
        rect_margin,
        max(1, crop.shape[1] - rect_margin * 2),
        max(1, crop.shape[0] - rect_margin * 2),
    )

    try:
        cv2.grabCut(crop, mask, rect, bgd_model, fgd_model, 4, cv2.GC_INIT_WITH_RECT)
    except cv2.error:
        return None

    binary = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype("uint8")
    kernel = np.ones((3, 3), np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    largest = max(contours, key=cv2.contourArea)
    area = float(cv2.contourArea(largest))
    crop_area = float(crop.shape[0] * crop.shape[1])
    if area < max(16.0, crop_area * 0.01):
        return None

    epsilon = max(1.5, 0.01 * cv2.arcLength(largest, True))
    simplified = cv2.approxPolyDP(largest, epsilon, True)
    points = [(float(point[0][0] + left), float(point[0][1] + top)) for point in simplified]
    if len(points) < 3:
        return None

    confidence = min(0.86, max(0.35, area / crop_area))
    return points, confidence


@app.post("/segment-box", response_model=SegmentBoxResponse)
def segment_box(payload: SegmentBoxRequest) -> SegmentBoxResponse:
    image = _decode_image(payload.image_data)
    width, height = image.size
    bbox = _clip_bbox(payload.bbox_pixels, width, height)

    if payload.target_geometry_type != "polygon":
        geometry = _bbox_polygon(bbox, (width, height), payload.image_extent)
        return SegmentBoxResponse(
            status="fallback",
            geometry=geometry,
            confidence=0.2,
            message="Prototype service currently returns polygon suggestions. Edit the result manually if needed.",
            meta={"backend": "classical-cv", "reason": "target_geometry_type_not_supported"},
        )

    contour = _segment_largest_contour(image, bbox)
    if contour is None:
        geometry = _bbox_polygon(bbox, (width, height), payload.image_extent)
        return SegmentBoxResponse(
            status="fallback",
            geometry=geometry,
            confidence=0.25,
            message="No reliable contour was found. Returned the selected box as a draft polygon.",
            meta={"backend": "classical-cv", "reason": "no_contour"},
        )

    points, confidence = contour
    ring = [_pixel_to_map(point, (width, height), payload.image_extent) for point in points]
    if ring[0] != ring[-1]:
        ring.append(ring[0])

    return SegmentBoxResponse(
        status="passed",
        geometry={"type": "Polygon", "coordinates": [ring]},
        confidence=confidence,
        message="Prototype contour generated. Review and edit it before submitting.",
        meta={"backend": "classical-cv", "point_count": len(ring)},
    )
