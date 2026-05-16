import io
import json
import tempfile
import zipfile
from functools import lru_cache
from pathlib import Path
from typing import Any

import geopandas as gpd
from shapely.geometry import box

MAX_PREVIEW_FEATURES = 500
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


def _filter_gdf_to_bbox(gdf: gpd.GeoDataFrame, bbox_wgs84: BBoxWgs84 | None) -> gpd.GeoDataFrame:
    if bbox_wgs84 is None or gdf.empty:
        return gdf
    bbox_geometry = box(*bbox_wgs84)
    geometry = gdf.geometry
    mask = geometry.notna() & ~geometry.is_empty & geometry.intersects(bbox_geometry)
    filtered = gdf.loc[mask].copy()
    if filtered.empty:
        return filtered

    clipped = gpd.clip(filtered, bbox_geometry)
    if clipped.empty:
        return clipped
    geometry = clipped.geometry
    return clipped.loc[geometry.notna() & ~geometry.is_empty].copy()


def _geometry_dimension(value: Any) -> str:
    geom_type = getattr(value, "geom_type", "")
    if geom_type in {"Polygon", "MultiPolygon"}:
        return "area"
    if geom_type in {"LineString", "MultiLineString", "LinearRing"}:
        return "length"
    if geom_type in {"Point", "MultiPoint"}:
        return "point"
    return "other"


def _keep_clipped_geometry_by_source_dimension(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty or "_preview_source_dimension" not in gdf.columns:
        return gdf

    geometry = gdf.geometry
    geom_type = geometry.geom_type
    source_dimension = gdf["_preview_source_dimension"]

    area_mask = source_dimension.eq("area") & geom_type.isin(["Polygon", "MultiPolygon"])
    length_mask = source_dimension.eq("length") & geom_type.isin(["LineString", "MultiLineString", "LinearRing"])
    point_mask = source_dimension.eq("point") & geom_type.isin(["Point", "MultiPoint"])
    other_mask = source_dimension.eq("other")

    filtered = gdf.loc[area_mask | length_mask | point_mask | other_mask].copy()
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
    boundary_geometry = _load_russia_boundary()
    geometry = gdf.geometry
    mask = geometry.notna() & ~geometry.is_empty & geometry.intersects(boundary_geometry)
    filtered = gdf.loc[mask].copy()
    if filtered.empty:
        return filtered
    filtered["_preview_source_dimension"] = filtered.geometry.map(_geometry_dimension)
    clipped = gpd.clip(filtered, boundary_geometry)
    if clipped.empty:
        return clipped.drop(columns=["_preview_source_dimension"], errors="ignore")
    geometry = clipped.geometry
    clipped = clipped.loc[geometry.notna() & ~geometry.is_empty].copy()
    return _keep_clipped_geometry_by_source_dimension(clipped)


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

    original_count = len(gdf)
    gdf, source_crs, display_crs = _prepare_gdf(gdf)
    gdf = _filter_gdf_to_bbox(gdf, bbox_wgs84)
    gdf = _clip_gdf_to_boundary(gdf, clip_boundary)
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

    original_count = len(gdf)
    gdf, source_crs, display_crs = _prepare_gdf(gdf)
    gdf = _filter_gdf_to_bbox(gdf, bbox_wgs84)
    gdf = _clip_gdf_to_boundary(gdf, clip_boundary)
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
