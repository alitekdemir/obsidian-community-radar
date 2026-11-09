"use strict";
/*
 * Community Radar — discover community plugins, spot the ones that woke up after a long pause,
 * and track the ones you care about as notes. Plain JavaScript; scripts/build.js joins src/*.js in
 * file-name order (one shared scope, no imports) and embeds locales/*.json into the main.js Obsidian loads.
 *
 * Layers (each depends only on the ones above it):
 *   00     Constants and i18n
 *   10–19  Core: pure functions (dates, catalog, release history, discovery, README, translation, similarity)
 *   20     Services: GitHub client, cache, notes, translator
 *   30–33  UI: modals, details window, discovery view, settings tab
 *   40     Plugin class: wires everything together
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

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const RELEASES_CAP = 50;           // release dates kept per plugin
const NEW_BADGE_DAYS = 14;         // a plugin counts as new this many days after it was listed (setting: newDays)
const INCUBATION_CAP = 360;        // a plugin out of incubation stays on that tab for its incubation, at most this long
const WAVE_DAYS = 7;               // releases within a week of a wave's first one belong to that update
const OPS_CAP = 20;                // bulk actions kept for Recent actions (each with what it changed, for Undo)
const BUSY_DAYS = 180;             // "busy": update waves counted over this window…
const BUSY_LIMIT = 9;              // …more than this (about every three weeks) hides it from Updated (setting: hideBusy)
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
const SIMILAR_LIST = 30;           // closeness labels are set by the best this many; the details window shows the top 5
const SIMILAR_MAX = 300;           // the Similar filter lists matches down to here, in pages; further down it's noise
const SIMILAR_STEPS = 10;          // Similar → Similar steps that ‹ can go back through (this session only)
const NAME_WEIGHT = 2;             // a word in the name counts as much as two in the description
const BM25_K1 = 1.2;               // BM25: how fast repeating a term stops adding
const BM25_B = 0.75;               // BM25: how much a long description is evened out
const MMR_LAMBDA = 0.75;           // relevance vs. variety when picking similar plugins
const WORD_SHARE = 0.03;           // semantic Similar: how much the best word match adds to a cosine (~0.85–0.97)
// Semantic vectors of every plugin's name and description, rebuilt daily by .github/workflows/embeddings.yml
const VECTORS_URL = `${RAW}/alitekdemir/obsidian-community-radar/embeddings/granite-311m`;
const METRICS_URL = `${RAW}/alitekdemir/obsidian-community-radar/metrics`;   // built daily by .github/workflows/metrics.yml
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
const SIMILAR_MODE = "similar";                // 0.8's Similar list; the Similar filter replaced it
const SORT_KEYS = ["downloads", "growth7", "growth30", "updated", "name", "listed", "dormant", "rating"];
const SIMILAR_SORT_KEYS = ["relevance", "downloads", "growth30", "updated", "name", "listed", "rating"];
const NATURAL_DIR = { downloads: "desc", growth7: "desc", growth30: "desc", updated: "desc", name: "asc", listed: "desc", dormant: "desc", rating: "desc" };
const GROWTH_INDEX = { growth7: 0, growth30: 1 };   // positions in the server's growth [7, 30, 90 days]
const MILESTONE_DAYS = 30;         // a row shows a milestone passed within this many days
// Tracked tab "group" filters besides real groups; the \u0000 prefix can't clash with a group name
const UNGROUPED = "\u0000ungrouped";
const UPDATES = "\u0000updates";     // tracked plugins with a release since you reviewed them
const STARRED = "\u0000starred";
const DEFAULT_STATUSES = ["to-try", "watching", "testing", "adopted", "replaced"];   // labels come from the locale
const LEGACY_STATUS = { candidate: "to-try", trying: "testing", using: "adopted", dropped: "replaced" };   // 0.7.1–0.7.2
const GROUP_HUES = 8;
const DAY_PRESETS = [1, 3, 7, 14, 30, 60, 90];
const DORMANT_PRESETS = [30, 60, 90, 120, 180, 360];
/** Per tab: is "Downloads ≥" on, and how rows are sorted, until the user changes them. */
const TAB_DEFAULTS = {
  all: { downloads: false, sort: "downloads" },   // every plugin, unfiltered
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
    dormantDays: 60,      // incubation: the pause before the latest release
    newDays: NEW_BADGE_DAYS,
    hideBusy: true,       // Updated: hide plugins with more than BUSY_LIMIT releases in BUSY_DAYS
    section: "home",      // home | list (Tracked is the list on its tab)
    start: "home",        // the section the view opens on: home | last
    listMode: "all",      // the List's last tab
    home: homeDefaults(),
    minDownloads: 100,
    downloadFilter: {},   // tab → on/off; missing tabs use TAB_DEFAULTS
    extraFilters: {},     // tab → {filter: value} added with + Filter (EXTRA_FILTERS)
    trackedGroup: "",     // Tracked tab: "" = all, a group name, or UNGROUPED
    trackedSections: true,
    trackedStatus: "",
    statusEnabled: false,  // the status field is optional; its values stay in the notes when it's off
    statuses: DEFAULT_STATUSES.map((key) => ({ key, label: t(`statusDefault.${key}`) })),
    sortBy: {},           // tab → {key, dir}; missing tabs use TAB_DEFAULTS
    query: "",
    provider: "",
    model: "",
    modelPrice: "",
    keyNames: {},
    targetLang: t("language.name"),
    language: "auto",
    syncHours: 24,        // 0 = manual
    readmeMode: "open",   // open | sync | manual
    keyboard: false,      // single-letter shortcuts in the view
    similarSort: { key: "relevance", dir: "desc" },   // the Similar filter's own sort
    layout: "list",           // "list", "cards" or "table"
    tableColumns: {},         // tab → the table's columns in order (TABLE_COLUMNS); missing tabs use TABLE_DEFAULT
    notesHeading: "",         // heading above your own notes in new tracking notes; "" = "My notes" in the UI language
    readmeTranslation: "ask", // "ask": README in your language on request (details window, command); "off"
  };
}

