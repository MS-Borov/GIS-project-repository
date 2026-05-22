import json
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.core.config import settings


MAX_ERROR_BODY_IN_MESSAGE = 600
OPENROUTER_MAX_OUTPUT_TOKENS = 4096
OPENROUTER_MIN_RESPONSE_CHARS = 40
OPENROUTER_MIN_RESPONSE_WORDS = 8
BAD_RESPONSE_MARKERS = (
    "<think>",
    "</think>",
    "OTHER:",
    "MISC:",
    "REPORT:",
    "REVIEW:",
    "CONCLUSION:",
    "FEEDBACK:",
    "NEXT STEPS:",
    "FINAL:",
    "END:",
    "DONE:",
    "COMPLETE:",
    "THANKS:",
)
REQUIRED_REVIEW_PHRASES = (
    "Вердикт",
    "проверено",
    "Доказательства",
)


def _decode_http_error_body(error: HTTPError) -> str:
    try:
        return error.read().decode("utf-8", errors="replace")
    except Exception:
        return ""


def _extract_error_detail(error_body: str) -> str | None:
    if not error_body:
        return None

    try:
        parsed = json.loads(error_body)
    except json.JSONDecodeError:
        return error_body[:MAX_ERROR_BODY_IN_MESSAGE]

    detail = parsed.get("detail") if isinstance(parsed, dict) else parsed

    if isinstance(detail, dict):
        nested_body = detail.get("error_body")
        if nested_body:
            nested_detail = _extract_error_detail(str(nested_body))
            if nested_detail:
                return nested_detail
        message = detail.get("message")
        if message:
            return str(message)

    if isinstance(detail, str):
        return detail[:MAX_ERROR_BODY_IN_MESSAGE]

    return json.dumps(parsed, ensure_ascii=False)[:MAX_ERROR_BODY_IN_MESSAGE]


def _build_http_error_message(prefix: str, status_code: int, error_body: str) -> str:
    detail = _extract_error_detail(error_body)
    if detail:
        return f"{prefix} HTTPError: status={status_code}; detail={detail}"
    return f"{prefix} HTTPError: status={status_code}"


def generate_text_with_llm(
    system_prompt: str,
    user_prompt: str,
    images: list[dict] | None = None,
) -> dict:
    backend = (settings.llm_backend or "").lower().strip()

    if backend == "cerebras_relay":
        return _generate_text_with_cerebras_relay(system_prompt, user_prompt)

    if backend == "openrouter":
        return _generate_text_with_openrouter(system_prompt, user_prompt, images or [])

    if backend == "ollama":
        return _generate_text_with_ollama(system_prompt, user_prompt)

    return {
        "status": "failed",
        "text": None,
        "message": f"LLM backend '{settings.llm_backend}' не поддерживается.",
        "meta": {"backend": settings.llm_backend},
    }


def _image_content_blocks(images: list[dict]) -> list[dict]:
    blocks = []
    for image in images:
        data_base64 = image.get("data_base64")
        mime_type = image.get("mime_type")
        if not data_base64 or not mime_type:
            continue
        blocks.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:{mime_type};base64,{data_base64}",
            },
        })
    return blocks


def _normalize_chat_content(content) -> str | None:
    if isinstance(content, str):
        return content.strip() or None

    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text") or item.get("content")
                if text:
                    parts.append(str(text))
            elif isinstance(item, str):
                parts.append(item)
        text = "\n".join(part for part in parts if part.strip()).strip()
        return text or None

    if isinstance(content, dict):
        text = content.get("text") or content.get("content")
        return str(text).strip() if text else None

    return None


def _extract_openrouter_text(response_json: dict) -> tuple[str | None, dict]:
    choices = response_json.get("choices") if isinstance(response_json, dict) else None
    choice = choices[0] if choices else {}
    message = choice.get("message") or {}

    text = _normalize_chat_content(message.get("content"))
    source = "message.content"

    if not text:
        text = _normalize_chat_content(choice.get("text"))
        source = "choice.text"

    return text, {
        "content_source": source if text else None,
        "finish_reason": choice.get("finish_reason"),
        "native_finish_reason": choice.get("native_finish_reason"),
        "message_keys": sorted(message.keys()) if isinstance(message, dict) else [],
    }


def _clean_openrouter_text(text: str) -> str:
    normalized = text.strip()
    try:
        parsed = json.loads(normalized)
        if isinstance(parsed, list):
            parts = []
            for item in parsed:
                if isinstance(item, dict) and item.get("type") == "text" and item.get("text"):
                    parts.append(str(item.get("text")))
            if parts:
                normalized = "\n".join(parts).strip()
        elif isinstance(parsed, dict) and parsed.get("text"):
            normalized = str(parsed.get("text")).strip()
    except Exception:
        pass

    lower = normalized.lower()

    while "<think>" in lower:
        start = lower.find("<think>")
        end = lower.find("</think>", start)
        if end == -1:
            normalized = normalized[:start] + normalized[start + len("<think>"):]
        else:
            normalized = normalized[:start] + normalized[end + len("</think>"):]
        normalized = normalized.strip()
        lower = normalized.lower()

    return normalized.replace("<think>", "").replace("</think>", "").strip()


def _cyrillic_ratio(text: str) -> float:
    letters = re.findall(r"[^\W\d_]", text, flags=re.UNICODE)
    if not letters:
        return 0.0
    cyrillic = [char for char in letters if 0x0400 <= ord(char) <= 0x04FF]
    return len(cyrillic) / len(letters)


def _looks_like_broken_response(text: str) -> bool:
    normalized = _clean_openrouter_text(text)
    words = normalized.split()

    if len(normalized) < OPENROUTER_MIN_RESPONSE_CHARS:
        return True

    if len(words) < OPENROUTER_MIN_RESPONSE_WORDS:
        return True

    marker_count = sum(1 for marker in BAD_RESPONSE_MARKERS if marker in normalized)
    if marker_count >= 8:
        return True

    if normalized.count("ERROR:") >= 3:
        return True

    if _cyrillic_ratio(normalized) < 0.35:
        return True

    numbered_noise = sum(1 for token in (": 10", ": 11", ": 12", ": 13", ": 14", ": 15", ": 16", ": 17", ": 18", ": 19", ": 20") if token in normalized)
    return numbered_noise >= 5

    has_cyrillic = any("а" <= char.lower() <= "я" or char.lower() == "ё" for char in normalized)
    if not has_cyrillic:
        return True

    numbered_noise = sum(1 for token in (": 10", ": 11", ": 12", ": 13", ": 14", ": 15", ": 16", ": 17", ": 18", ": 19", ": 20") if token in normalized)
    return numbered_noise >= 5


def _generate_text_with_openrouter(system_prompt: str, user_prompt: str, images: list[dict]) -> dict:
    if not settings.openrouter_api_key:
        return {
            "status": "failed",
            "text": None,
            "message": "OPENROUTER_API_KEY is not configured.",
            "meta": {
                "backend": "openrouter",
                "model": settings.openrouter_model,
            },
        }

    image_blocks = _image_content_blocks(images)
    user_content = [{"type": "text", "text": user_prompt}, *image_blocks]
    payload = {
        "model": settings.openrouter_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.15,
        "max_tokens": OPENROUTER_MAX_OUTPUT_TOKENS,
    }

    try:
        response_json = _post_openrouter_payload(payload)
    except HTTPError as e:
        error_body = _decode_http_error_body(e)
        return {
            "status": "failed",
            "text": None,
            "message": _build_http_error_message("OpenRouter", e.code, error_body),
            "meta": {
                "backend": "openrouter",
                "model": settings.openrouter_model,
                "image_count": len(image_blocks),
                "error_body": error_body,
            },
        }
    except URLError as e:
        return {
            "status": "failed",
            "text": None,
            "message": f"Could not connect to OpenRouter: {str(e)}",
            "meta": {
                "backend": "openrouter",
                "model": settings.openrouter_model,
                "base_url": settings.openrouter_base_url,
                "image_count": len(image_blocks),
            },
        }
    except Exception as e:
        return {
            "status": "failed",
            "text": None,
            "message": f"OpenRouter request failed: {str(e)}",
            "meta": {
                "backend": "openrouter",
                "model": settings.openrouter_model,
                "image_count": len(image_blocks),
            },
        }

    text, response_meta = _extract_openrouter_text(response_json)

    if not text:
        retry_payload = {
            "model": settings.openrouter_model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                f"{system_prompt}\n\n{user_prompt}\n\n"
                                "Верни только итоговый русский отзыв обычным текстом."
                            ),
                        },
                        *image_blocks,
                    ],
                }
            ],
            "temperature": 0.1,
            "max_tokens": OPENROUTER_MAX_OUTPUT_TOKENS,
        }
        try:
            response_json = _post_openrouter_payload(retry_payload)
            text, response_meta = _extract_openrouter_text(response_json)
            response_meta["retry_used"] = True
        except Exception as e:
            response_meta["retry_used"] = True
            response_meta["retry_error"] = str(e)

    if not text:
        return {
            "status": "failed",
            "text": None,
            "message": "OpenRouter did not return text content.",
            "meta": {
                "backend": "openrouter",
                "model": settings.openrouter_model,
                "image_count": len(image_blocks),
                **response_meta,
                "raw_response": response_json,
            },
        }

    if _looks_like_broken_response(text):
        repaired_text, repair_meta = _repair_openrouter_text(text)
        if repaired_text and not _looks_like_broken_response(repaired_text):
            response_meta.update(repair_meta)
            text = repaired_text
        else:
            return {
                "status": "failed",
                "text": None,
                "message": "OpenRouter returned a broken or incomplete text response.",
                "meta": {
                    "backend": "openrouter",
                    "model": settings.openrouter_model,
                    "image_count": len(image_blocks),
                    "text_preview": _clean_openrouter_text(text)[:1200],
                    **response_meta,
                    **repair_meta,
                    "raw_response": response_json,
                },
            }

    return {
        "status": "passed",
        "text": _clean_openrouter_text(text),
        "message": "Response received from OpenRouter.",
        "meta": {
            "backend": "openrouter",
            "model": settings.openrouter_model,
            "image_count": len(image_blocks),
            **response_meta,
        },
    }


def _post_openrouter_payload(payload: dict) -> dict:
    request = Request(
        url=f"{settings.openrouter_base_url.rstrip('/')}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.openrouter_api_key}",
            "HTTP-Referer": "http://localhost",
            "X-Title": "GIS Edu Platform",
        },
        method="POST",
    )

    with urlopen(request, timeout=180) as response:
        return json.loads(response.read().decode("utf-8"))


def _repair_openrouter_text(text: str) -> tuple[str | None, dict]:
    cleaned = _clean_openrouter_text(text)
    payload = {
        "model": settings.openrouter_model,
        "messages": [
            {
                "role": "user",
                "content": (
                    "Перепиши следующий ответ как нормальный преподавательский AI-review на русском языке. "
                    "Сохрани только проверяемые факты, убери JSON, китайский/английский текст, <think> и служебные метки. "
                    "Сделай 5 разделов: 1. Вердикт по соответствию заданию; 2. Что проверено автоматически; "
                    "3. Доказательства из текста и изображений; 4. Замечания и риски; 5. Что преподавателю проверить вручную.\n\n"
                    f"{cleaned[:6000]}"
                ),
            }
        ],
        "temperature": 0.05,
        "max_tokens": OPENROUTER_MAX_OUTPUT_TOKENS,
    }

    try:
        response_json = _post_openrouter_payload(payload)
        repaired_text, repair_meta = _extract_openrouter_text(response_json)
        repair_meta["repair_used"] = True
        return repaired_text, repair_meta
    except Exception as e:
        return None, {
            "repair_used": True,
            "repair_error": str(e),
        }


def _generate_text_with_cerebras_relay(system_prompt: str, user_prompt: str) -> dict:
    payload = {
        "model": settings.cerebras_model,
        "system_prompt": system_prompt,
        "user_prompt": user_prompt,
        "temperature": 0.2,
    }

    req = Request(
        url=settings.cerebras_relay_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urlopen(req, timeout=180) as response:
            response_json = json.loads(response.read().decode("utf-8"))
    except HTTPError as e:
        error_body = _decode_http_error_body(e)
        return {
            "status": "failed",
            "text": None,
            "message": _build_http_error_message("Cerebras relay", e.code, error_body),
            "meta": {
                "backend": "cerebras_relay",
                "model": settings.cerebras_model,
                "error_body": error_body,
            },
        }
    except URLError as e:
        return {
            "status": "failed",
            "text": None,
            "message": f"Не удалось подключиться к Cerebras relay: {str(e)}",
            "meta": {
                "backend": "cerebras_relay",
                "model": settings.cerebras_model,
                "relay_url": settings.cerebras_relay_url,
            },
        }
    except Exception as e:
        return {
            "status": "failed",
            "text": None,
            "message": f"Ошибка вызова Cerebras relay: {str(e)}",
            "meta": {
                "backend": "cerebras_relay",
                "model": settings.cerebras_model,
            },
        }

    text = response_json.get("text")
    if not text:
        return {
            "status": "failed",
            "text": None,
            "message": "Cerebras relay не вернул текст ответа.",
            "meta": {
                "backend": "cerebras_relay",
                "model": settings.cerebras_model,
                "raw_response": response_json,
            },
        }

    return {
        "status": "passed",
        "text": text,
        "message": "Ответ получен от Cerebras relay.",
        "meta": {
            "backend": "cerebras_relay",
            "model": settings.cerebras_model,
        },
    }


def _generate_text_with_ollama(system_prompt: str, user_prompt: str) -> dict:
    payload = {
        "model": settings.llm_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "stream": False,
    }

    request = Request(
        url=f"{settings.llm_base_url.rstrip('/')}/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urlopen(request, timeout=120) as response:
            response_json = json.loads(response.read().decode("utf-8"))

        text = response_json.get("message", {}).get("content") if isinstance(response_json, dict) else None

        if not text:
            return {
                "status": "failed",
                "text": None,
                "message": "Локальная модель не вернула текст ответа.",
                "meta": {
                    "backend": "ollama",
                    "model": settings.llm_model,
                    "raw_response": response_json,
                },
            }

        return {
            "status": "passed",
            "text": text,
            "message": "Ответ получен от локальной модели через Ollama.",
            "meta": {
                "backend": "ollama",
                "model": settings.llm_model,
            },
        }

    except HTTPError as e:
        error_body = _decode_http_error_body(e)

        return {
            "status": "failed",
            "text": None,
            "message": _build_http_error_message("Ollama", e.code, error_body),
            "meta": {
                "backend": "ollama",
                "model": settings.llm_model,
                "error_body": error_body,
            },
        }

    except URLError as e:
        return {
            "status": "failed",
            "text": None,
            "message": f"Не удалось подключиться к Ollama: {str(e)}",
            "meta": {
                "backend": "ollama",
                "model": settings.llm_model,
                "base_url": settings.llm_base_url,
            },
        }

    except Exception as e:
        return {
            "status": "failed",
            "text": None,
            "message": f"Ошибка локального LLM-вызова: {str(e)}",
            "meta": {
                "backend": "ollama",
                "model": settings.llm_model,
            },
        }
