// ─── Home: widgets (pure) ────────────────────────────────────────────────────
// A widget is a query with a headline: `query` picks and orders its plugins (the card and the list it opens
// both run it, so they always agree), `at` says when a plugin came in (so "new since your last visit" is rows
// with at > then), `value` labels a row in the preview.

const OLD_MILESTONE_STEPS = [1000, 10000, 100000];   // the server's files before 0.9.2

/** The download counts the timeline keeps milestones for (1K, 5K, 10K…); older files had three. */
function milestoneSteps(timeline) {
  return timeline.milestoneSteps || OLD_MILESTONE_STEPS;
}

/** A milestone's name: 1K, 25K, 100K in every language ("1 bin barajı" reads wrong in Turkish). */
const stepLabel = (n) => (n >= 1000 ? `${n / 1000}K` : String(n));

/** When the plugin first passed `n` downloads (0: before the history; null: not yet). */
function passedAt(timeline, id, n) {
  const i = milestoneSteps(timeline).indexOf(n);
  return i < 0 ? null : timeline.milestones?.[id]?.[i] ?? null;
}

const seriesCache = new WeakMap();   // a timeline's series → {ages, counts: Map(id → downloads on each day)}, decoded on first use

/** The series read once: each point's age (days before its last day) and, per plugin, its counts as asked for. */
function seriesRead(series) {
  let read = seriesCache.get(series);
  if (!read) seriesCache.set(series, (read = { ages: series.days.map((day) => series.days.at(-1) - day), counts: new Map() }));
  return read;
}

/** The plugin's downloads on each of the series' days (oldest first); null without a series or a plugin in it. */
function seriesOf(timeline, id) {
  const series = timeline?.series;
  if (!series?.days) return null;
  const { counts } = seriesRead(series);
  if (!counts.has(id)) counts.set(id, series.points[id] ? seriesCountsOf(series.points[id]) : null);   // the file keeps the changes
  return counts.get(id);
}

/** Days before the series' last day of each of its points, oldest first. */
const seriesAges = (timeline) => seriesRead(timeline.series).ages;

/**
 * Downloads `days` before the series' last day. Between two points (Mondays before the last month) in proportion;
 * null beyond the series' year or without it.
 */
function downloadsAgo(timeline, id, days) {
  const counts = seriesOf(timeline, id);
  const ages = counts && seriesAges(timeline);
  if (!counts || !(days >= 0) || days > ages[0]) return null;
  const i = ages.findIndex((age) => age <= days);   // ages go down: the first point at or after that day
  if (i === 0 || ages[i] === days) return counts[i];
  const [older, newer] = [ages[i - 1], ages[i]];
  return counts[i - 1] + ((counts[i] - counts[i - 1]) * (older - days)) / (older - newer);
}

/** Downloads gained in the last `days` (a younger plugin: all it has); null without the series. */
function gainOver(timeline, id, days) {
  const then = downloadsAgo(timeline, id, days);
  return then == null ? null : Math.round(seriesOf(timeline, id).at(-1) - then);
}

/**
 * When the downloads first reached `n` (ms). Within the series: the day of its first point at or over n (to the week
 * before the last month). Already over n when the series starts: a milestone step's own date, else 0 (long ago).
 * Null: not yet.
 */
function reachedAt(timeline, id, n) {
  const counts = seriesOf(timeline, id);
  if (!counts) return passedAt(timeline, id, n);
  const i = counts.findIndex((count) => count >= n);
  if (i < 0) return null;
  return i > 0 ? timeline.to - seriesAges(timeline)[i] * DAY_MS : passedAt(timeline, id, n) ?? 0;
}

const RISING_BASE = 1000;    // downloads before the period, so 10 → 30 isn't "rising"
const RISING_SHARE = 0.2;    // grew by a fifth or more

/**
 * Growth over the last `days` as a share of the downloads before it. Null without data or under RISING_BASE.
 * The one formula behind `rise()`, its sort and the Rising widget.
 */
function riseShare(timeline, p, days) {
  const gain = gainOver(timeline, p.id, days);
  if (gain == null) return null;
  const base = seriesOf(timeline, p.id).at(-1) - gain;
  return base < RISING_BASE ? null : gain / base;
}

/** The plugins a query finds, the way a page in Query mode would (hidden ones out unless it asks for them). */
const queryRows = (ctx, text) => discover(ctx.state, { ...modeOptions({ ...ctx.settings, queries: { all: text } }, "all"), query: "" }, ctx.now);

/** A widget's plugins: what its query finds (asked "since", its query says from which day: the card and its list agree). */
const widgetRows = (ctx, widget, params) => queryRows(ctx, widget.query(ctx, params));

/** A widget asked "from this day on" (a "since" card, a card's "N new"): `since` takes the place of its days. */
function sinceParams(params, since) {
  const { days, ...rest } = params;
  return { ...rest, since };
}

/** A widget's time window on a days field: its last N days, or (asked "since") from that day on. */
const within = (field, params) => (params.since ? `${field} >= ${dayString(params.since)}` : `${field} <= ${params.days}d`);

/**
 * A query asked "since": its own window on `field` (`listed <= 14d`) gives way to `condition` (`listed >= 2026-11-13`);
 * a query without one gets it joined (in parentheses only when it has an OR). Its order is kept.
 */
function narrowQuery(text, field, condition) {
  const { filter, order } = splitOrder(text);
  const own = new RegExp(`(^|[\\s(])${field}\\s*<=?\\s*[^\\s)]+`, "i");   // the field's "within N days"
  const narrowed = own.test(filter)
    ? filter.replace(own, `$1${condition}`)
    : [filter && (/\bOR\b/i.test(filter) ? `(${filter})` : filter), condition].filter(Boolean).join(" AND ");
  return [narrowed, order].filter(Boolean).join("\n");
}

/**
 * A page's widget: the page's own query, so the card counts the page (change one, the other follows). Asked "since",
 * `field` says from which day its plugins came in ("N new"); a page without one (Suggested) has no "new".
 * `page`: a click opens the page itself (Tracked, with its groups) instead of a list of the query.
 */
const tabWidget = (mode, look, field, value, page = false) => ({
  tab: mode, ...look, value, params: {}, defaults: {}, page: page && mode,
  query: (ctx, params) => (params.since && field ? narrowQuery(pageQuery(ctx.settings, mode), field, within(field, params)) : pageQuery(ctx.settings, mode)),
  ...(field && { at: (ctx, p) => QUERY_FIELDS[field].at(ctx.state, p, ctx.now) }),
});
const downloadsValue = (ctx, p) => formatShort(p.downloads ?? 0);

/**
 * The home widgets. `query` is the widget: the card counts and previews what it finds, and the list it opens is
 * the same query. A tab has its widget (new, awakened, updated, suggested: the tab's query); the others carry
 * their own.
 */
const HOME_WIDGETS = {
  mine: tabWidget("tracked", { icon: "bookmark", tone: "yellow" }, null, (ctx, p) => "★".repeat(ctx.state.notes.get(p.id)?.rating || 0) || downloadsValue(ctx, p), true),
  new: tabWidget("new", { icon: "sparkles", tone: "purple" }, "listed", downloadsValue),
  // passed n downloads in the period (9,999 → 10K), whatever it reached after
  milestone: {
    icon: "target", tone: "green",
    params: { n: (ctx) => milestoneSteps(ctx.timeline), days: [7, 30, 90] }, defaults: { n: 10000, days: 30 },
    query: (ctx, params) => `${within(`milestone(${queryCount(params.n)})`, params)}\norder by downloads desc`,
    at: (ctx, p, params) => reachedAt(ctx.timeline, p.id, params.n),
    value: downloadsValue,
  },
  awakened: tabWidget("awakened", { icon: "egg", tone: "orange" }, "hatched", (ctx, p) => t("filter.days", { n: lastHatch(ctx.state.releases, p)?.days })),
  // by "pct": grew by at least RISING_SHARE on a base of RISING_BASE (a big plugin's +900K isn't news); "abs": most gained
  rising: {
    icon: "trending-up", tone: "green",
    params: { days: [7, 30, 90], by: ["pct", "abs"] }, defaults: { days: 30, by: "pct" },
    query: (ctx, { days = 30, by }) => (by === "abs" ? `gain(${days}d) > 0\norder by gain(${days}d) desc` : `rise(${days}d) >= ${RISING_SHARE * 100}\norder by rise(${days}d) desc`),
    value: (ctx, p, params) => (params.by === "abs"
      ? `+${formatShort(gainOver(ctx.timeline, p.id, params.days) ?? 0)}`
      : `+${Math.round(100 * (riseShare(ctx.timeline, p, params.days) ?? 0))}%`),
    headline: (ctx, rows, params) => (params.by === "abs" ? (rows[0] ? HOME_WIDGETS.rising.value(ctx, rows[0], params) : "–") : formatCount(rows.length)),
    unit: (params) => `home.rising.unit.${params.by}`,
    info: (params) => `home.rising.info.${params.by}`,
  },
  // what you hid (ignored, until the next release, out of Suggested): the card counts them, a click opens the Hidden page
  hidden: {
    icon: "eye-off", tone: "gray", params: {}, defaults: {}, page: "hidden",
    query: () => "excluded OR snoozed OR dismissed\norder by name asc",
    value: (ctx, p) => t(`hidden.kind.${LIST_MODES.find((kind) => QUERY_FIELDS[kind].get(ctx.state, p, ctx.now))}`),
  },
  updated: tabWidget("updated", { icon: "filter", tone: "blue" }, "released", (ctx, p) => relativeDays(p.updated, ctx.now)),
  // "since your last visit" asks it without `since`: not reviewed yet is what you haven't seen (see renderSince)
  tracked: {
    icon: "bell-ring", tone: "yellow",
    params: {}, defaults: {},
    query: (ctx, params) => `unreviewed${params.since ? ` AND ${within("released", params)}` : ""}\norder by released desc`,   // unreviewed: tracked already
    at: (ctx, p) => p.updated,
    value: (ctx, p) => p.version || "",
  },
  suggested: tabWidget("suggested", { icon: "package-check", tone: "gray" }, null, downloadsValue),
};
const VIEW_PREFIX = "view:";   // a saved view's widget id: "view:<id>"
const VIEW_SEEN_CAP = 5000;    // a view's matches you've seen are kept as ids, up to this many

/** A view saved before 0.10 (a tab and its filters) as the query it meant: the tab's query, then its filters. */
function legacyViewQuery(view, settings) {
  const merged = { ...settings, queries: {}, ...view.filters };
  return joinQuery(pageQuery(settings, view.mode), filtersToQuery(merged, view.mode));
}

/**
 * A view you saved from the list (a tab and its filters) as a widget. It has no "came in" moment, so a match is
 * new when it wasn't among the ones you saw when you last opened it (`seen`: their ids).
 */
function viewWidget(view, seen) {
  const known = Array.isArray(seen) ? new Set(seen) : null;
  return {
    icon: "bookmark", tone: "blue", params: {}, defaults: {}, view,
    query: () => view.query,
    isNew: known && ((ctx, p) => !known.has(p.id)),
    value: (ctx, p) => formatShort(p.downloads ?? 0),
  };
}

/** A widget by id: a built-in one, or one of your saved views (undefined: a view since deleted). */
function homeWidget(home, id) {
  if (!id.startsWith(VIEW_PREFIX)) return HOME_WIDGETS[id];
  const view = home.views?.find((v) => VIEW_PREFIX + v.id === id);
  return view && viewWidget(view, home.seen?.[id]);
}

/** The ids a view's widget remembers as seen (none past the cap: too many to tell what's new). */
function seenIds(rows) {
  return rows.length <= VIEW_SEEN_CAP ? rows.map((p) => p.id) : null;
}

const HOME_ORDER = ["tracked", "new", "milestone", "awakened", "rising", "updated"];
const HOME_HIDDEN = ["milestone"];   // in the gallery to bring back
// At a glance, first group: each card is a widget asked "since" your last visit day (see recordVisit)
const SINCE_CARDS = ["new", "tracked", "updated"];
// At a glance, second group: where you stand, whatever the period (a total each)
const STATE_CARDS = ["mine", "suggested", "hidden"];
const SINCE_PERIODS = ["seen", 7, 30];
const GROUP_LOOKS = ["small", "big"];   // small: a number and its label; big: the number, the top plugins, settings

/**
 * Home is groups of widgets, in your order. A group shows one kind of card (`look`), so a row of small cards never
 * sits under a tall one; `half` puts two side by side; `since` counts a small card from the period on ("new since").
 * `name` is yours; empty, the built-in group's own (home.group.<id>).
 */
function defaultGroups() {
  return [
    { id: "news", name: "", look: "small", half: false, since: true, items: [...SINCE_CARDS] },
    { id: "state", name: "", look: "small", half: false, since: false, items: [...STATE_CARDS] },
    { id: "discover", name: "", look: "big", half: false, since: false, items: HOME_ORDER.filter((id) => !HOME_HIDDEN.includes(id)) },
  ];
}

function homeDefaults() {
  return { groups: defaultGroups(), params: {}, since: { period: "seen" }, visit: { last: null, before: null }, seen: {}, views: [], info: false, preview: 3, quickstart: true };
}

/** Saved home settings filled with today's defaults; a group keeps only widgets that still exist, each once. */
function normalizeHome(saved = {}) {
  const base = homeDefaults();
  const home = { ...base, ...saved, since: { period: saved.since?.period ?? base.since.period } };
  if (home.since.period === "visit") home.since.period = "seen";   // before 0.9.2: since the plugin last loaded
  const groups = Array.isArray(saved.groups) ? saved.groups : legacyGroups(saved, base.groups);
  home.groups = groups.map((g) => ({
    ...g,
    look: GROUP_LOOKS.includes(g.look) ? g.look : "big",
    items: [...new Set(g.items || [])].filter((id) => homeWidget(home, id)),
  }));
  for (const key of ["order", "hidden"]) delete home[key];   // before 0.11: one widget grid and a fixed "At a glance"
  return home;
}

/** Before groups: the widget grid (`order` less `hidden`) and the "since" order become the groups they were. */
function legacyGroups(saved, groups) {
  if (!saved.order) return groups;
  const [news, state, discover] = groups;
  if (saved.since?.show === false) return [discover];
  return [
    { ...news, items: saved.since?.order || news.items },
    state,
    { ...discover, items: saved.order.filter((id) => !(saved.hidden || []).includes(id) && !STATE_CARDS.includes(id)) },
  ];
}

/** The widgets on no group: the built-in ones and your saved views, for the gallery to bring back. */
function unplacedWidgets(home) {
  const placed = new Set(home.groups.flatMap((g) => g.items));
  return [...Object.keys(HOME_WIDGETS), ...(home.views || []).map((v) => VIEW_PREFIX + v.id)].filter((id) => !placed.has(id));
}

/** A widget's settings: its defaults, then yours. */
function widgetParams(home, id) {
  return { ...homeWidget(home, id).defaults, ...home.params?.[id] };
}

/** The options of a widget setting (a list, or one worked out from the data, like milestone steps). */
function paramOptions(ctx, id, key) {
  const options = homeWidget(ctx.settings.home, id).params[key];
  return typeof options === "function" ? options(ctx) : options;
}

/**
 * Notes today as a visit. The first opening of a day moves the last visit day to `before`: "since your last visit"
 * counts from that day on, all day, however often you open the lists (opening one empties nothing). True: it changed.
 */
function recordVisit(home, now) {
  const today = dayString(now);
  if (home.visit?.last === today) return false;
  home.visit = { last: today, before: home.visit?.last ?? null };
  return true;
}

/** Where "new" starts: the start of your last visit day (first use: a week ago), or 7 / 30 days ago. */
function sinceMoment(home, now) {
  const period = home.since.period;
  if (period !== "seen") return now - period * DAY_MS;
  return home.visit?.before ? dayStart(home.visit.before) : now - 7 * DAY_MS;
}

/** A widget's new rows: came in from `then` on, or (a saved view) not seen before; null when it can't tell. */
function freshRows(ctx, widget, params, rows, then) {
  if (widget.at) return rows.filter((p) => widget.at(ctx, p, params) >= then);
  return widget.isNew ? rows.filter((p) => widget.isNew(ctx, p)) : null;
}

/**
 * One widget worked out: its rows, its new ones and its headline. A built-in widget's new ones are its query asked
 * "since" (what its "N new" opens); a saved view's are the matches you hadn't seen; null when it can't tell.
 */
function widgetResult(ctx, widget, params, then) {
  const rows = widgetRows(ctx, widget, params);
  const fresh = widget.at ? widgetRows(ctx, widget, sinceParams(params, then)) : freshRows(ctx, widget, params, rows, then);
  return { rows, fresh, headline: widget.headline ? widget.headline(ctx, rows, params) : formatCount(rows.length) };
}
