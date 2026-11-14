"""Release history and download metrics for every community plugin, from obsidian-releases' git history.

Obsidian commits `community-plugin-stats.json` once a day since 2020-10. Replaying every snapshot gives
each plugin's release moments, the day it first appeared and its downloads over time. The plugin
downloads the result instead of replaying a year of snapshots itself.

Usage: python build.py <obsidian-releases clone with full history> <out dir>

Writes:
  timeline.json  the plugin's timeline format (see newTimeline / mergeTimeline in src/10-core.js), plus
                 `series` {days, points}: downloads over the last year. `days` are calendar days (ms // DAY_MS),
                   oldest first: Mondays, then every day of the last SERIES_DAILY (see series_days; the plugin's
                   seriesDays keeps the same ones); `points` {id: [downloads on the first day, then the change on
                   each next day]}. Gains over any window and the day a count was passed come from it.
                 `milestoneSteps` [1K, 5K, 10K, 25K, 50K, 100K] and `milestones` {id: [one per step]} (ms when the
                   downloads first passed it; 0: before the history starts): for steps passed before the series.
                 `removed` {id: [ms it was removed, reason]} from community-plugins-removed.json
  delta.json     what changed in the last DELTA_DAYS: releases, first-seen days, milestones, the series' days
                   (from the day before, so it joins on), removed. A plugin that has timeline.json from up to
                   DELTA_DAYS ago downloads this (~150 KB) instead of the whole file (see mergeTimeline).
  meta.json      {built, to, plugins, deltaFrom}: small, so the plugin can tell whether there is something new
                   and whether the delta reaches back to its copy
"""

import json
import subprocess
import sys
import time
from collections import deque
from pathlib import Path

STATS_FILE = "community-plugin-stats.json"
REMOVED_FILE = "community-plugins-removed.json"
TIMELINE_VERSION = 3
RELEASES_CAP = 50
DAY_MS = 86_400_000
SERIES_DAYS = 365   # the downloads series covers a year…
SERIES_DAILY = 30   # …day by day for the last month, Mondays before it (a third of the size of a daily year)
DELTA_DAYS = 7      # delta.json: the changes of the last week (~150 KB sent; a plugin offline longer gets the whole file)
MILESTONES = (1_000, 5_000, 10_000, 25_000, 50_000, 100_000)
META_KEYS = {"downloads", "updated"}


def number(value):
    """Downloads as an int; a few early snapshots hold strings."""
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def snapshots(repo, file=STATS_FILE):
    """Yields (commit time in ms, parsed JSON) for every commit of `file`, oldest first."""
    log = subprocess.run(
        ["git", "-C", repo, "log", "--reverse", "--format=%H %ct", "--", file],
        check=True, capture_output=True, text=True,
    ).stdout.split()
    commits = list(zip(log[::2], log[1::2]))
    cat = subprocess.Popen(["git", "-C", repo, "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    for sha, seconds in commits:
        cat.stdin.write(f"{sha}:{file}\n".encode())
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


def is_monday(day):
    """Day numbers count from Thursday 1970-01-01."""
    return (day + 3) % 7 == 0


def series_days(last_day):
    """The calendar days the series keeps, oldest first: Mondays back to a year ago (one before it, so a year has
    a point on each side), then every day of the last SERIES_DAILY. Fixed days: a kept point never changes."""
    mondays = [d for d in range(last_day - SERIES_DAYS - 6, last_day - SERIES_DAILY) if is_monday(d)]
    return [*mondays, *range(last_day - SERIES_DAILY, last_day + 1)]


def encode(rows):
    """Counts → the first one, then the change at each next point (small numbers: the file stays small)."""
    return [rows[0], *(b - a for a, b in zip(rows, rows[1:]))]


class History:
    """Everything one replay of the snapshots learns."""

    def __init__(self):
        self.releases, self.first_seen, self.milestones = {}, {}, {}
        self.versions, self.has_updated, self.downloads = {}, set(), {}
        self.days = deque()  # (day number, {id: downloads} at the day's last snapshot) for the series' year
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
        day = ms // DAY_MS
        if self.days and self.days[-1][0] == day:
            self.days.pop()   # a second commit the same day: the day's last one counts
        self.days.append((day, dict(self.downloads)))
        while self.days[0][0] < day - SERIES_DAYS - 7:
            self.days.popleft()

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

    def series(self, listed, days):
        """Downloads on each of `days`, delta-encoded per plugin (0 before a plugin was listed)."""
        # each day's snapshot: the latest one on or before it (before the history: none, so 0)
        snaps = [next((d for n, d in reversed(self.days) if n <= day), {}) for day in days]
        return {"days": days, "points": {pid: encode([snap.get(pid, 0) for snap in snaps]) for pid in listed}}

    def listed(self):
        """The plugins in today's file."""
        return [pid for pid in self.current if pid in self.first_seen]

    def timeline(self, removed):
        months = max(1, round((self.last - self.first) / (30.44 * DAY_MS)))
        listed = self.listed()
        return {
            "v": TIMELINE_VERSION, "months": months, "from": self.first, "to": self.last, "seeded": True,
            "source": "server",
            "releases": {pid: self.releases[pid] for pid in listed if self.releases.get(pid)},
            "firstSeen": {pid: self.first_seen[pid] for pid in listed},
            "series": self.series(listed, series_days(self.days[-1][0])),
            "milestoneSteps": list(MILESTONES),
            "milestones": {pid: self.milestones[pid] for pid in listed if any(x is not None for x in self.milestones[pid])},
            "removed": removed,
        }


    def delta(self, removed):
        """The changes of the last DELTA_DAYS days, for a plugin that has an older timeline.json (see mergeTimeline)."""
        last_day = self.days[-1][0]
        since = (last_day - DELTA_DAYS + 1) * DAY_MS
        listed = self.listed()
        return {
            "v": TIMELINE_VERSION, "from": since, "to": self.last,
            "releases": {pid: [m for m in self.releases[pid] if m >= since] for pid in listed if any(m >= since for m in self.releases.get(pid, []))},
            "firstSeen": {pid: self.first_seen[pid] for pid in listed if self.first_seen[pid] >= since},
            "milestones": {pid: self.milestones[pid] for pid in listed if any(x and x >= since for x in self.milestones[pid])},
            # from the day before `from`, so the first change joins on to the copy the plugin has
            "series": self.series(listed, list(range(last_day - DELTA_DAYS, last_day + 1))),
            "removed": removed,
        }


def removals(repo):
    """{id: [ms it first appeared in the removed list, reason]} for the plugins Obsidian lists as removed now."""
    since, latest = {}, []
    for ms, entries in snapshots(repo, REMOVED_FILE):
        latest = [e for e in entries if isinstance(e, dict) and e.get("id")]
        for entry in latest:
            since.setdefault(entry["id"], ms)
    return {e["id"]: [since[e["id"]], e.get("reason", "")] for e in latest}


def main(repo, out):
    started = time.time()
    history = History()
    count = 0
    for ms, stats in snapshots(repo):
        history.add(ms, stats)
        count += 1
    removed = removals(repo)
    timeline = history.timeline(removed)
    delta = history.delta(removed)
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "timeline.json").write_text(json.dumps(timeline, separators=(",", ":")))
    (out / "delta.json").write_text(json.dumps(delta, separators=(",", ":")))
    meta = {"built": int(time.time() * 1000), "to": timeline["to"], "plugins": len(timeline["firstSeen"]), "snapshots": count, "deltaFrom": delta["from"]}
    (out / "meta.json").write_text(json.dumps(meta))
    size = lambda name: (out / name).stat().st_size / 1e6
    print(f"{count} snapshots, {meta['plugins']} plugins, timeline.json {size('timeline.json'):.1f} MB, delta.json {size('delta.json'):.2f} MB, {time.time() - started:.0f} s")


if __name__ == "__main__":
    main(*sys.argv[1:3])
