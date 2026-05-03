import io
import json
import tempfile
import zipfile
from pathlib import Path
from typing import Any

import geopandas as gpd

MAX_PREVIEW_FEATURES = 500


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
) -> dict[str, Any]:
    if detected_format == "geojson":
        return _build_geojson_file_preview(
            asset_id=asset_id,
            asset_name=asset_name,
            detected_format=detected_format,
            file_bytes=file_bytes,
            max_features=max_features,
        )

    if detected_format == "shapefile_zip":
        return _build_shapefile_zip_preview(
            asset_id=asset_id,
            asset_name=asset_name,
            detected_format=detected_format,
            file_bytes=file_bytes,
            max_features=max_features,
        )

    raise ValueError(f"Unsupported preview format: {detected_format}")


def _build_geojson_file_preview(
    *,
    asset_id: int,
    asset_name: str,
    detected_format: str,
    file_bytes: bytes,
    max_features: int,
) -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as tmp_dir:
        geojson_path = Path(tmp_dir) / "input.geojson"
        geojson_path.write_bytes(file_bytes)
        gdf = gpd.read_file(geojson_path)

    original_count = len(gdf)
    gdf, source_crs, display_crs = _prepare_gdf(gdf)
    geojson = _feature_collection_from_gdf(gdf, max_features)

    return {
        "asset_id": asset_id,
        "asset_name": asset_name,
        "detected_format": detected_format,
        "source_crs": source_crs,
        "crs": display_crs,
        "feature_count": original_count,
        "preview_feature_count": len(geojson.get("features", [])),
        "truncated": original_count > max_features,
        "geojson": geojson,
    }


def _build_shapefile_zip_preview(
    *,
    asset_id: int,
    asset_name: str,
    detected_format: str,
    file_bytes: bytes,
    max_features: int,
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
    geojson = _feature_collection_from_gdf(gdf, max_features)

    return {
        "asset_id": asset_id,
        "asset_name": asset_name,
        "detected_format": detected_format,
        "source_crs": source_crs,
        "crs": display_crs,
        "feature_count": original_count,
        "preview_feature_count": len(geojson.get("features", [])),
        "truncated": original_count > max_features,
        "geojson": geojson,
    }
