// ─── Query language (advanced search) ───────────────────────────────────────
// JQL-like: `downloads > 500 released < 30d group in ("Tasks", Calendar) NOT installed calendar order by gain30 desc`.
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
const fresh = (s, p) => s.firstSeen[p.id] === undefined && p.downloads == null;

/**
 * The fields: type, value (null: empty), and for dates the moment itself so `released > 2026-01-01` works.
 * `sort` is the list's sort key `order by` uses.
 */
const gainShare = (s, p, k) => {   // growth over 7/30 days in percent, on a base of RISING_BASE (10 → 30 isn't rising)
  const gain = s.growth?.[p.id]?.[k];
  const base = (p.downloads ?? 0) - (gain ?? 0);
  return gain == null || base < RISING_BASE ? null : (100 * gain) / base;
};
const topMilestone = (s, p) => (s.timeline ? topPassed(s.timeline, p.id, 0) : null);

const QUERY_FIELDS = {
  text: { type: "text", get: (s, p) => `${p.id} ${p.name} ${p.author} ${p.description}` },   // what a plain word searches
  name: { type: "text", sort: "name", get: (s, p) => p.name },
  description: { type: "text", get: (s, p) => p.description },
  author: { type: "text", get: (s, p) => p.author },
  id: { type: "text", get: (s, p) => p.id },
  downloads: { type: "number", sort: "downloads", get: (s, p) => p.downloads ?? 0 },
  gain7: { type: "number", sort: "growth7", get: (s, p) => s.growth?.[p.id]?.[0] ?? null },
  gain30: { type: "number", sort: "growth30", get: (s, p) => s.growth?.[p.id]?.[1] ?? null },
  released: { type: "number", days: true, sort: "updated", get: (s, p, now) => daysAgo(p.updated, now), at: (s, p) => p.updated },
  // a plugin the history hasn't seen yet (no downloads count either) came in just now
  age: { type: "number", days: true, sort: "listed", get: (s, p, now) => (fresh(s, p) ? 0 : daysAgo(s.firstSeen[p.id], now)), at: (s, p, now) => (fresh(s, p) ? now : s.firstSeen[p.id]) },
  gap: { type: "number", days: true, sort: "dormant", get: (s, p) => dormantDays(s.releases, p) },
  rating: { type: "number", sort: "rating", get: (s, p) => s.notes.get(p.id)?.rating || null },
  rise7: { type: "number", sort: "rise7", get: (s, p) => gainShare(s, p, 0) },
  rise30: { type: "number", sort: "rise30", get: (s, p) => gainShare(s, p, 1) },
  milestone: { type: "number", get: topMilestone },   // the highest download milestone passed (1k, 10k, 100k…)
  passed: { type: "number", days: true, get: (s, p, now) => daysAgo(s.timeline && passedAt(s.timeline, p.id, topMilestone(s, p)), now),
    at: (s, p) => s.timeline && passedAt(s.timeline, p.id, topMilestone(s, p)) },
  group: { type: "list", get: (s, p) => s.notes.get(p.id)?.groups || [] },
  status: { type: "list", get: (s, p) => { const st = s.notes.get(p.id)?.status; return st ? [st] : []; } },
  favorite: { type: "bool", get: (s, p) => Boolean(s.notes.get(p.id)?.favorite) },
  installed: { type: "bool", get: (s, p) => s.installed.has(p.id) },
  tracked: { type: "bool", get: (s, p) => s.notes.has(p.id) },
  new: { type: "bool", get: (s, p, now) => isNewPlugin(s.firstSeen, p, now, NEW_BADGE_DAYS) },
  // more than BUSY_LIMIT update waves in BUSY_DAYS: they'd crowd out the rest of Updated
  busy: { type: "bool", get: (s, p, now) => updateWaves(s.releases[p.id] || [], now - BUSY_DAYS * DAY_MS, now) > BUSY_LIMIT },
  // out of incubation: released after a pause, and still within that pause's length (at most INCUBATION_CAP)
  hatched: { type: "bool", get: (s, p, now) => { const gap = dormantDays(s.releases, p) ?? -1; return gap > 0 && now - p.updated <= Math.min(gap, INCUBATION_CAP) * DAY_MS; } },
  dismissed: { type: "bool", get: (s, p) => Boolean(s.dismissed?.has(p.id)) },
  changed: { type: "bool", get: (s, p) => { const note = s.notes.get(p.id); return Boolean(note) && isChanged(p, note); } },   // tracked, released since you reviewed it
  ignored: { type: "bool", get: (s, p) => Boolean(s.excluded?.has(p.id) || isSnoozed(p, s.snoozed || {})) },
};

/** Date functions for date fields (released, age), Jira style: `startOfMonth(-1)` is last month's first day. */
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
  return new RegExp(`(^|[\\s(])(${fields})\\s*(=|!=|~|!~|>=?|<=?|\\bin\\b|\\bnot\\s+in\\b|\\bis\\b)|\\border\\s+by\\b|(^|\\s)(AND|OR|NOT)(\\s|$)`, "i").test(query);
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

/** A number value: 500, 10k, 1.5m; with `days`, a span (30d, 2w, 6m, 1y) or a date (2026-01-01 → its moment). */
function queryNumber(text, days) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) && Date.parse(`${text}T00:00:00Z`);
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
  const fields = new Set();   // the fields the query names (discover keeps hidden plugins when it names `ignored`)
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

  /** One field's clause, its field already taken. */
  const clause = (name, at) => {
    const field = QUERY_FIELDS[name];
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
    if (token.kind === "word" && QUERY_FIELDS[fold(token.text)] && (tokens[i + 1]?.kind === "op" || ["in", "is", "not"].includes(fold(tokens[i + 1]?.text))
      || QUERY_FIELDS[fold(token.text)].type === "bool")) {
      take();
      current = token.at;
      const test = clause(fold(token.text), token.at);
      spans.push({ from: token.at, to: end(), kind: "clause" });
      current = null;
      return test;
    }
    if (token.kind === "word" || token.kind === "value" || token.kind === "regex") {   // free text
      // in Query mode a bare word must be a field (a typo isn't a silent text search): "busy" or text ~ busy searches
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
    const dir = word("asc") || word("desc") ? fold(take().text) : NATURAL_DIR[field.sort] || "desc";
    order = { key: field.sort, dir };
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
  if (prev?.kind === "op" && isField(before2)) return { from, items: pick(values(fold(before2.text))) };
  if (isField(prev) && !typing && QUERY_FIELDS[fold(prev.text)].type !== "bool") {   // a yes/no field stands alone: `NOT installed`
    const type = QUERY_FIELDS[fold(prev.text)].type;
    const ops = QUERY_OPS[type].map((op) => (op === "is" ? "is empty" : op));
    return { from, items: ops.map((op) => ({ label: op, insert: op === "in" || op === "not in" ? `${op} (` : op, hint: t(`query.op.${op.replace(/ /g, "_")}`) })) };
  }
  if (fold(prev?.text) === "order") return { from, items: pick([{ label: "by", insert: "by" }]) };
  if (fold(prev?.text) === "by") return { from, items: pick(Object.entries(QUERY_FIELDS).filter(([, f]) => f.sort).map(([k]) => ({ label: k, insert: k, hint: t(`query.field.${k}`) }))) };
  if (isField(prev) && fold(before2?.text) === "by") return { from, items: pick(["desc", "asc"].map((d) => ({ label: d, insert: d }))) };
  // a clause's start: fields (in plain search only once you type two letters), then the keywords
  if (!isAdvancedQuery(text) && partial.length < 2) return { from, items: [] };
  const fields = Object.keys(QUERY_FIELDS).map((k) => ({ label: k, insert: k, hint: t(`query.field.${k}`) }));
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
    else if (tok.kind === "(") list = fold(prev?.text) === "in" || Boolean(QUERY_FUNCS[fold(prev?.text)]);
    else if (tok.kind === ")") list = false;
    else if (tok.kind === ",") cls = "";
    else if (next?.kind === "(" && QUERY_FUNCS[w]) { cls = "fn"; expect = false; }
    else if (tok.kind !== "word" || list || expect) { cls = "value"; expect = false; }
    else if (w === "in" || w === "is" || w === "empty" || (w === "not" && (fold(next?.text) === "in" || fold(prev?.text) === "is"))) cls = "op";
    else if (w === "and" || w === "or" || w === "order" || (w === "by" && fold(prev?.text) === "order")) cls = "kw";
    else if (w === "not") cls = "neg";
    else if ((w === "asc" || w === "desc") && QUERY_FIELDS[fold(prev?.text)]) cls = "value";
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
  if (x.gap != null) parts.push(`gap >= ${x.gap}d`);
  if (x.growth != null) parts.push(`gain30 >= ${queryCount(x.growth)}`);
  if (x.age != null) parts.push(`age <= ${x.age}d`);
  if (x.author) parts.push(`author ~ ${quoteValue(x.author)}`);
  if (x.installed) parts.push("installed");
  const field = Object.keys(QUERY_FIELDS).find((k) => QUERY_FIELDS[k].sort === opts.sort);
  const sorted = order && field && settings.sortBy?.[mode];
  return [parts.join(" AND "), sorted ? `order by ${field} ${opts.sortDir}` : ""].filter(Boolean).join("\n");
}

/** A query split at its `order by` (always last): {filter, order}. */
function splitOrder(text) {
  const at = String(text).search(/(^|\s)order\s+by\b/i);
  return at < 0 ? { filter: String(text).trim(), order: "" } : { filter: text.slice(0, at).trim(), order: text.slice(at).trim() };
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
 * needs a filter of its own: downloads >=, released <=, gap >=, gain30 >=, age <=, author ~, installed; one
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
    if (tok.kind === "(") bad.add(prev === "in" ? "in (…)" : QUERY_FUNCS[prev] ? `${tokens[k - 1].text}()` : "( )");
  });
  if (q.spans.some((span) => span.kind === "neg")) bad.add("NOT");
  const extras = {};
  let downloads = null;
  const own = (key) => !EXTRA_FILTERS[key].skip?.includes(mode);
  const set = (key, value, text) => (key in extras || !own(key) ? bad.add(text) : (extras[key] = value));
  for (const span of q.spans.filter((x) => x.kind === "clause")) {
    const text = String(query).slice(span.from, span.to);
    const [f, op, v, ...rest] = tokens.filter((tok) => tok.at >= span.from && tok.end <= span.to);
    const field = fold(f.text);
    const days = v && queryNumber(v.text, true);
    const count = v && queryNumber(v.text, false);
    const lower = op?.text === "<=" || op?.text === "<";
    if (rest.length) bad.add(text);
    else if (field === "installed" && !op) set("installed", true, text);
    else if (field === "downloads" && op?.text === ">=" && count?.n >= 0 && downloads == null) downloads = Math.round(count.n);
    else if (field === "released" && lower && days?.n >= 0) set("released", Math.round(days.n), text);
    else if (field === "age" && lower && days?.n >= 0) set("age", Math.round(days.n), text);
    else if (field === "gap" && op?.text === ">=" && days?.n >= 0) set("gap", Math.round(days.n), text);
    else if (field === "gain30" && op?.text === ">=" && count?.n >= 0) set("growth", Math.round(count.n), text);
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

/** Ready-made queries the empty box offers, each with what it finds. */
const QUERY_EXAMPLES = [
  ["released >= startOfMonth() order by downloads desc", "month"],
  ["age < 30d AND gain30 >= 1k", "rising"],
  ["tracked AND NOT installed", "trackedOnly"],
  ["tracked AND group is empty", "ungrouped"],
  ["gap >= 1y AND released < 30d", "awakened"],
];

/** The empty box's list: your filters as a query (when there are any), your recent queries, then the examples. */
function queryStarters(fromFilters, recent = []) {
  const flat = (q) => q.replace(/\s*\n\s*/g, " ");
  const items = QUERY_EXAMPLES.map(([q, key], k) => ({ label: flat(q), insert: q, hint: t(`query.example.${key}`), head: k === 0 ? t("query.examples") : "" }));
  const mine = recent.slice(0, 5).map((q, k) => ({ label: flat(q), insert: q, head: k === 0 ? t("query.recent") : "" }));
  const filters = fromFilters ? [{ label: flat(fromFilters), insert: fromFilters, hint: t("query.fromFiltersHint"), head: t("query.fromFilters") }] : [];
  return [...filters, ...mine, ...items];
}
