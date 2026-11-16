"""Hourly AI-profile run (GitHub Actions): keeps the `profiles` branch in step with the plugin list.

Each run:
  1. reads the official plugin list and download stats (two requests),
  2. finds plugins that are new, have a new release, or left the list (kept, marked delisted),
  3. profiles the new ones and those whose README text changed, with free OpenRouter models,
  4. gives vocabulary tags to plugins that have none (a short call, no README),
  5. rewrites index.json and records what changed in changes.json.

Usage:  python update.py DATA_DIR   (DATA_DIR: the profiles branch's files; OPENROUTER_API_KEY set)
Optional settings (GitHub repository variables, passed as environment variables):
    PROFILE_MODELS    comma-separated OpenRouter models to use; empty = today's free models
    REPROFILE_MODEL   re-profile the plugins whose profile was made by this model (prefix match),
                      MAX_PROFILES per run, until none is left; e.g. particle-ai/particle-1:free
Writes `changed=true|false` to $GITHUB_OUTPUT so the workflow publishes only when something changed.
"""

import hashlib
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path

import jsonschema

import index
import openrouter
import profiler

RELEASES = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD"
LISTING_URL = f"{RELEASES}/community-plugins.json"
STATS_URL = f"{RELEASES}/community-plugin-stats.json"
README_NAMES = ("README.md", "readme.md", "Readme.md", "README.MD")
UNREVIEWED_NOTE = re.compile(r"\s*-?\s*This plugin has not been manually reviewed by Obsidian staff\.?\s*", re.I)

MAX_PROFILES = 40      # README profiles per run; the rest wait for the next hour
MAX_RETAGS = 100       # tag-only calls per run
MAX_ATTEMPTS = 3       # a plugin that keeps failing waits for its next release
MAX_DELISTS = 50       # more plugins vanishing in one run means a bad download, not a cleanup
MAX_RUN_COST = 0.05    # $: a guard in case a "free" model starts charging
WORKERS = 10           # free models allow 20 requests a minute; an answer takes 10-90 s
TIME_BUDGET = 20 * 60  # s: no new calls after this, so the run saves its work before the 30-minute job limit
CHANGES_DAYS = 30      # how far back changes.json reaches

RETAG_PROMPT = """\
You tag Obsidian community plugins for a plugin directory. From the plugin's summary, pick
2-8 tags from this closed vocabulary, the most specific ones that fit; [] if none fits.
Never use a tag outside the vocabulary.

Vocabulary: {tags}

Return only JSON: {{"tags": ["<tag>", ...]}}"""


def fetch(url: str) -> str | None:
    """A public file as text, or None when it doesn't exist."""
    try:
        with urllib.request.urlopen(url, timeout=60) as response:
            return response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


def readme(repo: str) -> str | None:
    """The README on the repository's default branch, trying the usual file names."""
    for name in README_NAMES:
        text = fetch(f"https://raw.githubusercontent.com/{repo}/HEAD/{name}")
        if text is not None:
            return text
    return None


def sha1(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def load(path: Path, default):
    """A JSON file of the branch, or the default when it isn't there yet."""
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


class Stopped(RuntimeError):
    """The run stopped starting calls (time budget, spend guard or account error): not the plugin's fault."""


class Calls:
    """Shared by the worker threads: the API key, models, the run's spend, its clock and its stop switch."""

    def __init__(self, key: str, models: list[str]):
        self.key, self.models = key, models
        self.cost, self.stop, self.lock = 0.0, threading.Event(), threading.Lock()
        self.deadline = time.monotonic() + TIME_BUDGET

    def ask(self, system: str, user: str) -> dict:
        """One JSON answer; stops the run on account errors, the spend guard or the time budget."""
        if time.monotonic() > self.deadline:
            self.stop.set()
        if self.stop.is_set():
            raise Stopped("run stopped")
        try:
            answer, info = openrouter.ask_json(self.key, self.models, system, user)
        except openrouter.AccountError:
            self.stop.set()
            raise
        print(f"   · {info['model']} {info['seconds']}s", flush=True)  # progress, visible in the Actions log
        with self.lock:
            self.cost += info["cost"]
            if self.cost >= MAX_RUN_COST:
                self.stop.set()
        return {"answer": answer, **info}


def profile_plugin(calls: Calls, plugin: dict, raw: str | None, schema: dict, system: str,
                   slugs: set[str]) -> dict:
    """A new profile file's content for one plugin (normalized, with hashes and provenance)."""
    plugin = {**plugin, "text": profiler.clean_readme(raw)}
    reply = calls.ask(system, profiler.user_message(plugin))
    answer = {k: v for k, v in reply["answer"].items() if k in schema["properties"]}  # extra keys are harmless
    jsonschema.validate(answer, schema)
    profile, _ = profiler.normalize_profile(answer, plugin, slugs)
    return {**profile, "readmeHash": sha1(raw or ""), "textHash": sha1(plugin["text"]),
            "model": f"{reply['model']}@v{profiler.PROMPT_VERSION}", "provider": reply["provider"],
            "profiledAt": datetime.now(UTC).strftime("%Y-%m-%d")}


def retag(calls: Calls, plugin_id: str, profile: dict, system: str, by_key: dict) -> tuple[list[str], str]:
    """Vocabulary tags for a profile that has none, from its summary alone; returns (tags, model)."""
    user = (f"Plugin: {plugin_id}\nSummary: {profile['summary']}\nProblem: {profile['problem']}\n"
            f"Capabilities: {'; '.join(profile['capabilities'])}")
    reply = calls.ask(system, user)
    tags = reply["answer"].get("tags") or []
    return index.vocabulary_tags([t for t in tags if isinstance(t, str)], by_key)[:8], reply["model"]


def run_jobs(jobs: list, work) -> list:
    """Runs work(job) in parallel; returns (job, result or Exception) pairs in job order."""
    def safe(job):
        try:
            return job, work(job)
        except Exception as error:  # one plugin's failure never stops the others
            return job, error
    with ThreadPoolExecutor(WORKERS) as pool:
        return list(pool.map(safe, jobs))


def main(data: Path) -> None:
    key = os.environ["OPENROUTER_API_KEY"]
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    catalog = {p["id"]: p for p in json.loads(fetch(LISTING_URL))}
    stats = json.loads(fetch(STATS_URL))
    profiles = index.load_profiles(data)
    categories = load(data / "categories.json", [])
    vocab = load(data / "tags.json", [])
    by_key = index.load_tag_map(data)
    state = load(data / "state.json", None)
    changes = load(data / "changes.json", [])
    if state is None:  # first run after the Colab scan: everything profiled is current
        state = {"updated": {pid: stats.get(pid, {}).get("updated", 0) for pid in profiles},
                 "failed": {}, "retagged": []}
        print(f"🌱 state started from {len(state['updated']):,} profiles")

    # ── What changed in the plugin list ─────────────────────────────────────
    # A plugin that leaves the list keeps its profile, marked delisted: the repository usually still
    # exists and people may have it installed. One that comes back is listed again.
    delisted = sorted(pid for pid, p in profiles.items() if pid not in catalog and not p.get("delisted"))
    relisted = sorted(pid for pid, p in profiles.items() if pid in catalog and p.get("delisted"))
    if len(delisted) > MAX_DELISTS:
        print(f"⚠️ {len(delisted)} plugins missing from the list: looks like a bad download, nothing delisted")
        delisted = []
    events = ([{"at": today, "id": pid, "change": "delisted"} for pid in delisted]
              + [{"at": today, "id": pid, "change": "relisted"} for pid in relisted])
    for pid in delisted + relisted:
        if pid in delisted:
            profiles[pid]["delisted"] = today
        else:
            profiles[pid].pop("delisted")
        index.write_json(data / "profiles" / f"{pid}.json", profiles[pid])

    new = [pid for pid in reversed(list(catalog)) if pid not in profiles]  # newest are listed last
    released = [pid for pid in profiles if pid in catalog
                and stats.get(pid, {}).get("updated", 0) > state["updated"].get(pid, 0)]
    for pid in released:  # a new release gives a failing plugin new chances
        state["failed"].pop(pid, None)
    prefix = os.environ.get("REPROFILE_MODEL", "").strip()
    reprofile = {pid for pid, p in profiles.items()
                 if prefix and pid in catalog and p.get("model", "").startswith(prefix)}

    # ── READMEs: new plugins, and released ones whose text changed ─────────
    candidates = [pid for pid in dict.fromkeys(new + released + sorted(reprofile))
                  if state["failed"].get(pid, 0) < MAX_ATTEMPTS]
    jobs = []
    for pid in candidates:
        if len(jobs) >= MAX_PROFILES:
            break
        plugin = catalog[pid]
        try:
            raw = readme(plugin["repo"])
        except Exception as error:  # GitHub hiccup: counts as an attempt, tried again next hour
            state["failed"][pid] = state["failed"].get(pid, 0) + 1
            print(f"   ✗ {pid}: README {str(error)[:100]}")
            continue
        old = profiles.get(pid)
        if old and pid not in reprofile and (sha1(raw or "") == old.get("readmeHash")
                    or sha1(profiler.clean_readme(raw)) == old.get("textHash")):
            state["updated"][pid] = stats.get(pid, {}).get("updated", 0)  # new release, same README
            continue
        description = UNREVIEWED_NOTE.sub(" ", plugin.get("description", "")).strip()
        jobs.append(({"id": pid, "name": plugin["name"], "description": description}, raw))
    print(f"📋 {len(catalog):,} plugins · {len(new)} new · {len(released)} released · {len(delisted)} delisted "
          f"· {len(relisted)} relisted · {len(reprofile)} to re-profile ({prefix or '-'}) · {len(jobs)} to profile")

    retag_ids = [pid for pid, p in profiles.items()
                 if not index.vocabulary_tags(p["tags"], by_key) and pid not in state["retagged"]][:MAX_RETAGS]
    if jobs or retag_ids:
        chosen = [m.strip() for m in os.environ.get("PROFILE_MODELS", "").split(",") if m.strip()]
        models = chosen or openrouter.free_models(key)
        print(f"🤖 models: {models} ({'PROFILE_MODELS' if chosen else 'free'}) · "
              f"free requests today: {openrouter.free_requests_left(key)}")
        calls = Calls(key, models)
        schema = profiler.build_schema(categories)
        # JSON mode has no schema slot, so the exact shape goes into the instructions
        system = (profiler.system_prompt(categories, vocab)
                  + "\n\nReturn ONLY one JSON object that matches this JSON Schema:\n" + json.dumps(schema))
        slugs = set(categories)

        for (plugin, _raw), result in run_jobs(jobs, lambda job: profile_plugin(calls, *job, schema, system, slugs)):
            pid = plugin["id"]
            if isinstance(result, Stopped | TimeoutError):
                continue  # not the plugin's fault (run stopped, model too slow): waits for the next run
            if isinstance(result, Exception):
                state["failed"][pid] = state["failed"].get(pid, 0) + 1
                print(f"   ✗ {pid}: {str(result)[:120]}")
                continue
            events.append({"at": today, "id": pid, "change": "updated" if pid in profiles else "added"})
            profiles[pid] = result
            index.write_json(data / "profiles" / f"{pid}.json", result)
            state["updated"][pid] = stats.get(pid, {}).get("updated", 0)
            state["failed"].pop(pid, None)

        retag_system = RETAG_PROMPT.format(tags=", ".join(vocab))
        retagged = 0
        for pid, result in run_jobs(retag_ids, lambda pid: retag(calls, pid, profiles[pid], retag_system, by_key)):
            if isinstance(result, Exception):
                continue  # tried again next run
            state["retagged"].append(pid)
            tags, model = result
            if tags:
                profiles[pid].update(tags=tags, tagsBy=model)
                index.write_json(data / "profiles" / f"{pid}.json", profiles[pid])
                retagged += 1
        stopped = " · ⏱️ time budget reached, the rest waits for the next run" if calls.stop.is_set() else ""
        print(f"🏷️ retagged {retagged}/{len(retag_ids)} · 💵 run cost ${calls.cost:.4f}{stopped}")

    # ── Outputs ─────────────────────────────────────────────────────────────
    since = (datetime.now(UTC) - timedelta(days=CHANGES_DAYS)).strftime("%Y-%m-%d")
    changes = [c for c in changes + events if c["at"] >= since]
    state["retagged"] = sorted(set(state["retagged"]))
    wrote = [
        index.write_json(data / "state.json", state),
        index.write_json(data / "changes.json", changes),
        index.write_json(data / "index.json", index.build_index(profiles, categories, by_key), compact=True),
    ]
    changed = bool(events) or any(wrote)
    print(f"✅ {len(events)} changes · {len(profiles):,} profiles · publish: {changed}")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as out:
            out.write(f"changed={'true' if changed else 'false'}\n")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
