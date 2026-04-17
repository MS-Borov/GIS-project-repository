def _normalize_text(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip().lower().replace(" ", "")


def evaluate_asset_against_requirements(requirements, validation_result: dict) -> dict:
    """
    Возвращает уже не просто статус и текст,
    а полноценный структурированный результат сопоставления.
    """
    if requirements is None:
        return {
            "status": "warning",
            "message": (
                "Для задания пока не заданы структурированные требования. "
                "Выполнена только базовая техническая проверка."
            ),
            "result_json": {
                "mode": "requirements_missing",
                "problems": [],
                "warnings": [
                    "Для задания не сохранены AssignmentRequirements."
                ],
                "passed_rules": [],
            },
        }

    if requirements.auto_checkable is False:
        return {
            "status": "warning",
            "message": (
                "Задание помечено как не полностью автоматизируемое. "
                "Проверка по структурированным требованиям ограничена."
            ),
            "result_json": {
                "mode": "not_auto_checkable",
                "problems": [],
                "warnings": [
                    "AssignmentRequirements.auto_checkable = false"
                ],
                "passed_rules": [],
            },
        }

    problems = []
    warnings = []
    passed_rules = []

    detected_format = validation_result.get("detected_format")
    details = validation_result.get("details", {})

    # 1. Формат файла
    if requirements.deliverable_format:
        if detected_format != requirements.deliverable_format:
            problems.append({
                "code": "deliverable_format_mismatch",
                "message": (
                    f"Ожидался формат '{requirements.deliverable_format}', "
                    f"но фактически получен '{detected_format}'."
                ),
            })
        else:
            passed_rules.append("deliverable_format_matches")

    # 2. Типы геометрии
    if requirements.expected_geometry_types:
        uploaded_geometry_types = details.get("geometry_types")
        if not uploaded_geometry_types:
            warnings.append({
                "code": "geometry_types_not_detected",
                "message": "Не удалось определить типы геометрии у целевого слоя.",
            })
        else:
            expected = set(requirements.expected_geometry_types)
            actual = set(uploaded_geometry_types)

            unexpected = sorted(actual - expected)
            if unexpected:
                problems.append({
                    "code": "unexpected_geometry_types",
                    "message": (
                        f"Обнаружены неожиданные типы геометрии: {', '.join(unexpected)}. "
                        f"Ожидались: {', '.join(sorted(expected))}."
                    ),
                })
            else:
                passed_rules.append("geometry_types_match")

    # 3. CRS
    if requirements.expected_crs:
        uploaded_crs = details.get("crs")
        if not uploaded_crs:
            warnings.append({
                "code": "crs_not_detected",
                "message": "CRS не определена, поэтому сравнение с требуемой системой координат не выполнено.",
            })
        else:
            expected_crs_norm = _normalize_text(requirements.expected_crs)
            uploaded_crs_norm = _normalize_text(uploaded_crs)

            if expected_crs_norm != uploaded_crs_norm:
                problems.append({
                    "code": "crs_mismatch",
                    "message": (
                        f"Ожидалась CRS '{requirements.expected_crs}', "
                        f"но обнаружена '{uploaded_crs}'."
                    ),
                })
            else:
                passed_rules.append("crs_matches")

    # 4. Обязательные поля
    if requirements.required_attributes:
        uploaded_fields = set(details.get("attribute_fields") or [])
        required_fields = set(requirements.required_attributes)

        missing_fields = sorted(required_fields - uploaded_fields)
        if missing_fields:
            problems.append({
                "code": "missing_required_attributes",
                "message": f"Отсутствуют обязательные поля: {', '.join(missing_fields)}.",
                "missing_fields": missing_fields,
            })
        else:
            passed_rules.append("required_attributes_present")

    # 5. Невалидные геометрии
    invalid_geometry_count = details.get("invalid_geometry_count")
    if isinstance(invalid_geometry_count, int):
        if invalid_geometry_count > 0:
            warnings.append({
                "code": "invalid_geometries_detected",
                "message": f"Обнаружено невалидных геометрий: {invalid_geometry_count}.",
                "invalid_geometry_count": invalid_geometry_count,
            })
        else:
            passed_rules.append("geometry_valid")

    # 6. Эталонный слой
    if requirements.needs_reference_layer:
        warnings.append({
            "code": "reference_layer_not_implemented",
            "message": (
                "Для задания требуется эталонный слой / подложка, "
                "но автоматическое сравнение с эталоном пока не реализовано."
            ),
        })

    # 7. Отчёт
    if requirements.report_required:
        warnings.append({
            "code": "report_check_not_implemented",
            "message": (
                "Для задания требуется отчёт, но содержательная проверка отчёта пока не реализована."
            ),
        })

    if problems:
        status = "failed"
    elif warnings:
        status = "warning"
    else:
        status = "passed"

    message_parts = []

    if not problems and not warnings:
        message_parts.append(
            "Целевой GIS-asset соответствует текущим структурированным требованиям задания."
        )

    if problems:
        message_parts.append(
            "Проблемы: " + " ".join(problem["message"] for problem in problems)
        )

    if warnings:
        message_parts.append(
            "Предупреждения: " + " ".join(warning["message"] for warning in warnings)
        )

    result_json = {
        "mode": "asset_requirements_evaluation",
        "detected_format": detected_format,
        "details": details,
        "problems": problems,
        "warnings": warnings,
        "passed_rules": passed_rules,
    }

    return {
        "status": status,
        "message": " ".join(message_parts),
        "result_json": result_json,
    }