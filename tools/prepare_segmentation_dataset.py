from __future__ import annotations

import argparse
import json
import shutil
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path

from PIL import Image, ImageOps


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}


@dataclass
class DatasetItem:
    split: str
    image: str
    mask: str
    width: int
    height: int
    mask_min: int
    mask_max: int
    mask_nonzero_ratio: float


def _normalize_key(path: str) -> str:
    return Path(path).stem.lower()


def _read_zip_names(zip_path: Path) -> list[str]:
    with zipfile.ZipFile(zip_path) as archive:
        return [item.filename for item in archive.infolist() if not item.is_dir()]


def _split_for_name(name: str, train: set[str], val: set[str], test: set[str]) -> str:
    key = _normalize_key(name)
    if key in train:
        return "train"
    if key in val:
        return "val"
    if key in test:
        return "test"
    return "train"


def _load_split_file(archive: zipfile.ZipFile, filename: str) -> set[str]:
    try:
        with archive.open(filename) as file:
            lines = file.read().decode("utf-8", errors="ignore").splitlines()
    except KeyError:
        return set()
    return {_normalize_key(line.strip()) for line in lines if line.strip()}


def _copy_from_zip(archive: zipfile.ZipFile, source_name: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with archive.open(source_name) as source, destination.open("wb") as output:
        shutil.copyfileobj(source, output)


def _mask_stats(mask_path: Path) -> tuple[int, int, float]:
    with Image.open(mask_path) as image:
        gray = ImageOps.grayscale(image)
        extrema = gray.getextrema()
        histogram = gray.histogram()
        total = sum(histogram) or 1
        nonzero = total - histogram[0]
        return int(extrema[0]), int(extrema[1]), nonzero / total


def _image_size(image_path: Path) -> tuple[int, int]:
    with Image.open(image_path) as image:
        return image.size


def prepare_dataset(zip_path: Path, output_dir: Path, limit: int | None = None) -> list[DatasetItem]:
    names = _read_zip_names(zip_path)
    image_names = [
        name for name in names
        if name.lower().startswith("images/") and Path(name).suffix.lower() in IMAGE_EXTENSIONS
    ]
    mask_names = {
        _normalize_key(name): name
        for name in names
        if name.lower().startswith("masks/") and Path(name).suffix.lower() in IMAGE_EXTENSIONS
    }

    if not image_names:
        raise RuntimeError("No images found. Expected files under images/.")
    if not mask_names:
        raise RuntimeError("No masks found. Expected files under masks/.")

    output_dir.mkdir(parents=True, exist_ok=True)
    items: list[DatasetItem] = []

    with zipfile.ZipFile(zip_path) as archive:
        train = _load_split_file(archive, "train.txt")
        val = _load_split_file(archive, "val.txt")
        test = _load_split_file(archive, "test.txt")

        for image_name in sorted(image_names):
            key = _normalize_key(image_name)
            mask_name = mask_names.get(key)
            if not mask_name:
                continue

            split = _split_for_name(image_name, train, val, test)
            image_dest = output_dir / split / "images" / Path(image_name).name
            mask_dest = output_dir / split / "masks" / Path(mask_name).name

            _copy_from_zip(archive, image_name, image_dest)
            _copy_from_zip(archive, mask_name, mask_dest)

            width, height = _image_size(image_dest)
            mask_min, mask_max, ratio = _mask_stats(mask_dest)
            items.append(
                DatasetItem(
                    split=split,
                    image=str(image_dest.relative_to(output_dir)).replace("\\", "/"),
                    mask=str(mask_dest.relative_to(output_dir)).replace("\\", "/"),
                    width=width,
                    height=height,
                    mask_min=mask_min,
                    mask_max=mask_max,
                    mask_nonzero_ratio=ratio,
                )
            )

            if limit is not None and len(items) >= limit:
                break

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps([asdict(item) for item in items], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return items


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare image/mask segmentation dataset from archive (2).zip.")
    parser.add_argument("--zip", required=True, type=Path, help="Path to source ZIP archive.")
    parser.add_argument("--out", required=True, type=Path, help="Output dataset directory.")
    parser.add_argument("--limit", type=int, default=None, help="Optional number of pairs to extract.")
    args = parser.parse_args()

    items = prepare_dataset(args.zip, args.out, args.limit)
    by_split: dict[str, int] = {}
    for item in items:
        by_split[item.split] = by_split.get(item.split, 0) + 1

    print(f"Prepared {len(items)} image/mask pairs in {args.out}")
    print("Splits:", by_split)
    print(f"Manifest: {args.out / 'manifest.json'}")


if __name__ == "__main__":
    main()
