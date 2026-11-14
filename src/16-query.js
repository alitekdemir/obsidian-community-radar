// ─── Query language (advanced search) ───────────────────────────────────────
// JQL-like: `downloads > 500 released < 30d group in ("Tasks", Calendar) NOT installed calendar order by gain(30d) desc`.
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
const fresh = (s, p) => s.firstSeen[p.id] === undefined && p.downloads == null;

/** Growth over `days` in percent (see riseShare: 10 → 30 isn't rising). */
const gainShare = (s, p, days) => { const share = riseShare(s.timeline, p, days); return share == null ? null : 100 * share; };
/** The highest milestone a plugin ever passed, before the history too (null: none, or no history). */
const topMilestone = (s, p) => (s.timeline ? [...milestoneSteps(s.timeline)].reverse().find((n) => passedAt(s.timeline, p.id, n) != null) ?? null : null);
/** When it passed that milestone (0: before the history; null: none). */
const milestoneAt = (s, p) => { const n = topMilestone(s, p); return n == null ? null : passedAt(s.timeline, p.id, n); };
/** When it reached n downloads, or (n null: `milestone()`) its latest milestone. */
const reachedOrLatest = (s, p, n) => (n == null ? milestoneAt(s, p) : reachedAt(s.timeline, p.id, n));

/**
 * The fields: type, value (null: empty), and for dates the moment itself (`at`) so `released > 2026-01-01` works.
 * `sort`: `order by` can use it (`rank`, when given, is its sort value instead of `at` or the value). `param`: it takes
 * one, written like a function: `kind` days or count, `fallback` what `()` means (null: the field's own default).
 */
const QUERY_FIELDS = {
  text: { type: "text", get: (s, p) => `${p.id} ${p.name} ${p.author} ${p.description}` },   // what a plain word searches
  name: { type: "text", sort: "name", get: (s, p) => p.name },
  description: { type: "text", get: (s, p) => p.description },
  author: { type: "text", get: (s, p) => p.author },
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
    get: (s, p, now) => (fresh(s, p) ? 0 : historyDays(s, s.firstSeen[p.id], now)), at: (s, p, now) => (fresh(s, p) ? now : s.firstSeen[p.id]) },
  // incubation (see lastHatch): how long the latest pause lasted, and how long ago the plugin came out of it
  incubated: { type: "number", days: true, sort: true, rank: (s, p) => lastHatch(s.releases, p)?.days ?? null, get: (s, p) => lastHatch(s.releases, p)?.days ?? null },
  hatched: { type: "number", days: true, sort: true, get: (s, p, now) => daysAgo(lastHatch(s.releases, p)?.at, now), at: (s, p) => lastHatch(s.releases, p)?.at ?? null },
  rating: { type: "number", sort: true, get: (s, p) => s.notes.get(p.id)?.rating || null },
  // days since it reached n downloads (`milestone(10k)`); `milestone()`: since its latest step (1K, 5K, 10K…)
  milestone: { type: "number", days: true, sort: true, param: { kind: "count", fallback: null },
    get: (s, p, now, n) => historyDays(s, reachedOrLatest(s, p, n), now), at: (s, p, now, n) => reachedOrLatest(s, p, n) },
  group: { type: "list", get: (s, p) => s.notes.get(p.id)?.groups || [] },
  status: { type: "list", get: (s, p) => { const st = s.notes.get(p.id)?.status; return st ? [st] : []; } },
  favorite: { type: "bool", get: (s, p) => Boolean(s.notes.get(p.id)?.favorite) },
  installed: { type: "bool", get: (s, p) => s.installed.has(p.id) },
  tracked: { type: "bool", get: (s, p) => s.notes.has(p.id) },
  unreviewed: { type: "bool", get: (s, p) => { const note = s.notes.get(p.id); return Boolean(note) && isUnreviewed(p, note); } },   // tracked, released since you reviewed it
  dismissed: { type: "bool", get: (s, p) => Boolean(s.dismissed?.has(p.id)) },
  // hidden plugins: lists leave them out unless the query names one of these
  excluded: { type: "bool", get: (s, p) => Boolean(s.excluded?.has(p.id)) },
  snoozed: { type: "bool", get: (s, p) => isSnoozed(p, s.snoozed || {}) },
  // taken off the official list (only the installed ones are rows: see removedRows); lists leave them out unless asked
  removed: { type: "bool", get: (s, p) => Boolean(p.removed) },
};

/** A field name as a clause, not as a value (`name ~ busy` stays): after neither an operator nor a word or quote. */
const asClause = (word) => new RegExp(`(?<![=~<>!]\\s*)(?<![\\w"])${word}(?![\\w(])`, "gi");

/**
 * A query saved before 0.11 in today's fields: busy → releases(180d) > 9, new → listed <= 14d, gain7 / rise30 →
 * gain(7d) / rise(30d), a bare milestone → milestone(). The rest stays as written.
 */
function migrateQuery(text, newDays = DEFAULT_NEW_DAYS) {
  return String(text)
    .replace(/\bNOT\s+busy\b/gi, `releases(${BUSY_DAYS}d) <= ${BUSY_LIMIT}`)
    .replace(asClause("busy"), `releases(${BUSY_DAYS}d) > ${BUSY_LIMIT}`)
    .replace(asClause("new"), `listed <= ${newDays}d`)
    .replace(asClause("(gain|rise)(7|30)"), "$1($2d)")
    .replace(asClause("milestone"), "milestone()");
}

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

/** Date functions for date fields (released, listed, hatched), Jira style: `startOfMonth(-1)` is last month's first day. */
const QUERY_FUNCS = {
  today: (now, n) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d.getTime(); },
  startofweek: (now, n) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 7 * n); return d.getTime(); },   // weeks start on Monday
  startofmonth: (now, n) => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime(); },
  startofyear: (now, n) => new Date(new Date(now).getFullYear() + n, 0, 1).getTime(),
  lastsync: (now, n, s) => s.lastSync ?? null,   // the sync before the latest one
};
const QUERY_FUNC_NAMES = ["today", "startOfWeek", "startOfMonth", "startOfYear", "lastSync"];

const QUERY_CMP = {
  "=": (a, b) => Math.round(a) === Math.round(b), "!=": (a, b) => Math.round(a) !== Math.round(b),
  ">": (a, b) => a > b, ">=": (a, b) => a >= b, "<": (a, b) => a < b, "<=": (a, b) => a <= b,
};

/** Case and Turkish dotted/dotless i folded, so `istanbul` finds `İstanbul` and `image` finds `IMAGE`. */
const fold = (text) => String(text ?? "").toLowerCase().replace(/i̇/g, "i").replace(/ı/g, "i");

/** Is this an advanced query (a field followed by an operator, a keyword, or `order by`)? */
function isAdvancedQuery(query) {
  const fields = Object.keys(QUERY_FIELDS).join("|");
  const calls = Object.keys(QUERY_FIELDS).filter((k) => QUERY_FIELDS[k].param).join("|");
  return new RegExp(`(^|[\\s(])(${fields})\\s*(=|!=|~|!~|>=?|<=?|\\bin\\b|\\bnot\\s+in\\b|\\bis\\b)|(^|[\\s(])(${calls})\\s*\\(|\\border\\s+by\\b|(^|\\s)(AND|OR|NOT)(\\s|$)`, "i").test(query);
}

/** Splits a query into tokens: words, "quoted", /regex/, operators, ( ) and commas, each with its position. */
function tokenize(query) {
  const tokens = [];
  const re = /\s*(?:("(?:[^"\\]|\\.)*"?)|(\/(?:[^/\\]|\\.)+\/[a-z]*)|(!=|!~|>=|<=|[=~<>(),])|([^\s=!~<>(),"]+))/gy;
  let match;
  while (re.lastIndex < query.length && (match = re.exec(query))) {
    const [all, quoted, regex, op, word] = match;
    const at = match.index + all.length - (quoted || regex || op || word || "").length;
    const end = re.lastIndex;
    if (quoted != null) tokens.push({ kind: "value", text: quoted.slice(1, quoted.length > 1 && quoted.endsWith('"') ? -1 : undefined).replace(/\\"/g, '"'), at, end, quoted: true });
    else if (regex) tokens.push({ kind: "regex", text: regex, at, end });
    else if (op) tokens.push({ kind: op === "(" || op === ")" || op === "," ? op : "op", text: op, at, end });
    else if (word) tokens.push({ kind: "word", text: word, at, end });
    if (!all) break;
  }
  return tokens;
}

/** A number value: 500, 10k, 1.5m; with `days`, a span (30d, 2w, 6m, 1y) or a date (2026-01-01 → that day's start on your clock). */
function queryNumber(text, days) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) && dayStart(text);
  if (date) return days ? { date } : null;
  const m = String(text).toLowerCase().match(/^(\d+(?:\.\d+)?)([kmdwy]?)$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  if (days) return { n: n * ({ "": 1, d: 1, w: 7, m: 30.44, y: 365 }[unit] ?? NaN) };
  return { n: n * ({ "": 1, k: 1e3, m: 1e6 }[unit] ?? NaN) };
}

class QueryError extends Error {
  constructor(key, vars, at) {
    super(t(`query.error.${key}`, vars));
    this.at = at;
  }
}

/**
 * Parses an advanced query into {test(state, p, now), order, clauses, free, spans}. `spans` are what the box paints:
 * {from, to, kind: clause|neg|order}. Throws a QueryError with the position of what it couldn't read, plus the
 * spans so far and the broken part (from, to).
 */
function parseQuery(query, { strict = false } = {}) {
  const tokens = tokenize(query);
  let i = 0;
  let clauses = 0;
  const fields = new Set();   // the fields the query names (discover keeps hidden plugins when it names `excluded` or `snoozed`)
  let current = null;   // where the clause being read starts
  const free = [];
  const spans = [];
  const peek = () => tokens[i];
  const word = (w) => peek()?.kind === "word" && fold(peek().text) === w;
  const take = () => tokens[i++];
  const end = () => tokens[i - 1]?.end ?? 0;
  const fail = (key, vars = {}, at = peek()?.at ?? query.length) => {
    const error = new QueryError(key, vars, at);
    const to = tokens.find((tok) => tok.at >= at)?.end ?? query.length;
    Object.assign(error, { spans, from: Math.min(current ?? at, at), to: Math.max(to, at) });
    throw error;
  };

  const valueOf = (field, token) => {
    if (!token || (token.kind !== "word" && token.kind !== "value" && token.kind !== "regex")) fail("value", { field });
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
    const text = token?.text ?? field.param.fallback;
    const arg = text == null ? null : paramValue(field, text);
    if (text != null && arg == null) fail(`param.${field.param.kind}`, { field: `${name}()` }, token?.at);
    const bound = { ...field, get: (s, p, now) => field.get(s, p, now, arg) };
    if (field.at) bound.at = (s, p, now) => field.at(s, p, now, arg);
    return { bound, text: text ?? "" };
  };

  /** One field's clause, its field (bound to its parameter) already taken. */
  const clause = (name, field, at) => {
    clauses++;
    fields.add(name);
    let op = peek();
    if (field.type === "bool" && (!op || op.kind !== "op")) return (s, p, now) => field.get(s, p, now);   // `installed`
    if (word("not") && fold(tokens[i + 1]?.text) === "in") { take(); take(); op = { text: "not in" }; }
    else if (word("in")) { take(); op = { text: "in" }; }
    else if (word("is")) {
      take();
      const negate = word("not") ? (take(), true) : false;
      if (!word("empty")) fail("empty", { field: name });
      take();
      if (!QUERY_OPS[field.type].includes("is")) fail("op", { field: name, op: "is", ops: QUERY_OPS[field.type].join(" ") }, at);
      return (s, p, now) => { const v = field.get(s, p, now); const empty = v == null || (Array.isArray(v) && !v.length); return negate ? !empty : empty; };
    } else if (op?.kind === "op") take();
    else fail("op", { field: name, op: op?.text ?? "…", ops: QUERY_OPS[field.type].join(" ") });
    if (!QUERY_OPS[field.type].includes(op.text)) fail("op", { field: name, op: op.text, ops: QUERY_OPS[field.type].join(" ") }, op.at);

    if (op.text === "in" || op.text === "not in") {
      if (take()?.kind !== "(") fail("paren");
      const list = [];
      while (peek() && peek().kind !== ")") {
        list.push(fold(valueOf(name, take()).text));
        if (peek()?.kind === ",") take();
      }
      if (take()?.kind !== ")") fail("paren");
      const has = field.type === "list"
        ? (s, p, now) => field.get(s, p, now).some((g) => list.includes(fold(g)))
        : (s, p, now) => list.includes(fold(field.get(s, p, now)));
      return op.text === "in" ? has : (s, p, now) => !has(s, p, now);
    }

    const token = valueOf(name, take());
    if (field.type === "number" && token.kind === "word" && peek()?.kind === "(") {   // a date function
      const fn = QUERY_FUNCS[fold(token.text)];
      if (!fn || !field.at) fail("fn", { name: token.text, field: name }, token.at);
      take();
      const shift = peek()?.kind === "word" && /^[+-]?\d+$/.test(peek().text) ? Number(take().text) : 0;
      if (take()?.kind !== ")") fail("paren");
      const cmp = QUERY_CMP[op.text];
      return (s, p, now) => { const at2 = field.at(s, p, now); const moment = fn(now, shift, s); return at2 > 0 && moment != null && cmp(at2, moment); };
    }
    if (field.type === "bool") {
      const v = fold(token.text);
      if (v !== "true" && v !== "false") fail("bool", { field: name }, token.at);
      const want = (v === "true") === (op.text === "=");
      return (s, p, now) => field.get(s, p, now) === want;
    }
    if (field.type === "number") {
      const value = queryNumber(token.text, field.days);
      if (!value || Number.isNaN(value.n)) fail(field.days ? "days" : "number", { field: name }, token.at);
      if (value.date && !field.at) fail("days", { field: name }, token.at);
      // a date compares moments (released > 2026-01-01: after it); a span compares days ago
      const cmp = QUERY_CMP[op.text];
      return value.date
        ? (s, p, now) => { const at2 = field.at(s, p, now); return at2 > 0 && cmp(at2, value.date); }
        : (s, p, now) => { const v = field.get(s, p, now); return v != null && cmp(v, value.n); };
    }
    // text and list: = exact (case folded), ~ contains or /regex/
    let match;
    if (token.kind === "regex") {
      const [, body] = token.text.match(/^\/(.+)\/[a-z]*$/);
      let re;
      try { re = new RegExp(body, "iu"); } catch (error) { fail("regex", { error: error.message }, token.at); }
      match = (v) => re.test(String(v ?? ""));
    } else {
      const want = fold(token.text);
      match = op.text === "~" || op.text === "!~" ? (v) => fold(v).includes(want) : (v) => fold(v) === want;
    }
    const hit = field.type === "list" ? (s, p, now) => field.get(s, p, now).some(match) : (s, p, now) => match(field.get(s, p, now));
    return op.text.startsWith("!") ? (s, p, now) => !hit(s, p, now) : hit;
  };

  const primary = () => {
    const token = peek();
    if (!token) fail("end");
    if (token.kind === "(") {
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
      const field = named.param ? callArgs(fold(token.text)).bound : named;
      const test = clause(fold(token.text), field, token.at);
      spans.push({ from: token.at, to: end(), kind: "clause" });
      current = null;
      return test;
    }
    if (token.kind === "word" || token.kind === "value" || token.kind === "regex") {   // free text
      // in Query mode a bare word must be a field (a typo isn't a silent text search): "calendar" or text ~ calendar searches
      if (strict && token.kind === "word") fail("unknown", { text: token.text }, token.at);
      take();
      free.push(token.text);
      const text = (p) => `${p.id} ${p.name} ${p.author} ${p.description}`;
      if (token.kind === "regex") {
        const [, body] = token.text.match(/^\/(.+)\/[a-z]*$/);
        let re;
        try { re = new RegExp(body, "iu"); } catch (error) { fail("regex", { error: error.message }, token.at); }
        return (s, p) => re.test(text(p));
      }
      const want = fold(token.text);
      return (s, p) => fold(text(p)).includes(want);
    }
    return fail("unexpected", { text: token.text }, token.at);
  };
  const not = () => {
    if (!word("not")) return primary();
    const from = take().at;
    const inner = not();
    spans.push({ from, to: end(), kind: "neg" });
    return (s, p, now) => !inner(s, p, now);
  };
  const and = () => {
    let left = not();
    while (peek() && peek().kind !== ")" && !word("or") && !word("order")) {
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
      take();
      const right = and();
      const l = left;
      left = (s, p, now) => l(s, p, now) || right(s, p, now);
    }
    return left;
  };

  const test = peek() && !word("order") ? or() : () => true;
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
  if (peek()) fail("unexpected", { text: peek().text });
  return { test, order, clauses, free, spans, fields };
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
    if (name === "rating") return [5, 4, 3, 2, 1].map((n) => ({ label: String(n), insert: String(n), hint: "★".repeat(n) }));
    if (field.type === "bool") return ["true", "false"].map((v) => ({ label: v, insert: v }));
    if (field.days) {
      const spans = ["7d", "30d", "90d", "1y"].map((v) => ({ label: v, insert: v }));
      return field.at ? [...spans, ...QUERY_FUNC_NAMES.map((f) => ({ label: `${f}()`, insert: `${f}()`, hint: t(`query.fn.${f}`) }))] : spans;
    }
    if (field.type === "number") return ["100", "1k", "10k", "100k"].map((v) => ({ label: v, insert: v }));
    return [];
  };
  // inside `field in (`: values of that field
  const open = tokens.map((tok, k) => [tok, k]).filter(([tok]) => tok.kind === "(" || tok.kind === ")");
  const lastOpen = open.at(-1);
  if (lastOpen?.[0].kind === "(" && fold(tokens[lastOpen[1] - 1]?.text) === "in" && isField(tokens[lastOpen[1] - 2]?.text === "not" ? tokens[lastOpen[1] - 3] : tokens[lastOpen[1] - 2])) {
    const fieldTok = fold(tokens[lastOpen[1] - 2]?.text) === "not" ? tokens[lastOpen[1] - 3] : tokens[lastOpen[1] - 2];
    const listed = new Set(tokens.slice(lastOpen[1] + 1).filter((tok) => tok.kind === "word" || tok.kind === "value").map((tok) => fold(tok.text)));
    return { from, items: pick(values(fold(fieldTok.text)).filter((x) => !listed.has(fold(x.label)))) };
  }
  if (prev?.kind === "(" && QUERY_FUNCS[fold(before2?.text)]) return { from, items: [] };
  if (prev?.kind === "(" && QUERY_FIELDS[fold(before2?.text)]?.param) return { from, items: [] };   // gain(… : the parameter is yours
  const valueField = prev?.kind === "op" ? fieldAt(tokens.length - 2) : null;
  if (valueField) return { from, items: pick(values(fold(valueField.text))) };
  const opField = typing ? null : fieldAt(tokens.length - 1);
  if (opField && QUERY_FIELDS[fold(opField.text)].type !== "bool") {   // a yes/no field stands alone: `NOT installed`
    const type = QUERY_FIELDS[fold(opField.text)].type;
    const ops = QUERY_OPS[type].map((op) => (op === "is" ? "is empty" : op));
    return { from, items: ops.map((op) => ({ label: op, insert: op === "in" || op === "not in" ? `${op} (` : op, hint: t(`query.op.${op.replace(/ /g, "_")}`) })) };
  }
  if (fold(prev?.text) === "order") return { from, items: pick([{ label: "by", insert: "by" }]) };
  if (fold(prev?.text) === "by") return { from, items: pick(Object.keys(QUERY_FIELDS).filter((k) => QUERY_FIELDS[k].sort).map(fieldItem)) };
  const sorted = fieldAt(tokens.length - 1);
  if (sorted && fold(tokens[tokens.indexOf(sorted) - 1]?.text) === "by") return { from, items: pick(["desc", "asc"].map((d) => ({ label: d, insert: d }))) };
  // a clause's start: fields (in plain search only once you type two letters), then the keywords
  if (!isAdvancedQuery(text) && partial.length < 2) return { from, items: [] };
  const fields = Object.keys(QUERY_FIELDS).map(fieldItem);
  const words = (prev && prev.kind !== "(" && !["and", "or", "not"].includes(fold(prev.text)) ? ["AND", "OR", "order by"] : ["NOT"]).map((w) => ({ label: w, insert: w }));
  return { from, items: pick([...fields, ...words]) };
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
    else if (tok.kind === "(") list = fold(prev?.text) === "in" || Boolean(QUERY_FUNCS[fold(prev?.text)]) || Boolean(QUERY_FIELDS[fold(prev?.text)]?.param);
    else if (tok.kind === ")") list = false;
    else if (tok.kind === ",") cls = "";
    else if (next?.kind === "(" && QUERY_FIELDS[w]?.param && !expect) cls = "field";
    else if (next?.kind === "(" && QUERY_FUNCS[w]) { cls = "fn"; expect = false; }
    else if (tok.kind !== "word" || list || expect) { cls = "value"; expect = false; }
    else if (w === "in" || w === "is" || w === "empty" || (w === "not" && (fold(next?.text) === "in" || fold(prev?.text) === "is"))) cls = "op";
    else if (w === "and" || w === "or" || w === "order" || (w === "by" && fold(prev?.text) === "order")) cls = "kw";
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
  if (x.released != null) parts.push(`released <= ${x.released}d`);
  if (x.incubated != null) parts.push(`incubated >= ${x.incubated}d`);
  if (x.growth != null) parts.push(`gain(30d) >= ${queryCount(x.growth)}`);
  if (x.listed != null) parts.push(`listed <= ${x.listed}d`);
  if (x.author) parts.push(`author ~ ${quoteValue(x.author)}`);
  if (x.installed) parts.push("installed");
  const field = sortField(opts.sort);
  const sorted = order && field && settings.sortBy?.[mode];
  return [parts.join(" AND "), sorted ? `order by ${field} ${opts.sortDir}` : ""].filter(Boolean).join("\n");
}

/** A query split at its `order by` (always last): {filter, order}. */
function splitOrder(text) {
  const at = String(text).search(/(^|\s)order\s+by\b/i);
  return at < 0 ? { filter: String(text).trim(), order: "" } : { filter: text.slice(0, at).trim(), order: text.slice(at).trim() };
}

/** What `order by` writes for a list sort key (they're the same text: `released`, `gain(7d)`); null if it can't sort. */
const sortField = (key) => (fieldRef(key)?.field.sort ? key : null);

/** The query sorted by a list sort key: its order by replaced (or added). */
function withOrder(text, key, dir) {
  return [splitOrder(text).filter, `order by ${sortField(key)} ${dir}`].filter(Boolean).join("\n");
}

/** The page's query with your narrowing after it; your order by, if any, replaces the page's. */
function joinQuery(page, mine) {
  const a = splitOrder(page);
  const b = splitOrder(mine);
  return [[a.filter, b.filter].filter(Boolean).join(" AND "), b.order || a.order].filter(Boolean).join("\n");
}

/**
 * Query → Basic for a page: the box must still start with the page's own query; what follows becomes filters
 * ({patch}), or the reason it can't ({reason}).
 */
function queryToBasic(text, settings, mode) {
  const norm = (x) => x.replace(/\s+/g, " ").trim();
  const page = splitOrder(pageQuery(settings, mode));
  const mine = splitOrder(text);
  const head = norm(page.filter);
  const body = norm(mine.filter);
  if (head && !(body === head || body.startsWith(`${head} `))) return { reason: t("query.basicChanged") };
  const order = mine.order && norm(mine.order) !== norm(page.order) ? mine.order : "";
  const rest = [body.slice(head.length).trim().replace(/^AND\s+/i, ""), order].filter(Boolean).join("\n");
  const { patch, reason } = rest ? queryToFilters(rest, settings, mode) : { patch: { query: "", extraFilters: { ...settings.extraFilters, [mode]: {} } } };
  if (reason) return { reason };
  const { [mode]: gone, ...queries } = settings.queries || {};
  const { [mode]: sort, ...sortBy } = settings.sortBy || {};
  return { patch: { sortBy, ...patch, queries } };   // no order by of your own: the page's sort again
}

/**
 * Query → Basic: the settings that say the same with filters ({patch}), or why they can't ({reason}). Every clause
 * needs a filter of its own: downloads >=, released <=, incubated >=, gain(30d) >=, listed <=, author ~, installed; one
 * order by; free words become the plain search. OR, ( ), in (…), NOT, regex and functions don't fit.
 */
function queryToFilters(query, settings, mode) {
  let q;
  try { q = parseQuery(String(query), { strict: true }); } catch (error) { return { reason: error.message }; }
  const tokens = tokenize(String(query));
  const bad = new Set();
  tokens.forEach((tok, k) => {
    const prev = fold(tokens[k - 1]?.text);
    if (tok.kind === "word" && fold(tok.text) === "or") bad.add("OR");
    if (tok.kind === "regex") bad.add("/regex/");
    if (tok.kind === "(" && !QUERY_FIELDS[prev]?.param) bad.add(prev === "in" ? "in (…)" : QUERY_FUNCS[prev] ? `${tokens[k - 1].text}()` : "( )");
  });
  if (q.spans.some((span) => span.kind === "neg")) bad.add("NOT");
  const extras = {};
  let downloads = null;
  const own = (key) => !EXTRA_FILTERS[key].skip?.includes(mode);
  const set = (key, value, text) => (key in extras || !own(key) ? bad.add(text) : (extras[key] = value));
  for (const span of q.spans.filter((x) => x.kind === "clause")) {
    const text = String(query).slice(span.from, span.to);
    const inSpan = tokens.filter((tok) => tok.at >= span.from && tok.end <= span.to);
    const call = inSpan[1]?.kind === "(" ? inSpan.splice(1, inSpan.findIndex((tok) => tok.kind === ")")) : [];   // gain(30d): its ( 30d )
    const [f, op, v, ...rest] = inSpan;
    const field = fold(f.text) + call.map((tok) => tok.text).join("");   // "gain(30d)"
    const days = v && queryNumber(v.text, true);
    const count = v && queryNumber(v.text, false);
    const lower = op?.text === "<=" || op?.text === "<";
    if (rest.length) bad.add(text);
    else if (field === "installed" && !op) set("installed", true, text);
    else if (field === "downloads" && op?.text === ">=" && count?.n >= 0 && downloads == null) downloads = Math.round(count.n);
    else if (field === "released" && lower && days?.n >= 0) set("released", Math.round(days.n), text);
    else if (field === "listed" && lower && days?.n >= 0) set("listed", Math.round(days.n), text);
    else if (field === "incubated" && op?.text === ">=" && days?.n >= 0) set("incubated", Math.round(days.n), text);
    else if (field === "gain(30d)" && op?.text === ">=" && count?.n >= 0) set("growth", Math.round(count.n), text);
    else if (field === "author" && op?.text === "~" && v.kind !== "regex") set("author", v.text, text);
    else bad.add(text);
  }
  if (bad.size) return { reason: t("query.basicNo", { what: [...bad].join(", ") }) };
  const patch = {
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

/**
 * The ready-made queries: the gallery ("+ Add widget") and the empty query box both list these. Each one's title,
 * what it finds (`.desc`) and why it helps (`.why`) are `preset.<key>` texts; `cat` is its gallery section.
 */
const QUERY_PRESETS = [
  { key: "month", cat: "discover", query: "released >= startOfMonth()\norder by downloads desc" },
  { key: "fast", cat: "discover", query: "listed <= 60d AND downloads >= 1k AND NOT tracked\norder by downloads desc" },
  { key: "gems", cat: "discover", query: "downloads <= 10k AND released <= 30d AND rise(30d) >= 20 AND NOT tracked\norder by rise(30d) desc" },
  { key: "awake", cat: "discover", query: "incubated >= 180d AND hatched <= 30d AND NOT tracked\norder by hatched desc" },
  { key: "popular", cat: "discover", query: "downloads >= 50k AND released <= 14d AND NOT tracked\norder by released desc" },
  { key: "milestones", cat: "notify", query: "milestone(10k) <= 30d\norder by downloads desc" },
  { key: "active", cat: "discover", query: "releases(30d) >= 3 AND downloads >= 1k AND NOT tracked\norder by gain(30d) desc" },
  { key: "stale", cat: "vault", query: "installed AND released >= 1y\norder by released asc" },
  { key: "totry", cat: "track", query: "tracked AND NOT installed\norder by rating desc" },
  { key: "ungrouped", cat: "track", query: "tracked AND group is empty\norder by name asc" },
  { key: "unrated", cat: "track", query: "tracked AND rating is empty\norder by downloads desc" },
  { key: "sleeping", cat: "track", query: "tracked AND released >= 1y\norder by released asc" },
];
/** The gallery's sections in order, with their icons; "hidden" is your hidden widgets, the rest group the presets. */
const GALLERY_SECTIONS = { hidden: "eye-off", discover: "compass", notify: "bell", vault: "shield-check", track: "bookmark" };

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
 * What changed from query `a` to `b`, short: "14d → 30d" when one clause changed, else "+1 clause · −2 clauses",
 * "sort". Empty when it can't tell (a query that doesn't parse).
 */
function queryDiff(a, b) {
  const clauses = (q) => {
    try {
      const { spans } = parseQuery(q, { strict: true });
      const top = spans.filter((x) => x.kind !== "order" && !spans.some((y) => y !== x && y.kind === "neg" && y.from <= x.from && y.to >= x.to));
      return top.map((x) => q.slice(x.from, x.to).replace(/\s+/g, " ").trim());
    } catch (error) { return null; }
  };
  const [ca, cb] = [clauses(a), clauses(b)];
  if (!ca || !cb) return "";
  const removed = ca.filter((c) => !cb.includes(c));
  const added = cb.filter((c) => !ca.includes(c));
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
  if (!sameQuery(splitOrder(a).order, splitOrder(b).order)) parts.push(t("query.diffSort"));
  return parts.join(" · ");
}

/**
 * A word of the box explained, for its tooltip: a field (its type, meaning and an example), an operator, a value's
 * unit, a function (with the day it means now), AND / OR / NOT / order by. Null for plain text and punctuation.
 */
function queryTip(tok, prev, now = Date.now(), state = {}) {
  const w = fold(tok.text);
  if (tok.cls === "field") {
    const f = QUERY_FIELDS[w];
    const name = f.param ? `${tok.text}(${f.param.fallback ?? "10k"})` : tok.text;
    const example = { bool: `NOT ${name}`, list: `${name} in (…)`, text: `${name} ~ …` }[f.type] || (f.days ? `${name} <= 30d` : `${name} >= 1k`);
    return { head: f.param ? `${tok.text}()` : tok.text, kind: t(`query.type.${f.days ? "days" : f.type}`), body: t(`query.field.${w}`), example };
  }
  if (tok.cls === "op") {
    const op = w === "not" ? "not_in" : w === "is" || w === "empty" ? "is_empty" : w;
    const days = QUERY_FIELDS[fold(prev?.text)]?.days && ["<", "<=", ">", ">="].includes(w);
    return { head: tok.text, body: days ? t(`query.tip.days${w.startsWith("<") ? "Within" : "Over"}`) : t(`query.op.${op}`) };
  }
  if (tok.cls === "number") {
    const m = tok.text.toLowerCase().match(/^([+-]?\d+(?:\.\d+)?)([kmdwy]?)$/);
    if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(tok.text) ? { head: tok.text, body: t("query.help.date") } : null;
    const [, n, unit] = m;
    const days = QUERY_FIELDS[fold(prev?.text)]?.days || QUERY_FIELDS[fold(prev?.text)] == null;
    const body = unit === "k" || (unit === "m" && !days) ? formatCount(Number(n) * (unit === "k" ? 1e3 : 1e6))
      : unit ? t(`query.tip.unit.${unit}`, { n }) : null;
    return body ? { head: tok.text, body } : null;
  }
  if (tok.cls === "fn") {
    const fn = QUERY_FUNCS[w];
    const moment = fn?.(now, 0, state);
    return { head: `${tok.text}()`, body: t(`query.fn.${QUERY_FUNC_NAMES.find((x) => fold(x) === w)}`), example: moment ? t("query.tip.now", { date: dayString(moment) }) : "" };
  }
  if (tok.cls === "kw" || tok.cls === "neg") {
    const key = w === "by" ? "order" : w;
    return { head: key === "order" ? "order by" : tok.text.toUpperCase(), body: t(`query.tip.${key}`) };
  }
  if (tok.cls === "value" && tok.quoted && prev?.cls !== "op" && prev?.kind !== "(" && prev?.kind !== ",") return { head: `"${tok.text}"`, body: t("query.field.text") };
  return null;
}
