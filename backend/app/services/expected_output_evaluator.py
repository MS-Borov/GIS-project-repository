def _normalize_format(value: str | None) -> str | None:
    if value is None:
        return None

    value = value.strip().lower()

    mapping = {
        "shp": "shapefile_zip",
        ".shp": "shapefile_zip",
        "shape": "shapefile_zip",
        "shapefile": "shapefile_zip",
        "shapefile_zip": "shapefile_zip",
        "zip": "shapefile_zip",
        ".zip": "shapefile_zip",
        "geojson": "geojson",
        ".geojson": "geojson",
        "docx": "docx",
        ".docx": "docx",
        "doc": "doc",
        ".doc": "doc",
        "txt": "txt",
        ".txt": "txt",
    }

    return mapping.get(value, value)


def _normalize_text(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip().lower()


def _normalize_geometry_type(value: str | None) -> str | None:
    if value is None:
        return None

    value = value.strip().replace(" ", "").lower()

    mapping = {
        "line": "linestring",
        "polyline": "linestring",
        "linestring": "linestring",
        "multiline": "multilinestring",
        "multilinestring": "multilinestring",
        "polygon": "polygon",
        "multipolygon": "multipolygon",
        "point": "point",
        "multipoint": "multipoint",
    }

    return mapping.get(value, value)


def _expand_compatible_geometry_types(values: set[str]) -> set[str]:
    expanded = set(values)

    if "linestring" in expanded:
        expanded.add("multilinestring")
    if "polygon" in expanded:
        expanded.add("multipolygon")

    return expanded


def evaluate_asset_against_expected_output(expected_output: dict, validation_result: dict) -> dict:
    """
    Проверяет один asset против одного ожидаемого output.
    """
    problems = []
    warnings = []
    passed_rules = []

    detected_format = validation_result.get("detected_format")
    details = validation_result.get("details", {})

    expected_name = expected_output.get("name")
    expected_format = expected_output.get("deliverable_format")
    expected_geometry_types = expected_output.get("expected_geometry_types") or []
    expected_crs = expected_output.get("expected_crs")
    required_attributes = expected_output.get("required_attributes") or []

    if expected_format:
        if _normalize_format(detected_format) != _normalize_format(expected_format):
            problems.append({
                "code": "deliverable_format_mismatch",
                "message": (
                    f"Для output '{expected_name}' ожидался формат '{expected_format}', "
                    f"но получен '{detected_format}'."
                ),
            })
        else:
            passed_rules.append("deliverable_format_matches")

    actual_geometry_types = {
        normalized
        for normalized in (
            _normalize_geometry_type(value)
            for value in (details.get("geometry_types") or [])
        )
        if normalized
    }
    if expected_geometry_types:
        expected_geometry_types_set = {
            normalized
            for normalized in (
                _normalize_geometry_type(value)
                for value in expected_geometry_types
            )
            if normalized
        }
        compatible_expected_geometry_types = _expand_compatible_geometry_types(expected_geometry_types_set)

        if not actual_geometry_types:
            warnings.append({
                "code": "geometry_types_not_detected",
                "message": f"Для output '{expected_name}' не удалось определить типы геометрии.",
            })
        else:
            unexpected = sorted(actual_geometry_types - compatible_expected_geometry_types)
            if unexpected:
                problems.append({
                    "code": "unexpected_geometry_types",
                    "message": (
                        f"Для output '{expected_name}' обнаружены неожиданные типы геометрии: "
                        f"{', '.join(unexpected)}. Ожидались: {', '.join(sorted(expected_geometry_types_set))}."
                    ),
                })
            else:
                passed_rules.append("geometry_types_match")

    actual_crs = details.get("crs")
    if expected_crs:
        if not actual_crs:
            warnings.append({
                "code": "crs_not_detected",
                "message": f"Для output '{expected_name}' CRS не определена.",
            })
        else:
            if _normalize_text(actual_crs) != _normalize_text(expected_crs):
                problems.append({
                    "code": "crs_mismatch",
                    "message": (
                        f"Для output '{expected_name}' ожидалась CRS '{expected_crs}', "
                        f"но обнаружена '{actual_crs}'."
                    ),
                })
            else:
                passed_rules.append("crs_matches")

    actual_fields = set(details.get("attribute_fields") or [])
    if required_attributes:
        required_set = set(required_attributes)
        missing = sorted(required_set - actual_fields)
        if missing:
            problems.append({
                "code": "missing_required_attributes",
                "message": (
                    f"Для output '{expected_name}' отсутствуют обязательные поля: "
                    f"{', '.join(missing)}."
                ),
                "missing_fields": missing,
            })
        else:
            passed_rules.append("required_attributes_present")

    invalid_geometry_count = details.get("invalid_geometry_count")
    if isinstance(invalid_geometry_count, int):
        if invalid_geometry_count > 0:
            warnings.append({
                "code": "invalid_geometries_detected",
                "message": (
                    f"Для output '{expected_name}' обнаружено невалидных геометрий: "
                    f"{invalid_geometry_count}."
                ),
                "invalid_geometry_count": invalid_geometry_count,
            })
        else:
            passed_rules.append("geometry_valid")

    if problems:
        status = "failed"
    elif warnings:
        status = "warning"
    else:
        status = "passed"

    message_parts = []

    if not problems and not warnings:
        message_parts.append(
            f"Output '{expected_name}' соответствует текущим требованиям."
        )

    if problems:
        message_parts.append("Проблемы: " + " ".join(problem["message"] for problem in problems))
    if warnings:
        message_parts.append("Предупреждения: " + " ".join(warning["message"] for warning in warnings))

    return {
        "status": status,
        "message": " ".join(message_parts),
        "result_json": {
            "mode": "expected_output_evaluation",
            "expected_output": expected_output,
            "detected_format": detected_format,
            "details": details,
            "problems": problems,
            "warnings": warnings,
            "passed_rules": passed_rules,
        },
    }
