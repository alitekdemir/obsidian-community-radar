// ─── Similar: lists built on GitHub (pure) ───────────────────────────────────
// Every plugin's closest plugins are worked out hourly by scripts/similar/build.py (similar.json on the profiles
// branch): a description vector, the name, the AI overview, category and tags, weighted 2-1-3-1-1. The plugin only
// looks the lists up, so Similar costs nothing on the device and shows what was measured.

/**
 * similar.json → {built, ids, lists, row}: `lists[i]` holds the positions in `ids` of the plugins closest to `ids[i]`,
 * best first; `row` finds a plugin's i. Null when the file doesn't have that shape.
 */
function parseSimilar(file) {
  if (!Array.isArray(file?.ids) || !Array.isArray(file.lists) || file.ids.length !== file.lists.length) return null;
  return { built: file.built, ids: file.ids, lists: file.lists, row: new Map(file.ids.map((id, i) => [id, i])) };
}

/** The ids of the plugins most like `id`, best first; [] when it has no list yet (listed within the last hours). */
function similarIds(similar, id) {
  const row = similar?.row.get(id);
  return row == null ? [] : similar.lists[row].map((i) => similar.ids[i]);
}

/** "Very close" / "close" / "related": where a match sits in its list (rank 1 is the best). */
function closeness(rank) {
  return rank <= VERY_CLOSE_RANK ? "similar.veryClose" : rank <= CLOSE_RANK ? "similar.close" : "similar.related";
}

/** The closeness bar's length (0–1): the list's first fills it, its last is a sliver. */
const closenessShare = (rank) => Math.max(0, 1 - (rank - 1) / SIMILAR_TOP);

/** Why two plugins match: the categories, then the tags their profiles share (at most four, no repeats). */
function sharedFacets(a, b) {
  if (!a || !b) return [];
  const theirs = new Set([...profileCategories(b), ...(b.tags || [])]);
  return [...new Set([...profileCategories(a), ...(a.tags || [])])].filter((x) => theirs.has(x)).slice(0, 4);
}
