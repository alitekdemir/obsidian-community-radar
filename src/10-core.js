// ─── 2. Core: pure functions ────────────────────────────────────────────────
/** @param {number} ms @returns {string} YYYY-MM-DD in local time */
function dayString(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Monday of the ISO week (UTC), used as a bucket key. */
function weekKey(ms) {
  const d = new Date(ms);
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY_MS;
  return new Date(monday).toISOString().slice(0, 10);
}

function decimal(value, digits = 1) {
  return new Intl.NumberFormat(t("locale"), { maximumFractionDigits: digits }).format(value);
}

/** 1234567 → "1,234,567" (en) / "1.234.567" (tr); missing → "–" */
function formatCount(value) {
  return value == null ? "–" : new Intl.NumberFormat(t("locale")).format(value);
}

/** 2575475 → "2.6M" / "2,6 Mn"; 354882 → "355K" / "355 bin" */
function formatShort(value) {
  if (value == null) return "–";
  const gap = t("unit.thousandSpace");
  if (value >= 1e6) return `${decimal(value / 1e6)}${t("unit.millionSpace")}${t("unit.million")}`;
  if (value >= 1e4) return `${Math.round(value / 1e3)}${gap}${t("unit.thousand")}`;
  if (value >= 1e3) return `${decimal(value / 1e3)}${gap}${t("unit.thousand")}`;
  return String(value);
}

function formatAge(ms) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return t("age.justNow");
  if (minutes < 60) return t("age.minutes", { n: minutes });
  if (minutes < 1440) return t("age.hours", { n: Math.floor(minutes / 60) });
  return t("age.days", { n: Math.floor(minutes / 1440) });
}

/** Relative date: today, yesterday, 12 days ago, 3 months ago, 1.5 years ago. */
function relativeDays(ms, now) {
  const days = Math.floor((now - ms) / DAY_MS);
  if (days <= 0) return t("rel.today");
  if (days === 1) return t("rel.yesterday");
  if (days < 60) return t("rel.days", { n: days });
  if (days < 365) return t("rel.months", { n: Math.round(days / 30) });
  return t("rel.years", { n: decimal(days / 365) });
}

/** How old a plugin is, from the day it was listed: 19 days old, 4 months old, 2.1 years old. */
function ageLabel(listed, now) {
  const days = Math.max(0, Math.floor((now - listed) / DAY_MS));
  if (days < 60) return t("age.daysOld", { n: days });
  if (days < 365) return t("age.monthsOld", { n: Math.round(days / 30) });
  return t("age.yearsOld", { n: decimal(days / 365) });
}

function historyLabel(months) {
  return months === 12 ? t("history.lastYear") : months === 24 ? t("history.last2Years") : t("history.lastMonths", { months });
}

/** Clock time for today ("14:05"), date and time before that. */
function formatTime(ms, now) {
  const sameDay = dayString(ms) === dayString(now);
  return new Date(ms).toLocaleString(t("locale"), sameDay ? { hour: "2-digit", minute: "2-digit" } : { dateStyle: "short", timeStyle: "short" });
}

/** A valid note file name derived from a plugin name. */
function safeFileName(name) {
  return name.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "") || t("untitled");
}

/** Removes Obsidian's "not manually reviewed" note from a description. */
function cleanDescription(text) {
  return String(text || "").replace(UNREVIEWED_NOTE, " ").trim().replace(/^[-\s]+|[-\s]+$/g, "");
}

/**
 * Merges the listing and the stats file into one catalog (listing order: oldest → newest).
 * @returns {{id,name,author,repo,description,downloads,updated,version}[]}
 */
function parseCatalog(listing, stats) {
  const versionOf = (stat) => {
    const tags = Object.keys(stat).filter((k) => k !== "downloads" && k !== "updated" && /\d/.test(k));
    const key = (tag) => tag.replace(/^v/i, "").split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : -1));
    return tags.sort((a, b) => {
      const [x, y] = [key(a), key(b)];
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
      }
      return 0;
    }).pop() ?? null;
  };
  return listing.filter((e) => e && e.id).map((entry) => {
    const stat = stats[entry.id];
    const hasStats = stat && typeof stat.downloads === "number";
    return {
      id: String(entry.id),
      name: String(entry.name || entry.id),
      author: String(entry.author || ""),
      repo: String(entry.repo || ""),
      description: cleanDescription(entry.description),
      downloads: hasStats ? stat.downloads : null,
      updated: hasStats && stat.updated > 0 ? stat.updated : null,
      version: hasStats ? versionOf(stat) : null,
    };
  });
}

// ─── Release history ────────────────────────────────────────────────────────
/**
 * Release history: release dates per plugin (`releases`) and the day each plugin first appeared
 * (`firstSeen`). A `firstSeen` of 0 means the plugin was already listed when the archive starts.
 */
function newTimeline(months) {
  return { v: TIMELINE_VERSION, months, from: 0, to: 0, seeded: false, releases: {}, firstSeen: {} };
}

/** Upgrades a version-1 history (no first-seen dates); listing dates need a rebuild. */
function upgradeTimeline(timeline) {
  if (timeline.v === TIMELINE_VERSION) return timeline;
  return { ...newTimeline(12), ...timeline, v: TIMELINE_VERSION, firstSeen: {}, seeded: false, legacy: true };
}

/**
 * Picks the snapshots to download: daily for the last DAILY_DAYS days, weekly before that.
 * @param {{sha:string,date:number}[]} commits  oldest first
 */
function selectSnapshots(commits, now) {
  const picked = new Map();
  for (const commit of commits) {
    const recent = now - commit.date <= DAILY_DAYS * DAY_MS;
    const key = recent ? `d${dayString(commit.date)}` : `w${weekKey(commit.date)}`;
    picked.delete(key);         // same day/week: the latest commit wins, order is kept
    picked.set(key, commit);
  }
  return [...picked.values()];
}

/** Merges one snapshot into the history (release dates + first seen); returns the new releases. */
function mergeSnapshot(timeline, stats, date) {
  const { releases, firstSeen } = timeline;
  let added = 0;
  for (const [id, stat] of Object.entries(stats)) {
    if (!(id in firstSeen)) firstSeen[id] = timeline.seeded ? date : 0;
    const moment = stat && stat.updated;
    if (!Number.isInteger(moment) || moment <= 0) continue;
    const history = releases[id] || (releases[id] = []);
    if (history[history.length - 1] === moment) continue;
    history.push(moment);
    if (history.length > RELEASES_CAP) history.splice(0, history.length - RELEASES_CAP);
    added++;
  }
  timeline.seeded = true;
  return added;
}

/** Days between the current release and the previous one; null when the previous one is unknown. */
function dormantDays(releases, plugin) {
  if (!plugin.updated) return null;
  const earlier = (releases[plugin.id] || []).filter((m) => m < plugin.updated);
  return earlier.length ? Math.floor((plugin.updated - Math.max(...earlier)) / DAY_MS) : null;
}

/**
 * Releases seen in the last `days` days.
 * shortcut: older snapshots are weekly, so several releases in one week count as one; the server's metrics (0.9.1) fix it.
 */
function releasesWithin(releases, plugin, now, days) {
  return (releases[plugin.id] || []).filter((m) => m > now - days * DAY_MS).length;
}

/** Listed within the last `days` days? Plugins without published stats count as new too. */
function isNewPlugin(firstSeen, plugin, now, days = NEW_BADGE_DAYS) {
  const seen = firstSeen[plugin.id];
  if (seen === undefined) return plugin.downloads == null;
  return seen > 0 && now - seen <= days * DAY_MS;
}

/** Released again after the day you tracked or reviewed it? */
function isChanged(plugin, note) {
  return Boolean(note && note.reviewed && plugin.updated && dayString(plugin.updated) > String(note.reviewed));
}

/**
 * Turns the search box into a test on a plugin's id, name, author and description.
 * `/…/` is a case-insensitive regex (as in Obsidian's search); otherwise every comma-separated term
 * must appear. An invalid regex matches everything and reports `error`, so the list never goes blank.
 * @returns {{test: (plugin) => boolean, regex: boolean, error: string}}
 */
function compileQuery(query) {
  const text = (p) => `${p.id} ${p.name} ${p.author} ${p.description}`;
  const pattern = String(query || "").trim().match(/^\/(.+)\/$/);
  if (pattern) {
    try {
      const re = new RegExp(pattern[1], "iu");
      return { test: (p) => re.test(text(p)), regex: true, error: "" };
    } catch (error) {
      return { test: () => true, regex: true, error: error.message };
    }
  }
  const terms = String(query || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return { test: (p) => { const hay = text(p).toLowerCase(); return terms.every((s) => hay.includes(s)); }, regex: false, error: "" };
}

/** The filter options of one tab: its own Downloads on/off and sort, shared days and thresholds. */
function modeOptions(settings, mode) {
  const defaults = TAB_DEFAULTS[mode] || TAB_DEFAULTS.all;
  const sort = settings.sortBy?.[mode] || {};
  const key = SORT_KEYS.includes(sort.key) ? sort.key : defaults.sort;
  return {
    ...settings,
    mode,
    filterDownloads: mode === "new" ? false : settings.downloadFilter?.[mode] ?? defaults.downloads,   // new plugins have few downloads
    sort: key,
    sortDir: sort.dir === "asc" || sort.dir === "desc" ? sort.dir : NATURAL_DIR[key],
  };
}

/** The filter settings a tab uses (sort and layout aren't filters). */
function filterKeys(mode) {
  return [
    "query",
    ...(mode === "new" || mode === "updated" ? ["days"] : []),
    ...(mode === "awakened" ? ["dormantDays"] : []),
    ...(mode === "updated" ? ["hideBusy"] : []),
    ...(mode !== "new" ? ["minDownloads", "downloadFilter"] : []),
  ];
}

/** The settings that put a tab's filters back to their defaults. */
function clearedFilters(settings, mode) {
  const defaults = defaultSettings();
  const { [mode]: ownDownloads, ...otherTabs } = settings.downloadFilter || {};
  return Object.fromEntries(filterKeys(mode).map((k) => [k, k === "downloadFilter" ? otherTabs : defaults[k]]));
}

/** Has a tab's filter moved off its defaults (so "Clear filters" has something to do)? */
function filtersChanged(settings, mode) {
  const cleared = clearedFilters(settings, mode);
  return Object.keys(cleared).some((k) => (k === "downloadFilter" ? mode in (settings.downloadFilter || {}) : settings[k] !== cleared[k]));
}

/** Hidden "until the next release": snoozed at a release time that the plugin hasn't passed yet. */
function isSnoozed(plugin, snoozed) {
  return snoozed != null && plugin.id in snoozed && (plugin.updated || 0) <= snoozed[plugin.id];
}

/** Does a tracked plugin pass the Tracked tab's group menu (a group, Ungrouped, Starred, New releases) and status filter? */
function trackedMatch(note, opts, plugin) {
  if (!note) return false;
  if (opts.statusEnabled && opts.trackedStatus && note.status !== opts.trackedStatus) return false;
  switch (opts.trackedGroup) {
    case "": case undefined: return true;
    case UNGROUPED: return !note.groups.length;
    case STARRED: return note.favorite;
    case UPDATES: return isChanged(plugin, note);
    default: return note.groups.includes(opts.trackedGroup);
  }
}

/**
 * Rows of the discovery view.
 * @param {object} state  {catalog, releases, firstSeen, notes: Map(id→note), excluded: Set, dismissed: Set, installed: Set, snoozed: {id: ms}}
 * @param {object} opts   {mode, days, dormantDays, newDays, hideBusy, minDownloads, filterDownloads, sort, sortDir, query, tracked…} (see modeOptions)
 */
function discover(state, opts, now) {
  const { catalog, releases, firstSeen, notes, excluded, dismissed, installed, snoozed } = state;
  const since = now - opts.days * DAY_MS;
  const query = compileQuery(opts.query);
  const minDownloads = opts.filterDownloads ? opts.minDownloads : 0;
  const shown = (p) => (p.downloads ?? 0) >= minDownloads && query.test(p);
  const base = (p) => shown(p) && !excluded.has(p.id) && !isSnoozed(p, snoozed);
  const fresh = (p) => base(p) && !notes.has(p.id);
  const sorted = (rows) => sortRows(rows, opts.sort, opts.sortDir, catalog, releases, notes);

  switch (opts.mode) {
    case "all":   // browsing: tracked plugins stay visible (with their note badge), excluded ones don't
      return sorted(catalog.filter(base));
    case "new":
      return sorted(catalog.filter((p) => fresh(p) && isNewPlugin(firstSeen, p, now, opts.days)));
    case "updated":   // new plugins have their own tab; "busy" ones would crowd out the rest
      return sorted(catalog.filter((p) => fresh(p) && p.updated >= since && !isNewPlugin(firstSeen, p, now, opts.newDays ?? NEW_BADGE_DAYS)
        && !(opts.hideBusy && releasesWithin(releases, p, now, BUSY_DAYS) > BUSY_LIMIT)));
    case "awakened":   // out of incubation (a pause ≥ dormantDays); stays as long as the pause was, up to INCUBATION_CAP
      return sorted(catalog.filter((p) => {
        const gap = dormantDays(releases, p) ?? -1;
        return fresh(p) && gap >= opts.dormantDays && now - p.updated <= Math.min(gap, INCUBATION_CAP) * DAY_MS;
      }));
    case "suggested":
      return sorted(catalog.filter((p) => base(p) && installed.has(p.id) && !dismissed.has(p.id) && !(notes.get(p.id) || {}).favorite));
    case "tracked":   // your notes: ignoring a tracked plugin doesn't hide it here
      return sorted(catalog.filter((p) => shown(p) && trackedMatch(notes.get(p.id), opts, p)));
    case "ignored":
      return sorted(catalog.filter((p) => shown(p) && (excluded.has(p.id) || isSnoozed(p, snoozed))));
    case "dismissed":
      return sorted(catalog.filter((p) => shown(p) && dismissed.has(p.id)));
    default:
      return [];
  }
}

/**
 * Sorts rows in place by `key` in direction `dir` ("asc" | "desc"; default: the key's natural one).
 * "listed" uses the position in the official listing, which is the order plugins were added.
 */
function sortRows(rows, key, dir = NATURAL_DIR[key], catalog = [], releases = {}, notes = new Map()) {
  const position = key === "listed" ? new Map(catalog.map((p, i) => [p.id, i])) : null;
  const gap = (p) => dormantDays(releases, p) ?? -1;   // no history: last
  const rating = (p) => notes.get(p.id)?.rating || 0;
  const byName = (a, b) => a.name.localeCompare(b.name, t("locale"), { sensitivity: "base" });
  const compare = {
    rating: (a, b) => rating(b) - rating(a) || (dir === "desc" ? byName(a, b) : -byName(a, b)),   // ties A→Z either way
    dormant: (a, b) => gap(b) - gap(a),
    downloads: (a, b) => (b.downloads ?? 0) - (a.downloads ?? 0),
    updated: (a, b) => (b.updated ?? 0) - (a.updated ?? 0),
    name: (a, b) => a.name.localeCompare(b.name, t("locale"), { sensitivity: "base" }),
    listed: (a, b) => (position.get(b.id) ?? -1) - (position.get(a.id) ?? -1),
  }[key] || ((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
  const sign = dir === (NATURAL_DIR[key] || "desc") ? 1 : -1;
  return rows.sort((a, b) => sign * compare(a, b));
}

/**
 * The Tracked tab's sections: one per group (a plugin in two groups shows in both), then Ungrouped.
 * Rows keep their order inside each section.
 */
function groupSections(rows, notes) {
  const sections = new Map();
  const none = [];
  for (const p of rows) {
    const groups = notes.get(p.id)?.groups || [];
    if (!groups.length) none.push(p);
    for (const g of groups) sections.set(g, [...(sections.get(g) || []), p]);
  }
  const named = [...sections].sort((a, b) => a[0].localeCompare(b[0], t("locale"))).map(([name, list]) => ({ name, rows: list }));
  return none.length ? [...named, { name: UNGROUPED, rows: none }] : named;
}

/** A stable frontmatter value for a new status label: "🧪 Deneme süreci" → "deneme-süreci". */
function statusKey(label, taken) {
  const base = label.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "status";
  let key = base;
  for (let i = 2; taken.includes(key); i++) key = `${base}-${i}`;
  return key;
}

/** A stable colour slot for a group name, so a group looks the same everywhere. */
function groupHue(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % GROUP_HUES;
}

/** Row count of every mode (for the tab badges), each with its own tab options. */
function modeCounts(state, settings, now) {
  return Object.fromEntries(MODE_KEYS.map((mode) => [mode, discover(state, modeOptions(settings, mode), now).length]));
}

