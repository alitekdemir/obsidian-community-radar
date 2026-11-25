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
  const counts = new Map();
  for (const profile of Object.values(index?.plugins || {})) {
    for (const c of profileCategories(profile)) counts.set(c, (counts.get(c) || 0) + 1);
  }
  return {
    categories: (index?.categories || []).map((name) => ({ name, count: counts.get(name) || 0 })),
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
const overviewCurrent = (saved, summary, lang) => {
  if (!saved || saved.lang !== lang || typeof saved.src !== "string") return false;
  const first = String(summary || "").replace(/\r?\n/g, " ");
  return saved.src.split("\n", 1)[0] === first || saved.src.startsWith(`${String(summary || "")}\n`) || saved.src === String(summary || "");
};

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
  han: /\p{Script=Han}/u,
  kana: /[\p{Script=Hiragana}\p{Script=Katakana}]/u,
  hangul: /\p{Script=Hangul}/u,
  cyrillic: /\p{Script=Cyrillic}/u,
  arabic: /\p{Script=Arabic}/u,
  greek: /\p{Script=Greek}/u,
  hebrew: /\p{Script=Hebrew}/u,
  thai: /\p{Script=Thai}/u,
  devanagari: /\p{Script=Devanagari}/u,
};
const SCRIPT_ENTRIES = Object.entries(SCRIPTS);
const LATIN_LETTER = /\p{Script=Latin}/u;
const NON_LATIN = /[^\P{L}\p{Script=Latin}]/u;   // a letter of any other script
const MATH_GREEK = /[αβγδεθλμπσωΔΣΩ]/;           // technical/math symbols allowed in Latin technical translations
const FOREIGN_SHARE = 0.15;      // more of the letters than this in another script: the wrong language
const UNTRANSLATED_SHARE = 0.5;  // at least this share of the texts sent back as they were: not translated
const LONG_TEXT = 20;            // shorter texts (a name, "API key") may rightly stay as they are

/** Scripts allowed for a target language script group. */
const ALLOWED_SCRIPTS = {
  japanese: ["han", "kana"],
  chinese: ["han"],
  korean: ["hangul", "han"],
  cjk: ["han", "kana", "hangul"],
};

/** Latin-spelled target language names → script group (so typing "Japanese" or "Russian" in Settings works). */
const LANG_NAME_SCRIPTS = [
  [/\b(ja|jp|jpn|japanese|japanisch|japonca|japonais|japon[eé]s|nihongo)\b/i, "japanese"],
  [/\b(zh|cn|zho|chi|chinese|mandarin|cantonese|chinesisch|[cç]ince|chinois|chino)\b/i, "chinese"],
  [/\b(ko|kr|kor|korean|koreanisch|korece|cor[eé]en|coreano|hangul)\b/i, "korean"],
  [/\b(ru|uk|bg|sr|mk|be|kk|ky|mn|russian|ukrainian|bulgarian|serbian|belarusian|kazakh|macedonian|cyrillic|russisch|rus[cç]a|ukraynaca)\b/i, "cyrillic"],
  [/\b(ar|fa|ur|ps|arabic|persian|farsi|urdu|arabisch|arap[cç]a|fars[cç]a)\b/i, "arabic"],
  [/\b(el|gr|greek|griechisch|yunanca)\b/i, "greek"],
  [/\b(he|iw|hebrew|hebr[aä]isch|ibranice)\b/i, "hebrew"],
  [/\b(th|thai|tayca)\b/i, "thai"],
  [/\b(hi|mr|ne|sa|hindi|marathi|nepali|sanskrit|devanagari|hint[cç]e)\b/i, "devanagari"],
];

/** The script of a letter (a key of SCRIPTS), or null for Latin and non-letters. */
function scriptOf(ch) {
  if (LATIN_LETTER.test(ch)) return null;
  for (const [key, re] of SCRIPT_ENTRIES) if (re.test(ch)) return key;
  return null;
}

/** Whether letter `ch` belongs to target language script group `langScript`. */
function matchesScript(ch, langScript) {
  if (!langScript) return false;
  const group = ALLOWED_SCRIPTS[langScript];
  if (group) return group.some((k) => SCRIPTS[k].test(ch));
  return Boolean(SCRIPTS[langScript]?.test(ch));
}

/** The script your target language is written in: native script chars first ("日本語" → japanese), else Latin name ("Japanese" → japanese). */
function scriptOfLanguage(lang) {
  const text = String(lang || "");
  let hasHan = false;
  for (const ch of text) {
    if (!NON_LATIN.test(ch)) continue;
    const s = scriptOf(ch);
    if (s === "kana") return "japanese";
    if (s === "hangul") return "korean";
    if (s === "han") { hasHan = true; continue; }
    if (s) return s;
  }
  if (hasHan) return /\b(ja|jp|japanese)\b/i.test(text) ? "japanese" : "chinese";
  for (const [re, group] of LANG_NAME_SCRIPTS) if (re.test(text)) return group;
  return null;
}

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
  const allowed = target ? (ALLOWED_SCRIPTS[target] || [target]) : [];
  const source = sources.join("\n");
  let letters = 0;
  let foreign = 0;
  let added = 0;   // foreign letters the source doesn't have: made up
  for (const ch of out) {
    if (!/\p{L}/u.test(ch)) continue;
    letters++;
    const script = scriptOf(ch);
    if (!script || allowed.includes(script)) continue;
    if (script === "greek" && MATH_GREEK.test(ch)) continue;
    foreign++;
    if (!source.includes(ch)) added++;
  }
  return (letters && foreign / letters > FOREIGN_SHARE) || added >= 2 ? "script" : null;
}

/** A kept translation's sources and texts, side by side (see translationProblem). */
function translationPairs(kind, entry) {
  if (kind === "description") return { sources: [entry.src], texts: [entry.text] };
  const texts = profileTexts({ capabilities: [], needs: [], ...entry.parts });
  return { sources: String(entry.src ?? "").split("\n").slice(0, texts.length), texts };
}
