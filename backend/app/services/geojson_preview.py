import io
import json
import tempfile
import zipfile
from functools import lru_cache
from pathlib import Path
from typing import Any

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import GeometryCollection, MultiLineString, MultiPoint, MultiPolygon, box
from shapely.ops import transform as shapely_transform
from shapely.ops import unary_union

MAX_PREVIEW_FEATURES = 5000
# Бюджет вершин на превью: больше — браузер начинает лагать на отрисовке.
MAX_PREVIEW_TOTAL_COORDINATES = 120_000
DATA_DIR = Path(__file__).resolve().parents[1] / "data"
RUSSIA_BOUNDARY_PATH = DATA_DIR / "russia_boundary.geojson"
BBoxWgs84 = tuple[float, float, float, float]


def parse_preview_bbox(value: str | None) -> BBoxWgs84 | None:
    if not value:
        return None
    try:
        parts = [float(part.strip()) for part in value.split(",")]
    except ValueError as exc:
        raise ValueError("bbox must contain numeric values: minx,miny,maxx,maxy") from exc
    if len(parts) != 4:
        raise ValueError("bbox must contain exactly four values: minx,miny,maxx,maxy")
    minx, miny, maxx, maxy = parts
    if minx >= maxx or miny >= maxy:
        raise ValueError("bbox min values must be smaller than max values")
    if minx < -180 or maxx > 180 or miny < -90 or maxy > 90:
        raise ValueError("bbox must be in EPSG:4326 longitude/latitude bounds")
    return minx, miny, maxx, maxy


def _feature_collection_from_gdf(gdf: gpd.GeoDataFrame, max_features: int) -> dict[str, Any]:
    limited = gdf.head(max_features).copy()
    text = limited.to_json()
    data = json.loads(text)
    if data.get("type") != "FeatureCollection":
        return {"type": "FeatureCollection", "features": []}
    return data


def _prepare_gdf(gdf: gpd.GeoDataFrame) -> tuple[gpd.GeoDataFrame, str | None, str]:
    source_crs = gdf.crs.to_string() if gdf.crs else None
    display_crs = source_crs or "unknown"

    if gdf.crs is not None and source_crs != "EPSG:4326":
        gdf = gdf.to_crs("EPSG:4326")
        display_crs = "EPSG:4326"

    return gdf, source_crs, display_crs


def _drop_empty_geometries(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf
    geometry = gdf.geometry
    return gdf.loc[geometry.notna() & ~geometry.is_empty].copy()


def _make_valid_preview_geometries(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf
    fixed = gdf.copy()
    fixed.geometry = fixed.geometry.make_valid()
    return _drop_empty_geometries(fixed)


def _intersects_mask(gdf: gpd.GeoDataFrame, geometry: Any):
    source_geometry = gdf.geometry
    try:
        return source_geometry.notna() & ~source_geometry.is_empty & source_geometry.intersects(geometry)
    except Exception:
        fixed = _make_valid_preview_geometries(gdf)
        fixed_geometry = fixed.geometry
        mask = fixed_geometry.notna() & ~fixed_geometry.is_empty & fixed_geometry.intersects(geometry)
        return mask.reindex(gdf.index, fill_value=False)


def _safe_clip(gdf: gpd.GeoDataFrame, clip_geometry: Any) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf
    try:
        return gpd.clip(gdf, clip_geometry)
    except Exception:
        fixed = _make_valid_preview_geometries(gdf)
        try:
            return gpd.clip(fixed, clip_geometry)
        except Exception:
            # Some old training shapefiles contain topology errors that QGIS can
            # display but GEOS cannot clip. Keep preview usable instead of
            # failing the whole layer.
            return fixed


def _filter_gdf_to_bbox(gdf: gpd.GeoDataFrame, bbox_wgs84: BBoxWgs84 | None) -> gpd.GeoDataFrame:
    if bbox_wgs84 is None or gdf.empty:
        return gdf
    try:
        fixed = _make_valid_preview_geometries(gdf)
        bbox_geometry = box(*bbox_wgs84)
        mask = _intersects_mask(fixed, bbox_geometry)
        return fixed.loc[mask].copy()
    except Exception:
        # Невалидная геометрия старых shapefile может ронять GEOS даже после
        # make_valid. Не валим превью — показываем слой без bbox-фильтра.
        return gdf


def _geometry_dimension(value: Any) -> str:
    geom_type = getattr(value, "geom_type", "")
    if geom_type in {"Polygon", "MultiPolygon"}:
        return "area"
    if geom_type in {"LineString", "MultiLineString", "LinearRing"}:
        return "length"
    if geom_type in {"Point", "MultiPoint"}:
        return "point"
    return "other"


def _geometry_parts_by_dimension(value: Any, dimension: str) -> list[Any]:
    if value is None or getattr(value, "is_empty", True):
        return []
    geom_type = getattr(value, "geom_type", "")
    if geom_type in {"MultiPolygon", "MultiLineString", "MultiPoint"}:
        parts: list[Any] = []
        for item in value.geoms:
            parts.extend(_geometry_parts_by_dimension(item, dimension))
        return parts
    if dimension == _geometry_dimension(value):
        return [value]
    if isinstance(value, GeometryCollection):
        parts: list[Any] = []
        for item in value.geoms:
            parts.extend(_geometry_parts_by_dimension(item, dimension))
        return parts
    return []


def _coerce_geometry_to_dimension(value: Any, dimension: str) -> Any:
    parts = _geometry_parts_by_dimension(value, dimension)
    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    merged = unary_union(parts)
    merged_parts = _geometry_parts_by_dimension(merged, dimension)
    if not merged_parts:
        return None
    if len(merged_parts) == 1:
        return merged_parts[0]
    if dimension == "area":
        return MultiPolygon(merged_parts)
    if dimension == "length":
        return MultiLineString(merged_parts)
    if dimension == "point":
        return MultiPoint(merged_parts)
    return merged


def _keep_clipped_geometry_by_source_dimension(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty or "_preview_source_dimension" not in gdf.columns:
        return gdf

    filtered = gdf.copy()
    filtered.geometry = [
        _coerce_geometry_to_dimension(geometry, dimension) if dimension != "other" else geometry
        for geometry, dimension in zip(filtered.geometry, filtered["_preview_source_dimension"], strict=False)
    ]
    filtered = _drop_empty_geometries(filtered)
    return filtered.drop(columns=["_preview_source_dimension"], errors="ignore")


@lru_cache(maxsize=1)
def _load_russia_boundary():
    if not RUSSIA_BOUNDARY_PATH.exists():
        raise ValueError(f"Russia boundary file is missing: {RUSSIA_BOUNDARY_PATH}")
    boundary_gdf = gpd.read_file(RUSSIA_BOUNDARY_PATH)
    if boundary_gdf.crs is not None and boundary_gdf.crs.to_string() != "EPSG:4326":
        boundary_gdf = boundary_gdf.to_crs("EPSG:4326")
    geometry = boundary_gdf.geometry.make_valid()
    geometry = geometry[geometry.notna() & ~geometry.is_empty]
    if geometry.empty:
        raise ValueError("Russia boundary file does not contain valid geometry")
    return geometry.union_all()


def _clip_gdf_to_boundary(gdf: gpd.GeoDataFrame, boundary: str | None) -> gpd.GeoDataFrame:
    if boundary is None or gdf.empty:
        return gdf
    if boundary != "russia":
        raise ValueError(f"Unsupported clip boundary: {boundary}")
    try:
        boundary_geometry = _load_russia_boundary()
        fixed = _make_valid_preview_geometries(gdf)
        mask = _intersects_mask(fixed, boundary_geometry)
        filtered = fixed.loc[mask].copy()
        if filtered.empty:
            return filtered
        filtered["_preview_source_dimension"] = filtered.geometry.map(_geometry_dimension)
        clipped = _safe_clip(filtered, boundary_geometry)
        if clipped.empty:
            return clipped.drop(columns=["_preview_source_dimension"], errors="ignore")
        clipped = _drop_empty_geometries(clipped)
        return _keep_clipped_geometry_by_source_dimension(clipped)
    except Exception:
        # Любая топологическая ошибка при обрезке (даже после make_valid) — не
        # роняем превью целиком, показываем слой без обрезки по границе.
        try:
            return _drop_empty_geometries(_make_valid_preview_geometries(gdf))
        except Exception:
            return gdf


def _lonlat_bounds_sane(gdf: gpd.GeoDataFrame) -> bool:
    """Координаты похожи на градусы WGS84 (а не метры проекции)."""
    try:
        minx, miny, maxx, maxy = gdf.total_bounds
    except Exception:
        return False
    return minx >= -180.5 and maxx <= 180.5 and miny >= -90.5 and maxy <= 90.5


def _shift_lon_plus360(x, y, z=None):
    x = np.where(np.asarray(x) < 0, np.asarray(x) + 360.0, x)
    return (x, y) if z is None else (x, y, z)


def _shift_lon_minus360(x, y, z=None):
    return (np.asarray(x) - 360.0, y) if z is None else (np.asarray(x) - 360.0, y, z)


def _split_antimeridian_geometry(geometry: Any) -> Any:
    """Режет геометрию, пересекающую 180-й меридиан, на западную и восточную
    части, чтобы на карте она не рисовалась «прямоугольником» через весь мир.
    Любая ошибка — возвращаем исходную геометрию."""
    if geometry is None or getattr(geometry, "is_empty", True):
        return geometry
    try:
        minx, _, maxx, _ = geometry.bounds
        if (maxx - minx) <= 180.0:
            return geometry
        shifted = shapely_transform(_shift_lon_plus360, geometry)
        west = shifted.intersection(box(-180.0, -90.0, 180.0, 90.0))
        east = shifted.intersection(box(180.0, -90.0, 540.0, 90.0))
        parts = []
        if west is not None and not west.is_empty:
            parts.append(west)
        if east is not None and not east.is_empty:
            parts.append(shapely_transform(_shift_lon_minus360, east))
        if not parts:
            return geometry
        merged = unary_union(parts)
        return geometry if merged.is_empty else merged
    except Exception:
        return geometry


def _normalize_antimeridian(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Применяет разрез по антимеридиану только к слоям в градусах, где есть
    объекты с разбросом долгот > 180 (признак «обёртки» через 180°)."""
    if gdf.empty or not _lonlat_bounds_sane(gdf):
        return gdf
    try:
        bounds = gdf.geometry.bounds
        if not ((bounds["maxx"] - bounds["minx"]) > 180.0).any():
            return gdf
        fixed = gdf.copy()
        fixed.geometry = fixed.geometry.apply(_split_antimeridian_geometry)
        return _drop_empty_geometries(fixed)
    except Exception:
        return gdf


def _total_coordinate_count(gdf: gpd.GeoDataFrame) -> int:
    try:
        import shapely

        return int(shapely.get_num_coordinates(gdf.geometry.array).sum())
    except Exception:
        return 0


def _simplify_for_preview(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Упрощает геометрию тяжёлых слоёв до бюджета вершин, чтобы карта не
    лагала. Маленькие слои (учебные работы) не трогает вообще."""
    if gdf.empty:
        return gdf
    total = _total_coordinate_count(gdf)
    if total <= MAX_PREVIEW_TOTAL_COORDINATES:
        return gdf
    try:
        minx, miny, maxx, maxy = gdf.total_bounds
        extent = max(maxx - minx, maxy - miny)
        if not extent or extent <= 0:
            return gdf
        tolerance = extent / 20000.0
        simplified = gdf
        for _ in range(6):
            candidate = gdf.copy()
            candidate.geometry = gdf.geometry.simplify(tolerance, preserve_topology=True)
            candidate = _drop_empty_geometries(candidate)
            simplified = candidate
            if _total_coordinate_count(candidate) <= MAX_PREVIEW_TOTAL_COORDINATES:
                break
            tolerance *= 2
        return simplified if not simplified.empty else gdf
    except Exception:
        return gdf


def _repair_cp1251_text(value: Any) -> Any:
    """Старые shapefile часто в cp1251 без .cpg → читаются как latin-1 и дают
    крякозябры. Чиним только если round-trip latin-1 → cp1251 даёт кириллицу;
    настоящий UTF-8/ASCII при этом не трогается."""
    if not isinstance(value, str) or not value:
        return value
    try:
        repaired = value.encode("latin-1").decode("cp1251")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value
    cyr_repaired = sum(1 for ch in repaired if "Ѐ" <= ch <= "ӿ")
    cyr_original = sum(1 for ch in value if "Ѐ" <= ch <= "ӿ")
    return repaired if cyr_repaired > cyr_original else value


def _repair_attribute_encoding(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf
    try:
        geom_col = gdf.geometry.name
    except Exception:
        geom_col = "geometry"
    for col in gdf.columns:
        if col == geom_col:
            continue
        # geopandas/pyogrio может вернуть строковые поля как numpy ``object``
        # ЛИБО как новый строковый dtype pandas (``string``/``str``). Раньше
        # проверялось только ``object`` → на окружениях с string-dtype (WSL)
        # столбцы молча пропускались и cp1251 не чинился. Берём оба варианта,
        # а нестроковые значения отсекает сам ``_repair_cp1251_text``.
        if not (pd.api.types.is_object_dtype(gdf[col]) or pd.api.types.is_string_dtype(gdf[col])):
            continue
        try:
            gdf[col] = gdf[col].map(_repair_cp1251_text)
        except Exception:
            continue
    return gdf


def _find_shp_files(root: Path) -> list[Path]:
    return sorted(
        path
        for path in root.rglob("*")
        if path.is_file() and path.suffix.lower() == ".shp"
    )


def build_geojson_preview(
    *,
    asset_id: int,
    asset_name: str,
    detected_format: str,
    file_bytes: bytes,
    max_features: int = MAX_PREVIEW_FEATURES,
    bbox_wgs84: BBoxWgs84 | None = None,
    clip_boundary: str | None = None,
) -> dict[str, Any]:
    if detected_format == "geojson":
        return _build_geojson_file_preview(
            asset_id=asset_id,
            asset_name=asset_name,
            detected_format=detected_format,
            file_bytes=file_bytes,
            max_features=max_features,
            bbox_wgs84=bbox_wgs84,
            clip_boundary=clip_boundary,
        )

    if detected_format == "shapefile_zip":
        return _build_shapefile_zip_preview(
            asset_id=asset_id,
            asset_name=asset_name,
            detected_format=detected_format,
            file_bytes=file_bytes,
            max_features=max_features,
            bbox_wgs84=bbox_wgs84,
            clip_boundary=clip_boundary,
        )

    raise ValueError(f"Unsupported preview format: {detected_format}")


def _build_geojson_file_preview(
    *,
    asset_id: int,
    asset_name: str,
    detected_format: str,
    file_bytes: bytes,
    max_features: int,
    bbox_wgs84: BBoxWgs84 | None,
    clip_boundary: str | None,
) -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as tmp_dir:
        geojson_path = Path(tmp_dir) / "input.geojson"
        geojson_path.write_bytes(file_bytes)
        gdf = gpd.read_file(geojson_path)
        gdf = _repair_attribute_encoding(gdf)

    original_count = len(gdf)
    gdf, source_crs, display_crs = _prepare_gdf(gdf)
    gdf = _normalize_antimeridian(gdf)
    gdf = _filter_gdf_to_bbox(gdf, bbox_wgs84)
    gdf = _clip_gdf_to_boundary(gdf, clip_boundary)
    gdf = _simplify_for_preview(gdf)
    filtered_count = len(gdf)
    geojson = _feature_collection_from_gdf(gdf, max_features)

    return {
        "asset_id": asset_id,
        "asset_name": asset_name,
        "detected_format": detected_format,
        "source_crs": source_crs,
        "crs": display_crs,
        "feature_count": filtered_count,
        "original_feature_count": original_count,
        "bbox_filter": list(bbox_wgs84) if bbox_wgs84 else None,
        "clip_boundary": clip_boundary,
        "preview_feature_count": len(geojson.get("features", [])),
        "truncated": filtered_count > max_features,
        "geojson": geojson,
    }


def _build_shapefile_zip_preview(
    *,
    asset_id: int,
    asset_name: str,
    detected_format: str,
    file_bytes: bytes,
    max_features: int,
    bbox_wgs84: BBoxWgs84 | None,
    clip_boundary: str | None,
) -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
            for member in archive.infolist():
                member_path = tmp_path / member.filename
                resolved_path = member_path.resolve()
                try:
                    resolved_path.relative_to(tmp_path.resolve())
                except ValueError:
                    continue
                if member.is_dir():
                    resolved_path.mkdir(parents=True, exist_ok=True)
                    continue
                resolved_path.parent.mkdir(parents=True, exist_ok=True)
                resolved_path.write_bytes(archive.read(member))

        shp_files = _find_shp_files(tmp_path)
        if not shp_files:
            raise ValueError("No .shp file found in shapefile_zip asset")

        gdf = gpd.read_file(shp_files[0])
        gdf = _repair_attribute_encoding(gdf)

    original_count = len(gdf)
    gdf, source_crs, display_crs = _prepare_gdf(gdf)
    gdf = _normalize_antimeridian(gdf)
    gdf = _filter_gdf_to_bbox(gdf, bbox_wgs84)
    gdf = _clip_gdf_to_boundary(gdf, clip_boundary)
    gdf = _simplify_for_preview(gdf)
    filtered_count = len(gdf)
    geojson = _feature_collection_from_gdf(gdf, max_features)

    return {
        "asset_id": asset_id,
        "asset_name": asset_name,
        "detected_format": detected_format,
        "source_crs": source_crs,
        "crs": display_crs,
        "feature_count": filtered_count,
        "original_feature_count": original_count,
        "bbox_filter": list(bbox_wgs84) if bbox_wgs84 else None,
        "clip_boundary": clip_boundary,
        "preview_feature_count": len(geojson.get("features", [])),
        "truncated": filtered_count > max_features,
        "geojson": geojson,
    }