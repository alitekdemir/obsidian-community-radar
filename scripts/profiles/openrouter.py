"""The OpenRouter calls the profile run makes: free-model lookup and JSON chat answers (stdlib only)."""

import json
import re
import time
import urllib.error
import urllib.request

API = "https://openrouter.ai/api/v1"


class AccountError(RuntimeError):
    """Credits, key limit or auth: every later call would fail the same way, so the run stops."""


def request(key: str, path: str, body: dict | None = None, timeout: int = 60) -> dict:
    """One GET (no body) or POST to the API; raises with the status and the start of the reply."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{API}/{path}", data=data, method="POST" if data else "GET", headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/alitekdemir/obsidian-community-radar", "X-Title": "Community Radar",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        text = error.read().decode(errors="replace")[:300]
        if error.code in (401, 402, 403):
            raise AccountError(f"HTTP {error.code}: {text}") from None
        raise RuntimeError(f"HTTP {error.code}: {text}") from None


def chat(key: str, body: dict, attempts: int = 2) -> dict:
    """A chat completion with retries on throttling, server errors and dropped connections."""
    problem = "no attempt"
    for attempt in range(attempts):
        try:
            data = request(key, "chat/completions", body)
            if "error" not in data:  # OpenRouter can answer 200 with an error body
                return data
            problem = f"error body: {json.dumps(data['error'])[:300]}"
        except AccountError:
            raise
        except RuntimeError as error:
            problem = str(error)
            if problem.startswith(("HTTP 400", "HTTP 404")):
                break  # the request itself is wrong: retrying can't help
        except (urllib.error.URLError, TimeoutError) as error:
            problem = f"{type(error).__name__}: {error}"
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(problem)


def free_models(key: str, limit: int = 3) -> list[str]:
    """Free models that accept JSON output, largest context first; the list rotates, so it's read each run."""
    models = request(key, "models")["data"]
    free = [m for m in models
            if m["id"].endswith(":free") and "response_format" in (m.get("supported_parameters") or [])]
    return [m["id"] for m in sorted(free, key=lambda m: -(m.get("context_length") or 0))][:limit]


def free_requests_left(key: str) -> dict | None:
    """Today's free-model counter ({used, limit, remaining}), when OpenRouter reports it."""
    return request(key, "key").get("data", {}).get("free_model_daily_requests")


def ask_json(key: str, models: list[str], system: str, user: str) -> tuple[dict, dict]:
    """One JSON answer from the first model that gives one; returns (answer, call info for the log)."""
    body = {"models": models,  # OpenRouter moves on to the next model on errors or limits
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "response_format": {"type": "json_object"}, "temperature": 0, "usage": {"include": True}}
    started = time.time()
    data = chat(key, body)
    content = data["choices"][0]["message"].get("content") or ""
    match = re.search(r"\{.*\}", content, re.S)  # tolerate ```json fences and leading prose
    if not match:
        raise ValueError(f"no JSON in the answer (finish_reason={data['choices'][0].get('finish_reason')})")
    usage = data.get("usage", {})
    info = {"model": data.get("model"), "provider": data.get("provider"), "cost": usage.get("cost") or 0,
            "seconds": round(time.time() - started, 1)}
    return json.loads(match.group(0)), info
