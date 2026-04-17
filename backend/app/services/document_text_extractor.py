import io
import re
import zipfile
from xml.etree import ElementTree as ET


def extract_document_text(filename: str, file_bytes: bytes) -> dict:
    """
    Универсальное извлечение текста из документа.

    Возвращает:
    {
        "status": "passed" | "warning" | "failed",
        "text": str | None,
        "message": str,
        "can_analyze": bool,
        "format": str,
    }

    Поддерживаем:
    - .txt
    - .docx
    - .doc -> пока только честное предупреждение
    """
    lowered = filename.lower()

    if lowered.endswith(".txt"):
        text = _extract_txt(file_bytes)
        return {
            "status": "passed" if text else "failed",
            "text": text,
            "message": "TXT-документ успешно прочитан." if text else "Не удалось извлечь текст из TXT-документа.",
            "can_analyze": bool(text),
            "format": "txt",
        }

    if lowered.endswith(".docx"):
        text = _extract_docx(file_bytes)
        ok = bool(text) and not text.startswith("ERROR:")
        return {
            "status": "passed" if ok else "warning",
            "text": text if ok else None,
            "message": "DOCX-документ успешно прочитан." if ok else text,
            "can_analyze": ok,
            "format": "docx",
        }

    if lowered.endswith(".doc"):
        return {
            "status": "warning",
            "text": None,
            "message": (
                "Файл имеет формат .doc. "
                "Автоматическое извлечение текста из бинарного DOC пока не реализовано. "
                "Для автоматического анализа лучше использовать .docx или .txt."
            ),
            "can_analyze": False,
            "format": "doc",
        }

    return {
        "status": "warning",
        "text": None,
        "message": "Неподдерживаемый формат документа для извлечения текста.",
        "can_analyze": False,
        "format": "unknown",
    }


def _extract_txt(file_bytes: bytes) -> str | None:
    for encoding in ("utf-8-sig", "utf-8", "cp1251"):
        try:
            text = file_bytes.decode(encoding).strip()
            return text or None
        except UnicodeDecodeError:
            continue
    return None


def _extract_docx(file_bytes: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
            xml_bytes = archive.read("word/document.xml")
    except Exception as e:
        return f"ERROR: Не удалось прочитать DOCX: {str(e)}"

    try:
        root = ET.fromstring(xml_bytes)
    except Exception as e:
        return f"ERROR: Не удалось распарсить XML внутри DOCX: {str(e)}"

    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    chunks = []

    for node in root.findall(".//w:t", ns):
        if node.text:
            chunks.append(node.text)

    text = " ".join(chunks)
    text = re.sub(r"\s+", " ", text).strip()

    if not text:
        return "ERROR: DOCX прочитан, но текст не извлечён."

    return text