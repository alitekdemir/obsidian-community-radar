// ─── Query language (advanced search) ───────────────────────────────────────
// JQL-like: `downloads > 500 released >= -30d group in ("Tasks", Calendar) NOT installed calendar order by gain(30d) desc`.
// A field with a parameter is written like a function: `gain(21d)`; `gain()` takes its default (`param`).
// Field names are English only (one vocabulary: saved queries survive a language switch); values are yours.
// A space is AND; AND, OR, NOT and ( ) work too. Words that aren't a clause search the name, author, id and
// description. An invalid query isn't applied (see the view), and its error says where.

/** Field types decide the operators: number (counts, days), text, list (your groups), bool. */
const QUERY_OPS = {
  number: ["=", "!=", ">", ">=", "<", "<=", "is"],
  text: ["=", "!=", "~", "!~", "in", "not in"],
  list: ["=", "!=", "in", "not in", "is"],
  bool: ["=", "!="],
};

const daysAgo = (ms, now) => (ms > 0 ? (now - ms) / DAY_MS : null);
/** Days since a moment the history knows, where 0 is "before it started": then at least as long as the history. */
const historyDays = (s, ms, now) => (ms === 0 ? daysAgo(s.timeline?.from, now) : daysAgo(ms, now));
/** Listed just now: the history hasn't seen it yet and it has no download count. */
const isUnlisted = (s, p) => s.firstSeen[p.id] === undefined && p.downloads == null;

/** Growth over `days` in percent (see riseShare: 10 → 30 isn't rising). */
const gainShare = (s, p, days) => { const share = riseShare(s.timeline, p, days); return share == null ? null : 100 * share; };
/** The highest milestone a plugin ever passed, before the history too (null: none, or no history). */
const topMilestone = (s, p) => (s.timeline ? [...milestoneSteps(s.timeline)].reverse().find((n) => passedAt(s.timeline, p.id, n) != null) ?? null : null);
/** When it passed that milestone (0: before the history; null: none). */
const milestoneAt = (s, p) => { const n = topMilestone(s, p); return n == null ? null : passedAt(s.timeline, p.id, n); };
/** When it reached n downloads, or (n null: `milestone()`) its latest milestone. */
const reachedOrLatest = (s, p, n) => (n == null ? milestoneAt(s, p) : reachedAt(s.timeline, p.id, n));

/**
 * The fields: type, value (null: empty), and for dates the moment itself (`at`): such a field is a moment, written
 * `released >= -14d` (14 days ago or later) or `released > 2026-01-01`; `>=` is always "later". A days field without
 * `at` (incubated) is a length: `incubated >= 60d`.
 * `sort`: `order by` can use it (`rank`, when given, is its sort value instead of `at` or the value). `param`: it takes
 * one, written like a function: `kind` days or count, `fallback` what `()` means (null: the field's own default).
 */
const QUERY_FIELDS = {
  // what a plain word searches: the listing's texts and the AI summary
  text: { type: "text", get: (s, p) => `${p.id} ${p.name} ${p.author} ${p.description} ${profileOf(s, p)?.summary ?? ""}` },
  name: { type: "text", sort: "name", get: (s, p) => p.name },
  description: { type: "text", get: (s, p) => p.description },
  author: { type: "text", group: true, get: (s, p) => p.author },
  id: { type: "text", get: (s, p) => p.id },
  downloads: { type: "number", sort: true, rank: (s, p) => p.downloads ?? null, get: (s, p) => p.downloads ?? 0 },
  // the downloads series (a year): gained over any window, as a count or a share
  gain: { type: "number", sort: true, param: { kind: "days", fallback: "30d" }, get: (s, p, now, days) => gainOver(s.timeline, p.id, days) },
  rise: { type: "number", sort: true, param: { kind: "days", fallback: "30d" }, get: (s, p, now, days) => gainShare(s, p, days) },
  // update waves (releases days apart; a hotfix the same week is the same update) in the last N days
  releases: { type: "number", sort: true, param: { kind: "days", fallback: "30d" }, get: (s, p, now, days) => updateWaves(s.releases[p.id] || [], now - days * DAY_MS, now) },
  released: { type: "number", days: true, sort: true, get: (s, p, now) => daysAgo(p.updated, now), at: (s, p) => p.updated },
  // a plugin the history hasn't seen yet (no downloads count either) came in just now
  // sorted by its place in the official list (the order plugins came in): first-seen is 0 for every older one
  listed: { type: "number", days: true, sort: true, rank: (s, p) => s.position?.get(p.id) ?? null,
    get: (s, p, now) => (isUnlisted(s, p) ? 0 : historyDays(s, s.firstSeen[p.id], now)), at: (s, p, now) => (isUnlisted(s, p) ? now : s.firstSeen[p.id]) },
  // incubation (see lastHatch): how long the latest pause lasted, and how long ago the plugin came out of it
  incubated: { type: "number", days: true, sort: true, rank: (s, p) => lastHatch(s.releases, p)?.days ?? null, get: (s, p) => lastHatch(s.releases, p)?.days ?? null },
  hatched: { type: "number", days: true, sort: true, get: (s, p, now) => daysAgo(lastHatch(s.releases, p)?.at, now), at: (s, p) => lastHatch(s.releases, p)?.at ?? null },
  rating: { type: "number", sort: true, get: (s, p) => s.notes.get(p.id)?.rating || null },
  // days since it reached n downloads (`milestone(10k)`); `milestone()`: since its latest step (1K, 5K, 10K…)
  milestone: { type: "number", days: true, sort: true, param: { kind: "count", fallback: null },
    get: (s, p, now, n) => historyDays(s, reachedOrLatest(s, p, n), now), at: (s, p, now, n) => reachedOrLatest(s, p, n) },
  group: { type: "list", group: true, get: (s, p) => s.notes.get(p.id)?.groups || [] },
  status: { type: "list", group: true, get: (s, p) => { const st = s.notes.get(p.id)?.status; return st ? [st] : []; } },
  installed: { type: "bool", get: (s, p) => s.installed.has(p.id) },
  library: { type: "bool", get: (s, p) => s.notes.has(p.id) },   // has a note (the Library page); `tracked` before 0.16 (migrateLibraryField)
  unreviewed: { type: "bool", get: (s, p) => { const note = s.notes.get(p.id); return Boolean(note) && isUnreviewed(p, note); } },   // in your library, released since you reviewed it
  dismissed: { type: "bool", get: (s, p) => Boolean(s.dismissed?.has(p.id)) },
  // hidden plugins: lists leave them out unless the query names one of these
  excluded: { type: "bool", get: (s, p) => Boolean(s.excluded?.has(p.id)) },
  snoozed: { type: "bool", get: (s, p) => isSnoozed(p, s.snoozed || {}) },
  // taken off the official list (only the installed ones are rows: see removedRows); lists leave them out unless asked
  removed: { type: "bool", get: (s, p) => Boolean(p.removed) },
  // AI profiles (17-profiles): empty for a plugin not profiled yet, and until the profiles are loaded
  category: { type: "list", profile: true, group: true, get: (s, p) => profileCategories(profileOf(s, p)) },   // its home and up to two more
  primary: { type: "text", profile: true, group: true, get: (s, p) => profileOf(s, p)?.primary ?? null },        // its home: one per plugin
  tag: { type: "list", profile: true, group: true, get: (s, p) => profileOf(s, p)?.tags || [] },
  intent: { type: "text", profile: true, group: true, get: (s, p) => profileOf(s, p)?.intent ?? null },          // new, improve, alternative
  lifecycle: { type: "list", profile: true, group: true, get: (s, p) => { const v = profileOf(s, p)?.lifecycle; return v ? [v] : []; } },   // a list for `is empty`
  apikey: { type: "bool", profile: true, get: (s, p) => profileNeeds(profileOf(s, p), "apiKey") },
  paid: { type: "bool", profile: true, get: (s, p) => profileNeeds(profileOf(s, p), "paidService") },
  summary: { type: "text", profile: true, get: (s, p) => profileOf(s, p)?.summary ?? null },
  // what's in your language: the short description, the Overview (stale ones don't count: see overviewCurrent)
  translated: { type: "list", get: (s, p) => {
    const saved = s.translations;
    if (!saved) return [];
    const desc = saved.description[p.id];
    const description = p.description && desc?.src === p.description && (!desc.lang || desc.lang === s.targetLang);
    const overview = overviewCurrent(saved.overview[p.id], profileOf(s, p)?.summary, s.targetLang);
    return [description && "description", overview && "overview"].filter(Boolean);
  } },
};
/** What intent and lifecycle can be (the profiler's closed lists). */
const PROFILE_VALUES = { intent: ["new", "improve", "alternative"], lifecycle: ["experimental", "deprecated"] };
/** What `translated` can hold. */
const TRANSLATED_VALUES = ["description", "overview"];
/** A query's tail after its filter, in this order: `group by <field>`, `order by <field> [asc|desc]`, `limit N | A-B`. */
const TAIL_PARTS = ["group", "order", "limit"];

/** A field name as a clause, not as a value (`name ~ busy` stays): after neither an operator nor a word or quote. */
const asClause = (word) => new RegExp(`(?<![=~<>!]\\s*)(?<![\\w"])${word}(?![\\w(])`, "gi");

/** Runs `fn` on a query's text outside "quoted strings" and /regex/, which stay as written. */
const outsideQuotes = (text, fn) => String(text).split(/("(?:[^"\\]|\\.)*"|\/(?:[^/\\]|\\.)+\/[a-z]*)/)
  .map((part, idx) => (idx % 2 === 1 ? part : fn(part))).join("");

/**
 * A query saved before 0.11 in today's fields: busy → releases(180d) > 9, new → listed >= -14d, gain7 / rise30 →
 * gain(7d) / rise(30d), a bare milestone → milestone(). Quoted strings and /regex/ stay untouched.
 */
function migrateQuery(text, newDays = DEFAULT_NEW_DAYS) {
  return outsideQuotes(text, (part) => part
    .replace(/\bNOT\s+busy\b/gi, `releases(${BUSY_DAYS}d) <= ${BUSY_LIMIT}`)
    .replace(asClause("busy"), `releases(${BUSY_DAYS}d) > ${BUSY_LIMIT}`)
    .replace(asClause("new"), `listed >= -${newDays}d`)
    .replace(asClause("(gain|rise)(7|30)"), "$1($2d)")
    .replace(asClause("milestone"), "milestone()"));
}

/** 0.16: the `tracked` field is `library` (the Library page); values, quotes and /regex/ stay. */
const libraryQuery = (text) => outsideQuotes(text, (part) => part.replace(asClause("tracked"), "library"));

/** 0.10: a tab's days, pause and Downloads ≥ become its query; changes `st` (the settings) in place. */
function migratePageQueries(st) {
  const old = { days: st.days ?? 14, incubated: st.dormantDays ?? INCUBATION_DAYS };
  const min = (mode) => (st.downloadFilter?.[mode] ?? true ? st.minDownloads ?? 100 : 0);   // on by default there
  const mine = {
    new: defaultPageQuery("new", old),
    updated: defaultPageQuery("updated", { ...old, downloads: min("updated") }),
    awakened: defaultPageQuery("awakened", { ...old, downloads: min("awakened") }),
  };
  st.pageQueries = Object.fromEntries(Object.entries(mine).filter(([mode, q]) => q !== defaultPageQuery(mode)));   // only what differs
  for (const mode of ["updated", "awakened"]) if (st.downloadFilter) delete st.downloadFilter[mode];
  st.queries = {};
  if (st.queryMode) st.query = "";   // 0.10 builds before this: one query for every tab
  delete st.queryMode;
}

/** Every saved query (pages, boxes, recent ones, views) through `move`; changes `st` (the settings) in place. */
function mapSavedQueries(st, move) {
  const each = (q) => (typeof q === "string" ? move(q) : q);   // a missing query stays missing
  const byPage = (queries) => Object.fromEntries(Object.entries(queries || {}).map(([page, q]) => [page, each(q)]));
  Object.assign(st, { pageQueries: byPage(st.pageQueries), queries: byPage(st.queries), recentQueries: (st.recentQueries || []).map(each) });
  if (st.home?.views) st.home.views = st.home.views.map((v) => ({ ...v, query: each(v.query) }));
}

/** 0.11: every saved query in today's fields (see migrateQuery). */
const migrateFields011 = (st) => mapSavedQueries(st, (q) => migrateQuery(q, st.newDays));

/** 0.16: every saved query with `library` for `tracked` (see libraryQuery). */
const migrateLibraryField = (st) => mapSavedQueries(st, libraryQuery);

/** A parameter as the field reads it (days or a count); null if it isn't one. */
function paramValue(field, text) {
  const value = queryNumber(text, field.param.kind === "days");
  return value && !value.date && Number.isFinite(value.n) && value.n >= 0 ? value.n : null;
}

/** `gain(21d)` → {name: "gain", arg: 21, text: "21d"}: a sort key or field reference with its parameter resolved. */
function fieldRef(key) {
  const [, name, inner] = String(key).match(/^(\w+)(?:\(([^)]*)\))?$/) || [];
  const field = QUERY_FIELDS[fold(name)];
  if (!field) return null;
  if (!field.param) return inner == null ? { name: fold(name), field, arg: null, text: "" } : null;
  const text = inner?.trim() || field.param.fallback;
  return { name: fold(name), field, text: text ?? "", arg: text == null ? null : paramValue(field, text) };
}

/**
 * Date functions for date fields (released, listed, hatched), Jira style: `startOfMonth(-1)` is last month's first day.
 * Keyed as they're written (the suggestions and the guide show these names); a query may type them in any case.
 */
const QUERY_FUNCS = {
  today: (now, n) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d.getTime(); },
  startOfWeek: (now, n) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 7 * n); return d.getTime(); },   // weeks start on Monday
  startOfMonth: (now, n) => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime(); },
  startOfYear: (now, n) => new Date(new Date(now).getFullYear() + n, 0, 1).getTime(),
  lastSync: (now, n, s) => s.lastSync ?? null,   // the sync before the latest one
};
/** A date function's written name for any spelling (`startofmonth` → `startOfMonth`); undefined if it's none. */
const queryFuncName = (text) => Object.keys(QUERY_FUNCS).find((name) => fold(name) === fold(text));
/** The date function for any spelling of its name; undefined if it's none. */
const queryFunc = (text) => QUERY_FUNCS[queryFuncName(text)];

const QUERY_CMP = {
  "=": (a, b) => Math.round(a) === Math.round(b), "!=": (a, b) => Math.round(a) !== Math.round(b),
  ">": (a, b) => a > b, ">=": (a, b) => a >= b, "<": (a, b) => a < b, "<=": (a, b) => a <= b,
};

/** Case and Turkish dotted/dotless i folded, so `istanbul` finds `İstanbul` and `image` finds `IMAGE`. */
const fold = (text) => String(text ?? "").toLowerCase().replace(/i̇/g, "i").replace(/ı/g, "i");

/** Folded, letters and digits only: `side-note`, `Side Note` and `SideNote` all read `sidenote`. */
const compact = (text) => fold(text).replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * `~` and plain search, as in JQL: every word of `text` is in the value, in any order; spaces, hyphens and case
 * don't count (`side note` finds SideNote and Side-Notes). In this order only: a /regex/.
 */
function containsWords(text) {
  const words = fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return (value) => {
    const hay = compact(value);   // once per value, then each word looks in it
    return words.every((word) => hay.includes(word));
  };
}

/** Precompiled detectors for advanced query syntax (clauses/tails are case-insensitive; standalone AND/OR/NOT are uppercase). */
const ADVANCED_CLAUSE_RE = (() => {
  const fields = Object.keys(QUERY_FIELDS).join("|");
  const calls = Object.keys(QUERY_FIELDS).filter((k) => QUERY_FIELDS[k].param).join("|");
  return new RegExp(`(^|[\\s(])(${fields})\\s*(=|!=|~|!~|>=?|<=?|\\bin\\b|\\bnot\\s+in\\b|\\bis\\b)|(^|[\\s(])(${calls})\\s*\\(|\\b(order|group)\\s+by\\b|\\blimit\\s+\\d`, "i");
})();
const ADVANCED_BOOL_RE = /(?:^|\s)(?:AND|OR|NOT)(?:\s|$)/;

/** Is this an advanced query (a field followed by an operator, uppercase AND/OR/NOT, or `order by`)? */
function isAdvancedQuery(query) {
  return ADVANCED_CLAUSE_RE.test(query) || ADVANCED_BOOL_RE.test(query);
}

/** Splits a query into tokens: words, "quoted", /regex/, operators, ( ) and commas, each with its position. */
function tokenize(query) {
  const tokens = [];
  const re = /\s*(?:("(?:[^"\\]|\\.)*"?)|(\/(?:[^/\\]|\\.)+\/[a-z]*)|(!=|!~|>=|<=|[=~<>(),!])|([^\s=!~<>(),"]+))/gy;
  let match;
  while (re.lastIndex < query.length && (match = re.exec(query))) {
    const [all, quoted, regex, op, word] = match;
    const at = match.index + all.length - (quoted || regex || op || word || "").length;
    const end = re.lastIndex;
    if (quoted != null) {
      const closed = quoted.length > 1 && /(?:^|[^\\])(?:\\\\)*"$/.test(quoted);
      const raw = quoted.slice(1, closed ? -1 : undefined).replace(/\\([\\"])/g, "$1");
      tokens.push({ kind: "value", text: raw, at, end, quoted: true, ...(closed ? {} : { unclosed: true }) });
    } else if (regex) tokens.push({ kind: "regex", text: regex, at, end });
    else if (op) tokens.push({ kind: op === "(" || op === ")" || op === "," ? op : "op", text: op, at, end });
    else if (word) tokens.push({ kind: "word", text: word, at, end });
    if (!all) break;
  }
  return tokens;
}

/**
 * A number value: 500, 10k, 1.5m. With `days`: a span (30d, 2w, 6m, 1y: {n}), a moment counted back from today
 * (-30d: {ago}, in days) or a date (2026-01-01 → that day's start on your clock: {date}).
 */
function queryNumber(text, days) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) && dayStart(text);
  if (date) return days ? { date } : null;
  const m = String(text).toLowerCase().match(/^(-?)(\d+(?:\.\d+)?)([kmdwy]?)$/);
  if (!m) return null;
  const [, minus, digits, unit] = m;
  const n = Number(digits);
  if (days) {
    const span = n * ({ "": 1, d: 1, w: 7, m: MONTH_DAYS, y: YEAR_DAYS }[unit] ?? NaN);
    return minus ? { ago: span } : { n: span };
  }
  if (minus) return null;   // counts don't go below zero
  return { n: n * ({ "": 1, k: 1e3, m: 1e6 }[unit] ?? NaN) };
}

/** `released >= -14d` asks for "14 days ago or later": the days since it, the other way round (≤ 14). */
const AGO_FLIP = { "=": "=", "!=": "!=", ">": "<", ">=": "<=", "<": ">", "<=": ">=" };

class QueryError extends Error {
  constructor(key, vars, at) {
    super(t(`query.error.${key}`, vars));
    this.at = at;
  }
}

/**
 * Compares a plugin's timestamp `at2` against a date target `moment` using `opText`.
 * `at2 == null` never matches; `at2 === 0` means "before history started" (matches `<` / `<=` / `!=`).
 * Equality (`=` / `!=`) compares local calendar days so `released = 2026-01-01` and `released = today()` work.
 */
function compareMoment(at2, moment, opText) {
  if (at2 == null || moment == null) return false;
  if (opText === "=" || opText === "!=") {
    const same = at2 > 0 && dayStart(dayString(at2)) === dayStart(dayString(moment));
    return opText === "=" ? same : !same;
  }
  if (at2 === 0) return opText === "<" || opText === "<=";
  return QUERY_CMP[opText](at2, moment);
}

/**
 * Parses an advanced query into {test(state, p, now), order, group, limit, pins, clauses, free, spans, fields, ast}.
 * `spans` are what the box paints: {from, to, kind: clause|neg|order}. `ast` holds structured clauses and feature
 * flags so Query → Basic and diff helpers share one grammar without re-tokenizing. Throws a QueryError with the
 * position of what it couldn't read, plus the spans so far and the broken part (from, to).
 */
function parseQuery(query, { strict = false } = {}) {
  const tokens = tokenize(query);
  let i = 0;
  let clauses = 0;
  const fields = new Set();   // the fields the query names (discover keeps hidden plugins when it names `excluded` or `snoozed`)
  const pins = {};            // field → the values its = / in / is empty clauses ask for, outside any NOT (group by's sections)
  const ast = { clauses: [], funcs: [], hasOr: false, hasNeg: false, hasParens: false, hasRegex: false, hasIn: false };
  let negated = 0;            // how many NOTs the clause being read is under
  let current = null;   // where the clause being read starts
  const free = [];
  const spans = [];
  const peek = () => tokens[i];
  const word = (w) => peek()?.kind === "word" && fold(peek().text) === w;
  /** Where the filter ends: `group by`, `order by` or `limit` (the tail, see TAIL_PARTS). */
  const atTail = () => word("order") || word("limit") || (word("group") && fold(tokens[i + 1]?.text) === "by");
  /** Values a clause asks for (folded; "" is `is empty`), kept for group by when no NOT is around it. */
  const pin = (name, values) => { if (!negated) pins[name] = new Set([...(pins[name] || []), ...values]); };
  const take = () => tokens[i++];
  const end = () => tokens[i - 1]?.end ?? 0;
  const fail = (key, vars = {}, at = peek()?.at ?? query.length) => {
    const error = new QueryError(key, vars, at);
    const to = tokens.find((tok) => tok.at >= at)?.end ?? query.length;
    Object.assign(error, { spans, from: Math.min(current ?? at, at), to: Math.max(to, at) });
    throw error;
  };

  /** A `/…/` token as a case-insensitive RegExp (its flags after the last / are ignored); fails with its error. */
  const regexOf = (token) => {
    const [, body] = token.text.match(/^\/(.+)\/[a-z]*$/);
    try {
      return new RegExp(body, "iu");
    } catch (error) {
      return fail("regex", { error: error.message }, token.at);
    }
  };

  const valueOf = (field, token) => {
    if (!token || token.unclosed || (token.kind !== "word" && token.kind !== "value" && token.kind !== "regex")) fail("value", { field }, token?.at);
    return token;
  };

  /**
   * A parametric field's `(param)`, right after its name: the field bound to that value (`()`: its fallback).
   * The name alone fails: `gain` must be written `gain()` so the default shows that it is one.
   */
  const callArgs = (name) => {
    const field = QUERY_FIELDS[name];
    if (peek()?.kind !== "(") fail("param", { field: name });
    take();
    const token = peek()?.kind === "word" ? take() : null;
    if (take()?.kind !== ")") fail("paren");
    const text = (token?.text ?? field.param.fallback)?.toLowerCase() ?? null;
    const arg = text == null ? null : paramValue(field, text);
    if (text != null && arg == null) fail(`param.${field.param.kind}`, { field: `${name}()` }, token?.at);
    const bound = { ...field, get: (s, p, now) => field.get(s, p, now, arg) };
    if (field.at) bound.at = (s, p, now) => field.at(s, p, now, arg);
    return { bound, text: text ?? "", arg };
  };

  /** One field's clause, its field (bound to its parameter) already taken. */
  const clause = (name, field, at, call = null) => {
    clauses++;
    fields.add(name);
    let op = peek();
    const isKwOp = word("in") || word("is") || (word("not") && fold(tokens[i + 1]?.text) === "in");
    if (field.type === "bool" && (!op || (op.kind !== "op" && !isKwOp))) {   // `installed`
      ast.clauses.push({ field: name, param: call?.text ?? "", arg: call?.arg ?? null, op: null, value: true, from: at, to: end() });
      return (s, p, now) => field.get(s, p, now);
    }
    if (word("not") && fold(tokens[i + 1]?.text) === "in") { const opAt = take().at; take(); op = { text: "not in", at: opAt }; }
    else if (word("in")) { const opAt = take().at; op = { text: "in", at: opAt }; }
    else if (word("is")) {
      const opAt = take().at;
      const negate = word("not") ? (take(), true) : false;
      if (!word("empty")) fail("empty", { field: name });
      take();
      if (!QUERY_OPS[field.type].includes("is")) fail("op", { field: name, op: "is", ops: QUERY_OPS[field.type].join(" ") }, opAt);
      if (!negate) pin(name, [""]);
      ast.clauses.push({ field: name, param: call?.text ?? "", arg: call?.arg ?? null, op: negate ? "is not empty" : "is empty", from: at, to: end() });
      return (s, p, now) => { const v = field.get(s, p, now); const empty = v == null || (Array.isArray(v) && !v.length); return negate ? !empty : empty; };
    } else if (op?.kind === "op") take();
    else fail("op", { field: name, op: op?.text ?? "…", ops: QUERY_OPS[field.type].join(" ") });
    if (!QUERY_OPS[field.type].includes(op.text)) fail("op", { field: name, op: op.text, ops: QUERY_OPS[field.type].join(" ") }, op.at);

    if (op.text === "in" || op.text === "not in") {
      ast.hasIn = true;
      if (take()?.kind !== "(") fail("paren");
      const list = [];
      while (peek() && peek().kind !== ")") {
        list.push(fold(valueOf(name, take()).text));
        if (peek()?.kind === ",") take();
      }
      if (take()?.kind !== ")") fail("paren");
      if (op.text === "in") pin(name, list);
      ast.clauses.push({ field: name, param: call?.text ?? "", arg: call?.arg ?? null, op: op.text, values: list, from: at, to: end() });
      const set = new Set(list);
      const has = field.type === "list"
        ? (s, p, now) => field.get(s, p, now).some((g) => set.has(fold(g)))
        : (s, p, now) => set.has(fold(field.get(s, p, now)));
      return op.text === "in" ? has : (s, p, now) => !has(s, p, now);
    }

    const token = valueOf(name, take());
    if (field.type === "number" && token.kind === "word" && peek()?.kind === "(") {   // a date function
      const fn = queryFunc(token.text);
      if (!fn || !field.at) fail("fn", { name: token.text, field: name }, token.at);
      take();
      const shift = peek()?.kind === "word" && /^[+-]?\d+$/.test(peek().text) ? Number(take().text) : 0;
      if (take()?.kind !== ")") fail("paren");
      ast.funcs.push(`${token.text}()`);
      ast.clauses.push({ field: name, param: call?.text ?? "", arg: call?.arg ?? null, op: op.text, kind: "func", raw: `${token.text}()`, from: at, to: end() });
      let cachedNow = NaN, cachedState = null, cachedMoment = null;
      const opText = op.text;
      return (s, p, now) => {
        if (now !== cachedNow || s !== cachedState) { cachedNow = now; cachedState = s; cachedMoment = fn(now, shift, s); }
        return compareMoment(field.at(s, p, now), cachedMoment, opText);
      };
    }
    if (field.type === "bool") {
      const v = fold(token.text);
      if (v !== "true" && v !== "false") fail("bool", { field: name }, token.at);
      const want = (v === "true") === (op.text === "=");
      ast.clauses.push({ field: name, param: call?.text ?? "", arg: call?.arg ?? null, op: op.text, value: want, from: at, to: end() });
      return (s, p, now) => field.get(s, p, now) === want;
    }
    if (field.type === "number") {
      const value = queryNumber(token.text, field.days);
      // a moment field (released, listed…) takes a moment: -14d or a date; a length (incubated) and a count, a plain number
      const wrong = !value || Number.isNaN(value.n ?? value.ago)
        || (field.at ? value.n != null : value.ago != null || value.date);
      if (wrong) fail(field.at ? "ago" : field.days ? "days" : "number", { field: name }, token.at);
      ast.clauses.push({ field: name, param: call?.text ?? "", arg: call?.arg ?? null, op: op.text, number: value, from: at, to: end() });
      const opText = op.text;
      if (value.date) return (s, p, now) => compareMoment(field.at(s, p, now), value.date, opText);   // after / before that day
      // -Nd: compared on the days since it, as a span would be (a release 14.5 days ago is 14 days ago)
      const cmp = QUERY_CMP[value.ago != null ? AGO_FLIP[opText] : opText];
      const n = value.ago ?? value.n;
      return (s, p, now) => { const v = field.get(s, p, now); return v != null && cmp(v, n); };
    }
    // text and list: = exact (case folded), ~ contains or /regex/
    let match;
    if (token.kind === "regex") {
      ast.hasRegex = true;
      const re = regexOf(token);
      match = (v) => re.test(String(v ?? ""));
    } else {
      const want = fold(token.text);
      match = op.text === "~" || op.text === "!~" ? containsWords(token.text) : (v) => fold(v) === want;
      if (op.text === "=") pin(name, [want]);
    }
    ast.clauses.push({ field: name, param: call?.text ?? "", arg: call?.arg ?? null, op: op.text, value: token.text, isRegex: token.kind === "regex", from: at, to: end() });
    const hit = field.type === "list" ? (s, p, now) => field.get(s, p, now).some(match) : (s, p, now) => match(field.get(s, p, now));
    return op.text.startsWith("!") ? (s, p, now) => !hit(s, p, now) : hit;
  };

  const primary = () => {
    const token = peek();
    if (!token) fail("end");
    if (token.kind === "(") {
      ast.hasParens = true;
      take();
      const inner = or();
      if (take()?.kind !== ")") fail("paren");
      return inner;
    }
    const named = token.kind === "word" ? QUERY_FIELDS[fold(token.text)] : null;
    const next = tokens[i + 1];
    if (named && (next?.kind === "op" || ["in", "is", "not"].includes(fold(next?.text)) || named.type === "bool" || (named.param && next?.kind === "("))) {
      take();
      current = token.at;
      const call = named.param ? callArgs(fold(token.text)) : null;
      const field = call ? call.bound : named;
      const test = clause(fold(token.text), field, token.at, call);
      spans.push({ from: token.at, to: end(), kind: "clause" });
      current = null;
      return test;
    }
    if (token.kind === "word" || token.kind === "value" || token.kind === "regex") {   // free text
      // in Query mode a bare word must be a field (a typo isn't a silent text search): "calendar" or text ~ calendar searches
      if (strict && token.kind === "word") fail("unknown", { text: token.text }, token.at);
      if (token.unclosed) fail("value", { field: "text" }, token.at);
      take();
      free.push(token.text);
      const text = (s, p) => QUERY_FIELDS.text.get(s, p);
      if (token.kind === "regex") {
        ast.hasRegex = true;
        const re = regexOf(token);
        return (s, p) => re.test(text(s, p));
      }
      const has = containsWords(token.text);
      return (s, p) => has(text(s, p));
    }
    return fail("unexpected", { text: token.text }, token.at);
  };
  const not = () => {
    if (!word("not")) return primary();
    ast.hasNeg = true;
    const from = take().at;
    negated++;
    const inner = not();
    negated--;
    spans.push({ from, to: end(), kind: "neg" });
    return (s, p, now) => !inner(s, p, now);
  };
  const and = () => {
    let left = not();
    while (peek() && peek().kind !== ")" && !word("or") && !atTail()) {
      if (word("and")) take();
      const right = not();
      const l = left;
      left = (s, p, now) => l(s, p, now) && right(s, p, now);
    }
    return left;
  };
  const or = () => {
    let left = and();
    while (word("or")) {
      ast.hasOr = true;
      take();
      const right = and();
      const l = left;
      left = (s, p, now) => l(s, p, now) || right(s, p, now);
    }
    return left;
  };

  const test = peek() && !atTail() ? or() : () => true;
  let group = null;
  if (word("group")) {
    current = take().at;
    take();   // by
    const name = fold(peek()?.text);
    if (!QUERY_FIELDS[name]?.group) fail("groupBy", { field: peek()?.text ?? "…", fields: Object.keys(QUERY_FIELDS).filter((k) => QUERY_FIELDS[k].group).join(", ") });
    take();
    group = name;
    spans.push({ from: current, to: end(), kind: "order" });
    current = null;
  }
  let order = null;
  if (word("order")) {
    current = take().at;
    if (!word("by")) fail("orderBy");
    take();
    const name = fold(peek()?.text);
    const field = QUERY_FIELDS[name];
    if (!field?.sort) fail("sort", { field: peek()?.text ?? "…" });
    take();
    const key = field.param ? `${name}(${callArgs(name).text})` : name;   // `order by gain()` sorts by gain(30d)
    const dir = word("asc") || word("desc") ? fold(take().text) : NATURAL_DIR[name] || "desc";
    order = { key, dir };
    spans.push({ from: current, to: end(), kind: "order" });
    current = null;
  }
  let limit = null;
  if (word("limit")) {
    current = take().at;
    const [, a, b] = String(peek()?.text ?? "").match(/^(\d+)(?:-(\d+))?$/) || [];
    const [first, last] = b ? [Number(a), Number(b)] : [1, Number(a)];   // `limit 100`: the first 100; `limit 101-200`: 101st to 200th
    if (!a || first < 1 || last < first) fail("limit");
    take();
    limit = { from: first - 1, to: last };
    spans.push({ from: current, to: end(), kind: "order" });
    current = null;
  }
  if (peek()) fail(TAIL_PARTS.some((part) => word(part)) ? "tailOrder" : "unexpected", { text: peek().text });
  // with an OR, a value isn't asked of every row: group by then shows every section a row has
  return { test, order, group, limit, pins: ast.hasOr ? {} : pins, clauses, free, spans, fields, ast };
}

/** Suggestions where the caret is: fields, then the operators of that field's type, then its values, then AND / OR. */
function querySuggestions(text, caret, data) {
  if (/^[^\s(),=!~<>]/.test(text.slice(caret))) return { from: caret, items: [] };   // inside a word: nothing to offer
  const before = text.slice(0, caret);
  const tokens = tokenize(before);
  const typing = /[^\s(),=!~<>]$/.test(before) && tokens.length && ["word", "value"].includes(tokens.at(-1).kind) ? tokens.pop() : null;
  const partial = fold(typing?.text ?? "");
  const from = typing ? typing.at : caret;
  const prev = tokens.at(-1);
  const before2 = tokens.at(-2);
  const isField = (tok) => tok?.kind === "word" && QUERY_FIELDS[fold(tok.text)];
  // the field whose reference ends at token k: `downloads`, or the `)` of `gain(7d)` / `gain()`
  const fieldAt = (k) => {
    if (tokens[k]?.kind !== ")") return isField(tokens[k]) ? tokens[k] : null;
    const open = tokens[k - 1]?.kind === "(" ? k - 1 : k - 2;
    return tokens[open]?.kind === "(" && QUERY_FIELDS[fold(tokens[open - 1]?.text)]?.param ? tokens[open - 1] : null;
  };
  // a field as it's written: gain(30d) for one with a parameter (its default, or an example count)
  const callText = (k) => { const p = QUERY_FIELDS[k].param; return p ? `${k}(${p.fallback ?? "10k"})` : k; };
  const fieldItem = (k) => ({ label: QUERY_FIELDS[k].param ? `${k}()` : k, insert: callText(k), hint: t(`query.field.${k}`) });
  const pick = (items) => {
    const hits = items.filter((x) => fold(x.label).startsWith(partial) || (partial.length > 1 && fold(x.label).includes(partial)));
    return hits.some((x) => fold(x.insert) === partial || fold(x.label) === partial) ? [] : hits.slice(0, 30);   // typed in full: done
  };
  const values = (name) => {
    const field = QUERY_FIELDS[name];
    if (name === "group") return data.groups.map((g) => ({ label: g.name, insert: quoteValue(g.name), hint: t("query.count", { n: g.count }) }));
    if (name === "status") return data.statuses.map((st) => ({ label: st.label, insert: quoteValue(st.key), hint: st.key }));
    if (name === "author") return data.authors.map((a) => ({ label: a, insert: quoteValue(a) }));
    if (name === "category" || name === "primary") return (data.categories || []).map((c) => ({ label: c.name, insert: c.name, hint: t("query.count", { n: c.count }) }));
    if (name === "tag") return (data.tags || []).map((x) => ({ label: x.name, insert: x.name, hint: t("query.count", { n: x.count }) }));
    if (PROFILE_VALUES[name]) return PROFILE_VALUES[name].map((v) => ({ label: v, insert: v, hint: t(`profile.${name}.${v}`) }));
    if (name === "translated") return TRANSLATED_VALUES.map((v) => ({ label: v, insert: v, hint: t(`query.translated.${v}`) }));
    if (name === "rating") return [5, 4, 3, 2, 1].map((n) => ({ label: String(n), insert: String(n), hint: "★".repeat(n) }));
    if (field.type === "bool") return ["true", "false"].map((v) => ({ label: v, insert: v }));
    if (field.days) {
      const spans = (field.at ? ["-7d", "-30d", "-90d", "-1y"] : ["7d", "30d", "90d", "1y"]).map((v) => ({ label: v, insert: v }));   // a moment counts back
      return field.at ? [...spans, ...Object.keys(QUERY_FUNCS).map((f) => ({ label: `${f}()`, insert: `${f}()`, hint: t(`query.fn.${f}`) }))] : spans;
    }
    if (field.type === "number") return ["100", "1k", "10k", "100k"].map((v) => ({ label: v, insert: v }));
    return [];
  };
  // inside `field in (`: values of that field (case-folded NOT IN, deduped by both label and insert key)
  const open = tokens.map((tok, k) => [tok, k]).filter(([tok]) => tok.kind === "(" || tok.kind === ")");
  const lastOpen = open.at(-1);
  if (lastOpen?.[0].kind === "(" && fold(tokens[lastOpen[1] - 1]?.text) === "in" && isField(fold(tokens[lastOpen[1] - 2]?.text) === "not" ? tokens[lastOpen[1] - 3] : tokens[lastOpen[1] - 2])) {
    const fieldTok = fold(tokens[lastOpen[1] - 2]?.text) === "not" ? tokens[lastOpen[1] - 3] : tokens[lastOpen[1] - 2];
    const listed = new Set(tokens.slice(lastOpen[1] + 1).filter((tok) => tok.kind === "word" || tok.kind === "value").map((tok) => fold(tok.text)));
    const unquote = (s) => fold(String(s).replace(/^"|"$/g, ""));
    return { from, items: pick(values(fold(fieldTok.text)).filter((x) => !listed.has(fold(x.label)) && !listed.has(unquote(x.insert)))) };
  }
  if (prev?.kind === "(" && queryFunc(before2?.text)) return { from, items: [] };
  if (prev?.kind === "(" && QUERY_FIELDS[fold(before2?.text)]?.param) return { from, items: [] };   // gain(… : the parameter is yours
  const valueField = prev?.kind === "op" ? fieldAt(tokens.length - 2) : null;
  if (valueField) return { from, items: pick(values(fold(valueField.text))) };
  // check `order by <field>` and `group by <field>` BEFORE `opField` so `order by downloads ` offers desc/asc (not `=`)
  const sorted = fieldAt(tokens.length - 1);
  const sortedAt = sorted ? tokens.lastIndexOf(sorted) : -1;
  if (sorted && fold(tokens[sortedAt - 1]?.text) === "by") {
    const head = fold(tokens[sortedAt - 2]?.text);
    if (head === "order") return { from, items: pick(["desc", "asc"].map((d) => ({ label: d, insert: d }))) };
    if (head === "group") return { from, items: pick(["order by", "limit"].map((w) => ({ label: w, insert: w }))) };
  }
  const opField = typing ? null : fieldAt(tokens.length - 1);
  if (opField && QUERY_FIELDS[fold(opField.text)].type !== "bool") {   // a yes/no field stands alone: `NOT installed`
    const type = QUERY_FIELDS[fold(opField.text)].type;
    const ops = QUERY_OPS[type].map((op) => (op === "is" ? "is empty" : op));
    return { from, items: ops.map((op) => ({ label: op, insert: op === "in" || op === "not in" ? `${op} (` : op, hint: t(`query.op.${op.replace(/ /g, "_")}`) })) };
  }
  if (fold(prev?.text) === "order" || (fold(prev?.text) === "group" && !typing && tokens.length > 1 && !["and", "or", "not", "("].includes(fold(before2?.text ?? "(")))) return { from, items: pick([{ label: "by", insert: "by" }]) };
  if (fold(prev?.text) === "by" && fold(before2?.text) === "group") return { from, items: pick(Object.keys(QUERY_FIELDS).filter((k) => QUERY_FIELDS[k].group).map(fieldItem)) };
  if (fold(prev?.text) === "by") return { from, items: pick(Object.keys(QUERY_FIELDS).filter((k) => QUERY_FIELDS[k].sort).map(fieldItem)) };
  if (fold(prev?.text) === "limit") return { from, items: pick(["50", "100", "1-100", "101-200"].map((v) => ({ label: v, insert: v, hint: t("query.limitHint") }))) };
  // a clause's start: fields (in plain search only once you type two letters), then the keywords
  if (!isAdvancedQuery(text) && partial.length < 2) return { from, items: [] };
  const fields = Object.keys(QUERY_FIELDS).map(fieldItem);
  const words = (prev && prev.kind !== "(" && !["and", "or", "not"].includes(fold(prev.text)) ? ["AND", "OR", "group by", "order by", "limit"] : ["NOT"]).map((w) => ({ label: w, insert: w }));
  return { from, items: pick([...words, ...fields]) };   // AND / OR first: past 30 fields they were cut off
}

/** A value as the query reads it: quoted when it has spaces or would read as a keyword or a field. */
function quoteValue(v) {
  const plain = /^[\p{L}\p{N}_.-]+$/u.test(v) && !["and", "or", "not", "in", "is", "order", "by"].includes(fold(v)) && !QUERY_FIELDS[fold(v)];
  return plain ? v : `"${String(v).replace(/"/g, '\\"')}"`;
}

/** What each token of the box is, for its colour: field, op, value, number, fn, kw (AND OR order by), neg (NOT) or "" (free text). */
function queryHighlight(text) {
  const tokens = tokenize(text);
  let expect = false;   // a value comes next
  let list = false;     // inside `in (…)` or a function's ( )
  return tokens.map((tok, k) => {
    const prev = tokens[k - 1];
    const next = tokens[k + 1];
    const w = fold(tok.text);
    let cls = "";
    if (tok.kind === "op") { cls = "op"; expect = true; }
    else if (tok.kind === "(") list = fold(prev?.text) === "in" || Boolean(queryFunc(prev?.text)) || Boolean(QUERY_FIELDS[fold(prev?.text)]?.param);
    else if (tok.kind === ")") list = false;
    else if (tok.kind === ",") cls = "";
    else if (next?.kind === "(" && QUERY_FIELDS[w]?.param && !expect) cls = "field";
    else if (next?.kind === "(" && queryFunc(w)) { cls = "fn"; expect = false; }
    else if (tok.kind !== "word" || list || expect || fold(prev?.text) === "limit") { cls = "value"; expect = false; }
    else if (w === "in" || w === "is" || w === "empty" || (w === "not" && (fold(next?.text) === "in" || fold(prev?.text) === "is"))) cls = "op";
    else if (w === "and" || w === "or" || w === "order" || w === "limit" || (w === "group" && fold(next?.text) === "by")
      || (w === "by" && ["order", "group"].includes(fold(prev?.text)))) cls = "kw";
    else if (w === "not") cls = "neg";
    else if ((w === "asc" || w === "desc") && (QUERY_FIELDS[fold(prev?.text)] || prev?.kind === ")")) cls = "value";
    else if (QUERY_FIELDS[w]) cls = "field";
    if (cls === "value" && !tok.quoted && /^[+-]?\d/.test(tok.text)) cls = "number";   // 10k, 30d, 2026-01-01
    return { ...tok, cls };
  });
}

/** A count as the query writes it: 1000 → 1k, 1500 → 1.5k, 2000000 → 2m. */
function queryCount(n) {
  if (n >= 1e6 && n % 1e5 === 0) return `${n / 1e6}m`;
  if (n >= 1e3 && n % 100 === 0) return `${n / 1e3}k`;
  return String(n);
}

/**
 * Basic → Query: your narrowing of a page — the plain search's words, Downloads ≥, the added filters, and the
 * sort if you chose one (`order` false leaves it out) — as query text, without the page's own query.
 */
function filtersToQuery(settings, mode, { order = true } = {}) {
  const opts = modeOptions({ ...settings, queries: {} }, mode);
  const query = String(settings.query || "").trim();
  const quoted = (w) => `"${w.replace(/"/g, '\\"')}"`;   // a plain search word, as Query mode reads text
  const parts = isAdvancedQuery(query) || /^\/.+\/$/.test(query) ? [query] : query.split(",").map((w) => w.trim()).filter(Boolean).map(quoted);
  if (opts.filterDownloads && opts.minDownloads > 0) parts.push(`downloads >= ${queryCount(opts.minDownloads)}`);
  const x = opts.extras;
  if (x.released != null) parts.push(`released >= -${x.released}d`);
  if (x.incubated != null) parts.push(`incubated >= ${x.incubated}d`);
  if (x.growth != null) parts.push(`gain(30d) >= ${queryCount(x.growth)}`);
  if (x.listed != null) parts.push(`listed >= -${x.listed}d`);
  if (x.author) parts.push(`author ~ ${quoteValue(x.author)}`);
  if (x.installed) parts.push("installed");
  if (mode === "library") parts.push(...libraryClauses(settings));
  const field = sortField(opts.sort);
  const sorted = order && field && settings.sortBy?.[mode];
  return [parts.join(" AND "), sorted ? `order by ${field} ${opts.sortDir}` : ""].filter(Boolean).join("\n");
}

/** The Library page's Group and Status menus as clauses (Basic → Query): what the query box says for them. */
function libraryClauses({ libraryGroup: group, libraryStatus: status, statusEnabled }) {
  const clauses = [];
  if (group === UNGROUPED) clauses.push("group is empty");
  else if (group === UPDATES) clauses.push("unreviewed");
  else if (group === TOP_RATED) clauses.push(`rating >= ${TOP_RATING}`);
  else if (group) clauses.push(`group = ${quoteValue(group)}`);
  if (statusEnabled && status) clauses.push(`status = ${quoteValue(status)}`);
  return clauses;
}

/**
 * A query split at its tail (TAIL_PARTS, always last): {filter, group, order, limit}, each part's text as written
 * ("group by category", "order by downloads desc", "limit 100"), "" when it has none.
 * Uses tokenize() at top-level depth so quoted strings and /regex/ are never split on `limit`/`order by`/`group by`.
 */
function splitQuery(text) {
  const raw = String(text);
  const parts = { filter: raw.trim(), group: "", order: "", limit: "" };
  const tokens = tokenize(raw);
  const found = [];
  const seen = new Set();
  let depth = 0;
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    if (tok.kind === "(") { depth++; continue; }
    if (tok.kind === ")") { depth = Math.max(0, depth - 1); continue; }
    if (depth > 0 || tok.kind !== "word") continue;
    const prev = tokens[k - 1];
    if (prev?.kind === "op") continue;   // e.g. `name = limit`
    const w = fold(tok.text);
    const nextW = tokens[k + 1]?.kind === "word" ? fold(tokens[k + 1].text) : "";
    if (w === "group" && nextW === "by" && !seen.has("group")) { seen.add("group"); found.push(["group", tok.at]); }
    else if (w === "order" && nextW === "by" && !seen.has("order")) { seen.add("order"); found.push(["order", tok.at]); }
    else if (w === "limit" && tokens[k + 1] && !seen.has("limit")) { seen.add("limit"); found.push(["limit", tok.at]); }
  }
  if (!found.length) return parts;
  parts.filter = raw.slice(0, found[0][1]).trim();
  found.forEach(([part, at], k) => { parts[part] = raw.slice(at, found[k + 1]?.[1] ?? raw.length).trim(); });
  return parts;
}

/** A query's parts (splitQuery) as text again: the filter, then each tail part on its own line. */
const joinParts = (parts) => ["filter", ...TAIL_PARTS].map((part) => parts[part]).filter(Boolean).join("\n");

/** A query split at its tail: {filter, order}, where order is all of the tail (group by, order by, limit). */
function splitOrder(text) {
  const { filter, ...tail } = splitQuery(text);
  return { filter, order: joinParts(tail) };
}

/**
 * The query without one clause (a span from parseQuery): the AND / OR that joined it goes too, plus any empty `()`
 * left behind, so the rest still parses. `a AND b` without b → `a`; without a → `b`.
 */
function dropClause(query, { from, to }) {
  const before = query.slice(0, from);
  const after = query.slice(to);
  const joinerBefore = /\s*\b(AND|OR)\s*$/i;   // "a AND " — the clause came after its joiner
  let out = joinerBefore.test(before)
    ? `${before.replace(joinerBefore, "")}${after}`.trim()
    : `${before}${after.replace(/^\s*(AND|OR)\b\s*/i, "")}`.trim();   // " AND b" — the joiner follows it
  // collapse any empty `()` created when the last clause inside parentheses was dropped
  while (/\(\s*\)/.test(out)) {
    out = out
      .replace(/\s*\b(?:AND|OR)\s*\(\s*\)/gi, "")
      .replace(/\(\s*\)\s*(?:\b(?:AND|OR)\b\s*)?/gi, "")
      .trim();
  }
  return out;
}

/** What `order by` writes for a list sort key (they're the same text: `released`, `gain(7d)`); null if it can't sort. */
const sortField = (key) => (fieldRef(key)?.field.sort ? key : null);

/** The query sorted by a list sort key: its order by replaced (or added). */
function withOrder(text, key, dir) {
  return joinParts({ ...splitQuery(text), order: `order by ${sortField(key)} ${dir}` });   // its group by and limit stay
}

/** The page's query with your narrowing after it; your group by, order by and limit, if any, replace the page's. */
function joinQuery(page, mine) {
  const a = splitQuery(page);
  const b = splitQuery(mine);
  const tail = Object.fromEntries(TAIL_PARTS.map((part) => [part, b[part] || a[part]]));   // each of yours replaces the page's
  return joinParts({ filter: [a.filter, b.filter].filter(Boolean).join(" AND "), ...tail });
}

/**
 * Query → Basic for a page: the box must still start with the page's own query; what follows becomes filters
 * ({patch}), or the reason it can't ({reason}). Compares group/order/limit tails individually so changing only
 * `order by` on Library (keeping `group by group`) stays reversible to Basic.
 */
function queryToBasic(text, settings, mode) {
  const norm = (x) => x.replace(/\s+/g, " ").trim();
  const page = splitQuery(pageQuery(settings, mode));
  const mine = splitQuery(text);
  const head = norm(page.filter);
  const body = norm(mine.filter);
  if (head && !(body === head || body.startsWith(`${head} `))) return { reason: t("query.basicChanged") };
  if (page.group && norm(mine.group) !== norm(page.group)) return { reason: t("query.basicChanged") };
  if (page.limit && norm(mine.limit) !== norm(page.limit)) return { reason: t("query.basicChanged") };
  const tailDiff = [
    !page.group && mine.group ? mine.group : "",
    mine.order && norm(mine.order) !== norm(page.order) ? mine.order : "",
    !page.limit && mine.limit ? mine.limit : "",
  ].filter(Boolean);
  const rest = [body.slice(head.length).trim().replace(/^AND\s+/i, ""), ...tailDiff].filter(Boolean).join("\n");
  const { patch, reason } = rest ? queryToFilters(rest, settings, mode) : { patch: { query: "", extraFilters: { ...settings.extraFilters, [mode]: {} } } };
  if (reason) return { reason };
  const { [mode]: gone, ...queries } = settings.queries || {};
  const { [mode]: sort, ...sortBy } = settings.sortBy || {};
  return { patch: { sortBy, ...patch, queries } };   // no order by of your own: the page's sort again
}

/**
 * Query → Basic: the settings that say the same with filters ({patch}), or why they can't ({reason}). Reads `q.ast`
 * directly from parseQuery so one grammar governs parsing and reverse-mapping. Every clause needs a filter of its own:
 * downloads >=, released >= -Nd, incubated >=, gain(30d) >=, listed >= -Nd, author ~, installed; one valid Basic sort;
 * free words become the plain search. OR, ( ), in (…), NOT, regex and functions don't fit.
 */
function queryToFilters(query, settings, mode) {
  let q;
  try { q = parseQuery(String(query), { strict: true }); } catch (error) { return { reason: error.message }; }
  const bad = new Set();
  if (q.ast.hasOr) bad.add("OR");
  if (q.ast.hasRegex) bad.add("/regex/");
  if (q.ast.hasIn) bad.add("in (…)");
  for (const fn of q.ast.funcs) bad.add(fn);
  if (q.ast.hasParens) bad.add("( )");
  if (q.ast.hasNeg) bad.add("NOT");
  if (q.group) bad.add("group by");
  if (q.limit) bad.add("limit");
  if (q.order && !SORT_KEYS.includes(q.order.key)) bad.add(`order by ${q.order.key}`);
  const extras = {};
  const menus = {};   // the Library page's Group and Status menus (libraryClauses, backwards)
  let downloads = null;
  const own = (key) => !EXTRA_FILTERS[key].skip?.includes(mode);
  const set = (key, value, text) => (key in extras || !own(key) ? bad.add(text) : (extras[key] = value));
  for (const c of q.ast.clauses) {
    const text = String(query).slice(c.from, c.to);
    if (c.kind === "func" || c.op === "in" || c.op === "not in" || c.isRegex) continue;   // already flagged above
    const num = c.number?.n >= 0 ? Math.round(c.number.n) : null;
    const since = (c.op === ">=" || c.op === ">") && c.number?.ago >= 0 ? Math.round(c.number.ago) : null;   // released >= -14d: Basic's ≤ 14
    if (c.field === "installed" && c.op === null) set("installed", true, text);
    else if (c.field === "downloads" && c.op === ">=" && num != null && downloads == null) downloads = num;
    else if (c.field === "released" && since != null) set("released", since, text);
    else if (c.field === "listed" && since != null) set("listed", since, text);
    else if (c.field === "incubated" && c.op === ">=" && num != null) set("incubated", num, text);
    else if (c.field === "gain" && c.arg === 30 && c.op === ">=" && num != null) set("growth", num, text);
    else if (c.field === "author" && c.op === "~") set("author", c.value, text);
    else if (mode === "library" && menus.group == null && libraryMenu(c) != null) menus.group = libraryMenu(c);
    else if (mode === "library" && settings.statusEnabled && menus.status == null && c.field === "status" && c.op === "=") menus.status = c.value;
    else bad.add(text);
  }
  if (bad.size) return { reason: t("query.basicNo", { what: [...bad].join(", ") }) };
  const patch = {
    ...(mode === "library" ? { libraryGroup: menus.group ?? "", libraryStatus: menus.status ?? "" } : {}),
    query: q.free.join(", "),
    extraFilters: { ...settings.extraFilters, [mode]: extras },
    sortBy: q.order ? { ...settings.sortBy, [mode]: q.order } : settings.sortBy,
  };
  // no downloads clause: the tab's default again (a saved "off" would count as a changed filter)
  const { [mode]: dl, ...others } = settings.downloadFilter || {};
  patch.downloadFilter = downloads != null ? { ...others, [mode]: true } : others;
  if (downloads != null) patch.minDownloads = downloads;
  return { patch };
}

/** A Library AST clause that a Group menu choice writes (libraryClauses): the choice; null when it isn't one. */
function libraryMenu(c) {
  if (c.field === "unreviewed" && c.op === null) return UPDATES;
  if (c.field === "rating" && c.op === ">=" && c.number && !c.number.date && c.number.n === TOP_RATING) return TOP_RATED;
  if (c.field === "group" && c.op === "is empty") return UNGROUPED;
  if (c.field === "group" && c.op === "=" && !c.isRegex) return c.value;
  return null;
}

/**
 * The ready-made queries: the gallery ("+ Add widget") and the empty query box both list these. Each one's title,
 * what it finds (`.desc`) and why it helps (`.why`) are `preset.<key>` texts; `cat` is its gallery section.
 */
const QUERY_PRESETS = [
  { key: "month", cat: "discover", query: "released >= startOfMonth()\norder by downloads desc" },
  { key: "fast", cat: "discover", query: "listed >= -60d AND downloads >= 1k AND NOT library\norder by downloads desc" },
  { key: "gems", cat: "discover", query: "downloads <= 10k AND released >= -30d AND rise(30d) >= 20 AND NOT library\norder by rise(30d) desc" },
  { key: "awake", cat: "discover", query: "incubated >= 180d AND hatched >= -30d AND NOT library\norder by hatched desc" },
  { key: "popular", cat: "discover", query: "downloads >= 50k AND released >= -14d AND NOT library\norder by released desc" },
  { key: "milestones", cat: "notify", query: "milestone(10k) >= -30d\norder by downloads desc" },
  { key: "active", cat: "discover", query: "releases(30d) >= 3 AND downloads >= 1k AND NOT library\norder by gain(30d) desc" },
  { key: "stale", cat: "vault", query: "installed AND released <= -1y\norder by released asc" },
  { key: "totry", cat: "library", query: "library AND NOT installed\norder by rating desc" },
  { key: "ungrouped", cat: "library", query: "library AND group is empty\norder by name asc" },
  { key: "unrated", cat: "library", query: "library AND rating is empty\norder by downloads desc" },
  { key: "sleeping", cat: "library", query: "library AND released <= -1y\norder by released asc" },
];
/** The gallery's sections in order, with their icons; "hidden" is your hidden widgets, the rest group the presets. */
const GALLERY_SECTIONS = { hidden: "eye-off", discover: "compass", notify: "bell", vault: "shield-check", library: "bookmark" };

/** A query on one line (a list label, a preview). */
const flatQuery = (q) => String(q).replace(/\s*\n\s*/g, " ");

/** The empty box's list: your filters as a query (when there are any), your recent queries, then the presets. */
function queryStarters(fromFilters, recent = []) {
  const items = QUERY_PRESETS.map((p, k) => ({ label: flatQuery(p.query), insert: p.query, hint: t(`preset.${p.key}`), head: k === 0 ? t("query.examples") : "" }));
  const mine = recent.slice(0, 5).map((q, k) => ({ label: flatQuery(q), insert: q, head: k === 0 ? t("query.recent") : "" }));
  const filters = fromFilters ? [{ label: flatQuery(fromFilters), insert: fromFilters, hint: t("query.fromFiltersHint"), head: t("query.fromFilters") }] : [];
  return [...filters, ...mine, ...items];
}

/** Two queries the same but for spacing and line breaks? */
const sameQuery = (a, b) => String(a).replace(/\s+/g, " ").trim() === String(b).replace(/\s+/g, " ").trim();

/**
 * The clauses that went and came from query `a` to `b` (their top-level clauses, spacing ignored) and the two sorts:
 * {removed, added, order: [a's, b's] or null when the sort is the same}. Null when either doesn't parse.
 */
function queryChanges(a, b) {
  const clauses = (q) => {
    try {
      const { spans } = parseQuery(q, { strict: true });
      const top = spans.filter((x) => x.kind !== "order" && !spans.some((y) => y !== x && y.kind === "neg" && y.from <= x.from && y.to >= x.to));
      return top.map((x) => q.slice(x.from, x.to).replace(/\s+/g, " ").trim());
    } catch (error) { return null; }
  };
  const [ca, cb] = [clauses(a), clauses(b)];
  if (!ca || !cb) return null;
  const [oa, ob] = [splitOrder(a).order, splitOrder(b).order];
  return { removed: ca.filter((c) => !cb.includes(c)), added: cb.filter((c) => !ca.includes(c)), order: sameQuery(oa, ob) ? null : [oa, ob] };
}

/**
 * What changed from query `a` to `b`, short: "14d → 30d" when one clause changed, else "+1 clause · −2 clauses",
 * "sort". Empty when it can't tell (a query that doesn't parse).
 */
function queryDiff(a, b) {
  const changes = queryChanges(a, b);
  if (!changes) return "";
  const { removed, added, order } = changes;
  const parts = [];
  if (removed.length === 1 && added.length === 1) {   // one clause changed: only what differs ("14d → 30d")
    const [wa, wb] = [removed[0].split(" "), added[0].split(" ")];
    let k = 0;
    while (k < wa.length - 1 && k < wb.length - 1 && wa[k] === wb[k]) k++;
    parts.push(`${wa.slice(k).join(" ")} → ${wb.slice(k).join(" ")}`);
  } else {
    if (added.length) parts.push(t("query.diffAdded", { n: added.length }));
    if (removed.length) parts.push(t("query.diffRemoved", { n: removed.length }));
  }
  if (order) parts.push(t("query.diffSort"));
  return parts.join(" · ");
}

/**
 * Finds the owning field of token at `idx` in `allTokens` by walking back over operators and parametric `(arg)` calls
 * (e.g., `downloads >= 1m` → `downloads`, `milestone(10k) >= -30d` → `milestone`).
 */
function ownerFieldFor(allTokens, idx, prev) {
  if (allTokens && idx > 0) {
    let k = idx - 1;
    // step past an operator if the hovered token is the value (`downloads >= 1m`)
    if (allTokens[k]?.cls === "op") k--;
    // step past parametric call `)` ... `(` (`milestone(10k) >= -30d`)
    if (allTokens[k]?.kind === ")") {
      k--;
      while (k > 0 && allTokens[k].kind !== "(") k--;
      if (allTokens[k]?.kind === "(") k--;
    }
    const f = allTokens[k]?.cls === "field" ? QUERY_FIELDS[fold(allTokens[k].text)] : null;
    if (f) return f;
  }
  return QUERY_FIELDS[fold(prev?.text)] || null;
}

/**
 * A word of the box explained, for its tooltip: a field (its type, meaning and an example), an operator, a value's
 * unit, a function (with the day it means now), AND / OR / NOT / order by. Null for plain text and punctuation.
 */
function queryTip(tok, prev, now = Date.now(), state = {}, allTokens = null, idx = -1) {
  const w = fold(tok.text);
  if (tok.cls === "field") {
    const f = QUERY_FIELDS[w];
    const name = f.param ? `${tok.text}(${f.param.fallback ?? "10k"})` : tok.text;
    const example = { bool: `NOT ${name}`, list: `${name} in (…)`, text: `${name} ~ …` }[f.type] || (f.at ? `${name} >= -30d` : f.days ? `${name} >= 60d` : `${name} >= 1k`);
    return { head: f.param ? `${tok.text}()` : tok.text, kind: t(`query.type.${f.days ? "days" : f.type}`), body: t(`query.field.${w}`), example };
  }
  if (tok.cls === "op") {
    const op = w === "not" ? (fold(prev?.text) === "is" ? "is_empty" : "not_in") : w === "is" || w === "empty" ? "is_empty" : w;
    const owner = ownerFieldFor(allTokens, idx, prev);
    const moment = owner?.at && ["<", "<=", ">", ">="].includes(w);   // on a moment field > is later, < earlier
    return { head: tok.text, body: moment ? t(`query.tip.${w.startsWith(">") ? "later" : "earlier"}`) : t(`query.op.${op}`) };
  }
  if (tok.cls === "number" && fold(prev?.text) === "limit") {   // limit 100 · limit 101-200
    const [, a, b] = tok.text.match(/^(\d+)(?:-(\d+))?$/) || [];
    if (!a) return null;
    return { head: `limit ${tok.text}`, body: b ? t("query.tip.limitRange", { from: a, to: b, n: Number(b) - Number(a) + 1 }) : t("query.tip.limitFirst", { n: a }) };
  }
  if (tok.cls === "number") {
    const m = tok.text.toLowerCase().match(/^([+-]?\d+(?:\.\d+)?)([kmdwy]?)$/);
    if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(tok.text) ? { head: tok.text, body: t("query.help.date") } : null;
    const [, n, unit] = m;
    const owner = ownerFieldFor(allTokens, idx, prev);
    // inside parametric call `gain(30d)` vs `milestone(10k)`: check param.kind when prev is `(`
    const insideParam = prev?.kind === "(" && allTokens && idx >= 2 ? QUERY_FIELDS[fold(allTokens[idx - 2]?.text)]?.param : null;
    const days = insideParam ? insideParam.kind === "days" : owner ? Boolean(owner.days) : true;
    const ago = n.startsWith("-");   // -30d: 30 days ago
    const span = unit && t(`query.tip.unit.${unit}`, { n: ago ? n.slice(1) : n });
    const body = unit === "k" || (unit === "m" && !days) ? formatCount(Number(n) * (unit === "k" ? 1e3 : 1e6))
      : span ? (ago ? t("query.tip.ago", { span }) : span) : null;
    return body ? { head: tok.text, body } : null;
  }
  if (tok.cls === "fn") {
    const name = queryFuncName(w);
    const moment = name ? QUERY_FUNCS[name](now, 0, state) : null;
    return { head: `${tok.text}()`, body: t(`query.fn.${name}`), example: moment ? t("query.tip.now", { date: dayString(moment) }) : "" };
  }
  if (tok.cls === "kw" || tok.cls === "neg") {
    const key = w === "by" ? fold(prev?.text) : w;   // `by` says what its `order` / `group` says
    const tail = { order: "order by", group: "group by", limit: "limit" }[key];
    const example = { group: "library group by group", limit: "NOT translated = overview order by downloads desc limit 100" }[key];
    return { head: tail || tok.text.toUpperCase(), body: t(`query.tip.${key}`), ...(example ? { example } : {}) };
  }
  if (tok.cls === "value" && tok.quoted && prev?.cls !== "op" && prev?.kind !== "(" && prev?.kind !== ",") return { head: `"${tok.text}"`, body: t("query.field.text") };
  return null;
}
