// ─── AI plugin profiles (pure) ───────────────────────────────────────────────
// Each plugin's README read by an AI on GitHub (.github/workflows/profiles.yml, hourly): what it does, its category
// and tags, what it needs. index.json is the one source for categories, tags and the query fields; a plugin's own
// file (profiles/<id>.json) only adds the long texts the details window shows.

/** A plugin's entry in the profiles index, or null (not profiled yet, or the profiles aren't loaded). */
const profileOf = (s, p) => s?.profiles?.[p.id] ?? null;

/** Does the plugin need this (apiKey, paidService, account…)? Only a required one counts: an optional one isn't a need. */
const profileNeeds = (profile, kind) => Boolean(profile?.requires?.some((r) => r.kind === kind && !r.optional));

/** A profile's categories, its home (primary) first. */
const profileCategories = (profile) => (profile ? [profile.primary, ...(profile.also || [])].filter(Boolean) : []);

/**
 * The values the query box offers, with how many plugins have each: categories (home or not, the list's order) and
 * tags (the index's counts, most used first).
 */
function profileFacets(index) {
  const counts = {};
  for (const profile of Object.values(index?.plugins || {})) for (const c of profileCategories(profile)) counts[c] = (counts[c] || 0) + 1;
  return {
    categories: (index?.categories || []).map((name) => ({ name, count: counts[name] || 0 })),
    tags: Object.entries(index?.tags || {}).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

/**
 * What the details window's Overview shows, from the index entry and the plugin's own file (null until it's in):
 * {summary, problem, capabilities[], disambiguation, extras, needs[]} — `needs` are the requires' names, in order.
 */
function profileParts(profile, file) {
  if (!profile) return null;
  return {
    summary: profile.summary || null,
    problem: file?.problem || null,
    capabilities: file?.capabilities || [],
    disambiguation: file?.disambiguation || null,
    extras: file?.extras || null,
    needs: (profile.requires || []).map((r) => r.name),
  };
}

const PROFILE_TEXT_KEYS = ["summary", "problem", "disambiguation", "extras"];

/**
 * Is a saved Overview translation current: in `lang` and made from this summary? The summary (the first text sent)
 * is the one part every plugin has here without downloading its profile; the rest is checked when it's sent again.
 */
const overviewCurrent = (saved, summary, lang) => Boolean(saved) && saved.lang === lang && saved.src.split("\n", 1)[0] === (summary || "");

/** The Overview's texts as one list, for a translation request (an empty one stays ""): see profileFromTexts. */
const profileTexts = (parts) => [...PROFILE_TEXT_KEYS.map((key) => parts[key] || ""), ...parts.capabilities, ...parts.needs];

/** profileTexts' list (translated) back into the Overview's parts, laid out like `parts`. */
function profileFromTexts(parts, texts) {
  const n = PROFILE_TEXT_KEYS.length;
  const caps = parts.capabilities.length;
  return {
    ...Object.fromEntries(PROFILE_TEXT_KEYS.map((key, i) => [key, texts[i] || null])),
    capabilities: texts.slice(n, n + caps),
    needs: texts.slice(n + caps),
  };
}

// ─── Translation check ────────────────────────────────────────────────────────
// A cheap model sometimes sends a text back as it was, or in another language (Chinese for a Chinese plugin): such a
// reply isn't kept, so the text stays in the original and the next run asks again (with another model, if you pick one).

/** Writing systems a translation is checked against; Latin is always allowed (names, code, Obsidian's own words). */
const SCRIPTS = {
  cjk: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u,
  cyrillic: /\p{Script=Cyrillic}/u, arabic: /\p{Script=Arabic}/u, greek: /\p{Script=Greek}/u,
  hebrew: /\p{Script=Hebrew}/u, thai: /\p{Script=Thai}/u, devanagari: /\p{Script=Devanagari}/u,
};
const NON_LATIN = /[^\P{L}\p{Script=Latin}]/u;   // a letter of any other script
const FOREIGN_SHARE = 0.15;      // more of the letters than this in another script: the wrong language
const UNTRANSLATED_SHARE = 0.5;  // at least this share of the texts sent back as they were: not translated
const LONG_TEXT = 20;            // shorter texts (a name, "API key") may rightly stay as they are

/** The script of a letter (a key of SCRIPTS), or null for Latin and non-letters. */
const scriptOf = (ch) => Object.keys(SCRIPTS).find((key) => SCRIPTS[key].test(ch)) ?? null;

/** The script your target language is written in, read from its name ("Türkçe": null = Latin, "日本語": cjk). */
const scriptOfLanguage = (lang) => scriptOf([...String(lang)].find((ch) => NON_LATIN.test(ch)) ?? "");

/**
 * Is this translation usable? `sources[i]` was translated into `texts[i]` (in `lang`).
 * @returns {null|"untranslated"|"script"} null: keep it; untranslated: (mostly) sent back as it was; script: in another
 *   language (too many letters of another script, or some that the source doesn't have)
 */
function translationProblem(sources, texts, lang) {
  const same = (a, b) => String(a ?? "").replace(/\s+/g, " ").trim().toLowerCase() === String(b ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const pairs = sources.map((src, i) => [src, texts[i]]).filter(([src]) => src && String(src).trim());
  const long = pairs.filter(([src]) => String(src).trim().length > LONG_TEXT);
  const judged = long.length ? long : pairs;   // only short texts (a short description): judge them all
  if (judged.length && judged.filter(([src, text]) => same(src, text)).length / judged.length >= UNTRANSLATED_SHARE) return "untranslated";
  const out = texts.filter(Boolean).join("\n");
  if (!NON_LATIN.test(out)) return null;   // Latin letters only: the usual case, nothing to count
  const target = scriptOfLanguage(lang);
  const source = sources.join("\n");
  let letters = 0;
  let foreign = 0;
  let added = 0;   // foreign letters the source doesn't have: made up
  for (const ch of out) {
    if (!/\p{L}/u.test(ch)) continue;
    letters++;
    const script = scriptOf(ch);
    if (!script || script === target) continue;
    foreign++;
    if (!source.includes(ch)) added++;
  }
  return foreign / letters > FOREIGN_SHARE || added >= 2 ? "script" : null;
}

/** A kept translation's sources and texts, side by side (see translationProblem). */
function translationPairs(kind, entry) {
  if (kind === "description") return { sources: [entry.src], texts: [entry.text] };
  return { sources: String(entry.src ?? "").split("\n"), texts: profileTexts({ capabilities: [], needs: [], ...entry.parts }) };
}
