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
  // closeness is relative to the best SIMILAR_LIST, so a longer list doesn't change the labels at its top
  const best = top[0]?.score ?? 0;
  const floor = top[Math.min(SIMILAR_LIST, top.length) - 1]?.score ?? 0;
  const match = (score) => (best > floor ? Math.max(0, (score - floor) / (best - floor)) : 1);
  return top.map((x) => ({ p: x.p, score: x.score, cosine: x.cosine, match: match(x.score), shared: sharedTerms(x.shared) }));
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

