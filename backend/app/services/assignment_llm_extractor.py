import json
import re

from app.services.llm_client import generate_text_with_llm
from app.services.assignment_requirement_extractor import extract_requirements_from_text


MAX_ASSIGNMENT_TEXT_FOR_LLM = 12000
MAX_NOTE_ITEMS = 10

RESULT_OUTPUT_KEYWORDS = (
    "сдать",
    "сдайте",
    "сдаваем",
    "предоставить",
    "предоставьте",
    "приложить",
    "приложите",
    "отправить",
    "отправьте",
    "загрузить",
    "загрузите",
    "экспортировать",
    "экспортируйте",
    "результат",
    "результир",
    "выходн",
    "итогов",
    "final",
    "output",
    "submit",
    "export",
    "deliverable",
)

SOURCE_DATA_KEYWORDS = (
    "исходные данные",
    "исходные файлы",
    "данные для работы",
    "добавьте файлы",
    "добавить файлы",
    "файлы из папки",
    "папка unit",
    "unit_",
    "source data",
    "source files",
)

NON_DELIVERABLE_CONTEXT_KEYWORDS = (
    "вопрос",
    "ответьте",
    "изучите",
    "просмотрите",
    "откройте",
    "перетащите",
    "скопируйте",
    "удалите",
    "информац",
    "метаданн",
    "сколько",
    "содержится",
    "содержимое",
    "свойства",
    "источник данных",
    "пространственная привязка",
    "определите",
)


def extract_requirements_from_assignment_document(
    text: str,
    source_doc_name: str | None = None,
) -> dict:
    """
    Извлекает требования из текста задания.

    Облегчённая версия для внешнего API:
    - режем слишком длинный текст;
    - просим компактный JSON;
    - если LLM не справляется, откатываемся на эвристику.
    """
    if not text or not text.strip():
        fallback = extract_requirements_from_text(text=text or "", source_doc_name=source_doc_name)
        fallback["submission_format"] = "archive"
        fallback["expected_outputs_json"] = None
        fallback["extraction_status"] = "failed"
        fallback["extraction_notes"] = "В тексте задания нет извлекаемого содержимого."
        return fallback

    safe_text = text[:MAX_ASSIGNMENT_TEXT_FOR_LLM]
    heuristic = extract_requirements_from_text(text=text, source_doc_name=source_doc_name)

    system_prompt = (
        "Ты анализируешь текст GIS-задания. "
        "Верни только JSON без пояснений. "
        "Не выдумывай. "
        "Очень важно: файлы из разделов 'Исходные данные', 'исходные файлы', 'данные для работы' "
        "НЕ являются expected_outputs. Это source_layers. "
        "В expected_outputs_json включай только итоговые сдаваемые файлы/слои, которые явно требуется сдать, "
        "загрузить, экспортировать или сохранить как результат выполнения работы. "
        "Не включай учебные промежуточные действия: открыть слой, изучить метаданные, ответить на вопрос, "
        "скопировать файл, удалить файл или создать тренировочный пустой shapefile без требования сдачи. "
        "Если в задании нет явного списка сдаваемых результирующих слоёв, верни expected_outputs_json=null. "
        "Нужны ключи: deliverable_format, expected_geometry_types, expected_crs, "
        "required_attributes, expected_outputs_json, report_required, extraction_notes."
    )

    user_prompt = (
        "Извлеки требования из текста задания и верни только JSON.\n\n"
        f"{safe_text}"
    )

    llm_result = generate_text_with_llm(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
    )

    if llm_result["status"] != "passed" or not llm_result.get("text"):
        fallback = dict(heuristic)
        fallback["expected_outputs_json"] = _heuristic_expected_outputs_from_text(text)
        if not fallback["expected_outputs_json"]:
            _clear_formal_layer_requirements(fallback)
        fallback["report_required"] = _looks_like_report_required(text, fallback.get("report_required", False))
        fallback["auto_checkable"] = True
        fallback["extraction_status"] = "fallback_heuristic"
        fallback["extraction_notes"] = (
            f"LLM extraction недоступен. Использован эвристический extractor. "
            f"Причина: {llm_result.get('message')}\n\n"
            f"{_build_extraction_notes(text, fallback.get('expected_outputs_json'))}"
        )
        return fallback

    parsed = _try_parse_json(llm_result["text"])
    if parsed is None:
        fallback = dict(heuristic)
        fallback["expected_outputs_json"] = _heuristic_expected_outputs_from_text(text)
        if not fallback["expected_outputs_json"]:
            _clear_formal_layer_requirements(fallback)
        fallback["report_required"] = _looks_like_report_required(text, fallback.get("report_required", False))
        fallback["auto_checkable"] = True
        fallback["extraction_status"] = "fallback_heuristic"
        fallback["extraction_notes"] = (
            "LLM ответил, но JSON не удалось разобрать. "
            "Использован эвристический extractor.\n\n"
            f"{_build_extraction_notes(text, fallback.get('expected_outputs_json'))}"
        )
        return fallback

    expected_outputs = _filter_source_data_outputs(
        _normalize_expected_outputs(parsed.get("expected_outputs_json")),
        text,
    )
    extraction_notes = "\n\n".join(
        part for part in [
            _to_optional_str(parsed.get("extraction_notes")),
            _build_extraction_notes(text, expected_outputs),
        ]
        if part
    )
    has_expected_outputs = bool(expected_outputs)

    result = {
        "source_doc_name": source_doc_name,
        "source_text": text,
        "submission_format": "archive",
        "deliverable_format": _to_optional_str(parsed.get("deliverable_format")) or (heuristic.get("deliverable_format") if has_expected_outputs else None),
        "expected_geometry_types": _to_optional_str_list(parsed.get("expected_geometry_types")) or (heuristic.get("expected_geometry_types") if has_expected_outputs else None),
        "expected_crs": _to_optional_str(parsed.get("expected_crs")) or (heuristic.get("expected_crs") if has_expected_outputs else None),
        "required_attributes": _to_optional_str_list(parsed.get("required_attributes")) or (heuristic.get("required_attributes") if has_expected_outputs else None),
        "topology_rules": heuristic.get("topology_rules") if has_expected_outputs else None,
        "needs_reference_layer": heuristic.get("needs_reference_layer", False) if has_expected_outputs else False,
        "report_required": _to_bool(parsed.get("report_required"), default=False)
        or _looks_like_report_required(text, heuristic.get("report_required", False)),
        "auto_checkable": True,
        "expected_outputs_json": expected_outputs,
        "extraction_status": "llm_draft",
        "extraction_notes": extraction_notes
        or "Требования извлечены через внешний LLM. Нужна проверка преподавателем.",
    }

    return result


def _try_parse_json(text: str) -> dict | None:
    cleaned = text.strip()
    cleaned = re.sub(r"^```json\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^```\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        data = json.loads(cleaned)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None


def _to_optional_str(value) -> str | None:
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def _to_optional_str_list(value) -> list[str] | None:
    if value is None:
        return None
    if isinstance(value, list):
        normalized = [str(v).strip() for v in value if str(v).strip()]
        return normalized or None
    return None


def _to_bool(value, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "да"}:
            return True
        if lowered in {"false", "0", "no", "нет"}:
            return False
    return default


def _clear_formal_layer_requirements(requirements: dict) -> None:
    requirements["deliverable_format"] = None
    requirements["expected_geometry_types"] = None
    requirements["expected_crs"] = None
    requirements["required_attributes"] = None
    requirements["topology_rules"] = None
    requirements["needs_reference_layer"] = False


def _looks_like_report_required(text: str, default: bool = False) -> bool:
    lowered = text.lower()
    if "отчет" in lowered or "отчёт" in lowered or "report" in lowered:
        return True
    if re.search(r"\bвопрос\s+\d+", lowered):
        return True
    return default


def _extract_numbered_questions(text: str) -> list[str]:
    questions = []
    pattern = re.compile(
        r"(Вопрос\s+\d+\s*:.*?)(?=\s+Вопрос\s+\d+\s*:|\s+\d+\.\s+[А-ЯA-ZЁ]|$)",
        flags=re.IGNORECASE | re.DOTALL,
    )
    for match in pattern.finditer(text):
        question = re.sub(r"\s+", " ", match.group(1)).strip()
        question = re.sub(r"[_]{3,}.*$", "", question).strip()
        question = question[:240].rstrip()
        if question:
            questions.append(question)
    return questions


def _extract_operation_topics(text: str) -> list[str]:
    lowered = text.lower()
    topics = []
    has_qgis_context = any(
        marker in lowered
        for marker in (
            "qgis",
            "qgis ",
            "qgis.",
            ".qlr",
            "road-l",
            "hydro-p",
            "srtm-dem",
            "одноканальное псевдоцветное",
            "управление стилями",
        )
    )

    topic_rules = [
        ("работа с ArcMap/ArcCatalog", ("arcmap", "arccatalog")),
        ("слои и таблица содержания", ("слои", "таблица содержания")),
        ("атрибутивные таблицы и запросы", ("атрибутив", "выбрать по атрибут")),
        ("символика и классификация объектов", ("символ", "классификац")),
        ("условные обозначения / легенды слоёв", ("условн", "легенд", "стиль")),
        ("подписи и аннотации", ("надпис", "аннотац")),
        ("макет карты и масштаб", ("макет", "масштаб")),
        ("shapefile и составные файлы формата", ("шейп", "shapefile", ".shp")),
        ("пространственная привязка / CRS", ("пространственная привязка", "система координат", "pulkovo", "epsg")),
        ("копирование и удаление GIS-данных в ArcCatalog", ("arccatalog", "arc catalog")),
        ("метаданные пространственных данных", ("метаданн",)),
        ("персональная база геоданных", ("база геоданных", "mygdb", "mdb")),
    ]

    for title, markers in topic_rules:
        if any(marker in lowered for marker in markers):
            topics.append(title)

    if has_qgis_context:
        qgis_topic_rules = [
            ("QGIS: стилизация векторных слоёв", ("простая символика", "уникальным значениям", "road-l", "hydro-p", "qlr")),
            ("QGIS: классификация по атрибутам", ("поле type", "уникальным значениям", "классифицировать")),
            ("QGIS: пользовательские символы и библиотеки стилей", ("управление стилями", "сохранить знак", "метки", "mine")),
            ("QGIS: стилизация растров", ("растров", "srtm-dem", "одноканальное псевдоцветное", "цветовой ряд")),
            ("QGIS: классификация растра", ("равные интервалы", "квантили", "классы")),
        ]
        for title, markers in qgis_topic_rules:
            if any(marker in lowered for marker in markers):
                topics.append(title)

    return topics


def _extract_mentioned_layers(text: str) -> list[str]:
    seen = set()
    layers = []

    for match in _iter_file_matches(text):
        layer_name = match.group(0)
        key = _normalize_file_key(layer_name)
        if not key or key in seen:
            continue
        seen.add(key)
        layers.append(layer_name)

    extra_file_pattern = re.compile(
        r"\b([a-zA-Zа-яА-Я0-9_\-]+)\.(qlr|tif|tiff|mxd)\b",
        re.IGNORECASE,
    )
    for match in extra_file_pattern.finditer(text):
        file_name = match.group(0)
        key = file_name.lower()
        if key in seen:
            continue
        seen.add(key)
        layers.append(file_name)

    for layer_name in re.findall(r"\b(?:hydro-p|road-l|srtm-dem)\b", text, flags=re.IGNORECASE):
        key = layer_name.lower()
        if key in seen:
            continue
        seen.add(key)
        layers.append(layer_name)

    return layers


def _build_extraction_notes(text: str, expected_outputs: list[dict] | None) -> str:
    questions = _extract_numbered_questions(text)
    topics = _extract_operation_topics(text)
    layers = _extract_mentioned_layers(text)

    lines = [
        "Автоизвлечение:",
    ]

    if expected_outputs:
        output_names = [
            str(output.get("name"))
            for output in expected_outputs
            if output.get("name")
        ]
        lines.append(
            "- Найдены явно сдаваемые outputs: "
            + (", ".join(output_names[:MAX_NOTE_ITEMS]) if output_names else f"{len(expected_outputs)} шт.")
        )
    else:
        lines.append(
            "- Явного списка сдаваемых GIS-outputs не найдено. Слои из учебных шагов не добавлены в expected_outputs_json."
        )

    lines.append("- Формат сдачи: архив с отчётом и рабочими GIS-файлами.")

    if questions:
        lines.append(f"- В задании обнаружены контрольные вопросы: {len(questions)}.")
        for question in questions[:5]:
            lines.append(f"  - {question}")

    if topics:
        lines.append("- Что стоит проверять в отчёте: " + "; ".join(topics[:MAX_NOTE_ITEMS]) + ".")

    if layers:
        lines.append(
            "- Упомянутые слои/файлы задания: "
            + ", ".join(layers[:MAX_NOTE_ITEMS])
            + (" ..." if len(layers) > MAX_NOTE_ITEMS else "")
        )

    lines.append("- Требуется проверка преподавателем перед использованием для formal-check.")

    return "\n".join(lines)


def _normalize_expected_outputs(value) -> list[dict] | None:
    if not isinstance(value, list):
        return None

    normalized = []
    for item in value:
        if not isinstance(item, dict):
            continue

        normalized.append({
            "name": _to_optional_str(item.get("name")),
            "deliverable_format": _to_optional_str(item.get("deliverable_format")),
            "expected_geometry_types": _to_optional_str_list(item.get("expected_geometry_types")),
            "expected_crs": _to_optional_str(item.get("expected_crs")),
            "required_attributes": _to_optional_str_list(item.get("required_attributes")),
        })

    return normalized or None


def _normalize_file_key(value: str | None) -> str | None:
    if not value:
        return None

    normalized = str(value).strip().lower()
    normalized = normalized.replace("\\", "/").rsplit("/", 1)[-1]

    for extension in (".shp", ".geojson", ".zip"):
        if normalized.endswith(extension):
            normalized = normalized[: -len(extension)]
            break

    return normalized or None


def _iter_file_matches(text: str):
    pattern = re.compile(r"\b([a-zA-Zа-яА-Я0-9_\-]+)\.(shp|geojson)\b", re.IGNORECASE)
    yield from pattern.finditer(text)


def _iter_name_matches(text: str, file_key: str):
    escaped = re.escape(file_key)
    pattern = re.compile(
        rf"(?<![a-zA-Zа-яА-Я0-9_\-]){escaped}(?:\.(?:shp|geojson|zip))?(?![a-zA-Zа-яА-Я0-9_\-])",
        re.IGNORECASE,
    )
    yield from pattern.finditer(text)


def _has_any_keyword(text: str, keywords: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(keyword in lowered for keyword in keywords)


def _line_context_for_match(text: str, start: int, end: int) -> str:
    current_line_start = text.rfind("\n", 0, start) + 1
    line_end = text.find("\n", end)
    if line_end == -1:
        line_end = len(text)
    return text[current_line_start:line_end]


def _has_result_delivery_context(context: str) -> bool:
    if not _has_any_keyword(context, RESULT_OUTPUT_KEYWORDS):
        return False

    if _has_any_keyword(context, NON_DELIVERABLE_CONTEXT_KEYWORDS):
        return False

    return True


def _file_has_result_context(text: str, file_key: str) -> bool:
    for match in _iter_name_matches(text, file_key):
        if _has_result_delivery_context(_line_context_for_match(text, match.start(), match.end())):
            return True

    return False


def _file_looks_like_source_data(text: str, file_key: str) -> bool:
    for match in _iter_name_matches(text, file_key):
        start = max(0, match.start() - 320)
        end = min(len(text), match.end() + 120)
        window = text[start:end]

        if _has_any_keyword(window, SOURCE_DATA_KEYWORDS) and not _has_result_delivery_context(window):
            return True

    return False


def _filter_source_data_outputs(expected_outputs: list[dict] | None, text: str) -> list[dict] | None:
    if not expected_outputs:
        return None

    filtered = []
    for output in expected_outputs:
        file_key = _normalize_file_key(output.get("name"))

        # LLM can copy source-layer filenames into expected outputs. Keep them
        # only when the assignment explicitly marks them as final deliverables.
        if file_key:
            has_result_context = _file_has_result_context(text, file_key)
            if not has_result_context:
                continue
            if _file_looks_like_source_data(text, file_key) and not has_result_context:
                continue

        filtered.append(output)

    return filtered or None


def _heuristic_expected_outputs_from_text(text: str) -> list[dict] | None:
    lowered = text.lower()
    outputs = []

    matches = re.findall(r"\b([a-zA-Zа-яА-Я0-9_\-]+)\.(shp|geojson)\b", lowered)

    seen = set()
    for match in _iter_file_matches(text):
        name = match.group(1).lower()
        ext = match.group(2).lower()
        key = f"{name}.{ext}"
        if key in seen:
            continue

        file_key = _normalize_file_key(key)
        if file_key and not _file_has_result_context(text, file_key):
            continue
        if file_key and _file_looks_like_source_data(text, file_key) and not _file_has_result_context(text, file_key):
            continue

        seen.add(key)

        outputs.append({
            "name": name,
            "deliverable_format": "shapefile_zip" if ext == "shp" else "geojson",
            "expected_geometry_types": None,
            "expected_crs": None,
            "required_attributes": None,
        })

    return outputs or None
