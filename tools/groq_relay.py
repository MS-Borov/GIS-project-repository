import json
import os
import urllib.error
import urllib.request

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


app = FastAPI(title="Groq Relay")


class ChatRequest(BaseModel):
    model: str
    system_prompt: str
    user_prompt: str
    temperature: float = 0.2


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/chat")
def chat(payload: ChatRequest):
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY is not set")

    groq_payload = {
        "model": payload.model,
        "messages": [
            {"role": "system", "content": payload.system_prompt},
            {"role": "user", "content": payload.user_prompt},
        ],
        "temperature": payload.temperature,
    }

    req = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=json.dumps(groq_payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            response_json = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            error_body = e.read().decode("utf-8")
        except Exception:
            error_body = ""

        raise HTTPException(
            status_code=e.code,
            detail={
                "message": f"Groq HTTPError: status={e.code}",
                "error_body": error_body,
                "sent_payload_preview": {
                    "model": payload.model,
                    "system_prompt_len": len(payload.system_prompt or ""),
                    "user_prompt_len": len(payload.user_prompt or ""),
                    "temperature": payload.temperature,
                },
            },
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "Relay internal error",
                "error": str(e),
            },
        )

    text = None
    choices = response_json.get("choices") or []
    if choices:
        text = choices[0].get("message", {}).get("content")

    if not text:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "Groq response does not contain assistant text",
                "raw_response": response_json,
            },
        )

    return {
        "status": "passed",
        "text": text,
        "raw_response": response_json,
    }