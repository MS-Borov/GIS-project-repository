import io
import zipfile
from pathlib import Path

from app.services.storage import build_shapefile_asset_zip
from app.services.submission_validator import validate_submission_file


REPORT_EXTENSIONS = {".doc", ".docx", ".txt"}
GIS_SINGLE_FILE_EXTENSIONS = {".geojson"}

# Служебные расширения shapefile-набора
SHAPEFILE_PART_EXTENSIONS = {
    ".shp",
    ".shx",
    ".dbf",
    ".prj",
    ".cpg",
    ".sbn",
    ".sbx",
    ".qix",
}


def _build_asset(
    asset_name: str,
    asset_type: str,
    detected_format: str,
    status: str,
    message: str,
    file_bytes: bytes | None = None,
    group_key: str | None = None,
) -> dict:
    """
    Унифицированное представление одного asset внутри архива.
    """
    return {
        "asset_name": asset_name,
        "asset_type": asset_type,
        "detected_format": detected_format,
        "status": status,
        "message": message,
        "file_bytes": file_bytes,
        "group_key": group_key,
    }


def parse_submission_archive(file_bytes: bytes) -> list[dict]:
    """
    Разбирает архив submission и пытается понять, что внутри:
    - report
    - geojson
    - shapefile-комплекты
    - прочие файлы

    На выходе — список логических assets для записи в БД.
    """
    try:
        archive = zipfile.ZipFile(io.BytesIO(file_bytes))
    except zipfile.BadZipFile:
        return [
            _build_asset(
                asset_name="archive",
                asset_type="other",
                detected_format="zip",
                status="failed",
                message="Архив не удалось открыть как корректный ZIP.",
                file_bytes=None,
            )
        ]

    names = [name for name in archive.namelist() if not name.endswith("/")]
    if not names:
        return [
            _build_asset(
                asset_name="archive",
                asset_type="other",
                detected_format="zip",
                status="failed",
                message="Архив пустой.",
                file_bytes=None,
            )
        ]

    assets: list[dict] = []

    # --------------------------
    # 1. Ищем текстовые отчёты
    # --------------------------
    for name in names:
        ext = Path(name).suffix.lower()
        if ext in REPORT_EXTENSIONS:
            with archive.open(name) as f:
                data = f.read()

            validation = validate_submission_file(Path(name).name, data)

            assets.append(
                _build_asset(
                    asset_name=Path(name).name,
                    asset_type="report",
                    detected_format=validation["detected_format"],
                    status=validation["status"],
                    message=validation["message"],
                    file_bytes=data,
                )
            )

    # --------------------------
    # 2. Ищем одиночные GIS-файлы
    # --------------------------
    for name in names:
        ext = Path(name).suffix.lower()
        if ext in GIS_SINGLE_FILE_EXTENSIONS:
            with archive.open(name) as f:
                data = f.read()

            validation = validate_submission_file(Path(name).name, data)

            assets.append(
                _build_asset(
                    asset_name=Path(name).name,
                    asset_type="layer",
                    detected_format=validation["detected_format"],
                    status=validation["status"],
                    message=validation["message"],
                    file_bytes=data,
                )
            )

    # --------------------------
    # 3. Группируем shapefile-наборы
    # --------------------------
    shapefile_groups: dict[str, list[str]] = {}

    for name in names:
        path = Path(name)
        ext = path.suffix.lower()

        if ext in SHAPEFILE_PART_EXTENSIONS:
            # Ключ группы — относительный путь без расширения
            group_key = str(path.with_suffix("")).lower()
            shapefile_groups.setdefault(group_key, []).append(name)

    for group_key, group_files in shapefile_groups.items():
        # Нас интересуют только группы, где реально есть .shp
        has_shp = any(Path(f).suffix.lower() == ".shp" for f in group_files)
        if not has_shp:
            continue

        group_bytes_map: dict[str, bytes]={}
        for original_name in group_files:
                with archive.open(original_name) as f:
                    group_bytes_map[Path(original_name).name] = f.read()

        shapefile_zip_bytes = build_shapefile_asset_zip(group_bytes_map)

        validation = validate_submission_file(
            filename=f"{Path(group_key).name}.zip",
            file_bytes=shapefile_zip_bytes,
        )

        assets.append(
            _build_asset(
                asset_name=Path(group_key).name,
                asset_type="layer",
                detected_format=validation["detected_format"],
                status=validation["status"],
                message=validation["message"],
                file_bytes=shapefile_zip_bytes,
                group_key=group_key,
            )
        )

    # --------------------------
    # 4. Если ничего осмысленного не нашли
    # --------------------------
    if not assets:
        assets.append(
            _build_asset(
                asset_name="archive",
                asset_type="other",
                detected_format="zip",
                status="warning",
                message="Архив открыт, но внутри не найдено поддерживаемых отчётов или GIS-слоёв.",
                file_bytes=None,
            )
        )

    return assets