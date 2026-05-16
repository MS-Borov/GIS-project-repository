from __future__ import annotations

import argparse
import json
import math
import random
import tempfile
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

import geopandas as gpd
from PIL import Image, ImageDraw, ImageOps
from shapely.geometry import GeometryCollection, LineString, MultiLineString, MultiPoint, MultiPolygon, Point, Polygon, box


VECTOR_EXTENSIONS = {".shp", ".geojson", ".json"}
IGNORE_SUFFIXES = {".shp.xml", ".lock", ".sr.lock"}
TARGET_NAME_HINTS = (
    "road", "roads", "way", "ways", "rail", "hydro", "river", "water", "lake",
    "building", "buildings", "admin", "region", "landuse", "polygon", "area",
)


@dataclass
class RenderLayer:
    name: str
    path: str
    geometry_type: str
    crs: str | None
    feature_count: int
    geodataframe: gpd.GeoDataFrame


@dataclass
class DatasetItem:
    split: str
    source: str
    target_layer: str
    image: str
    mask: str
    x: int
    y: int
    width: int
    height: int
    bounds: list[float]
    mask_nonzero_ratio: float


def _safe_name(value: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in {"-", "_"} else "_" for char in value.strip())
    return cleaned.strip("_").lower() or "layer"


def _is_ignored_file(path: Path) -> bool:
    lowered = path.name.lower()
    return any(lowered.endswith(suffix) for suffix in IGNORE_SUFFIXES)


def _find_vector_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file() or _is_ignored_file(path):
            continue
        if path.suffix.lower() in VECTOR_EXTENSIONS:
            files.append(path)
    return sorted(files)


def _load_layer(path: Path, target_crs: str, assume_missing_crs: str | None) -> RenderLayer | None:
    try:
        gdf = gpd.read_file(path)
    except Exception as exc:
        print(f"Skip {path}: {exc}")
        return None

    if gdf.empty or "geometry" not in gdf:
        return None

    gdf = gdf[gdf.geometry.notna()].copy()
    gdf = gdf[~gdf.geometry.is_empty].copy()
    if gdf.empty:
        return None

    source_crs = str(gdf.crs) if gdf.crs else None
    if gdf.crs is not None:
        try:
            gdf = gdf.to_crs(target_crs)
        except Exception as exc:
            print(f"Could not reproject {path} from {gdf.crs} to {target_crs}: {exc}")
            return None
    elif assume_missing_crs:
        try:
            gdf = gdf.set_crs(assume_missing_crs, allow_override=True).to_crs(target_crs)
            source_crs = assume_missing_crs
        except Exception as exc:
            print(f"Could not assign missing CRS {assume_missing_crs} to {path}: {exc}")
            source_crs = None

    geom_types = sorted({geom.geom_type for geom in gdf.geometry if geom is not None})
    return RenderLayer(
        name=path.stem,
        path=str(path),
        geometry_type=", ".join(geom_types),
        crs=source_crs,
        feature_count=len(gdf),
        geodataframe=gdf,
    )


def _load_layers(root: Path, target_crs: str, assume_missing_crs: str | None) -> list[RenderLayer]:
    layers: list[RenderLayer] = []
    for path in _find_vector_files(root):
        layer = _load_layer(path, target_crs=target_crs, assume_missing_crs=assume_missing_crs)
        if layer is not None:
            layers.append(layer)
    return layers


def _choose_target_layers(layers: list[RenderLayer], requested: list[str] | None) -> list[RenderLayer]:
    if requested:
        requested_keys = [_safe_name(item) for item in requested]
        selected = [
            layer for layer in layers
            if any(key in _safe_name(layer.name) for key in requested_keys)
        ]
        if not selected:
            available = ", ".join(layer.name for layer in layers)
            raise RuntimeError(f"No target layers matched {requested}. Available layers: {available}")
        return selected

    selected = [
        layer for layer in layers
        if any(hint in _safe_name(layer.name) for hint in TARGET_NAME_HINTS)
    ]
    return selected or layers


def _combined_bounds(layers: Iterable[RenderLayer]) -> tuple[float, float, float, float]:
    bounds = []
    for layer in layers:
        minx, miny, maxx, maxy = layer.geodataframe.total_bounds
        if all(math.isfinite(value) for value in (minx, miny, maxx, maxy)):
            bounds.append((minx, miny, maxx, maxy))
    if not bounds:
        raise RuntimeError("Could not calculate bounds for layers.")

    minx = min(item[0] for item in bounds)
    miny = min(item[1] for item in bounds)
    maxx = max(item[2] for item in bounds)
    maxy = max(item[3] for item in bounds)
    width = max(maxx - minx, 1.0)
    height = max(maxy - miny, 1.0)
    pad_x = width * 0.04
    pad_y = height * 0.04
    return minx - pad_x, miny - pad_y, maxx + pad_x, maxy + pad_y


def _tile_bounds(bounds: tuple[float, float, float, float], grid_size: int, index_x: int, index_y: int) -> tuple[float, float, float, float]:
    minx, miny, maxx, maxy = bounds
    tile_width = (maxx - minx) / grid_size
    tile_height = (maxy - miny) / grid_size
    left = minx + index_x * tile_width
    right = left + tile_width
    top = maxy - index_y * tile_height
    bottom = top - tile_height
    return left, bottom, right, top


def _world_to_pixel(x: float, y: float, bounds: tuple[float, float, float, float], size: int) -> tuple[float, float]:
    minx, miny, maxx, maxy = bounds
    px = (x - minx) / (maxx - minx) * size
    py = (maxy - y) / (maxy - miny) * size
    return px, py


def _coords_to_pixels(coords, bounds: tuple[float, float, float, float], size: int) -> list[tuple[float, float]]:
    return [_world_to_pixel(float(x), float(y), bounds, size) for x, y, *_ in coords]


def _style_for_layer(layer: RenderLayer) -> dict:
    key = _safe_name(layer.name)
    geom = layer.geometry_type.lower()
    if "hydro" in key or "river" in key or "water" in key or "lake" in key:
        return {"fill": "#75c7e8", "outline": "#0f6fa8", "line": "#1278d8", "width": 3}
    if "road" in key or "way" in key:
        return {"fill": "#f1b347", "outline": "#8a5a12", "line": "#2c2c2c", "width": 4}
    if "rail" in key:
        return {"fill": "#303030", "outline": "#303030", "line": "#202020", "width": 3}
    if "building" in key:
        return {"fill": "#d9a46b", "outline": "#8a5a2b", "line": "#8a5a2b", "width": 2}
    if "admin" in key or "region" in key:
        return {"fill": "#d9d6ef", "outline": "#7666b8", "line": "#7666b8", "width": 2}
    if "polygon" in geom or "area" in key or "landuse" in key:
        return {"fill": "#d9e8c2", "outline": "#7fa15e", "line": "#7fa15e", "width": 2}
    return {"fill": "#d8e8dd", "outline": "#08796d", "line": "#08796d", "width": 2}


def _draw_polygon(
    draw: ImageDraw.ImageDraw,
    geom: Polygon,
    bounds,
    size: int,
    fill,
    outline,
    width: int,
    hole_fill="#ffffff",
) -> None:
    exterior = _coords_to_pixels(geom.exterior.coords, bounds, size)
    if len(exterior) >= 3:
        draw.polygon(exterior, fill=fill, outline=outline)
        if width > 1:
            draw.line(exterior + [exterior[0]], fill=outline, width=width, joint="curve")
    for interior in geom.interiors:
        hole = _coords_to_pixels(interior.coords, bounds, size)
        if len(hole) >= 3:
            draw.polygon(hole, fill=hole_fill)


def _draw_line(draw: ImageDraw.ImageDraw, geom: LineString, bounds, size: int, fill, width: int) -> None:
    line = _coords_to_pixels(geom.coords, bounds, size)
    if len(line) >= 2:
        draw.line(line, fill=fill, width=width, joint="curve")


def _draw_point(draw: ImageDraw.ImageDraw, geom: Point, bounds, size: int, fill, radius: int) -> None:
    x, y = _world_to_pixel(geom.x, geom.y, bounds, size)
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill)


def _draw_geometry(draw: ImageDraw.ImageDraw, geom, bounds, size: int, style: dict, mask_mode: bool = False, line_width: int = 4) -> None:
    if geom is None or geom.is_empty:
        return

    if isinstance(geom, GeometryCollection):
        for part in geom.geoms:
            _draw_geometry(draw, part, bounds, size, style, mask_mode=mask_mode, line_width=line_width)
        return

    if mask_mode:
        fill = outline = "#ffffff"
        hole_fill = 0
        width = line_width
    else:
        fill = style["fill"]
        outline = style["outline"]
        hole_fill = "#ffffff"
        width = style["width"]

    if isinstance(geom, Polygon):
        _draw_polygon(draw, geom, bounds, size, fill=fill, outline=outline, width=width, hole_fill=hole_fill)
    elif isinstance(geom, MultiPolygon):
        for polygon in geom.geoms:
            _draw_polygon(draw, polygon, bounds, size, fill=fill, outline=outline, width=width, hole_fill=hole_fill)
    elif isinstance(geom, LineString):
        _draw_line(draw, geom, bounds, size, fill=outline if mask_mode else style["line"], width=width)
    elif isinstance(geom, MultiLineString):
        for line in geom.geoms:
            _draw_line(draw, line, bounds, size, fill=outline if mask_mode else style["line"], width=width)
    elif isinstance(geom, Point):
        _draw_point(draw, geom, bounds, size, fill=fill, radius=max(3, width + 1))
    elif isinstance(geom, MultiPoint):
        for point in geom.geoms:
            _draw_point(draw, point, bounds, size, fill=fill, radius=max(3, width + 1))


def _render_context(layers: list[RenderLayer], bounds, size: int) -> Image.Image:
    image = Image.new("RGB", (size, size), "#ffffff")
    draw = ImageDraw.Draw(image)
    tile_polygon = box(*bounds)

    polygon_layers = []
    line_layers = []
    point_layers = []
    for layer in layers:
        geom_type = layer.geometry_type.lower()
        if "polygon" in geom_type:
            polygon_layers.append(layer)
        elif "line" in geom_type:
            line_layers.append(layer)
        else:
            point_layers.append(layer)

    for layer in polygon_layers + line_layers + point_layers:
        style = _style_for_layer(layer)
        for geom in layer.geodataframe.geometry:
            if geom is not None and not geom.is_empty and geom.intersects(tile_polygon):
                _draw_geometry(draw, geom, bounds, size, style)
    return image


def _render_mask(layer: RenderLayer, bounds, size: int, line_width: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    tile_polygon = box(*bounds)
    style = {"fill": "#ffffff", "outline": "#ffffff", "line": "#ffffff", "width": line_width}
    for geom in layer.geodataframe.geometry:
        if geom is not None and not geom.is_empty and geom.intersects(tile_polygon):
            _draw_geometry(draw, geom, bounds, size, style, mask_mode=True, line_width=line_width)
    return mask


def _mask_nonzero_ratio(mask: Image.Image) -> float:
    gray = ImageOps.grayscale(mask)
    histogram = gray.histogram()
    total = sum(histogram) or 1
    return (total - histogram[0]) / total


def _assign_split(rng: random.Random, train_ratio: float, val_ratio: float) -> str:
    value = rng.random()
    if value < train_ratio:
        return "train"
    if value < train_ratio + val_ratio:
        return "val"
    return "test"


def _prepare_input_root(input_path: Path, temp_root: Path) -> Path:
    if input_path.is_dir():
        return input_path
    if input_path.suffix.lower() != ".zip":
        raise RuntimeError(f"Input must be a directory or ZIP archive: {input_path}")

    extract_root = temp_root / input_path.stem
    extract_root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(input_path) as archive:
        archive.extractall(extract_root)
    return extract_root


def build_render_dataset(
    input_paths: list[Path],
    output_dir: Path,
    target_layers: list[str] | None,
    render_crs: str,
    assume_missing_crs: str | None,
    tile_size: int,
    grid_size: int,
    min_mask_ratio: float,
    line_mask_width: int,
    train_ratio: float,
    val_ratio: float,
    seed: int,
) -> list[DatasetItem]:
    rng = random.Random(seed)
    output_dir.mkdir(parents=True, exist_ok=True)

    items: list[DatasetItem] = []
    for input_path in input_paths:
        with tempfile.TemporaryDirectory() as temp_name:
            root = _prepare_input_root(input_path, Path(temp_name))
            layers = _load_layers(root, target_crs=render_crs, assume_missing_crs=assume_missing_crs)

            if not layers:
                print(f"No readable vector layers found in {input_path}")
                continue

            targets = _choose_target_layers(layers, target_layers)
            bounds = _combined_bounds(layers)
            source_key = _safe_name(input_path.stem)
            print(f"{input_path}: loaded {len(layers)} layers. Targets: {', '.join(layer.name for layer in targets)}")

            for target in targets:
                target_key = _safe_name(target.name)
                target_items = 0
                for y in range(grid_size):
                    for x in range(grid_size):
                        current_bounds = _tile_bounds(bounds, grid_size=grid_size, index_x=x, index_y=y)
                        mask = _render_mask(target, current_bounds, tile_size, line_width=line_mask_width)
                        ratio = _mask_nonzero_ratio(mask)
                        if ratio < min_mask_ratio:
                            continue

                        image = _render_context(layers, current_bounds, tile_size)
                        split = _assign_split(rng, train_ratio=train_ratio, val_ratio=val_ratio)
                        tile_name = f"{source_key}_{target_key}_{x}_{y}.png"
                        image_rel = Path(split) / "images" / tile_name
                        mask_rel = Path(split) / "masks" / tile_name
                        image_path = output_dir / image_rel
                        mask_path = output_dir / mask_rel
                        image_path.parent.mkdir(parents=True, exist_ok=True)
                        mask_path.parent.mkdir(parents=True, exist_ok=True)
                        image.save(image_path)
                        mask.save(mask_path)

                        items.append(
                            DatasetItem(
                                split=split,
                                source=str(input_path),
                                target_layer=target.name,
                                image=str(image_rel).replace("\\", "/"),
                                mask=str(mask_rel).replace("\\", "/"),
                                x=x,
                                y=y,
                                width=tile_size,
                                height=tile_size,
                                bounds=[float(value) for value in current_bounds],
                                mask_nonzero_ratio=ratio,
                            )
                        )
                        target_items += 1

                print(f"{input_path.name} / {target.name}: {target_items} tiles")

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps([asdict(item) for item in items], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return items


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Render GIS vector layers into image/mask tiles for segmentation experiments."
    )
    parser.add_argument("--input", required=True, action="append", type=Path, help="Lab ZIP archive or directory with vector layers. Can be repeated.")
    parser.add_argument("--out", required=True, type=Path, help="Output dataset directory.")
    parser.add_argument("--target-layer", action="append", default=None, help="Layer name fragment to render as mask. Can be repeated.")
    parser.add_argument("--render-crs", default="EPSG:3857", help="CRS used for rendering.")
    parser.add_argument("--assume-missing-crs", default=None, help="Assign this CRS to layers without .prj/CRS before rendering.")
    parser.add_argument("--tile-size", type=int, default=512)
    parser.add_argument("--grid-size", type=int, default=8, help="Number of tiles per axis across the combined layer extent.")
    parser.add_argument("--min-mask-ratio", type=float, default=0.002)
    parser.add_argument("--line-mask-width", type=int, default=7)
    parser.add_argument("--train-ratio", type=float, default=0.8)
    parser.add_argument("--val-ratio", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    items = build_render_dataset(
        input_paths=args.input,
        output_dir=args.out,
        target_layers=args.target_layer,
        render_crs=args.render_crs,
        assume_missing_crs=args.assume_missing_crs,
        tile_size=args.tile_size,
        grid_size=args.grid_size,
        min_mask_ratio=args.min_mask_ratio,
        line_mask_width=args.line_mask_width,
        train_ratio=args.train_ratio,
        val_ratio=args.val_ratio,
        seed=args.seed,
    )

    by_split: dict[str, int] = {}
    by_target: dict[str, int] = {}
    for item in items:
        by_split[item.split] = by_split.get(item.split, 0) + 1
        by_target[item.target_layer] = by_target.get(item.target_layer, 0) + 1

    print(f"Prepared {len(items)} rendered GIS tiles in {args.out}")
    print("Splits:", by_split)
    print("Targets:", by_target)
    print(f"Manifest: {args.out / 'manifest.json'}")


if __name__ == "__main__":
    main()
