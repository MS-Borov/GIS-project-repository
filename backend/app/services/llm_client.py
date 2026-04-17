import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.core.config import settings


def generate_text_with_llm(system_prompt: str, user_prompt: str) -> dict:
    """
    Унифицированный вызов локальной LLM через Ollama.

    Почему так:
    - не нужна платная OpenAI API-квота;
    - не нужен openai SDK;
    - код прозрачен и легко объясняется на защите.

    Возвращает:
    {
        "status": "passed" | "failed",
        "text": str | None,
        "message": str,
        "meta": {...}
    }
    """
    if settings.llm_backend != "ollama":
        return {
            "status": "failed",
            "text": None,
            "message": f"LLM backend '{settings.llm_backend}' сейчас не реализован в локальном клиенте.",
            "meta": {
                "backend": settings.llm_backend,
            },
        }

    payload = {
        "model": settings.llm_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        # Нам нужен единый готовый ответ, без потоковой выдачи.
        "stream": False,
    }

    body = json.dumps(payload).encode("utf-8")

    request = Request(
        url=f"{settings.llm_base_url.rstrip('/')}/api/chat",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urlopen(request, timeout=120) as response:
            response_bytes = response.read()

        response_json = json.loads(response_bytes.decode("utf-8"))

        # Ollama обычно возвращает message.content
        text = (
            response_json.get("message", {}).get("content")
            if isinstance(response_json, dict)
            else None
        )

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
        try:
            error_body = e.read().decode("utf-8")
        except Exception:
            error_body = ""

        return {
            "status": "failed",
            "text": None,
            "message": f"Ollama HTTPError: status={e.code}",
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