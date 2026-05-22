import re
from pathlib import Path
from typing import Any


STOPWORDS = {
    "работа", "работы", "задание", "занятие", "практическое", "практический",
    "отчет", "отчёт", "номер", "основы", "геоинформатики", "qgis", "arcgis",
    "карта", "слой", "слои", "данные", "таблица", "атрибут", "атрибуты",
}

CLIMATE_MARKERS = {
    "климат", "климатическая", "climates", "countries", "coast", "rivers",
    "lakes", "seas", "cities", "робинсон", "гидросфер", "течени",
}


def _normalize(value: Any) -> str:
    text = str(value or "").lower().replace("ё", "е")
    text = re.sub(r"[_/\\.-]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _words(value: str) -> set[str]:
    return {
        word
        for word in re.findall(r"[a-zа-я0-9]{3,}", _normalize(value), flags=re.IGNORECASE)
        if word not in STOPWORDS and not word.isdigit()
    }


def _extract_contextual_numbers(value: str) -> set[int]:
    text = _normalize(value)
    patterns = [
        r"(?:номер\s+)?(?:задани[ея]|заняти[ея]|пз|лаб(?:ораторн\w*)?)\s*(?:№|#|n)?\s*0*(\d{1,2})\b",
        r"(?:практическ\w*)\s+(?:задани[ея]|заняти[ея])\s*(?:№|#|n)?\s*0*(\d{1,2})\b",
        r"\b(?:lab|лаба|лаб)\s*0*(\d{1,2})\b",
        r"\bпз[_\s-]*0*(\d{1,2})\b",
    ]
    numbers: set[int] = set()
    for pattern in patterns:
        for match in re.findall(pattern, text, flags=re.IGNORECASE):
            try:
                numbers.add(int(match))
            except ValueError:
                continue
    return numbers


def _collect_assignment_text(assignment_title: str, requirements_dict: dict | None) -> str:
    requirements = requirements_dict or {}
    parts = [
        assignment_title,
        requirements.get("source_doc_name"),
        requirements.get("source_text_preview"),
    ]
    expected_outputs = requirements.get("expected_outputs_json")
    if isinstance(expected_outputs, list):
        for item in expected_outputs:
            if isinstance(item, dict):
                parts.extend([
                    item.get("name"),
                    item.get("layer_name"),
                    item.get("asset_name"),
                    item.get("description"),
                ])
    return " ".join(str(part) for part in parts if part)


def _layer_tokens(layer_names: list[str]) -> set[str]:
    tokens: set[str] = set()
    for name in layer_names:
        stem = Path(str(name or "")).stem
        cleaned = re.sub(r"(_lines|_polygons|_points|_line|_polygon|_point)$", "", stem, flags=re.IGNORECASE)
        tokens.update(_words(cleaned))
    return {token for token in tokens if len(token) >= 3}


def evaluate_report_assignment_match(
    *,
    assignment_title: str,
    requirements_dict: dict | None,
    report_context: dict | None,
    layer_asset_names: list[str] | None = None,
) -> dict:
    document = report_context or {}
    report_text = document.get("text") or ""
    report_name = document.get("asset_name") or ""
    assignment_text = _collect_assignment_text(assignment_title, requirements_dict)
    layer_names = layer_asset_names or []

    problems: list[str] = []
    warnings: list[str] = []
    evidence: list[str] = []

    if not document.get("can_analyze"):
        return {
            "status": "warning",
            "message": "Отчёт найден, но его текст/изображения недостаточны для проверки соответствия заданию.",
            "problems": [],
            "warnings": ["Не удалось уверенно сравнить отчёт с текстом задания."],
            "evidence": [],
        }

    assignment_numbers = _extract_contextual_numbers(assignment_text)
    report_numbers = _extract_contextual_numbers(f"{report_name} {report_text[:3000]}")
    if assignment_numbers and report_numbers and assignment_numbers.isdisjoint(report_numbers):
        problems.append(
            f"В отчёте указан номер работы {sorted(report_numbers)}, а в задании ожидается {sorted(assignment_numbers)}."
        )
        evidence.append("Номер лабораторной/практической работы не совпадает.")

    assignment_words = _words(assignment_text)
    report_words = _words(report_text[:6000])
    overlap = sorted((assignment_words & report_words) - STOPWORDS)

    report_climate_hits = sorted(marker for marker in CLIMATE_MARKERS if marker in _normalize(report_text))
    assignment_climate_hits = sorted(marker for marker in CLIMATE_MARKERS if marker in _normalize(assignment_text))
    if len(report_climate_hits) >= 3 and len(assignment_climate_hits) < 2:
        problems.append(
            "Отчёт выглядит как работа по климатической карте, а текст текущего задания относится к другой теме."
        )
        evidence.append(f"Маркеры в отчёте: {', '.join(report_climate_hits[:8])}.")

    layer_words = _layer_tokens(layer_names)
    if layer_words:
        layer_overlap = sorted(layer_words & report_words)
        if not layer_overlap:
            warnings.append(
                "В тексте отчёта не найдены явные упоминания названий сданных GIS-слоёв."
            )
        else:
            evidence.append(f"Упоминания сданных слоёв в отчёте: {', '.join(layer_overlap[:8])}.")

    if not overlap and assignment_words and report_words:
        warnings.append("Текст отчёта почти не пересекается по ключевым словам с текстом задания.")
    elif overlap:
        evidence.append(f"Общие ключевые слова с заданием: {', '.join(overlap[:10])}.")

    if problems:
        return {
            "status": "failed",
            "message": "Отчёт, вероятно, относится к другой лабораторной работе.",
            "problems": problems,
            "warnings": warnings,
            "evidence": evidence,
        }

    if warnings:
        return {
            "status": "warning",
            "message": "Соответствие отчёта заданию требует ручной проверки.",
            "problems": [],
            "warnings": warnings,
            "evidence": evidence,
        }

    return {
        "status": "passed",
        "message": "Явных признаков, что отчёт относится к другой работе, не найдено.",
        "problems": [],
        "warnings": [],
        "evidence": evidence,
    }
