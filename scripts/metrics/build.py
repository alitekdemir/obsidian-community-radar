"""Release history and download metrics for every community plugin, from obsidian-releases' git history.

Obsidian commits `community-plugin-stats.json` once a day since 2020-10. Replaying every snapshot gives
each plugin's release moments, the day it first appeared and its downloads over time. The plugin
downloads the result instead of replaying a year of snapshots itself.

Usage: python build.py <obsidian-releases clone with full history> <out dir>

Writes:
  timeline.json  the plugin's timeline format (see newTimeline / mergeSnapshot in src/10-core.js),
                 plus `growth` {id: [last 7, 30, 90 days]} and `milestones` {id: [1K, 10K, 100K]}
                 (ms when the downloads first passed it; 0: before the history starts)
  meta.json      {built, to, plugins}: small, so the plugin can tell whether there is something new
"""

import json
import subprocess
import sys
import time
from collections import deque
from pathlib import Path

STATS_FILE = "community-plugin-stats.json"
TIMELINE_VERSION = 2
RELEASES_CAP = 50
DAY_MS = 86_400_000
GROWTH_DAYS = (7, 30, 90)
MILESTONES = (1_000, 10_000, 100_000)
META_KEYS = {"downloads", "updated"}


def number(value):
    """Downloads as an int; a few early snapshots hold strings."""
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def snapshots(repo):
    """Yields (commit time in ms, stats) for every commit of the stats file, oldest first."""
    log = subprocess.run(
        ["git", "-C", repo, "log", "--reverse", "--format=%H %ct", "--", STATS_FILE],
        check=True, capture_output=True, text=True,
    ).stdout.split()
    commits = list(zip(log[::2], log[1::2]))
    cat = subprocess.Popen(["git", "-C", repo, "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    for sha, seconds in commits:
        cat.stdin.write(f"{sha}:{STATS_FILE}\n".encode())
        cat.stdin.flush()
        header = cat.stdout.readline().split()
        if header[-1] == b"missing":
            continue
        body = cat.stdout.read(int(header[2]))
        cat.stdout.read(1)  # the newline after each object
        try:
            yield int(seconds) * 1000, json.loads(body)
        except json.JSONDecodeError:
            print(f"skipped a broken snapshot: {sha}", file=sys.stderr)
    cat.stdin.close()
    cat.wait()


class History:
    """Everything one replay of the snapshots learns."""

    def __init__(self):
        self.releases, self.first_seen, self.milestones = {}, {}, {}
        self.versions, self.has_updated, self.downloads = {}, set(), {}
        self.recent = deque()  # (ms, {id: downloads}) for the longest growth window
        self.first = self.last = 0
        self.current = {}

    def add(self, ms, stats):
        """Merges one snapshot: new plugins, new releases, downloads and milestones."""
        seeding = not self.first
        self.first = self.first or ms
        self.last = ms
        self.current = stats
        for pid, stat in stats.items():
            if not isinstance(stat, dict):
                continue
            self.first_seen.setdefault(pid, 0 if seeding else ms)
            self._release(pid, stat, ms, seeding)
            self._downloads(pid, number(stat.get("downloads")), ms, seeding)
        self.recent.append((ms, dict(self.downloads)))
        while self.recent and self.recent[0][0] < ms - (max(GROWTH_DAYS) + 2) * DAY_MS:
            self.recent.popleft()

    def _release(self, pid, stat, ms, seeding):
        """A release is a new `updated` moment; old snapshots have no `updated`, so a new version key."""
        history = self.releases.setdefault(pid, [])
        versions = {k for k in stat if k not in META_KEYS}
        moment = stat.get("updated")
        if isinstance(moment, int) and moment > 0:
            # the first `updated` replaces an estimate from version keys made within two days of it
            if pid not in self.has_updated and history and abs(history[-1] - moment) < 2 * DAY_MS:
                history[-1] = moment
            elif not history or moment > history[-1]:
                history.append(moment)
            self.has_updated.add(pid)
        elif not seeding and pid in self.versions and versions - self.versions[pid]:
            history.append(ms)
        self.versions[pid] = versions
        del history[:-RELEASES_CAP]

    def _downloads(self, pid, count, ms, seeding):
        self.downloads[pid] = count
        passed = self.milestones.setdefault(pid, [None] * len(MILESTONES))
        for i, threshold in enumerate(MILESTONES):
            if passed[i] is None and count >= threshold:
                passed[i] = 0 if seeding else ms

    def growth(self, pid):
        """Downloads gained in the last 7, 30 and 90 days (all of them if the plugin is younger)."""
        now = self.downloads.get(pid, 0)
        out = []
        for days in GROWTH_DAYS:
            then = next((d for ms, d in reversed(self.recent) if ms <= self.last - days * DAY_MS), {})
            out.append(now - then.get(pid, 0) if then else 0)
        return out

    def timeline(self):
        months = max(1, round((self.last - self.first) / (30.44 * DAY_MS)))
        listed = [pid for pid in self.current if pid in self.first_seen]   # in today's file
        return {
            "v": TIMELINE_VERSION, "months": months, "from": self.first, "to": self.last, "seeded": True,
            "source": "server",
            "releases": {pid: self.releases[pid] for pid in listed if self.releases.get(pid)},
            "firstSeen": {pid: self.first_seen[pid] for pid in listed},
            "growth": {pid: self.growth(pid) for pid in listed},
            "milestones": {pid: self.milestones[pid] for pid in listed if any(x is not None for x in self.milestones[pid])},
        }


def main(repo, out):
    started = time.time()
    history = History()
    count = 0
    for ms, stats in snapshots(repo):
        history.add(ms, stats)
        count += 1
    timeline = history.timeline()
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "timeline.json").write_text(json.dumps(timeline, separators=(",", ":")))
    meta = {"built": int(time.time() * 1000), "to": timeline["to"], "plugins": len(timeline["firstSeen"]), "snapshots": count}
    (out / "meta.json").write_text(json.dumps(meta))
    size = (out / "timeline.json").stat().st_size
    print(f"{count} snapshots, {meta['plugins']} plugins, timeline.json {size / 1e6:.1f} MB, {time.time() - started:.0f} s")


if __name__ == "__main__":
    main(*sys.argv[1:3])
