// ─── Home: widgets (pure) ────────────────────────────────────────────────────
// A widget is a list with a headline: `rows` picks and orders its plugins, `at` says when a plugin came in
// (so "new since your last visit" is rows with at > then), `value` labels a row in the preview. The home
// page, its "since your last visit" cards and the list it opens all read the same definition.

const OLD_MILESTONE_STEPS = [1000, 10000, 100000];   // the server's files before 0.9.2

function milestoneSteps(timeline) {
  return timeline.milestoneSteps || OLD_MILESTONE_STEPS;
}

/** When the plugin first passed `n` downloads (0: before the history; null: not yet). */
function passedAt(timeline, id, n) {
  const i = milestoneSteps(timeline).indexOf(n);
  return i < 0 ? null : timeline.milestones?.[id]?.[i] ?? null;
}

const byDownloads = (a, b) => (b.downloads ?? 0) - (a.downloads ?? 0);
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
    rows: (ctx, params) => ctx.state.catalog.filter((p) => passedAt(ctx.timeline, p.id, params.n) > since(ctx, params)).sort(byDownloads),
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
  rising: {
    icon: "trending-up", tone: "green",
    params: { days: [7, 30] }, defaults: { days: 30 },
    rows: (ctx, params) => {
      const i = params.days === 7 ? 0 : 1;
      const gain = (p) => ctx.state.growth[p.id]?.[i] ?? 0;
      return ctx.state.catalog.filter((p) => gain(p) > 0).sort((a, b) => gain(b) - gain(a));
    },
    value: (ctx, p, params) => `+${formatShort(ctx.state.growth[p.id]?.[params.days === 7 ? 0 : 1] ?? 0)}`,
    headline: (ctx, rows, params) => (rows[0] ? HOME_WIDGETS.rising.value(ctx, rows[0], params) : "–"),
  },
  quiet: {
    icon: "filter", tone: "blue",
    params: { days: [7, 14, 30] }, defaults: { days: 14 },
    rows: (ctx, params) => tabRows(ctx, "updated", { days: params.since ? Math.ceil((ctx.now - params.since) / DAY_MS) : params.days, hideBusy: true, sort: "updated", sortDir: "desc" })
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
// "Since your last visit": each card is a widget asked for what came in after then
const SINCE_CARDS = ["new", "tracked", "milestone", "quiet"];
const SINCE_PERIODS = ["visit", 7, 30];

function homeDefaults() {
  return { order: [...HOME_ORDER], hidden: [...HOME_HIDDEN], params: {}, since: { show: true, period: "visit", order: [...SINCE_CARDS] }, info: false, motion: true, preview: 3 };
}

/** Saved home settings filled with today's defaults (new widgets join the end). */
function normalizeHome(saved = {}) {
  const base = homeDefaults();
  const home = { ...base, ...saved, since: { ...base.since, ...saved.since } };
  home.order = [...home.order.filter((id) => HOME_WIDGETS[id]), ...base.order.filter((id) => !home.order.includes(id))];
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

/** The moment "new" counts from: your last visit (a week ago if there wasn't one), or 7 / 30 days ago. */
function sinceMoment(period, lastVisit, now) {
  if (period === "visit") return lastVisit || now - 7 * DAY_MS;
  return now - period * DAY_MS;
}

/** One widget worked out: its rows, how many are new since `then` (null: it can't tell), its headline. */
function widgetResult(ctx, id, params, then) {
  const widget = HOME_WIDGETS[id];
  const rows = widget.rows(ctx, params);
  const fresh = widget.at ? rows.filter((p) => widget.at(ctx, p, params) > then) : null;
  return { rows, fresh, headline: widget.headline ? widget.headline(ctx, rows, params) : formatCount(rows.length) };
}
