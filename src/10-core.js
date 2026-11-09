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

/** The highest milestone (1K, 10K, 100K downloads) passed within the last `days` days: {n, at}, or null. */
function recentMilestone(milestones, now, days = MILESTONE_DAYS, steps = OLD_MILESTONE_STEPS) {
  for (let i = steps.length - 1; i >= 0; i--) {
    const at = milestones?.[i];
    if (at && now - at <= days * DAY_MS) return { n: steps[i], at };
  }
  return null;
}

/** How old a plugin is, from the day it was listed: 19 days old, 4 months old, 2.1 years old. */
function ageLabel(listed, now) {
  const days = Math.max(0, Math.floor((now - listed) / DAY_MS));
  if (days < 60) return t("age.daysOld", { n: days });
  if (days < 365) return t("age.monthsOld", { n: Math.round(days / 30) });
  return t("age.yearsOld", { n: decimal(days / 365) });
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
function newTimeline() {
  return { v: TIMELINE_VERSION, from: 0, to: 0, releases: {}, firstSeen: {} };
}

/** Days between the current release and the previous one; null when the previous one is unknown. */
function dormantDays(releases, plugin) {
  if (!plugin.updated) return null;
  const earlier = (releases[plugin.id] || []).filter((m) => m < plugin.updated);
  return earlier.length ? Math.floor((plugin.updated - Math.max(...earlier)) / DAY_MS) : null;
}

/** Releases as update waves (arrays of dates): a release less than WAVE_DAYS after its wave's first one belongs to it. */
function releaseWaves(dates) {
  const waves = [];
  for (const m of dates) {
    if (waves.length && m - waves.at(-1)[0] < WAVE_DAYS * DAY_MS) waves.at(-1).push(m);   // a weekly release is still a new update
    else waves.push([m]);
  }
  return waves;
}

/** How many update waves started in (start, end]. */
function updateWaves(dates, start, end) {
  return releaseWaves(dates).filter(([first]) => first > start && first <= end).length;
}

/** The pauses between update waves, the last one open until `now`: {from, last (release of that wave), to, days, releases, open}. */
function releaseGaps(dates, now) {
  const waves = releaseWaves(dates);
  return waves.map((wave, i) => {
    const to = waves[i + 1]?.[0] ?? now;
    return { from: wave[0], last: wave.at(-1), to, days: Math.max(0, (to - wave[0]) / DAY_MS), releases: wave.length, open: i === waves.length - 1 };
  });
}

/** A length of time in the largest unit that fits: 5 days, 3 weeks, 4 months, 1.6 years. */
function spanLabel(days) {
  if (days >= YEAR_DAYS) return t("span.years", { n: decimal(days / YEAR_DAYS) });
  if (days >= 30) return t("span.months", { n: Math.round(days / 30.44) });
  if (days >= 14) return t("span.weeks", { n: Math.round(days / 7) });
  return t("span.days", { n: Math.max(1, Math.round(days)) });
}

const YEAR_DAYS = 365;

/**
 * How often a plugin updates lately: its update waves in the year up to `end` (or since its first release, when that's
 * later: a young plugin, or a busy one whose 50 kept releases span less). When the window starts at a release, its
 * wave is the starting point, not an update: n waves after it are n gaps. With no wave in a full year, `before` is
 * the rhythm up to the latest release. Null with no releases known.
 */
function releaseCadence(releases, end) {
  if (!releases?.length) return null;
  const startMs = Math.max(end - YEAR_DAYS * DAY_MS, releases[0]);
  const fromRelease = startMs === releases[0];
  const waves = updateWaves(releases, fromRelease ? startMs - 1 : startMs, end) - (fromRelease ? 1 : 0);
  const span = (end - startMs) / DAY_MS;
  const young = span < YEAR_DAYS - 1;
  const i = releases.findIndex((m) => m > startMs);
  return {
    waves, span, young, total: releases.length, releases: releases.filter((m) => m >= startMs && m <= end).length,
    days: waves ? span / waves : null,
    prevGap: i > 0 ? (releases[i] - releases[i - 1]) / DAY_MS : null,   // the pause before this window's first release
    before: waves || young || releases.length < 2 ? null : releaseCadence(releases, releases.at(-1)),
  };
}

/** The rhythm in words, by the days between waves: ~N days up to 45, ~N months up to 135, every 6 months up to 240, then yearly. */
function cadenceLabel(c) {
  if (!c.waves) return c.young ? t("details.single") : t("details.noneYear");
  if (c.days <= 45) return t("details.every", { n: Math.max(1, Math.round(c.days)) });
  if (c.days <= 135) return t("details.everyMonths", { n: Math.round(c.days / 30.44) });
  return c.days <= 240 ? t("details.halfYearly") : t("details.yearly");
}

/** The one fact under it (short, it fits the tile): the releases it counts, or the rhythm before it went quiet. */
function cadenceSub(c) {
  if (c.before) return t("details.cadenceBefore", { rhythm: cadenceLabel(c.before) });
  if (!c.waves && !c.young) return t("details.singleSub");   // quiet for a year, and only ever one release
  return c.young ? t("details.cadenceSpan", { n: c.releases, days: Math.round(c.span) }) : t("details.cadenceSub", { n: c.releases });
}

/** The sentence under the release history: updates and releases counted, the year-plus pause before them, or how long it's been quiet. */
function cadenceNote(c, last, now) {
  if (!c.waves) {
    const quiet = t("details.noteQuiet", { span: spanLabel((now - last) / DAY_MS) });
    if (c.young) return t("details.noteOneWave", { n: c.releases });
    return `${quiet} · ${c.before ? t("details.cadenceBefore", { rhythm: cadenceLabel(c.before) }) : t("details.singleSub")}`;
  }
  const count = `${t(c.young ? "details.noteSpan" : "details.noteYear", { n: c.waves, days: Math.round(c.span) })}, ${t("details.historyLabel", { n: c.releases })}`;
  return c.prevGap >= YEAR_DAYS ? `${count} · ${t("details.prevGap", { n: decimal(c.prevGap / YEAR_DAYS) })}` : count;
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
function compileQuery(query, state = null, now = Date.now()) {
  if (isAdvancedQuery(String(query || ""))) {   // the query language (16-query.js)
    try {
      const q = parseQuery(String(query));
      return { test: (p) => !state || q.test(state, p, now), order: q.order, clauses: q.clauses, free: q.free, spans: q.spans, advanced: true, regex: false, error: "" };
    } catch (error) {
      if (!(error instanceof QueryError)) throw error;
      const bad = { from: error.from, to: error.to, kind: "bad" };
      return { test: () => true, advanced: true, regex: false, error: error.message, at: error.at ?? 0, spans: [...(error.spans || []), bad] };
    }
  }
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

/**
 * Filters any tab can add with "+ Filter", beyond its own: how the value is set (a number with presets, text, or
 * just on), its starting value, the tabs that already have it, and the test on a plugin.
 */
const EXTRA_FILTERS = {
  released: { icon: "clock", kind: "number", unit: "days", presets: DAY_PRESETS, value: 30, skip: ["new", "updated"],
    test: (s, p, n, now) => (p.updated || 0) >= now - n * DAY_MS },
  gap: { icon: "egg", kind: "number", unit: "days", presets: DORMANT_PRESETS, value: 60, skip: ["awakened"],
    test: (s, p, n) => (dormantDays(s.releases, p) ?? -1) >= n },
  growth: { icon: "trending-up", kind: "number", presets: [100, 1000, 10000], value: 1000,
    test: (s, p, n) => (s.growth?.[p.id]?.[1] ?? 0) >= n },
  age: { icon: "cake", kind: "number", unit: "days", presets: [7, 30, 90, 365], value: 30, skip: ["new"],
    test: (s, p, n, now) => s.firstSeen[p.id] > 0 && now - s.firstSeen[p.id] <= n * DAY_MS },
  author: { icon: "user", kind: "text", value: "",
    test: (s, p, text) => String(p.author || "").toLowerCase().includes(String(text).trim().toLowerCase()) },
  installed: { icon: "package-check", kind: "toggle", value: true, skip: ["suggested"],
    test: (s, p) => s.installed.has(p.id) },
};

/** The filters a tab can still add (not its own, not added yet). */
function addableFilters(settings, mode) {
  const added = settings.extraFilters?.[mode] || {};
  return Object.keys(EXTRA_FILTERS).filter((k) => !(k in added) && !EXTRA_FILTERS[k].skip?.includes(mode));
}

/**
 * The table layout's columns besides Name: how a cell reads (`text`; favorite and rating are buttons the view
 * draws), its alignment, and the sort key a click on its header picks.
 */
const TABLE_COLUMNS = {
  downloads: { align: "right", sort: "downloads", text: (s, p) => formatCount(p.downloads) },
  updated: { sort: "updated", text: (s, p, now) => (p.updated ? relativeDays(p.updated, now) : "–") },
  favorite: { align: "center" },
  rating: { sort: "rating" },
  growth30: { align: "right", sort: "growth30", text: (s, p) => gainText(s.growth?.[p.id]?.[1]) },
  growth7: { align: "right", sort: "growth7", text: (s, p) => gainText(s.growth?.[p.id]?.[0]) },
  author: { text: (s, p) => p.author || "" },
  gap: { align: "right", sort: "dormant", text: (s, p) => { const n = dormantDays(s.releases, p); return n == null ? "–" : t("filter.days", { n }); } },
  age: { sort: "listed", text: (s, p, now) => (s.firstSeen[p.id] > 0 ? ageLabel(s.firstSeen[p.id], now) : "–") },
  cadence: { text: (s, p, now) => { const c = releaseCadence(s.releases[p.id], now); return c ? cadenceLabel(c) : "–"; } },
  groups: { text: (s, p) => (s.notes.get(p.id)?.groups || []).join(", ") },
  description: { text: (s, p) => p.description || "" },
};
const TABLE_DEFAULT = ["downloads", "updated", "favorite"];
const gainText = (n) => (n == null ? "–" : `+${formatCount(n)}`);

/** The table's columns on a tab: yours (shown, in your order) or the default few. */
function tableColumns(settings, mode) {
  const mine = settings.tableColumns?.[mode];
  return (Array.isArray(mine) ? mine : TABLE_DEFAULT).filter((k) => TABLE_COLUMNS[k]);
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
    extras: settings.extraFilters?.[mode] || {},
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
    ...(mode === "tracked" ? ["trackedGroup", "trackedStatus"] : []),
    ...(mode !== "new" ? ["minDownloads", "downloadFilter"] : []),
    "extraFilters",
  ];
}

/** The settings that put a tab's filters back to their defaults. */
function clearedFilters(settings, mode) {
  const defaults = defaultSettings();
  const without = (byTab) => { const { [mode]: own, ...others } = byTab || {}; return others; };   // only this tab's entry goes
  const perTab = { downloadFilter: without(settings.downloadFilter), extraFilters: without(settings.extraFilters) };
  return Object.fromEntries(filterKeys(mode).map((k) => [k, k in perTab ? perTab[k] : defaults[k]]));
}


/**
 * How many of a tab's filters you changed from their defaults (the search included): what ✕ would undo.
 * A tab's own defaults (Updated's 14 days, Incubation's 60) aren't counted; they are what the tab is.
 */
function changedFilters(settings, mode) {
  return changedFilterKeys(settings, mode).length;
}

/** The changed filters by name ("downloadFilter" stands for the threshold and its switch; an added filter is "extra.<name>"). */
function changedFilterKeys(settings, mode) {
  const cleared = clearedFilters(settings, mode);
  const own = Object.keys(cleared).filter((k) => k !== "extraFilters"
    && (k === "downloadFilter" ? mode in (settings.downloadFilter || {}) : settings[k] !== cleared[k]));
  const extras = Object.keys(settings.extraFilters?.[mode] || {}).map((k) => `extra.${k}`);
  return [...new Set(own.map((k) => (k === "minDownloads" ? "downloadFilter" : k))), ...extras];
}

/** What the Filters head says on hover: each changed filter as it is now, and what ✕ does. */
function filterSummary(settings, mode) {
  const keys = changedFilterKeys(settings, mode);
  if (!keys.length) return t("filter.tipNone");
  const opts = modeOptions(settings, mode);
  const line = {
    query: () => t("filter.tipSearch", { q: settings.query.trim() }),
    days: () => `${t("filter.last")} ${t("filter.days", { n: settings.days })}`,
    dormantDays: () => `${t("filter.gap")} ${t("filter.days", { n: settings.dormantDays })}`,
    hideBusy: () => t(settings.hideBusy ? "filter.tipBusyHidden" : "filter.tipBusyShown"),
    trackedGroup: () => t("filter.tipGroup"),
    trackedStatus: () => t("filter.tipStatus"),
    downloadFilter: () => (opts.filterDownloads ? `${t("filter.downloads")} ${formatCount(settings.minDownloads)}` : t("filter.tipDownloadsOff")),
  };
  const extra = (k) => `${t(`filter.x.${k}`)} ${extraValueText(k, opts.extras[k])}`.trim();
  return [t("filter.tipChanged"), ...keys.map((k) => `• ${k.startsWith("extra.") ? extra(k.slice(6)) : line[k]()}`), t("filter.tipClear")].join("\n");
}

/** An added filter's value as the chip shows it: "30 days", "1,000", the author typed; nothing for an on/off one. */
function extraValueText(key, value) {
  const filter = EXTRA_FILTERS[key];
  if (filter.kind === "toggle") return "";
  if (filter.kind === "text") return String(value);
  return filter.unit === "days" ? t("filter.days", { n: value }) : formatCount(value);
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
  const query = compileQuery(opts.query, state, now);
  const minDownloads = opts.filterDownloads ? opts.minDownloads : 0;
  const extras = Object.entries(opts.extras || {}).filter(([k]) => EXTRA_FILTERS[k]);
  const shown = (p) => (p.downloads ?? 0) >= minDownloads && query.test(p) && extras.every(([k, v]) => EXTRA_FILTERS[k].test(state, p, v, now));
  const base = (p) => shown(p) && !excluded.has(p.id) && !isSnoozed(p, snoozed);
  const fresh = (p) => base(p) && !notes.has(p.id);
  const { key: sortKey, dir: sortDir } = query.order || { key: opts.sort, dir: opts.sortDir };   // `order by` wins over the tab's sort
  const sorted = (rows) => sortRows(rows, sortKey, sortDir, catalog, releases, notes, state.growth);

  switch (opts.mode) {
    case "all":   // browsing: tracked plugins stay visible (with their note badge), excluded ones don't
      return sorted(catalog.filter(base));
    case "new":
      return sorted(catalog.filter((p) => fresh(p) && isNewPlugin(firstSeen, p, now, opts.days)));
    case "updated":   // new plugins have their own tab; "busy" ones would crowd out the rest
      return sorted(catalog.filter((p) => fresh(p) && p.updated >= since && !isNewPlugin(firstSeen, p, now, opts.newDays ?? NEW_BADGE_DAYS)
        && !(opts.hideBusy && updateWaves(releases[p.id] || [], now - BUSY_DAYS * DAY_MS, now) > BUSY_LIMIT)));
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
function sortRows(rows, key, dir = NATURAL_DIR[key], catalog = [], releases = {}, notes = new Map(), growth = {}) {
  const position = key === "listed" ? new Map(catalog.map((p, i) => [p.id, i])) : null;
  const gap = (p) => dormantDays(releases, p) ?? -1;   // no history: last
  const rating = (p) => notes.get(p.id)?.rating || 0;
  const gained = (p) => growth[p.id]?.[GROWTH_INDEX[key]] ?? -1;   // no server data: last
  const byName = (a, b) => a.name.localeCompare(b.name, t("locale"), { sensitivity: "base" });
  const compare = {
    rating: (a, b) => rating(b) - rating(a) || (dir === "desc" ? byName(a, b) : -byName(a, b)),   // ties A→Z either way
    dormant: (a, b) => gap(b) - gap(a),
    downloads: (a, b) => (b.downloads ?? 0) - (a.downloads ?? 0),
    growth7: (a, b) => gained(b) - gained(a),
    growth30: (a, b) => gained(b) - gained(a),
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

