"use strict";
/*
 * Community Radar — discover community plugins, spot the ones that woke up after a long pause,
 * and track the ones you care about as notes. Plain JavaScript; scripts/build.js only embeds
 * locales/*.json into the main.js that Obsidian loads.
 *
 * Layers (each depends only on the ones above it):
 *   1. Constants and i18n
 *   2. Core: pure functions (dates, text, catalog, release history, discovery, README, translation)
 *   3. Services: GitHub client, cache, notes, translator
 *   4. UI: modals, discovery view, settings tab
 *   5. Plugin class: wires everything together
 */
const obsidian = require("obsidian");
const {
  Plugin, ItemView, Modal, Notice, Scope, SuggestModal, PluginSettingTab, Setting,
  TFile, TFolder, Menu, addIcon, normalizePath, requestUrl, setIcon,
} = obsidian;

// ─── 1. Constants ───────────────────────────────────────────────────────────
const VIEW_TYPE = "plugin-radar-view";
const ICON = "plugin-radar";
// Other ids the plugin ran under, newest first: "community-radar" (0.5.2 only), "plugin-discovery-tracker" (private "Eklenti Takip").
const LEGACY_PLUGIN_IDS = ["community-radar", "plugin-discovery-tracker"];
const REPO = "obsidianmd/obsidian-releases";
const STATS_FILE = "community-plugin-stats.json";
const RAW = "https://raw.githubusercontent.com";
const LISTING_URL = `${RAW}/${REPO}/HEAD/community-plugins.json`;
const STATS_URL = `${RAW}/${REPO}/HEAD/${STATS_FILE}`;
const COMMITS_API = `https://api.github.com/repos/${REPO}/commits`;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30.44 * DAY_MS;
const HISTORY_MONTHS = [3, 6, 12, 24];
const DAILY_DAYS = 30;             // snapshots are daily for this many days, weekly before that
const RELEASES_CAP = 50;           // release dates kept per plugin
const NEW_BADGE_DAYS = 30;         // ✨ badge: listed within this many days
const PARALLEL = 4;                // snapshots downloaded at once
const SYNC_HOURS = [0, 6, 24, 168]; // sync frequency choices; 0 = manual
const SYNC_CHECK_MS = 30 * 60_000;   // how often the plugin checks whether a sync is due (no network)
const README_MODES = ["open", "sync", "manual"];
const PAGE_SIZE = 50;
const AI_BATCH = 50;               // plugins per group-suggestion request
const AI_GROUPS = 10;              // group suggestions asked per plugin
const SIMILAR_LIMIT = 8;
const VISIBLE_SUGGESTIONS = 5;     // AI chips shown before "+n more"
/** Keyboard shortcuts of the view (when enabled in settings): keys → help text key. */
const KEY_HELP = [
  [["j", "k"], "keys.move"], [["f"], "keys.star"], [["g"], "keys.groups"], [["x"], "keys.ignore"],
  [["h"], "keys.snooze"], [["t"], "keys.translate"], [["r"], "keys.readme"], [["s"], "keys.similar"],
  [["o"], "keys.open"], [["Enter"], "keys.expand"], [["1", "…", "5"], "keys.rate"], [["0"], "keys.unrate"],
];
const MIN_SIMILARITY = 5;          // summed rarity of shared words; ~one rare word or two common ones
const SIMILAR_LIST = 30;           // results in the Similar list (the strip under a row shows SIMILAR_PREVIEW)
const SIMILAR_PREVIEW = 3;
const NAME_WEIGHT = 2;             // a word in the name counts as much as two in the description
const BM25_K1 = 1.2;               // BM25: how fast repeating a term stops adding
const BM25_B = 0.75;               // BM25: how much a long description is evened out
const MMR_LAMBDA = 0.75;           // relevance vs. variety when picking similar plugins
const WORD_SHARE = 0.03;           // semantic Similar: how much the best word match adds to a cosine (~0.85–0.97)
// Semantic vectors of every plugin's name and description, rebuilt daily by .github/workflows/embeddings.yml
const VECTORS_URL = `${RAW}/alitekdemir/obsidian-community-radar/embeddings/granite-311m`;
const TIMELINE_VERSION = 2;        // 2: first-seen dates added

// Obsidian comments (%% %%) stay hidden in Live Preview and Reading view.
const README_START = "%% community-radar:readme-start %%";
const README_END = "%% community-radar:readme-end %%";
// Markers before 0.6.1 (HTML comments show up in Live Preview); notes are migrated once.
const README_TR_START = "%% community-radar:readme-translation-start %%";   // the README in your language (on request)
const README_TR_END = "%% community-radar:readme-translation-end %%";
const README_CHUNK = 8000;         // characters of README per translation request (fits a 4096-token reply)
const LEGACY_README_START = "<!-- plugin-tracker:readme-start -->";
const LEGACY_README_END = "<!-- plugin-tracker:readme-end -->";
const UNREVIEWED_NOTE = /\s*-?\s*This plugin has not been manually reviewed by Obsidian staff\.?\s*/gi;

const MODE_KEYS = ["all", "new", "updated", "awakened", "tracked", "suggested"];
const LIST_MODES = ["ignored", "dismissed"];   // reached from the ⋮ menu and settings, not from a tab
const SIMILAR_MODE = "similar";                // reached from a row's Similar link
const SORT_KEYS = ["downloads", "updated", "name", "listed", "dormant", "rating"];
const SIMILAR_SORT_KEYS = ["relevance", "downloads", "updated", "name", "listed"];
const NATURAL_DIR = { downloads: "desc", updated: "desc", name: "asc", listed: "desc", dormant: "desc", rating: "desc" };
// Tracked tab "group" filters besides real groups; the \u0000 prefix can't clash with a group name
const UNGROUPED = "\u0000ungrouped";
const UPDATES = "\u0000updates";     // tracked plugins with a release since you reviewed them
const STARRED = "\u0000starred";
const DEFAULT_STATUSES = ["to-try", "watching", "testing", "adopted", "replaced"];   // labels come from the locale
const LEGACY_STATUS = { candidate: "to-try", trying: "testing", using: "adopted", dropped: "replaced" };   // 0.7.1–0.7.2
const GROUP_HUES = 8;
const DAY_PRESETS = [1, 3, 7, 14, 30, 60, 90];
const DORMANT_PRESETS = [30, 60, 90, 180, 365];
/** Per tab: is "Downloads ≥" on, and how rows are sorted, until the user changes them. */
const TAB_DEFAULTS = {
  all: { downloads: true, sort: "downloads" },
  new: { downloads: false, sort: "listed" },        // a brand-new plugin has few downloads
  updated: { downloads: true, sort: "downloads" },
  awakened: { downloads: true, sort: "downloads" },
  changed: { downloads: false, sort: "updated" },
  suggested: { downloads: false, sort: "downloads" },
  tracked: { downloads: false, sort: "rating" },
  ignored: { downloads: false, sort: "name" },
  dismissed: { downloads: false, sort: "name" },
};

/** Suggested names in Obsidian's keychain (ANTHROPIC_API_KEY → anthropic-api-key). */
const KEY_NAMES = {
  anthropic: "anthropic-api-key",
  openai: "openai-api-key",
  gemini: "gemini-api-key",
  openrouter: "openrouter-api-key",
};

/** Radar: two range rings, a sweep line and a blip. Drawn on Lucide's 24-unit grid, scaled to Obsidian's 100. */
const ICON_SVG = `<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M4 4a16 16 0 0 1 16 16"/><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 20 14.5 9.5"/>
<circle cx="4" cy="20" r="1.6" fill="currentColor" stroke="none"/><circle cx="16.5" cy="14" r="2" fill="currentColor" stroke="none"/></g>`;

// ─── i18n ───────────────────────────────────────────────────────────────────
/**
 * UI strings, one table per language, filled at build time from locales/*.json (see scripts/build.js).
 * Values are text with {placeholders}; plural text is {one, other, …} picked by Intl.PluralRules on {n}.
 */
const STRINGS = /* LOCALES */ {};

let language = "en";

/** The locale for a code like "tr", "pt-BR" or "en-gb": exact match, then same base language, then English. */
function matchLanguage(code) {
  const wanted = String(code || "").toLowerCase();
  const codes = Object.keys(STRINGS);
  return codes.find((c) => c.toLowerCase() === wanted)
    || codes.find((c) => wanted && wanted.split("-")[0] === c.toLowerCase().split("-")[0])
    || "en";
}

function setLanguage(code) {
  language = matchLanguage(code);
  return language;
}

/** Obsidian's own UI language. */
function obsidianLanguage() {
  return obsidian.moment?.locale?.() || globalThis.localStorage?.getItem?.("language") || "en";
}

/** Looks up a UI string (falling back to English, then to the key) and fills its {placeholders}. */
function t(key, vars = {}) {
  let value = STRINGS[language]?.[key] ?? STRINGS.en[key] ?? key;
  if (typeof value === "object") value = value[new Intl.PluralRules(t("locale")).select(Number(vars.n))] ?? value.other;
  return value.replace(/\{(\w+)\}/g, (all, name) => (name in vars ? String(vars[name]) : all));
}

function defaultSettings() {
  return {
    folder: t("default.folder"),
    mode: "awakened",
    days: 14,
    dormantDays: 90,
    minDownloads: 100,
    downloadFilter: {},   // tab → on/off; missing tabs use TAB_DEFAULTS
    trackedGroup: "",     // Tracked tab: "" = all, a group name, or UNGROUPED
    trackedSections: true,
    trackedStatus: "",
    statusEnabled: false,  // the status field is optional; its values stay in the notes when it's off
    statuses: DEFAULT_STATUSES.map((key) => ({ key, label: t(`statusDefault.${key}`) })),
    sortBy: {},           // tab → {key, dir}; missing tabs use TAB_DEFAULTS
    query: "",
    historyMonths: 12,
    provider: "",
    model: "",
    modelPrice: "",
    keyNames: {},
    targetLang: t("language.name"),
    language: "auto",
    syncHours: 24,        // 0 = manual
    readmeMode: "open",   // open | sync | manual
    keyboard: false,      // single-letter shortcuts in the view
    similarTrail: [],     // Similar list: the plugins you came through; the last one's matches are shown
    similarFrom: "all",   // the tab the trail's first step returns to from the Similar list
    similarSort: { key: "relevance", dir: "desc" },
    layout: "list",           // "list" or "cards"
    notesHeading: "",         // heading above your own notes in new tracking notes; "" = "My notes" in the UI language
    readmeTranslation: "ask", // "ask": README in your language on request (details window, command); "off"
  };
}

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
 * @param {object} opts   {mode, days, dormantDays, minDownloads, filterDownloads, sort, sortDir, query, tracked…} (see modeOptions)
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
    case "updated":
      return sorted(catalog.filter((p) => fresh(p) && p.updated >= since));
    case "awakened":
      return sorted(catalog.filter((p) => fresh(p) && p.updated >= since && (dormantDays(releases, p) ?? -1) >= opts.dormantDays));
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

// ─── README and note body ───────────────────────────────────────────────────
/** What Obsidian treats as a tag: letters/digits/_-/ with at least one non-digit (`#123` is not a tag). */
const TAG = /(^|[\s>(])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

/** Escapes `#tags` and `[[links]]` in plain text; invisible in reading view. */
function escapeText(text) {
  return text
    .replace(TAG, (match, before, tag, offset) =>
      (before === "(" && text[offset - 1] === "]" ? match : `${before}\\#${tag}`))  // `](#section)` is a link target
    .replace(/\[\[/g, "\\[\\[");
}

/** Code blocks (indented ones too) and inline code are left untouched. */
function escapeOutsideCode(markdown) {
  let fence = null;
  return markdown.split("\n").map((line) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return line;
    }
    if (marker) { fence = marker[1]; return line; }
    if (/^( {4}|\t)/.test(line) && !/^\s*([-*+]|\d+[.)])\s/.test(line)) return line;  // indented code
    return line.split(/(`+[^`]*`+)/).map((chunk, i) => (i % 2 ? chunk : escapeText(chunk))).join("");
  }).join("\n");
}

/** An image on a GitHub page (`github.com/o/r/blob/…`) → the file itself; other URLs unchanged. */
function rawImage(url) {
  return url.replace(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\//i, `${RAW}/$1/`);
}

/** Points images on GitHub pages to the files in notes written before 0.8.1; touches no link. */
function migrateImages(content) {
  return content
    .replace(/(!\[[^\]]*\]\(\s*<?)([^)\s>]+)/g, (all, head, url) => head + rawImage(url))
    .replace(/(<img\b[^>]*?\bsrc=)(["'])([^"']+)\2/gi, (all, head, q, url) => `${head}${q}${rawImage(url)}${q}`);
}

/** Points relative images and links to GitHub; images on a GitHub page (`/blob/`) to the file itself. */
function absolutizeLinks(markdown, repo) {
  const rawBase = `${RAW}/${repo}/HEAD/`;
  const blobBase = `https://github.com/${repo}/blob/HEAD/`;
  const isRelative = (url) => url && !/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url);
  const join = (base, url) => base + url.replace(/^\.?\//, "");
  const image = (url) => isRelative(url) ? join(rawBase, url) : rawImage(url);
  return markdown
    .replace(/(!?)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?((?:\s+"[^"]*")?)\s*\)/g, (all, bang, text, url, title) =>
      bang ? `![${text}](${image(url)}${title})` : isRelative(url) ? `[${text}](${join(blobBase, url)}${title})` : all)
    .replace(/(<img\b[^>]*?\bsrc=)(["'])([^"']+)\2/gi, (all, head, q, url) => `${head}${q}${image(url)}${q}`)
    .replace(/(<a\b[^>]*?\bhref=)(["'])([^"']+)\2/gi, (all, head, q, url) =>
      isRelative(url) ? `${head}${q}${join(blobBase, url)}${q}` : all);
}

/** The README section of a note, markers included. */
function readmeSection(readme, plugin, now) {
  const version = plugin.version ? `v${plugin.version}` : t("readme.noVersion");
  const meta = t("readme.meta", { repo: plugin.repo, version, date: dayString(now) });
  const body = readme == null ? t("readme.failed") : escapeOutsideCode(absolutizeLinks(readme.trim(), plugin.repo));
  return `${README_START}\n${meta}\n\n${body}\n${README_END}`;
}

/** The README text inside a note (between the markers, without its "README · repo · version" line); null if none. */
function readmeText(content) {
  const a = content.indexOf(README_START);
  const b = content.indexOf(README_END);
  if (a === -1 || b < a) return null;
  const inner = content.slice(a + README_START.length, b).trim();
  return inner.split("\n").slice(1).join("\n").trim() || null;
}

/** The note's README translation: {version, body} (version: the README it was made from) or null. */
function readmeTranslation(content) {
  const a = content.indexOf(README_TR_START);
  const b = content.indexOf(README_TR_END);
  if (a === -1 || b < a) return null;
  const [meta, ...body] = content.slice(a + README_TR_START.length, b).trim().split("\n");
  return { version: meta.match(/· v(\S+) ·/)?.[1] ?? null, body: body.join("\n").trim() };
}

/** Puts the translation section in the note: replaces the old one, or goes right above the original README. */
function replaceReadmeTranslation(content, section, heading) {
  const block = `${README_TR_START}\n${section}\n${README_TR_END}`;
  const a = content.indexOf(README_TR_START);
  const b = content.indexOf(README_TR_END);
  if (a !== -1 && b > a) return content.slice(0, a) + block + content.slice(b + README_TR_END.length);
  const insert = `# ${heading}\n${block}\n\n`;
  const at = content.search(/^# README[ \t]*$/m);
  if (at !== -1) return content.slice(0, at) + insert + content.slice(at);
  const start = content.indexOf(README_START);
  return start !== -1 ? content.slice(0, start) + insert + content.slice(start) : `${content.trimEnd()}\n\n${insert}`;
}

/** A README cut before headings into requests of at most `max` characters (a longer section stays whole). */
function markdownChunks(markdown, max = README_CHUNK) {
  const chunks = [];
  let current = "";
  for (const part of markdown.split(/\n(?=#{1,3} )/)) {
    if (current && current.length + part.length + 1 > max) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n${part}` : part;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Rough request size of translating `text`: tokens in and out (~4 characters a token), and the cost when the price is known. */
function translationEstimate(text, price) {
  const tokens = Math.ceil(text.length / 4);
  const cost = price ? (tokens * (price.input || 0) + tokens * 1.2 * (price.output || 0)) / 1e6 : null;
  return { chars: text.length, tokens: tokens * 2, cost };
}

function readmePrompt(markdown, targetLanguage) {
  return [
    `Translate this part of an Obsidian plugin's README (Markdown) into ${targetLanguage}.`,
    "Keep the Markdown exactly: headings, lists, tables, links, image URLs and HTML tags.",
    "Don't translate code blocks, inline code, commands, settings keys or product names.",
    "Reply with ONLY the translated Markdown, nothing before or after it.",
    "",
    markdown,
  ].join("\n");
}

/** Typical days between releases (median of the gaps in the history); null with fewer than three releases. */
function releaseCadence(releases) {
  if (!releases || releases.length < 3) return null;
  const gaps = releases.slice(1).map((m, i) => (m - releases[i]) / DAY_MS).sort((a, b) => a - b);
  return Math.max(1, Math.round(gaps[Math.floor(gaps.length / 2)]));
}

/** Version the note's README was fetched for ("1.2.0"), read from its meta line; null when unknown. */
function readmeVersion(content) {
  const start = content.indexOf(README_START);
  if (start === -1) return null;
  const meta = content.slice(start + README_START.length).trimStart().split("\n", 1)[0];
  return meta.match(/· v(\S+) ·/)?.[1] ?? null;
}

/** Replaces the README section; appends one when the markers are missing. Nothing else is touched. */
function replaceReadme(content, section) {
  const start = content.indexOf(README_START);
  const end = content.indexOf(README_END, start);
  if (start === -1 || end === -1) return `${content.replace(/\s*$/, "")}\n\n# README\n${section}\n`;
  return content.slice(0, start) + section + content.slice(end + README_END.length);
}

/** What a sync brought: plugins that weren't in the previous catalog, and plugins with a newer release. */
function catalogDelta(before, after) {
  const previous = new Map(before.map((p) => [p.id, p]));
  let added = 0;
  let updated = 0;
  for (const p of after) {
    const old = previous.get(p.id);
    if (!old) added++;
    else if (p.updated && p.updated > (old.updated || 0)) updated++;
  }
  return { added, updated };
}

/** Body of a new tracking note (properties are written separately with processFrontMatter). */
function noteBody(plugin, heading = t("note.myNotes")) {
  return `${plugin.description || ""}\n\n# ${heading}\n\n\n# README\n${README_START}\n${README_END}\n`;
}

/** Turns the H2 headings of 0.1 notes into H1; touches no other line. */
function migrateHeadings(content) {
  return content
    .replace(/^## Notlarım[ \t]*$/m, "# Notlarım")
    .replace(/^## README[ \t]*\n(?=<!-- plugin-tracker:readme-start -->)/m, "# README\n");
}

/** Swaps the README markers of notes made before 0.6.1 for hidden Obsidian comments. */
function migrateMarkers(content) {
  return content.replace(LEGACY_README_START, README_START).replace(LEGACY_README_END, README_END);
}

/** The Bases file listing the tracking notes in `folder` (written by "Create / reset Bases view"). */
function baseFile(folder) {
  const q = JSON.stringify;  // a JSON string is a valid YAML string
  const links = ["obsidian", "github"];
  const view = (name, extra, columns) => [
    "  - type: table",
    `    name: ${q(name)}`,
    ...extra,
    "    order:",
    ...["file.name", ...columns, ...links].map((c) => `      - ${c}`),
  ];
  return [
    "filters:",
    "  and:",
    `    - file.inFolder(${q(folder)})`,
    "views:",
    ...view(t("base.all"), [], ["groups", "favorite", "status", "rating", "note", "downloads", "version", "updated", "reviewed"]),
    ...view(t("base.starred"), ["    filters:", "      and:", "        - favorite == true"], ["groups", "status", "rating", "note", "downloads", "updated"]),
    ...view(t("base.ungrouped"), ["    filters:", "      and:", "        - groups.isEmpty()"], ["favorite", "note", "downloads", "updated"]),
    "",
  ].join("\n");
}

/** Properties that come from the catalog; refreshed on every data refresh. */
function sourceFields(plugin) {
  return {
    downloads: plugin.downloads ?? null,
    version: plugin.version ?? null,
    updated: plugin.updated ? dayString(plugin.updated) : null,
    obsidian: `[plugin](obsidian://show-plugin?id=${encodeURIComponent(plugin.id)})`,
    github: plugin.repo ? `[github](https://github.com/${plugin.repo})` : null,
  };
}

/** A note's groups: the `groups` list, plus a 0.6-style `group` text until it's migrated. */
function groupsOf(fm) {
  const raw = [...(Array.isArray(fm.groups) ? fm.groups : fm.groups ? [fm.groups] : []), ...(fm.group ? [fm.group] : [])];
  return uniqueNames(raw.map((g) => String(g ?? "")));
}

/** The same names, in any order. */
function sameNames(a, b) {
  return a.length === b.length && a.every((n) => b.includes(n));
}

/** Trimmed, non-empty names without case-insensitive duplicates; the first spelling wins. */
function uniqueNames(names) {
  const seen = new Set();
  return names.map((n) => n.replace(/\s+/g, " ").trim()).filter((n) => {
    const key = n.toLocaleLowerCase();
    if (!n || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Tracking record from a note's frontmatter (only notes with `plugin_id`). */
function noteFromFrontmatter(path, fm) {
  if (!fm || !fm.plugin_id) return null;
  return {
    path,
    id: String(fm.plugin_id),
    groups: groupsOf(fm),
    favorite: fm.favorite === true,
    status: typeof fm.status === "string" ? fm.status.trim() : "",   // shown only if it's one of your statuses
    rating: Number.isInteger(fm.rating) && fm.rating >= 1 && fm.rating <= 5 ? fm.rating : 0,
    note: fm.note ? String(fm.note) : "",
    reviewed: fm.reviewed ? String(fm.reviewed).slice(0, 10) : "",
    updated: fm.updated ? String(fm.updated).slice(0, 10) : "",
  };
}

// ─── Translation providers (pure: build requests, parse replies) ────────────
/**
 * Each provider: chat request, reply text, model-list request and model entries.
 * The key always travels in a header, never in the URL (so it never shows up in logs).
 */
const PROVIDERS = {
  anthropic: {
    label: "Claude (Anthropic)",
    chat: (model, key, prompt) => ({
      url: "https://api.anthropic.com/v1/messages",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: { model, max_tokens: 4096, messages: [{ role: "user", content: prompt }] },
    }),
    text: (json) => (json.content || []).map((part) => part.text || "").join(""),
    models: (key) => ({ url: "https://api.anthropic.com/v1/models?limit=100", headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } }),
    modelList: (json) => (json.data || []).map((m) => ({ id: m.id, price: null })),
  },
  openai: {
    label: "OpenAI",
    chat: (model, key, prompt) => ({
      url: "https://api.openai.com/v1/chat/completions",
      headers: { Authorization: `Bearer ${key}` },
      body: { model, messages: [{ role: "user", content: prompt }] },
    }),
    text: (json) => json.choices?.[0]?.message?.content || "",
    models: (key) => ({ url: "https://api.openai.com/v1/models", headers: { Authorization: `Bearer ${key}` } }),
    modelList: (json) => (json.data || []).filter((m) => /^(gpt|o\d|chatgpt)/.test(m.id)).map((m) => ({ id: m.id, price: null })),
  },
  gemini: {
    label: "Gemini (Google)",
    chat: (model, key, prompt) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      headers: { "x-goog-api-key": key },
      body: { contents: [{ parts: [{ text: prompt }] }] },
    }),
    text: (json) => (json.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join(""),
    models: (key) => ({ url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", headers: { "x-goog-api-key": key } }),
    modelList: (json) => (json.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => ({ id: m.name.replace(/^models\//, ""), price: null })),
  },
  openrouter: {
    label: "OpenRouter",
    chat: (model, key, prompt) => ({
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: { Authorization: `Bearer ${key}` },
      body: { model, messages: [{ role: "user", content: prompt }] },
    }),
    text: (json) => json.choices?.[0]?.message?.content || "",
    models: (key) => ({ url: "https://openrouter.ai/api/v1/models", headers: { Authorization: `Bearer ${key}` } }),
    modelList: (json) => (json.data || []).map((m) => ({ id: m.id, price: tokenPrice(m.pricing) })),
  },
};

/** OpenRouter price (USD per token, as text) → {input, output} per 1M tokens; null if unreadable. */
function tokenPrice(pricing) {
  const input = Number(pricing?.prompt) * 1e6;
  const output = Number(pricing?.completion) * 1e6;
  return Number.isFinite(input) && Number.isFinite(output) ? { input, output } : null;
}

/** "$0.30 / $2.50 · 1M tokens" (input / output); free models say so. */
function formatPrice(price) {
  if (!price) return "";
  if (!price.input && !price.output) return t("model.free");
  const usd = (n) => `$${new Intl.NumberFormat(t("locale"), { minimumFractionDigits: n < 10 ? 2 : 1, maximumFractionDigits: n < 10 ? 2 : 1 }).format(n)}`;
  return `${usd(price.input)} / ${usd(price.output)} · ${t("price.unit")}`;
}

/**
 * Model picker suggestions: every space-separated term must appear in the id. A typed name that
 * isn't listed is offered first, so aliases such as `~google/gemini-flash-latest` can be used.
 */
function filterModels(models, query, latestOnly) {
  const typed = query.trim();
  const terms = typed.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = models.filter((m) => (!latestOnly || m.id.includes("latest"))
    && terms.every((term) => m.id.toLowerCase().includes(term)));
  const exact = models.some((m) => m.id === typed);
  return typed && !exact && !/\s/.test(typed) ? [{ id: typed, price: null, custom: true }, ...matches] : matches;
}

/** Batch translation prompt: several descriptions in one request, answered as a JSON array. */
function translationPrompt(texts, targetLanguage) {
  return [
    `Translate each of the following Obsidian plugin descriptions into ${targetLanguage}.`,
    "Keep product names, code and technical terms (Markdown, Canvas, Bases, API…) as they are.",
    "Reply with ONLY a JSON array of strings, same length and same order as the input. No commentary.",
    "",
    JSON.stringify(texts),
  ].join("\n");
}

/** Extracts the translations from the model's reply (code fences and surrounding text are tolerated). */
function parseTranslations(reply, expected) {
  const start = reply.indexOf("[");
  const end = reply.lastIndexOf("]");
  if (start === -1 || end <= start) throw new Error(t("error.noJsonArray"));
  const list = JSON.parse(reply.slice(start, end + 1));
  if (!Array.isArray(list) || list.length !== expected || !list.every((s) => typeof s === "string")) {
    throw new Error(t("error.countMismatch", { expected, got: Array.isArray(list) ? list.length : "?" }));
  }
  return list.map((s) => s.trim());
}

// ─── Similarity: shared rare words in names and descriptions (no AI) ────────
const FUNCTION_WORDS = new Set(("the and for with your you from into that this are can all any its use using used "
  + "allow make based more new also not via have has one just like easy simple support supports help helps "
  + "quick quickly within when which what way other own set get let lets will show shows work works multiple "
  + "various different better easily automatically directly custom manage manages").split(" "));
const GENERIC_WORDS = new Set("plugin obsidian note file vault add create view open".split(" "));   // only count in pairs ("daily note")

/** A rough singular so "tasks" and "task" match. */
const stem = (w) => (w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y`
  : w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

/** The words of a text that can carry meaning, in order (generic ones like "note" included). */
function tokens(text) {
  return (String(text || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .map(stem).filter((w) => w.length >= 3 && !FUNCTION_WORDS.has(w));
}

/** The distinct meaningful words of a text. */
function words(text) {
  return new Set(tokens(text).filter((w) => !GENERIC_WORDS.has(w)));
}

/** A plugin's terms and their weights: words and word pairs ("daily note"), name ones counting double. */
function pluginTerms(p) {
  const tf = new Map();
  const bump = (term, weight) => tf.set(term, (tf.get(term) || 0) + weight);
  const add = (list, weight) => list.forEach((w, i) => {
    if (!GENERIC_WORDS.has(w)) bump(w, weight);
    const prev = list[i - 1];
    if (prev && !(GENERIC_WORDS.has(prev) && GENERIC_WORDS.has(w))) bump(`${prev} ${w}`, weight);
  });
  add(tokens(p.name), NAME_WEIGHT);
  add(tokens(p.description), 1);
  return tf;
}

/**
 * The catalog's search index: every plugin's terms, which plugins use each term, and how rare each term
 * is (BM25's idf: rarer terms say more).
 */
function textIndex(catalog) {
  const docs = new Map();
  const postings = new Map();
  let total = 0;
  for (const p of catalog) {
    const tf = pluginTerms(p);
    let length = 0;
    for (const [term, n] of tf) {
      length += n;
      if (!postings.has(term)) postings.set(term, []);
      postings.get(term).push(p.id);
    }
    docs.set(p.id, { tf, length });
    total += length;
  }
  const n = catalog.length;
  const avgLength = total / Math.max(1, n) || 1;
  const weight = (term) => {
    const df = postings.get(term)?.length || 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  };
  const byId = new Map([...docs].map(([id, d]) => [id, new Set(d.tf.keys())]));
  return { docs, postings, avgLength, weight, byId };
}

/** Summed rarity of the words two sets share. */
function overlap(index, a, b) {
  let score = 0;
  for (const w of a) if (b.has(w)) score += index.weight(w);
  return score;
}

/**
 * BM25F-style scores of every plugin that shares a term with `query` (a term → weight map): rare terms,
 * terms used often in a short description and name terms count most. Returns id → {score, shared}.
 */
function bm25(index, query) {
  const scores = new Map();
  for (const [term, qWeight] of query) {
    const idf = index.weight(term);
    for (const id of index.postings.get(term) || []) {
      const doc = index.docs.get(id);
      const f = doc.tf.get(term);
      const part = idf * Math.min(qWeight, NAME_WEIGHT) * (f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + BM25_B * doc.length / index.avgLength));
      const entry = scores.get(id) || { score: 0, shared: [] };
      entry.score += part;
      entry.shared.push([term, part]);
      scores.set(id, entry);
    }
  }
  return scores;
}

/** How alike two plugins' terms are, 0–1 (rarity-weighted overlap); `mass` caches each plugin's total. */
function termSimilarity(index, a, b, mass) {
  const sa = index.byId.get(a) || new Set();
  const sb = index.byId.get(b) || new Set();
  const total = (id, set) => mass.get(id) ?? mass.set(id, [...set].reduce((sum, w) => sum + index.weight(w), 0)).get(id);
  return overlap(index, sa, sb) / (Math.sqrt(total(a, sa) * total(b, sb)) || 1);
}

/**
 * Plugins most like `target`, best match first: [{p, score, match, shared}]. `match` is the score as a
 * share of the best match's (0–1); `shared` the terms that earned the most. Near-duplicates
 * are spread out (maximal marginal relevance), so a list isn't five copies of one idea.
 */
function similarPlugins(target, catalog, index, { exclude = new Set(), limit = SIMILAR_LIMIT } = {}) {
  const query = index.docs.get(target.id)?.tf || pluginTerms(target);
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const scores = bm25(index, query);
  const pool = [...scores]
    .filter(([id, x]) => id !== target.id && !exclude.has(id) && byId.has(id) && x.score >= MIN_SIMILARITY)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit * 3)
    .map(([id, x]) => ({ id, ...x, near: 0 }));
  const best = pool[0]?.score || 1;
  const mass = new Map();
  const picked = [];
  while (picked.length < limit && pool.length) {
    let pick = 0;
    pool.forEach((x, i) => {
      const value = (c) => MMR_LAMBDA * (c.score / best) - (1 - MMR_LAMBDA) * c.near;
      if (value(x) > value(pool[pick])) pick = i;
    });
    const [x] = pool.splice(pick, 1);
    for (const other of pool) other.near = Math.max(other.near, termSimilarity(index, other.id, x.id, mass));
    picked.push({ id: x.id, score: x.score, match: x.score / best, shared: sharedTerms(x.shared) });
  }
  return picked.map(({ id, ...rest }) => ({ p: byId.get(id), ...rest }));
}

/** The terms that earned a match the most, for "In common": no pair whose own words already say it, no repeats. */
function sharedTerms(shared = []) {
  return [...shared].sort((a, b) => b[1] - a[1]).map(([term]) => term)
    .filter((term) => !term.includes(" ") || term.split(" ").some((w) => GENERIC_WORDS.has(w)))   // "manage daily": its words say it
    .filter((term, i, all) => !all.slice(0, i).some((t) => t.includes(term) || term.includes(t))).slice(0, 4);
}

/**
 * Plugins most like `target` by meaning: cosine similarity of the descriptions' vectors (built daily in
 * GitHub Actions, see scripts/embeddings), plus a small share of the word match so a shared rare name
 * still counts. `match` places each result between the list's last (0) and best (1); `cosine` is raw.
 * Returns null when `target` has no vector yet (listed today): the caller falls back to words.
 * @param {{dim: number, rows: Map<string, number>, data: Int8Array}} vectors
 */
function semanticPlugins(target, catalog, vectors, index, { exclude = new Set(), limit = SIMILAR_LIST } = {}) {
  const row = vectors.rows.get(target.id);
  if (row == null) return null;
  const { dim, data } = vectors;
  const query = data.subarray(row * dim, row * dim + dim);
  const words = bm25(index, index.docs.get(target.id)?.tf || pluginTerms(target));
  let wordBest = 0;
  for (const [id, x] of words) if (id !== target.id) wordBest = Math.max(wordBest, x.score);
  const scored = [];
  for (const p of catalog) {
    const r = vectors.rows.get(p.id);
    if (r == null || p.id === target.id || exclude.has(p.id)) continue;
    let dot = 0;
    for (let k = 0, o = r * dim; k < dim; k++) dot += query[k] * data[o + k];
    const cosine = dot / (127 * 127);   // the file stores unit vectors × 127
    const word = words.get(p.id);
    scored.push({ p, cosine, score: cosine + WORD_SHARE * (word && wordBest ? word.score / wordBest : 0), shared: word?.shared });
  }
  const top = scored.sort((a, b) => b.score - a.score).slice(0, limit);
  const best = top[0]?.score ?? 0;
  const floor = top.at(-1)?.score ?? 0;
  return top.map((x) => ({ p: x.p, score: x.score, cosine: x.cosine, match: best > floor ? (x.score - floor) / (best - floor) : 1, shared: sharedTerms(x.shared) }));
}

/** "Very close" / "close" / "related": where a match sits within its list (cosines bunch up, so not absolute). */
function closeness(match) {
  return match >= 0.66 ? "similar.veryClose" : match >= 0.33 ? "similar.close" : "similar.related";
}

/** The vectors file (int8 rows) and its index ({model, dim, count, built, ids}) → a lookup, or null if they don't fit. */
function parseVectors(meta, buffer) {
  if (!meta?.ids || !buffer || buffer.byteLength !== meta.count * meta.dim || meta.ids.length !== meta.count) return null;
  return { model: meta.model, built: meta.built, dim: meta.dim, rows: new Map(meta.ids.map((id, i) => [id, i])), data: new Int8Array(buffer) };
}

/**
 * The user's group that fits `target` best, judged by the words of the plugins already in it (and the
 * group's own name); null when nothing is close enough.
 * @param {Map<string, string[]>} members  group name → plugin ids
 */
function closestGroup(target, members, index) {
  const mine = index.byId.get(target.id) || words(`${target.name} ${target.description}`);
  let best = null;
  let bestScore = MIN_SIMILARITY;
  for (const [group, ids] of members) {
    const profile = words(group);
    for (const id of ids) if (id !== target.id) for (const w of index.byId.get(id) || []) profile.add(w);
    const score = overlap(index, mine, profile) / Math.sqrt(Math.max(1, ids.length));
    if (score >= bestScore) { best = group; bestScore = score; }
  }
  return best;
}

/** One request that suggests groups for many plugins, preferring the user's own groups. */
function groupPrompt(plugins, groups, language) {
  return [
    "You organise Obsidian community plugins into the user's groups.",
    `For each plugin below, suggest up to ${AI_GROUPS} group names, best first, based on what the plugin does.`,
    "Rules:",
    "- When one of the user's existing groups fits, include it, spelled exactly as given.",
    `- New group names: 1–3 words, Title Case. Give names in ${language}, and when a widely used English or technical term exists`
      + " (e.g. AI, Kanban, Habit Tracker, Git, PDF), suggest that term too — the user may prefer it. Reuse the same new name for similar plugins in this list.",
    "- Reply with ONLY a JSON object that maps each plugin id to an array of group names. No commentary.",
    "",
    "Existing groups (with example plugins):",
    JSON.stringify(groups),
    "",
    "Plugins:",
    JSON.stringify(plugins.map((p) => ({ id: p.id, name: p.name, description: p.description }))),
  ].join("\n");
}

/**
 * The suggestions from the model's reply: for each requested id, up to AI_GROUPS clean names
 * (existing groups keep their spelling). Unknown ids and malformed entries are dropped.
 */
function parseGroupSuggestions(reply, ids, existing) {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error(t("error.noJsonObject"));
  const data = JSON.parse(reply.slice(start, end + 1));
  const spelling = new Map(existing.map((g) => [g.toLocaleLowerCase(), g]));
  return Object.fromEntries(ids.map((id) => {
    const raw = Array.isArray(data?.[id]) ? data[id].filter((g) => typeof g === "string") : [];
    const clean = uniqueNames(raw)
      .filter((g) => g.length <= 40 && g.split(" ").length <= 4)
      .map((g) => spelling.get(g.toLocaleLowerCase()) || g);
    return [id, clean.slice(0, AI_GROUPS)];
  }));
}

/** Runs `worker` with limited concurrency; results keep the input order. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

const core = {
  setLanguage, matchLanguage, t, defaultSettings, dayString, weekKey, formatCount, formatShort, formatAge, relativeDays,
  historyLabel, formatTime, safeFileName, cleanDescription, parseCatalog, newTimeline, upgradeTimeline, selectSnapshots,
  mergeSnapshot, dormantDays, isNewPlugin, isChanged, compileQuery, modeOptions, discover, sortRows, modeCounts, isSnoozed, trackedMatch,
  groupSections, groupHue, statusKey, UNGROUPED, UPDATES, STARRED, escapeOutsideCode,
  absolutizeLinks, readmeSection, readmeVersion, replaceReadme, catalogDelta, noteBody, migrateHeadings, migrateMarkers, migrateImages, baseFile, sourceFields, noteFromFrontmatter,
  PROVIDERS, KEY_NAMES, STRINGS, tokenPrice, formatPrice, filterModels, translationPrompt,
  parseTranslations, mapLimit, groupsOf, uniqueNames, words, textIndex, similarPlugins, semanticPlugins, closeness, parseVectors, closestGroup, readmeText, readmeTranslation, replaceReadmeTranslation, markdownChunks, translationEstimate, releaseCadence,
  groupPrompt, parseGroupSuggestions,
  constants: { DAY_MS, MONTH_MS, DAILY_DAYS, RELEASES_CAP, NEW_BADGE_DAYS, README_START, README_END, README_TR_START, README_TR_END, LEGACY_README_START, LEGACY_README_END, TIMELINE_VERSION },
};

// ─── 3. Services ────────────────────────────────────────────────────────────
/** All GitHub requests. `requestUrl` isn't subject to CORS and works on mobile. */
class GitHub {
  async json(url) {
    const res = await requestUrl({ url, throw: false, headers: { Accept: "application/vnd.github+json" } });
    if (res.status === 403 || res.status === 429) throw new Error(t("notice.rateLimit"));
    if (res.status >= 400) throw new Error(`GitHub ${res.status}: ${url}`);
    return res.json;
  }

  async text(url) {
    const res = await requestUrl({ url, throw: false });
    return res.status < 400 ? res.text : null;
  }

  async catalog() {
    const [listing, stats] = await Promise.all([this.json(LISTING_URL), this.json(STATS_URL)]);
    return parseCatalog(listing, stats);
  }

  /** Commits that touched the stats file after `since`, oldest first. */
  async statsCommits(since) {
    const commits = [];
    for (let page = 1; ; page++) {
      const url = `${COMMITS_API}?path=${STATS_FILE}&since=${new Date(since).toISOString()}&per_page=100&page=${page}`;
      const batch = await this.json(url);
      commits.push(...batch.map((c) => ({ sha: c.sha, date: Date.parse(c.commit.committer.date) })));
      if (batch.length < 100) break;
    }
    return commits.filter((c) => c.date > since).sort((a, b) => a.date - b.date);
  }

  snapshot(sha) {
    return this.json(`${RAW}/${REPO}/${sha}/${STATS_FILE}`);
  }

  /** The semantic vectors' index (ids, build time) and, when asked, the vectors themselves. */
  vectorsMeta() {
    return this.json(`${VECTORS_URL}.json`);
  }

  async vectorsData() {
    const res = await requestUrl({ url: `${VECTORS_URL}.bin`, throw: false });
    if (res.status >= 400) throw new Error(`GitHub ${res.status}: ${VECTORS_URL}.bin`);
    return res.arrayBuffer;
  }

  /** README: tries raw file names first (no rate limit), then falls back to the API (60/hour). */
  async readme(repo) {
    for (const name of ["README.md", "readme.md", "Readme.md", "README.MD"]) {
      const text = await this.text(`${RAW}/${repo}/HEAD/${name}`);
      if (text != null) return text;
    }
    const res = await requestUrl({
      url: `https://api.github.com/repos/${repo}/readme`,
      throw: false,
      headers: { Accept: "application/vnd.github.raw" },
    });
    return res.status < 400 ? res.text : null;
  }
}

/** Rebuildable cache files in the plugin folder. No personal data lives here. */
class Cache {
  constructor(adapter, dir) {
    this.adapter = adapter;
    this.dir = normalizePath(`${dir}/cache`);
  }

  path(name) {
    return `${this.dir}/${name}.json`;
  }

  async read(name, fallback) {
    try {
      return (await this.adapter.exists(this.path(name))) ? JSON.parse(await this.adapter.read(this.path(name))) : fallback;
    } catch (error) {
      console.warn(`[Community Radar] couldn't read the ${name} cache; it will be rebuilt`, error);
      return fallback;
    }
  }

  async write(name, value) {
    if (!(await this.adapter.exists(this.dir))) await this.adapter.mkdir(this.dir);
    await this.adapter.write(this.path(name), JSON.stringify(value));
  }

  async readBinary(name) {
    const path = `${this.dir}/${name}.bin`;
    try {
      return (await this.adapter.exists(path)) ? await this.adapter.readBinary(path) : null;
    } catch (error) {
      console.warn(`[Community Radar] couldn't read the ${name} cache; it will be downloaded again`, error);
      return null;
    }
  }

  async writeBinary(name, buffer) {
    if (!(await this.adapter.exists(this.dir))) await this.adapter.mkdir(this.dir);
    await this.adapter.writeBinary(`${this.dir}/${name}.bin`, buffer);
  }
}

/** Tracking notes in the notes folder: index, creation, properties and README updates. */
class Notes {
  constructor(app, settings) {
    this.app = app;
    this.settings = settings;
    this.index = new Map();  // plugin id → record (noteFromFrontmatter)
  }

  get folder() {
    return normalizePath(this.settings.folder);
  }

  inFolder(file) {
    return file instanceof TFile && file.extension === "md" && file.path.startsWith(`${this.folder}/`);
  }

  /** Markdown files inside the notes folder only; the rest of the vault is never listed. */
  files() {
    const files = [];
    const walk = (folder) => {
      for (const child of folder.children) {
        if (child instanceof TFolder) walk(child);
        else if (child instanceof TFile && child.extension === "md") files.push(child);
      }
    };
    const root = this.app.vault.getAbstractFileByPath(this.folder);
    if (root instanceof TFolder) walk(root);
    return files;
  }

  rebuild() {
    this.index.clear();
    for (const file of this.files()) this.refresh(file);
  }

  /** Mirrors edits made in Bases or by hand into the index. */
  refresh(file) {
    this.forget(file.path);
    if (!this.inFolder(file)) return;
    const note = noteFromFrontmatter(file.path, this.app.metadataCache.getFileCache(file)?.frontmatter);
    if (note) this.index.set(note.id, note);
  }

  forget(path) {
    for (const [id, note] of this.index) if (note.path === path) this.index.delete(id);
  }

  /** Your groups, alphabetical, with how many plugins each holds: [{name, count}]. */
  groups() {
    return [...this.members()].map(([name, ids]) => ({ name, count: ids.length }))
      .sort((a, b) => a.name.localeCompare(b.name, t("locale")));
  }

  /** Group name → ids of the plugins in it. */
  members() {
    const members = new Map();
    for (const note of this.index.values()) {
      for (const g of note.groups) members.set(g, [...(members.get(g) || []), note.id]);
    }
    return members;
  }

  /** Moves 0.6's `group` text into the `groups` list (the old property is removed); returns the count. */
  async migrateGroups() {
    let moved = 0;
    for (const file of this.files()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm?.plugin_id || !("group" in fm)) continue;
      await this.app.fileManager.processFrontMatter(file, (data) => {
        data.groups = groupsOf(data);
        delete data.group;
      });
      this.refresh(file);
      moved++;
    }
    return moved;
  }

  file(id) {
    const note = this.index.get(id);
    const file = note && this.app.vault.getAbstractFileByPath(note.path);
    return file instanceof TFile ? file : null;
  }

  uniquePath(plugin) {
    const base = `${this.folder}/${safeFileName(plugin.name)}`;
    return this.app.vault.getAbstractFileByPath(`${base}.md`) ? `${base} (${safeFileName(plugin.id)}).md` : `${base}.md`;
  }

  /**
   * Creates or updates the note.
   * @param {object} patch  personal fields: {groups?, favorite?, note?, reviewed?}
   * @returns {Promise<{file: TFile, created: boolean}>}
   */
  async upsert(plugin, patch) {
    let file = this.file(plugin.id);
    const created = !file;
    if (created) {
      if (!this.app.vault.getAbstractFileByPath(this.folder)) await this.app.vault.createFolder(this.folder);
      file = await this.app.vault.create(this.uniquePath(plugin), noteBody(plugin, this.settings.notesHeading.trim() || undefined));
    }
    let written = {};
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (created) {
        Object.assign(fm, { plugin_id: plugin.id, groups: [], favorite: false, note: "", reviewed: dayString(Date.now()) });
      }
      Object.assign(fm, patch, sourceFields(plugin));
      for (const [key, value] of Object.entries(patch)) if (value == null) delete fm[key];   // null clears a field
      written = { ...fm };
    });
    this.index.set(plugin.id, noteFromFrontmatter(file.path, written));  // don't wait for metadataCache
    return { file, created };
  }

  /** Writes catalog fields only when they changed; returns true when the release date changed. */
  async syncSource(plugin) {
    const file = this.file(plugin.id);
    if (!file) return false;
    const fresh = sourceFields(plugin);
    const current = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
    const changed = Object.entries(fresh).some(([key, value]) => String(current[key] ?? "") !== String(value ?? ""));
    if (changed) await this.app.fileManager.processFrontMatter(file, (fm) => Object.assign(fm, fresh));
    return String(current.updated ?? "").slice(0, 10) !== String(fresh.updated ?? "");
  }

  async writeReadme(file, plugin, readme) {
    const section = readmeSection(readme, plugin, Date.now());
    await this.app.vault.process(file, (content) => replaceReadme(content, section));
  }

  /** Applies a one-time text change to every tracking note; writes only the notes that change and returns their count. */
  async migrate(transform) {
    let changed = 0;
    for (const file of this.files()) {
      const content = await this.app.vault.cachedRead(file);
      if (transform(content) === content) continue;
      await this.app.vault.process(file, transform);
      changed++;
    }
    return changed;
  }
}

/**
 * Description translation. The API key lives in Obsidian's keychain (SecretStorage); the plugin only
 * stores the key's NAME (e.g. "anthropic-api-key"), so plugins using the same name share it.
 */
class Translator {
  constructor(app, settings) {
    this.app = app;
    this.settings = settings;
  }

  get supported() {
    return Boolean(this.app.secretStorage && obsidian.SecretComponent);
  }

  keyName(provider = this.settings.provider) {
    return this.settings.keyNames?.[provider] || KEY_NAMES[provider] || "";
  }

  key(provider = this.settings.provider) {
    const name = this.keyName(provider);
    return name && this.app.secretStorage ? this.app.secretStorage.getSecret(name) : null;
  }

  get ready() {
    return Boolean(PROVIDERS[this.settings.provider] && this.settings.model && this.key());
  }

  async call({ url, headers, body }) {
    const res = await requestUrl({
      url,
      method: body ? "POST" : "GET",
      headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      throw: false,
    });
    if (res.status >= 400) {
      const detail = res.json?.error?.message || res.json?.error || res.text?.slice(0, 200);
      const label = PROVIDERS[this.settings.provider]?.label || t("provider.generic");
      throw new Error(`${label} ${res.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    }
    return res.json;
  }

  /** The provider's models: [{id, price}] (price only when the list has it). */
  async models(provider) {
    const spec = PROVIDERS[provider];
    const key = this.key(provider);
    if (!spec || !key) throw new Error(t("error.noKey", { name: this.keyName(provider) }));
    return spec.modelList(await this.call(spec.models(key))).sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Translates the texts in one request; output keeps the input order. */
  async translate(texts) {
    const spec = PROVIDERS[this.settings.provider];
    const request = spec.chat(this.settings.model, this.key(), translationPrompt(texts, this.settings.targetLang));
    return parseTranslations(spec.text(await this.call(request)), texts.length);
  }

  /**
   * Group suggestions for up to AI_BATCH plugins in one request.
   * @param {object[]} plugins  catalog entries
   * @param {{name: string, examples: string[]}[]} groups  the user's groups with a few plugin names each
   * @returns {Promise<Object<string, string[]>>} plugin id → suggestions
   */
  async suggestGroups(plugins, groups) {
    const spec = PROVIDERS[this.settings.provider];
    const request = spec.chat(this.settings.model, this.key(), groupPrompt(plugins, groups, this.settings.targetLang));
    return parseGroupSuggestions(spec.text(await this.call(request)), plugins.map((p) => p.id), groups.map((g) => g.name));
  }

  /** Translates a README into the target language, a few sections per request; progress(done, total). */
  async translateMarkdown(markdown, progress = () => {}) {
    const spec = PROVIDERS[this.settings.provider];
    const chunks = markdownChunks(markdown);
    const out = [];
    for (const [i, chunk] of chunks.entries()) {
      progress(i, chunks.length);
      const reply = spec.text(await this.call(spec.chat(this.settings.model, this.key(), readmePrompt(chunk, this.settings.targetLang))));
      out.push(reply.trim().replace(/^```(?:markdown|md)?\n([\s\S]*)\n```$/, "$1"));   // some models wrap it in a fence
    }
    return out.join("\n\n");
  }

  /** A one-line translation to confirm that the provider, key and model work together. */
  async test() {
    const [sample] = await this.translate(["A plugin that tracks new releases."]);
    return sample;
  }

  /** Copies keys saved under 0.2's plugin-specific names to the shared suggested names. */
  migrateLegacyKeys() {
    if (!this.app.secretStorage) return 0;
    let moved = 0;
    for (const provider of Object.keys(PROVIDERS)) {
      const legacy = this.app.secretStorage.getSecret(`plugin-tracker-${provider}-key`);
      if (legacy && !this.app.secretStorage.getSecret(KEY_NAMES[provider])) {
        this.app.secretStorage.setSecret(KEY_NAMES[provider], legacy);
        moved++;
      }
    }
    return moved;
  }
}

// ─── 4. UI ──────────────────────────────────────────────────────────────────
const $ = (root, selector) => root.querySelector(selector);

/** Obsidian's own tooltip (1.4.4+); falls back to the browser tooltip. */
const setTooltip = obsidian.setTooltip || ((el, text) => el.setAttribute("title", text));

function onActivate(el, handler) {
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handler(); }
  });
}

/** Obsidian's built-in icon button look (clickable-icon): transparent, highlighted on hover. */
function iconButton(parent, icon, tip, cls = "") {
  const button = parent.createDiv({ cls: `clickable-icon pdt-icon ${cls}`.trim(), attr: { "aria-label": tip, role: "button", tabindex: "0" } });
  setIcon(button, icon);
  setTooltip(button, tip);
  onActivate(button, () => button.click());
  return button;
}

/** A filter chip whose options open in Obsidian's own menu. */
function menuChip(parent, label, options, current, onPick) {
  const chip = parent.createDiv({ cls: "pdt-chip is-menu", attr: { role: "button", tabindex: "0" } });
  chip.createSpan({ text: label });
  const selected = options.some(([value]) => value === current) ? current : options[0][0];  // invalid here → first option
  chip.createSpan({ cls: "pdt-chip-value", text: options.find(([value]) => value === selected)[1] });
  setIcon(chip.createSpan({ cls: "pdt-chip-caret" }), "chevron-down");
  const open = () => {
    const menu = new Menu();
    for (const [value, text] of options) {
      menu.addItem((item) => item.setTitle(text).setChecked(value === selected).onClick(() => onPick(value)));
    }
    const rect = chip.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  };
  chip.onclick = open;
  onActivate(chip, open);
  return chip;
}

/** A chip with a typed whole number (e.g. "Last [7] days"); the caret opens presets in Obsidian's menu. */
function numberChip(parent, { label, unit, value, min, max, presets, onChange }) {
  const chip = parent.createDiv({ cls: "pdt-chip is-number" });
  chip.createSpan({ text: label });
  const input = chip.createEl("input", { type: "number", value: String(value), attr: { min: String(min), max: String(max), "aria-label": label } });
  chip.createSpan({ text: unit });
  input.onchange = () => {
    const n = Math.round(Number(input.value));
    onChange(Number.isFinite(n) && input.value !== "" ? Math.min(max, Math.max(min, n)) : value);
  };
  const caret = chip.createSpan({ cls: "pdt-chip-caret is-button", attr: { role: "button", tabindex: "0", "aria-label": t("filter.presets") } });
  setIcon(caret, "chevron-down");
  setTooltip(caret, t("filter.presets"));
  const open = () => {
    const menu = new Menu();
    for (const n of presets) menu.addItem((item) => item.setTitle(t("filter.days", { n })).setChecked(n === value).onClick(() => onChange(n)));
    const rect = chip.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  };
  caret.onclick = open;
  onActivate(caret, open);
  return chip;
}

/** A filter chip that is itself the on/off switch; typing a value turns it on. */
function toggleChip(parent, { label, value, on, onToggle, onValue }) {
  const chip = parent.createDiv({ cls: `pdt-chip is-toggle${on ? " is-on" : ""}` });
  const toggle = chip.createSpan({ cls: "pdt-toggle", attr: { role: "button", tabindex: "0", "aria-pressed": String(on) } });
  setIcon(toggle.createSpan({ cls: "pdt-toggle-check" }), "check");
  toggle.createSpan({ text: label });
  setTooltip(toggle, t(on ? "filter.toggleOn" : "filter.toggleOff"));
  toggle.onclick = () => onToggle(!on);
  onActivate(toggle, () => onToggle(!on));
  const input = chip.createEl("input", { type: "number", value: String(value), attr: { min: "0", "aria-label": label } });
  input.onchange = () => onValue(Math.max(0, Math.round(Number(input.value)) || 0));
  return chip;
}

/** A SuggestModal that resolves a promise with the chosen item (or null when dismissed). */
class PickerModal extends SuggestModal {
  constructor(app, placeholder) {
    super(app);
    this.setPlaceholder(placeholder);
    this.result = new Promise((resolve) => { this.resolve = resolve; });
    this.chosen = null;
  }

  onChooseSuggestion(item) {
    this.chosen = item;
  }

  onClose() {
    // Obsidian closes the modal before reporting the choice; one tick later the choice is final
    setTimeout(() => this.resolve(this.chosen), 0);
  }
}

/** A group chip: a button you switch on and off. */
function groupChip(parent, { name, on, removable = false, star = false, starTip = "", meta = "", onToggle }) {
  const chip = parent.createEl("button", { cls: `pdt-gchip${on ? " is-on" : ""}`, attr: { type: "button", "aria-pressed": String(on) } });
  if (on && !removable) setIcon(chip.createSpan({ cls: "pdt-gchip-icon" }), "check");
  chip.createSpan({ text: name });
  if (star) {
    setIcon(chip.createSpan({ cls: "pdt-gchip-star" }), "star");
    setTooltip(chip, starTip);
  }
  if (meta) chip.createSpan({ cls: "pdt-gchip-meta", text: meta });
  if (removable) setIcon(chip.createSpan({ cls: "pdt-gchip-icon" }), "x");
  chip.onclick = onToggle;
  return chip;
}

/**
 * One plugin's groups: the selected ones, your groups (the closest starred), AI suggestions and a box
 * for a new name. `result` resolves with the chosen groups on Confirm, or null when closed.
 */
class GroupModal extends Modal {
  constructor(plugin, target) {
    super(plugin.app);
    this.plugin = plugin;
    this.target = target;
    const note = plugin.notes.index.get(target.id);
    this.mine = plugin.notes.groups();
    this.closest = plugin.closestGroupFor(target);
    this.touched = Boolean(note?.groups.length);
    this.selected = this.touched ? [...note.groups] : this.closest ? [this.closest] : [];
    this.ai = { state: plugin.translator.ready ? "loading" : "setup", list: [], error: "" };
    this.showAll = false;
    this.draft = "";
    this.saved = null;
    this.result = new Promise((resolve) => { this.resolve = resolve; });
  }

  onOpen() {
    this.modalEl.addClass("pdt-group-modal");
    this.render();
    if (this.ai.state === "loading") this.loadSuggestions();
  }

  onClose() {
    this.contentEl.empty();
    this.resolve(this.saved);
  }

  async loadSuggestions() {
    try {
      const list = await this.plugin.suggestGroups(this.target);
      const known = new Set(this.mine.map((g) => g.name));
      const pick = list.find((g) => known.has(g));
      if (pick) this.closest = pick;   // the model's choice among your groups beats word overlap
      if (!this.touched) this.selected = this.closest ? [this.closest] : [];
      this.ai = { state: "ready", list: list.filter((g) => !known.has(g)), error: "" };
    } catch (error) {
      this.ai = { state: "failed", list: [], error: error.message };
    }
    this.render();
  }

  toggle(name) {
    this.touched = true;
    this.selected = this.selected.includes(name) ? this.selected.filter((g) => g !== name) : [...this.selected, name];
    this.render();
  }

  addDraft() {
    const [typed] = uniqueNames([this.draft]);
    this.draft = "";
    if (typed) {
      const known = [...this.mine.map((g) => g.name), ...this.ai.list].find((g) => g.toLocaleLowerCase() === typed.toLocaleLowerCase());
      const name = known || typed;
      if (!this.selected.includes(name)) this.selected = [...this.selected, name];
      this.touched = true;
    }
    this.render();
  }

  render() {
    const el = this.contentEl;
    el.empty();
    this.titleEl.setText(this.target.version ? `${this.target.name} ${this.target.version}` : this.target.name);
    if (this.target.description) el.createEl("p", { cls: "pdt-gm-desc", text: this.target.description });
    const translation = this.plugin.cachedTranslation(this.target);
    if (translation) el.createDiv({ cls: "pdt-trans", text: translation });

    const section = (label) => {
      const box = el.createDiv({ cls: "pdt-gm-section" });
      box.createDiv({ cls: "pdt-gm-label", text: label, attr: { lang: language } });   // uppercase by the UI's rules, not Obsidian's (i → I, not İ)
      return box.createDiv({ cls: "pdt-gm-chips" });
    };

    const selected = section(t("groups.selected", { n: this.selected.length }));
    if (!this.selected.length) selected.createSpan({ cls: "pdt-gm-note", text: t("groups.none") });
    for (const name of this.selected) groupChip(selected, { name, on: true, removable: true, onToggle: () => this.toggle(name) });

    if (this.mine.length) {
      const mine = section(t("groups.mine"));
      for (const g of this.mine) {
        groupChip(mine, {
          name: g.name, on: this.selected.includes(g.name), meta: String(g.count),
          star: g.name === this.closest, starTip: t("groups.closest"), onToggle: () => this.toggle(g.name),
        });
      }
    }

    const { state, list, error } = this.ai;
    const ai = section(state === "ready" ? t("groups.aiCount", { n: list.length }) : t("groups.ai"));
    if (state === "loading") ai.createSpan({ cls: "pdt-gm-note is-loading", text: t("groups.aiLoading") });
    if (state === "setup") ai.createSpan({ cls: "pdt-gm-note", text: t("groups.aiSetup") });
    if (state === "failed") ai.createSpan({ cls: "pdt-gm-note is-error", text: t("groups.aiFailed", { error }) });
    if (state === "ready") {
      for (const name of this.showAll ? list : list.slice(0, VISIBLE_SUGGESTIONS)) {
        groupChip(ai, { name, on: this.selected.includes(name), onToggle: () => this.toggle(name) });
      }
      if (list.length > VISIBLE_SUGGESTIONS) {
        const more = ai.createEl("button", { cls: "pdt-gm-more", attr: { type: "button", "aria-expanded": String(this.showAll) } });
        more.setText(this.showAll ? t("groups.less") : t("groups.more", { n: list.length - VISIBLE_SUGGESTIONS }));
        more.onclick = () => { this.showAll = !this.showAll; this.render(); };
      }
    }

    const add = el.createDiv({ cls: "pdt-gm-new" });
    const input = add.createEl("input", { type: "text", placeholder: t("groups.newPlaceholder"), value: this.draft, attr: { "aria-label": t("groups.newPlaceholder") } });
    input.oninput = () => { this.draft = input.value; };
    input.onkeydown = (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.addDraft();
    };
    add.createEl("button", { text: t("groups.add"), attr: { type: "button" } }).onclick = () => this.addDraft();

    const foot = el.createDiv({ cls: "pdt-gm-foot" });
    foot.createSpan({ cls: "pdt-gm-note", text: t("groups.hint") });
    foot.createEl("button", { text: t("groups.cancel"), attr: { type: "button" } }).onclick = () => this.close();
    const confirm = foot.createEl("button", { cls: "mod-cta", text: t("groups.confirm", { n: this.selected.length }), attr: { type: "button" } });
    confirm.onclick = () => {
      this.saved = [...this.selected];
      this.close();
    };
  }
}

/** Model picker: filters as you type, shows prices, accepts names that aren't listed. */
class ModelModal extends PickerModal {
  constructor(app, models) {
    super(app, t("model.placeholder"));
    this.models = models;
    this.latestOnly = false;
  }

  onOpen() {
    super.onOpen?.();
    const container = this.inputEl?.parentElement;
    if (!container) return;
    const bar = createDiv({ cls: "pdt-model-bar" });
    container.after(bar);
    const toggle = bar.createDiv({ cls: "pdt-chip is-menu", text: t("model.latestOnly"), attr: { role: "button", tabindex: "0" } });
    const flip = () => {
      this.latestOnly = !this.latestOnly;
      toggle.toggleClass("is-active", this.latestOnly);
      this.inputEl.dispatchEvent(new Event("input"));
    };
    toggle.onclick = flip;
    onActivate(toggle, flip);
  }

  getSuggestions(query) {
    return filterModels(this.models, query, this.latestOnly);
  }

  renderSuggestion(model, el) {
    el.addClass("pdt-model-item");
    el.createDiv({ cls: "pdt-model-id", text: model.custom ? t("model.custom", { name: model.id }) : model.id });
    if (model.price) el.createDiv({ cls: "pdt-model-price", text: formatPrice(model.price) });
  }
}

/**
 * The discovery view, opened as a tab inside Obsidian.
 * render(): builds everything (on mode or filter changes). refresh(): updates only the counts, the status
 * and the list, so the search box keeps its focus.
 */
/**
 * A plugin's details in a large window that grows out of its card or row: the numbers, the whole
 * description and its translation, your note, the README (and its translation, on request), the closest
 * plugins and the release history. ←/→ walk the list it was opened from; Esc closes.
 */
class DetailModal extends Modal {
  constructor(view, rows, index, origin) {
    super(view.app);
    this.view = view;
    this.plugin = view.plugin;
    this.rows = [...rows];
    this.index = Math.max(0, index);
    this.origin = origin;
    this.tab = "readme";
    this.fetched = new Map();   // README fetched for an untracked plugin (shown, not saved)
    this.busy = "";             // progress of a translation in this window
    this.scope.register([], "ArrowLeft", () => { this.step(-1); return false; });
    this.scope.register([], "ArrowRight", () => { this.step(1); return false; });
  }

  get p() {
    return this.rows[this.index];
  }

  step(delta) {
    const next = this.index + delta;
    if (next < 0 || next >= this.rows.length || this.busy) return;
    this.index = next;
    this.tab = "readme";
    this.render();
  }

  onOpen() {
    this.modalEl.addClass("pdt-detail");
    this.component = new obsidian.Component();
    this.component.load();
    // grow out of the card: the animation starts at the card's centre (no motion if the system asks for less)
    const from = this.origin?.getBoundingClientRect?.();
    const box = this.modalEl.getBoundingClientRect?.();
    if (from && box) this.modalEl.setCssProps({ "--pdt-origin": `${from.left + from.width / 2 - box.left}px ${from.top + from.height / 2 - box.top}px` });
    this.modalEl.addClass("is-growing");
    this.render();
  }

  onClose() {
    this.component?.unload();
    this.contentEl.empty();
    this.view.refresh();
  }

  async act(fn, close = false) {
    await fn();
    if (close) this.close();
    else this.render();
  }

  render() {
    const p = this.p;
    const plugin = this.plugin;
    const note = plugin.notes.index.get(p.id);
    const { firstSeen, releases, months } = plugin.timeline;
    const now = Date.now();
    this.titleEl.empty();
    this.titleEl.createSpan({ cls: "pdt-detail-name", text: p.name });
    this.titleEl.createSpan({ cls: "pdt-detail-by", text: [p.version, p.author].filter(Boolean).join(" · ") });
    const el = this.contentEl;
    el.empty();

    const top = el.createDiv({ cls: "pdt-detail-top" });
    const tags = top.createDiv({ cls: "pdt-detail-tags" });
    for (const g of note?.groups || []) tags.createSpan({ cls: `pdt-pill is-group pdt-hue-${groupHue(g)}`, text: g });
    if (note?.rating) tags.createSpan({ cls: "pdt-pill is-rating", text: "★".repeat(note.rating) + "☆".repeat(5 - note.rating) });
    if (this.rows.length > 1) top.createSpan({ cls: "pdt-detail-pos", text: t("details.position", { n: this.index + 1, total: this.rows.length }) });
    top.createEl("a", { cls: "pdt-detail-open mod-cta", text: t("details.openInObsidian"), href: `obsidian://show-plugin?id=${encodeURIComponent(p.id)}` });

    const stats = el.createDiv({ cls: "pdt-detail-stats" });
    const stat = (value, label) => {
      const box = stats.createDiv({ cls: "pdt-detail-stat" });
      box.createDiv({ cls: "pdt-detail-value", text: value });
      box.createDiv({ cls: "pdt-detail-label", text: label });
    };
    const seen = firstSeen[p.id];
    const cadence = releaseCadence(releases[p.id]);
    stat(p.downloads == null ? "–" : formatCount(p.downloads), t("details.downloads"));
    stat(p.updated ? relativeDays(p.updated, now) : "–", t("details.lastRelease"));
    const before = months >= 12 ? t("details.beforeYears", { n: Math.round(months / 12) }) : t("details.beforeMonths", { n: months });
    stat(seen > 0 ? relativeDays(seen, now) : seen === 0 ? before : "–", t("details.listed"));   // 0: there before the history starts
    stat(cadence ? t("details.every", { n: cadence }) : "–", t("details.cadence"));

    const columns = el.createDiv({ cls: "pdt-detail-columns" });
    const main = columns.createDiv({ cls: "pdt-detail-main" });
    const section = (parent, title) => {
      const box = parent.createDiv({ cls: "pdt-detail-section" });
      box.createEl("h3", { text: title, attr: { lang: language } });
      return box;
    };
    const about = section(main, t("details.description"));
    about.createEl("p", { text: p.description || "–" });
    const translation = plugin.cachedTranslation(p);
    if (translation) about.createEl("p", { cls: "pdt-detail-trans", text: translation });
    else if (p.description && plugin.translator.ready) {
      about.createEl("button", { cls: "pdt-link-button", text: t("translate.row") }).onclick = async () => {
        if (await plugin.translateRows([p])) this.render();
      };
    }
    if (note?.note) section(main, t("details.yourNote")).createEl("p", { text: note.note });
    this.renderReadme(main, p, note);

    const side = columns.createDiv({ cls: "pdt-detail-side" });
    const similar = plugin.similarTo(p);
    const near = section(side, t("details.similar"));
    for (const x of similar.slice(0, 5)) {
      const item = near.createEl("button", { cls: "pdt-detail-near", attr: { type: "button" } });
      item.createSpan({ cls: "pdt-detail-near-name", text: x.p.name });
      const meter = item.createSpan({ cls: "pdt-why-meter" });
      meter.createSpan({ cls: "pdt-why-fill" }).setCssProps({ "--pdt-match": `${Math.max(6, Math.round(x.match * 100))}%` });
      setTooltip(item, x.p.description || x.p.name);
      item.onclick = () => {   // look at it here; ← comes back
        this.rows.splice(this.index + 1, 0, x.p);
        this.step(1);
      };
    }
    if (similar.length) {
      const all = near.createEl("button", { cls: "pdt-link-button", text: t("similar.seeAll", { n: similar.length }), attr: { type: "button" } });
      all.onclick = () => { this.close(); this.view.openSimilar(p); };
    } else near.createEl("p", { cls: "pdt-detail-muted", text: t("similar.none") });
    this.renderHistory(section(side, t("details.history")), releases[p.id] || [], now);

    const footer = el.createDiv({ cls: "pdt-detail-actions" });
    const button = (icon, text, fn, close = false) => {
      const b = footer.createEl("button", { attr: { type: "button" } });
      setIcon(b.createSpan({ cls: "pdt-detail-icon" }), icon);
      b.createSpan({ text });
      b.onclick = () => this.act(fn, close);
      return b;
    };
    button("star", t(note?.favorite ? "action.unfavorite" : "action.favorite"), () => plugin.toggleFavorite(p)).toggleClass("is-favorite", Boolean(note?.favorite));
    button("folder-plus", t("action.group"), () => plugin.chooseGroup(p));
    button("eye-off", t("action.snooze"), () => plugin.snooze(p), true);
    button("ban", t("action.exclude"), () => plugin.exclude(p), true);
    if (this.rows.length > 1) footer.createSpan({ cls: "pdt-detail-keys", text: t("details.keys") });
  }

  /** Release dates as dots on a line from the first known one to today. */
  renderHistory(box, dates, now) {
    const shown = dates.slice(-24);
    if (!shown.length) {
      box.createEl("p", { cls: "pdt-detail-muted", text: t("details.noHistory") });
      return;
    }
    const start = shown[0];
    const span = Math.max(now - start, DAY_MS);
    const line = box.createDiv({ cls: "pdt-history", attr: { role: "img", "aria-label": t("details.historyLabel", { n: shown.length }) } });
    for (const date of shown) {
      const dot = line.createSpan({ cls: "pdt-history-dot" });
      dot.setCssProps({ "--pdt-at": `${((date - start) / span) * 100}%` });
      setTooltip(dot, dayString(date));
    }
    const ends = box.createDiv({ cls: "pdt-history-ends" });
    ends.createSpan({ text: dayString(start) });
    ends.createSpan({ text: t("details.today") });
  }

  /** README / README · <language> tabs; the translation tab is dim until there is one, and translates on request. */
  async renderReadme(parent, p, note) {
    const plugin = this.plugin;
    const box = parent.createDiv({ cls: "pdt-detail-section pdt-detail-readme" });
    const translating = plugin.data.settings.readmeTranslation !== "off";
    const { original, translation } = await plugin.readmeParts(p);
    if (this.p !== p) return;   // moved on while reading
    const text = original || this.fetched.get(p.id);
    const tabs = box.createDiv({ cls: "pdt-detail-tabs", attr: { role: "tablist" } });
    const tab = (key, label, extra = "") => {
      const b = tabs.createEl("button", { cls: `pdt-detail-tab${this.tab === key ? " is-active" : ""}${extra}`, attr: { type: "button", role: "tab", "aria-selected": String(this.tab === key) } });
      b.createSpan({ text: label });
      b.onclick = () => { this.tab = key; this.render(); };
      return b;
    };
    tab("readme", "README");
    if (translating) {
      const stale = translation && translation.version !== p.version;
      const t2 = tab("translation", t("details.readmeIn", { lang: plugin.data.settings.targetLang }), translation ? "" : " is-dim");
      if (!translation) t2.createSpan({ cls: "pdt-detail-tab-note", text: t("details.none") });
      else if (stale) t2.createSpan({ cls: "pdt-detail-tab-note is-stale", text: t("details.stale") });
    }
    if (note) tabs.createEl("a", { cls: "pdt-detail-note-link", text: t("details.openNote"), href: "#" }).onclick = (event) => {
      event.preventDefault();
      this.close();
      plugin.openReadme(p);
    };
    const body = box.createDiv({ cls: "pdt-detail-readme-body" });
    const render = (markdown) => {
      body.addClass("markdown-rendered");
      obsidian.MarkdownRenderer.render(this.app, markdown, body, note?.path || "", this.component);
    };
    if (this.tab === "readme") {
      if (text) return render(text);
      if (!p.repo) return body.createEl("p", { cls: "pdt-detail-muted", text: t("readme.failed") });
      const get = body.createEl("button", { text: t("details.fetchReadme"), attr: { type: "button" } });
      get.onclick = async () => {
        get.disabled = true;
        const readme = await plugin.github.readme(p.repo);
        this.fetched.set(p.id, readme == null ? t("readme.failed") : escapeOutsideCode(absolutizeLinks(readme.trim(), p.repo)));
        this.render();
      };
      return;
    }
    if (translation && !this.busy) {
      if (translation.version !== p.version) {
        const again = body.createDiv({ cls: "pdt-detail-stale" });
        again.createSpan({ text: t("details.staleNote", { version: translation.version || "?" }) });
        again.createEl("button", { cls: "pdt-link-button", text: t("details.translateAgain"), attr: { type: "button" } }).onclick = () => this.translate(p);
      }
      return render(translation.body);
    }
    body.addClass("is-empty");
    if (this.busy) {
      body.createEl("p", { text: this.busy });
      return;
    }
    body.createEl("p", { text: t("details.notTranslated", { lang: plugin.data.settings.targetLang }) });
    body.createEl("button", { cls: "mod-cta", text: t("details.translate"), attr: { type: "button" } }).onclick = () => this.translate(p);
    const estimate = translationEstimate(text || "", plugin.data.settings.modelCost);
    if (text) {
      body.createEl("p", {
        cls: "pdt-detail-muted",
        text: [t("details.chars", { n: formatCount(estimate.chars) }), t("details.tokens", { n: formatCount(estimate.tokens) }),
          estimate.cost != null ? t("details.cost", { cost: decimal(estimate.cost, 3) }) : null, plugin.data.settings.model].filter(Boolean).join(" · "),
      });
    }
  }

  async translate(p) {
    this.busy = t("details.translating");
    this.render();
    await this.plugin.translateReadme(p, (text) => { this.busy = text; if (this.p === p) this.render(); });
    this.busy = "";
    this.render();
  }
}

class DiscoveryView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.visible = PAGE_SIZE;
    this.shownTranslations = new Set();
    this.similarOpen = new Set();
    this.similarQuery = "";       // search within the Similar list (not saved)
    this.collapsed = new Set();   // Tracked tab sections folded away
    this.refs = {};
    this.cursorId = null;         // the row keyboard shortcuts act on
    this.grouping = null;         // grouping mode: {ids, suggestions, picked, loading, error}
    // Obsidian activates a view's scope while its tab is focused, so keys work without clicking a row
    this.scope = new Scope(this.app.scope);
    this.keep = new Map();        // id → index: rows an action moved out of the filter stay put until render()
    for (const key of ["j", "k", "f", "g", "x", "h", "t", "r", "s", "o", "Enter", "0", "1", "2", "3", "4", "5"]) {
      this.scope.register([], key, (event) => this.onKey(event, key));
    }
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return t("view.title"); }
  getIcon() { return ICON; }

  async onOpen() {
    this.contentEl.addClass("pdt-view");
    this.render();
    await this.plugin.ensureFresh();
  }

  /** Obsidian's ⋮ menu of the view: actions that don't need a place on screen. */
  onPaneMenu(menu, source) {
    super.onPaneMenu?.(menu, source);
    const plugin = this.plugin;
    const shown = (this.rows || []).slice(0, this.visible);
    const item = (icon, title, run) => menu.addItem((i) => i.setIcon(icon).setTitle(title).onClick(run));
    item("refresh-cw", t("set.syncNow"), () => plugin.refresh());
    item("languages", t("translate.visible", { n: shown.length }), () => this.translateVisible());
    item("folder-plus", t("menu.groupList", { n: Math.min(shown.length, AI_BATCH) }), () => this.startGrouping(shown));
    item("ban", t("list.ignoredTitle", { n: plugin.ignoredCount() }), () => this.update("mode", "ignored"));
    item("eye-off", t("list.dismissedTitle", { n: Object.keys(plugin.data.dismissed).length }), () => this.update("mode", "dismissed"));
    item("history", t("cmd.rebuild"), () => plugin.buildHistory(true));
    item("settings", t("menu.settings"), () => plugin.openSettings());
  }

  async translateVisible() {
    const rows = (this.rows || []).slice(0, this.visible);
    if (await this.plugin.translateRows(rows)) rows.forEach((p) => this.shownTranslations.add(p.id));
    this.refresh();
  }

  /**
   * A shortcut key (see KEY_HELP). Returns true to let Obsidian handle the key as usual: when shortcuts
   * are off, in grouping mode, or while typing in a field.
   */
  onKey(event, key) {
    const typing = globalThis.document?.activeElement?.closest?.("input, textarea, select, [contenteditable]");
    if (!this.settings.keyboard || this.grouping || typing) return true;
    const rows = [...this.contentEl.querySelectorAll(".pdt-row")];
    if (!rows.length) return true;
    const index = rows.findIndex((r) => r.dataset.id === this.cursorId);
    if (key === "j" || key === "k") {
      const next = index === -1 ? 0 : Math.max(0, Math.min(rows.length - 1, index + (key === "j" ? 1 : -1)));
      this.setCursor(rows[next]);
      return false;
    }
    const row = rows[index];
    const p = row && this.plugin.pluginById(row.dataset.id);
    if (!p) return true;
    const listMode = LIST_MODES.includes(this.settings.mode);
    const actions = {
      f: () => this.plugin.toggleFavorite(p),
      g: () => this.plugin.chooseGroup(p),
      x: () => (listMode ? this.plugin.restoreFrom(this.settings.mode, [p.id]) : this.plugin.exclude(p)),
      h: () => this.plugin.snooze(p),
      t: () => $(row, ".pdt-tr")?.click(),
      r: () => this.plugin.openReadme(p),
      s: () => $(row, ".pdt-similar-link")?.click(),
      o: () => $(row, ".pdt-name")?.click(),
      Enter: () => $(row, ".pdt-desc")?.click(),
    };
    for (const n of [0, 1, 2, 3, 4, 5]) actions[n] = () => this.runRowAction(p, () => this.plugin.setNoteField(p, "rating", n || null));
    Promise.resolve(actions[key]()).then(() => {
      if (!"fxh012345".includes(key)) return;
      this.refresh();
      const again = [...this.contentEl.querySelectorAll(".pdt-row")];
      this.setCursor(again.find((r) => r.dataset.id === p.id) || again[Math.min(index, again.length - 1)]);
    });
    return false;
  }

  /** Highlights the row the shortcuts act on and keeps it in sight. */
  setCursor(row) {
    for (const r of this.contentEl.querySelectorAll(".pdt-row.is-cursor")) r.removeClass("is-cursor");
    if (!row) return;
    row.addClass("is-cursor");
    this.cursorId = row.dataset.id;
    row.scrollIntoView?.({ block: "nearest" });
  }

  // ── Grouping mode: AI suggestions for the plugins of the current list, picked on the rows ──
  async startGrouping(plugins) {
    const ids = plugins.slice(0, AI_BATCH).map((p) => p.id);
    if (!ids.length) return new Notice(t("grouping.empty"));
    if (!this.plugin.translator.ready) return new Notice(t("groups.aiSetup"));
    const grouping = { ids, suggestions: {}, picked: Object.fromEntries(ids.map((id) => [id, [...this.currentGroups(id)]])), loading: true, error: "" };
    this.grouping = grouping;
    this.refresh();
    try {
      grouping.suggestions = await this.plugin.groupSuggestions(ids.map((id) => this.plugin.pluginById(id)).filter(Boolean));
    } catch (error) {
      grouping.error = error.message;
    }
    grouping.loading = false;
    if (this.grouping === grouping) this.refresh();   // unless it was cancelled meanwhile
  }

  currentGroups(id) {
    return this.plugin.notes.index.get(id)?.groups || [];
  }

  stopGrouping() {
    this.grouping = null;
    this.render();
  }

  /** Writes the changed rows: new groups, cleared groups, or a new tracking note. */
  async acceptGrouping() {
    const { ids, picked } = this.grouping;
    let written = 0;
    for (const id of ids) {
      const plugin = this.plugin.pluginById(id);
      if (!plugin || sameNames(picked[id], this.currentGroups(id))) continue;
      await this.plugin.track(plugin, { groups: picked[id] });
      written++;
    }
    new Notice(t("notice.batchSaved", { n: written }));
    this.stopGrouping();
  }

  renderGrouping(list, now) {
    const grouping = this.grouping;
    this.rows = grouping.ids.map((id) => this.plugin.pluginById(id)).filter(Boolean);
    const bar = list.createDiv({ cls: "pdt-grouping-bar" });
    const text = bar.createDiv({ cls: "pdt-grouping-text" });
    text.createDiv({ cls: "pdt-banner-title", text: t("grouping.title", { n: this.rows.length }) });
    this.refs.groupingSummary = text.createDiv({ cls: "pdt-gm-note" });
    const button = (label, cls, run) => {
      const el = bar.createEl("button", { cls, text: label, attr: { type: "button" } });
      el.onclick = run;
      return el;
    };
    const pickAll = (choose) => {
      for (const id of grouping.ids) grouping.picked[id] = choose(id);
      for (const id of grouping.ids) this.renderGroupingChips(id);
      this.updateGroupingSummary();
    };
    button(t("grouping.pickTop"), "", () => pickAll((id) => {
      const current = this.currentGroups(id);
      return current.length ? [...current] : (grouping.suggestions[id] || []).slice(0, 1);
    }));
    button(t("grouping.reset"), "", () => pickAll((id) => [...this.currentGroups(id)]));
    button(t("groups.cancel"), "", () => this.stopGrouping());
    this.refs.groupingAccept = button("", "mod-cta", () => this.acceptGrouping());
    this.groupingRows = new Map();
    for (const p of this.rows) this.renderRow(list, p, now);
    this.updateGroupingSummary();
  }

  /** Redraws one row's chips only, so the list keeps its scroll position. */
  renderGroupingChips(id) {
    const grouping = this.grouping;
    const { row, box } = this.groupingRows.get(id) || {};
    if (!box) return;
    box.empty();
    setIcon(box.createSpan({ cls: "pdt-grouping-icon" }), "folder-plus");
    if (grouping.loading) {
      for (let i = 0; i < 3; i++) box.createSpan({ cls: "pdt-skeleton" });
      return;
    }
    const current = this.currentGroups(id);
    const mine = new Set(this.plugin.notes.groups().map((g) => g.name));
    const options = uniqueNames([...current, ...(grouping.suggestions[id] || [])]);
    if (!options.length) box.createSpan({ cls: "pdt-gm-note", text: grouping.error ? t("groups.aiFailed", { error: grouping.error }) : t("batch.noSuggestions") });
    for (const name of options) {
      groupChip(box, {
        name, on: grouping.picked[id].includes(name), star: mine.has(name), starTip: t("batch.legend"),
        onToggle: () => {
          const picked = grouping.picked[id];
          grouping.picked[id] = picked.includes(name) ? picked.filter((g) => g !== name) : [...picked, name];
          this.renderGroupingChips(id);
          this.updateGroupingSummary();
        },
      });
    }
    const changed = !sameNames(grouping.picked[id], current);
    row.toggleClass("is-grouping-changed", changed);
    if (changed) {
      const label = !this.plugin.notes.index.has(id) ? "grouping.willCreate" : grouping.picked[id].length ? "grouping.willChange" : "grouping.willClear";
      box.createSpan({ cls: "pdt-badge is-change", text: t(label) });
    }
  }

  updateGroupingSummary() {
    const { ids, picked } = this.grouping;
    const mine = new Set(this.plugin.notes.groups().map((g) => g.name));
    const changed = ids.filter((id) => !sameNames(picked[id], this.currentGroups(id)));
    const notes = changed.filter((id) => !this.plugin.notes.index.has(id)).length;
    const fresh = new Set(ids.flatMap((id) => picked[id]).filter((g) => !mine.has(g))).size;
    this.refs.groupingSummary?.setText(this.grouping.loading ? t("groups.aiLoading") : t("grouping.summary", { changed: changed.length, notes, fresh }));
    this.refs.groupingAccept?.setText(t("grouping.accept", { n: changed.length }));
  }

  get settings() { return this.plugin.data.settings; }

  async update(key, value) {
    if (key === "mode") this.grouping = null;   // another tab ends grouping mode
    this.settings[key] = value;
    this.visible = PAGE_SIZE;
    await this.plugin.saveData(this.plugin.data);
    this.render();
  }

  render() {
    const root = this.contentEl;
    root.empty();
    this.keep.clear();
    this.refs = { counts: {} };
    this.renderModes(root.createDiv({ cls: "pdt-seg" }));
    this.renderFilters(root.createDiv({ cls: "pdt-filters" }));
    this.refs.status = root.createDiv({ cls: "pdt-status" });
    this.refs.list = root.createDiv({ cls: "pdt-list" });
    this.refresh();
  }

  refresh() {
    if (!this.refs.list) return;
    const now = Date.now();
    const state = this.plugin.state();
    if (this.plugin.catalog) {
      const counts = modeCounts(state, this.settings, now);
      for (const [mode, el] of Object.entries(this.refs.counts)) el.setText(formatCount(counts[mode]));
      const updates = this.plugin.updatesCount(state, now);
      this.refs.updates?.setText(updates ? t("tracked.updatesBadge", { n: updates }) : "");
      this.refs.updates?.toggleClass("is-hidden", !updates);
    }
    this.renderStatus(this.refs.status);
    this.renderList(this.refs.list, state, now);
  }

  renderModes(seg) {
    const tipVars = { days: this.settings.days, gap: this.settings.dormantDays };
    for (const mode of MODE_KEYS) {
      const tab = seg.createDiv({ cls: `pdt-tab${mode === this.settings.mode ? " is-active" : ""}`, attr: { role: "tab", tabindex: "0" } });
      tab.createSpan({ text: t(`mode.${mode}`) });
      this.refs.counts[mode] = tab.createSpan({ cls: "pdt-n", text: "…" });
      if (mode === "tracked") this.refs.updates = tab.createSpan({ cls: "pdt-n is-updates is-hidden" });
      setTooltip(tab, t(`tip.${mode}`, tipVars));
      tab.onclick = () => this.update("mode", mode);
      onActivate(tab, () => this.update("mode", mode));
    }
  }

  /** Tracked tab: one Group menu (All, New releases, Starred, Ungrouped, then your groups), Sections, Status. */
  renderTrackedBar(bar) {
    const settings = this.settings;
    const notes = [...this.plugin.notes.index.values()];
    const state = this.plugin.state();
    const options = [
      ["", t("tracked.allCount", { n: notes.length })],
      [UPDATES, t("tracked.updates", { n: this.plugin.updatesCount(state, Date.now()) })],
      [STARRED, t("tracked.starredCount", { n: notes.filter((n) => n.favorite).length })],
      [UNGROUPED, t("tracked.ungroupedCount", { n: notes.filter((n) => !n.groups.length).length })],
      ...this.plugin.notes.groups().map((g) => [g.name, `${g.name}  ${formatCount(g.count)}`]),
    ];
    menuChip(bar, t("tracked.group"), options, settings.trackedGroup, (value) => this.update("trackedGroup", value));
    if (!settings.trackedGroup) {
      const on = Boolean(settings.trackedSections);
      const el = bar.createDiv({ cls: `pdt-chip is-toggle${on ? " is-on" : ""}` });
      const button = el.createSpan({ cls: "pdt-toggle", attr: { role: "button", tabindex: "0", "aria-pressed": String(on) } });
      setIcon(button.createSpan({ cls: "pdt-toggle-check" }), "check");
      button.createSpan({ text: t("tracked.sections") });
      button.onclick = () => this.update("trackedSections", !on);
      onActivate(button, () => this.update("trackedSections", !on));
    }
    if (settings.statusEnabled) {
      menuChip(bar, t("tracked.status"), [["", t("tracked.anyStatus")], ...settings.statuses.map((st) => [st.key, st.label])],
        settings.trackedStatus, (value) => this.update("trackedStatus", value));
    }
  }

  /** Saves a per-tab setting (downloadFilter, sortBy) for the current tab. */
  updateTab(key, value) {
    return this.update(key, { ...this.settings[key], [this.settings.mode]: value });
  }

  renderFilters(bar) {
    const mode = this.settings.mode;
    if (mode === SIMILAR_MODE) return this.renderSimilarBar(bar);
    const opts = modeOptions(this.settings, mode);
    if (mode === "tracked") this.renderTrackedBar(bar);
    const days = { label: t("filter.last"), unit: t("filter.daysUnit"), min: 1, max: 365, presets: DAY_PRESETS };

    if (mode === "new" || mode === "updated" || mode === "awakened") {
      numberChip(bar, { ...days, value: this.settings.days, onChange: (n) => this.update("days", n) });
    }
    if (mode === "awakened") {
      numberChip(bar, { ...days, label: t("filter.gap"), max: 3650, presets: DORMANT_PRESETS, value: this.settings.dormantDays, onChange: (n) => this.update("dormantDays", n) });
    }
    if (mode !== "new") toggleChip(bar, {
      label: t("filter.downloads"),
      value: this.settings.minDownloads,
      on: opts.filterDownloads,
      onToggle: (on) => this.updateTab("downloadFilter", on),
      onValue: async (n) => {
        this.settings.minDownloads = n;
        await this.updateTab("downloadFilter", true);
      },
    });

    const sort = bar.createDiv({ cls: "pdt-sort" });
    menuChip(sort, t("filter.sort"), SORT_KEYS.map((key) => [key, t(`sort.${key}`)]), opts.sort,
      (key) => this.updateTab("sortBy", { key, dir: NATURAL_DIR[key] }));
    const ascending = opts.sortDir === "asc";
    const tip = t(`sort.${opts.sort === "name" ? (ascending ? "az" : "za") : ascending ? "asc" : "desc"}`);
    iconButton(sort, ascending ? "arrow-up-narrow-wide" : "arrow-down-wide-narrow", tip, "pdt-sort-dir").onclick =
      () => this.updateTab("sortBy", { key: opts.sort, dir: ascending ? "desc" : "asc" });

    this.refs.search = this.renderSearch(bar, this.settings.query, t("search.placeholder"), async (value) => {
      this.settings.query = value;
      this.visible = PAGE_SIZE;
      this.refresh();
      await this.plugin.saveData(this.plugin.data);
    });

    if (mode === "tracked" && this.settings.trackedGroup === UPDATES) {
      const all = bar.createEl("button", { cls: "pdt-ghost", text: t("changed.markAll") });
      all.onclick = async () => { await this.plugin.markReviewed(this.rows || []); this.refresh(); };
    }
    if (!LIST_MODES.includes(mode)) this.renderLayoutSwitch(bar);
    if (this.settings.keyboard) this.renderKeyHelp(bar);
  }

  /** The search box (comma terms or /regex/); `onChange` runs 250 ms after typing stops. Returns the input. */
  renderSearch(bar, value, placeholder, onChange) {
    const search = bar.createDiv({ cls: "pdt-search" });
    setIcon(search.createSpan({ cls: "pdt-search-icon" }), "search");
    const input = search.createEl("input", { type: "search", placeholder, value });
    const badge = search.createSpan({ cls: "pdt-regex", text: ".*" });
    setTooltip(badge, t("search.regex"));
    const mark = () => {
      const { regex, error } = compileQuery(input.value);
      search.toggleClass("is-regex", regex && !error);
      search.toggleClass("is-invalid", Boolean(error));
    };
    mark();
    let timer;
    input.oninput = () => {
      mark();
      clearTimeout(timer);
      timer = setTimeout(() => onChange(input.value), 250);
    };
    return input;
  }

  /** The Similar list's bar: sort (by meaning first), direction, a search within the results, shortcuts. */
  renderSimilarBar(bar) {
    const { key, dir } = this.settings.similarSort;
    const sort = bar.createDiv({ cls: "pdt-sort" });
    menuChip(sort, t("filter.sort"), SIMILAR_SORT_KEYS.map((k) => [k, t(`sort.${k}`)]), key,
      (k) => this.update("similarSort", { key: k, dir: NATURAL_DIR[k] || "desc" }));
    const ascending = dir === "asc";
    const tip = t(`sort.${key === "name" ? (ascending ? "az" : "za") : ascending ? "asc" : "desc"}`);
    iconButton(sort, ascending ? "arrow-up-narrow-wide" : "arrow-down-wide-narrow", tip, "pdt-sort-dir").onclick =
      () => this.update("similarSort", { key, dir: ascending ? "desc" : "asc" });
    const seed = this.plugin.pluginById(this.settings.similarTrail.at(-1));
    const n = seed ? this.plugin.similarTo(seed).length : 0;
    this.renderSearch(bar, this.similarQuery, t("similar.search", { n }), (value) => {
      this.similarQuery = value;
      this.refresh();
    });
    this.renderLayoutSwitch(bar);
    if (this.settings.keyboard) this.renderKeyHelp(bar);
  }

  /** ⌨ icon with a card of the shortcuts, shown on hover or keyboard focus. */
  renderKeyHelp(bar) {
    const help = bar.createDiv({ cls: "pdt-keys", attr: { tabindex: "0", "aria-label": t("keys.title") } });
    setIcon(help.createSpan({ cls: "pdt-keys-icon" }), "keyboard");
    const card = help.createDiv({ cls: "pdt-keys-card", attr: { role: "tooltip" } });
    card.createDiv({ cls: "pdt-keys-title", text: t("keys.title") });
    for (const [keys, label] of KEY_HELP) {
      const line = card.createDiv({ cls: "pdt-keys-row" });
      const cell = line.createSpan({ cls: "pdt-keys-keys" });
      for (const key of keys) cell.createEl("kbd", { text: key });
      line.createSpan({ text: t(label) });
    }
  }

  renderStatus(status) {
    const { catalog, timeline } = this.plugin;
    status.empty();
    const text = status.createDiv({ cls: "pdt-status-text" });
    const now = Date.now();
    if (!catalog) {
      text.setText(this.plugin.busy ? this.plugin.progress || t("status.syncing") : t("status.loading"));
    } else {
      text.createDiv({
        text: [
          t("status.plugins", { n: formatCount(catalog.plugins.length) }),
          t("status.lastSync", { time: formatTime(catalog.fetchedAt, now), age: formatAge(now - catalog.fetchedAt) }),
          timeline.to ? t("status.history", { label: historyLabel(timeline.months) }) : t("status.noHistory"),
        ].join("  ·  "),
      });
      const { delta } = catalog;
      if (this.plugin.busy) text.createDiv({ cls: "pdt-progress", text: this.plugin.progress || t("status.syncing") });
      else if (delta) text.createDiv({ cls: "pdt-delta", text: t("status.delta", { added: formatCount(delta.added), updated: formatCount(delta.updated) }) });
    }
    const query = this.settings.mode === SIMILAR_MODE ? "" : this.settings.query.trim();   // the Similar list ignores the search
    if (query) {  // a saved search shouldn't be forgotten: this is why the list is short
      const { error } = compileQuery(query);
      const tag = status.createDiv({ cls: `pdt-query${error ? " is-invalid" : ""}` });
      tag.createSpan({ text: error ? t("search.invalid", { error }) : t("status.query", { q: query }) });
      const clear = tag.createSpan({ cls: "pdt-query-clear", text: t("status.clear"), attr: { role: "button", tabindex: "0" } });
      clear.onclick = async () => {
        this.settings.query = "";
        if (this.refs.search) this.refs.search.value = "";
        this.visible = PAGE_SIZE;
        this.refresh();
        await this.plugin.saveData(this.plugin.data);
      };
      onActivate(clear, () => clear.click());
    }
    const actions = status.createDiv({ cls: "pdt-status-actions" });
    if (!timeline.to || timeline.legacy) {
      actions.createEl("button", { cls: "mod-cta", text: t(timeline.to ? "status.rebuild" : "status.build") })
        .onclick = () => this.plugin.buildHistory(true);
    }
  }

  /** Redraws only the status line (progress updates during a sync). */
  refreshStatus() {
    if (this.refs.status) this.renderStatus(this.refs.status);
  }

  renderList(list, state, now) {
    list.empty();
    this.rows = [];
    this.cards = this.settings.layout === "cards" && !this.grouping && !LIST_MODES.includes(this.settings.mode);
    list.toggleClass("is-cards", this.cards);
    if (!this.plugin.catalog) return;
    if (this.grouping) return this.renderGrouping(list, now);
    const { timeline } = this.plugin;
    const mode = this.settings.mode;
    if (mode === SIMILAR_MODE) return this.renderSimilarList(list, now);
    if (mode === "awakened" && !timeline.to) {
      list.createDiv({ cls: "pdt-empty", text: t("list.needHistory") });
      return;
    }
    if (mode === "new" && (!timeline.to || timeline.legacy)) list.createDiv({ cls: "pdt-hint", text: t("list.legacyHint") });

    this.rows = discover(state, modeOptions(this.settings, mode), now);
    this.stale = new Set();
    for (const [id, index] of this.keep) {
      const p = this.rows.some((r) => r.id === id) ? null : this.plugin.pluginById(id);
      if (!p) continue;
      this.rows.splice(Math.min(index, this.rows.length), 0, p);
      this.stale.add(id);
    }
    if (LIST_MODES.includes(mode)) this.renderListBanner(list, mode);
    const sections = mode === "tracked" && !this.settings.trackedGroup && this.settings.trackedSections;
    const visible = sections ? this.rows : this.rows.slice(0, this.visible);   // sections show everything you track
    if (!this.rows.length) {
      list.createDiv({ cls: "pdt-empty", text: t("list.empty") });
      return;
    }
    if (sections) {
      for (const section of groupSections(this.rows, state.notes)) this.renderSection(list, section, now);
      return;
    }
    for (const plugin of visible) this.renderRow(list, plugin, now);
    if (this.rows.length > this.visible) {
      const more = list.createEl("button", {
        cls: "pdt-more",
        text: t("list.more", { n: Math.min(PAGE_SIZE, this.rows.length - this.visible), total: formatCount(this.rows.length), shown: this.visible }),
      });
      more.onclick = () => { this.visible += PAGE_SIZE; this.refresh(); };
    }
  }

  /** Ignored / Hidden suggestions: title, back, and "restore all shown" (asks for a second click). */
  renderListBanner(list, mode) {
    const banner = list.createDiv({ cls: "pdt-banner" });
    const total = mode === "ignored" ? this.plugin.ignoredCount() : Object.keys(this.plugin.data.dismissed).length;
    banner.createSpan({ cls: "pdt-banner-title", text: t(mode === "ignored" ? "list.ignoredTitle" : "list.dismissedTitle", { n: formatCount(total) }) });
    const back = banner.createEl("button", { text: t("list.back"), attr: { type: "button" } });
    back.onclick = () => this.update("mode", "all");
    if (!this.rows.length) return;
    const all = banner.createEl("button", { cls: "mod-warning", text: t("list.restoreAll", { n: this.rows.length }), attr: { type: "button" } });
    let armed = false;
    all.onclick = async () => {
      if (!armed) {
        armed = true;
        all.setText(t("list.restoreConfirm", { n: this.rows.length }));
        setTimeout(() => { armed = false; all.setText(t("list.restoreAll", { n: this.rows.length })); }, 4000);
        return;
      }
      await this.plugin.restoreFrom(mode, this.rows.map((p) => p.id));
    };
  }

  /** One Tracked-tab section: a coloured, foldable group heading and its rows, indented on a rail. */
  renderSection(list, { name, rows }, now) {
    const label = name === UNGROUPED ? t("tracked.ungrouped") : name;
    const open = !this.collapsed.has(name);
    const section = list.createDiv({ cls: `pdt-section${name === UNGROUPED ? "" : ` pdt-hue-${groupHue(name)}`}` });
    const head = section.createEl("button", { cls: "pdt-section-head", attr: { type: "button", "aria-expanded": String(open) } });
    setIcon(head.createSpan({ cls: `pdt-section-caret${open ? "" : " is-closed"}` }), "chevron-down");
    head.createSpan({ cls: "pdt-swatch" });
    head.createSpan({ cls: "pdt-section-name", text: label });
    head.createSpan({ cls: "pdt-section-count", text: formatCount(rows.length) });
    head.createSpan({ cls: "pdt-section-rule" });
    head.onclick = () => {
      if (open) this.collapsed.add(name); else this.collapsed.delete(name);
      this.refresh();
    };
    if (!open) return;
    const body = section.createDiv({ cls: "pdt-section-body" });
    for (const p of rows) this.renderRow(body, p, now);
  }

  /** The preview under a row: the best few matches, why they match, and the way into the full list. */
  renderSimilar(parent, p) {
    const box = parent.createDiv({ cls: "pdt-similar" });
    box.createDiv({ cls: "pdt-gm-label", text: t("similar.title"), attr: { lang: language } });
    const found = this.plugin.similarTo(p);
    if (!found.length) {
      box.createDiv({ cls: "pdt-gm-note", text: t("similar.none") });
      return;
    }
    for (const x of found.slice(0, SIMILAR_PREVIEW)) {
      const item = box.createDiv({ cls: "pdt-similar-item" });
      const head = item.createDiv({ cls: "pdt-similar-head" });
      head.createEl("a", { cls: "pdt-similar-name", text: x.p.name, href: `obsidian://show-plugin?id=${encodeURIComponent(x.p.id)}` });
      this.renderTerms(head, x.shared.slice(0, 3));
      if (x.p.downloads != null) {
        const dl = head.createSpan({ cls: "pdt-similar-dl" });
        setIcon(dl.createSpan({ cls: "pdt-dl-icon" }), "download");
        dl.createSpan({ text: formatShort(x.p.downloads) });
      }
      if (x.p.description) item.createDiv({ cls: "pdt-similar-desc", text: x.p.description });
    }
    const all = box.createEl("button", { cls: "pdt-similar-all", text: t("similar.seeAll", { n: found.length }), attr: { type: "button" } });
    setIcon(all.createSpan({ cls: "pdt-similar-all-icon" }), "arrow-right");
    all.onclick = () => this.openSimilar(p);
  }

  /** Opens the Similar list for `p`; inside it, adds `p` to the trail (or steps back to it). */
  async openSimilar(p) {
    const settings = this.settings;
    const trail = settings.mode === SIMILAR_MODE ? settings.similarTrail : [];
    const at = trail.indexOf(p.id);
    if (settings.mode !== SIMILAR_MODE) settings.similarFrom = settings.mode;
    settings.similarTrail = at === -1 ? [...trail, p.id] : trail.slice(0, at + 1);
    this.similarOpen.delete(p.id);
    this.similarQuery = "";
    await this.update("mode", SIMILAR_MODE);
    this.contentEl.scrollTop = 0;
  }

  /** The Similar list: plugins like the last one of the trail, closest first (or as sorted), each with why it matches. */
  renderSimilarList(list, now) {
    const trail = this.settings.similarTrail.map((id) => this.plugin.pluginById(id)).filter(Boolean);
    const seed = trail.at(-1);
    const found = seed ? this.plugin.similarTo(seed) : [];
    this.renderTrail(list, trail, found);
    this.stale = new Set();
    this.similarInfo = new Map(found.map((x) => [x.p.id, x]));
    const query = compileQuery(this.similarQuery);
    const { key, dir } = this.settings.similarSort;
    const matching = found.map((x) => x.p).filter((p) => query.test(p));
    const { catalog, releases, notes } = this.plugin.state();
    this.rows = key === "relevance" ? (dir === "asc" ? matching.reverse() : matching) : sortRows(matching, key, dir, catalog, releases, notes);
    if (!this.rows.length) {
      list.createDiv({ cls: "pdt-empty", text: t(found.length ? "list.empty" : "similar.none") });
      return;
    }
    for (const p of this.rows) this.renderRow(list, p, now);
  }

  /**
   * The Similar list's head: the trail (its first step is the tab you came from), the title with the
   * number of matches and how they were found, and the plugin's description.
   */
  renderTrail(list, trail, found) {
    const seed = trail.at(-1);
    const from = this.settings.similarFrom || "all";
    const nav = list.createEl("nav", { cls: "pdt-trail", attr: { "aria-label": t("similar.trail") } });
    const home = nav.createEl("button", { cls: "pdt-trail-step is-home", attr: { type: "button" } });
    setIcon(home.createSpan({ cls: "pdt-trail-icon" }), "arrow-left");
    home.createSpan({ text: MODE_KEYS.includes(from) ? t(`mode.${from}`) : t("list.back") });
    home.onclick = () => this.update("mode", from);
    trail.forEach((p, i) => {
      setIcon(nav.createSpan({ cls: "pdt-trail-sep" }), "chevron-right");
      const current = i === trail.length - 1;
      const step = nav.createEl("button", { cls: `pdt-trail-step${current ? " is-current" : ""}`, text: p.name, attr: { type: "button" } });
      if (current) step.setAttribute("aria-current", "page");
      else step.onclick = () => this.update("similarTrail", this.settings.similarTrail.slice(0, i + 1));
    });
    const head = list.createDiv({ cls: "pdt-similar-head-box" });
    const title = head.createDiv({ cls: "pdt-similar-title" });
    title.createSpan({ cls: "pdt-similar-title-text", text: t("similar.listTitle", { name: seed?.name ?? "–" }) });
    title.createSpan({ cls: "pdt-similar-count", text: t("similar.count", { n: found.length }) });
    title.createSpan({ cls: "pdt-similar-method", text: t(found[0]?.cosine != null ? "similar.byMeaning" : "similar.byWords") });
    if (seed?.description) head.createDiv({ cls: "pdt-similar-seed", text: seed.description });
  }

  /** The shared terms of a match, as small tags. */
  renderTerms(parent, terms) {
    if (!terms.length) return;
    const box = parent.createSpan({ cls: "pdt-terms", attr: { "aria-label": t("similar.why") } });
    for (const term of terms) box.createSpan({ cls: "pdt-term", text: term });
  }

  /** A Similar-list row's reason: how close it is within the list (bar and word) and what it shares. */
  renderWhy(parent, { match, shared, cosine }) {
    const pct = Math.round(match * 100);
    const label = t(closeness(match));
    const why = parent.createDiv({ cls: "pdt-why" });
    const meter = why.createSpan({ cls: "pdt-why-meter", attr: { role: "meter", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct), "aria-label": label } });
    meter.createSpan({ cls: "pdt-why-fill" }).setCssProps({ "--pdt-match": `${Math.max(pct, 6)}%` });
    setTooltip(meter, cosine != null ? t("similar.cosineTip", { cosine: decimal(cosine, 2) }) : t("similar.match", { pct }));
    why.createSpan({ cls: "pdt-why-label", text: label });
    if (shared.length) why.createSpan({ cls: "pdt-why-common", text: t("similar.why") });
    this.renderTerms(why, shared);
  }

  /**
   * One plugin, as a list row or a card (the same markup; CSS places the parts):
   * head (name, version) · metrics (updated, downloads) · tags (system signals, your note) ·
   * body (description, translation, why it's similar) · links · actions · more (Similar preview, grouping).
   * Clicking the description (or the card) opens the details window.
   */
  renderRow(list, p, now) {
    const plugin = this.plugin;
    const { firstSeen, releases } = plugin.timeline;
    const note = plugin.notes.index.get(p.id);
    const mode = this.settings.mode;
    const stale = this.stale?.has(p.id);
    const row = list.createDiv({ cls: `pdt-row${p.id === this.cursorId ? " is-cursor" : ""}${stale ? " is-stale" : ""}`, attr: { tabindex: "0", "data-id": p.id } });
    row.addEventListener("click", (event) => {
      this.setCursor(row);
      // a card opens its details from anywhere that isn't a control
      if (this.cards && !event.target.closest("a, button, input, [role=button], .pdt-rate, .pdt-similar")) this.openDetails(p);
    });

    const head = row.createDiv({ cls: "pdt-head" });
    head.createEl("a", { cls: "pdt-name", text: p.name, href: `obsidian://show-plugin?id=${encodeURIComponent(p.id)}` });
    if (p.version) head.createSpan({ cls: "pdt-ver", text: p.version });
    if (p.author) head.createSpan({ cls: "pdt-author", text: p.author });

    // metrics: when it was updated, then downloads at the edge (a straight column down the list)
    const metrics = row.createDiv({ cls: "pdt-metrics" });
    const seen = firstSeen[p.id];
    metrics.createSpan({ cls: "pdt-when", text: p.updated ? relativeDays(p.updated, now) : seen > 0 ? t("row.added", { when: relativeDays(seen, now) }) : t("row.justListed") });
    const downloads = metrics.createSpan({ cls: `pdt-downloads${p.downloads == null ? " is-empty" : ""}` });
    if (p.downloads == null) {
      downloads.setText(t("row.noStats"));
    } else {
      setIcon(downloads.createSpan({ cls: "pdt-dl-icon" }), "download");
      downloads.createSpan({ text: formatShort(p.downloads) });
      setTooltip(downloads, t("row.downloads", { n: formatCount(p.downloads) }));
    }

    // tags: system signals, then your note (note link, groups, status, rating)
    const tags = row.createDiv({ cls: "pdt-tags" });
    const signal = (cls, text) => tags.createSpan({ cls: `pdt-signal ${cls}`, text });
    if (isNewPlugin(firstSeen, p, now)) signal("is-new", t("badge.new"));
    if (isChanged(p, note)) signal("is-changed", t("badge.changed"));
    if (plugin.installed().has(p.id)) signal("is-installed", t("badge.installed"));
    if (isSnoozed(p, plugin.data.snoozed)) signal("is-snoozed", t("badge.snoozed"));
    if (stale) signal("is-stale", t("row.stale"));
    // the pause before the latest release matters only when it was long (and always on the Revived tab)
    const gap = plugin.timeline.to && p.updated ? dormantDays(releases, p) : null;
    if (gap != null && (mode === "awakened" || gap >= this.settings.dormantDays)) signal("is-dormant", t("row.dormantFor", { n: gap }));
    if (note) {
      const link = tags.createSpan({ cls: "pdt-pill is-note", text: t("badge.note"), attr: { role: "button", tabindex: "0" } });
      setTooltip(link, t("badge.openNote"));
      const open = () => this.app.workspace.openLinkText(note.path, "", "tab");
      link.onclick = open;
      onActivate(link, open);
      for (const g of note.groups) {
        const badge = tags.createSpan({ cls: `pdt-pill is-group pdt-hue-${groupHue(g)}`, text: g, attr: { role: "button", tabindex: "0" } });
        setTooltip(badge, t("tracked.showGroup", { group: g }));
        const show = () => this.plugin.showGroup(g);
        badge.onclick = show;
        onActivate(badge, show);
      }
      this.renderNoteState(tags, p, note, mode === "tracked");
    }
    if (!tags.childElementCount) tags.remove();

    // body: description (two lines; a click opens the details), its translation, why it's similar
    const body = row.createDiv({ cls: "pdt-body" });
    const desc = body.createEl("p", { cls: "pdt-desc", text: p.description || "–", attr: { role: "button", tabindex: "0" } });
    setTooltip(desc, t("details.open"));
    desc.onclick = () => this.openDetails(p);
    onActivate(desc, () => this.openDetails(p));
    const translation = plugin.cachedTranslation(p);
    const showing = translation != null && this.shownTranslations.has(p.id);
    if (showing) body.createDiv({ cls: "pdt-trans", text: translation });
    const inSimilar = mode === SIMILAR_MODE;
    const info = inSimilar && this.similarInfo?.get(p.id);
    if (info) this.renderWhy(body, info);

    const links = row.createDiv({ cls: "pdt-meta" });
    const link = (cls, text, icon, onClick, href = "#") => {
      const a = links.createEl("a", { cls, text, href });
      if (icon) setIcon(a.createSpan({ cls: "pdt-gh-icon" }), icon);
      if (onClick) a.onclick = (event) => { event.preventDefault(); onClick(); };
      return a;
    };
    if (p.repo) {
      setTooltip(link("pdt-readme", t("row.readme"), "file-text", () => plugin.openReadme(p)), t(note ? "row.readmeOpen" : "row.readmeCreate"));
      link("pdt-gh", "GitHub", "external-link", null, `https://github.com/${p.repo}`);
    }
    // in the Similar list it goes one step further down the trail; elsewhere it opens a preview
    const similarOpen = !inSimilar && this.similarOpen.has(p.id);
    const similar = link(`pdt-readme pdt-similar-link${similarOpen ? " is-open" : ""}`, t("row.similar"),
      inSimilar ? "arrow-right" : similarOpen ? "chevron-up" : "chevron-down", () => {
        if (inSimilar) return this.openSimilar(p);
        if (similarOpen) this.similarOpen.delete(p.id); else this.similarOpen.add(p.id);
        this.refresh();
      });
    if (!inSimilar) similar.setAttribute("aria-expanded", String(similarOpen));
    setTooltip(similar, t(inSimilar ? "similar.nextTip" : "row.similarTip"));
    if (p.description) {
      link("pdt-readme pdt-tr", showing ? t("translate.hide") : t("translate.row"), "languages", async () => {
        if (showing) this.shownTranslations.delete(p.id);
        else if (translation != null || (await plugin.translateRows([p]))) this.shownTranslations.add(p.id);
        this.refresh();
      });
    }

    if (this.grouping) {   // grouping mode: the row's group chips take the place of its actions
      this.groupingRows.set(p.id, { row, box: row.createDiv({ cls: "pdt-extra pdt-grouping-chips pdt-gm-chips" }) });
      this.renderGroupingChips(p.id);
      return;
    }
    const actions = row.createDiv({ cls: "pdt-actions" });
    const act = (icon, tip, fn, cls = "", keep = false) => {
      const button = iconButton(actions, icon, tip, cls);
      button.onclick = async () => {
        if (button.hasClass("is-busy")) return;  // a quick double click must not run the action twice
        button.addClass("is-busy");
        if (keep) await this.runRowAction(p, fn);
        else { await fn(); this.refresh(); }
      };
      return button;
    };
    if (similarOpen) this.renderSimilar(row.createDiv({ cls: "pdt-extra" }), p);
    if (LIST_MODES.includes(mode)) {
      act("undo-2", t("action.restore"), () => plugin.restoreFrom(mode, [p.id]));
      return;
    }
    if (isChanged(p, note)) act("check", t("action.reviewed"), () => plugin.markReviewed([p]), "", true);
    this.renderStar(actions, act, p, note);
    act("folder-plus", note?.groups.length ? t("action.groupNamed", { group: note.groups.join(", ") }) : t("action.group"), () => plugin.chooseGroup(p), "", true);
    if (mode === "suggested") act("x", t("action.dismiss"), () => plugin.dismiss(p));
    else {
      act("eye-off", t("action.snooze"), () => plugin.snooze(p));
      act("ban", t("action.exclude"), () => plugin.exclude(p));
    }
  }

  /** Opens the details window of `p`; ←/→ in it walks the current list. */
  openDetails(p) {
    const rows = this.rows?.some((r) => r.id === p.id) ? this.rows : [p];
    const origin = [...this.contentEl.querySelectorAll(".pdt-row")].find((r) => r.dataset.id === p.id);
    new DetailModal(this, rows, rows.findIndex((r) => r.id === p.id), origin).open();
  }

  /** List / Card switch. */
  renderLayoutSwitch(bar) {
    const box = bar.createDiv({ cls: "pdt-layout", attr: { role: "group", "aria-label": t("layout.label") } });
    for (const [value, icon] of [["list", "list"], ["cards", "layout-grid"]]) {
      const button = box.createEl("button", { cls: "pdt-layout-option", attr: { type: "button", "aria-pressed": String(this.settings.layout === value) } });
      setIcon(button.createSpan(), icon);
      button.createSpan({ text: t(`layout.${value}`) });
      button.onclick = () => this.update("layout", value);
    }
  }

  /** Runs a row action and keeps the row where it was even if it no longer matches the filter. */
  async runRowAction(p, fn) {
    const index = (this.rows || []).findIndex((r) => r.id === p.id);
    await fn();
    if (index !== -1) this.keep.set(p.id, index);
    this.refresh();
  }

  /** The star: a click toggles the favourite; hovering or focusing it opens 1–5 stars to rate. */
  renderStar(actions, act, p, note) {
    const box = actions.createDiv({ cls: "pdt-rate" });
    const star = act("star", t(note?.favorite ? "action.unfavorite" : "action.favorite"), () => this.plugin.toggleFavorite(p), note?.favorite ? "is-favorite" : "", true);
    box.appendChild(star);
    const pop = box.createDiv({ cls: "pdt-rate-pop", attr: { role: "group", "aria-label": t("rating.set") } });
    const stars = pop.createDiv({ cls: "pdt-rate-stars" });   // laid out in reverse so hovering fills a star and those before it
    for (let n = 5; n >= 1; n--) {
      const button = stars.createEl("button", { cls: `pdt-rate-star${(note?.rating || 0) >= n ? " is-on" : ""}`, text: "★", attr: { type: "button", "aria-label": t("rating.label", { n }) } });
      button.onclick = () => this.runRowAction(p, () => this.plugin.setNoteField(p, "rating", n));
    }
    if (note?.rating) {
      const clear = pop.createEl("button", { cls: "pdt-rate-clear", text: t("rating.clear"), attr: { type: "button" } });
      clear.onclick = () => this.runRowAction(p, () => this.plugin.setNoteField(p, "rating", null));
    }
  }

  /** Status (when the field is on) and rating chips of a tracked plugin; empty ones only on the Tracked tab. */
  renderNoteState(parent, p, note, always) {
    const { statusEnabled, statuses } = this.settings;
    if (statusEnabled && (note.status || always)) {
      const known = statuses.find((st) => st.key === note.status);
      const options = [["", t("pstatus.clear")], ...statuses.map((st) => [st.key, st.label])];
      const chip = parent.createSpan({ cls: `pdt-pill is-status${note.status ? "" : " is-empty"}`, text: note.status ? known?.label || note.status : t("pstatus.set"), attr: { role: "button", tabindex: "0" } });
      const open = () => this.pickFromMenu(chip, options, note.status, (value) => this.runRowAction(p, () => this.plugin.setNoteField(p, "status", value || null)));
      chip.onclick = open;
      onActivate(chip, open);
    }
    if (note.rating || always) {
      const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);
      const options = [[0, t("rating.clear")], ...[5, 4, 3, 2, 1].map((n) => [n, stars(n)])];
      const chip = parent.createSpan({ cls: `pdt-pill is-rating${note.rating ? "" : " is-empty"}`, text: note.rating ? stars(note.rating) : t("rating.set"), attr: { role: "button", tabindex: "0", "aria-label": note.rating ? t("rating.label", { n: note.rating }) : t("rating.set") } });
      const open = () => this.pickFromMenu(chip, options, note.rating, (value) => this.runRowAction(p, () => this.plugin.setNoteField(p, "rating", value || null)));
      chip.onclick = open;
      onActivate(chip, open);
    }
  }

  pickFromMenu(anchor, options, current, onPick) {
    const menu = new Menu();
    for (const [value, title] of options) {
      menu.addItem((item) => item.setTitle(title).setChecked(value === current).onClick(async () => {
        await onPick(value);
        this.refresh();
      }));
    }
    const rect = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  }
}

class RadarSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.modelList = null;
  }

  display() {
    const { containerEl } = this;
    const plugin = this.plugin;
    const settings = plugin.data.settings;
    const save = () => plugin.saveData(plugin.data);
    containerEl.empty();

    new Setting(containerEl)
      .setName(t("set.language"))
      .setDesc(t("set.languageDesc"))
      .addDropdown((d) => {
        d.addOption("auto", t("set.languageAuto", { name: STRINGS[matchLanguage(obsidianLanguage())]["language.name"] }));
        for (const [code, strings] of Object.entries(STRINGS)) d.addOption(code, strings["language.name"]);
        d.setValue(settings.language).onChange(async (value) => {
          settings.language = value;
          await save();
          setLanguage(plugin.uiLanguage());
          plugin.redraw(true);
          this.display();
        });
      });

    new Setting(containerEl)
      .setName(t("set.folder"))
      .setDesc(t("set.folderDesc"))
      .addText((text) => text.setValue(settings.folder).onChange(async (value) => {
        settings.folder = value.trim() || defaultSettings().folder;
        await save();
        plugin.notes.rebuild();
      }));

    new Setting(containerEl)
      .setName(t("set.notesHeading"))
      .setDesc(t("set.notesHeadingDesc"))
      .addText((text) => text.setPlaceholder(t("note.myNotes")).setValue(settings.notesHeading).onChange(async (value) => {
        settings.notesHeading = value.trim();
        await save();
      }));

    new Setting(containerEl)
      .setName(t("set.readmeTranslation"))
      .setDesc(t("set.readmeTranslationDesc"))
      .addDropdown((d) => d.addOption("ask", t("set.readmeTranslationAsk")).addOption("off", t("set.readmeTranslationOff"))
        .setValue(settings.readmeTranslation).onChange(async (value) => {
          settings.readmeTranslation = value;
          await save();
        }));

    const basePath = plugin.basePath();
    const baseExists = Boolean(this.app.vault.getAbstractFileByPath(basePath));
    new Setting(containerEl)
      .setName(t("set.base"))
      .setDesc(t("set.baseDesc", { path: basePath }))
      .addButton((b) => {
        b.setButtonText(t(baseExists ? "set.baseReset" : "set.baseCreate"));
        if (baseExists) b.setWarning();
        b.onClick(async () => {
          await plugin.writeBase();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName(t("set.keyboard"))
      .setDesc(t("set.keyboardDesc"))
      .addToggle((toggle) => toggle.setValue(Boolean(settings.keyboard)).onChange(async (value) => {
        settings.keyboard = value;
        await save();
        plugin.redraw(true);
      }));

    this.displayStatuses(containerEl, settings, save);

    // ── Groups
    new Setting(containerEl).setName(t("set.groups")).setHeading();
    const ungrouped = plugin.ungrouped().length;
    new Setting(containerEl)
      .setName(t("set.batch"))
      .setDesc(t("set.batchDesc", { n: ungrouped }))
      .addButton((b) => b.setButtonText(t("set.batchButton")).setCta().setDisabled(!ungrouped).onClick(() => plugin.groupUngrouped()));

    // ── Sync
    new Setting(containerEl).setName(t("set.sync")).setHeading();
    new Setting(containerEl)
      .setName(t("set.syncHours"))
      .setDesc(t("set.syncHoursDesc"))
      .addDropdown((d) => {
        for (const hours of SYNC_HOURS) d.addOption(String(hours), t(`sync.${hours}`));
        d.setValue(String(settings.syncHours)).onChange(async (value) => {
          settings.syncHours = Number(value);
          await save();
        });
      });
    new Setting(containerEl)
      .setName(t("set.readmeMode"))
      .setDesc(t("set.readmeModeDesc"))
      .addDropdown((d) => {
        for (const mode of README_MODES) d.addOption(mode, t(`readmeMode.${mode}`));
        d.setValue(settings.readmeMode).onChange(async (value) => {
          settings.readmeMode = value;
          await save();
        });
      });
    const { catalog } = plugin;
    const now = Date.now();
    new Setting(containerEl)
      .setName(t("set.syncNow"))
      .setDesc(catalog ? t("set.lastSync", { time: formatTime(catalog.fetchedAt, now), age: formatAge(now - catalog.fetchedAt) }) : t("set.neverSynced"))
      .addButton((b) => b.setButtonText(t("set.syncNow")).setCta().onClick(async () => {
        b.setDisabled(true);
        await plugin.refresh();
        this.display();
      }));

    // ── Release history
    new Setting(containerEl).setName(t("set.history")).setHeading();
    const { timeline } = plugin;
    new Setting(containerEl)
      .setName(t("set.depth"))
      .setDesc(timeline.to
        ? t("set.depthDesc", { label: historyLabel(timeline.months), from: dayString(timeline.from), to: dayString(timeline.to) })
        : t("set.notBuilt"))
      .addDropdown((d) => {
        for (const months of HISTORY_MONTHS) d.addOption(String(months), historyLabel(months));
        d.setValue(String(settings.historyMonths)).onChange(async (value) => {
          settings.historyMonths = Number(value);
          await save();
          this.display();
        });
      })
      .addButton((b) => b.setButtonText(t("set.rebuild")).onClick(() => plugin.buildHistory(true)));

    this.displayTranslation(containerEl, settings, save);

    // ── Lists: managed in the view, with search and Restore (a settings list can't cope with thousands)
    new Setting(containerEl).setName(t("set.lists")).setHeading();
    new Setting(containerEl)
      .setName(t("set.excluded", { n: formatCount(plugin.ignoredCount()) }))
      .setDesc(t("set.listsDesc"))
      .addButton((b) => b.setButtonText(t("set.manage")).onClick(() => plugin.showList("ignored")));
    new Setting(containerEl)
      .setName(t("set.dismissed", { n: formatCount(Object.keys(plugin.data.dismissed).length) }))
      .addButton((b) => b.setButtonText(t("set.manage")).onClick(() => plugin.showList("dismissed")));

    if (plugin.manifest.fundingUrl) {
      new Setting(containerEl)
        .setName(t("set.support"))
        .setDesc(t("set.supportDesc"))
        .addButton((b) => b.setButtonText(t("set.sponsor")).onClick(() => window.open(plugin.manifest.fundingUrl)));
    }
  }

  /** The optional status field: on/off, then the list of statuses (label with an emoji, order, add, remove). */
  displayStatuses(containerEl, settings, save) {
    new Setting(containerEl)
      .setName(t("set.status"))
      .setDesc(t("set.statusDesc"))
      .addToggle((toggle) => toggle.setValue(Boolean(settings.statusEnabled)).onChange(async (value) => {
        settings.statusEnabled = value;
        await save();
        this.plugin.redraw(true);
        this.display();
      }));
    if (!settings.statusEnabled) return;
    const move = async (from, to) => {
      const list = [...settings.statuses];
      list.splice(to, 0, ...list.splice(from, 1));
      settings.statuses = list;
      await save();
      this.display();
    };
    settings.statuses.forEach((status, i) => {
      new Setting(containerEl)
        .setClass("pdt-status-setting")
        .setDesc(t("set.statusKey", { key: status.key }))
        .addText((text) => text.setValue(status.label).onChange(async (value) => {
          status.label = value.trim() || status.key;   // the key in your notes never changes
          await save();
        }))
        .addExtraButton((b) => b.setIcon("arrow-up").setTooltip(t("set.statusUp")).setDisabled(i === 0).onClick(() => move(i, i - 1)))
        .addExtraButton((b) => b.setIcon("arrow-down").setTooltip(t("set.statusDown")).setDisabled(i === settings.statuses.length - 1).onClick(() => move(i, i + 1)))
        .addExtraButton((b) => b.setIcon("trash-2").setTooltip(t("set.statusRemove")).onClick(async () => {
          settings.statuses = settings.statuses.filter((st) => st !== status);
          await save();
          this.display();
        }));
    });
    let draft = "";
    new Setting(containerEl)
      .setName(t("set.statusAdd"))
      .setDesc(t("set.statusAddDesc"))
      .addText((text) => text.setPlaceholder(t("set.statusPlaceholder")).onChange((value) => { draft = value; }))
      .addButton((b) => b.setButtonText(t("groups.add")).onClick(async () => {
        const label = draft.trim();
        if (!label) return;
        settings.statuses = [...settings.statuses, { key: statusKey(label, settings.statuses.map((st) => st.key)), label }];
        await save();
        this.display();
      }));
  }

  displayTranslation(containerEl, settings, save) {
    const plugin = this.plugin;
    const translator = plugin.translator;
    new Setting(containerEl).setName(t("set.translation")).setHeading();
    if (!translator.supported) {
      new Setting(containerEl).setDesc(t("set.needsKeychain"));
      return;
    }

    new Setting(containerEl)
      .setName(t("set.provider"))
      .addDropdown((d) => {
        d.addOption("", t("set.none"));
        for (const [id, spec] of Object.entries(PROVIDERS)) d.addOption(id, spec.label);
        d.setValue(settings.provider).onChange(async (value) => {
          Object.assign(settings, { provider: value, model: "", modelPrice: "" });
          this.modelList = null;
          await save();
          this.display();
        });
      });

    if (settings.provider) {
      const provider = settings.provider;
      const keySetting = new Setting(containerEl)
        .setName(t("set.key"))
        .setDesc(`${t("set.keyDesc", { name: KEY_NAMES[provider] })} ${t(translator.key() ? "set.keyFound" : "set.keyMissing")}`);
      new obsidian.SecretComponent(this.app, keySetting.controlEl)
        .setValue(translator.keyName(provider))
        .onChange(async (name) => {
          settings.keyNames = { ...settings.keyNames, [provider]: name || "" };
          this.modelList = null;
          await save();
          this.display();
        });

      const description = [
        settings.modelPrice ? t("set.modelPrice", { price: settings.modelPrice }) : "",
        this.modelList && provider !== "openrouter" ? t("set.noPrices") : "",
        t("set.modelHint"),
      ].filter(Boolean).join(" ");
      new Setting(containerEl)
        .setName(settings.model ? `${t("set.model")}: ${settings.model}` : t("set.model"))
        .setDesc(description)
        .addButton((b) => b.setButtonText(t("set.modelPick")).setCta().onClick(() => this.pickModel(settings, save)))
        .addButton((b) => b.setButtonText(t("set.modelTest")).setDisabled(!translator.ready).onClick(async () => {
          b.setDisabled(true);
          try {
            new Notice(t("notice.modelOk", { model: settings.model, sample: await translator.test() }));
          } catch (error) {
            new Notice(t("notice.modelFailed", { error: error.message }), 12000);
          }
          b.setDisabled(false);
        }));

      new Setting(containerEl)
        .setName(t("set.targetLang"))
        .addText((text) => text.setValue(settings.targetLang).onChange(async (value) => {
          settings.targetLang = value.trim() || defaultSettings().targetLang;
          await save();
        }));
    }

    const saved = Object.keys(plugin.data.translations).length;
    new Setting(containerEl)
      .setName(t("set.saved"))
      .setDesc(t("set.savedDesc", { n: formatCount(saved) }))
      .addButton((b) => b.setButtonText(t("set.delete")).setDisabled(!saved).onClick(async () => {
        plugin.data.translations = {};
        await save();
        this.display();
      }));
  }

  /** Loads the model list once (if it can), then opens the filtering picker; typed names are allowed. */
  async pickModel(settings, save) {
    if (!this.modelList) {
      try {
        this.modelList = await this.plugin.translator.models(settings.provider);
      } catch (error) {
        new Notice(t("notice.modelsFailed", { error: error.message }));
      }
    }
    const modal = new ModelModal(this.app, this.modelList || []);
    modal.open();
    const model = await modal.result;
    if (!model) return;
    Object.assign(settings, { model: model.id, modelPrice: formatPrice(model.price), modelCost: model.price || null });
    await save();
    this.display();
  }
}

// ─── 5. Plugin ──────────────────────────────────────────────────────────────
class PluginRadar extends Plugin {
  async onload() {
    addIcon(ICON, ICON_SVG);
    this.data = Object.assign({ excluded: {}, dismissed: {}, snoozed: {}, translations: {}, groupSuggestions: {}, migrations: {} }, await this.loadData());
    setLanguage(this.uiLanguage());  // before defaultSettings(), whose folder name depends on the language
    this.data.settings = Object.assign(defaultSettings(), this.data.settings);
    if (this.data.settings.mode === "changed") Object.assign(this.data.settings, { mode: "tracked", trackedGroup: UPDATES });   // 0.7.2's tab
    if (this.data.settings.mode === SIMILAR_MODE && !this.data.settings.similarTrail?.length) this.data.settings.mode = "all";
    this.github = new GitHub();
    this.cache = new Cache(this.app.vault.adapter, this.manifest.dir);
    this.notes = new Notes(this.app, this.data.settings);
    this.translator = new Translator(this.app, this.data.settings);
    this.catalog = null;                                      // {fetchedAt, plugins}
    this.vectors = null;                                      // semantic Similar (parseVectors); null → word matching
    this.timeline = newTimeline(this.data.settings.historyMonths);
    this.busy = false;
    this.progress = "";             // the running task's progress, shown in the view's status line
    this.readmeJobs = new Set();    // plugin ids whose README is being fetched
    this.similarCache = new Map();  // "id|limit|excluded" → similarTo result

    this.registerView(VIEW_TYPE, (leaf) => new DiscoveryView(leaf, this));
    this.addRibbonIcon(ICON, t("view.title"), () => this.openView());
    this.addSettingTab(new RadarSettingTab(this.app, this));
    this.addCommands();

    // Only changes inside the notes folder refresh the view, so typing elsewhere stays quiet
    const relevant = (path) => path.startsWith(`${this.notes.folder}/`);
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      if (!relevant(file.path)) return;
      this.notes.refresh(file);
      this.redraw();
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (!relevant(file.path)) return;
      this.notes.forget(file.path);
      this.redraw();
    }));
    this.registerEvent(this.app.vault.on("rename", (file, old) => {
      if (!relevant(file.path) && !relevant(old)) return;
      this.notes.forget(old);
      this.notes.refresh(file);
      this.redraw();
    }));

    this.registerEvent(this.app.workspace.on("file-open", (file) => this.onNoteOpen(file)));

    this.app.workspace.onLayoutReady(async () => {
      await this.importLegacyPlugin();
      this.notes.rebuild();
      this.catalog = await this.cache.read("catalog", null);
      this.timeline = upgradeTimeline(await this.cache.read("timeline", this.timeline));
      this.vectors = parseVectors(await this.cache.read("vectors", null), await this.cache.readBinary("vectors"));
      await this.runMigrations();
      this.redraw();
      this.registerInterval(window.setInterval(() => this.syncIfDue(), SYNC_CHECK_MS));
      await this.syncIfDue();
    });
  }

  uiLanguage() {
    const language = this.data.settings?.language;
    return language && language !== "auto" ? language : obsidianLanguage();
  }

  /**
   * The plugin ran earlier under other ids (see LEGACY_PLUGIN_IDS). On a fresh install, the newest
   * earlier install's settings, lists and caches are copied over once so nothing is lost by the rename.
   */
  async importLegacyPlugin() {
    if (this.data.migrations.legacyImport) return;
    this.data.migrations.legacyImport = dayString(Date.now());
    const adapter = this.app.vault.adapter;
    const hasOwnData = Object.keys(this.data.excluded).length || Object.keys(this.data.translations).length;
    let legacyDir = null;
    for (const id of LEGACY_PLUGIN_IDS) {
      const dir = normalizePath(`${this.app.vault.configDir}/plugins/${id}`);
      if (await adapter.exists(`${dir}/data.json`)) { legacyDir = dir; break; }
    }
    if (hasOwnData || !legacyDir) return this.saveData(this.data);
    try {
      const legacy = JSON.parse(await adapter.read(`${legacyDir}/data.json`));
      for (const key of ["excluded", "dismissed", "translations"]) this.data[key] = { ...legacy[key], ...this.data[key] };
      Object.assign(this.data.settings, legacy.settings || {});
      Object.assign(this.data.migrations, legacy.migrations || {}, { legacyImport: this.data.migrations.legacyImport });
      for (const name of ["catalog", "timeline"]) {
        const path = `${legacyDir}/cache/${name}.json`;
        if (await adapter.exists(path)) await this.cache.write(name, JSON.parse(await adapter.read(path)));
      }
      new Notice(t("notice.legacyImported"), 10000);
    } catch (error) {
      console.warn("[Community Radar] couldn't import data from the earlier version", error);
    }
    await this.saveData(this.data);
  }

  /** One-time changes applied to notes and keys when upgrading. */
  async runMigrations() {
    const done = this.data.migrations;
    if (!done.h1Headings) {
      const changed = await this.notes.migrate(migrateHeadings);
      done.h1Headings = dayString(Date.now());
      if (changed) new Notice(t("notice.headings", { n: changed }));
    }
    if (!done.groupsList) {
      const moved = await this.notes.migrateGroups();
      done.groupsList = dayString(Date.now());
      if (moved) new Notice(t("notice.groupsMigrated", { n: moved }), 10000);
    }
    if (!done.statusKeys) {   // 0.7.1's statuses → the new ones
      const moved = await this.notes.migrate((content) => content.replace(/^status: (candidate|trying|using|dropped)[ \t]*$/m, (all, old) => `status: ${LEGACY_STATUS[old]}`));
      done.statusKeys = dayString(Date.now());
      if (moved) new Notice(t("notice.statusMigrated", { n: moved }), 10000);
    }
    if (!done.readmeMarkers) {
      await this.notes.migrate(migrateMarkers);
      done.readmeMarkers = dayString(Date.now());
    }
    if (!done.readmeImages) {
      await this.notes.migrate(migrateImages);
      done.readmeImages = dayString(Date.now());
    }
    if (!done.keyNames) {
      const moved = this.translator.migrateLegacyKeys();
      done.keyNames = dayString(Date.now());
      if (moved) new Notice(t("notice.keysMoved", { n: moved, example: KEY_NAMES.anthropic }));
    }
    await this.saveData(this.data);
  }

  addCommands() {
    const command = (id, name, callback) => this.addCommand({ id, name, callback });
    command("open", t("cmd.open"), () => this.openView());
    command("refresh", t("cmd.refresh"), () => this.refresh());
    command("rebuild-history", t("cmd.rebuild"), () => this.buildHistory(true));
    command("readme-current", t("cmd.readmeCurrent"), () => this.updateCurrentReadme());
    command("readme-all", t("cmd.readmeAll"), () => this.updateReadmes([...this.notes.index.keys()]));
    command("bases-view", t("cmd.base"), () => this.writeBase());
    command("group-ungrouped", t("cmd.groupUngrouped"), () => this.groupUngrouped());
    command("readme-translate", t("cmd.readmeTranslate"), () => this.translateCurrentReadme());
  }

  // ── State ────────────────────────────────────────────────────────────────
  /** Installed community plugins. `app.plugins` isn't part of the public API, so it's read defensively. */
  installed() {
    return new Set(Object.keys(this.app.plugins?.manifests || {}));
  }

  state() {
    return {
      catalog: this.catalog?.plugins || [],
      releases: this.timeline.releases,
      firstSeen: this.timeline.firstSeen,
      notes: this.notes.index,
      excluded: new Set(Object.keys(this.data.excluded)),
      dismissed: new Set(Object.keys(this.data.dismissed)),
      snoozed: this.data.snoozed,
      installed: this.installed(),
    };
  }

  pluginById(id) {
    return this.catalog?.plugins.find((p) => p.id === id) || null;
  }

  /** Updates open views; `full` rebuilds them (e.g. after a language change). */
  redraw(full = false) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) (full ? leaf.view.render : leaf.view.refresh)?.call(leaf.view);
  }

  async openView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing || this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  // ── Data ─────────────────────────────────────────────────────────────────
  /**
   * Runs one long task at a time. Progress shows in the view's status line and, unless `quiet`
   * (scheduled syncs), in a notice; a quiet task shows a notice only when it fails.
   */
  async task(label, work, { quiet = false } = {}) {
    if (this.busy) return quiet ? undefined : new Notice(t("notice.busy"));
    this.busy = true;
    this.progress = "";
    const notice = quiet ? null : new Notice(label, 0);
    const progress = (text) => {
      this.progress = text;
      notice?.setMessage(`${label}\n${text}`);
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) leaf.view.refreshStatus?.();
    };
    this.redraw();
    try {
      const message = await work(progress);
      notice?.setMessage(message || `${label} ✔`);
      setTimeout(() => notice?.hide(), 6000);
    } catch (error) {
      console.error("[Community Radar]", error);
      const failed = notice || new Notice("", 0);
      failed.setMessage(`${label} ✖\n${error.message}`);
      setTimeout(() => failed.hide(), 12000);
    } finally {
      this.busy = false;
      this.progress = "";
      this.redraw();
    }
  }

  /** On opening the view: sync when there is no data yet, otherwise follow the sync frequency. */
  async ensureFresh() {
    if (!this.catalog) await this.refresh();
    else await this.syncIfDue();
  }

  /** Quietly syncs when the chosen interval has passed; makes no request otherwise or when set to manual. */
  async syncIfDue() {
    const hours = this.data.settings.syncHours;
    const age = this.catalog ? Date.now() - this.catalog.fetchedAt : Infinity;
    if (hours > 0 && age >= hours * HOUR_MS) await this.refresh({ quiet: true });
  }

  async ensureCatalog() {
    if (!this.catalog) await this.refresh();
    return Boolean(this.catalog);
  }

  refresh({ quiet = false } = {}) {
    return this.task(t("notice.refreshing"), async (progress) => {
      progress(t("notice.downloadingCatalog"));
      const plugins = await this.github.catalog();
      const delta = this.catalog ? catalogDelta(this.catalog.plugins, plugins) : null;
      this.catalog = { fetchedAt: Date.now(), plugins, delta };
      for (const p of plugins) if (p.id in this.data.snoozed && !isSnoozed(p, this.data.snoozed)) delete this.data.snoozed[p.id];
      await this.saveData(this.data);
      await this.cache.write("catalog", this.catalog);

      if (this.timeline.to) await this.syncTimeline(false, progress);
      await this.syncVectors(progress);

      progress(t("notice.updatingNotes"));
      const released = [];
      for (const id of [...this.notes.index.keys()]) {
        const plugin = this.pluginById(id);
        if (plugin && (await this.notes.syncSource(plugin))) released.push(id);
      }
      if (released.length && this.data.settings.readmeMode === "sync") await this.fetchReadmes(released, progress);
      return t("notice.refreshed", { n: formatCount(this.catalog.plugins.length), released: released.length });
    }, { quiet });
  }

  /** Downloads the semantic vectors when a newer build is out; a failure only leaves Similar on word matching. */
  async syncVectors(progress) {
    try {
      const meta = await this.github.vectorsMeta();
      if (this.vectors && meta.built === this.vectors.built) return;
      progress(t("notice.vectors"));
      const vectors = parseVectors(meta, await this.github.vectorsData());
      if (!vectors) throw new Error("vector file doesn't match its index");
      await this.cache.write("vectors", meta);
      await this.cache.writeBinary("vectors", vectors.data.buffer);
      this.vectors = vectors;
      this.similarCache.clear();
    } catch (error) {
      console.warn("[Community Radar] couldn't update the semantic vectors; Similar uses words", error);
    }
  }

  buildHistory(rebuild) {
    return this.task(t("notice.history"), (progress) => this.syncTimeline(rebuild, progress));
  }

  /**
   * Downloads the missing days' snapshots and merges them into the history. After a long break it
   * fills every missing day; it saves after each batch, so an interrupted run keeps its progress.
   */
  async syncTimeline(rebuild, progress) {
    const now = Date.now();
    if (rebuild || !this.timeline.to) this.timeline = newTimeline(this.data.settings.historyMonths);
    const since = this.timeline.to || now - this.timeline.months * MONTH_MS;

    progress(t("notice.listingSnapshots"));
    const snapshots = selectSnapshots(await this.github.statsCommits(since), now);
    for (let i = 0; i < snapshots.length; i += PARALLEL) {
      const batch = snapshots.slice(i, i + PARALLEL);
      const stats = await mapLimit(batch, PARALLEL, (s) => this.github.snapshot(s.sha));
      stats.forEach((s, k) => mergeSnapshot(this.timeline, s, batch[k].date));  // order kept: oldest first
      this.timeline.from ||= batch[0].date;
      this.timeline.to = batch[batch.length - 1].date;
      await this.cache.write("timeline", this.timeline);
      progress(t("notice.snapshotProgress", { done: Math.min(i + PARALLEL, snapshots.length), total: snapshots.length, date: dayString(this.timeline.to) }));
    }
    return snapshots.length
      ? t("notice.historyDone", { label: historyLabel(this.timeline.months), from: dayString(this.timeline.from), to: dayString(this.timeline.to), n: snapshots.length })
      : t("notice.historyCurrent");
  }

  // ── README ───────────────────────────────────────────────────────────────
  async fetchReadmes(ids, progress) {
    let done = 0;
    await mapLimit(ids, PARALLEL, async (id) => {
      const plugin = this.pluginById(id);
      const file = this.notes.file(id);
      if (plugin && file) await this.notes.writeReadme(file, plugin, plugin.repo ? await this.github.readme(plugin.repo) : null);
      progress(t("notice.readmeProgress", { done: ++done, total: ids.length }));
    });
  }

  async updateReadmes(ids) {
    if (!(await this.ensureCatalog())) return;
    await this.task(t("notice.readme"), async (progress) => {
      await this.fetchReadmes(ids, progress);
      return t("notice.readmeDone", { n: ids.length });
    });
  }

  /** "When I open the note" mode: an opened tracking note whose README is older than the release gets a fresh one. */
  async onNoteOpen(file) {
    if (this.data.settings.readmeMode !== "open" || !this.notes.inFolder(file)) return;
    const note = [...this.notes.index.values()].find((n) => n.path === file.path);
    const plugin = note && this.pluginById(note.id);
    if (!plugin?.version || readmeVersion(await this.app.vault.cachedRead(file)) === plugin.version) return;
    await this.refreshReadme(plugin, file);
  }

  /** Fetches one README in the background; a second request for the same plugin is ignored while it runs. */
  async refreshReadme(plugin, file) {
    if (!plugin.repo || this.readmeJobs.has(plugin.id)) return;
    this.readmeJobs.add(plugin.id);
    try {
      await this.notes.writeReadme(file, plugin, await this.github.readme(plugin.repo));
    } catch (error) {
      console.warn("[Community Radar] couldn't fetch the README", error);
    } finally {
      this.readmeJobs.delete(plugin.id);
    }
  }

  /** Opens the README in the plugin's tracking note, creating the note (with its README) when there is none. */
  async openReadme(plugin) {
    if (!this.notes.file(plugin.id)) await this.track(plugin, {});
    const file = this.notes.file(plugin.id);
    if (file) await this.app.workspace.openLinkText(`${file.path}#README`, "", "tab");
  }

  /** The Bases file sits next to the notes folder: "Eklentiler" → "Eklentiler.base". */
  basePath() {
    return normalizePath(`${this.notes.folder}.base`);
  }

  /** Creates the Bases view, or resets it to the template when it exists, then opens it. */
  async writeBase() {
    const path = this.basePath();
    const content = baseFile(this.notes.folder);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      const parent = path.split("/").slice(0, -1).join("/");
      if (parent && !this.app.vault.getAbstractFileByPath(parent)) await this.app.vault.createFolder(parent);
      await this.app.vault.create(path, content);
    }
    new Notice(t(existing ? "notice.baseReset" : "notice.baseCreated", { path }));
    await this.app.workspace.openLinkText(path, "", "tab");
  }

  /** The README and its translation as kept in the tracking note: {original, translation}; nulls when missing. */
  async readmeParts(plugin) {
    const file = this.notes.file(plugin.id);
    if (!file) return { original: null, translation: null };
    const content = await this.app.vault.cachedRead(file);
    return { original: readmeText(content), translation: readmeTranslation(content) };
  }

  /**
   * Translates a plugin's README into the target language and keeps it in its tracking note, right above
   * the original (a note is created when there is none; the README is fetched when missing or older than
   * the release). Asked for only by the user; true when done.
   */
  async translateReadme(plugin, progress = () => {}) {
    if (!this.translator.ready) {
      new Notice(t("notice.translateSetup"));
      return false;
    }
    try {
      if (!this.notes.file(plugin.id)) await this.notes.upsert(plugin, {});
      const file = this.notes.file(plugin.id);
      let content = await this.app.vault.read(file);
      if (!readmeText(content) || readmeVersion(content) !== plugin.version) {
        progress(t("notice.readme"));
        await this.notes.writeReadme(file, plugin, plugin.repo ? await this.github.readme(plugin.repo) : null);
        content = await this.app.vault.read(file);
      }
      const original = readmeText(content);
      if (!original) throw new Error(t("readme.failed"));
      const lang = this.data.settings.targetLang;
      const body = await this.translator.translateMarkdown(original, (done, total) => progress(t("readme.translating", { done: done + 1, total })));
      const section = `${t("readme.translationMeta", { lang, version: plugin.version || "?", date: dayString(Date.now()) })}\n\n${body}`;
      await this.app.vault.process(file, (text) => replaceReadmeTranslation(text, section, t("readme.translatedHeading", { lang })));
      return true;
    } catch (error) {
      console.error("[Community Radar] README translation", error);
      new Notice(t("notice.translateFailed", { error: error.message }), 12000);
      return false;
    }
  }

  async translateCurrentReadme() {
    const file = this.app.workspace.getActiveFile();
    const note = file && noteFromFrontmatter(file.path, this.app.metadataCache.getFileCache(file)?.frontmatter);
    const plugin = note && this.pluginById(note.id);
    if (!plugin) return new Notice(t("notice.notTracking"));
    await this.task(t("readme.translateTitle", { name: plugin.name }), async (progress) => {
      if (await this.translateReadme(plugin, progress)) return t("readme.translated", { name: plugin.name });
      throw new Error(t("readme.notTranslated"));
    });
  }

  async updateCurrentReadme() {
    const file = this.app.workspace.getActiveFile();
    const note = file && noteFromFrontmatter(file.path, this.app.metadataCache.getFileCache(file)?.frontmatter);
    if (!note) return new Notice(t("notice.notTracking"));
    await this.updateReadmes([note.id]);
  }

  // ── Translation ──────────────────────────────────────────────────────────
  /** Saved translation; invalid once the description changes. */
  cachedTranslation(plugin) {
    const saved = this.data.translations[plugin.id];
    return saved && saved.src === plugin.description ? saved.text : null;
  }

  /** Translates untranslated descriptions in single requests of up to 50 and saves them. True on success. */
  async translateRows(plugins) {
    const pending = plugins.filter((p) => p.description && this.cachedTranslation(p) == null);
    if (!pending.length) return true;
    if (!this.translator.ready) {
      new Notice(t("notice.translateSetup"));
      return false;
    }
    const notice = new Notice(t("notice.translating", { n: pending.length }), 0);
    try {
      for (let i = 0; i < pending.length; i += PAGE_SIZE) {
        const batch = pending.slice(i, i + PAGE_SIZE);
        const texts = await this.translator.translate(batch.map((p) => p.description));
        batch.forEach((p, k) => { this.data.translations[p.id] = { src: p.description, text: texts[k] }; });
        await this.saveData(this.data);
      }
      notice.hide();
      return true;
    } catch (error) {
      console.error("[Community Radar] translation", error);
      notice.setMessage(t("notice.translateFailed", { error: error.message }));
      setTimeout(() => notice.hide(), 12000);
      return false;
    }
  }

  // ── User actions ─────────────────────────────────────────────────────────
  /** Creates or updates the note; a new note gets its README in the background. */
  async track(plugin, patch) {
    const { file, created } = await this.notes.upsert(plugin, patch);
    if (created) this.refreshReadme(plugin, file);  // not awaited: the note is usable right away
    return created;
  }

  async toggleFavorite(plugin) {
    const favorite = !this.notes.index.get(plugin.id)?.favorite;
    const created = await this.track(plugin, { favorite });
    new Notice(t("notice.favorite", { star: favorite ? "★" : "☆", name: plugin.name }) + (created ? t("notice.noteCreated") : ""));
  }

  async chooseGroup(plugin) {
    const modal = new GroupModal(this, plugin);
    modal.open();
    const groups = await modal.result;
    if (!groups) return;
    const created = await this.track(plugin, { groups });
    const message = groups.length ? t("notice.grouped", { name: plugin.name, group: groups.join(", ") }) : t("notice.ungrouped", { name: plugin.name });
    new Notice(message + (created ? t("notice.noteCreated") : ""));
  }

  // ── Groups and similarity ────────────────────────────────────────────────
  /** Word index of the current catalog, built once per catalog. */
  textIndex() {
    if (this.indexedCatalog !== this.catalog) {
      this.indexedCatalog = this.catalog;
      this.wordIndex = textIndex(this.catalog?.plugins || []);
    }
    return this.wordIndex;
  }

  closestGroupFor(plugin) {
    return closestGroup(plugin, this.notes.members(), this.textIndex());
  }

  /**
   * [{p, score, match, shared, cosine?}], best match first: by meaning when the vectors are in
   * (semanticPlugins), by words otherwise (similarPlugins). Cached per plugin until the data changes.
   */
  similarTo(plugin, limit = SIMILAR_LIST) {
    const key = `${plugin.id}|${limit}`;
    if (this.similarCatalog !== this.catalog) {
      this.similarCatalog = this.catalog;
      this.similarCache.clear();
    }
    if (!this.similarCache.has(key)) {
      const catalog = this.catalog?.plugins || [];
      const options = { exclude: new Set(Object.keys(this.data.excluded)), limit };
      const found = (this.vectors && semanticPlugins(plugin, catalog, this.vectors, this.textIndex(), options))
        || similarPlugins(plugin, catalog, this.textIndex(), options);
      this.similarCache.set(key, found);
    }
    return this.similarCache.get(key);
  }

  /** Tracked plugins that have no group yet. */
  ungrouped() {
    return [...this.notes.index.values()].filter((n) => !n.groups.length).map((n) => this.pluginById(n.id)).filter(Boolean);
  }

  /** Your groups with up to three plugin names each, so the model sees what each group means. */
  groupExamples() {
    return [...this.notes.members()].map(([name, ids]) => ({ name, examples: ids.slice(0, 3).map((id) => this.pluginById(id)?.name || id) }));
  }

  /**
   * Group suggestions per plugin id. Saved ones are reused while the description is unchanged; the
   * rest are asked for in requests of AI_BATCH plugins.
   */
  async groupSuggestions(plugins, progress = () => {}) {
    const saved = this.data.groupSuggestions;
    const missing = plugins.filter((p) => saved[p.id]?.src !== p.description);
    const groups = this.groupExamples();
    for (let i = 0; i < missing.length; i += AI_BATCH) {
      progress(t("batch.requesting", { done: Math.min(i + AI_BATCH, missing.length), total: missing.length }));
      const batch = missing.slice(i, i + AI_BATCH);
      const found = await this.translator.suggestGroups(batch, groups);
      for (const p of batch) saved[p.id] = { src: p.description, list: found[p.id] };
      await this.saveData(this.data);
    }
    return Object.fromEntries(plugins.map((p) => [p.id, saved[p.id]?.list || []]));
  }

  async suggestGroups(plugin) {
    return (await this.groupSuggestions([plugin]))[plugin.id];
  }

  /** Opens the Tracked tab on Ungrouped and starts grouping mode there; nothing is written before Accept. */
  /** Tracked plugins with a release since you reviewed them (the Tracked tab's badge). */
  updatesCount(state = this.state(), now = Date.now()) {
    return discover(state, { ...modeOptions(this.data.settings, "tracked"), trackedGroup: UPDATES, trackedStatus: "", query: "" }, now).length;
  }

  async groupUngrouped() {
    if (!(await this.ensureCatalog())) return;
    if (!this.ungrouped().length) return new Notice(t("batch.none"));
    if (!this.translator.ready) return new Notice(t("groups.aiSetup"));
    this.app.setting?.close?.();
    await this.openView();
    Object.assign(this.data.settings, { mode: "tracked", trackedGroup: UNGROUPED, trackedStatus: "" });
    await this.saveData(this.data);
    this.redraw(true);
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    await view?.startGrouping((view.rows || []).slice(0, view.visible));
  }

  async exclude(plugin) {
    this.data.excluded[plugin.id] = dayString(Date.now());
    this.similarCache.clear();
    await this.saveData(this.data);
    new Notice(t("notice.excluded", { name: plugin.name }));
  }

  async dismiss(plugin) {
    this.data.dismissed[plugin.id] = dayString(Date.now());
    await this.saveData(this.data);
  }

  /** Hides a plugin until it ships a release newer than the current one. */
  async snooze(plugin) {
    this.data.snoozed[plugin.id] = plugin.updated || 0;
    await this.saveData(this.data);
    new Notice(t("notice.snoozed", { name: plugin.name }));
  }

  /** Ignored list = ignored plugins + those hidden until their next release. */
  ignoredCount() {
    const snoozed = (this.catalog?.plugins || []).filter((p) => isSnoozed(p, this.data.snoozed) && !(p.id in this.data.excluded)).length;
    return Object.keys(this.data.excluded).length + snoozed;
  }

  /** Brings plugins back from the Ignored (also un-snoozes) or Hidden suggestions list. */
  async restoreFrom(mode, ids) {
    for (const id of ids) {
      if (mode === "ignored") { delete this.data.excluded[id]; delete this.data.snoozed[id]; }
      else delete this.data.dismissed[id];
    }
    this.similarCache.clear();
    await this.saveData(this.data);
    this.redraw();
  }

  /** Writes one personal property of a tracked plugin's note; null removes it. */
  async setNoteField(plugin, key, value) {
    await this.track(plugin, { [key]: value });
    this.redraw();
  }

  /** Opens the view on a list mode (Ignored, Hidden suggestions). */
  async showList(mode) {
    this.app.setting?.close?.();
    await this.openView();
    this.data.settings.mode = mode;
    await this.saveData(this.data);
    this.redraw(true);
  }

  /** Opens the Tracked tab filtered to one group. */
  async showGroup(group) {
    Object.assign(this.data.settings, { mode: "tracked", trackedGroup: group });
    await this.saveData(this.data);
    this.redraw(true);
  }

  /** Obsidian's settings on this plugin's tab (`app.setting` isn't public API, so it's used defensively). */
  openSettings() {
    this.app.setting?.open?.();
    this.app.setting?.openTabById?.(this.manifest.id);
  }

  async markReviewed(plugins) {
    const today = dayString(Date.now());
    for (const plugin of plugins) {
      const file = this.notes.file(plugin.id);
      if (!file) continue;
      await this.app.fileManager.processFrontMatter(file, (fm) => { fm.reviewed = today; });
      this.notes.index.get(plugin.id).reviewed = today;
    }
    this.redraw();
  }

}

module.exports = PluginRadar;
module.exports.core = core;  // exposed for tests only
