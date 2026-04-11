def _normalize_text(value: str | None) -> str | None:
    """
    Нормализация строк для мягкого сравнения CRS и форматов.
    """
    if value is None:
        return None
    return value.strip().lower().replace(" ", "")

def evaluate_submission_against_requirements(requirements, validation_result: dict) -> dict:
    """
    Сравнивает результат технической/GIS-проверки submission
    с требованиями конкретного задания.

    Важно:
    - это не "финальный ИИ", а структурированный этап сопоставления;
    - потом на основе этого результата LLM сможет делать понятное заключение.
    """
    if requirements is None:
        return {
            "status": "Warning",
            "message": "Задание помечено, как не полностью автоматизируемое. Выполнена только базовая техническая проверка.",
        }
    problems = []
    warnings = []

    detected_format = validation_result.get("detected_format")
    details = validation_result.get("details", {})

    # 1. Проверка формата сдачи
    if requirements.deliverable_format:
        if detected_format != requirements.deliverable_format:
            problems.append(
                f"Ожидался формат '{requirements.deliverable_format}', "
                f"но фактически получен '{detected_format}'."
            )

    # 2. Проверка типа геометрии
    if requirements.expected_geometry_types:
        uploaded_geometry_types = details.get("geometry_types")
        if not uploaded_geometry_types:
            warnings.append("Не удалось определить типы геометрии в submission.")
        else:
            expected = set(requirements.expected_geometry_types)
            actual = set(uploaded_geometry_types)

            # Если среди загруженных типов есть неразрешённые — это проблема
            unexpected = sorted(actual - expected)
            if unexpected:
                problems.append(
                    f"Обнаружены неожиданные типы геометрии: {', '.join(unexpected)}. "
                    f"Ожидались: {', '.join(sorted(expected))}."
                )

    # 3. Проверка CRS
    if requirements.expected_crs:
        uploaded_crs = details.get("crs")
        if not uploaded_crs:
            warnings.append("CRS не определена, поэтому сравнение с требуемой системой координат не выполнено.")
        else:
            expected_crs_norm = _normalize_text(requirements.expected_crs)
            uploaded_crs_norm = _normalize_text(uploaded_crs)

            if expected_crs_norm != uploaded_crs_norm:
                problems.append(
                    f"Ожидалась CRS '{requirements.expected_crs}', "
                    f"но обнаружена '{uploaded_crs}'."
                )

    # 4. Проверка обязательных атрибутов
    if requirements.required_attributes:
        uploaded_fields = set(details.get("attribute_fields") or [])
        required_fields = set(requirements.required_attributes)

        missing_fields = sorted(required_fields - uploaded_fields)
        if missing_fields:
            problems.append(
                f"Отсутствуют обязательные поля: {', '.join(missing_fields)}."
            )

    # 5. Базовая реакция на невалидную геометрию
    invalid_geometry_count = details.get("invalid_geometry_count")
    if isinstance(invalid_geometry_count, int) and invalid_geometry_count > 0:
        warnings.append(
            f"Обнаружено невалидных геометрий: {invalid_geometry_count}."
        )

    # 6. Пока только предупреждаем, если заданию нужен эталонный слой,
    # но отдельная логика эталонного сравнения ещё не реализована.
    if requirements.needs_reference_layer:
        warnings.append(
            "Для задания требуется эталонный слой / подложка, "
            "но автоматическое сравнение с эталоном пока не реализовано."
        )

    # 7. Отчёт пока не проверяем
    if requirements.report_required:
        warnings.append(
            "Для задания требуется отчёт, но автоматическая проверка отчёта пока не реализована."
        )

    # Итоговый статус
    if problems:
        status = "failed"
    elif warnings:
        status = "warning"
    else:
        status = "passed"

    message_parts = []

    if not problems and not warnings:
        message_parts.append("Submission соответствует текущим структурированным требованиям задания.")

    if problems:
        message_parts.append("Проблемы: " + " ".join(problems))

    if warnings:
        message_parts.append("Предупреждения: " + " ".join(warnings))

    return {
        "status": status,
        "message": " ".join(message_parts),
    }