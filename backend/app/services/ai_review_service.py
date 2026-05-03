import json

from app.services.llm_client import generate_text_with_llm

MAX_PROBLEMS_FOR_LLM = 8
MAX_WARNINGS_FOR_LLM = 8
MAX_OUTPUTS_FOR_LLM = 8
MAX_MESSAGE_LEN = 300
MAX_REPORT_TEXT_PREVIEW = 1800
MAX_TECHNICAL_CHECKS_FOR_LLM = 10


def _shorten(value: str | None, max_len: int = MAX_MESSAGE_LEN) -> str | None:
    if value is None:
        return None
    value = str(value)
    if len(value) <= max_len:
        return value
    return value[:max_len] + "..."


def _compact_problem(item: dict) -> dict:
    return {
        "code": item.get("code"),
        "message": _shorten(item.get("message")),
    }


def _compact_requirements_result(requirements_result: dict | None) -> dict | None:
    if not requirements_result:
        return None

    summary = requirements_result.get("summary") or {}
    outputs = requirements_result.get("outputs") or []

    compact_outputs = []
    for output in outputs[:MAX_OUTPUTS_FOR_LLM]:
        compact_outputs.append({
            "asset_name": output.get("asset_name"),
            "expected_output_name": (output.get("expected_output") or {}).get("name"),
            "status": output.get("status"),
            "message": _shorten(output.get("message")),
            "problems": [
                _compact_problem(p)
                for p in (output.get("problems") or [])[:5]
            ],
            "warnings": [
                _compact_problem(w)
                for w in (output.get("warnings") or [])[:5]
            ],
        })

    return {
        "mode": summary.get("mode"),
        "counts": summary.get("counts"),
        "problems": [
            _compact_problem(p)
            for p in (summary.get("problems") or [])[:MAX_PROBLEMS_FOR_LLM]
        ],
        "warnings": [
            _compact_problem(w)
            for w in (summary.get("warnings") or [])[:MAX_WARNINGS_FOR_LLM]
        ],
        "outputs": compact_outputs,
    }


def _compact_report_context(report_context: dict | None) -> dict | None:
    if not report_context:
        return None

    document = report_context.get("document") or {}
    analysis = report_context.get("analysis") or {}
    analysis_details = analysis.get("details") or {}

    return {
        "document": {
            "asset_name": report_context.get("asset_name"),
            "asset_id": report_context.get("asset_id"),
            "format": document.get("format"),
            "can_analyze": document.get("can_analyze"),
            "message": _shorten(document.get("message")),
            "text_preview": _shorten(document.get("text"), MAX_REPORT_TEXT_PREVIEW),
        },
        "analysis": {
            "status": analysis.get("status"),
            "message": _shorten(analysis.get("message")),
            "details": {
                "word_count": analysis_details.get("word_count"),
                "sections_found": analysis_details.get("sections_found"),
                "mentions": analysis_details.get("mentions"),
                "warnings": [
                    _shorten(w)
                    for w in (analysis_details.get("warnings") or [])[:MAX_WARNINGS_FOR_LLM]
                ],
                "text_preview": _shorten(
                    analysis_details.get("text_preview"),
                    MAX_REPORT_TEXT_PREVIEW,
                ),
            },
        } if analysis else None,
    }


def _compact_gis_technical_result(gis_technical_result: dict | None) -> dict | None:
    if not gis_technical_result:
        return None

    checks = gis_technical_result.get("checks") or []
    compact_checks = []

    for check in checks[:MAX_TECHNICAL_CHECKS_FOR_LLM]:
        details = check.get("details") or {}
        compact_checks.append({
            "mode": check.get("mode"),
            "detected_format": check.get("detected_format"),
            "status": check.get("status"),
            "message": _shorten(check.get("message")),
            "details": {
                "asset_name": details.get("asset_name"),
                "asset_type": details.get("asset_type"),
                "feature_count": details.get("feature_count"),
                "geometry_types": details.get("geometry_types"),
                "crs": details.get("crs"),
                "attribute_fields": details.get("attribute_fields"),
                "invalid_geometry_count": details.get("invalid_geometry_count"),
            },
        })

    return {
        "mode": gis_technical_result.get("mode"),
        "checks_count": len(checks),
        "checks": compact_checks,
    }


def build_ai_review_prompt(
    assignment_title: str,
    requirements_dict: dict | None,
    report_context: dict | None,
    gis_technical_result: dict | None,
    requirements_result: dict | None,
) -> tuple[str, str]:
    system_prompt = (
        "Ты — интеллектуальный помощник образовательной GIS-платформы. "
        "Подготовь аккуратное заключение по работе студента. "
        "Нельзя выдумывать факты. "
        "Можно опираться только на переданные требования задания, "
        "результаты формальной GIS-проверки и данные по отчёту. "
        "Если formal GIS summary отсутствует, не делай вид, что карта полностью проверена. "
        "Если текст отчёта не извлечён, не делай вид, что ты его прочитал. "
        "Если report_context.document.can_analyze=true, отчёт найден и прочитан; нельзя писать, что отчёт не предоставлен. "
        "Если report_context.document.can_analyze=false, пиши, что отчёт найден, но текст не удалось извлечь, а не что отчёт отсутствует. "
        "Не противоречь сам себе: если в отчёте описаны отдельные действия, но warning говорит об отсутствии явного раздела, "
        "пиши 'ход работы описан фрагментарно / не выделен отдельным разделом', а не 'ход работы отсутствует'. "
        "Отсутствие явного заголовка или раздела не означает отсутствие содержания. "
        "Нельзя придумывать числовые оценки, баллы и итоговые отметки, "
        "если шкала явно не дана. "
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
        "report_context": _compact_report_context(report_context),
        "gis_technical_result": _compact_gis_technical_result(gis_technical_result),
        "requirements_result": _compact_requirements_result(requirements_result),
    }

    user_prompt = (
        "Ниже данные по работе студента. "
        "Подготовь строго фактологичное и полезное заключение.\n\n"
        f"{json.dumps(user_payload, ensure_ascii=False)}"
    )

    return system_prompt, user_prompt


def build_fallback_ai_review(
    assignment_title: str,
    report_context: dict | None,
    requirements_result: dict | None,
    llm_error_message: str,
) -> dict:
    report_document = (report_context or {}).get("document") or {}
    report_analysis = (report_context or {}).get("analysis") or {}

    requirements_summary = (requirements_result or {}).get("summary") or {}
    requirements_outputs = (requirements_result or {}).get("outputs") or []

    strong_points = []
    weak_points = []
    advice = []

    if report_analysis.get("details", {}).get("word_count"):
        strong_points.append(
            f"Отчёт извлечён, объём текста: {report_analysis['details']['word_count']} слов."
        )

    report_warnings = report_analysis.get("details", {}).get("warnings", [])
    if report_warnings:
        weak_points.extend(report_warnings)
        advice.append("Сделать структуру отчёта более явной: отдельные разделы для хода работы, результатов и выводов.")

    summary_problems = requirements_summary.get("problems", []) if isinstance(requirements_summary, dict) else []
    summary_warnings = requirements_summary.get("warnings", []) if isinstance(requirements_summary, dict) else []

    weak_points.extend(problem.get("message", "Есть несоответствие требованиям.") for problem in summary_problems)
    weak_points.extend(warning.get("message", "Есть предупреждение по formal-check.") for warning in summary_warnings)

    failed_outputs = []
    warning_outputs = []

    for output in requirements_outputs:
        problems = output.get("problems", []) if isinstance(output, dict) else []
        warnings = output.get("warnings", []) if isinstance(output, dict) else []

        failed_outputs.extend(problem.get("message", "Есть ошибка в expected output.") for problem in problems)
        warning_outputs.extend(warning.get("message", "Есть предупреждение в expected output.") for warning in warnings)

    weak_points.extend(failed_outputs)
    weak_points.extend(warning_outputs)

    if summary_problems or failed_outputs:
        advice.append("Исправить найденные несоответствия формальным требованиям задания.")
    if summary_warnings or warning_outputs:
        advice.append("Проверить и по возможности устранить предупреждения formal-check.")

    if not advice:
        advice.append("Существенных замечаний не выявлено; рекомендуется преподавательская проверка итоговой работы.")

    review_text = (
        f"1. Краткий итог\n"
        f"Автоматическая проверка по заданию «{assignment_title}» выполнена частично. "
        f"Полноценный LLM-анализ сейчас недоступен. Причина: {llm_error_message}\n\n"
        f"2. Что сделано хорошо\n"
        f"{' '.join(strong_points) if strong_points else 'Недостаточно данных, чтобы надёжно выделить сильные стороны.'}\n\n"
        f"3. Что не соответствует требованиям\n"
        f"{' '.join(weak_points) if weak_points else 'Критичных несоответствий по имеющимся данным не выявлено.'}\n\n"
        f"4. Что стоит исправить\n"
        f"{' '.join(advice)}\n\n"
        f"5. Ограничения автоматической проверки\n"
        f"{report_document.get('message', 'Информация по отчёту ограничена.')}"
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
    Полноценный LLM-review разрешаем только если есть formal summary по GIS-проверке.
    Без него модель не должна делать "полное заключение".
    """
    requirements_summary = (requirements_result or {}).get("summary") if requirements_result else None

    if not requirements_summary and not gis_technical_result and not report_context:
        return build_fallback_ai_review(
            assignment_title=assignment_title,
            report_context=report_context,
            requirements_result=requirements_result,
            llm_error_message="Не найден requirements_summary formal-check.",
        )

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
            report_context=report_context,
            requirements_result=requirements_result,
            llm_error_message=llm_result.get("message", "Локальная модель не ответила."),
        )

    return {
        "status": "passed",
        "message": llm_result["message"],
        "review_text": llm_result["text"],
        "meta": llm_result.get("meta", {}),
    }
