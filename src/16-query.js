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

/**
 * The fields: type, value (null: empty), and for dates the moment itself so `released > 2026-01-01` works.
 * `sort` is the list's sort key `order by` uses.
 */
const QUERY_FIELDS = {
  name: { type: "text", sort: "name", get: (s, p) => p.name },
  description: { type: "text", get: (s, p) => p.description },
  author: { type: "text", get: (s, p) => p.author },
  id: { type: "text", get: (s, p) => p.id },
  downloads: { type: "number", sort: "downloads", get: (s, p) => p.downloads ?? 0 },
  gain7: { type: "number", sort: "growth7", get: (s, p) => s.growth?.[p.id]?.[0] ?? null },
  gain30: { type: "number", sort: "growth30", get: (s, p) => s.growth?.[p.id]?.[1] ?? null },
  released: { type: "number", days: true, sort: "updated", get: (s, p, now) => daysAgo(p.updated, now), at: (s, p) => p.updated },
  age: { type: "number", days: true, sort: "listed", get: (s, p, now) => daysAgo(s.firstSeen[p.id], now), at: (s, p) => s.firstSeen[p.id] },
  gap: { type: "number", days: true, sort: "dormant", get: (s, p) => dormantDays(s.releases, p) },
  rating: { type: "number", sort: "rating", get: (s, p) => s.notes.get(p.id)?.rating || null },
  group: { type: "list", get: (s, p) => s.notes.get(p.id)?.groups || [] },
  status: { type: "list", get: (s, p) => { const st = s.notes.get(p.id)?.status; return st ? [st] : []; } },
  favorite: { type: "bool", get: (s, p) => Boolean(s.notes.get(p.id)?.favorite) },
  installed: { type: "bool", get: (s, p) => s.installed.has(p.id) },
  tracked: { type: "bool", get: (s, p) => s.notes.has(p.id) },
  new: { type: "bool", get: (s, p, now) => isNewPlugin(s.firstSeen, p, now, NEW_BADGE_DAYS) },
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
function parseQuery(query) {
  const tokens = tokenize(query);
  let i = 0;
  let clauses = 0;
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
      const cmp = { "=": (a, b) => Math.round(a) === Math.round(b), "!=": (a, b) => Math.round(a) !== Math.round(b), ">": (a, b) => a > b, ">=": (a, b) => a >= b, "<": (a, b) => a < b, "<=": (a, b) => a <= b }[op.text];
      return value.date
        ? (s, p) => { const at2 = field.at(s, p); return at2 > 0 && cmp(at2, value.date); }
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
  return { test, order, clauses, free, spans };
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
  const quote = (v) => (/^[\p{L}\p{N}_.-]+$/u.test(v) ? v : `"${v.replace(/"/g, '\\"')}"`);
  const values = (name) => {
    const field = QUERY_FIELDS[name];
    if (name === "group") return data.groups.map((g) => ({ label: g.name, insert: quote(g.name), hint: t("query.count", { n: g.count }) }));
    if (name === "status") return data.statuses.map((st) => ({ label: st.label, insert: quote(st.key), hint: st.key }));
    if (name === "author") return data.authors.map((a) => ({ label: a, insert: quote(a) }));
    if (name === "rating") return [5, 4, 3, 2, 1].map((n) => ({ label: String(n), insert: String(n), hint: "★".repeat(n) }));
    if (field.type === "bool") return ["true", "false"].map((v) => ({ label: v, insert: v }));
    if (field.days) return ["7d", "30d", "90d", "1y", dayString(Date.now() - 365 * DAY_MS)].map((v) => ({ label: v, insert: v }));
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
