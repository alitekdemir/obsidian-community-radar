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
  Plugin, ItemView, Notice, SuggestModal, PluginSettingTab, Setting,
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
const TIMELINE_VERSION = 2;        // 2: first-seen dates added

// Obsidian comments (%% %%) stay hidden in Live Preview and Reading view.
const README_START = "%% community-radar:readme-start %%";
const README_END = "%% community-radar:readme-end %%";
// Markers before 0.6.1 (HTML comments show up in Live Preview); notes are migrated once.
const LEGACY_README_START = "<!-- plugin-tracker:readme-start -->";
const LEGACY_README_END = "<!-- plugin-tracker:readme-end -->";
const UNREVIEWED_NOTE = /\s*-?\s*This plugin has not been manually reviewed by Obsidian staff\.?\s*/gi;

const MODE_KEYS = ["all", "new", "updated", "awakened", "changed", "suggested"];
const SORT_KEYS = ["downloads", "updated", "name", "listed"];
const NATURAL_DIR = { downloads: "desc", updated: "desc", name: "asc", listed: "desc" };  // most, newest, A→Z, newest
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
    filterDownloads: settings.downloadFilter?.[mode] ?? defaults.downloads,
    sort: key,
    sortDir: sort.dir === "asc" || sort.dir === "desc" ? sort.dir : NATURAL_DIR[key],
  };
}

/**
 * Rows of the discovery view.
 * @param {object} state  {catalog, releases, firstSeen, notes: Map(id→note), excluded: Set, dismissed: Set, installed: Set}
 * @param {object} opts   {mode, days, dormantDays, minDownloads, filterDownloads, sort, sortDir, query} (see modeOptions)
 */
function discover(state, opts, now) {
  const { catalog, releases, firstSeen, notes, excluded, dismissed, installed } = state;
  const since = now - opts.days * DAY_MS;
  const query = compileQuery(opts.query);
  const minDownloads = opts.filterDownloads ? opts.minDownloads : 0;
  const base = (p) => !excluded.has(p.id) && (p.downloads ?? 0) >= minDownloads && query.test(p);
  const fresh = (p) => base(p) && !notes.has(p.id);
  const sorted = (rows) => sortRows(rows, opts.sort, opts.sortDir, catalog);

  switch (opts.mode) {
    case "all":   // browsing: tracked plugins stay visible (with their note badge), excluded ones don't
      return sorted(catalog.filter(base));
    case "new":
      return sorted(catalog.filter((p) => fresh(p) && isNewPlugin(firstSeen, p, now, opts.days)));
    case "updated":
      return sorted(catalog.filter((p) => fresh(p) && p.updated >= since));
    case "awakened":
      return sorted(catalog.filter((p) => fresh(p) && p.updated >= since && (dormantDays(releases, p) ?? -1) >= opts.dormantDays));
    case "changed":
      return sorted(catalog.filter((p) => base(p) && isChanged(p, notes.get(p.id))));
    case "suggested":
      return sorted(catalog.filter((p) => base(p) && installed.has(p.id) && !dismissed.has(p.id) && !(notes.get(p.id) || {}).favorite));
    default:
      return [];
  }
}

/**
 * Sorts rows in place by `key` in direction `dir` ("asc" | "desc"; default: the key's natural one).
 * "listed" uses the position in the official listing, which is the order plugins were added.
 */
function sortRows(rows, key, dir = NATURAL_DIR[key], catalog = []) {
  const position = key === "listed" ? new Map(catalog.map((p, i) => [p.id, i])) : null;
  const compare = {
    downloads: (a, b) => (b.downloads ?? 0) - (a.downloads ?? 0),
    updated: (a, b) => (b.updated ?? 0) - (a.updated ?? 0),
    name: (a, b) => a.name.localeCompare(b.name, t("locale"), { sensitivity: "base" }),
    listed: (a, b) => (position.get(b.id) ?? -1) - (position.get(a.id) ?? -1),
  }[key] || ((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
  const sign = dir === (NATURAL_DIR[key] || "desc") ? 1 : -1;
  return rows.sort((a, b) => sign * compare(a, b));
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

/** Points relative images and links to GitHub. */
function absolutizeLinks(markdown, repo) {
  const rawBase = `${RAW}/${repo}/HEAD/`;
  const blobBase = `https://github.com/${repo}/blob/HEAD/`;
  const isRelative = (url) => url && !/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url);
  const join = (base, url) => base + url.replace(/^\.?\//, "");
  return markdown
    .replace(/(!?)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?((?:\s+"[^"]*")?)\s*\)/g, (all, bang, text, url, title) =>
      isRelative(url) ? `${bang}[${text}](${join(bang ? rawBase : blobBase, url)}${title})` : all)
    .replace(/(<img\b[^>]*?\bsrc=)(["'])([^"']+)\2/gi, (all, head, q, url) =>
      isRelative(url) ? `${head}${q}${join(rawBase, url)}${q}` : all)
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
function noteBody(plugin) {
  return `${plugin.description || ""}\n\n# ${t("note.myNotes")}\n\n\n# README\n${README_START}\n${README_END}\n`;
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
    ...view(t("base.all"), [], ["group", "favorite", "note", "downloads", "version", "updated", "reviewed"]),
    ...view(t("base.byGroup"), ["    groupBy:", "      property: note.group", "      direction: ASC"], ["favorite", "note", "downloads", "updated"]),
    ...view(t("base.starred"), ["    filters:", "      and:", "        - favorite == true"], ["group", "note", "downloads", "updated"]),
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

/** Tracking record from a note's frontmatter (only notes with `plugin_id`). */
function noteFromFrontmatter(path, fm) {
  if (!fm || !fm.plugin_id) return null;
  return {
    path,
    id: String(fm.plugin_id),
    group: fm.group ? String(fm.group) : "",
    favorite: fm.favorite === true,
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
  mergeSnapshot, dormantDays, isNewPlugin, isChanged, compileQuery, modeOptions, discover, sortRows, modeCounts, escapeOutsideCode,
  absolutizeLinks, readmeSection, readmeVersion, replaceReadme, catalogDelta, noteBody, migrateHeadings, migrateMarkers, baseFile, sourceFields, noteFromFrontmatter,
  PROVIDERS, KEY_NAMES, STRINGS, tokenPrice, formatPrice, filterModels, translationPrompt,
  parseTranslations, mapLimit,
  constants: { DAY_MS, MONTH_MS, DAILY_DAYS, RELEASES_CAP, NEW_BADGE_DAYS, README_START, README_END, LEGACY_README_START, LEGACY_README_END, TIMELINE_VERSION },
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

  groups() {
    return [...new Set([...this.index.values()].map((n) => n.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, t("locale")));
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
   * @param {object} patch  personal fields: {group?, favorite?, note?, reviewed?}
   * @returns {Promise<{file: TFile, created: boolean}>}
   */
  async upsert(plugin, patch) {
    let file = this.file(plugin.id);
    const created = !file;
    if (created) {
      if (!this.app.vault.getAbstractFileByPath(this.folder)) await this.app.vault.createFolder(this.folder);
      file = await this.app.vault.create(this.uniquePath(plugin), noteBody(plugin));
    }
    let written = {};
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (created) {
        Object.assign(fm, { plugin_id: plugin.id, group: "", favorite: false, note: "", reviewed: dayString(Date.now()) });
      }
      Object.assign(fm, patch, sourceFields(plugin));
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

/** Suggests existing groups; a newly typed name can be chosen too. */
class GroupModal extends PickerModal {
  constructor(app, groups, current) {
    super(app, current ? t("group.placeholderCurrent", { group: current }) : t("group.placeholder"));
    this.groups = groups;
  }

  getSuggestions(query) {
    const q = query.trim();
    const matches = this.groups.filter((g) => g.toLowerCase().includes(q.toLowerCase())).map((name) => ({ name }));
    return q && !this.groups.includes(q) ? [{ name: q, isNew: true }, ...matches] : matches;
  }

  renderSuggestion(item, el) {
    el.setText(item.isNew ? t("group.new", { name: item.name }) : item.name);
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
class DiscoveryView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.visible = PAGE_SIZE;
    this.shownTranslations = new Set();
    this.expanded = new Set();
    this.refs = {};
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return t("view.title"); }
  getIcon() { return ICON; }

  async onOpen() {
    this.contentEl.addClass("pdt-view");
    this.render();
    await this.plugin.ensureFresh();
  }

  get settings() { return this.plugin.data.settings; }

  async update(key, value) {
    this.settings[key] = value;
    this.visible = PAGE_SIZE;
    await this.plugin.saveData(this.plugin.data);
    this.render();
  }

  render() {
    const root = this.contentEl;
    root.empty();
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
      setTooltip(tab, t(`tip.${mode}`, tipVars));
      tab.onclick = () => this.update("mode", mode);
      onActivate(tab, () => this.update("mode", mode));
    }
  }

  /** Saves a per-tab setting (downloadFilter, sortBy) for the current tab. */
  updateTab(key, value) {
    return this.update(key, { ...this.settings[key], [this.settings.mode]: value });
  }

  renderFilters(bar) {
    const mode = this.settings.mode;
    const opts = modeOptions(this.settings, mode);
    const days = { label: t("filter.last"), unit: t("filter.daysUnit"), min: 1, max: 365, presets: DAY_PRESETS };

    if (mode === "new" || mode === "updated" || mode === "awakened") {
      numberChip(bar, { ...days, value: this.settings.days, onChange: (n) => this.update("days", n) });
    }
    if (mode === "awakened") {
      numberChip(bar, { ...days, label: t("filter.gap"), max: 3650, presets: DORMANT_PRESETS, value: this.settings.dormantDays, onChange: (n) => this.update("dormantDays", n) });
    }
    toggleChip(bar, {
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

    const search = bar.createDiv({ cls: "pdt-search" });
    setIcon(search.createSpan({ cls: "pdt-search-icon" }), "search");
    const input = search.createEl("input", { type: "search", placeholder: t("search.placeholder"), value: this.settings.query });
    const badge = search.createSpan({ cls: "pdt-regex", text: ".*" });
    setTooltip(badge, t("search.regex"));
    const mark = () => {
      const { regex, error } = compileQuery(input.value);
      search.toggleClass("is-regex", regex && !error);
      search.toggleClass("is-invalid", Boolean(error));
    };
    mark();
    this.refs.search = input;
    let timer;
    input.oninput = () => {
      mark();
      clearTimeout(timer);
      timer = setTimeout(async () => {
        this.settings.query = input.value;
        this.visible = PAGE_SIZE;
        this.refresh();
        await this.plugin.saveData(this.plugin.data);
      }, 250);
    };

    if (mode === "changed") {
      const all = bar.createEl("button", { cls: "pdt-ghost", text: t("changed.markAll") });
      all.onclick = async () => { await this.plugin.markReviewed(this.rows || []); this.refresh(); };
    }
    this.refs.translate = bar.createEl("button", { cls: "pdt-ghost" });
    setIcon(this.refs.translate.createSpan({ cls: "pdt-btn-icon" }), "languages");
    this.refs.translateLabel = this.refs.translate.createSpan({ text: t("translate.visible", { n: 0 }) });
    this.refs.translate.onclick = async () => {
      const rows = (this.rows || []).slice(0, this.visible);
      if (await this.plugin.translateRows(rows)) rows.forEach((p) => this.shownTranslations.add(p.id));
      this.refresh();
    };
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
    const query = this.settings.query.trim();
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
    const sync = actions.createEl("button", { cls: `pdt-ghost pdt-sync${this.plugin.busy ? " is-syncing" : ""}` });
    setIcon(sync.createSpan({ cls: "pdt-btn-icon" }), "refresh-cw");
    sync.createSpan({ text: this.plugin.busy ? t("status.syncing") : t("status.sync") });
    setTooltip(sync, t("status.refresh"));
    sync.disabled = this.plugin.busy;
    sync.onclick = () => this.plugin.refresh();
  }

  /** Redraws only the status line (progress updates during a sync). */
  refreshStatus() {
    if (this.refs.status) this.renderStatus(this.refs.status);
  }

  renderList(list, state, now) {
    list.empty();
    this.rows = [];
    if (!this.plugin.catalog) return;
    const { timeline } = this.plugin;
    const mode = this.settings.mode;
    if (mode === "awakened" && !timeline.to) {
      list.createDiv({ cls: "pdt-empty", text: t("list.needHistory") });
      this.updateTranslateButton([]);
      return;
    }
    if (mode === "new" && (!timeline.to || timeline.legacy)) list.createDiv({ cls: "pdt-hint", text: t("list.legacyHint") });

    this.rows = discover(state, modeOptions(this.settings, mode), now);
    const visible = this.rows.slice(0, this.visible);
    this.updateTranslateButton(visible);
    if (!this.rows.length) {
      list.createDiv({ cls: "pdt-empty", text: t("list.empty") });
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

  updateTranslateButton(visible) {
    const pending = visible.filter((p) => p.description && this.plugin.cachedTranslation(p) == null).length;
    this.refs.translateLabel?.setText(t("translate.visible", { n: visible.length }));
    if (!this.refs.translate) return;
    this.refs.translate.disabled = !visible.length;
    setTooltip(this.refs.translate, pending ? t("translate.pending", { pending, done: visible.length - pending }) : t("translate.allDone"));
  }

  renderRow(list, p, now) {
    const plugin = this.plugin;
    const { firstSeen, releases } = plugin.timeline;
    const note = plugin.notes.index.get(p.id);
    const row = list.createDiv({ cls: "pdt-row" });
    const main = row.createDiv({ cls: "pdt-main" });

    // Title: name · version · badges
    const head = main.createDiv({ cls: "pdt-head" });
    head.createEl("a", { cls: "pdt-name", text: p.name, href: `obsidian://show-plugin?id=${encodeURIComponent(p.id)}` });
    if (p.version) head.createSpan({ cls: "pdt-ver", text: p.version });
    if (isNewPlugin(firstSeen, p, now)) head.createSpan({ cls: "pdt-badge is-new", text: t("badge.new") });
    if (isChanged(p, note)) head.createSpan({ cls: "pdt-badge is-changed", text: t("badge.changed") });
    if (plugin.installed().has(p.id)) head.createSpan({ cls: "pdt-badge is-installed", text: t("badge.installed") });
    if (note) {
      const link = head.createSpan({ cls: "pdt-badge is-note", text: note.group ? `📝 ${note.group}` : t("badge.note") });
      setTooltip(link, t("badge.openNote"));
      link.onclick = () => this.app.workspace.openLinkText(note.path, "", "tab");
    }

    // Meta line: README · GitHub · when · gap
    const meta = main.createDiv({ cls: "pdt-meta" });
    const sep = () => meta.createSpan({ cls: "pdt-sep", text: "·" });
    if (p.repo) {
      const readme = meta.createEl("a", { cls: "pdt-readme", text: t("row.readme"), href: "#" });
      setIcon(readme.createSpan({ cls: "pdt-gh-icon" }), "file-text");
      setTooltip(readme, t(note ? "row.readmeOpen" : "row.readmeCreate"));
      readme.onclick = async (event) => {
        event.preventDefault();
        await plugin.openReadme(p);
      };
      sep();
    }
    if (p.repo) {
      const gh = meta.createEl("a", { cls: "pdt-gh", href: `https://github.com/${p.repo}`, text: "GitHub" });
      setIcon(gh.createSpan({ cls: "pdt-gh-icon" }), "external-link");
      sep();
    }
    const seen = firstSeen[p.id];
    if (p.updated) meta.createSpan({ text: t("row.updated", { when: relativeDays(p.updated, now) }) });
    else meta.createSpan({ text: seen > 0 ? t("row.added", { when: relativeDays(seen, now) }) : t("row.justListed") });
    if (plugin.timeline.to && p.updated) {
      const gap = dormantDays(releases, p);
      sep();
      if (gap != null) {
        const long = this.settings.mode === "awakened" && gap >= this.settings.dormantDays;  // highlighted only in Awakened
        meta.createSpan({ cls: long ? "pdt-gap is-long" : "pdt-gap", text: t("row.gap", { n: gap }) });
      } else {
        meta.createSpan({ cls: "pdt-gap", text: t("row.firstRelease") });
      }
    }

    // Description: two lines; click to expand long ones. Translate next to it.
    const descRow = main.createDiv({ cls: "pdt-desc-row" });
    const desc = descRow.createEl("p", { cls: "pdt-desc", text: p.description || "–" });
    if (this.expanded.has(p.id)) desc.addClass("is-expanded");
    requestAnimationFrame(() => {
      if (desc.scrollHeight > desc.clientHeight + 1 || desc.hasClass("is-expanded")) desc.addClass("is-clamped");
    });
    desc.onclick = () => {
      if (!desc.hasClass("is-clamped")) return;
      desc.toggleClass("is-expanded", !desc.hasClass("is-expanded"));
      if (desc.hasClass("is-expanded")) this.expanded.add(p.id); else this.expanded.delete(p.id);
    };
    const translation = plugin.cachedTranslation(p);
    const showing = translation != null && this.shownTranslations.has(p.id);
    if (p.description) {
      const tr = descRow.createDiv({ cls: "pdt-tr", attr: { role: "button", tabindex: "0" } });
      setIcon(tr.createSpan({ cls: "pdt-btn-icon" }), "languages");
      tr.createSpan({ text: showing ? t("translate.hide") : t("translate.row") });
      tr.onclick = async () => {
        if (showing) this.shownTranslations.delete(p.id);
        else if (translation != null || (await plugin.translateRows([p]))) this.shownTranslations.add(p.id);
        this.refresh();
      };
      onActivate(tr, () => tr.click());
    }
    if (showing) main.createDiv({ cls: "pdt-trans", text: translation });

    // Right side: downloads + actions
    const right = row.createDiv({ cls: "pdt-right" });
    const downloads = right.createDiv({ cls: "pdt-downloads" });
    if (p.downloads == null) {
      downloads.addClass("is-empty");
      downloads.setText(t("row.noStats"));
    } else {
      setIcon(downloads.createSpan({ cls: "pdt-dl-icon" }), "download");
      downloads.createSpan({ text: formatShort(p.downloads) });
      setTooltip(downloads, t("row.downloads", { n: formatCount(p.downloads) }));
    }
    const actions = right.createDiv({ cls: "pdt-actions" });
    const act = (icon, tip, fn, cls) => {
      const button = iconButton(actions, icon, tip, cls);
      button.onclick = async () => {
        if (button.hasClass("is-busy")) return;  // a quick double click must not run the action twice
        button.addClass("is-busy");
        await fn();
        this.refresh();
      };
    };
    if (this.settings.mode === "changed") {
      act("check", t("action.reviewed"), () => plugin.markReviewed([p]));
      return;
    }
    act("star", t(note?.favorite ? "action.unfavorite" : "action.favorite"), () => plugin.toggleFavorite(p), note?.favorite ? "is-favorite" : "");
    act("folder-plus", note?.group ? t("action.groupNamed", { group: note.group }) : t("action.group"), () => plugin.chooseGroup(p));
    if (this.settings.mode === "suggested") act("x", t("action.dismiss"), () => plugin.dismiss(p));
    else act("ban", t("action.exclude"), () => plugin.exclude(p));
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

    // ── Lists
    this.list(containerEl, t("set.excluded", { n: Object.keys(plugin.data.excluded).length }), plugin.data.excluded, (id) => plugin.restore("excluded", id));
    this.list(containerEl, t("set.dismissed", { n: Object.keys(plugin.data.dismissed).length }), plugin.data.dismissed, (id) => plugin.restore("dismissed", id));
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
    Object.assign(settings, { model: model.id, modelPrice: formatPrice(model.price) });
    await save();
    this.display();
  }

  list(containerEl, title, entries, onRestore) {
    new Setting(containerEl).setName(title).setHeading();
    const names = new Map((this.plugin.catalog?.plugins || []).map((p) => [p.id, p.name]));
    for (const [id, date] of Object.entries(entries).sort((a, b) => b[1].localeCompare(a[1]))) {
      new Setting(containerEl)
        .setName(names.get(id) || id)
        .setDesc(`${id} · ${date}`)
        .addButton((b) => b.setButtonText(t("set.restore")).onClick(async () => { await onRestore(id); this.display(); }));
    }
  }
}

// ─── 5. Plugin ──────────────────────────────────────────────────────────────
class PluginRadar extends Plugin {
  async onload() {
    addIcon(ICON, ICON_SVG);
    this.data = Object.assign({ excluded: {}, dismissed: {}, translations: {}, migrations: {} }, await this.loadData());
    setLanguage(this.uiLanguage());  // before defaultSettings(), whose folder name depends on the language
    this.data.settings = Object.assign(defaultSettings(), this.data.settings);
    this.github = new GitHub();
    this.cache = new Cache(this.app.vault.adapter, this.manifest.dir);
    this.notes = new Notes(this.app, this.data.settings);
    this.translator = new Translator(this.app, this.data.settings);
    this.catalog = null;                                      // {fetchedAt, plugins}
    this.timeline = newTimeline(this.data.settings.historyMonths);
    this.busy = false;
    this.progress = "";             // the running task's progress, shown in the view's status line
    this.readmeJobs = new Set();    // plugin ids whose README is being fetched

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
    if (!done.readmeMarkers) {
      await this.notes.migrate(migrateMarkers);
      done.readmeMarkers = dayString(Date.now());
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
      await this.cache.write("catalog", this.catalog);

      if (this.timeline.to) await this.syncTimeline(false, progress);

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
    const modal = new GroupModal(this.app, this.notes.groups(), this.notes.index.get(plugin.id)?.group);
    modal.open();
    const chosen = await modal.result;
    if (!chosen) return;
    const created = await this.track(plugin, { group: chosen.name });
    new Notice(t("notice.grouped", { name: plugin.name, group: chosen.name }) + (created ? t("notice.noteCreated") : ""));
  }

  async exclude(plugin) {
    this.data.excluded[plugin.id] = dayString(Date.now());
    await this.saveData(this.data);
    new Notice(t("notice.excluded", { name: plugin.name }));
  }

  async dismiss(plugin) {
    this.data.dismissed[plugin.id] = dayString(Date.now());
    await this.saveData(this.data);
  }

  async restore(list, id) {
    delete this.data[list][id];
    await this.saveData(this.data);
    this.redraw();
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
