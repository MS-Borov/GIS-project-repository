import re


def _detect_deliverable_format(text: str) -> str | None:
    lowered = text.lower()

    if "geojson" in lowered:
        return "geojson"

    if "шейп-файл" in lowered or "shape-file" in lowered or "shapefile" in lowered:
        return "shapefile_zip"

    if ".docx" in lowered:
        return "docx"

    if ".doc" in lowered:
        return "doc"

    if ".txt" in lowered:
        return "txt"

    return None


def _detect_geometry_types(text: str) -> list[str] | None:
    lowered = text.lower()
    found: list[str] = []

    if "point" in lowered or "точк" in lowered:
        found.append("Point")
    if "linestring" in lowered or "line string" in lowered or "линей" in lowered or "линия" in lowered:
        found.append("LineString")
    if "polygon" in lowered or "полигон" in lowered:
        found.append("Polygon")
    if "multipolygon" in lowered or "мультиполигон" in lowered:
        found.append("MultiPolygon")
    if "multilinestring" in lowered:
        found.append("MultiLineString")
    if "multipoint" in lowered:
        found.append("MultiPoint")

    unique = list(dict.fromkeys(found))
    return unique or None


def _detect_crs(text: str) -> str | None:
    lowered = text.lower()

    if "epsg:4326" in lowered:
        return "EPSG:4326"
    if "wgs 1984" in lowered or "wgs84" in lowered or "wgs 84" in lowered:
        return "WGS 1984"
    if "pulkovo 1942" in lowered or "пулково 1942" in lowered:
        return "Pulkovo 1942"
    if "неизвестная система координат" in lowered:
        return "Unknown"

    return None


def _detect_required_attributes(text: str) -> list[str] | None:
    candidates = re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_]{2,30}\b", text)

    lowered_blacklist = {
        "arcmap",
        "arccatalog",
        "insert",
        "legend",
        "title",
        "preview",
        "properties",
        "selection",
        "options",
        "apply",
        "cancel",
        "polygon",
        "point",
        "line",
        "shape",
        "geometry",
        "world",
        "file",
        "view",
    }

    attrs = []
    for c in candidates:
        c_lower = c.lower()
        if "_" in c and c_lower not in lowered_blacklist:
            attrs.append(c)

    unique_attrs = list(dict.fromkeys(attrs))
    return unique_attrs or None


def _detect_topology_rules(text: str) -> list[str] | None:
    lowered = text.lower()
    rules = []

    if "не должны пересекаться" in lowered:
        rules.append("features must not overlap")
    if "самопересеч" in lowered:
        rules.append("geometries must not self-intersect")
    if "замкнут" in lowered:
        rules.append("lines/polygons must be closed where required")
    if "тополог" in lowered:
        rules.append("topology rules are mentioned in assignment")

    return rules or None


def _detect_reference_layer(text: str) -> bool:
    lowered = text.lower()
    keywords = ["подложк", "эталон", "растр", "скан карты", "ортофото", "reference"]
    return any(k in lowered for k in keywords)


def _detect_report_required(text: str) -> bool:
    lowered = text.lower()
    return "отчет" in lowered or "отчёт" in lowered or "report" in lowered


def _detect_auto_checkable(
    deliverable_format: str | None,
    geometry_types: list[str] | None,
) -> bool:
    if deliverable_format in {"geojson", "shapefile_zip"}:
        return True
    if geometry_types:
        return True
    return False


def extract_requirements_from_text(text: str, source_doc_name: str | None = None) -> dict:
    deliverable_format = _detect_deliverable_format(text)
    geometry_types = _detect_geometry_types(text)
    expected_crs = _detect_crs(text)
    required_attributes = _detect_required_attributes(text)
    topology_rules = _detect_topology_rules(text)
    needs_reference_layer = _detect_reference_layer(text)
    report_required = _detect_report_required(text)
    auto_checkable = _detect_auto_checkable(deliverable_format, geometry_types)

    return {
        "source_doc_name": source_doc_name,
        "source_text": text,
        "deliverable_format": deliverable_format,
        "expected_geometry_types": geometry_types,
        "expected_crs": expected_crs,
        "required_attributes": required_attributes,
        "topology_rules": topology_rules,
        "needs_reference_layer": needs_reference_layer,
        "report_required": report_required,
        "auto_checkable": auto_checkable,
        "extraction_status": "draft",
        "extraction_notes": (
            "Требования извлечены эвристически из текста задания. "
            "Нужна проверка преподавателем или LLM-модулем."
        ),
    }