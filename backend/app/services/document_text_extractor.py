import base64
import io
import re
import zipfile
from xml.etree import ElementTree as ET

MAX_DOCX_IMAGES_FOR_LLM = 6
MAX_DOCX_IMAGE_BYTES = 900_000
MAX_DOCX_IMAGE_TOTAL_BYTES = 3_500_000


def extract_document_text(filename: str, file_bytes: bytes) -> dict:
    """
    Extract text and a limited set of embedded images from a submitted report.

    DOCX reports are allowed to be screenshot-heavy: if text extraction fails
    but images are available, the document can still be analyzed by a vision LLM.
    """
    lowered = filename.lower()

    if lowered.endswith(".txt"):
        text = _extract_txt(file_bytes)
        return {
            "status": "passed" if text else "failed",
            "text": text,
            "message": "TXT document was read." if text else "Could not extract text from TXT document.",
            "can_analyze": bool(text),
            "format": "txt",
            "images": [],
            "image_count": 0,
            "skipped_image_count": 0,
        }

    if lowered.endswith(".docx"):
        docx_result = _extract_docx_payload(file_bytes)
        text = docx_result.get("text")
        ok_text = bool(text) and not str(text).startswith("ERROR:")
        has_images = bool(docx_result.get("images"))
        can_analyze = ok_text or has_images

        if ok_text:
            message = "DOCX document was read."
        elif has_images:
            message = "DOCX has no extractable text, but report images were extracted for visual analysis."
        else:
            message = text or "Could not extract text or images from DOCX document."

        return {
            "status": "passed" if can_analyze else "warning",
            "text": text if ok_text else None,
            "message": message,
            "can_analyze": can_analyze,
            "format": "docx",
            "images": docx_result.get("images", []),
            "image_count": docx_result.get("image_count", 0),
            "skipped_image_count": docx_result.get("skipped_image_count", 0),
        }

    if lowered.endswith(".doc"):
        return {
            "status": "warning",
            "text": None,
            "message": (
                "The file is a legacy .doc document. Automatic text extraction "
                "from binary DOC is not implemented; save it as DOCX or TXT for analysis."
            ),
            "can_analyze": False,
            "format": "doc",
            "images": [],
            "image_count": 0,
            "skipped_image_count": 0,
        }

    return {
        "status": "warning",
        "text": None,
        "message": "Unsupported document format for text extraction.",
        "can_analyze": False,
        "format": "unknown",
        "images": [],
        "image_count": 0,
        "skipped_image_count": 0,
    }


def _extract_txt(file_bytes: bytes) -> str | None:
    for encoding in ("utf-8-sig", "utf-8", "cp1251"):
        try:
            text = file_bytes.decode(encoding).strip()
            return text or None
        except UnicodeDecodeError:
            continue
    return None


def _extract_docx_payload(file_bytes: bytes) -> dict:
    text = _extract_docx_text(file_bytes)

    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
            image_names = [
                name
                for name in archive.namelist()
                if name.startswith("word/media/") and not name.endswith("/")
            ]
            images = _extract_docx_images(archive, image_names)
    except Exception:
        image_names = []
        images = []

    return {
        "text": text,
        "images": images,
        "image_count": len(image_names),
        "skipped_image_count": max(0, len(image_names) - len(images)),
    }


def _extract_docx_text(file_bytes: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
            xml_name = _find_docx_document_xml_name(archive)
            if not xml_name:
                sample_names = ", ".join(archive.namelist()[:8])
                return (
                    "ERROR: Could not read DOCX: word/document.xml was not found. "
                    f"First files inside archive: {sample_names}"
                )
            xml_bytes = archive.read(xml_name)
    except zipfile.BadZipFile:
        return "ERROR: Could not read DOCX: file is not an Office Open XML ZIP package."
    except Exception as e:
        return f"ERROR: Could not read DOCX: {str(e)}"

    try:
        root = ET.fromstring(xml_bytes)
    except Exception as e:
        return f"ERROR: Could not parse DOCX XML: {str(e)}"

    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    chunks = []

    for node in root.findall(".//w:t", ns):
        if node.text:
            chunks.append(node.text)

    text = " ".join(chunks)
    text = re.sub(r"\s+", " ", text).strip()

    if not text:
        return "ERROR: DOCX was read, but no text was extracted."

    return text


def _extract_docx_images(archive: zipfile.ZipFile, image_names: list[str]) -> list[dict]:
    content_types = _docx_content_types(archive)
    images = []
    total_bytes = 0

    for name in image_names:
        if len(images) >= MAX_DOCX_IMAGES_FOR_LLM:
            break

        try:
            image_bytes = archive.read(name)
        except Exception:
            continue

        if len(image_bytes) > MAX_DOCX_IMAGE_BYTES:
            continue

        if total_bytes + len(image_bytes) > MAX_DOCX_IMAGE_TOTAL_BYTES:
            continue

        mime_type = content_types.get(name) or _guess_image_mime(name)
        if not mime_type:
            continue

        images.append({
            "filename": name.rsplit("/", 1)[-1],
            "mime_type": mime_type,
            "size_bytes": len(image_bytes),
            "data_base64": base64.b64encode(image_bytes).decode("ascii"),
        })
        total_bytes += len(image_bytes)

    return images


def _docx_content_types(archive: zipfile.ZipFile) -> dict[str, str]:
    try:
        root = ET.fromstring(archive.read("[Content_Types].xml"))
    except Exception:
        return {}

    defaults = {}
    overrides = {}
    for node in root:
        tag = node.tag.rsplit("}", 1)[-1]
        if tag == "Default":
            extension = (node.attrib.get("Extension") or "").lower()
            content_type = node.attrib.get("ContentType")
            if extension and content_type:
                defaults[extension] = content_type
        elif tag == "Override":
            part_name = (node.attrib.get("PartName") or "").lstrip("/")
            content_type = node.attrib.get("ContentType")
            if part_name and content_type:
                overrides[part_name] = content_type

    result = {}
    for name in archive.namelist():
        if name in overrides:
            result[name] = overrides[name]
            continue
        extension = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if extension in defaults:
            result[name] = defaults[extension]
    return result


def _guess_image_mime(filename: str) -> str | None:
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
        "gif": "image/gif",
        "bmp": "image/bmp",
    }.get(extension)


def _find_docx_document_xml_name(archive: zipfile.ZipFile) -> str | None:
    names = set(archive.namelist())
    if "word/document.xml" in names:
        return "word/document.xml"

    try:
        content_types = ET.fromstring(archive.read("[Content_Types].xml"))
        for node in content_types:
            part_name = node.attrib.get("PartName", "").lstrip("/")
            content_type = node.attrib.get("ContentType", "")
            if (
                content_type
                == "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
                and part_name in names
            ):
                return part_name
    except Exception:
        pass

    for name in sorted(names):
        if not name.startswith("word/") or not name.endswith(".xml"):
            continue
        try:
            xml_head = archive.read(name)[:4096].decode("utf-8", errors="ignore")
        except Exception:
            continue
        if "wordprocessingml" in xml_head and "<w:document" in xml_head:
            return name

    return None
