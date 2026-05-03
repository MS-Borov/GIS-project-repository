import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.core.config import settings


MAX_ERROR_BODY_IN_MESSAGE = 600


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


def generate_text_with_llm(system_prompt: str, user_prompt: str) -> dict:
    backend = (settings.llm_backend or "").lower().strip()

    if backend == "cerebras_relay":
        return _generate_text_with_cerebras_relay(system_prompt, user_prompt)

    if backend == "ollama":
        return _generate_text_with_ollama(system_prompt, user_prompt)

    return {
        "status": "failed",
        "text": None,
        "message": f"LLM backend '{settings.llm_backend}' не поддерживается.",
        "meta": {"backend": settings.llm_backend},
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
