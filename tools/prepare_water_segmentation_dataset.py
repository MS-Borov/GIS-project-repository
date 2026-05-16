from __future__ import annotations

import argparse
import json
import random
import shutil
import tempfile
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path

from PIL import Image, ImageOps


Image.MAX_IMAGE_PIXELS = None

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}
MASK_HINTS = ("mask", "masks", "label", "labels", "annotation", "annotations", "target", "groundtruth", "gt")
IMAGE_HINTS = ("image", "images", "img", "imgs", "jpegimages", "rgb", "sat", "satellite")


@dataclass
class DatasetItem:
    split: str
    image: str
    mask: str
    width: int
    height: int
    mask_nonzero_ratio: float


def _safe_stem(path: Path) -> str:
    return "".join(char if char.isalnum() or char in {"-", "_"} else "_" for char in path.stem).strip("_").lower()


def _normalize_key(path: Path) -> str:
    stem = _safe_stem(path)
    for suffix in ("_mask", "-mask", " mask", "_label", "-label", "_gt", "-gt", "_target", "-target"):
        if stem.endswith(suffix.strip()):
            stem = stem[: -len(suffix.strip())]
    return stem


def _is_mask_path(path: Path) -> bool:
    lowered_parts = [part.lower() for part in path.parts]
    lowered_name = path.name.lower()
    return any(hint in lowered_parts for hint in MASK_HINTS) or any(hint in lowered_name for hint in MASK_HINTS)


def _is_image_path(path: Path) -> bool:
    lowered_parts = [part.lower() for part in path.parts]
    lowered_name = path.name.lower()
    return any(hint in lowered_parts for hint in IMAGE_HINTS) or any(hint in lowered_name for hint in IMAGE_HINTS)


def _prepare_input_root(input_path: Path) -> tuple[Path, tempfile.TemporaryDirectory | None]:
    if input_path.is_dir():
        print(f"Using extracted dataset directory: {input_path}", flush=True)
        return input_path, None
    if input_path.suffix.lower() != ".zip":
        raise RuntimeError(f"Input must be a directory or ZIP archive: {input_path}")

    temp_dir = tempfile.TemporaryDirectory()
    root = Path(temp_dir.name) / input_path.stem
    root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(input_path) as archive:
        entries = archive.infolist()
        print(f"Extracting {len(entries)} files from {input_path} ...", flush=True)
        for index, entry in enumerate(entries, start=1):
            archive.extract(entry, root)
            if index == 1 or index % 250 == 0 or index == len(entries):
                print(f"  extracted {index}/{len(entries)}", flush=True)
    return root, temp_dir


def _find_pairs(root: Path) -> list[tuple[Path, Path]]:
    files = [path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS]
    print(f"Found {len(files)} image-like files under {root}", flush=True)
    mask_files = [path for path in files if _is_mask_path(path)]
    image_files = [path for path in files if path not in set(mask_files)]
    print(f"Candidate images: {len(image_files)}; candidate masks: {len(mask_files)}", flush=True)

    masks_by_key: dict[str, list[Path]] = {}
    for mask_path in mask_files:
        masks_by_key.setdefault(_normalize_key(mask_path), []).append(mask_path)

    pairs: list[tuple[Path, Path]] = []
    used_masks: set[Path] = set()
    for image_path in image_files:
        key = _normalize_key(image_path)
        candidates = masks_by_key.get(key, [])
        if not candidates:
            candidates = [
                mask_path for mask_key, masks in masks_by_key.items()
                if key in mask_key or mask_key in key
                for mask_path in masks
            ]
        if not candidates:
            continue

        mask_path = sorted(candidates, key=lambda item: len(str(item)))[0]
        pairs.append((image_path, mask_path))
        used_masks.add(mask_path)

    if pairs:
        return pairs

    image_candidates = [path for path in files if _is_image_path(path)]
    if not image_candidates:
        image_candidates = image_files

    for image_path in image_candidates:
        key = _normalize_key(image_path)
        for mask_path in mask_files:
            if mask_path in used_masks:
                continue
            mask_key = _normalize_key(mask_path)
            if key == mask_key or key in mask_key or mask_key in key:
                pairs.append((image_path, mask_path))
                used_masks.add(mask_path)
                break
    return pairs


def _mask_nonzero_ratio(mask_path: Path, threshold: int) -> float:
    with Image.open(mask_path) as raw:
        gray = ImageOps.grayscale(raw)
        binary = gray.point(lambda value: 255 if value >= threshold else 0)
        histogram = binary.histogram()
        total = sum(histogram) or 1
        return (total - histogram[0]) / total


def _save_binary_mask(source: Path, destination: Path, threshold: int, invert_mask: bool) -> None:
    with Image.open(source) as raw:
        gray = ImageOps.grayscale(raw)
        if invert_mask:
            gray = ImageOps.invert(gray)
        binary = gray.point(lambda value: 255 if value >= threshold else 0)
        destination.parent.mkdir(parents=True, exist_ok=True)
        binary.save(destination)


def _copy_rgb_image(source: Path, destination: Path) -> tuple[int, int]:
    with Image.open(source) as raw:
        image = raw.convert("RGB")
        width, height = image.size
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(destination)
        return width, height


def _assign_split(rng: random.Random, train_ratio: float, val_ratio: float) -> str:
    value = rng.random()
    if value < train_ratio:
        return "train"
    if value < train_ratio + val_ratio:
        return "val"
    return "test"


def prepare_water_dataset(
    input_path: Path,
    output_dir: Path,
    threshold: int,
    invert_mask: bool,
    train_ratio: float,
    val_ratio: float,
    seed: int,
    limit: int | None,
) -> list[DatasetItem]:
    root, temp_dir = _prepare_input_root(input_path)
    try:
        pairs = _find_pairs(root)
        print(f"Matched image/mask pairs: {len(pairs)}", flush=True)
        if not pairs:
            raise RuntimeError(
                "No image/mask pairs found. Expected paths containing mask/label/annotation/groundtruth hints."
            )

        rng = random.Random(seed)
        rng.shuffle(pairs)
        if limit is not None:
            pairs = pairs[:limit]

        output_dir.mkdir(parents=True, exist_ok=True)
        items: list[DatasetItem] = []
        for index, (image_path, mask_path) in enumerate(pairs):
            if index == 0 or (index + 1) % 100 == 0 or index + 1 == len(pairs):
                print(f"Preparing pair {index + 1}/{len(pairs)}", flush=True)
            split = _assign_split(rng, train_ratio=train_ratio, val_ratio=val_ratio)
            name = f"{index:06d}_{_safe_stem(image_path)}.png"
            image_rel = Path(split) / "images" / name
            mask_rel = Path(split) / "masks" / name
            image_output = output_dir / image_rel
            mask_output = output_dir / mask_rel
            try:
                width, height = _copy_rgb_image(image_path, image_output)
                _save_binary_mask(mask_path, mask_output, threshold=threshold, invert_mask=invert_mask)
                ratio = _mask_nonzero_ratio(mask_output, threshold=1)
            except Exception as exc:  # noqa: BLE001 - datasets often contain a few broken files.
                image_output.unlink(missing_ok=True)
                mask_output.unlink(missing_ok=True)
                print(f"Skip pair {image_path.name}: {exc}", flush=True)
                continue
            items.append(
                DatasetItem(
                    split=split,
                    image=str(image_rel).replace("\\", "/"),
                    mask=str(mask_rel).replace("\\", "/"),
                    width=width,
                    height=height,
                    mask_nonzero_ratio=ratio,
                )
            )

        manifest_path = output_dir / "manifest.json"
        manifest_path.write_text(
            json.dumps([asdict(item) for item in items], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return items
    finally:
        if temp_dir is not None:
            temp_dir.cleanup()


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare water segmentation image/mask dataset for segmentation experiments.")
    parser.add_argument("--input", required=True, type=Path, help="Kaggle water dataset ZIP or extracted directory.")
    parser.add_argument("--out", required=True, type=Path, help="Output dataset directory.")
    parser.add_argument("--threshold", type=int, default=128, help="Mask threshold; pixels >= threshold become water.")
    parser.add_argument("--invert-mask", action="store_true", help="Invert mask before thresholding.")
    parser.add_argument("--train-ratio", type=float, default=0.8)
    parser.add_argument("--val-ratio", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    items = prepare_water_dataset(
        input_path=args.input,
        output_dir=args.out,
        threshold=args.threshold,
        invert_mask=args.invert_mask,
        train_ratio=args.train_ratio,
        val_ratio=args.val_ratio,
        seed=args.seed,
        limit=args.limit,
    )

    by_split: dict[str, int] = {}
    for item in items:
        by_split[item.split] = by_split.get(item.split, 0) + 1

    print(f"Prepared {len(items)} water image/mask pairs in {args.out}")
    print("Splits:", by_split)
    print(f"Manifest: {args.out / 'manifest.json'}")


if __name__ == "__main__":
    main()
