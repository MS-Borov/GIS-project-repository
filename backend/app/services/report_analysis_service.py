import re


def analyze_report_text(report_context: dict | None) -> dict:
    """
    Простая rule-based оценка отчёта.

    Это не заменяет LLM, а даёт:
    - полезные признаки,
    - базовые предупреждения,
    - понятную структуру для prompt-а.
    """
    if not report_context:
        return {
            "status": "warning",
            "message": "Отчёт отсутствует.",
            "details": {},
        }

    if not report_context.get("can_analyze"):
        return {
            "status": "warning",
            "message": report_context.get("message", "Отчёт найден, но текст не извлечён."),
            "details": {
                "format": report_context.get("format"),
                "can_analyze": False,
            },
        }

    text = report_context.get("text") or ""
    lowered = text.lower()

    word_count = len(re.findall(r"\S+", text))

    section_keywords = {
        "goal": ["цель", "цель работы"],
        "source_data": ["исходные данные", "входные данные"],
        "methodology": ["методика", "ход работы", "порядок выполнения"],
        "result": ["результат", "получено", "итог"],
        "conclusion": ["вывод", "заключение"],
    }

    sections_found = {
        key: any(keyword in lowered for keyword in keywords)
        for key, keywords in section_keywords.items()
    }

    mentions = {
        "crs": any(x in lowered for x in ["epsg", "crs", "система координат"]),
        "geojson": "geojson" in lowered,
        "shapefile": "shapefile" in lowered or "шейп" in lowered,
        "topology": "тополог" in lowered,
        "attributes": "атрибут" in lowered or "поле" in lowered,
    }

    warnings = []
    if word_count < 40:
        warnings.append("Текст отчёта слишком короткий для уверенного анализа.")
    if not sections_found["conclusion"]:
        warnings.append("В отчёте не обнаружен явный раздел с выводами.")
    if not sections_found["methodology"]:
        warnings.append(
            "В отчёте не найден явный структурный раздел с ходом работы; отдельные действия могут быть описаны в тексте."
        )

    return {
        "status": "warning" if warnings else "passed",
        "message": "Отчёт проанализирован." if not warnings else "Отчёт проанализирован с предупреждениями.",
        "details": {
            "format": report_context.get("format"),
            "can_analyze": True,
            "word_count": word_count,
            "sections_found": sections_found,
            "mentions": mentions,
            "warnings": warnings,
            # Для LLM не надо отправлять бесконечный текст.
            "text_preview": text[:4000],
        },
    }
