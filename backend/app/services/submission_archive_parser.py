import io
import zipfile
from pathlib import Path

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

        # Собираем мини-zip только для одного shapefile-набора,
        # чтобы reuse-ить уже существующий validator.
        memory_zip = io.BytesIO()
        with zipfile.ZipFile(memory_zip, "w", zipfile.ZIP_DEFLATED) as zf:
            for original_name in group_files:
                with archive.open(original_name) as f:
                    zf.writestr(Path(original_name).name, f.read())

        validation = validate_submission_file(
            filename=f"{Path(group_key).name}.zip",
            file_bytes=memory_zip.getvalue(),
        )

        assets.append(
            _build_asset(
                asset_name=Path(group_key).name,
                asset_type="layer",
                detected_format=validation["detected_format"],
                status=validation["status"],
                message=validation["message"],
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
            )
        )

    return assets