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
                      as many per run as its calls allow, until none is left; e.g. particle-ai/particle-1:free
english-backlog.txt (next to this file): plugin ids whose README is in another language with an English
                      version; re-profiled once from the English one (a profile with readmeSource is done).
Writes `changed=true|false` to $GITHUB_OUTPUT so the workflow publishes only when something changed, and
`more=true` when the queue isn't done, the run made progress and free requests are left: the workflow then
starts itself again, so a long queue goes on run after run until it or the day's free requests run out.
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
BACKLOG = Path(__file__).with_name("english-backlog.txt")
UNREVIEWED_NOTE = re.compile(r"\s*-?\s*This plugin has not been manually reviewed by Obsidian staff\.?\s*", re.I)

RATE = 18              # model calls started a minute: the free models allow 20
TIME_BUDGET = 20 * 60  # s from the run's start: no new calls after this, so it saves its work before the 30-minute job limit
MAX_CALLS = RATE * TIME_BUDGET // 60  # what fits in a run; also capped by today's free requests left
MIN_MORE_REQUESTS = 30  # free requests that must be left for the run to start the next one
RATE_RETRIES = 4       # a call that keeps hitting 429 waits for the next run (not counted as the plugin's failure)
MAX_RETAGS = 100       # tag-only calls per run
MAX_ATTEMPTS = 3       # a plugin that keeps failing waits for its next release
MAX_DELISTS = 50       # more plugins vanishing in one run means a bad download, not a cleanup
MAX_RUN_COST = 0.05    # $: a guard in case a "free" model starts charging
WORKERS = 20           # an answer takes 10-90 s: enough threads that RATE, not they, sets the pace
STATE_VERSION = 2      # 2: 429s no longer count as failures; the counts made before are dropped once
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


def english_readme(raw: str | None, repo: str) -> tuple[str | None, str]:
    """The README to profile from, and where it came from: README.md itself, unless it's in another
    language and links an English version (README_en.md…) or holds an English section (README.md#English).
    """
    if not raw or profiler.foreign_share(raw) <= profiler.FOREIGN_SHARE:
        return raw, "README.md"
    if url := profiler.english_link(raw, repo):
        try:
            text = fetch(url)
        except OSError:  # a broken link (HTTP or network error): the section or the README itself still serves
            text = None
        if text and profiler.is_english(text):
            return text, url.rsplit("/", 1)[-1]
    if section := profiler.english_section(raw):
        return section, "README.md#English"
    return raw, "README.md"


def sha1(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def load(path: Path, default):
    """A JSON file of the branch, or the default when it isn't there yet."""
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


class Stopped(RuntimeError):
    """The run stopped starting calls (time budget, spend guard or account error): not the plugin's fault."""


class Calls:
    """Shared by the worker threads: the API key, models, the run's spend, its clock, its pace and its stop switch."""

    def __init__(self, key: str, models: list[str], deadline: float):
        self.key, self.models, self.deadline = key, models, deadline
        self.cost, self.stop, self.lock = 0.0, threading.Event(), threading.Lock()
        self.next_start = 0.0  # monotonic time the next call may start: RATE a minute, later after a 429

    def wait_turn(self) -> None:
        """Waits for this call's turn: calls start 60 / RATE s apart, and not before a 429's reset."""
        with self.lock:
            now = time.monotonic()
            start = max(now, self.next_start)
            self.next_start = start + 60 / RATE
        time.sleep(start - now)

    def pause(self, seconds: float) -> None:
        """A 429: no call starts for `seconds` (the limit's reset), whichever thread got it."""
        with self.lock:
            self.next_start = max(self.next_start, time.monotonic() + seconds)

    def ask(self, system: str, user: str) -> dict:
        """One JSON answer, at the run's pace; a 429 waits for its reset and asks again (RATE_RETRIES times).

        Stops the run on account errors, the spend guard or the time budget.
        """
        for attempt in range(RATE_RETRIES + 1):
            self.wait_turn()
            if time.monotonic() > self.deadline:
                self.stop.set()
            if self.stop.is_set():
                raise Stopped("run stopped")
            try:
                answer, info = openrouter.ask_json(self.key, self.models, system, user)
                break
            except openrouter.AccountError:
                self.stop.set()
                raise
            except openrouter.RateLimited as error:
                self.pause(error.wait)
                print(f"   ⏸ 429, waiting {error.wait:.0f}s", flush=True)
                if attempt == RATE_RETRIES:
                    raise
        print(f"   · {info['model']} {info['seconds']}s", flush=True)  # progress, visible in the Actions log
        with self.lock:
            self.cost += info["cost"]
            if self.cost >= MAX_RUN_COST:
                self.stop.set()
        return {"answer": answer, **info}


def profile_plugin(calls: Calls, plugin: dict, raw: str | None, source: tuple[str | None, str], schema: dict,
                   system: str, slugs: set[str]) -> dict:
    """A new profile file's content for one plugin (normalized, with hashes and provenance).

    `raw` is README.md (its hash tells a new release with the same README); `source` is (text, name) of what
    the model reads: README.md itself or its English version (english_readme).
    """
    text, name = source
    plugin = {**plugin, "text": profiler.clean_readme(text)}
    reply = calls.ask(system, profiler.user_message(plugin))
    answer = {k: v for k, v in reply["answer"].items() if k in schema["properties"]}  # extra keys are harmless
    jsonschema.validate(answer, schema)
    profile, _ = profiler.normalize_profile(answer, plugin, slugs)
    return {**profile, "readmeHash": sha1(raw or ""), "textHash": sha1(plugin["text"]), "readmeSource": name,
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


def read_readme(plugin: dict) -> tuple[str | None, tuple[str | None, str]]:
    """README.md and what the model would read from it (english_readme); raises on a GitHub hiccup."""
    raw = readme(plugin["repo"])
    return raw, english_readme(raw, plugin["repo"])


def main(data: Path) -> None:
    deadline = time.monotonic() + TIME_BUDGET  # the whole run's, README downloads included
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
    if state.get("version", 1) < STATE_VERSION:  # failures counted before 429s were told apart: mostly rate limits
        state.update(failed={}, version=STATE_VERSION)

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
    backlog = set(BACKLOG.read_text(encoding="utf-8").split()) if BACKLOG.exists() else set()
    reprofile |= {pid for pid in backlog if pid in catalog and "readmeSource" not in profiles.get(pid, {"readmeSource": 0})}

    # ── How many calls this run can make: as many as fit in its time, within today's free requests ──
    chosen = [m.strip() for m in os.environ.get("PROFILE_MODELS", "").split(",") if m.strip()]
    quota = None if chosen else openrouter.free_requests_left(key)
    limit = min(MAX_CALLS, quota["remaining"]) if quota and quota.get("remaining") is not None else MAX_CALLS

    # ── READMEs: new plugins, and released ones whose text changed ─────────
    # Downloaded WORKERS at a time; a released plugin whose README didn't change costs no call, so the queue is
    # read until the run's calls are spoken for (or the time is half gone: the calls need the other half).
    candidates = [pid for pid in dict.fromkeys(new + released + sorted(reprofile))
                  if state["failed"].get(pid, 0) < MAX_ATTEMPTS]
    jobs = []
    read = 0  # candidates looked at: fewer than all means the queue goes on in the next run
    for start in range(0, len(candidates), WORKERS * 5):
        if len(jobs) >= limit or time.monotonic() > deadline - TIME_BUDGET / 2:
            break
        batch = candidates[start:start + WORKERS * 5]
        for pid, result in run_jobs(batch, lambda pid: read_readme(catalog[pid])):
            if len(jobs) >= limit:
                break
            read += 1
            if isinstance(result, Exception):  # GitHub hiccup: counts as an attempt, tried again next run
                state["failed"][pid] = state["failed"].get(pid, 0) + 1
                print(f"   ✗ {pid}: README {str(result)[:100]}")
                continue
            raw, source = result
            old = profiles.get(pid)
            if old and pid not in reprofile and (sha1(raw or "") == old.get("readmeHash")
                                                 or sha1(profiler.clean_readme(source[0])) == old.get("textHash")):
                state["updated"][pid] = stats.get(pid, {}).get("updated", 0)  # new release, same README text
                continue
            plugin = catalog[pid]
            description = UNREVIEWED_NOTE.sub(" ", plugin.get("description", "")).strip()
            jobs.append(({"id": pid, "name": plugin["name"], "description": description}, raw, source))
    english = sum(source[1] != "README.md" for _, _, source in jobs)
    print(f"📋 {len(catalog):,} plugins · {len(new)} new · {len(released)} released · {len(delisted)} delisted "
          f"· {len(relisted)} relisted · {len(reprofile)} to re-profile ({prefix or '-'}) · {len(jobs)} to profile "
          f"({english} from an English version) · call limit {limit} ({'free requests left' if quota else 'time'})")

    retag_ids = [pid for pid, p in profiles.items()
                 if not index.vocabulary_tags(p["tags"], by_key) and pid not in state["retagged"]]
    retag_ids = retag_ids[:max(0, min(MAX_RETAGS, limit - len(jobs)))]  # what's left of the run's calls
    profiled, cut_short = 0, False
    if jobs or retag_ids:
        models = chosen or openrouter.free_models(key)
        print(f"🤖 models: {models} ({'PROFILE_MODELS' if chosen else 'free'}) · free requests today: {quota}")
        calls = Calls(key, models, deadline)
        schema = profiler.build_schema(categories)
        # JSON mode has no schema slot, so the exact shape goes into the instructions
        system = (profiler.system_prompt(categories, vocab)
                  + "\n\nReturn ONLY one JSON object that matches this JSON Schema:\n" + json.dumps(schema))
        slugs = set(categories)

        for (plugin, _raw, _source), result in run_jobs(jobs, lambda job: profile_plugin(calls, *job, schema, system, slugs)):
            pid = plugin["id"]
            if isinstance(result, Stopped | TimeoutError | openrouter.RateLimited):
                continue  # not the plugin's fault (run stopped, model too slow, rate limit): waits for the next run
            if isinstance(result, Exception):
                state["failed"][pid] = state["failed"].get(pid, 0) + 1
                print(f"   ✗ {pid}: {str(result)[:120]}")
                continue
            profiled += 1
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
        cut_short = calls.stop.is_set()
        stopped = " · ⏱️ time budget reached, the rest waits for the next run" if cut_short else ""
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
    # another run right away: the queue goes on, this run moved it, and today's free requests aren't spent
    # (paid models never chain: their spend is yours to start)
    queue_left = read < len(candidates) or cut_short
    left_today = (openrouter.free_requests_left(key) or {}).get("remaining", 0) if quota and queue_left and profiled else 0
    more = left_today >= MIN_MORE_REQUESTS
    print(f"✅ {len(events)} changes · {len(profiles):,} profiles · publish: {changed} · "
          f"next run now: {more} (queue left: {queue_left}, free requests left: {left_today})")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as out:
            out.write(f"changed={'true' if changed else 'false'}\nmore={'true' if more else 'false'}\n")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
