import io
import json
import zipfile
from pathlib import Path

import olefile


ALLOWED_EXTENSIONS = {".geojson", ".txt", ".doc", ".docx"}


def _validate_geojson(file_bytes: bytes) -> tuple[str, str]:
    try:
        text = file_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        return "failed", "Файл GeoJSON не удалось декодировать как UTF-8."

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return "failed", "Файл не является корректным JSON."

    geojson_types = {
        "FeatureCollection",
        "Feature",
        "Point",
        "MultiPoint",
        "LineString",
        "MultiLineString",
        "Polygon",
        "MultiPolygon",
        "GeometryCollection",
    }

    obj_type = data.get("type")
    if obj_type not in geojson_types:
        return "failed", "JSON прочитан, но структура не похожа на GeoJSON."

    if obj_type == "FeatureCollection" and not isinstance(data.get("features"), list):
        return "failed", "FeatureCollection не содержит корректный массив features."

    return "passed", "Файл успешно распознан как корректный GeoJSON."


def _validate_txt(file_bytes: bytes) -> tuple[str, str]:
    if not file_bytes:
        return "failed", "TXT-файл пустой."

    encodings = ["utf-8-sig", "utf-8", "cp1251"]
    for encoding in encodings:
        try:
            text = file_bytes.decode(encoding)
            if text.strip() == "":
                return "failed", "TXT-файл содержит только пустые символы."
            return "passed", f"TXT-файл успешно прочитан (кодировка {encoding})."
        except UnicodeDecodeError:
            continue

    return "failed", "TXT-файл не удалось прочитать в ожидаемой текстовой кодировке."


def _validate_docx(file_bytes: bytes) -> tuple[str, str]:
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
            names = archive.namelist()
            if "word/document.xml" not in names:
                return "failed", "DOCX-архив не содержит word/document.xml."
    except zipfile.BadZipFile:
        return "failed", "Файл имеет расширение .docx, но не является корректным DOCX-архивом."

    return "passed", "Файл успешно распознан как DOCX."


def _validate_doc(file_bytes: bytes) -> tuple[str, str]:
    if not file_bytes:
        return "failed", "DOC-файл пустой."

    try:
        ole = olefile.OleFileIO(io.BytesIO(file_bytes))
        ole.close()
    except Exception:
        return "failed", "Файл имеет расширение .doc, но не распознан как корректный бинарный DOC."

    return "passed", "Файл успешно распознан как DOC."


def validate_submission_file(filename: str, file_bytes: bytes) -> tuple[str, str, str]:
    extension = Path(filename).suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        return (
            "failed",
            extension or "unknown",
            f"Формат {extension or 'без расширения'} не поддерживается. "
            f"Допустимы: {', '.join(sorted(ALLOWED_EXTENSIONS))}.",
        )

    if len(file_bytes) == 0:
        return "failed", extension, "Загружен пустой файл."

    if extension == ".geojson":
        status, message = _validate_geojson(file_bytes)
        return status, extension, message

    if extension == ".txt":
        status, message = _validate_txt(file_bytes)
        return status, extension, message

    if extension == ".docx":
        status, message = _validate_docx(file_bytes)
        return status, extension, message

    if extension == ".doc":
        status, message = _validate_doc(file_bytes)
        return status, extension, message

    return "failed", extension, "Не удалось определить правило проверки для файла."