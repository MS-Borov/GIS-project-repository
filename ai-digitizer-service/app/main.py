import base64
import binascii
import os
import sys
from io import BytesIO
from pathlib import Path
from typing import Any, Literal

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field


app = FastAPI(title="GIS AI Digitizer Service")

AI_DIGITIZER_BACKEND = os.getenv("AI_DIGITIZER_BACKEND", "classical-cv").strip().lower()
SAM2_CHECKPOINT = os.getenv("SAM2_CHECKPOINT", "/models/sam2.1_hiera_tiny.pt")
SAM2_MODEL_CFG = os.getenv("SAM2_MODEL_CFG", "configs/sam2.1/sam2.1_hiera_t.yaml")
SAM2_REPO_PATH = os.getenv("SAM2_REPO_PATH", "").strip()
SAM2_DEVICE = os.getenv("SAM2_DEVICE", "auto").strip().lower()
WATER_UNET_CHECKPOINT = os.getenv("WATER_UNET_CHECKPOINT", "/models/water_unet.pt")
WATER_UNET_DEVICE = os.getenv("WATER_UNET_DEVICE", "auto").strip().lower()
WATER_UNET_THRESHOLD = float(os.getenv("WATER_UNET_THRESHOLD", "0.5"))
SAM2_MASK_PROMPT_SIZE = int(os.getenv("SAM2_MASK_PROMPT_SIZE", "256"))
PROMPT_ML_BUFFER_RATIO = float(os.getenv("PROMPT_ML_BUFFER_RATIO", "0.08"))
PROMPT_ML_BUFFER_MAX_PX = int(os.getenv("PROMPT_ML_BUFFER_MAX_PX", "90"))
PROMPT_ML_NEGATIVE_RING_RATIO = float(os.getenv("PROMPT_ML_NEGATIVE_RING_RATIO", "0.22"))
PROMPT_ML_MAX_SAMPLES = int(os.getenv("PROMPT_ML_MAX_SAMPLES", "6000"))
PROMPT_ML_POSITIVE_THRESHOLD_SCALE = float(os.getenv("PROMPT_ML_POSITIVE_THRESHOLD_SCALE", "1.45"))
PROMPT_ML_NEGATIVE_MARGIN = float(os.getenv("PROMPT_ML_NEGATIVE_MARGIN", "0.72"))
PROMPT_ML_MAX_AREA_RATIO = float(os.getenv("PROMPT_ML_MAX_AREA_RATIO", "0.82"))
PROMPT_ML_SIMPLIFY_RATIO = float(os.getenv("PROMPT_ML_SIMPLIFY_RATIO", "0.0045"))
SAM2_MAX_COARSE_AREA_RATIO = float(os.getenv("SAM2_MAX_COARSE_AREA_RATIO", "1.25"))
SAM2_MIN_COARSE_IOU = float(os.getenv("SAM2_MIN_COARSE_IOU", "0.55"))
SAM2_MIN_COARSE_COVERAGE = float(os.getenv("SAM2_MIN_COARSE_COVERAGE", "0.72"))
AI_PROMPT_BUFFER_RATIO = float(os.getenv("AI_PROMPT_BUFFER_RATIO", "0.04"))
AI_PROMPT_BUFFER_MAX_PX = int(os.getenv("AI_PROMPT_BUFFER_MAX_PX", "40"))
AI_MIN_RESULT_PROMPT_IOU = float(os.getenv("AI_MIN_RESULT_PROMPT_IOU", "0.28"))
AI_MIN_PROMPT_COVERAGE = float(os.getenv("AI_MIN_PROMPT_COVERAGE", "0.55"))
AI_MAX_RESULT_PROMPT_AREA_RATIO = float(os.getenv("AI_MAX_RESULT_PROMPT_AREA_RATIO", "1.8"))
SAM2_BACKENDS = {"sam", "sam2", "sam-2", "geosam", "geo-sam"}
WATER_UNET_BACKENDS = {"water-unet", "water_unet", "gis-water"}
WATER_SAM2_BACKENDS = {"water-sam2", "water_sam2", "water-geosam", "water_geo_sam"}
PROMPT_ML_BACKENDS = {"prompt-ml", "prompt_ml", "sample-ml", "sample_ml"}
PROMPT_ML_SAM2_BACKENDS = {"prompt-ml-sam2", "prompt_ml_sam2", "sample-ml-sam2", "sample_ml_sam2"}
_sam2_predictor = None
_sam2_error: str | None = None
_water_unet_model = None
_water_unet_error: str | None = None


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
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "backend": AI_DIGITIZER_BACKEND,
        "sam2_configured": _sam2_is_configured(),
        "sam2_loaded": _sam2_predictor is not None,
        "sam2_error": _sam2_error,
        "water_unet_configured": AI_DIGITIZER_BACKEND in (WATER_UNET_BACKENDS | WATER_SAM2_BACKENDS),
        "water_unet_loaded": _water_unet_model is not None,
        "water_unet_error": _water_unet_error,
        "prompt_ml_configured": AI_DIGITIZER_BACKEND in (PROMPT_ML_BACKENDS | PROMPT_ML_SAM2_BACKENDS),
    }


def _sam2_is_configured() -> bool:
    return AI_DIGITIZER_BACKEND in (SAM2_BACKENDS | WATER_SAM2_BACKENDS | PROMPT_ML_SAM2_BACKENDS) and bool(SAM2_CHECKPOINT and SAM2_MODEL_CFG)


def _resolve_torch_device(torch_module: Any, requested_device: str) -> str:
    device = requested_device
    if device == "auto":
        device = "cuda" if torch_module.cuda.is_available() else "cpu"
    if device == "cuda" and not torch_module.cuda.is_available():
        device = "cpu"
    return device


def _build_water_unet(torch: Any, nn: Any, base_channels: int) -> Any:
    class DoubleConv(nn.Module):
        def __init__(self, in_channels: int, out_channels: int) -> None:
            super().__init__()
            self.block = nn.Sequential(
                nn.Conv2d(in_channels, out_channels, kernel_size=3, padding=1),
                nn.BatchNorm2d(out_channels),
                nn.ReLU(inplace=True),
                nn.Conv2d(out_channels, out_channels, kernel_size=3, padding=1),
                nn.BatchNorm2d(out_channels),
                nn.ReLU(inplace=True),
            )

        def forward(self, x: Any) -> Any:
            return self.block(x)

    class SmallWaterUNet(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.down1 = DoubleConv(3, base_channels)
            self.down2 = DoubleConv(base_channels, base_channels * 2)
            self.down3 = DoubleConv(base_channels * 2, base_channels * 4)
            self.down4 = DoubleConv(base_channels * 4, base_channels * 8)
            self.pool = nn.MaxPool2d(2)
            self.up3 = nn.ConvTranspose2d(base_channels * 8, base_channels * 4, kernel_size=2, stride=2)
            self.conv3 = DoubleConv(base_channels * 8, base_channels * 4)
            self.up2 = nn.ConvTranspose2d(base_channels * 4, base_channels * 2, kernel_size=2, stride=2)
            self.conv2 = DoubleConv(base_channels * 4, base_channels * 2)
            self.up1 = nn.ConvTranspose2d(base_channels * 2, base_channels, kernel_size=2, stride=2)
            self.conv1 = DoubleConv(base_channels * 2, base_channels)
            self.out = nn.Conv2d(base_channels, 1, kernel_size=1)

        def forward(self, x: Any) -> Any:
            x1 = self.down1(x)
            x2 = self.down2(self.pool(x1))
            x3 = self.down3(self.pool(x2))
            x4 = self.down4(self.pool(x3))
            y = self.up3(x4)
            y = self.conv3(torch.cat([y, x3], dim=1))
            y = self.up2(y)
            y = self.conv2(torch.cat([y, x2], dim=1))
            y = self.up1(y)
            y = self.conv1(torch.cat([y, x1], dim=1))
            return self.out(y)

    return SmallWaterUNet()


def _ensure_water_unet_model() -> dict[str, Any]:
    global _water_unet_error, _water_unet_model

    if _water_unet_model is not None:
        return _water_unet_model

    checkpoint = Path(WATER_UNET_CHECKPOINT)
    if not checkpoint.exists():
        _water_unet_error = f"Water UNet checkpoint not found: {checkpoint}"
        raise RuntimeError(_water_unet_error)

    try:
        import torch
        import torch.nn as nn
    except Exception as exc:  # noqa: BLE001 - optional model dependency.
        _water_unet_error = f"Water UNet import failed: {exc}"
        raise RuntimeError(_water_unet_error) from exc

    device = _resolve_torch_device(torch, WATER_UNET_DEVICE)
    try:
        data = torch.load(checkpoint, map_location=device)
        base_channels = int(data.get("base_channels", 24))
        image_size = int(data.get("image_size", 512))
        model = _build_water_unet(torch, nn, base_channels)
        model.load_state_dict(data["model"])
        model.to(device)
        model.eval()
    except Exception as exc:  # noqa: BLE001 - keep fallback available.
        _water_unet_error = f"Water UNet load failed: {exc}"
        raise RuntimeError(_water_unet_error) from exc

    _water_unet_model = {
        "model": model,
        "torch": torch,
        "device": device,
        "image_size": image_size,
        "base_channels": base_channels,
        "checkpoint": checkpoint.name,
        "best_iou": data.get("best_iou"),
    }
    _water_unet_error = None
    return _water_unet_model


def _ensure_sam2_predictor() -> dict[str, Any]:
    global _sam2_error, _sam2_predictor

    if _sam2_predictor is not None:
        return _sam2_predictor

    if not _sam2_is_configured():
        _sam2_error = "SAM2 backend is not configured"
        raise RuntimeError(_sam2_error)

    checkpoint = Path(SAM2_CHECKPOINT)
    if not checkpoint.exists():
        _sam2_error = f"SAM2 checkpoint not found: {checkpoint}"
        raise RuntimeError(_sam2_error)

    if SAM2_REPO_PATH:
        repo_path = Path(SAM2_REPO_PATH)
        if not repo_path.exists():
            _sam2_error = f"SAM2_REPO_PATH does not exist: {repo_path}"
            raise RuntimeError(_sam2_error)
        repo_path_str = str(repo_path)
        if repo_path_str not in sys.path:
            sys.path.insert(0, repo_path_str)

    try:
        import torch
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor
    except Exception as exc:  # noqa: BLE001 - model dependencies are optional.
        _sam2_error = f"SAM2 import failed: {exc}"
        raise RuntimeError(_sam2_error) from exc

    device = _resolve_torch_device(torch, SAM2_DEVICE)

    try:
        model = build_sam2(SAM2_MODEL_CFG, str(checkpoint), device=device)
        predictor = SAM2ImagePredictor(model)
    except Exception as exc:  # noqa: BLE001 - keep service usable when model setup is wrong.
        _sam2_error = f"SAM2 load failed: {exc}"
        raise RuntimeError(_sam2_error) from exc

    _sam2_predictor = {"predictor": predictor, "torch": torch, "device": device}
    _sam2_error = None
    return _sam2_predictor


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


def _map_to_pixel(
    point: list[float] | tuple[float, float],
    image_size: tuple[int, int],
    image_extent: list[float] | None,
) -> tuple[int, int] | None:
    if not image_extent or len(point) < 2:
        return None

    width, height = image_size
    minx, miny, maxx, maxy = image_extent
    if maxx == minx or maxy == miny:
        return None

    x = ((float(point[0]) - minx) / (maxx - minx)) * width
    y = ((maxy - float(point[1])) / (maxy - miny)) * height
    return int(round(x)), int(round(y))


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


def _draw_prompt_geometry(
    prompt_geometry: dict | None,
    bbox: tuple[int, int, int, int],
    image_size: tuple[int, int],
    image_extent: list[float] | None,
    dilation_px: int | None = None,
) -> np.ndarray | None:
    if not prompt_geometry:
        return None

    left, top, right, bottom = bbox
    mask = np.zeros((bottom - top, right - left), np.uint8)

    def to_crop_point(point: list[float] | tuple[float, float]) -> tuple[int, int] | None:
        pixel = _map_to_pixel(point, image_size, image_extent)
        if pixel is None:
            return None
        return pixel[0] - left, pixel[1] - top

    def draw_ring(points: list) -> None:
        crop_points = [to_crop_point(point) for point in points if isinstance(point, (list, tuple)) and len(point) >= 2]
        crop_points = [point for point in crop_points if point is not None]
        if len(crop_points) >= 3:
            cv2.fillPoly(mask, [np.array(crop_points, dtype=np.int32)], 255)

    def draw_line(points: list) -> None:
        crop_points = [to_crop_point(point) for point in points if isinstance(point, (list, tuple)) and len(point) >= 2]
        crop_points = [point for point in crop_points if point is not None]
        if len(crop_points) >= 2:
            width = max(5, min(mask.shape[:2]) // 18)
            cv2.polylines(mask, [np.array(crop_points, dtype=np.int32)], False, 255, width)

    geometry_type = str(prompt_geometry.get("type") or "").lower()
    coordinates = prompt_geometry.get("coordinates")
    if not isinstance(coordinates, list):
        return None

    if geometry_type == "polygon":
        if coordinates and isinstance(coordinates[0], list):
            draw_ring(coordinates[0])
    elif geometry_type == "multipolygon":
        for polygon in coordinates:
            if polygon and isinstance(polygon[0], list):
                draw_ring(polygon[0])
    elif geometry_type == "linestring":
        draw_line(coordinates)
    elif geometry_type == "multilinestring":
        for line in coordinates:
            draw_line(line)
    elif geometry_type == "point":
        point = to_crop_point(coordinates)
        if point is not None:
            cv2.circle(mask, point, max(5, min(mask.shape[:2]) // 20), 255, -1)
    elif geometry_type == "multipoint":
        for item in coordinates:
            point = to_crop_point(item)
            if point is not None:
                cv2.circle(mask, point, max(5, min(mask.shape[:2]) // 20), 255, -1)

    if int(mask.sum()) == 0:
        return None

    if dilation_px is None:
        dilation_px = max(1, min(7, min(mask.shape[:2]) // 36))
    if dilation_px <= 0:
        return mask

    kernel_size = max(3, dilation_px * 2 + 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    return cv2.dilate(mask, kernel, iterations=1)


def _prompt_mask_to_positive_points(
    prompt_mask: np.ndarray | None,
    bbox: tuple[int, int, int, int],
    max_points: int = 4,
) -> np.ndarray | None:
    if prompt_mask is None or int(np.count_nonzero(prompt_mask)) == 0:
        return None

    left, top, _, _ = bbox
    binary = (prompt_mask > 0).astype("uint8")
    points: list[list[float]] = []

    moments = cv2.moments(binary)
    if moments["m00"]:
        cx = int(round(moments["m10"] / moments["m00"]))
        cy = int(round(moments["m01"] / moments["m00"]))
        if 0 <= cy < binary.shape[0] and 0 <= cx < binary.shape[1] and binary[cy, cx]:
            points.append([float(left + cx), float(top + cy)])

    distance = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
    for _ in range(max_points):
        _, max_value, _, max_location = cv2.minMaxLoc(distance)
        if max_value <= 0:
            break
        x, y = max_location
        candidate = [float(left + x), float(top + y)]
        if candidate not in points:
            points.append(candidate)
        cv2.circle(distance, (x, y), max(8, int(max_value * 0.7)), 0, -1)

    if not points:
        return None
    return np.array(points[:max_points], dtype=np.float32)


def _constraint_mask_from_prompt(
    prompt_mask: np.ndarray | None,
    crop_shape: tuple[int, int],
) -> np.ndarray | None:
    if prompt_mask is None or int(np.count_nonzero(prompt_mask)) == 0:
        return None

    height, width = crop_shape
    buffer_px = max(6, min(AI_PROMPT_BUFFER_MAX_PX, int(max(width, height) * AI_PROMPT_BUFFER_RATIO)))
    kernel_size = buffer_px * 2 + 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    return cv2.dilate(prompt_mask, kernel, iterations=1)


def _prompt_geometry_fallback(
    prompt_geometry: dict | None,
    bbox: tuple[int, int, int, int],
    image_size: tuple[int, int],
    image_extent: list[float] | None,
) -> dict:
    geometry_type = str((prompt_geometry or {}).get("type") or "").lower()
    coordinates = (prompt_geometry or {}).get("coordinates")
    if geometry_type in {"polygon", "multipolygon"} and isinstance(coordinates, list) and coordinates:
        return prompt_geometry or _bbox_polygon(bbox, image_size, image_extent)
    return _bbox_polygon(bbox, image_size, image_extent)


def _evaluate_prompt_quality(
    geometry: dict,
    prompt_geometry: dict | None,
    bbox: tuple[int, int, int, int],
    image_size: tuple[int, int],
    image_extent: list[float] | None,
    rough_prompt: bool = False,
) -> dict[str, float | bool | str | None]:
    prompt_mask = _draw_prompt_geometry(prompt_geometry, bbox, image_size, image_extent, dilation_px=0)
    result_mask = _draw_prompt_geometry(geometry, bbox, image_size, image_extent, dilation_px=0)
    if prompt_mask is None or result_mask is None:
        return {"passed": True, "reason": None}

    prompt_binary = prompt_mask > 0
    result_binary = result_mask > 0
    prompt_area = float(np.count_nonzero(prompt_binary))
    result_area = float(np.count_nonzero(result_binary))
    if prompt_area <= 0 or result_area <= 0:
        return {"passed": True, "reason": None}

    intersection = float(np.count_nonzero(prompt_binary & result_binary))
    union = float(np.count_nonzero(prompt_binary | result_binary)) or 1.0
    iou = intersection / union
    prompt_coverage = intersection / prompt_area
    result_coverage = intersection / result_area
    area_ratio = result_area / prompt_area

    reasons = []
    min_iou = 0.08 if rough_prompt else AI_MIN_RESULT_PROMPT_IOU
    min_prompt_coverage = 0.12 if rough_prompt else AI_MIN_PROMPT_COVERAGE
    max_area_ratio = min(1.35, AI_MAX_RESULT_PROMPT_AREA_RATIO) if rough_prompt else AI_MAX_RESULT_PROMPT_AREA_RATIO
    if iou < min_iou:
        reasons.append("low_iou")
    if prompt_coverage < min_prompt_coverage:
        reasons.append("low_prompt_coverage")
    if rough_prompt and result_coverage < 0.7:
        reasons.append("outside_prompt")
    if area_ratio > max_area_ratio:
        reasons.append("area_too_large")

    return {
        "passed": not reasons,
        "reason": ",".join(reasons) if reasons else None,
        "prompt_iou": round(iou, 4),
        "prompt_coverage": round(prompt_coverage, 4),
        "result_coverage": round(result_coverage, 4),
        "area_ratio": round(area_ratio, 4),
        "rough_prompt": rough_prompt,
    }


def _evaluate_mask_refinement(
    refined_geometry: dict,
    coarse_mask: np.ndarray,
    bbox: tuple[int, int, int, int],
    image_size: tuple[int, int],
    image_extent: list[float] | None,
) -> dict[str, float | bool | str | None]:
    left, top, right, bottom = bbox
    refined_mask = _draw_prompt_geometry(refined_geometry, bbox, image_size, image_extent, dilation_px=0)
    if refined_mask is None:
        return {"passed": False, "reason": "no_refined_mask"}

    coarse_crop = coarse_mask[top:bottom, left:right]
    if coarse_crop.shape != refined_mask.shape:
        coarse_crop = cv2.resize(coarse_crop, (refined_mask.shape[1], refined_mask.shape[0]), interpolation=cv2.INTER_NEAREST)

    coarse_binary = coarse_crop > 0
    refined_binary = refined_mask > 0
    coarse_area = float(np.count_nonzero(coarse_binary))
    refined_area = float(np.count_nonzero(refined_binary))
    if coarse_area <= 0 or refined_area <= 0:
        return {"passed": False, "reason": "empty_mask"}

    intersection = float(np.count_nonzero(coarse_binary & refined_binary))
    union = float(np.count_nonzero(coarse_binary | refined_binary)) or 1.0
    iou = intersection / union
    coarse_coverage = intersection / coarse_area
    refined_coverage = intersection / refined_area
    area_ratio = refined_area / coarse_area

    reasons = []
    if iou < SAM2_MIN_COARSE_IOU:
        reasons.append("low_coarse_iou")
    if coarse_coverage < SAM2_MIN_COARSE_COVERAGE:
        reasons.append("low_coarse_coverage")
    if area_ratio > SAM2_MAX_COARSE_AREA_RATIO:
        reasons.append("sam_too_large")
    if refined_coverage < 0.75:
        reasons.append("sam_outside_coarse")

    return {
        "passed": not reasons,
        "reason": ",".join(reasons) if reasons else None,
        "coarse_iou": round(iou, 4),
        "coarse_coverage": round(coarse_coverage, 4),
        "refined_coverage": round(refined_coverage, 4),
        "area_ratio": round(area_ratio, 4),
    }


def _choose_mask_index(
    masks: np.ndarray,
    scores: np.ndarray | None,
    bbox: tuple[int, int, int, int],
    prompt_mask: np.ndarray | None,
) -> int:
    if prompt_mask is None or len(masks) == 1:
        return int(np.argmax(scores)) if scores is not None and len(scores) else 0

    left, top, right, bottom = bbox
    prompt_area = float(np.count_nonzero(prompt_mask > 0)) or 1.0
    allowed_mask = _constraint_mask_from_prompt(prompt_mask, prompt_mask.shape)
    best_index = 0
    best_score = -1.0
    for index, mask in enumerate(masks):
        cropped = np.where(mask[top:bottom, left:right] > 0, 1, 0).astype("uint8")
        if cropped.size == 0:
            continue
        overlap = float(np.count_nonzero((cropped > 0) & (prompt_mask > 0))) / prompt_area
        outside_penalty = 0.0
        if allowed_mask is not None:
            mask_area = float(np.count_nonzero(cropped > 0)) or 1.0
            outside_penalty = float(np.count_nonzero((cropped > 0) & (allowed_mask == 0))) / mask_area
        model_score = float(scores[index]) if scores is not None and index < len(scores) else 0.0
        total = overlap * 2.0 + model_score - outside_penalty * 1.5
        if total > best_score:
            best_score = total
            best_index = index
    return best_index


def _collect_prompt_points(
    prompt_geometry: dict | None,
    image_size: tuple[int, int],
    image_extent: list[float] | None,
    max_points: int = 16,
) -> np.ndarray | None:
    if not prompt_geometry:
        return None

    geometry_type = str(prompt_geometry.get("type") or "").lower()
    coordinates = prompt_geometry.get("coordinates")
    if not isinstance(coordinates, list):
        return None

    raw_points: list[list[float] | tuple[float, float]] = []

    def add_point(point: Any) -> None:
        if isinstance(point, (list, tuple)) and len(point) >= 2:
            raw_points.append(point)

    def add_line(points: Any) -> None:
        if isinstance(points, list):
            for point in points:
                add_point(point)

    if geometry_type in {"point", "linestring"}:
        if geometry_type == "point":
            add_point(coordinates)
        else:
            add_line(coordinates)
    elif geometry_type == "multipoint":
        add_line(coordinates)
    elif geometry_type == "multilinestring":
        for line in coordinates:
            add_line(line)
    elif geometry_type == "polygon":
        if coordinates:
            add_line(coordinates[0])
    elif geometry_type == "multipolygon":
        for polygon in coordinates:
            if polygon:
                add_line(polygon[0])

    if not raw_points:
        return None

    step = max(1, len(raw_points) // max_points)
    sampled = raw_points[::step][:max_points]
    pixel_points = []
    width, height = image_size
    for point in sampled:
        pixel = _map_to_pixel(point, image_size, image_extent)
        if pixel is None:
            continue
        x, y = pixel
        if 0 <= x < width and 0 <= y < height:
            pixel_points.append([float(x), float(y)])

    if not pixel_points:
        return None
    return np.array(pixel_points, dtype=np.float32)


def _mask_to_polygon(
    mask: np.ndarray,
    bbox: tuple[int, int, int, int],
    image_size: tuple[int, int],
    image_extent: list[float] | None,
    prompt_geometry: dict | None,
    simplify_ratio: float | None = None,
) -> tuple[dict, float, int] | None:
    left, top, right, bottom = bbox
    if mask.ndim > 2:
        mask = mask.squeeze()

    cropped = mask[top:bottom, left:right]
    if cropped.size == 0:
        return None

    binary = np.where(cropped > 0, 255, 0).astype("uint8")
    kernel = np.ones((3, 3), np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

    strict_prompt_mask = _draw_prompt_geometry(prompt_geometry, bbox, image_size, image_extent, dilation_px=0)
    allowed_mask = _constraint_mask_from_prompt(strict_prompt_mask, binary.shape)
    if allowed_mask is not None:
        constrained = cv2.bitwise_and(binary, allowed_mask)
        prompt_area = float(np.count_nonzero(strict_prompt_mask > 0)) if strict_prompt_mask is not None else 0.0
        constrained_area = float(np.count_nonzero(constrained > 0))
        if constrained_area >= max(16.0, prompt_area * 0.25):
            binary = constrained

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    prompt_mask = _draw_prompt_geometry(prompt_geometry, bbox, image_size, image_extent)
    crop_area = float((right - left) * (bottom - top))
    contour = max(contours, key=lambda item: _contour_score(item, prompt_mask, crop_area))
    area = float(cv2.contourArea(contour))
    if area < max(16.0, crop_area * 0.005):
        return None

    if simplify_ratio is None:
        simplify_ratio = 0.008
    epsilon = max(0.8, simplify_ratio * cv2.arcLength(contour, True))
    simplified = cv2.approxPolyDP(contour, epsilon, True)
    points = [(float(point[0][0] + left), float(point[0][1] + top)) for point in simplified]
    if len(points) < 3:
        return None

    ring = [_pixel_to_map(point, image_size, image_extent) for point in points]
    if ring[0] != ring[-1]:
        ring.append(ring[0])

    confidence = min(0.98, max(0.35, area / crop_area))
    return {"type": "Polygon", "coordinates": [ring]}, confidence, len(ring)


def _sam2_mask_input_from_binary_mask(mask: np.ndarray) -> np.ndarray | None:
    if mask.ndim > 2:
        mask = mask.squeeze()
    if mask.size == 0 or int(np.count_nonzero(mask)) == 0:
        return None

    size = max(16, SAM2_MASK_PROMPT_SIZE)
    low_res = cv2.resize((mask > 0).astype("float32"), (size, size), interpolation=cv2.INTER_AREA)
    logits = np.where(low_res > 0.5, 8.0, -8.0).astype("float32")
    return logits[None, :, :]


def _predict_water_crop_mask(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    prompt_geometry: dict | None,
    image_extent: list[float] | None,
) -> tuple[np.ndarray, dict[str, Any]]:
    water_model = _ensure_water_unet_model()
    model = water_model["model"]
    torch = water_model["torch"]
    device = water_model["device"]
    image_size = int(water_model["image_size"])

    left, top, right, bottom = bbox
    crop = image.crop((left, top, right, bottom)).convert("RGB")
    original_size = crop.size
    resized = crop.resize((image_size, image_size), Image.BILINEAR)
    image_array = np.array(resized).astype("float32") / 255.0
    tensor = torch.from_numpy(image_array).permute(2, 0, 1).unsqueeze(0).to(device)

    with torch.inference_mode():
        logits = model(tensor)
        probs = torch.sigmoid(logits)[0, 0].detach().cpu().numpy()

    probs_image = Image.fromarray((probs * 255).astype("uint8")).resize(original_size, Image.BILINEAR)
    crop_mask = np.where(np.array(probs_image) >= int(WATER_UNET_THRESHOLD * 255), 255, 0).astype("uint8")

    prompt_mask = _draw_prompt_geometry(prompt_geometry, bbox, image.size, image_extent, dilation_px=0)
    allowed_mask = _constraint_mask_from_prompt(prompt_mask, crop_mask.shape)
    if allowed_mask is not None:
        constrained = cv2.bitwise_and(crop_mask, allowed_mask)
        if np.count_nonzero(constrained) >= max(16, int(np.count_nonzero(crop_mask) * 0.25)):
            crop_mask = constrained

    return crop_mask, {
        "device": device,
        "checkpoint": water_model["checkpoint"],
        "best_iou": water_model["best_iou"],
        "threshold": WATER_UNET_THRESHOLD,
        "prompt_constraint": allowed_mask is not None,
        "water_pixels": int(np.count_nonzero(crop_mask > 0)),
    }


def _full_mask_from_crop_mask(
    crop_mask: np.ndarray,
    image: Image.Image,
    bbox: tuple[int, int, int, int],
) -> np.ndarray:
    left, top, right, bottom = bbox
    full_mask = np.zeros((image.height, image.width), dtype="uint8")
    full_mask[top:bottom, left:right] = crop_mask
    return full_mask


def _dilate_binary_mask(mask: np.ndarray, ratio: float, max_px: int, min_px: int = 6) -> np.ndarray:
    height, width = mask.shape[:2]
    buffer_px = max(min_px, min(max_px, int(max(width, height) * ratio)))
    kernel_size = buffer_px * 2 + 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    return cv2.dilate(mask, kernel, iterations=1)


def _sample_rows(values: np.ndarray, max_samples: int) -> np.ndarray:
    if len(values) <= max_samples:
        return values
    indices = np.linspace(0, len(values) - 1, max_samples).astype(np.int64)
    return values[indices]


def _prompt_ml_features(crop: np.ndarray) -> np.ndarray:
    rgb = crop.astype("float32") / 255.0
    lab = cv2.cvtColor(crop, cv2.COLOR_RGB2LAB).astype("float32") / 255.0
    hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV).astype("float32")
    hsv[:, :, 0] /= 179.0
    hsv[:, :, 1:] /= 255.0
    return np.concatenate([rgb, lab, hsv], axis=2).reshape(-1, 9)


def _normalized_distance(features: np.ndarray, samples: np.ndarray) -> np.ndarray:
    mean = np.mean(samples, axis=0)
    std = np.std(samples, axis=0)
    std = np.maximum(std, 0.035)
    return np.mean(((features - mean) / std) ** 2, axis=1)


def _select_prompt_object_samples(positive_samples: np.ndarray, negative_samples: np.ndarray) -> tuple[np.ndarray, dict[str, Any]]:
    if len(positive_samples) < 24:
        return positive_samples, {"clustered": False, "reason": "too_few_positive_samples"}

    cluster_count = min(4, max(2, len(positive_samples) // 80))
    compact_positive = np.ascontiguousarray(positive_samples.astype("float32"))
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.02)
    try:
        _, labels, centers = cv2.kmeans(compact_positive, cluster_count, None, criteria, 3, cv2.KMEANS_PP_CENTERS)
    except cv2.error:
        return positive_samples, {"clustered": False, "reason": "kmeans_failed"}

    labels = labels.reshape(-1)
    best_score = -1e9
    best_cluster = 0
    details: list[dict[str, Any]] = []
    for cluster_index in range(cluster_count):
        cluster_samples = positive_samples[labels == cluster_index]
        if len(cluster_samples) < max(8, len(positive_samples) * 0.04):
            continue

        cluster_distance = _normalized_distance(cluster_samples, cluster_samples)
        negative_distance = _normalized_distance(_sample_rows(negative_samples, min(PROMPT_ML_MAX_SAMPLES, 2000)), cluster_samples)
        compactness = float(np.mean(cluster_distance))
        separation = float(np.percentile(negative_distance, 35))
        lightness = float(np.mean(cluster_samples[:, 3]))
        size_ratio = float(len(cluster_samples) / max(1, len(positive_samples)))
        dark_bonus = max(0.0, 0.55 - lightness) * 1.2
        score = separation - compactness * 0.7 + dark_bonus + min(size_ratio, 0.35) * 0.2
        details.append(
            {
                "cluster": int(cluster_index),
                "score": round(score, 4),
                "size_ratio": round(size_ratio, 4),
                "lightness": round(lightness, 4),
            }
        )
        if score > best_score:
            best_score = score
            best_cluster = cluster_index

    selected = positive_samples[labels == best_cluster]
    if len(selected) < 8:
        return positive_samples, {"clustered": False, "reason": "selected_cluster_too_small", "clusters": details}

    return selected, {
        "clustered": True,
        "cluster_count": int(cluster_count),
        "selected_cluster": int(best_cluster),
        "selected_samples": int(len(selected)),
        "clusters": details,
    }


def _limit_mask_area_by_distance(
    predicted: np.ndarray,
    distance: np.ndarray,
    seed_mask: np.ndarray,
    max_pixels: int,
) -> np.ndarray:
    current_pixels = int(np.count_nonzero(predicted))
    if current_pixels <= max_pixels:
        return predicted

    candidate_distances = distance[predicted]
    if candidate_distances.size == 0:
        return predicted
    cutoff = float(np.partition(candidate_distances, max(0, min(max_pixels - 1, len(candidate_distances) - 1)))[max(0, min(max_pixels - 1, len(candidate_distances) - 1))])
    limited = predicted & (distance <= cutoff)
    limited[seed_mask] = True
    return limited


def _predict_prompt_ml_crop_mask(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    prompt_geometry: dict | None,
    image_extent: list[float] | None,
) -> tuple[np.ndarray, dict[str, Any]] | None:
    left, top, right, bottom = bbox
    crop = np.array(image.crop((left, top, right, bottom)).convert("RGB"))
    if crop.size == 0:
        return None

    prompt_mask = _draw_prompt_geometry(prompt_geometry, bbox, image.size, image_extent, dilation_px=0)
    if prompt_mask is None or int(np.count_nonzero(prompt_mask > 0)) < 16:
        return None

    positive_mask = prompt_mask > 0
    allowed_mask = _dilate_binary_mask(prompt_mask, PROMPT_ML_BUFFER_RATIO, PROMPT_ML_BUFFER_MAX_PX) > 0
    negative_outer = _dilate_binary_mask(prompt_mask, PROMPT_ML_NEGATIVE_RING_RATIO, max(PROMPT_ML_BUFFER_MAX_PX * 2, 120)) > 0
    negative_mask = negative_outer & ~allowed_mask
    if int(np.count_nonzero(negative_mask)) < 32:
        negative_mask = ~allowed_mask

    features = _prompt_ml_features(crop)
    flat_positive = positive_mask.reshape(-1)
    flat_negative = negative_mask.reshape(-1)
    if int(np.count_nonzero(flat_negative)) < 16:
        return None

    positive_samples = _sample_rows(features[flat_positive], PROMPT_ML_MAX_SAMPLES)
    negative_samples = _sample_rows(features[flat_negative], PROMPT_ML_MAX_SAMPLES)
    if len(positive_samples) < 8 or len(negative_samples) < 8:
        return None

    object_samples, object_meta = _select_prompt_object_samples(positive_samples, negative_samples)
    positive_distance = _normalized_distance(features, object_samples)
    negative_distance = _normalized_distance(features, negative_samples)
    object_distance = _normalized_distance(object_samples, object_samples)
    positive_threshold = max(
        float(np.percentile(object_distance, 96) * PROMPT_ML_POSITIVE_THRESHOLD_SCALE),
        float(np.percentile(object_distance, 99) + 0.08),
    )

    flat_allowed = allowed_mask.reshape(-1)
    predicted = (
        (positive_distance <= positive_threshold)
        & (positive_distance <= negative_distance * PROMPT_ML_NEGATIVE_MARGIN)
        & flat_allowed
    )
    predicted = predicted.reshape(crop.shape[:2])
    seed_distance_crop = positive_distance.reshape(crop.shape[:2])
    seed_mask = (seed_distance_crop <= max(positive_threshold * 0.55, float(np.percentile(object_distance, 90) + 0.03))) & positive_mask
    predicted[seed_mask] = True
    max_area_pixels = max(
        int(np.count_nonzero(seed_mask) * 1.5),
        int(np.count_nonzero(positive_mask) * PROMPT_ML_MAX_AREA_RATIO),
    )
    predicted = _limit_mask_area_by_distance(predicted, seed_distance_crop, seed_mask, max_area_pixels)

    binary = np.where(predicted, 255, 0).astype("uint8")
    kernel = np.ones((3, 3), np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
    smooth_kernel_size = max(3, min(9, int(min(binary.shape[:2]) * 0.018) | 1))
    smooth_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (smooth_kernel_size, smooth_kernel_size))
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, smooth_kernel)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, smooth_kernel)
    binary[seed_mask] = 255

    components_count, labels, stats, _ = cv2.connectedComponentsWithStats((binary > 0).astype("uint8"), 8)
    if components_count <= 1:
        return None

    keep = np.zeros(binary.shape, dtype="uint8")
    for label in range(1, components_count):
        component = labels == label
        if np.count_nonzero(component & seed_mask) > 0:
            keep[component] = 255

    if int(np.count_nonzero(keep > 0)) < max(16, int(np.count_nonzero(seed_mask) * 0.5)):
        return None

    return keep, {
        "positive_samples": int(len(positive_samples)),
        "object_samples": int(len(object_samples)),
        "negative_samples": int(len(negative_samples)),
        "positive_pixels": int(np.count_nonzero(positive_mask)),
        "seed_pixels": int(np.count_nonzero(seed_mask)),
        "predicted_pixels": int(np.count_nonzero(keep > 0)),
        "max_area_pixels": int(max_area_pixels),
        "threshold": round(positive_threshold, 4),
        "buffer_ratio": PROMPT_ML_BUFFER_RATIO,
        "threshold_scale": PROMPT_ML_POSITIVE_THRESHOLD_SCALE,
        "negative_margin": PROMPT_ML_NEGATIVE_MARGIN,
        "max_area_ratio": PROMPT_ML_MAX_AREA_RATIO,
        **object_meta,
    }


def _segment_with_prompt_ml(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    prompt_geometry: dict | None,
    image_extent: list[float] | None,
) -> tuple[dict, float, dict] | None:
    prompt_result = _predict_prompt_ml_crop_mask(image, bbox, prompt_geometry, image_extent)
    if prompt_result is None:
        return None

    crop_mask, prompt_meta = prompt_result
    full_mask = _full_mask_from_crop_mask(crop_mask, image, bbox)
    polygon = _mask_to_polygon(
        full_mask,
        bbox,
        image.size,
        image_extent,
        prompt_geometry,
        simplify_ratio=PROMPT_ML_SIMPLIFY_RATIO,
    )
    if polygon is None:
        return None

    geometry, geometry_confidence, point_count = polygon
    predicted_ratio = float(np.count_nonzero(crop_mask > 0)) / max(1.0, float(crop_mask.size))
    confidence = min(0.92, max(0.35, (geometry_confidence + min(0.85, predicted_ratio + 0.35)) / 2))
    return geometry, confidence, {
        "backend": "prompt-ml",
        "method": "positive_negative_pixel_classifier",
        "point_count": point_count,
        **prompt_meta,
    }


def _segment_with_prompt_ml_sam2(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    prompt_geometry: dict | None,
    image_extent: list[float] | None,
) -> tuple[dict, float, dict] | None:
    prompt_result = _predict_prompt_ml_crop_mask(image, bbox, prompt_geometry, image_extent)
    if prompt_result is None:
        return None

    crop_mask, prompt_meta = prompt_result
    full_mask = _full_mask_from_crop_mask(crop_mask, image, bbox)
    fallback_polygon = _mask_to_polygon(
        full_mask,
        bbox,
        image.size,
        image_extent,
        prompt_geometry,
        simplify_ratio=PROMPT_ML_SIMPLIFY_RATIO,
    )
    mask_input = _sam2_mask_input_from_binary_mask(full_mask)
    try:
        sam2_result = _segment_with_sam2(
            image,
            bbox,
            prompt_geometry,
            image_extent,
            mask_input=mask_input,
            backend_name="prompt-ml+sam2",
        )
        if sam2_result is not None:
            geometry, confidence, sam2_meta = sam2_result
            refinement_quality = _evaluate_mask_refinement(geometry, full_mask, bbox, image.size, image_extent)
            if not refinement_quality.get("passed", False):
                raise ValueError(str(refinement_quality.get("reason") or "sam2_rejected_by_coarse_mask"))
            return geometry, confidence, {
                **sam2_meta,
                "coarse_backend": "prompt-ml",
                "prompt_ml": prompt_meta,
                "refinement_quality": refinement_quality,
            }
    except RuntimeError:
        raise
    except Exception:
        pass

    polygon = fallback_polygon
    if polygon is None:
        return None

    geometry, geometry_confidence, point_count = polygon
    predicted_ratio = float(np.count_nonzero(crop_mask > 0)) / max(1.0, float(crop_mask.size))
    confidence = min(0.82, max(0.3, (geometry_confidence + min(0.78, predicted_ratio + 0.25)) / 2))
    return geometry, confidence, {
        "backend": "prompt-ml+sam2",
        "refinement": "prompt_ml_only",
        "reason": "sam2_refinement_failed_or_rejected",
        "point_count": point_count,
        "prompt_ml": prompt_meta,
    }


def _segment_with_sam2(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    prompt_geometry: dict | None,
    image_extent: list[float] | None,
    mask_input: np.ndarray | None = None,
    backend_name: str | None = None,
) -> tuple[dict, float, dict] | None:
    sam2 = _ensure_sam2_predictor()
    predictor = sam2["predictor"]
    torch = sam2["torch"]
    device = sam2["device"]

    image_array = np.array(image)
    left, top, right, bottom = bbox
    box = np.array([left, top, right, bottom], dtype=np.float32)
    prompt_mask = _draw_prompt_geometry(prompt_geometry, bbox, image.size, image_extent, dilation_px=0)
    point_coords = _prompt_mask_to_positive_points(prompt_mask, bbox)
    if point_coords is None:
        point_coords = _collect_prompt_points(prompt_geometry, image.size, image_extent)
    point_labels = None
    if point_coords is not None:
        point_labels = np.ones((len(point_coords),), dtype=np.int32)

    with torch.inference_mode():
        predictor.set_image(image_array)
        masks, scores, logits = predictor.predict(
            point_coords=point_coords,
            point_labels=point_labels,
            box=box,
            mask_input=mask_input,
            multimask_output=True,
        )

    if masks is None or len(masks) == 0:
        return None

    best_index = _choose_mask_index(masks, scores, bbox, prompt_mask)
    if logits is not None and len(logits) > best_index:
        try:
            refined_masks, refined_scores, _ = predictor.predict(
                point_coords=point_coords,
                point_labels=point_labels,
                box=box,
                mask_input=logits[best_index][None, :, :],
                multimask_output=False,
            )
            if refined_masks is not None and len(refined_masks):
                masks = refined_masks
                scores = refined_scores
                best_index = 0
        except Exception:
            pass

    polygon = _mask_to_polygon(masks[best_index], bbox, image.size, image_extent, prompt_geometry)
    if polygon is None:
        return None

    geometry, geometry_confidence, point_count = polygon
    model_confidence = float(scores[best_index]) if scores is not None and len(scores) else geometry_confidence
    confidence = min(0.99, max(0.35, (model_confidence + geometry_confidence) / 2))
    return geometry, confidence, {
        "backend": backend_name or ("geosam-sam2" if AI_DIGITIZER_BACKEND in {"geosam", "geo-sam"} else "sam2"),
        "device": device,
        "checkpoint": str(Path(SAM2_CHECKPOINT).name),
        "model_cfg": SAM2_MODEL_CFG,
        "point_count": point_count,
        "prompt_points": int(len(point_coords)) if point_coords is not None else 0,
        "prompt_mask_used": prompt_mask is not None,
        "prompt_constraint": prompt_mask is not None,
        "mask_input_used": mask_input is not None,
    }


def _segment_with_water_unet(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    prompt_geometry: dict | None,
    image_extent: list[float] | None,
) -> tuple[dict, float, dict] | None:
    crop_mask, water_meta = _predict_water_crop_mask(image, bbox, prompt_geometry, image_extent)
    full_mask = _full_mask_from_crop_mask(crop_mask, image, bbox)
    polygon = _mask_to_polygon(full_mask, bbox, image.size, image_extent, prompt_geometry)
    if polygon is None:
        return None

    geometry, geometry_confidence, point_count = polygon
    water_ratio = float(np.count_nonzero(crop_mask > 0)) / max(1.0, float(crop_mask.size))
    confidence = min(0.98, max(0.35, (geometry_confidence + min(0.95, water_ratio + 0.35)) / 2))
    return geometry, confidence, {
        "backend": "water-unet",
        "point_count": point_count,
        **water_meta,
    }


def _segment_with_water_sam2(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    prompt_geometry: dict | None,
    image_extent: list[float] | None,
) -> tuple[dict, float, dict] | None:
    crop_mask, water_meta = _predict_water_crop_mask(image, bbox, prompt_geometry, image_extent)
    if int(np.count_nonzero(crop_mask > 0)) == 0:
        return None

    full_mask = _full_mask_from_crop_mask(crop_mask, image, bbox)
    mask_input = _sam2_mask_input_from_binary_mask(full_mask)
    try:
        sam2_result = _segment_with_sam2(
            image,
            bbox,
            prompt_geometry,
            image_extent,
            mask_input=mask_input,
            backend_name="water-unet+sam2",
        )
        if sam2_result is not None:
            geometry, confidence, sam2_meta = sam2_result
            return geometry, confidence, {
                **sam2_meta,
                "coarse_backend": "water-unet",
                "coarse_mask_pixels": water_meta["water_pixels"],
                "water_unet": water_meta,
            }
    except RuntimeError:
        raise
    except Exception:
        pass

    polygon = _mask_to_polygon(full_mask, bbox, image.size, image_extent, prompt_geometry)
    if polygon is None:
        return None

    geometry, geometry_confidence, point_count = polygon
    water_ratio = float(np.count_nonzero(crop_mask > 0)) / max(1.0, float(crop_mask.size))
    confidence = min(0.85, max(0.3, (geometry_confidence + min(0.85, water_ratio + 0.25)) / 2))
    return geometry, confidence, {
        "backend": "water-unet+sam2",
        "refinement": "water_unet_only",
        "reason": "sam2_refinement_failed",
        "point_count": point_count,
        "water_unet": water_meta,
    }


def _color_prompt_mask(crop: np.ndarray, prompt_mask: np.ndarray) -> np.ndarray | None:
    sample_pixels = crop[prompt_mask > 0]
    if sample_pixels.size == 0:
        return None

    lab = cv2.cvtColor(crop, cv2.COLOR_RGB2LAB).astype(np.float32)
    sample_lab = cv2.cvtColor(sample_pixels.reshape(-1, 1, 3), cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
    center = np.median(sample_lab, axis=0)
    distances = np.linalg.norm(lab - center, axis=2)
    threshold = float(np.percentile(np.linalg.norm(sample_lab - center, axis=1), 80) + 18.0)
    color_mask = np.where(distances <= max(20.0, threshold), 255, 0).astype("uint8")
    kernel = np.ones((3, 3), np.uint8)
    color_mask = cv2.morphologyEx(color_mask, cv2.MORPH_OPEN, kernel)
    color_mask = cv2.morphologyEx(color_mask, cv2.MORPH_CLOSE, kernel)
    return color_mask


def _contour_score(contour: np.ndarray, prompt_mask: np.ndarray | None, crop_area: float) -> float:
    area = float(cv2.contourArea(contour))
    if prompt_mask is None:
        return area
    contour_mask = np.zeros(prompt_mask.shape, np.uint8)
    cv2.drawContours(contour_mask, [contour], -1, 255, -1)
    overlap = float(np.count_nonzero((contour_mask > 0) & (prompt_mask > 0)))
    prompt_area = float(np.count_nonzero(prompt_mask > 0)) or 1.0
    overlap_ratio = overlap / prompt_area
    # Prefer contours that include the student's hint, then use area as a tie-breaker.
    return overlap_ratio * crop_area * 2.0 + area


def _segment_largest_contour(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    prompt_geometry: dict | None,
    image_extent: list[float] | None,
) -> tuple[list[tuple[float, float]], float, str] | None:
    left, top, right, bottom = bbox
    crop = np.array(image.crop((left, top, right, bottom)))
    if crop.size == 0:
        return None

    prompt_mask = _draw_prompt_geometry(prompt_geometry, bbox, image.size, image_extent)
    mask = np.full(crop.shape[:2], cv2.GC_PR_BGD, np.uint8)
    mask[:2, :] = cv2.GC_BGD
    mask[-2:, :] = cv2.GC_BGD
    mask[:, :2] = cv2.GC_BGD
    mask[:, -2:] = cv2.GC_BGD
    init_mode = cv2.GC_INIT_WITH_RECT
    rect_margin = max(2, min(crop.shape[0], crop.shape[1]) // 20)
    rect = (
        rect_margin,
        rect_margin,
        max(1, crop.shape[1] - rect_margin * 2),
        max(1, crop.shape[0] - rect_margin * 2),
    )
    if prompt_mask is not None:
        color_mask = _color_prompt_mask(crop, prompt_mask)
        if color_mask is not None:
            mask[color_mask > 0] = cv2.GC_PR_FGD
        mask[prompt_mask > 0] = cv2.GC_FGD
        init_mode = cv2.GC_INIT_WITH_MASK

    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)

    try:
        cv2.grabCut(crop, mask, rect, bgd_model, fgd_model, 4, init_mode)
    except cv2.error:
        return None

    binary = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype("uint8")
    kernel = np.ones((3, 3), np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    largest = max(contours, key=lambda contour: _contour_score(contour, prompt_mask, float(crop.shape[0] * crop.shape[1])))
    area = float(cv2.contourArea(largest))
    crop_area = float(crop.shape[0] * crop.shape[1])
    if area < max(16.0, crop_area * 0.01):
        return None

    epsilon = max(1.5, 0.01 * cv2.arcLength(largest, True))
    simplified = cv2.approxPolyDP(largest, epsilon, True)
    points = [(float(point[0][0] + left), float(point[0][1] + top)) for point in simplified]
    if len(points) < 3:
        return None

    confidence = min(0.9, max(0.35, area / crop_area + (0.18 if prompt_mask is not None else 0.0)))
    return points, confidence, "prompt-grabcut" if prompt_mask is not None else "bbox-grabcut"


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

    fallback_reason: str | None = None
    if AI_DIGITIZER_BACKEND in PROMPT_ML_SAM2_BACKENDS:
        try:
            prompt_ml_sam2_result = _segment_with_prompt_ml_sam2(image, bbox, payload.prompt_geometry, payload.image_extent)
            if prompt_ml_sam2_result is not None:
                geometry, confidence, meta = prompt_ml_sam2_result
                quality = _evaluate_prompt_quality(
                    geometry,
                    payload.prompt_geometry,
                    bbox,
                    (width, height),
                    payload.image_extent,
                    rough_prompt=True,
                )
                if not quality.get("passed", True):
                    return SegmentBoxResponse(
                        status="fallback",
                        geometry=_prompt_geometry_fallback(payload.prompt_geometry, bbox, (width, height), payload.image_extent),
                        confidence=0.2,
                        message="AI contour was rejected because it was worse than the student's draft. Returned the student's contour.",
                        meta={**meta, "quality_gate": quality, "rejected_backend": meta.get("backend", "prompt-ml+sam2")},
                    )
                return SegmentBoxResponse(
                    status="passed",
                    geometry=geometry,
                    confidence=confidence,
                    message="Prompt-based pixel classifier created a mask and SAM2 refined it. Review and edit the contour before submitting.",
                    meta={**meta, "quality_gate": quality},
                )
            fallback_reason = "prompt_ml_sam2_no_mask"
        except RuntimeError as exc:
            fallback_reason = str(exc)

    if AI_DIGITIZER_BACKEND in PROMPT_ML_BACKENDS or (AI_DIGITIZER_BACKEND in PROMPT_ML_SAM2_BACKENDS and fallback_reason):
        try:
            prompt_ml_result = _segment_with_prompt_ml(image, bbox, payload.prompt_geometry, payload.image_extent)
            if prompt_ml_result is not None:
                geometry, confidence, meta = prompt_ml_result
                quality = _evaluate_prompt_quality(
                    geometry,
                    payload.prompt_geometry,
                    bbox,
                    (width, height),
                    payload.image_extent,
                    rough_prompt=True,
                )
                if not quality.get("passed", True):
                    return SegmentBoxResponse(
                        status="fallback",
                        geometry=_prompt_geometry_fallback(payload.prompt_geometry, bbox, (width, height), payload.image_extent),
                        confidence=0.2,
                        message="AI contour was rejected because it was worse than the student's draft. Returned the student's contour.",
                        meta={**meta, "quality_gate": quality, "rejected_backend": "prompt-ml"},
                    )
                return SegmentBoxResponse(
                    status="passed",
                    geometry=geometry,
                    confidence=confidence,
                    message="Prompt-based pixel classifier generated a contour. Review and edit it before submitting.",
                    meta={**meta, "quality_gate": quality},
                )
            fallback_reason = "prompt_ml_no_mask"
        except RuntimeError as exc:
            fallback_reason = str(exc)

    if AI_DIGITIZER_BACKEND in WATER_SAM2_BACKENDS:
        try:
            hybrid_result = _segment_with_water_sam2(image, bbox, payload.prompt_geometry, payload.image_extent)
            if hybrid_result is not None:
                geometry, confidence, meta = hybrid_result
                quality = _evaluate_prompt_quality(geometry, payload.prompt_geometry, bbox, (width, height), payload.image_extent)
                if not quality.get("passed", True):
                    return SegmentBoxResponse(
                        status="fallback",
                        geometry=_prompt_geometry_fallback(payload.prompt_geometry, bbox, (width, height), payload.image_extent),
                        confidence=0.2,
                        message="AI contour was rejected because it was worse than the student's draft. Returned the student's contour.",
                        meta={**meta, "quality_gate": quality, "rejected_backend": meta.get("backend", "water-unet+sam2")},
                    )
                return SegmentBoxResponse(
                    status="passed",
                    geometry=geometry,
                    confidence=confidence,
                    message="Water model created a coarse mask and SAM2 refined it. Review and edit the contour before submitting.",
                    meta={**meta, "quality_gate": quality},
                )
            fallback_reason = "water_sam2_no_mask"
        except RuntimeError as exc:
            fallback_reason = str(exc)

    if AI_DIGITIZER_BACKEND in WATER_UNET_BACKENDS or (AI_DIGITIZER_BACKEND in WATER_SAM2_BACKENDS and fallback_reason):
        try:
            water_result = _segment_with_water_unet(image, bbox, payload.prompt_geometry, payload.image_extent)
            if water_result is not None:
                geometry, confidence, meta = water_result
                quality = _evaluate_prompt_quality(geometry, payload.prompt_geometry, bbox, (width, height), payload.image_extent)
                if not quality.get("passed", True):
                    return SegmentBoxResponse(
                        status="fallback",
                        geometry=_prompt_geometry_fallback(payload.prompt_geometry, bbox, (width, height), payload.image_extent),
                        confidence=0.2,
                        message="AI contour was rejected because it was worse than the student's draft. Returned the student's contour.",
                        meta={**meta, "quality_gate": quality, "rejected_backend": "water-unet"},
                    )
                return SegmentBoxResponse(
                    status="passed",
                    geometry=geometry,
                    confidence=confidence,
                    message="Water segmentation model generated a contour. Review and edit it before submitting.",
                    meta={**meta, "quality_gate": quality},
                )
            fallback_reason = "water_unet_no_mask"
        except RuntimeError as exc:
            fallback_reason = str(exc)

    if AI_DIGITIZER_BACKEND in SAM2_BACKENDS:
        try:
            sam2_result = _segment_with_sam2(image, bbox, payload.prompt_geometry, payload.image_extent)
            if sam2_result is not None:
                geometry, confidence, meta = sam2_result
                quality = _evaluate_prompt_quality(geometry, payload.prompt_geometry, bbox, (width, height), payload.image_extent)
                if not quality.get("passed", True):
                    return SegmentBoxResponse(
                        status="fallback",
                        geometry=_prompt_geometry_fallback(payload.prompt_geometry, bbox, (width, height), payload.image_extent),
                        confidence=0.2,
                        message="AI contour was rejected because it was worse than the student's draft. Returned the student's contour.",
                        meta={**meta, "quality_gate": quality, "rejected_backend": meta.get("backend", "sam2")},
                    )
                return SegmentBoxResponse(
                    status="passed",
                    geometry=geometry,
                    confidence=confidence,
                    message="GeoSAM/SAM2 generated a contour from the student's prompt. Review and edit it before submitting.",
                    meta={**meta, "quality_gate": quality},
                )
            fallback_reason = "sam2_no_mask"
        except RuntimeError as exc:
            fallback_reason = str(exc)

    contour = _segment_largest_contour(image, bbox, payload.prompt_geometry, payload.image_extent)
    if contour is None:
        geometry = _bbox_polygon(bbox, (width, height), payload.image_extent)
        return SegmentBoxResponse(
            status="fallback",
            geometry=geometry,
            confidence=0.25,
            message="No reliable contour was found. Returned the selected box as a draft polygon.",
            meta={"backend": "classical-cv", "fallback_from": AI_DIGITIZER_BACKEND, "reason": fallback_reason or "no_contour"},
        )

    points, confidence, method = contour
    ring = [_pixel_to_map(point, (width, height), payload.image_extent) for point in points]
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    geometry = {"type": "Polygon", "coordinates": [ring]}
    quality = _evaluate_prompt_quality(geometry, payload.prompt_geometry, bbox, (width, height), payload.image_extent)
    if not quality.get("passed", True):
        return SegmentBoxResponse(
            status="fallback",
            geometry=_prompt_geometry_fallback(payload.prompt_geometry, bbox, (width, height), payload.image_extent),
            confidence=0.2,
            message="AI contour was rejected because it was worse than the student's draft. Returned the student's contour.",
            meta={
                "backend": "classical-cv",
                "fallback_from": AI_DIGITIZER_BACKEND if fallback_reason else None,
                "fallback_reason": fallback_reason,
                "method": method,
                "quality_gate": quality,
                "rejected_backend": "classical-cv",
            },
        )

    return SegmentBoxResponse(
        status="passed",
        geometry=geometry,
        confidence=confidence,
        message="AI contour generated from the student's prompt. Review and edit it before submitting.",
        meta={
            "backend": "classical-cv",
            "fallback_from": AI_DIGITIZER_BACKEND if fallback_reason else None,
            "fallback_reason": fallback_reason,
            "method": method,
            "point_count": len(ring),
            "quality_gate": quality,
        },
    )
