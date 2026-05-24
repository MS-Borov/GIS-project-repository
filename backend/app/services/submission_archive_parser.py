import io
import zipfile
from pathlib import Path

from app.core.config import settings


class ArchiveTooLargeError(Exception):
    """Распакованный размер архива превышает лимит. Защита от ZIP-bomb."""


def _check_archive_safety(archive: zipfile.ZipFile, max_total_bytes: int) -> None:
    """Перед чтением проверяет, что суммарный распакованный размер всех членов
    архива не превышает лимит. Защита от ZIP-bomb (100 KB архив -> 10 GB).
    """
    total = 0
    for member in archive.infolist():
        if member.is_dir():
            continue
        # file_size — uncompressed
        if member.file_size > max_total_bytes:
            raise ArchiveTooLargeError(
                f"Файл '{member.filename}' внутри архива слишком большой: "
                f"{member.file_size} байт, лимит {max_total_bytes}."
            )
        total += member.file_size
        if total > max_total_bytes:
            raise ArchiveTooLargeError(
                f"Суммарный распакованный размер архива превышает {max_total_bytes} байт. "
                f"Возможна попытка ZIP-bomb атаки."
            )


SHAPEFILE_EXTENSIONS = {".shp", ".dbf", ".shx", ".prj", ".cpg", ".qix", ".sbn", ".sbx"}
REPORT_EXTENSIONS = {".doc", ".docx", ".txt"}
LAYER_EXTENSIONS = {".geojson"}

# Служебные файлы ArcGIS/QGIS, которые не должны становиться отдельными assets.
# Например phlr.shp.xml — это metadata-файл, а не отдельный слой.
IGNORED_ARCHIVE_SUFFIXES = {
    ".shp.xml",
    ".xml",
    ".lock",
    ".sr.lock",
}
IGNORED_ARCHIVE_NAMES = {
    "style-manifest.json",
}
MOJIBAKE_MARKERS = ("Ð", "Ñ", "Р", "С", "Å", "α", "Γ", "τ", "�")


def _should_ignore_archive_file(filename: str) -> bool:
    """
    Проверяет, надо ли полностью игнорировать файл из архива.

    Используется для служебных файлов вроде:
    - *.shp.xml
    - *.xml
    - *.lock
    """
    lower_name = Path(filename).name.lower()
    return lower_name in IGNORED_ARCHIVE_NAMES or any(lower_name.endswith(suffix) for suffix in IGNORED_ARCHIVE_SUFFIXES)


def _cyrillic_count(value: str) -> int:
    return sum(1 for char in value if "\u0400" <= char <= "\u04ff")


def _mojibake_score(value: str) -> int:
    return sum(value.count(marker) for marker in MOJIBAKE_MARKERS)


def repair_zip_member_name(filename: str) -> str:
    """
    ZIP-файлы из Windows/GIS-софта иногда хранят кириллицу в CP866 без UTF-8 flag.
    zipfile тогда декодирует имя как CP437, и в UI получается "Åαá..." вместо русского имени.
    """
    candidates = [filename]
    for source_encoding in ("cp437", "latin1"):
        try:
            raw = filename.encode(source_encoding)
        except UnicodeEncodeError:
            continue
        for target_encoding in ("utf-8", "cp866", "cp1251"):
            try:
                candidates.append(raw.decode(target_encoding))
            except UnicodeDecodeError:
                continue

    return max(
        candidates,
        key=lambda value: (
            _cyrillic_count(value),
            -_mojibake_score(value),
            -value.count("?"),
            value == filename,
        ),
    )


def _display_basename(filename: str) -> str:
    return Path(repair_zip_member_name(filename)).name


def parse_submission_archive(file_bytes: bytes) -> list[dict]:
    """
    Разбирает submission-архив на логические assets.

    Логика:
    1. shapefile-компоненты (*.shp, *.dbf, *.shx, *.prj, ...)
       группируются по basename в один layer asset;
    2. каждая shapefile-группа упаковывается во внутренний zip bytes;
    3. GeoJSON добавляется как отдельный layer asset;
    4. DOC/DOCX/TXT добавляются как report asset;
    5. служебные файлы игнорируются;
    6. всё прочее попадает в other.
    """
    result: list[dict] = []

    with zipfile.ZipFile(io.BytesIO(file_bytes), "r") as archive:
        _check_archive_safety(archive, settings.max_archive_uncompressed_bytes)
        members = [m for m in archive.infolist() if not m.is_dir()]

        # Читаем все файлы архива в память (после проверки на ZIP-bomb).
        all_files: dict[str, bytes] = {}
        for member in members:
            # Сразу пропускаем служебные metadata/lock-файлы.
            if _should_ignore_archive_file(member.filename):
                continue

            all_files[member.filename] = archive.read(member.filename)

        # -----------------------------
        # 1. Группировка shapefile parts
        # -----------------------------
        shapefile_groups: dict[str, list[str]] = {}
        consumed_files: set[str] = set()

        for archive_name in all_files.keys():
            basename = _display_basename(archive_name)
            suffix = Path(basename).suffix.lower()
            stem = Path(basename).stem.lower()

            if suffix in SHAPEFILE_EXTENSIONS:
                shapefile_groups.setdefault(stem, []).append(archive_name)

        # -----------------------------
        # 2. Создание shapefile layer-assets
        # -----------------------------
        for group_key, group_files in shapefile_groups.items():
            suffixes = {Path(Path(name).name).suffix.lower() for name in group_files}

            # Настоящий shapefile layer должен содержать хотя бы .shp.
            if ".shp" not in suffixes:
                continue

            # Если это явно служебная/дублирующая группа, можно отфильтровать.
            # Например dnar_prj.shp в твоём архиве выглядит как отдельный слой,
            # но если он не нужен для expected outputs, его можно оставить как layer.
            # Жёстко не вырезаю *_prj, потому что иногда это может быть реальный файл.
            buffer = io.BytesIO()

            with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as layer_zip:
                for archive_name in sorted(group_files):
                    inner_name = _display_basename(archive_name)
                    layer_zip.writestr(inner_name, all_files[archive_name])
                    consumed_files.add(archive_name)

            result.append({
                "asset_name": f"{group_key}.zip",
                "asset_type": "layer",
                "detected_format": "shapefile_zip",
                "status": "uploaded",
                "message": f"Shapefile layer '{group_key}' собран из архива.",
                "file_bytes": buffer.getvalue(),
                "group_key": group_key,
            })

        # -----------------------------
        # 3. GeoJSON layers
        # -----------------------------
        for archive_name, data in all_files.items():
            if archive_name in consumed_files:
                continue

            basename = _display_basename(archive_name)
            suffix = Path(basename).suffix.lower()

            if suffix == ".geojson":
                result.append({
                    "asset_name": basename,
                    "asset_type": "layer",
                    "detected_format": "geojson",
                    "status": "uploaded",
                    "message": f"GeoJSON '{basename}' найден внутри архива.",
                    "file_bytes": data,
                    "group_key": Path(basename).stem.lower(),
                })
                consumed_files.add(archive_name)

        # -----------------------------
        # 4. Report files
        # -----------------------------
        for archive_name, data in all_files.items():
            if archive_name in consumed_files:
                continue

            basename = _display_basename(archive_name)
            suffix = Path(basename).suffix.lower()

            if suffix in REPORT_EXTENSIONS:
                result.append({
                    "asset_name": basename,
                    "asset_type": "report",
                    "detected_format": suffix.lstrip("."),
                    "status": "uploaded",
                    "message": f"Отчёт '{basename}' найден внутри архива.",
                    "file_bytes": data,
                    "group_key": None,
                })
                consumed_files.add(archive_name)

        # -----------------------------
        # 5. Всё остальное
        # -----------------------------
        for archive_name, data in all_files.items():
            if archive_name in consumed_files:
                continue

            # Дополнительная защита: если служебный файл всё же дошёл до этого места,
            # не создаём для него asset.
            if _should_ignore_archive_file(archive_name):
                consumed_files.add(archive_name)
                continue

            basename = Path(archive_name).name
            suffix = Path(basename).suffix.lower()

            consumed_files.add(archive_name)

    return result