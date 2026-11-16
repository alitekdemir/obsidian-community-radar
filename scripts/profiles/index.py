"""Builds index.json, the file the plugin downloads, from the per-plugin profiles.

Tags are mapped onto the closed vocabulary here (tag-map.json), so the vocabulary
can be curated without rewriting the per-plugin source files.
"""

import json
import re
from collections import Counter
from pathlib import Path

# Fields the plugin needs for lists, queries and TOP10. Everything else
# (evidence quotes, problem, capabilities…) is read from profiles/<id>.json
# when a plugin's details are opened.
INDEX_FIELDS = ("basis", "summary", "intent", "primary", "also", "tags", "audience",
                "requires", "lifecycle", "replacedBy", "scores")


def write_json(path: Path, data, compact: bool = False) -> bool:
    """Stable JSON (sorted keys); writes only when the content differs and says whether it did."""
    text = (json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=True) if compact
            else json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return True


def load_profiles(data_dir: Path) -> dict[str, dict]:
    """All per-plugin profiles, keyed by plugin id."""
    return {path.stem: json.loads(path.read_text(encoding="utf-8"))
            for path in sorted((data_dir / "profiles").glob("*.json"))}


def tag_key(tag: str) -> str:
    """Spelling-insensitive key: code-blocks, code-block and codeblock share one."""
    key = tag.replace("-", "")
    key = re.sub(r"(?<!s)s$", "", key)    # plural -s, but not -ss (glass)
    return re.sub(r"ies$", "y", key)      # libraries → library


def load_tag_map(data_dir: Path) -> dict[str, str | None]:
    """tag-map.json keyed by spelling, so code-block finds the entry written for code-blocks."""
    tag_map = json.loads((data_dir / "tag-map.json").read_text(encoding="utf-8"))
    vocab = json.loads((data_dir / "tags.json").read_text(encoding="utf-8"))
    by_key = {tag_key(tag): target for tag, target in tag_map.items()}
    by_key.update({tag_key(tag): tag for tag in vocab})  # a vocabulary tag always maps to itself
    return by_key


def vocabulary_tags(tags: list[str], by_key: dict[str, str | None]) -> list[str]:
    """A profile's tags as vocabulary tags: mapped, deduplicated, order kept; unknown or null dropped."""
    return list(dict.fromkeys(t for t in (by_key.get(tag_key(tag)) for tag in tags) if t))


def build_index(profiles: dict[str, dict], categories: list[str], by_key: dict[str, str | None]) -> dict:
    """The plugin's download: slim profiles with vocabulary tags, plus each tag's plugin count."""
    plugins = {}
    for pid, profile in profiles.items():
        entry = {field: profile[field] for field in INDEX_FIELDS}
        entry["tags"] = vocabulary_tags(profile["tags"], by_key)
        entry["relations"] = [{"plugin": r["plugin"], "type": r["type"]} for r in profile["relations"]]
        entry["core"] = profile["coreOverlap"]["level"]
        plugins[pid] = entry
    tag_uses = Counter(tag for entry in plugins.values() for tag in entry["tags"])
    return {
        "categories": categories,
        "tags": dict(tag_uses.most_common()),
        "plugins": plugins,
    }
