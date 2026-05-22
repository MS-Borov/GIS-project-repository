import re


def analyze_report_text(report_context: dict | None) -> dict:
    """
    Lightweight rule-based report analysis.

    The result gives the LLM signals, not a final grade. In screenshot-heavy
    reports, missing headings are treated as notes instead of hard warnings.
    """
    if not report_context:
        return {
            "status": "warning",
            "message": "Report asset is missing.",
            "details": {},
        }

    image_count = report_context.get("image_count") or len(report_context.get("images") or [])

    if not report_context.get("can_analyze"):
        return {
            "status": "warning",
            "message": report_context.get("message", "Report was found, but text could not be extracted."),
            "details": {
                "format": report_context.get("format"),
                "can_analyze": False,
                "image_count": image_count,
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
    notes = []

    if word_count < 40:
        if image_count:
            notes.append(
                "Report text is short, but the document contains screenshots; visual evidence should be checked."
            )
        else:
            warnings.append("Report text is too short for confident analysis.")

    return {
        "status": "warning" if warnings else "passed",
        "message": "Report was analyzed." if not warnings else "Report was analyzed with warnings.",
        "details": {
            "format": report_context.get("format"),
            "can_analyze": True,
            "word_count": word_count,
            "image_count": image_count,
            "sections_found": sections_found,
            "mentions": mentions,
            "warnings": warnings,
            "notes": notes,
            "text_preview": text[:4000],
        },
    }
