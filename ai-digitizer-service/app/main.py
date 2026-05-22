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
OSM_WATER_HEURISTIC_ENABLED = os.getenv("OSM_WATER_HEURISTIC_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}
OSM_FILL_HEURISTIC_ENABLED = os.getenv("OSM_FILL_HEURISTIC_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}
OSM_FOREST_HEURISTIC_ENABLED = os.getenv("OSM_FOREST_HEURISTIC_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}
OSM_WATER_MIN_PIXEL_RATIO = float(os.getenv("OSM_WATER_MIN_PIXEL_RATIO", "0.0008"))
OSM_WATER_MAX_AREA_RATIO = float(os.getenv("OSM_WATER_MAX_AREA_RATIO", "0.38"))
OSM_WATER_LARGE_PROMPT_RATIO = float(os.getenv("OSM_WATER_LARGE_PROMPT_RATIO", "0.22"))
OSM_WATER_LARGE_MAX_AREA_RATIO = float(os.getenv("OSM_WATER_LARGE_MAX_AREA_RATIO", "0.86"))
OSM_WATER_SIMPLIFY_RATIO = float(os.getenv("OSM_WATER_SIMPLIFY_RATIO", "0.0035"))
OSM_WATER_LARGE_SIMPLIFY_RATIO = float(os.getenv("OSM_WATER_LARGE_SIMPLIFY_RATIO", "0.0008"))
OSM_FOREST_MIN_PIXEL_RATIO = float(os.getenv("OSM_FOREST_MIN_PIXEL_RATIO", "0.0012"))
OSM_FOREST_MAX_AREA_RATIO = float(os.getenv("OSM_FOREST_MAX_AREA_RATIO", "0.62"))
OSM_FOREST_LARGE_PROMPT_RATIO = float(os.getenv("OSM_FOREST_LARGE_PROMPT_RATIO", "0.24"))
OSM_FOREST_LARGE_MAX_AREA_RATIO = float(os.getenv("OSM_FOREST_LARGE_MAX_AREA_RATIO", "0.9"))
OSM_FOREST_SIMPLIFY_RATIO = float(os.getenv("OSM_FOREST_SIMPLIFY_RATIO", "0.0025"))
OSM_FOREST_LARGE_SIMPLIFY_RATIO = float(os.getenv("OSM_FOREST_LARGE_SIMPLIFY_RATIO", "0.001"))
OSM_LOCAL_RF_ENABLED = os.getenv("OSM_LOCAL_RF_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
OSM_LOCAL_RF_MAX_SAMPLES = int(os.getenv("OSM_LOCAL_RF_MAX_SAMPLES", "9000"))
OSM_LOCAL_RF_MIN_POSITIVE = int(os.getenv("OSM_LOCAL_RF_MIN_POSITIVE", "32"))
OSM_LOCAL_RF_MIN_COVERAGE = float(os.getenv("OSM_LOCAL_RF_MIN_COVERAGE", "0.12"))
OSM_FILL_MIN_PIXEL_RATIO = float(os.getenv("OSM_FILL_MIN_PIXEL_RATIO", "0.0012"))
OSM_FILL_MAX_AREA_RATIO = float(os.getenv("OSM_FILL_MAX_AREA_RATIO", "0.62"))
OSM_FILL_SIMPLIFY_RATIO = float(os.getenv("OSM_FILL_SIMPLIFY_RATIO", "0.004"))
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
    target_layer_name: str | None = None
    target_semantic_type: Literal["water", "forest"] | None = None
    target_geometry_type: Literal["polygon", "line", "point"] = "polygon"


class SegmentBoxResponse(BaseModel):
    status: Literal["passed", "fallback"]
    geometry: dict
    confidence: float
    message: str
    meta: dict


def _layer_name_variants(layer_name: str | None) -> list[str]:
    if not layer_name:
        return []
    normalized = layer_name.strip().lower()
    variants = {normalized}
    for encoding in ("cp1251", "latin1"):
        try:
            variants.add(normalized.encode(encoding).decode("utf-8").lower())
        except (UnicodeError, LookupError):
            pass
    return [variant for variant in variants if variant]


def _is_water_target_layer(layer_name: str | None) -> bool:
    variants = _layer_name_variants(layer_name)
    if not variants:
        return False
    water_tokens = (
        "hydro",
        "water",
        "river",
        "lake",
        "pond",
        "reservoir",
        "гидр",
        "вод",
        "река",
        "рек",
        "озер",
        "озёр",
        "пруд",
    )
    return any(token in variant for variant in variants for token in water_tokens)


def _is_forest_target_layer(layer_name: str | None) -> bool:
    variants = _layer_name_variants(layer_name)
    if not variants:
        return False
    forest_tokens = (
        "forest",
        "wood",
        "woods",
        "tree",
        "trees",
        "vegetation",
        "landuse_forest",
        "natural_wood",
        "les",
        "\u043b\u0435\u0441",
        "\u043b\u0435\u0441\u0430",
        "\u043b\u0435\u0441\u043d",
        "\u0434\u0440\u0435\u0432",
        "\u0440\u0430\u0441\u0442\u0438\u0442",
        "р»рµс",
        "р›рµс",
    )
    return any(token in variant for variant in variants for token in forest_tokens)


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
        "osm_forest_heuristic_enabled": OSM_FOREST_HEURISTIC_ENABLED,
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
    min_iou = 0.03 if rough_prompt else AI_MIN_RESULT_PROMPT_IOU
    min_prompt_coverage = 0.03 if rough_prompt else AI_MIN_PROMPT_COVERAGE
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
    if strict_prompt_mask is not None and int(np.count_nonzero(strict_prompt_mask > 0)) > 0:
        constrained = cv2.bitwise_and(binary, strict_prompt_mask)
        prompt_area = float(np.count_nonzero(strict_prompt_mask > 0)) if strict_prompt_mask is not None else 0.0
        constrained_area = float(np.count_nonzero(constrained > 0))
        if constrained_area >= max(8.0, prompt_area * 0.02):
            binary = constrained

    if simplify_ratio is None:
        simplify_ratio = 0.008
    contour_approximation = cv2.CHAIN_APPROX_NONE if simplify_ratio <= 0.001 else cv2.CHAIN_APPROX_SIMPLE
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, contour_approximation)
    if not contours:
        return None

    prompt_mask = _draw_prompt_geometry(prompt_geometry, bbox, image_size, image_extent)
    crop_area = float((right - left) * (bottom - top))
    contour = max(contours, key=lambda item: _contour_score(item, prompt_mask, crop_area))
    area = float(cv2.contourArea(contour))
    if area < max(16.0, crop_area * 0.005):
        return None

    min_epsilon = 0.35 if simplify_ratio <= 0.001 else 0.8
    epsilon = max(min_epsilon, simplify_ratio * cv2.arcLength(contour, True))
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


def _constrain_refined_mask(refined_mask: np.ndarray, constraint_mask: np.ndarray | None, dilation_px: int = 8) -> np.ndarray:
    if constraint_mask is None or constraint_mask.size == 0:
        return refined_mask

    refined = np.where(refined_mask > 0, 255, 0).astype("uint8")
    constraint = np.where(constraint_mask > 0, 255, 0).astype("uint8")
    if constraint.shape != refined.shape:
        constraint = cv2.resize(constraint, (refined.shape[1], refined.shape[0]), interpolation=cv2.INTER_NEAREST)

    if dilation_px > 0:
        kernel_size = max(3, dilation_px | 1)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
        constraint = cv2.dilate(constraint, kernel, iterations=1)

    constrained = cv2.bitwise_and(refined, constraint)
    if int(np.count_nonzero(constrained > 0)) < 24:
        return refined_mask

    return constrained


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


def _seed_connected_candidate_mask(seed_mask: np.ndarray, candidate_mask: np.ndarray, max_iterations: int) -> np.ndarray:
    if int(np.count_nonzero(seed_mask > 0)) == 0:
        return candidate_mask

    seed = np.where(seed_mask > 0, 255, 0).astype("uint8")
    candidate = np.where(candidate_mask > 0, 255, 0).astype("uint8")
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    previous_count = -1
    for _ in range(max(1, max_iterations)):
        current_count = int(np.count_nonzero(seed > 0))
        if current_count == previous_count:
            break
        previous_count = current_count
        seed = cv2.bitwise_and(cv2.dilate(seed, kernel, iterations=1), candidate)
    return seed


def _sample_flat_indices(mask: np.ndarray, max_samples: int) -> np.ndarray:
    indices = np.flatnonzero(mask.reshape(-1))
    if len(indices) <= max_samples:
        return indices
    selected = np.linspace(0, len(indices) - 1, max_samples).astype(np.int64)
    return indices[selected]


def _osm_ml_features(crop: np.ndarray) -> np.ndarray:
    height, width = crop.shape[:2]
    hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV)
    lab = cv2.cvtColor(crop, cv2.COLOR_RGB2LAB)
    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
    grad_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    grad_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    grad = np.sqrt(grad_x * grad_x + grad_y * grad_y)
    grad = np.clip(grad / 255.0, 0.0, 1.0)
    yy, xx = np.mgrid[0:height, 0:width]
    features = np.dstack(
        [
            crop.astype("float32") / 255.0,
            hsv.astype("float32") / np.array([179.0, 255.0, 255.0], dtype=np.float32),
            lab.astype("float32") / 255.0,
            grad.astype("float32"),
            (xx.astype("float32") / max(1.0, float(width - 1))),
            (yy.astype("float32") / max(1.0, float(height - 1))),
        ]
    )
    return features.reshape(-1, features.shape[2]).astype("float32")


def _predict_with_local_random_forest(
    crop: np.ndarray,
    positive_mask: np.ndarray,
    negative_mask: np.ndarray,
    predict_mask: np.ndarray,
) -> tuple[np.ndarray, dict[str, Any]] | None:
    if not hasattr(cv2, "ml") or not hasattr(cv2.ml, "RTrees_create"):
        return None

    positive_indices = _sample_flat_indices(positive_mask, OSM_LOCAL_RF_MAX_SAMPLES // 2)
    negative_indices = _sample_flat_indices(negative_mask, OSM_LOCAL_RF_MAX_SAMPLES // 2)
    if len(positive_indices) < OSM_LOCAL_RF_MIN_POSITIVE or len(negative_indices) < max(32, OSM_LOCAL_RF_MIN_POSITIVE):
        return None

    features = _osm_ml_features(crop)
    samples = np.vstack([features[positive_indices], features[negative_indices]]).astype("float32")
    labels = np.concatenate(
        [
            np.ones(len(positive_indices), dtype=np.int32),
            np.zeros(len(negative_indices), dtype=np.int32),
        ]
    )

    try:
        model = cv2.ml.RTrees_create()
        model.setMaxDepth(12)
        model.setMinSampleCount(4)
        model.setRegressionAccuracy(0.0)
        model.setUseSurrogates(False)
        model.setMaxCategories(2)
        model.setCalculateVarImportance(False)
        model.setTermCriteria((cv2.TERM_CRITERIA_MAX_ITER, 60, 0.0))
        if not model.train(samples, cv2.ml.ROW_SAMPLE, labels):
            return None
    except cv2.error:
        return None

    predict_indices = np.flatnonzero(predict_mask.reshape(-1))
    if len(predict_indices) == 0:
        return None

    predicted_flat = np.zeros(crop.shape[:2][0] * crop.shape[:2][1], dtype=bool)
    try:
        chunk_size = 60000
        for start in range(0, len(predict_indices), chunk_size):
            chunk = predict_indices[start : start + chunk_size]
            _, response = model.predict(features[chunk])
            predicted_flat[chunk] = response.reshape(-1) >= 0.5
    except cv2.error:
        return None

    predicted = predicted_flat.reshape(crop.shape[:2])
    predicted &= predict_mask
    return np.where(predicted, 255, 0).astype("uint8"), {
        "model": "opencv-rtrees",
        "positive_samples": int(len(positive_indices)),
        "negative_samples": int(len(negative_indices)),
        "predict_pixels": int(len(predict_indices)),
    }


def _predict_osm_water_crop_mask(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    prompt_geometry: dict | None,
    image_extent: list[float] | None,
) -> tuple[np.ndarray, dict[str, Any]] | None:
    left, top, right, bottom = bbox
    crop = np.array(image.crop((left, top, right, bottom)).convert("RGB"))
    if crop.size == 0:
        return None

    hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV)
    r = crop[:, :, 0].astype(np.int16)
    g = crop[:, :, 1].astype(np.int16)
    b = crop[:, :, 2].astype(np.int16)
    h = hsv[:, :, 0].astype(np.int16)
    s = hsv[:, :, 1].astype(np.int16)
    v = hsv[:, :, 2].astype(np.int16)

    yellow_beige_fill = (
        (h <= 46)
        & (s >= 16)
        & (v >= 135)
        & (r >= b + 28)
        & (g >= b + 14)
        & (r >= g - 18)
    )

    # OSM water is usually pale cyan/blue, but on some rendered zooms it becomes a muted green-gray fill.
    pale_osm_water = (
        (h >= 74)
        & (h <= 112)
        & (s >= 18)
        & (s <= 125)
        & (v >= 125)
        & (b >= r + 8)
        & (g >= r + 2)
        & (b >= g - 18)
        & ~yellow_beige_fill
    )
    muted_osm_water = (
        (h >= 38)
        & (h <= 86)
        & (s >= 8)
        & (s <= 86)
        & (v >= 110)
        & (v <= 238)
        & (g >= r - 12)
        & (b >= r - 48)
        & ~yellow_beige_fill
    )
    strong_blue_water = (
        (h >= 84)
        & (h <= 125)
        & (s >= 55)
        & (v >= 75)
        & (b >= r + 18)
        & (b >= g - 28)
    )

    prompt_mask = _draw_prompt_geometry(prompt_geometry, bbox, image.size, image_extent, dilation_px=0)
    prompt_pixels = int(np.count_nonzero(prompt_mask > 0)) if prompt_mask is not None else 0
    prompt_ratio = prompt_pixels / max(1.0, float(crop.shape[0] * crop.shape[1]))
    large_prompt = prompt_ratio >= OSM_WATER_LARGE_PROMPT_RATIO or prompt_pixels >= 65_000

    strict_mask = np.where(pale_osm_water | strong_blue_water, 255, 0).astype("uint8")
    large_muted_osm_water = (
        muted_osm_water
        & (b >= g - 32)
        & (b >= r - 18)
        & (r >= 145)
        & (g >= 145)
    )
    candidate_mask = np.where(
        pale_osm_water | strong_blue_water | (large_muted_osm_water if large_prompt else muted_osm_water),
        255,
        0,
    ).astype("uint8")

    if large_prompt and int(np.count_nonzero(strict_mask > 0)) >= max(12, int(candidate_mask.size * OSM_WATER_MIN_PIXEL_RATIO * 0.35)):
        growth_iterations = max(24, min(180, int(max(candidate_mask.shape[:2]) * 0.42)))
        mask = _seed_connected_candidate_mask(strict_mask, candidate_mask, growth_iterations)
        if int(np.count_nonzero(mask > 0)) < max(18, int(candidate_mask.size * OSM_WATER_MIN_PIXEL_RATIO)):
            mask = strict_mask
    else:
        mask = candidate_mask

    allowed_mask = _constraint_mask_from_prompt(prompt_mask, mask.shape)
    if allowed_mask is not None:
        constrained = cv2.bitwise_and(mask, allowed_mask)
        if int(np.count_nonzero(constrained > 0)) >= 12:
            mask = constrained

    if int(np.count_nonzero(mask > 0)) < max(18, int(mask.size * OSM_WATER_MIN_PIXEL_RATIO)):
        return None

    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    close_size = 5
    close_iterations = 2
    if large_prompt:
        close_size = max(7, min(15, int(min(mask.shape[:2]) * 0.018) | 1))
        close_iterations = 2
    close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_size, close_size))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, close_kernel, iterations=close_iterations)
    mask = cv2.dilate(mask, kernel, iterations=1)

    components_count, labels, stats, centroids = cv2.connectedComponentsWithStats((mask > 0).astype("uint8"), 8)
    if components_count <= 1:
        return None

    min_component_area = max(12, int(mask.size * OSM_WATER_MIN_PIXEL_RATIO))
    max_area_ratio = OSM_WATER_LARGE_MAX_AREA_RATIO if large_prompt else OSM_WATER_MAX_AREA_RATIO
    max_component_area = max(min_component_area * 3, int(mask.size * max_area_ratio))
    crop_center = np.array([mask.shape[1] / 2.0, mask.shape[0] / 2.0])
    max_center_distance = float(np.linalg.norm(crop_center)) or 1.0
    keep = np.zeros(mask.shape, dtype="uint8")
    candidates: list[tuple[float, int]] = []
    for label in range(1, components_count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < min_component_area or area > max_component_area:
            continue
        component = labels == label
        component_pixels = crop[component]
        mean_rgb = np.mean(component_pixels, axis=0)
        blue_green_balance = float((mean_rgb[2] + mean_rgb[1]) / 2.0 - mean_rgb[0])
        saturation_mean = float(np.mean(s[component]))
        centroid = centroids[label]
        center_bonus = 1.0 - min(1.0, float(np.linalg.norm(centroid - crop_center) / max_center_distance))
        touches_edge = (
            stats[label, cv2.CC_STAT_LEFT] <= 1
            or stats[label, cv2.CC_STAT_TOP] <= 1
            or stats[label, cv2.CC_STAT_LEFT] + stats[label, cv2.CC_STAT_WIDTH] >= mask.shape[1] - 1
            or stats[label, cv2.CC_STAT_TOP] + stats[label, cv2.CC_STAT_HEIGHT] >= mask.shape[0] - 1
        )
        edge_penalty = 0.85 if large_prompt and touches_edge else 0.5 if touches_edge else 1.0
        color_bonus = max(0.0, blue_green_balance / 55.0) + max(0.0, (92.0 - saturation_mean) / 160.0)
        score = area * (0.75 + color_bonus + center_bonus * 0.35) * edge_penalty
        candidates.append((score, label))

    if not candidates:
        return None

    candidates.sort(reverse=True)
    kept_area = 0
    max_kept_components = 8 if large_prompt else 3
    for _, label in candidates[:max_kept_components]:
        component = labels == label
        area = int(np.count_nonzero(component))
        if kept_area + area > max_component_area and kept_area > 0:
            continue
        keep[component] = 255
        kept_area += area

    water_pixels = int(np.count_nonzero(keep > 0))
    if water_pixels < min_component_area:
        return None

    return keep, {
        "backend": "osm-water",
        "water_pixels": water_pixels,
        "water_ratio": round(water_pixels / max(1, keep.size), 5),
        "prompt_constraint": allowed_mask is not None,
        "prompt_ratio": round(prompt_ratio, 5),
        "large_prompt": large_prompt,
        "min_pixel_ratio": OSM_WATER_MIN_PIXEL_RATIO,
        "max_area_ratio": max_area_ratio,
        "component_candidates": len(candidates),
        "excluded_yellow_pixels": int(np.count_nonzero(yellow_beige_fill)),
        "strict_water_pixels": int(np.count_nonzero(strict_mask > 0)),
        "close_kernel": close_size,
    }


def _predict_osm_forest_crop_mask(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    prompt_geometry: dict | None,
    image_extent: list[float] | None,
) -> tuple[np.ndarray, dict[str, Any]] | None:
    left, top, right, bottom = bbox
    crop = np.array(image.crop((left, top, right, bottom)).convert("RGB"))
    if crop.size == 0:
        return None

    hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV)
    r = crop[:, :, 0].astype(np.int16)
    g = crop[:, :, 1].astype(np.int16)
    b = crop[:, :, 2].astype(np.int16)
    h = hsv[:, :, 0].astype(np.int16)
    s = hsv[:, :, 1].astype(np.int16)
    v = hsv[:, :, 2].astype(np.int16)

    yellow_beige_fill = (
        (h <= 44)
        & (s >= 12)
        & (v >= 135)
        & (r >= b + 24)
        & (g >= b + 8)
        & (r >= g - 18)
    )
    water_like = (
        (h >= 74)
        & (h <= 125)
        & (s >= 16)
        & (v >= 105)
        & (b >= r + 8)
        & (b >= g - 18)
    )
    blue_cyan_water = (
        (h >= 78)
        & (h <= 116)
        & (s >= 18)
        & (v >= 112)
        & (b >= r + 10)
        & (b >= g - 8)
    )
    pale_blue_water = (
        (h >= 70)
        & (h <= 122)
        & (s >= 8)
        & (s <= 70)
        & (v >= 132)
        & (b >= r + 8)
        & (b >= g - 4)
    )
    muted_blue_water = (
        (h >= 54)
        & (h <= 122)
        & (s >= 6)
        & (s <= 88)
        & (v >= 112)
        & (b >= r - 8)
        & (b >= g - 20)
        & (g <= b + 28)
    )
    strict_water_exclusion = water_like | blue_cyan_water | pale_blue_water
    water_exclusion = strict_water_exclusion | (muted_blue_water & (g <= r + 12))
    pale_field_like = (
        (h <= 46)
        & (s >= 8)
        & (v >= 145)
        & (r >= g - 8)
        & (r >= b + 18)
        & (g >= b + 6)
    )
    wetland_forest = (
        (h >= 38)
        & (h <= 68)
        & (s >= 12)
        & (s <= 82)
        & (v >= 120)
        & (v <= 238)
        & (g >= r + 7)
        & (g >= b + 4)
        & ~yellow_beige_fill
        & ~water_exclusion
    )
    pale_forest = (
        (h >= 42)
        & (h <= 86)
        & (s >= 18)
        & (s <= 118)
        & (v >= 112)
        & (v <= 238)
        & (g >= r + 4)
        & (g >= b + 2)
        & ~yellow_beige_fill
        & ~water_exclusion
    )
    strong_forest = (
        (h >= 44)
        & (h <= 94)
        & (s >= 34)
        & (v >= 70)
        & (v <= 228)
        & (g >= r + 8)
        & (g >= b + 2)
        & ~water_exclusion
    )
    muted_forest = (
        (h >= 34)
        & (h <= 76)
        & (s >= 10)
        & (s <= 82)
        & (v >= 118)
        & (v <= 235)
        & (g >= r - 2)
        & (g >= b + 2)
        & (r >= b - 28)
        & ~yellow_beige_fill
        & ~water_exclusion
    )
    linear_forest = (
        (h >= 34)
        & (h <= 86)
        & (s >= 8)
        & (s <= 115)
        & (v >= 105)
        & (v <= 242)
        & (g >= r + 1)
        & (g >= b - 10)
        & ~yellow_beige_fill
        & ~strict_water_exclusion
    )
    pale_pattern_forest = (
        (h >= 38)
        & (h <= 92)
        & (s >= 5)
        & (s <= 90)
        & (v >= 138)
        & (v <= 248)
        & (g >= r - 1)
        & (g >= b - 12)
        & ~pale_field_like
        & ~strict_water_exclusion
    )
    broad_forest_fill = (
        (h >= 34)
        & (h <= 96)
        & (s >= 3)
        & (s <= 92)
        & (v >= 122)
        & (v <= 250)
        & (g >= r - 5)
        & (g >= b - 18)
        & ~yellow_beige_fill
        & ~pale_field_like
        & ~strict_water_exclusion
    )

    prompt_mask = _draw_prompt_geometry(prompt_geometry, bbox, image.size, image_extent, dilation_px=0)
    prompt_pixels = int(np.count_nonzero(prompt_mask > 0)) if prompt_mask is not None else 0
    prompt_ratio = prompt_pixels / max(1.0, float(crop.shape[0] * crop.shape[1]))
    large_prompt = prompt_ratio >= OSM_FOREST_LARGE_PROMPT_RATIO or prompt_pixels >= 75_000

    strict_mask = np.where(strong_forest | pale_forest, 255, 0).astype("uint8")
    candidate_mask = np.where(
        strong_forest
        | pale_forest
        | wetland_forest
        | (muted_forest if large_prompt else (muted_forest & (s >= 18)))
        | (linear_forest & (s >= 10)),
        255,
        0,
    ).astype("uint8")
    if prompt_mask is not None and prompt_pixels > 0:
        candidate_mask = cv2.bitwise_or(candidate_mask, np.where(pale_pattern_forest, 255, 0).astype("uint8"))

    prompt_candidate = None
    if prompt_mask is not None and prompt_pixels > 0:
        seed_mask = cv2.bitwise_and(candidate_mask, prompt_mask)
        fill_candidate = cv2.bitwise_and(
            np.where(broad_forest_fill | pale_pattern_forest, 255, 0).astype("uint8"),
            prompt_mask,
        )
        if int(np.count_nonzero(seed_mask > 0)) >= max(12, int(candidate_mask.size * OSM_FOREST_MIN_PIXEL_RATIO * 0.2)):
            growth_iterations = max(30, min(260, int(max(candidate_mask.shape[:2]) * 0.55)))
            prompt_candidate = _seed_connected_candidate_mask(seed_mask, fill_candidate, growth_iterations)
        else:
            prompt_candidate = cv2.bitwise_and(candidate_mask, prompt_mask)

    if prompt_candidate is not None and int(np.count_nonzero(prompt_candidate > 0)) >= max(24, int(candidate_mask.size * OSM_FOREST_MIN_PIXEL_RATIO)):
        mask = prompt_candidate
    elif large_prompt and int(np.count_nonzero(strict_mask > 0)) >= max(20, int(candidate_mask.size * OSM_FOREST_MIN_PIXEL_RATIO * 0.35)):
        growth_iterations = max(20, min(160, int(max(candidate_mask.shape[:2]) * 0.36)))
        mask = _seed_connected_candidate_mask(strict_mask, candidate_mask, growth_iterations)
        if int(np.count_nonzero(mask > 0)) < max(24, int(candidate_mask.size * OSM_FOREST_MIN_PIXEL_RATIO)):
            mask = strict_mask
    else:
        mask = candidate_mask

    allowed_mask = _constraint_mask_from_prompt(prompt_mask, mask.shape)
    if allowed_mask is not None:
        constrained = cv2.bitwise_and(mask, allowed_mask)
        if int(np.count_nonzero(constrained > 0)) >= 18:
            mask = constrained

    if int(np.count_nonzero(mask > 0)) < max(24, int(mask.size * OSM_FOREST_MIN_PIXEL_RATIO)):
        return None

    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    close_size = 7
    close_iterations = 2
    if large_prompt:
        close_size = max(9, min(25, int(min(mask.shape[:2]) * 0.035) | 1))
        close_iterations = 2
    close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_size, close_size))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, close_kernel, iterations=close_iterations)
    mask = cv2.dilate(mask, kernel, iterations=1)

    components_count, labels, stats, centroids = cv2.connectedComponentsWithStats((mask > 0).astype("uint8"), 8)
    if components_count <= 1:
        return None

    min_component_area = max(18, int(mask.size * OSM_FOREST_MIN_PIXEL_RATIO))
    max_area_ratio = OSM_FOREST_LARGE_MAX_AREA_RATIO if large_prompt else OSM_FOREST_MAX_AREA_RATIO
    max_component_area = max(min_component_area * 3, int(mask.size * max_area_ratio))
    crop_center = np.array([mask.shape[1] / 2.0, mask.shape[0] / 2.0])
    max_center_distance = float(np.linalg.norm(crop_center)) or 1.0
    prompt_core = (prompt_mask > 0) if prompt_mask is not None else None
    keep = np.zeros(mask.shape, dtype="uint8")
    candidates: list[tuple[float, int]] = []
    for label in range(1, components_count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < min_component_area or area > max_component_area:
            continue
        component = labels == label
        prompt_overlap_bonus = 0.0
        if prompt_core is not None:
            overlap_pixels = int(np.count_nonzero(component & prompt_core))
            if overlap_pixels < max(4, min(24, int(area * 0.04))):
                continue
            prompt_overlap_bonus = min(1.2, overlap_pixels / max(1.0, float(area))) + min(0.8, overlap_pixels / max(1.0, float(prompt_pixels)))
        component_pixels = crop[component]
        mean_rgb = np.mean(component_pixels, axis=0)
        saturation_mean = float(np.mean(s[component]))
        component_pale_pattern_pixels = int(np.count_nonzero(pale_pattern_forest & component))
        pale_pattern_ratio = component_pale_pattern_pixels / max(1.0, float(area))
        component_broad_fill_pixels = int(np.count_nonzero(broad_forest_fill & component))
        broad_fill_ratio = component_broad_fill_pixels / max(1.0, float(area))
        component_green_pixels = int(np.count_nonzero((strong_forest | pale_forest | wetland_forest | linear_forest | pale_pattern_forest | broad_forest_fill) & component))
        green_pixel_ratio = component_green_pixels / max(1.0, float(area))
        min_green_ratio = 0.16 if max(pale_pattern_ratio, broad_fill_ratio) >= 0.45 else 0.35
        if green_pixel_ratio < min_green_ratio:
            continue
        if max(pale_pattern_ratio, broad_fill_ratio) < 0.45 and float(mean_rgb[2]) >= float(mean_rgb[1]) - 8.0 and saturation_mean < 58.0:
            continue
        green_balance = float(mean_rgb[1] - max(mean_rgb[0], mean_rgb[2]) * 0.72)
        centroid = centroids[label]
        center_bonus = 1.0 - min(1.0, float(np.linalg.norm(centroid - crop_center) / max_center_distance))
        touches_edge = (
            stats[label, cv2.CC_STAT_LEFT] <= 1
            or stats[label, cv2.CC_STAT_TOP] <= 1
            or stats[label, cv2.CC_STAT_LEFT] + stats[label, cv2.CC_STAT_WIDTH] >= mask.shape[1] - 1
            or stats[label, cv2.CC_STAT_TOP] + stats[label, cv2.CC_STAT_HEIGHT] >= mask.shape[0] - 1
        )
        edge_penalty = 0.88 if large_prompt and touches_edge else 0.58 if touches_edge else 1.0
        color_bonus = max(0.0, green_balance / 80.0) + max(0.0, min(90.0, saturation_mean) / 180.0)
        score = (area ** 0.82) * (0.72 + color_bonus + center_bonus * 0.2 + prompt_overlap_bonus) * edge_penalty
        candidates.append((score, label))

    if not candidates:
        return None

    candidates.sort(reverse=True)
    kept_area = 0
    max_kept_components = 12 if large_prompt else 5
    for _, label in candidates[:max_kept_components]:
        component = labels == label
        area = int(np.count_nonzero(component))
        if kept_area + area > max_component_area and kept_area > 0:
            continue
        keep[component] = 255
        kept_area += area

    forest_pixels = int(np.count_nonzero(keep > 0))
    if forest_pixels < min_component_area:
        return None
    if prompt_mask is not None and prompt_pixels > 0:
        prompt_coverage = forest_pixels / max(1.0, float(prompt_pixels))
        if prompt_coverage < 0.18:
            return None

    return keep, {
        "backend": "osm-forest",
        "forest_pixels": forest_pixels,
        "forest_ratio": round(forest_pixels / max(1, keep.size), 5),
        "prompt_coverage": round(forest_pixels / max(1.0, float(prompt_pixels)), 5) if prompt_pixels else None,
        "prompt_constraint": allowed_mask is not None,
        "prompt_ratio": round(prompt_ratio, 5),
        "large_prompt": large_prompt,
        "min_pixel_ratio": OSM_FOREST_MIN_PIXEL_RATIO,
        "max_area_ratio": max_area_ratio,
        "component_candidates": len(candidates),
        "excluded_water_like_pixels": int(np.count_nonzero(water_exclusion)),
        "excluded_yellow_pixels": int(np.count_nonzero(yellow_beige_fill)),
        "strict_forest_pixels": int(np.count_nonzero(strict_mask > 0)),
        "close_kernel": close_size,
    }


def _predict_osm_local_rf_crop_mask(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    prompt_geometry: dict | None,
    image_extent: list[float] | None,
    target_type: Literal["water", "forest"],
) -> tuple[np.ndarray, dict[str, Any]] | None:
    if not OSM_LOCAL_RF_ENABLED:
        return None

    crop = np.array(image.crop(bbox).convert("RGB"))
    if crop.size == 0:
        return None

    prompt_mask = _draw_prompt_geometry(prompt_geometry, bbox, image.size, image_extent, dilation_px=0)
    if prompt_mask is None or int(np.count_nonzero(prompt_mask > 0)) < 48:
        return None

    hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV)
    r = crop[:, :, 0].astype(np.int16)
    g = crop[:, :, 1].astype(np.int16)
    b = crop[:, :, 2].astype(np.int16)
    h = hsv[:, :, 0].astype(np.int16)
    s = hsv[:, :, 1].astype(np.int16)
    v = hsv[:, :, 2].astype(np.int16)

    yellow_beige_fill = (
        (h <= 46)
        & (s >= 12)
        & (v >= 135)
        & (r >= b + 22)
        & (g >= b + 8)
        & (r >= g - 18)
    )
    water_seed = (
        (
            (h >= 74)
            & (h <= 122)
            & (s >= 16)
            & (v >= 110)
            & (b >= r + 8)
            & (b >= g - 14)
        )
        | (
            (h >= 84)
            & (h <= 125)
            & (s >= 48)
            & (v >= 75)
            & (b >= r + 16)
            & (b >= g - 28)
        )
    ) & ~yellow_beige_fill
    water_candidate = (
        water_seed
        | (
            (h >= 48)
            & (h <= 122)
            & (s >= 6)
            & (s <= 105)
            & (v >= 105)
            & (b >= r - 22)
            & (g >= r - 18)
            & ~yellow_beige_fill
        )
    )
    forest_seed = (
        (
            (h >= 42)
            & (h <= 96)
            & (s >= 16)
            & (v >= 90)
            & (v <= 240)
            & (g >= r + 3)
            & (g >= b - 4)
        )
        | (
            (h >= 34)
            & (h <= 92)
            & (s >= 6)
            & (s <= 105)
            & (v >= 118)
            & (v <= 250)
            & (g >= r - 2)
            & (g >= b - 14)
        )
    ) & ~water_seed & ~yellow_beige_fill
    forest_candidate = (
        forest_seed
        | (
            (h >= 32)
            & (h <= 98)
            & (s >= 3)
            & (s <= 100)
            & (v >= 112)
            & (v <= 252)
            & (g >= r - 7)
            & (g >= b - 20)
            & ~water_seed
            & ~yellow_beige_fill
        )
    )
    forest_soft_fill = (
        (h >= 30)
        & (h <= 102)
        & (s >= 2)
        & (s <= 96)
        & (v >= 118)
        & (v <= 254)
        & (g >= r - 10)
        & (g >= b - 24)
        & (r <= b + 44)
        & ~water_seed
        & ~yellow_beige_fill
    )

    prompt_bool = prompt_mask > 0
    outside_prompt = ~(_constraint_mask_from_prompt(prompt_mask, crop.shape[:2]) > 0)
    if target_type == "water":
        positive_mask = water_seed & prompt_bool
        candidate_mask = water_candidate & prompt_bool
        negative_mask = ((forest_seed | yellow_beige_fill) & prompt_bool) | outside_prompt
        min_coverage = 0.06
    else:
        positive_mask = forest_seed & prompt_bool
        candidate_mask = (forest_candidate | forest_soft_fill) & prompt_bool
        negative_mask = (water_seed & prompt_bool) | yellow_beige_fill | outside_prompt
        min_coverage = OSM_LOCAL_RF_MIN_COVERAGE

    if int(np.count_nonzero(positive_mask)) < OSM_LOCAL_RF_MIN_POSITIVE:
        relaxed_positive = candidate_mask & prompt_bool
        if int(np.count_nonzero(relaxed_positive)) >= OSM_LOCAL_RF_MIN_POSITIVE:
            positive_mask = relaxed_positive
        else:
            return None

    prediction = _predict_with_local_random_forest(crop, positive_mask, negative_mask, candidate_mask)
    if prediction is None:
        return None

    mask, model_meta = prediction
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    close_size = max(5, min(19, int(min(mask.shape[:2]) * 0.025) | 1))
    close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_size, close_size))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, close_kernel, iterations=2)
    mask = cv2.bitwise_and(mask, prompt_mask)
    if target_type == "forest":
        soft_candidate = np.where(forest_soft_fill & prompt_bool, 255, 0).astype("uint8")
        growth_iterations = max(20, min(180, int(max(mask.shape[:2]) * 0.32)))
        grown = _seed_connected_candidate_mask(mask, soft_candidate, growth_iterations)
        if int(np.count_nonzero(grown > 0)) >= int(np.count_nonzero(mask > 0)):
            max_growth_pixels = max(int(np.count_nonzero(prompt_bool) * 0.82), int(np.count_nonzero(mask > 0) * 1.8))
            if int(np.count_nonzero(grown > 0)) <= max_growth_pixels:
                mask = grown
        mask = cv2.bitwise_and(mask, prompt_mask)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.bitwise_and(mask, prompt_mask)

    prompt_pixels = int(np.count_nonzero(prompt_bool))
    predicted_pixels = int(np.count_nonzero(mask > 0))
    if predicted_pixels < max(24, int(prompt_pixels * min_coverage)):
        return None

    return mask, {
        "backend": "osm-local-rf",
        "target_type": target_type,
        "predicted_pixels": predicted_pixels,
        "prompt_coverage": round(predicted_pixels / max(1.0, float(prompt_pixels)), 5),
        "positive_pixels": int(np.count_nonzero(positive_mask)),
        "negative_pixels": int(np.count_nonzero(negative_mask)),
        "candidate_pixels": int(np.count_nonzero(candidate_mask)),
        "close_kernel": close_size,
        **model_meta,
    }


def _border_background_distance_mask(crop: np.ndarray) -> tuple[np.ndarray, dict[str, Any]] | None:
    height, width = crop.shape[:2]
    if height < 12 or width < 12:
        return None

    border_px = max(4, min(18, min(height, width) // 12))
    border_mask = np.zeros((height, width), dtype=bool)
    border_mask[:border_px, :] = True
    border_mask[-border_px:, :] = True
    border_mask[:, :border_px] = True
    border_mask[:, -border_px:] = True

    lab = cv2.cvtColor(crop, cv2.COLOR_RGB2LAB).astype("float32")
    hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV)
    border_samples = lab[border_mask]
    if len(border_samples) < 16:
        return None

    mean = np.mean(border_samples, axis=0)
    std = np.maximum(np.std(border_samples, axis=0), 5.0)
    distance = np.sqrt(np.mean(((lab - mean) / std) ** 2, axis=2))
    border_distance = distance[border_mask]
    threshold = max(1.55, float(np.percentile(border_distance, 94) + 0.55))

    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]
    candidate = (distance > threshold) & (value > 105) & (value < 248) & (saturation < 140)
    candidate &= ~border_mask

    mask = np.where(candidate, 255, 0).astype("uint8")
    if int(np.count_nonzero(mask > 0)) < max(18, int(mask.size * OSM_FILL_MIN_PIXEL_RATIO)):
        return None

    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    close_kernel_size = max(5, min(13, (min(height, width) // 18) | 1))
    close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_kernel_size, close_kernel_size))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, close_kernel, iterations=2)

    return mask, {
        "border_px": int(border_px),
        "distance_threshold": round(threshold, 4),
    }


def _predict_osm_fill_crop_mask(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    prompt_geometry: dict | None,
    image_extent: list[float] | None,
) -> tuple[np.ndarray, dict[str, Any]] | None:
    left, top, right, bottom = bbox
    crop = np.array(image.crop((left, top, right, bottom)).convert("RGB"))
    if crop.size == 0:
        return None

    result = _border_background_distance_mask(crop)
    if result is None:
        return None
    mask, distance_meta = result

    prompt_mask = _draw_prompt_geometry(prompt_geometry, bbox, image.size, image_extent, dilation_px=0)
    allowed_mask = _constraint_mask_from_prompt(prompt_mask, mask.shape)
    if allowed_mask is not None:
        constrained = cv2.bitwise_and(mask, allowed_mask)
        if int(np.count_nonzero(constrained > 0)) >= 12:
            mask = constrained

    components_count, labels, stats, centroids = cv2.connectedComponentsWithStats((mask > 0).astype("uint8"), 8)
    if components_count <= 1:
        return None

    crop_area = float(mask.size)
    min_component_area = max(16, int(crop_area * OSM_FILL_MIN_PIXEL_RATIO))
    max_component_area = int(crop_area * OSM_FILL_MAX_AREA_RATIO)
    crop_center = np.array([mask.shape[1] / 2.0, mask.shape[0] / 2.0])
    max_center_distance = float(np.linalg.norm(crop_center)) or 1.0

    candidates: list[tuple[float, int]] = []
    for label in range(1, components_count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < min_component_area or area > max_component_area:
            continue
        x = int(stats[label, cv2.CC_STAT_LEFT])
        y = int(stats[label, cv2.CC_STAT_TOP])
        w = int(stats[label, cv2.CC_STAT_WIDTH])
        h = int(stats[label, cv2.CC_STAT_HEIGHT])
        if w < 4 or h < 4:
            continue
        fill_ratio = area / max(1.0, float(w * h))
        if fill_ratio < 0.08:
            continue
        centroid = centroids[label]
        center_bonus = 1.0 - min(1.0, float(np.linalg.norm(centroid - crop_center) / max_center_distance))
        edge_penalty = 0.55 if x <= 1 or y <= 1 or x + w >= mask.shape[1] - 1 or y + h >= mask.shape[0] - 1 else 1.0
        score = area * (0.75 + center_bonus * 0.5) * edge_penalty
        candidates.append((score, label))

    if not candidates:
        return None

    candidates.sort(reverse=True)
    keep = np.zeros(mask.shape, dtype="uint8")
    kept_area = 0
    for _, label in candidates[:4]:
        component = labels == label
        area = int(np.count_nonzero(component))
        if kept_area + area > max_component_area and kept_area > 0:
            continue
        keep[component] = 255
        kept_area += area

    if kept_area < min_component_area:
        return None

    kernel = np.ones((3, 3), np.uint8)
    keep = cv2.morphologyEx(keep, cv2.MORPH_CLOSE, kernel)
    fill_pixels = int(np.count_nonzero(keep > 0))
    return keep, {
        "backend": "osm-fill",
        "fill_pixels": fill_pixels,
        "fill_ratio": round(fill_pixels / max(1.0, crop_area), 5),
        "component_candidates": len(candidates),
        "prompt_constraint": allowed_mask is not None,
        "min_pixel_ratio": OSM_FILL_MIN_PIXEL_RATIO,
        "max_area_ratio": OSM_FILL_MAX_AREA_RATIO,
        **distance_meta,
    }


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


def _segment_with_osm_water(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    prompt_geometry: dict | None,
    image_extent: list[float] | None,
) -> tuple[dict, float, dict] | None:
    water_result = _predict_osm_water_crop_mask(image, bbox, prompt_geometry, image_extent)
    if water_result is None:
        return None

    crop_mask, water_meta = water_result
    full_mask = _full_mask_from_crop_mask(crop_mask, image, bbox)
    polygon = _mask_to_polygon(
        full_mask,
        bbox,
        image.size,
        image_extent,
        prompt_geometry,
        simplify_ratio=OSM_WATER_LARGE_SIMPLIFY_RATIO if water_meta.get("large_prompt") else OSM_WATER_SIMPLIFY_RATIO,
    )
    if polygon is None:
        return None

    geometry, geometry_confidence, point_count = polygon
    water_ratio = float(np.count_nonzero(crop_mask > 0)) / max(1.0, float(crop_mask.size))
    confidence = min(0.92, max(0.42, (geometry_confidence + min(0.9, water_ratio * 8.0 + 0.35)) / 2))
    return geometry, confidence, {
        **water_meta,
        "point_count": point_count,
        "simplify_ratio": OSM_WATER_LARGE_SIMPLIFY_RATIO if water_meta.get("large_prompt") else OSM_WATER_SIMPLIFY_RATIO,
    }


def _segment_with_osm_forest(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    prompt_geometry: dict | None,
    image_extent: list[float] | None,
) -> tuple[dict, float, dict] | None:
    forest_result = _predict_osm_forest_crop_mask(image, bbox, prompt_geometry, image_extent)
    if forest_result is None:
        return None

    crop_mask, forest_meta = forest_result
    full_mask = _full_mask_from_crop_mask(crop_mask, image, bbox)
    polygon = _mask_to_polygon(
        full_mask,
        bbox,
        image.size,
        image_extent,
        prompt_geometry,
        simplify_ratio=OSM_FOREST_LARGE_SIMPLIFY_RATIO if forest_meta.get("large_prompt") else OSM_FOREST_SIMPLIFY_RATIO,
    )
    if polygon is None:
        return None

    geometry, geometry_confidence, point_count = polygon
    forest_ratio = float(np.count_nonzero(crop_mask > 0)) / max(1.0, float(crop_mask.size))
    confidence = min(0.88, max(0.38, (geometry_confidence + min(0.86, forest_ratio * 4.5 + 0.32)) / 2))
    return geometry, confidence, {
        **forest_meta,
        "point_count": point_count,
        "simplify_ratio": OSM_FOREST_LARGE_SIMPLIFY_RATIO if forest_meta.get("large_prompt") else OSM_FOREST_SIMPLIFY_RATIO,
    }


def _segment_with_osm_local_rf(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    prompt_geometry: dict | None,
    image_extent: list[float] | None,
    target_type: Literal["water", "forest"],
) -> tuple[dict, float, dict] | None:
    ml_result = _predict_osm_local_rf_crop_mask(image, bbox, prompt_geometry, image_extent, target_type)
    if ml_result is None:
        return None

    crop_mask, ml_meta = ml_result
    full_mask = _full_mask_from_crop_mask(crop_mask, image, bbox)
    simplify_ratio = OSM_WATER_LARGE_SIMPLIFY_RATIO if target_type == "water" else OSM_FOREST_LARGE_SIMPLIFY_RATIO
    polygon = _mask_to_polygon(
        full_mask,
        bbox,
        image.size,
        image_extent,
        prompt_geometry,
        simplify_ratio=simplify_ratio,
    )
    if polygon is None:
        return None

    geometry, geometry_confidence, point_count = polygon
    predicted_ratio = float(np.count_nonzero(crop_mask > 0)) / max(1.0, float(crop_mask.size))
    confidence = min(0.86, max(0.36, (geometry_confidence + min(0.82, predicted_ratio * 4.0 + 0.28)) / 2))
    return geometry, confidence, {
        **ml_meta,
        "point_count": point_count,
        "simplify_ratio": simplify_ratio,
    }


def _segment_with_osm_fill(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    prompt_geometry: dict | None,
    image_extent: list[float] | None,
) -> tuple[dict, float, dict] | None:
    fill_result = _predict_osm_fill_crop_mask(image, bbox, prompt_geometry, image_extent)
    if fill_result is None:
        return None

    crop_mask, fill_meta = fill_result
    full_mask = _full_mask_from_crop_mask(crop_mask, image, bbox)
    polygon = _mask_to_polygon(
        full_mask,
        bbox,
        image.size,
        image_extent,
        prompt_geometry,
        simplify_ratio=OSM_FILL_SIMPLIFY_RATIO,
    )
    if polygon is None:
        return None

    geometry, geometry_confidence, point_count = polygon
    fill_ratio = float(np.count_nonzero(crop_mask > 0)) / max(1.0, float(crop_mask.size))
    confidence = min(0.78, max(0.32, (geometry_confidence + min(0.75, fill_ratio * 4.0 + 0.22)) / 2))
    return geometry, confidence, {
        **fill_meta,
        "point_count": point_count,
        "simplify_ratio": OSM_FILL_SIMPLIFY_RATIO,
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
            mask_constraint=full_mask,
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
    mask_constraint: np.ndarray | None = None,
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

    selected_mask = _constrain_refined_mask(masks[best_index], mask_constraint)
    polygon = _mask_to_polygon(selected_mask, bbox, image.size, image_extent, prompt_geometry)
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
        "mask_constraint_used": mask_constraint is not None,
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
            mask_constraint=full_mask,
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
            message="AI-предложение сейчас возвращает полигон. Проверьте и при необходимости отредактируйте результат.",
            meta={"backend": "classical-cv", "reason": "target_geometry_type_not_supported"},
        )

    fallback_reason: str | None = None
    water_target_layer = payload.target_semantic_type == "water" or _is_water_target_layer(payload.target_layer_name)
    forest_target_layer = payload.target_semantic_type == "forest" or _is_forest_target_layer(payload.target_layer_name)
    allow_osm_water = water_target_layer or (OSM_WATER_HEURISTIC_ENABLED and not forest_target_layer)
    allow_osm_forest = forest_target_layer or (OSM_FOREST_HEURISTIC_ENABLED and not water_target_layer)
    allow_osm_fill = OSM_FILL_HEURISTIC_ENABLED and not water_target_layer and not forest_target_layer
    osm_water_result = (
        _segment_with_osm_water(image, bbox, payload.prompt_geometry, payload.image_extent)
        if allow_osm_water
        else None
    )
    if osm_water_result is not None:
        geometry, confidence, meta = osm_water_result
        quality = _evaluate_prompt_quality(
            geometry,
            payload.prompt_geometry,
            bbox,
            (width, height),
            payload.image_extent,
            rough_prompt=True,
        )
        if quality.get("passed", True):
            return SegmentBoxResponse(
                status="passed",
                geometry=geometry,
                confidence=confidence,
                message="AI-предложение построено по водным цветам OSM. Проверьте и при необходимости отредактируйте контур.",
                meta={**meta, "quality_gate": quality},
            )
        fallback_reason = f"osm_water_rejected:{quality.get('reason')}"
    elif allow_osm_water:
        fallback_reason = "osm_water_no_mask"

    osm_forest_result = (
        _segment_with_osm_forest(image, bbox, payload.prompt_geometry, payload.image_extent)
        if allow_osm_forest
        else None
    )
    if osm_forest_result is not None:
        geometry, confidence, meta = osm_forest_result
        quality = _evaluate_prompt_quality(
            geometry,
            payload.prompt_geometry,
            bbox,
            (width, height),
            payload.image_extent,
            rough_prompt=True,
        )
        if quality.get("passed", True):
            return SegmentBoxResponse(
                status="passed",
                geometry=geometry,
                confidence=confidence,
                message="AI suggestion was built from OSM forest/wood colors. Review and edit the contour if needed.",
                meta={**meta, "quality_gate": quality},
            )
        fallback_reason = f"osm_forest_rejected:{quality.get('reason')}"
    elif allow_osm_forest:
        fallback_reason = "osm_forest_no_mask"

    osm_fill_result = _segment_with_osm_fill(image, bbox, payload.prompt_geometry, payload.image_extent) if allow_osm_fill else None
    if osm_fill_result is not None:
        geometry, confidence, meta = osm_fill_result
        quality = _evaluate_prompt_quality(
            geometry,
            payload.prompt_geometry,
            bbox,
            (width, height),
            payload.image_extent,
            rough_prompt=True,
        )
        if quality.get("passed", True):
            return SegmentBoxResponse(
                status="passed",
                geometry=geometry,
                confidence=confidence,
                message="AI-предложение построено по заливке на OSM. Проверьте и при необходимости отредактируйте контур.",
                meta={**meta, "quality_gate": quality},
            )
        fallback_reason = f"osm_fill_rejected:{quality.get('reason')}"

    target_rf_type: Literal["water", "forest"] | None = "water" if water_target_layer else "forest" if forest_target_layer else None
    if target_rf_type is not None:
        osm_rf_result = _segment_with_osm_local_rf(image, bbox, payload.prompt_geometry, payload.image_extent, target_rf_type)
        if osm_rf_result is not None:
            geometry, confidence, meta = osm_rf_result
            quality = _evaluate_prompt_quality(
                geometry,
                payload.prompt_geometry,
                bbox,
                (width, height),
                payload.image_extent,
                rough_prompt=True,
            )
            if quality.get("passed", True):
                return SegmentBoxResponse(
                    status="passed",
                    geometry=geometry,
                    confidence=confidence,
                    message="AI-предложение построено локальной ML-моделью Random Forest по пикселям OSM. Проверьте и при необходимости отредактируйте контур.",
                    meta={**meta, "quality_gate": quality},
                )
            fallback_reason = f"osm_local_rf_rejected:{quality.get('reason')}"
        elif fallback_reason is None:
            fallback_reason = "osm_local_rf_no_mask"

    if water_target_layer or forest_target_layer:
        return SegmentBoxResponse(
            status="fallback",
            geometry=_prompt_geometry_fallback(payload.prompt_geometry, bbox, (width, height), payload.image_extent),
            confidence=0.2,
            message="AI-предложение не найдено надёжно для выбранного типа слоя. Возвращён контур пользователя, чтобы не подменять объект другим классом.",
            meta={
                "backend": "target-class-guard",
                "target_layer_name": payload.target_layer_name,
                "target_semantic_type": payload.target_semantic_type,
                "water_target_layer": water_target_layer,
                "forest_target_layer": forest_target_layer,
                "reason": fallback_reason or "target_class_not_detected",
                "skipped_generic_prompt_ml": True,
            },
        )

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
                        message="AI-предложение отклонено: контур хуже черновика. Возвращен контур пользователя.",
                        meta={**meta, "quality_gate": quality, "rejected_backend": meta.get("backend", "prompt-ml+sam2")},
                    )
                return SegmentBoxResponse(
                    status="passed",
                    geometry=geometry,
                    confidence=confidence,
                    message="AI-предложение построено по подсказке и уточнено SAM2. Проверьте и отредактируйте контур при необходимости.",
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
                        message="AI-предложение отклонено: контур хуже черновика. Возвращен контур пользователя.",
                        meta={**meta, "quality_gate": quality, "rejected_backend": "prompt-ml"},
                    )
                return SegmentBoxResponse(
                    status="passed",
                    geometry=geometry,
                    confidence=confidence,
                    message="AI-предложение построено по подсказке и пикселям карты. Проверьте и отредактируйте контур при необходимости.",
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
                        message="AI-предложение отклонено: контур хуже черновика. Возвращен контур пользователя.",
                        meta={**meta, "quality_gate": quality, "rejected_backend": meta.get("backend", "water-unet+sam2")},
                    )
                return SegmentBoxResponse(
                    status="passed",
                    geometry=geometry,
                    confidence=confidence,
                    message="AI-предложение водного объекта уточнено SAM2. Проверьте и отредактируйте контур при необходимости.",
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
                        message="AI-предложение отклонено: контур хуже черновика. Возвращен контур пользователя.",
                        meta={**meta, "quality_gate": quality, "rejected_backend": "water-unet"},
                    )
                return SegmentBoxResponse(
                    status="passed",
                    geometry=geometry,
                    confidence=confidence,
                    message="AI-предложение водного объекта построено моделью сегментации. Проверьте и отредактируйте контур при необходимости.",
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
                        message="AI-предложение отклонено: контур хуже черновика. Возвращен контур пользователя.",
                        meta={**meta, "quality_gate": quality, "rejected_backend": meta.get("backend", "sam2")},
                    )
                return SegmentBoxResponse(
                    status="passed",
                    geometry=geometry,
                    confidence=confidence,
                    message="AI-предложение построено SAM2 по подсказке. Проверьте и отредактируйте контур при необходимости.",
                    meta={**meta, "quality_gate": quality},
                )
            fallback_reason = "sam2_no_mask"
        except RuntimeError as exc:
            fallback_reason = str(exc)

    configured_ai_backends = (
        PROMPT_ML_BACKENDS
        | PROMPT_ML_SAM2_BACKENDS
        | WATER_UNET_BACKENDS
        | WATER_SAM2_BACKENDS
        | SAM2_BACKENDS
    )
    if AI_DIGITIZER_BACKEND in configured_ai_backends and fallback_reason and payload.prompt_geometry:
        return SegmentBoxResponse(
            status="fallback",
            geometry=_prompt_geometry_fallback(payload.prompt_geometry, bbox, (width, height), payload.image_extent),
            confidence=0.2,
            message="AI-предложение ненадежно. Возвращен исходный контур для ручного редактирования.",
            meta={
                "backend": AI_DIGITIZER_BACKEND,
                "reason": fallback_reason,
                "fallback": "student_prompt",
            },
        )

    contour = _segment_largest_contour(image, bbox, payload.prompt_geometry, payload.image_extent)
    if contour is None:
        geometry = _bbox_polygon(bbox, (width, height), payload.image_extent)
        return SegmentBoxResponse(
            status="fallback",
            geometry=geometry,
            confidence=0.25,
            message="Надежный контур не найден. Возвращена выбранная область как черновой полигон.",
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
            message="AI-предложение отклонено: контур хуже черновика. Возвращен контур пользователя.",
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
        message="AI-предложение построено по подсказке. Проверьте и отредактируйте контур при необходимости.",
        meta={
            "backend": "classical-cv",
            "fallback_from": AI_DIGITIZER_BACKEND if fallback_reason else None,
            "fallback_reason": fallback_reason,
            "method": method,
            "point_count": len(ring),
            "quality_gate": quality,
        },
    )
