// ─── Home: widgets (pure) ────────────────────────────────────────────────────
// A widget is a list with a headline: `rows` picks and orders its plugins, `at` says when a plugin came in
// (so "new since your last visit" is rows with at > then), `value` labels a row in the preview. The home
// page, its "since your last visit" cards and the list it opens all read the same definition.

const OLD_MILESTONE_STEPS = [1000, 10000, 100000];   // the server's files before 0.9.2

function milestoneSteps(timeline) {
  return timeline.milestoneSteps || OLD_MILESTONE_STEPS;
}

/** A milestone's name: 1K, 25K, 100K in every language ("1 bin barajı" reads wrong in Turkish). */
const stepLabel = (n) => (n >= 1000 ? `${n / 1000}K` : String(n));

/** The highest milestone a plugin passed after `after` (null: none): 33K that passed 1K, 10K and 25K this month is a 25K. */
function topPassed(timeline, id, after) {
  return [...milestoneSteps(timeline)].reverse().find((n) => passedAt(timeline, id, n) > after) ?? null;
}

/** When the plugin first passed `n` downloads (0: before the history; null: not yet). */
function passedAt(timeline, id, n) {
  const i = milestoneSteps(timeline).indexOf(n);
  return i < 0 ? null : timeline.milestones?.[id]?.[i] ?? null;
}

const byDownloads = (a, b) => (b.downloads ?? 0) - (a.downloads ?? 0);
const RISING_BASE = 1000;    // downloads before the period, so 10 → 30 isn't "rising"
const RISING_SHARE = 0.2;    // grew by a fifth or more
const risingGain = (ctx, p, params) => ctx.state.growth[p.id]?.[params.days === 7 ? 0 : 1] ?? 0;
const since = (ctx, params) => params.since ?? ctx.now - params.days * DAY_MS;
/** A tab's plugins with the widget's own settings: no Downloads ≥, no search. */
const tabRows = (ctx, mode, extra) =>
  discover(ctx.state, { ...modeOptions(ctx.settings, mode), filterDownloads: false, query: "", ...extra }, ctx.now);

const HOME_WIDGETS = {
  new: {
    icon: "sparkles", tone: "purple",
    params: { days: [7, 14, 30] }, defaults: { days: 30 },
    rows: (ctx, params) => ctx.state.catalog.filter((p) => ctx.state.firstSeen[p.id] > since(ctx, params)).sort(byDownloads),
    at: (ctx, p) => ctx.state.firstSeen[p.id],
    value: (ctx, p) => formatShort(p.downloads ?? 0),
  },
  milestone: {
    icon: "target", tone: "green",
    params: { n: (ctx) => milestoneSteps(ctx.timeline), days: [7, 30, 90] }, defaults: { n: 10000, days: 30 },
    rows: (ctx, params) => ctx.state.catalog.filter((p) => topPassed(ctx.timeline, p.id, since(ctx, params)) === params.n).sort(byDownloads),
    at: (ctx, p, params) => passedAt(ctx.timeline, p.id, params.n),
    value: (ctx, p) => formatShort(p.downloads ?? 0),
  },
  hatched: {
    icon: "egg", tone: "orange",
    params: { gap: DORMANT_PRESETS }, defaults: { gap: 60 },
    rows: (ctx, params) => tabRows(ctx, "awakened", { dormantDays: params.gap, sort: "downloads", sortDir: "desc" }),
    at: (ctx, p) => p.updated,
    value: (ctx, p) => t("filter.days", { n: dormantDays(ctx.state.releases, p) }),
  },
  // by "pct": grew by at least RISING_SHARE on a base of RISING_BASE (a big plugin's +900K isn't news); "abs": most gained
  rising: {
    icon: "trending-up", tone: "green",
    params: { days: [7, 30], by: ["pct", "abs"] }, defaults: { days: 30, by: "pct" },
    rows: (ctx, params) => {
      const gain = (p) => risingGain(ctx, p, params);
      if (params.by === "abs") return ctx.state.catalog.filter((p) => gain(p) > 0).sort((a, b) => gain(b) - gain(a));
      const share = (p) => gain(p) / ((p.downloads ?? 0) - gain(p));
      return ctx.state.catalog.filter((p) => (p.downloads ?? 0) - gain(p) >= RISING_BASE && share(p) >= RISING_SHARE).sort((a, b) => share(b) - share(a));
    },
    value: (ctx, p, params) => {
      const gain = risingGain(ctx, p, params);
      return params.by === "abs" ? `+${formatShort(gain)}` : `+${Math.round((100 * gain) / ((p.downloads ?? 0) - gain))}%`;
    },
    headline: (ctx, rows, params) => (params.by === "abs" ? (rows[0] ? HOME_WIDGETS.rising.value(ctx, rows[0], params) : "–") : formatCount(rows.length)),
    unit: (params) => `home.rising.unit.${params.by}`,
    info: (params) => `home.rising.info.${params.by}`,
  },
  quiet: {
    icon: "filter", tone: "blue",
    params: { days: [7, 14, 30] }, defaults: { days: 14 },
    rows: (ctx, params) => tabRows(ctx, "updated", { days: params.since ? Math.ceil((ctx.now - params.since) / DAY_MS) : params.days, hideBusy: true, sort: "downloads", sortDir: "desc" })
      .filter((p) => p.updated > since(ctx, params)),
    at: (ctx, p) => p.updated,
    value: (ctx, p) => relativeDays(p.updated, ctx.now),
  },
  tracked: {
    icon: "bell-ring", tone: "yellow",
    params: {}, defaults: {},
    rows: (ctx) => tabRows(ctx, "tracked", { trackedGroup: UPDATES, trackedStatus: "" }),
    value: (ctx, p) => p.version || "",
  },
  installed: {
    icon: "package-check", tone: "gray",
    params: {}, defaults: {},
    rows: (ctx) => tabRows(ctx, "suggested", { sort: "downloads", sortDir: "desc" }),
    value: (ctx, p) => formatShort(p.downloads ?? 0),
  },
};
const HOME_ORDER = ["tracked", "new", "milestone", "hatched", "rising", "quiet", "installed"];
const HOME_HIDDEN = ["installed"];
// "Not seen yet": each card is a widget asked for what came in after you last opened its list
const SINCE_CARDS = ["new", "tracked", "milestone", "quiet"];
const SINCE_PERIODS = ["seen", 7, 30];

function homeDefaults() {
  return { order: [...HOME_ORDER], hidden: [...HOME_HIDDEN], params: {}, since: { show: true, period: "seen", order: [...SINCE_CARDS] }, seen: {}, info: false, motion: true, preview: 3 };
}

/** Saved home settings filled with today's defaults (new widgets join the end). */
function normalizeHome(saved = {}) {
  const base = homeDefaults();
  const home = { ...base, ...saved, since: { ...base.since, ...saved.since } };
  home.order = [...home.order.filter((id) => HOME_WIDGETS[id]), ...base.order.filter((id) => !home.order.includes(id))];
  if (home.since.period === "visit") home.since.period = "seen";   // before 0.9.2: since the plugin last loaded
  home.since.order = [...home.since.order.filter((id) => SINCE_CARDS.includes(id)), ...SINCE_CARDS.filter((id) => !home.since.order.includes(id))];
  return home;
}

/** A widget's settings: its defaults, then yours. */
function widgetParams(home, id) {
  return { ...HOME_WIDGETS[id].defaults, ...home.params?.[id] };
}

/** The options of a widget setting (a list, or one worked out from the data, like milestone steps). */
function paramOptions(ctx, id, key) {
  const options = HOME_WIDGETS[id].params[key];
  return typeof options === "function" ? options(ctx) : options;
}

/** The moment a widget's "new" counts from: the newest plugin you saw in its list (a week ago if none yet), or 7 / 30 days ago. */
function sinceMoment(home, id, now) {
  const period = home.since.period;
  if (period === "seen") return home.seen?.[id] || now - 7 * DAY_MS;
  return now - period * DAY_MS;
}

/** The newest `at` among a widget's rows after `then` (null: nothing new): seen up to there, so data that syncs in late still counts. */
function seenUpTo(ctx, id, params, rows, then) {
  const at = HOME_WIDGETS[id].at;
  const times = at ? rows.map((p) => at(ctx, p, params)).filter((x) => x > then) : [];
  return times.length ? Math.max(...times) : null;
}

/** One widget worked out: its rows, how many are new since `then` (null: it can't tell), its headline. */
function widgetResult(ctx, id, params, then) {
  const widget = HOME_WIDGETS[id];
  const rows = widget.rows(ctx, params);
  const fresh = widget.at ? rows.filter((p) => widget.at(ctx, p, params) > then) : null;
  return { rows, fresh, headline: widget.headline ? widget.headline(ctx, rows, params) : formatCount(rows.length) };
}
