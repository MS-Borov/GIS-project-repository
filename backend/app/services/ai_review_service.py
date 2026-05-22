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


def _compact_problem(item) -> dict:
    if isinstance(item, dict):
        return {
            "code": item.get("code"),
            "message": _shorten(item.get("message")),
        }
    return {
        "code": None,
        "message": _shorten(str(item)),
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
    assignment_match = report_context.get("assignment_match") or {}

    return {
        "document": {
            "asset_name": report_context.get("asset_name"),
            "asset_id": report_context.get("asset_id"),
            "format": document.get("format"),
            "can_analyze": document.get("can_analyze"),
            "message": _shorten(document.get("message")),
            "text_preview": _shorten(document.get("text"), MAX_REPORT_TEXT_PREVIEW),
            "image_count": document.get("image_count"),
            "skipped_image_count": document.get("skipped_image_count"),
            "images": [
                {
                    "filename": image.get("filename"),
                    "mime_type": image.get("mime_type"),
                    "size_bytes": image.get("size_bytes"),
                }
                for image in (document.get("images") or [])[:6]
            ],
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
                "notes": [
                    _shorten(note)
                    for note in (analysis_details.get("notes") or [])[:MAX_WARNINGS_FOR_LLM]
                ],
                "text_preview": _shorten(
                    analysis_details.get("text_preview"),
                    MAX_REPORT_TEXT_PREVIEW,
                ),
            },
        } if analysis else None,
        "assignment_match": {
            "status": assignment_match.get("status"),
            "message": assignment_match.get("message"),
            "problems": assignment_match.get("problems") or [],
            "warnings": assignment_match.get("warnings") or [],
            "evidence": assignment_match.get("evidence") or [],
        } if assignment_match else None,
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


def _formal_verification_context(
    report_context: dict | None,
    gis_technical_result: dict | None,
    requirements_result: dict | None,
) -> dict:
    verified_facts = []
    unverified_visual_facts = [
        "масштаб карты",
        "наличие заголовка/подписи карты",
        "наличие и полнота легенды",
        "точность проекции/CRS, если она видна только на скриншоте",
        "наличие PNG-экспорта, если он виден только в отчёте",
        "порядок слоёв в таблице содержания, если он виден только на скриншоте",
        "корректность символизации каждого слоя",
    ]

    document = (report_context or {}).get("document") or {}
    if document.get("can_analyze"):
        verified_facts.append(f"отчёт прочитан как {document.get('format') or 'document'}")
    if document.get("image_count"):
        verified_facts.append(f"из отчёта извлечены изображения: {document.get('image_count')}")
    assignment_match = (report_context or {}).get("assignment_match") or {}
    if assignment_match.get("status") == "failed":
        verified_facts.append("автоматическая проверка соответствия отчёта заданию выявила признаки другой лабораторной работы")

    checks = (gis_technical_result or {}).get("checks") or []
    for check in checks[:8]:
        if not isinstance(check, dict):
            continue
        status = check.get("status")
        message = check.get("message")
        detected_format = check.get("detected_format")
        details = check.get("details") or {}
        if status or message or detected_format:
            verified_facts.append(
                f"technical check: {message or detected_format or status}"
            )
        if details.get("crs"):
            verified_facts.append(f"CRS из GIS-файла: {details.get('crs')}")
        if details.get("geometry_types"):
            verified_facts.append(f"типы геометрии из GIS-файла: {details.get('geometry_types')}")
        if details.get("attribute_fields"):
            verified_facts.append(f"атрибутивные поля из GIS-файла: {details.get('attribute_fields')}")

    summary = (requirements_result or {}).get("summary") or {}
    if isinstance(summary, dict):
        for item in (summary.get("passed_rules") or [])[:8]:
            verified_facts.append(f"requirements rule: {item}")

    outputs = (requirements_result or {}).get("outputs") or []
    for output in outputs[:8]:
        if not isinstance(output, dict):
            continue
        status = output.get("status")
        message = output.get("message")
        expected_output = output.get("expected_output") or {}
        name = output.get("asset_name") or expected_output.get("name")
        if status == "passed" and (name or message):
            verified_facts.append(f"expected output passed: {name or message}")

    return {
        "verified_facts": verified_facts or [
            "формальные GIS-проверки не подтвердили масштаб, легенду, порядок слоёв, PNG-экспорт или точность проекции"
        ],
        "do_not_call_automatic_if_only_visible_in_report": unverified_visual_facts,
        "instruction": (
            "В разделе 'Что проверено автоматически' можно использовать только verified_facts. "
            "Факты из do_not_call_automatic_if_only_visible_in_report можно упоминать только как видимые в отчёте/на изображениях."
        ),
    }


def _build_report_review_system_prompt() -> str:
    return (
        "You are an assistant for a GIS education platform. "
        "Prepare a careful teacher-style review of a student's submitted work. "
        "Use only the provided assignment requirements, formal GIS checks, extracted report text, and attached report images. "
        "The report may be mostly screenshots and may not have a strict report structure; do not penalize the student only because headings like 'methodology' or 'conclusion' are absent. "
        "First check whether the report actually matches the current assignment: map topic, software/context, layer names, task wording, screenshots, and submitted files. "
        "If the text or screenshots look like a different lab, different task, or unrelated software workflow, mark it as a serious mismatch. "
        "When images are attached, inspect them as evidence: identify visible maps, legends, layers, attribute tables, tools, or result screenshots and compare them with the assignment context. "
        "Do not invent details that are not visible in text, images, or formal checks. "
        "Do not invent numeric grades or final marks unless a grading scale is explicitly provided. "
        "Write only the final review. Do not output classification labels, token lists, internal rubric tags, repeated counters, or English service markers such as OTHER, MISC, REPORT, REVIEW, FINAL, END, DONE, COMPLETE, ERROR. "
        "Keep the review concise: 5 sections, 1-3 sentences per section. "
        "Answer in Russian with these sections: "
        "1. Вердикт по соответствию заданию; "
        "2. Доказательства из текста и изображений; "
        "3. Замечания по содержанию; "
        "4. Что исправить; "
        "5. Ограничения автоматической проверки."
    )


def _report_images_for_llm(report_context: dict | None) -> list[dict]:
    document = (report_context or {}).get("document") or {}
    return document.get("images") or []


def _format_list(values: list[str], fallback: str, limit: int = 6) -> str:
    cleaned = [str(value).strip() for value in values if str(value).strip()]
    if not cleaned:
        return fallback
    return "; ".join(cleaned[:limit])


def _collect_requirement_names(requirements_dict: dict | None) -> list[str]:
    if not requirements_dict:
        return []

    names = []
    expected_outputs = requirements_dict.get("expected_outputs_json") or []
    if isinstance(expected_outputs, list):
        for output in expected_outputs:
            if isinstance(output, dict):
                name = output.get("name") or output.get("layer_name") or output.get("asset_name")
                if name:
                    names.append(str(name))

    required_attributes = requirements_dict.get("required_attributes") or []
    if isinstance(required_attributes, list):
        for attribute in required_attributes:
            if isinstance(attribute, str):
                names.append(attribute)
            elif isinstance(attribute, dict):
                name = attribute.get("name") or attribute.get("field")
                if name:
                    names.append(str(name))

    return names


def _build_rule_based_review(
    assignment_title: str,
    requirements_dict: dict | None,
    report_context: dict | None,
    gis_technical_result: dict | None,
    requirements_result: dict | None,
    llm_error_message: str | None = None,
) -> dict:
    report_document = (report_context or {}).get("document") or {}
    report_analysis = (report_context or {}).get("analysis") or {}
    details = report_analysis.get("details") or {}
    requirements_summary = (requirements_result or {}).get("summary") or {}
    requirements_outputs = (requirements_result or {}).get("outputs") or []
    checks = (gis_technical_result or {}).get("checks") or []

    word_count = details.get("word_count") or 0
    image_count = report_document.get("image_count") or details.get("image_count") or 0
    sent_images = len(report_document.get("images") or [])
    source_doc_name = (requirements_dict or {}).get("source_doc_name")
    source_text = (requirements_dict or {}).get("source_text_preview")
    expected_crs = (requirements_dict or {}).get("expected_crs")
    expected_geometry_types = (requirements_dict or {}).get("expected_geometry_types")
    requirement_names = _collect_requirement_names(requirements_dict)

    summary_problems = requirements_summary.get("problems", []) if isinstance(requirements_summary, dict) else []
    summary_warnings = requirements_summary.get("warnings", []) if isinstance(requirements_summary, dict) else []
    output_problems = []
    output_warnings = []
    output_names = []

    for output in requirements_outputs:
        if not isinstance(output, dict):
            continue
        expected_output = output.get("expected_output") or {}
        name = output.get("asset_name") or expected_output.get("name")
        if name:
            output_names.append(str(name))
        output_problems.extend((problem or {}).get("message") for problem in output.get("problems", []) if isinstance(problem, dict))
        output_warnings.extend((warning or {}).get("message") for warning in output.get("warnings", []) if isinstance(warning, dict))

    technical_evidence = []
    for check in checks[:6]:
        if not isinstance(check, dict):
            continue
        technical_evidence.append(check.get("message") or check.get("status") or check.get("detected_format"))

    problems = [
        item.get("message")
        for item in summary_problems
        if isinstance(item, dict) and item.get("message")
    ] + [message for message in output_problems if message]

    warnings = [
        item.get("message")
        for item in summary_warnings
        if isinstance(item, dict) and item.get("message")
    ] + [message for message in output_warnings if message]

    if problems:
        verdict = (
            f"По заданию «{assignment_title}» автоматическая проверка выявила несоответствия, "
            "поэтому работу нельзя считать полностью подтверждённой без исправлений."
        )
    elif warnings:
        verdict = (
            f"По заданию «{assignment_title}» критичных несоответствий автоматически не выявлено, "
            "но есть предупреждения, которые стоит посмотреть преподавателю."
        )
    else:
        verdict = (
            f"По заданию «{assignment_title}» критичных несоответствий по доступным данным не выявлено. "
            "Вывод основан на отчёте, извлечённом тексте, изображениях и доступных формальных проверках."
        )

    llm_note = (
        f" Мультимодальная модель вернула некорректный ответ, поэтому ниже приведён резервный анализ платформы: {llm_error_message}."
        if llm_error_message
        else ""
    )

    checked_items = [
        f"формат и читаемость отчёта ({report_document.get('format') or 'unknown'})",
        f"объём извлечённого текста ({word_count} слов)",
        f"наличие изображений/скриншотов ({image_count} всего, {sent_images} передано в AI-контекст)",
    ]
    if source_doc_name:
        checked_items.append(f"контекст задания из файла «{source_doc_name}»")
    if expected_crs:
        checked_items.append(f"ожидаемая система координат/проекция: {expected_crs}")
    if expected_geometry_types:
        checked_items.append(f"ожидаемые типы геометрии: {expected_geometry_types}")

    text_evidence = []
    if source_text:
        text_evidence.append("в контекст проверки передан текст задания/методички")
    if details.get("mentions", {}).get("crs"):
        text_evidence.append("в тексте отчёта обнаружены упоминания системы координат или EPSG/CRS")
    if details.get("mentions", {}).get("attributes"):
        text_evidence.append("в тексте отчёта есть упоминания атрибутов или полей")
    if requirement_names:
        text_evidence.append(f"из требований выделены проверяемые элементы: {_format_list(requirement_names, '')}")

    image_evidence = (
        f"В отчёте найдено {image_count} изображений; до {sent_images} изображений используется для визуального контекста проверки. "
        "По ним преподаватель может сверить вид карты, легенду, слои, подписи, компоновку и соответствие теме задания."
        if image_count
        else "Изображения в отчёте не найдены, поэтому визуальное подтверждение карты недоступно."
    )

    risk_items = []
    if problems:
        risk_items.extend(problems)
    if warnings:
        risk_items.extend(warnings)
    if not requirements_outputs:
        risk_items.append("не найдены отдельные checks типа requirements_output для ожидаемых слоёв")
    if not checks:
        risk_items.append("не найдены технические проверки GIS-файлов, поэтому состав архива и реальные слои подтверждены не полностью")

    review_text = (
        "1. Вердикт по соответствию заданию\n"
        f"{verdict}{llm_note}\n\n"
        "2. Что было проверено автоматически\n"
        f"Платформа проверила: {_format_list(checked_items, 'доступность отчёта и базовый контекст сдачи')}. "
        f"Также были учтены результаты формальных проверок: {_format_list(technical_evidence, 'детальные technical checks отсутствуют')}.\n\n"
        "3. Доказательства из текста отчёта\n"
        f"{_format_list(text_evidence, 'Из текста отчёта извлечён общий контент, но явные проверяемые признаки требуют ручной сверки с заданием.')}. "
        f"Объём извлечённого текста: {word_count} слов.\n\n"
        "4. Доказательства из изображений и карты\n"
        f"{image_evidence}\n\n"
        "5. Замечания и риски\n"
        f"{_format_list(risk_items, 'Существенных замечаний по доступным автоматическим данным не выявлено.')}\n\n"
        "6. Что преподавателю проверить вручную\n"
        "Нужно вручную сверить, что скриншоты и итоговые файлы относятся именно к этому заданию, что все требуемые слои и атрибуты присутствуют в сдаваемом архиве, "
        "а оформление карты соответствует методичке. Если задание требует отдельный PNG/PDF/архив проекта, наличие этих файлов следует подтверждать по содержимому сдачи, а не только по скриншотам в отчёте."
    )

    return {
        "status": "fallback" if llm_error_message else "passed",
        "message": "Сформирован резервный анализ по данным платформы." if llm_error_message else "Сформирован анализ по данным платформы.",
        "review_text": review_text,
        "meta": {
            "llm_available": not bool(llm_error_message),
            "fallback_used": bool(llm_error_message),
            "reason": llm_error_message,
        },
    }


def _build_detailed_report_review_system_prompt() -> str:
    return (
        "Ты помощник преподавателя на образовательной ГИС-платформе. "
        "Составь подробный отзыв по работе студента. Пиши только на русском языке. "
        "Покажи только итоговый отзыв, без черновика рассуждений, внутренних заметок и служебных меток. "
        "Используй только переданные требования задания, результаты автоматических GIS-проверок, извлечённый текст отчёта и приложенные изображения. "
        "Отчёт может состоять в основном из скриншотов и не обязан иметь строгую структуру. "
        "Не критикуй отсутствие заголовков вроде 'Методология', 'Результат' или 'Вывод', если они явно не требуются заданием или шаблоном отчёта. "
        "Сначала проверь, относится ли отчёт к текущему заданию: тема карты, ПО, названия слоёв, формулировка задания, скриншоты, проекция/СК, элементы оформления карты и файлы сдачи. "
        "Если текст или скриншоты похожи на другую лабораторную, другое задание или нерелевантный workflow, отметь это как серьёзное несоответствие. "
        "По изображениям опиши видимые доказательства: карта, легенда, слои, таблицы атрибутов, инструменты, условные обозначения, масштаб, проекция, компоновка. "
        "Отличай скриншоты в отчёте от файлов сдачи: не пиши, что студент сдал PNG вместо архива, если это явно не подтверждено формальными проверками или метаданными файла. "
        "Если обязательный файл нельзя подтвердить по доступным проверкам, пиши 'не удалось автоматически подтвердить', а не 'файл отсутствует'. "
        "Строго различай формальную автоматическую проверку и визуальные признаки из отчёта. "
        "В разделе 'Что проверено автоматически' называй подтверждёнными только те факты, которые есть в formal checks, requirements_result или technical checks. "
        "В этом разделе опирайся только на поле formal_verification_context.verified_facts из JSON. "
        "Если в verified_facts нет масштаба, PNG, легенды, порядка слоёв или проекции, нельзя писать, что это автоматически подтверждено. "
        "Если масштаб, PNG-экспорт, проекция, легенда или слои видны только на скриншоте, пиши 'на изображении видно' или 'по отчёту указано', но не 'автоматически подтверждено'. "
        "Не относись к слою как к линии, точке или полигону, если тип геометрии не подтверждён данными; если тип виден только по условному обозначению, формулируй это как визуальное предположение. "
        "Не выдумывай факты, оценки, баллы, масштабы, поля и названия слоёв, которых нет в данных. "
        "Ответ должен содержать 5 разделов, по 2-4 предложения в каждом. "
        "Разделы: "
        "1. Вердикт по соответствию заданию; "
        "2. Что проверено автоматически; "
        "3. Доказательства из текста и изображений; "
        "4. Замечания и риски; "
        "5. Что преподавателю проверить вручную."
    )


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

    system_prompt = _build_detailed_report_review_system_prompt()

    user_payload = {
        "assignment_title": assignment_title,
        "requirements": requirements_dict,
        "report_context": _compact_report_context(report_context),
        "gis_technical_result": _compact_gis_technical_result(gis_technical_result),
        "requirements_result": _compact_requirements_result(requirements_result),
        "formal_verification_context": _formal_verification_context(
            report_context=report_context,
            gis_technical_result=gis_technical_result,
            requirements_result=requirements_result,
        ),
    }

    user_prompt = (
        "Ниже данные по работе студента. "
        "Подготовь строго фактологичное и полезное заключение.\n\n"
        f"{json.dumps(user_payload, ensure_ascii=False)}"
    )

    user_prompt = (
        "Ниже данные по работе студента. "
        "Подготовь итоговый преподавательский анализ строго на русском языке. "
        "Не оценивай структуру отчёта, если она явно не требуется заданием. "
        "Не путай скриншоты в отчёте с файлами сдачи.\n\n"
        f"{json.dumps(user_payload, ensure_ascii=False)}"
    )

    return system_prompt, user_prompt


def build_fallback_ai_review(
    assignment_title: str,
    report_context: dict | None,
    requirements_result: dict | None,
    llm_error_message: str,
    requirements_dict: dict | None = None,
    gis_technical_result: dict | None = None,
) -> dict:
    return _build_rule_based_review(
        assignment_title=assignment_title,
        requirements_dict=requirements_dict,
        report_context=report_context,
        gis_technical_result=gis_technical_result,
        requirements_result=requirements_result,
        llm_error_message=llm_error_message,
    )

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


def _build_report_mismatch_review(
    assignment_title: str,
    report_context: dict | None,
    gis_technical_result: dict | None,
    requirements_result: dict | None,
) -> dict:
    report_document = (report_context or {}).get("document") or {}
    assignment_match = (report_context or {}).get("assignment_match") or {}
    problems = assignment_match.get("problems") or []
    warnings = assignment_match.get("warnings") or []
    evidence = assignment_match.get("evidence") or []
    report_name = (report_context or {}).get("asset_name") or "report asset"
    checks = (gis_technical_result or {}).get("checks") or []

    technical_items = []
    for check in checks[:6]:
        if not isinstance(check, dict):
            continue
        details = check.get("details") or {}
        if details.get("asset_type") and details.get("asset_type") != "layer":
            continue
        technical_items.append(
            details.get("asset_name")
            or check.get("message")
            or check.get("detected_format")
            or check.get("status")
        )

    review_text = (
        "1. Вердикт по соответствию заданию\n"
        f"Отчёт «{report_name}» нельзя считать соответствующим заданию «{assignment_title}»: "
        f"{assignment_match.get('message') or 'найдены признаки отчёта от другой работы'} "
        "GIS-архив можно проверять технически отдельно, но положительный вывод по отчёту в этой ситуации делать нельзя.\n\n"
        "2. Что проверено автоматически\n"
        f"Отчёт прочитан как {report_document.get('format') or 'document'}; "
        f"извлечено изображений: {report_document.get('image_count') or 0}. "
        f"Также выполнены технические проверки GIS-assets: {', '.join(str(item) for item in technical_items if item) or 'нет данных'}.\n\n"
        "3. Доказательства из текста отчёта\n"
        f"{' '.join(str(item) for item in evidence[:6]) or 'Сработала проверка несоответствия отчёта заданию.'}\n\n"
        "4. Замечания и риски\n"
        f"{' '.join(str(item) for item in problems + warnings) or 'Отчёт требует ручной перепроверки преподавателем.'}\n\n"
        "5. Что преподавателю проверить вручную\n"
        "Проверить, был ли приложен правильный DOCX-отчёт именно к этой лабораторной работе. "
        "Если GIS-архив корректный, его можно оценивать отдельно, но отчёт нужно заменить или пересдать."
    )

    return {
        "status": "failed",
        "message": "Отчёт не совпадает с текущим заданием; LLM-review не запускался.",
        "review_text": review_text,
        "meta": {
            "report_assignment_match": assignment_match,
            "llm_skipped": True,
            "reason": "report_assignment_mismatch",
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
    assignment_match = (report_context or {}).get("assignment_match") or {}

    if assignment_match.get("status") == "failed":
        return _build_report_mismatch_review(
            assignment_title=assignment_title,
            report_context=report_context,
            gis_technical_result=gis_technical_result,
            requirements_result=requirements_result,
        )

    if not requirements_summary and not gis_technical_result and not report_context:
        return _build_rule_based_review(
            assignment_title=assignment_title,
            requirements_dict=requirements_dict,
            report_context=report_context,
            gis_technical_result=gis_technical_result,
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
        images=_report_images_for_llm(report_context),
    )

    if llm_result["status"] != "passed" or not llm_result.get("text"):
        return _build_rule_based_review(
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
