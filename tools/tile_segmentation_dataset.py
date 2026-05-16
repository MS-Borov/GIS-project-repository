from __future__ import annotations

import argparse
import json
import random
from dataclasses import asdict, dataclass
from pathlib import Path

from PIL import Image, ImageOps


Image.MAX_IMAGE_PIXELS = None


@dataclass
class TileItem:
    split: str
    source_image: str
    source_mask: str
    image: str
    mask: str
    x: int
    y: int
    width: int
    height: int
    mask_nonzero_ratio: float


def _load_manifest(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def _mask_nonzero_ratio(mask: Image.Image) -> float:
    gray = ImageOps.grayscale(mask)
    histogram = gray.histogram()
    total = sum(histogram) or 1
    return (total - histogram[0]) / total


def _save_tile(image: Image.Image, mask: Image.Image, image_path: Path, mask_path: Path) -> None:
    image_path.parent.mkdir(parents=True, exist_ok=True)
    mask_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(image_path)
    ImageOps.grayscale(mask).save(mask_path)


def _assign_split(index: int, train_ratio: float, val_ratio: float, rng: random.Random) -> str:
    del index
    value = rng.random()
    if value < train_ratio:
        return "train"
    if value < train_ratio + val_ratio:
        return "val"
    return "test"


def tile_dataset(
    source_dir: Path,
    output_dir: Path,
    tile_size: int,
    stride: int,
    min_mask_ratio: float,
    max_tiles_per_image: int | None,
    train_ratio: float,
    val_ratio: float,
    seed: int,
) -> list[TileItem]:
    manifest_path = source_dir / "manifest.json"
    entries = _load_manifest(manifest_path)
    rng = random.Random(seed)
    output_dir.mkdir(parents=True, exist_ok=True)
    items: list[TileItem] = []

    for entry in entries:
        image_path = source_dir / entry["image"]
        mask_path = source_dir / entry["mask"]
        source_key = Path(entry["image"]).stem
        image_tiles_for_source = 0

        with Image.open(image_path) as image_raw, Image.open(mask_path) as mask_raw:
            image = image_raw.convert("RGB")
            mask = ImageOps.grayscale(mask_raw)
            width, height = image.size

            candidates: list[tuple[int, int, float]] = []
            for y in range(0, max(1, height - tile_size + 1), stride):
                for x in range(0, max(1, width - tile_size + 1), stride):
                    box = (x, y, min(x + tile_size, width), min(y + tile_size, height))
                    if box[2] - box[0] != tile_size or box[3] - box[1] != tile_size:
                        continue
                    mask_tile = mask.crop(box)
                    ratio = _mask_nonzero_ratio(mask_tile)
                    if ratio >= min_mask_ratio:
                        candidates.append((x, y, ratio))

            rng.shuffle(candidates)
            if max_tiles_per_image is not None:
                candidates = candidates[:max_tiles_per_image]

            for local_index, (x, y, ratio) in enumerate(candidates):
                split = _assign_split(len(items), train_ratio, val_ratio, rng)
                tile_name = f"{source_key}_{x}_{y}.png"
                image_rel = Path(split) / "images" / tile_name
                mask_rel = Path(split) / "masks" / tile_name
                box = (x, y, x + tile_size, y + tile_size)
                image_tile = image.crop(box)
                mask_tile = mask.crop(box)
                _save_tile(image_tile, mask_tile, output_dir / image_rel, output_dir / mask_rel)

                items.append(
                    TileItem(
                        split=split,
                        source_image=entry["image"],
                        source_mask=entry["mask"],
                        image=str(image_rel).replace("\\", "/"),
                        mask=str(mask_rel).replace("\\", "/"),
                        x=x,
                        y=y,
                        width=tile_size,
                        height=tile_size,
                        mask_nonzero_ratio=ratio,
                    )
                )
                image_tiles_for_source += 1

        print(f"{source_key}: {image_tiles_for_source} tiles")

    manifest_out = output_dir / "manifest.json"
    manifest_out.write_text(
        json.dumps([asdict(item) for item in items], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return items


def main() -> None:
    parser = argparse.ArgumentParser(description="Cut prepared segmentation dataset into training tiles.")
    parser.add_argument("--source", required=True, type=Path, help="Prepared dataset directory with manifest.json.")
    parser.add_argument("--out", required=True, type=Path, help="Output tile dataset directory.")
    parser.add_argument("--tile-size", type=int, default=512)
    parser.add_argument("--stride", type=int, default=512)
    parser.add_argument("--min-mask-ratio", type=float, default=0.01)
    parser.add_argument("--max-tiles-per-image", type=int, default=120)
    parser.add_argument("--train-ratio", type=float, default=0.8)
    parser.add_argument("--val-ratio", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    items = tile_dataset(
        source_dir=args.source,
        output_dir=args.out,
        tile_size=args.tile_size,
        stride=args.stride,
        min_mask_ratio=args.min_mask_ratio,
        max_tiles_per_image=args.max_tiles_per_image,
        train_ratio=args.train_ratio,
        val_ratio=args.val_ratio,
        seed=args.seed,
    )

    by_split: dict[str, int] = {}
    for item in items:
        by_split[item.split] = by_split.get(item.split, 0) + 1

    print(f"Prepared {len(items)} tiles in {args.out}")
    print("Splits:", by_split)
    print(f"Manifest: {args.out / 'manifest.json'}")


if __name__ == "__main__":
    main()
