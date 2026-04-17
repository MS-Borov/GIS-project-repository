import json

from app.services.llm_client import generate_text_with_llm


def build_ai_review_prompt(
    assignment_title: str,
    requirements_dict: dict | None,
    report_context: dict | None,
    gis_technical_result: dict | None,
    requirements_result: dict | None,
) -> tuple[str, str]:
    """
    Формирует prompt для LLM только когда у нас есть
    достаточный и корректный набор входных данных.
    """
    system_prompt = (
        "Ты — интеллектуальный помощник образовательной GIS-платформы. "
        "Подготовь аккуратное заключение по работе студента. "
        "Нельзя выдумывать факты. "
        "Можно опираться только на переданные требования задания, "
        "результаты формальной GIS-проверки и данные по отчёту. "
        "Если данные неполные, прямо укажи ограничения. "
        "Если текст отчёта не был извлечён, не делай вид, что ты его прочитал. "
        "Нельзя придумывать числовые оценки, баллы и итоговые отметки, "
        "если шкала явно не дана во входных данных. "
        "Отвечай по-русски. "
        "Структура ответа:\n"
        "1. Краткий итог\n"
        "2. Что сделано хорошо\n"
        "3. Что не соответствует требованиям\n"
        "4. Что стоит исправить\n"
        "5. Ограничения автоматической проверки"
    )

    user_payload = {
        "assignment_title": assignment_title,
        "requirements": requirements_dict,
        "report_context": report_context,
        "gis_technical_result": gis_technical_result,
        "requirements_result": requirements_result,
    }

    user_prompt = (
        "Ниже данные по работе студента. "
        "Подготовь осмысленное и строго фактологичное заключение.\n\n"
        f"{json.dumps(user_payload, ensure_ascii=False, indent=2)}"
    )

    return system_prompt, user_prompt


def build_fallback_ai_review(
    assignment_title: str,
    requirements_dict: dict | None,
    report_context: dict | None,
    gis_technical_result: dict | None,
    requirements_result: dict | None,
    llm_error_message: str,
) -> dict:
    """
    Резервный обзор без LLM.
    Его используем в трёх случаях:
    1. модель недоступна,
    2. данных недостаточно,
    3. есть технические ограничения по отчёту.
    """
    technical_details = (gis_technical_result or {}).get("details", {}) if gis_technical_result else {}
    req_problems = (requirements_result or {}).get("problems", []) if requirements_result else []
    req_warnings = (requirements_result or {}).get("warnings", []) if requirements_result else []
    req_passed_rules = (requirements_result or {}).get("passed_rules", []) if requirements_result else []

    geometry_types = technical_details.get("geometry_types") or []
    crs = technical_details.get("crs")
    feature_count = technical_details.get("feature_count")
    attribute_fields = technical_details.get("attribute_fields") or []
    invalid_geometry_count = technical_details.get("invalid_geometry_count")

    report_message = "Отчёт не найден."
    if report_context:
        report_message = report_context.get("message", "Информация по отчёту недоступна.")

    strong_points = []
    weak_points = []
    advice = []

    if feature_count is not None:
        strong_points.append(f"GIS-слой удалось прочитать, количество объектов: {feature_count}.")
    if geometry_types:
        strong_points.append(f"Определены типы геометрии: {', '.join(geometry_types)}.")
    if crs:
        strong_points.append(f"Определена CRS: {crs}.")
    if attribute_fields:
        strong_points.append(f"Найдены атрибутивные поля: {', '.join(attribute_fields)}.")
    if req_passed_rules:
        strong_points.append(f"Пройдены правила: {', '.join(req_passed_rules)}.")

    if isinstance(invalid_geometry_count, int) and invalid_geometry_count > 0:
        weak_points.append(f"Обнаружено невалидных геометрий: {invalid_geometry_count}.")
        advice.append("Исправить невалидные геометрии и повторно проверить слой.")

    if req_problems:
        weak_points.extend(problem.get("message", "Есть несоответствие требованиям.") for problem in req_problems)
        advice.append("Сверить слой с требованиями задания: формат, CRS, обязательные поля и типы геометрии.")

    if req_warnings:
        weak_points.extend(warning.get("message", "Есть предупреждение.") for warning in req_warnings)
        advice.append("Проверить предупреждения и по возможности устранить их.")

    if requirements_dict and requirements_dict.get("report_required"):
        if not report_context or not report_context.get("can_analyze"):
            weak_points.append("Отчёт не удалось полноценно проанализировать автоматически.")
            advice.append("Для автоматического анализа отчёта использовать .docx или .txt.")

    if not advice:
        advice.append("Существенных замечаний не выявлено; рекомендуется ручная проверка преподавателем.")

    review_text = (
        f"1. Краткий итог\n"
        f"Автоматическая проверка работы по заданию «{assignment_title}» выполнена частично. "
        f"Полноценный AI-review не был использован. Причина: {llm_error_message}\n\n"
        f"2. Что сделано хорошо\n"
        f"{' '.join(strong_points) if strong_points else 'Недостаточно данных, чтобы надёжно выделить сильные стороны.'}\n\n"
        f"3. Что не соответствует требованиям\n"
        f"{' '.join(weak_points) if weak_points else 'Критичных несоответствий по имеющимся данным не выявлено.'}\n\n"
        f"4. Что стоит исправить\n"
        f"{' '.join(advice)}\n\n"
        f"5. Ограничения автоматической проверки\n"
        f"{report_message}"
    )

    return {
        "status": "fallback",
        "message": "Возвращён резервный обзор без LLM.",
        "review_text": review_text,
        "meta": {
            "llm_available": False,
            "fallback_used": True,
            "reason": llm_error_message,
        },
    }


def generate_ai_review(
    assignment_title: str,
    requirements_dict: dict | None,
    report_context: dict | None,
    gis_technical_result: dict | None,
    requirements_result: dict | None,
) -> dict:
    """
    Генерирует review через локальную модель,
    но только если входные данные достаточны.
    """

    # 1. Без GIS technical result LLM вообще не запускаем.
    if gis_technical_result is None:
        return build_fallback_ai_review(
            assignment_title=assignment_title,
            requirements_dict=requirements_dict,
            report_context=report_context,
            gis_technical_result=gis_technical_result,
            requirements_result=requirements_result,
            llm_error_message="Не найден technical GIS-check.",
        )

    # 2. Если отчёт найден, но не извлечён, не запрещаем review полностью,
    #    но честно оставляем это как ограничение.
    system_prompt, user_prompt = build_ai_review_prompt(
        assignment_title=assignment_title,
        requirements_dict=requirements_dict,
        report_context=report_context,
        gis_technical_result=gis_technical_result,
        requirements_result=requirements_result,
    )

    llm_result = generate_text_with_llm(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
    )

    if llm_result["status"] != "passed" or not llm_result.get("text"):
        return build_fallback_ai_review(
            assignment_title=assignment_title,
            requirements_dict=requirements_dict,
            report_context=report_context,
            gis_technical_result=gis_technical_result,
            requirements_result=requirements_result,
            llm_error_message=llm_result.get("message", "Локальная модель не ответила."),
        )

    return {
        "status": "passed",
        "message": llm_result["message"],
        "review_text": llm_result["text"],
        "meta": llm_result.get("meta", {}),
    }