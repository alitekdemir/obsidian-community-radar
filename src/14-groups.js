/**
 * The user's group that fits `target` best, judged by the words of the plugins already in it (and the
 * group's own name); null when nothing is close enough.
 * @param {Map<string, string[]>} members  group name → plugin ids
 */
function closestGroup(target, members, index) {
  const mine = index.byId.get(target.id) || meaningfulWords(`${target.name} ${target.description}`);
  let best = null;
  let bestScore = MIN_SIMILARITY;
  for (const [group, ids] of members) {
    const profile = meaningfulWords(group);
    for (const id of ids) if (id !== target.id) for (const w of index.byId.get(id) || []) profile.add(w);
    const score = overlap(index, mine, profile) / Math.sqrt(Math.max(1, ids.length));
    if (score >= bestScore) { best = group; bestScore = score; }
  }
  return best;
}

/** One request that suggests groups for many plugins, preferring the user's own groups. */
function groupPrompt(plugins, groups, language) {
  return [
    "You organise Obsidian community plugins into the user's groups.",
    `For each plugin below, suggest up to ${AI_GROUPS} group names, best first, based on what the plugin does.`,
    "Rules:",
    "- When one of the user's existing groups fits, include it, spelled exactly as given.",
    `- New group names: 1–3 words, Title Case. Give names in ${language}, and when a widely used English or technical term exists`
      + " (e.g. AI, Kanban, Habit Tracker, Git, PDF), suggest that term too — the user may prefer it. Reuse the same new name for similar plugins in this list.",
    "- Reply with ONLY a JSON object that maps each plugin id to an array of group names. No commentary.",
    "",
    "Existing groups (with example plugins):",
    JSON.stringify(groups),
    "",
    "Plugins:",
    JSON.stringify(plugins.map((p) => ({ id: p.id, name: p.name, description: p.description }))),
  ].join("\n");
}

/**
 * The suggestions from the model's reply: for each requested id, up to AI_GROUPS clean names
 * (existing groups keep their spelling). Unknown ids and malformed entries are dropped.
 */
function parseGroupSuggestions(reply, ids, existing) {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error(t("error.noJsonObject"));
  const data = JSON.parse(reply.slice(start, end + 1));
  const spelling = new Map(existing.map((g) => [g.toLocaleLowerCase(), g]));
  return Object.fromEntries(ids.map((id) => {
    const raw = Array.isArray(data?.[id]) ? data[id].filter((g) => typeof g === "string") : [];
    const clean = uniqueNames(raw)
      .filter((g) => g.length <= 40 && g.split(" ").length <= 4)
      .map((g) => spelling.get(g.toLocaleLowerCase()) || g);
    return [id, clean.slice(0, AI_GROUPS)];
  }));
}

/** Runs `worker` with limited concurrency; results keep the input order. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

