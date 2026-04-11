import io
import json
import tempfile
import zipfile
from pathlib import Path

import geopandas as gpd
import olefile


# Поддерживаемые расширения submission.
# Для shapefile принимаем .zip, потому что shapefile — это набор файлов, а не один файл.
ALLOWED_EXTENSIONS = {".geojson", ".txt", ".doc", ".docx", ".zip"}


def _build_result(
    status: str,
    file_type: str,
    detected_format: str,
    message: str,
    details: dict | None = None,
) -> dict:
    """
    Унифицированный формат результата проверки файла.
    Его потом будет использовать:
    1) запись SubmissionCheck в БД
    2) проверка на соответствие AssignmentRequirements
    """
    return {
        "status": status,
        "file_type": file_type,            # расширение загруженного файла
        "detected_format": detected_format,  # логический формат: geojson / shapefile_zip / txt / ...
        "message": message,
        "details": details or {},
    }


def _validate_geojson(file_bytes: bytes) -> dict:
    """
    Проверка GeoJSON:
    - файл должен быть валидным JSON
    - структура должна быть похожа на GeoJSON
    - слой должен читаться как геоданные
    - считаем GIS-признаки для следующего этапа проверки
    """
    try:
        text = file_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        return _build_result(
            "failed",
            ".geojson",
            "geojson",
            "Файл GeoJSON не удалось декодировать как UTF-8.",
        )

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return _build_result(
            "failed",
            ".geojson",
            "geojson",
            "Файл не является корректным JSON.",
        )

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
        return _build_result(
            "failed",
            ".geojson",
            "geojson",
            "JSON прочитан, но структура не похожа на GeoJSON.",
        )

    if obj_type == "FeatureCollection":
        features = data.get("features")
        if not isinstance(features, list):
            return _build_result(
                "failed",
                ".geojson",
                "geojson",
                "FeatureCollection не содержит корректный массив features.",
            )
        if len(features) == 0:
            return _build_result(
                "failed",
                ".geojson",
                "geojson",
                "GeoJSON прочитан, но коллекция объектов пустая.",
            )

    # Читаем файл уже как геоданные через geopandas
    with tempfile.TemporaryDirectory() as tmp_dir:
        geojson_path = Path(tmp_dir) / "input.geojson"
        geojson_path.write_bytes(file_bytes)

        try:
            gdf = gpd.read_file(geojson_path)
        except Exception as e:
            return _build_result(
                "failed",
                ".geojson",
                "geojson",
                f"GeoJSON имеет корректную JSON-структуру, но не читается как геоданные: {str(e)}",
            )

    feature_count = len(gdf)
    if feature_count == 0:
        return _build_result(
            "failed",
            ".geojson",
            "geojson",
            "GeoJSON прочитан, но не содержит геообъектов.",
        )

    geometry_types = sorted(set(gdf.geom_type.dropna().tolist()))
    crs = gdf.crs.to_string() if gdf.crs else None
    attribute_fields = [col for col in gdf.columns if col != "geometry"]

    invalid_geometry_count = 0
    if hasattr(gdf, "geometry") and gdf.geometry is not None:
        try:
            invalid_geometry_count = int((~gdf.geometry.is_valid).sum())
        except Exception:
            invalid_geometry_count = 0

    details = {
        "feature_count": feature_count,
        "geometry_types": geometry_types,
        "crs": crs,
        "attribute_fields": attribute_fields,
        "invalid_geometry_count": invalid_geometry_count,
    }

    if invalid_geometry_count > 0:
        return _build_result(
            "warning",
            ".geojson",
            "geojson",
            f"GeoJSON прочитан: объектов {feature_count}, типы геометрии: {', '.join(geometry_types)}, "
            f"CRS: {crs or 'не определена'}, невалидных геометрий: {invalid_geometry_count}.",
            details,
        )

    return _build_result(
        "passed",
        ".geojson",
        "geojson",
        f"GeoJSON успешно прочитан: объектов {feature_count}, типы геометрии: {', '.join(geometry_types)}, "
        f"CRS: {crs or 'не определена'}, невалидных геометрий не обнаружено.",
        details,
    )


def _validate_txt(file_bytes: bytes) -> dict:
    if not file_bytes:
        return _build_result("failed", ".txt", "txt", "TXT-файл пустой.")

    encodings = ["utf-8-sig", "utf-8", "cp1251"]
    for encoding in encodings:
        try:
            text = file_bytes.decode(encoding)
            if text.strip() == "":
                return _build_result("failed", ".txt", "txt", "TXT-файл содержит только пустые символы.")
            return _build_result(
                "passed",
                ".txt",
                "txt",
                f"TXT-файл успешно прочитан (кодировка {encoding}).",
                {"encoding": encoding},
            )
        except UnicodeDecodeError:
            continue

    return _build_result(
        "failed",
        ".txt",
        "txt",
        "TXT-файл не удалось прочитать в ожидаемой текстовой кодировке.",
    )


def _validate_docx(file_bytes: bytes) -> dict:
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
            names = archive.namelist()
            if "word/document.xml" not in names:
                return _build_result(
                    "failed",
                    ".docx",
                    "docx",
                    "DOCX-архив не содержит word/document.xml.",
                )
    except zipfile.BadZipFile:
        return _build_result(
            "failed",
            ".docx",
            "docx",
            "Файл имеет расширение .docx, но не является корректным DOCX-архивом.",
        )

    return _build_result("passed", ".docx", "docx", "Файл успешно распознан как DOCX.")


def _validate_doc(file_bytes: bytes) -> dict:
    if not file_bytes:
        return _build_result("failed", ".doc", "doc", "DOC-файл пустой.")

    try:
        ole = olefile.OleFileIO(io.BytesIO(file_bytes))
        ole.close()
    except Exception:
        return _build_result(
            "failed",
            ".doc",
            "doc",
            "Файл имеет расширение .doc, но не распознан как корректный бинарный DOC.",
        )

    return _build_result("passed", ".doc", "doc", "Файл успешно распознан как DOC.")


def _validate_shapefile_zip(file_bytes: bytes) -> dict:
    """
    Проверка ZIP-архива с shapefile:
    - в архиве должны быть .shp, .shx, .dbf
    - затем пробуем реально прочитать слой
    - извлекаем GIS-признаки, как и для GeoJSON
    """
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
            names = [name for name in archive.namelist() if not name.endswith("/")]
    except zipfile.BadZipFile:
        return _build_result(
            "failed",
            ".zip",
            "shapefile_zip",
            "Файл имеет расширение .zip, но не является корректным ZIP-архивом.",
        )

    if not names:
        return _build_result(
            "failed",
            ".zip",
            "shapefile_zip",
            "ZIP-архив пустой.",
        )

    lower_names = [name.lower() for name in names]

    shp_files = [name for name in lower_names if name.endswith(".shp")]
    shx_files = [name for name in lower_names if name.endswith(".shx")]
    dbf_files = [name for name in lower_names if name.endswith(".dbf")]
    prj_files = [name for name in lower_names if name.endswith(".prj")]

    if not shp_files:
        return _build_result("failed", ".zip", "shapefile_zip", "В архиве отсутствует файл .shp.")
    if not shx_files:
        return _build_result("failed", ".zip", "shapefile_zip", "В архиве отсутствует файл .shx.")
    if not dbf_files:
        return _build_result("failed", ".zip", "shapefile_zip", "В архиве отсутствует файл .dbf.")

    def stem_set(files: list[str]) -> set[str]:
        return {Path(f).stem for f in files}

    shp_stems = stem_set(shp_files)
    shx_stems = stem_set(shx_files)
    dbf_stems = stem_set(dbf_files)

    common_stems = shp_stems & shx_stems & dbf_stems
    if not common_stems:
        return _build_result(
            "failed",
            ".zip",
            "shapefile_zip",
            "В архиве есть файлы .shp/.shx/.dbf, но они не образуют согласованный набор shapefile.",
        )

    selected_stem = sorted(common_stems)[0]

    with tempfile.TemporaryDirectory() as tmp_dir:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
            archive.extractall(tmp_dir)

        shp_path = None
        for path in Path(tmp_dir).rglob("*.shp"):
            if path.stem.lower() == selected_stem.lower():
                shp_path = path
                break

        if shp_path is None:
            return _build_result(
                "failed",
                ".zip",
                "shapefile_zip",
                "Не удалось найти .shp-файл после распаковки архива.",
            )

        try:
            gdf = gpd.read_file(shp_path)
        except Exception as e:
            return _build_result(
                "failed",
                ".zip",
                "shapefile_zip",
                f"Shapefile-набор найден, но не удалось прочитать слой: {str(e)}",
            )

    feature_count = len(gdf)
    if feature_count == 0:
        return _build_result(
            "failed",
            ".zip",
            "shapefile_zip",
            "Shapefile прочитан, но слой не содержит объектов.",
        )

    geometry_types = sorted(set(gdf.geom_type.dropna().tolist()))
    crs = gdf.crs.to_string() if gdf.crs else None
    attribute_fields = [col for col in gdf.columns if col != "geometry"]

    invalid_geometry_count = 0
    if hasattr(gdf, "geometry") and gdf.geometry is not None:
        try:
            invalid_geometry_count = int((~gdf.geometry.is_valid).sum())
        except Exception:
            invalid_geometry_count = 0

    details = {
        "feature_count": feature_count,
        "geometry_types": geometry_types,
        "crs": crs,
        "attribute_fields": attribute_fields,
        "invalid_geometry_count": invalid_geometry_count,
        "has_prj": bool(prj_files),
    }

    if invalid_geometry_count > 0:
        return _build_result(
            "warning",
            ".zip",
            "shapefile_zip",
            f"Shapefile '{selected_stem}' прочитан: объектов {feature_count}, "
            f"типы геометрии: {', '.join(geometry_types)}, "
            f"CRS: {crs or 'не определена'}, невалидных геометрий: {invalid_geometry_count}.",
            details,
        )

    if not prj_files or crs is None:
        return _build_result(
            "warning",
            ".zip",
            "shapefile_zip",
            f"Shapefile '{selected_stem}' прочитан: объектов {feature_count}, "
            f"типы геометрии: {', '.join(geometry_types)}, "
            f"но CRS не задана или файл .prj отсутствует.",
            details,
        )

    return _build_result(
        "passed",
        ".zip",
        "shapefile_zip",
        f"Shapefile '{selected_stem}' успешно прочитан: объектов {feature_count}, "
        f"типы геометрии: {', '.join(geometry_types)}, "
        f"CRS: {crs}, невалидных геометрий не обнаружено.",
        details,
    )


def validate_submission_file(filename: str, file_bytes: bytes) -> dict:
    """
    Главная точка входа для технической проверки submission-файла.
    Возвращает структурированный результат, который дальше будет
    использоваться и для сохранения check-а, и для оценки по требованиям задания.
    """
    extension = Path(filename).suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        return _build_result(
            "failed",
            extension or "unknown",
            "unknown",
            f"Формат {extension or 'без расширения'} не поддерживается. "
            f"Допустимы: {', '.join(sorted(ALLOWED_EXTENSIONS))}.",
        )

    if len(file_bytes) == 0:
        return _build_result(
            "failed",
            extension,
            "unknown",
            "Загружен пустой файл.",
        )

    if extension == ".geojson":
        return _validate_geojson(file_bytes)

    if extension == ".txt":
        return _validate_txt(file_bytes)

    if extension == ".docx":
        return _validate_docx(file_bytes)

    if extension == ".doc":
        return _validate_doc(file_bytes)

    if extension == ".zip":
        return _validate_shapefile_zip(file_bytes)

    return _build_result(
        "failed",
        extension,
        "unknown",
        "Не удалось определить правило проверки для файла.",
    )