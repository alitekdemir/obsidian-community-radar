"""Shared constants and catalog helpers for Pindex's GitHub Actions data scripts."""

import json
import re
import urllib.request

RELEASES = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD"
LISTING_URL = f"{RELEASES}/community-plugins.json"
STATS_URL = f"{RELEASES}/community-plugin-stats.json"
UNREVIEWED_NOTE = re.compile(r"\s*-?\s*This plugin has not been manually reviewed by Obsidian staff\.?\s*", re.I)


def clean_description(text: str | None) -> str:
    """Removes Obsidian's staff-review disclaimer and normalizes surrounding whitespace."""
    return UNREVIEWED_NOTE.sub(" ", text or "").strip()


def fetch_json(url: str, timeout: int = 60):
    """Downloads and parses a public JSON document."""
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.load(response)
