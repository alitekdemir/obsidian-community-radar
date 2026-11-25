"""The OpenRouter calls the profile run makes: free-model lookup and JSON chat answers (stdlib only)."""

import json
import re
import threading
import time
import urllib.error
import urllib.request

API = "https://openrouter.ai/api/v1"
CALL_DEADLINE = 90  # s for one answer, retries included; socket timeouts alone let a slow stream run on


class AccountError(RuntimeError):
    """Credits, key limit or auth: every later call would fail the same way, so the run stops."""


class RateLimited(RuntimeError):
    """HTTP 429: too many requests for now (the free models' per-minute limit, or a busy provider).

    Not the plugin's fault: the caller waits `wait` seconds (until the limit resets) and asks again.
    """

    def __init__(self, message: str, wait: float):
        super().__init__(message)
        self.wait = wait


def reset_wait(error: urllib.error.HTTPError, body: str) -> float:
    """Seconds until a 429's limit resets: its X-RateLimit-Reset (ms since epoch, in the headers or the
    error body), else Retry-After, else 20 s; kept within 1-65 s."""
    reset = error.headers.get("X-RateLimit-Reset")
    if reset is None and (match := re.search(r'"X-RateLimit-Reset"\s*:\s*"?(\d+)', body)):
        reset = match[1]
    if reset is not None:
        wait = int(reset) / 1000 - time.time()
    else:
        wait = float(error.headers.get("Retry-After") or 20)
    return min(max(wait, 1.0), 65.0)


def request(key: str, path: str, body: dict | None = None, timeout: int = 60) -> dict:
    """One GET (no body) or POST to the API; raises with the status and the start of the reply."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{API}/{path}", data=data, method="POST" if data else "GET", headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/alitekdemir/obsidian-pindex", "X-Title": "Pindex",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        body = error.read().decode(errors="replace")
        text = body[:300]
        if error.code in (401, 402, 403):
            raise AccountError(f"HTTP {error.code}: {text}") from None
        if error.code == 429:
            raise RateLimited(f"HTTP 429: {text}", reset_wait(error, body)) from None
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
        except (AccountError, RateLimited):
            raise  # the run stops, or the caller waits for the limit to reset
        except RuntimeError as error:
            problem = str(error)
            if problem.startswith(("HTTP 400", "HTTP 404")):
                break  # the request itself is wrong: retrying can't help
        except (urllib.error.URLError, TimeoutError) as error:
            problem = f"{type(error).__name__}: {error}"
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(problem)


def within(seconds: float, fn, *args):
    """fn(*args), or TimeoutError after `seconds`; a late answer is dropped (its thread is a daemon)."""
    outcome = {}

    def target():
        try:
            outcome["value"] = fn(*args)
        except BaseException as error:  # handed back to the caller below
            outcome["error"] = error

    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    thread.join(seconds)
    if thread.is_alive():
        raise TimeoutError(f"no answer in {seconds}s")
    if "error" in outcome:
        raise outcome["error"]
    return outcome["value"]


def free_models(key: str, limit: int = 3) -> list[str]:
    """Free models that accept JSON output, largest context first; the list rotates, so it's read each run."""
    models = request(key, "models")["data"]
    free = [m for m in models
            if m["id"].endswith(":free") and "response_format" in (m.get("supported_parameters") or [])]
    return [m["id"] for m in sorted(free, key=lambda m: -(m.get("context_length") or 0))][:limit]


def free_requests_left(key: str) -> dict | None:
    """Today's free-model counter ({used, limit, remaining}), when OpenRouter reports it."""
    return request(key, "key").get("data", {}).get("free_model_daily_requests")


def extract_json_object(content: str) -> dict:
    """Extracts the first valid JSON object from a model reply, tolerating code fences and trailing prose."""
    fenced = re.search(r"```(?:json)?\s*\r?\n(.*?)\r?\n```", content, re.I | re.S)
    candidates = [fenced.group(1), content] if fenced else [content]
    decoder = json.JSONDecoder()
    for source in candidates:
        pos = source.find("{")
        while pos != -1:
            try:
                obj, _ = decoder.raw_decode(source, pos)
                if isinstance(obj, dict):
                    return obj
            except json.JSONDecodeError:
                pass
            pos = source.find("{", pos + 1)
    raise ValueError("no valid JSON object in the answer")


def ask_json(key: str, models: list[str], system: str, user: str) -> tuple[dict, dict]:
    """One JSON answer from the first model that gives one; returns (answer, call info for the log)."""
    body = {"models": models,  # OpenRouter moves on to the next model on errors or limits
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "response_format": {"type": "json_object"}, "temperature": 0, "usage": {"include": True}}
    started = time.time()
    data = within(CALL_DEADLINE, chat, key, body)
    content = data["choices"][0]["message"].get("content") or ""
    try:
        parsed = extract_json_object(content)
    except ValueError as err:
        raise ValueError(f"{err} (finish_reason={data['choices'][0].get('finish_reason')})") from None
    usage = data.get("usage", {})
    info = {"model": data.get("model"), "provider": data.get("provider"), "cost": usage.get("cost") or 0,
            "seconds": round(time.time() - started, 1)}
    return parsed, info
