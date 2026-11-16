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
