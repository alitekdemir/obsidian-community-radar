/**
 * The user's group that fits `targetId` best, and how sure that is: {name, sure}, or null when nothing links it.
 * Sure: the Similar lists link them, both ways (its closest plugins, and the plugins whose closest include it); a
 * match at rank r counts 1/r, so closer ones weigh more. Not sure: no list links them, so the group with the most
 * plugins sharing its home category (profiles' `primary`): a hint to star, not a group to pick for you.
 * @param {Map<string, string[]>} members  group name → plugin ids
 * @param {object} [profiles]  the AI profiles' `plugins` (id → profile)
 */
function closestGroup(targetId, members, similar, profiles) {
  const own = new Map(similarIds(similar, targetId).map((id, i) => [id, i + 1]));
  const linked = (id) => {
    const back = similarIds(similar, id).indexOf(targetId) + 1;   // 0: the target isn't in its list
    return (own.has(id) ? 1 / own.get(id) : 0) + (back ? 1 / back : 0);
  };
  const home = profiles?.[targetId]?.primary;
  const sameHome = (id) => (home && profiles[id]?.primary === home ? 1 : 0);
  return bestGroup(members, linked, true) || bestGroup(members, sameHome, false);
}

/** The group whose plugins weigh most by `weigh(id)`, as {name, sure}; null when every group weighs 0. */
function bestGroup(members, weigh, sure) {
  let best = null;
  let bestScore = 0;
  for (const [name, ids] of members) {
    const score = ids.reduce((sum, id) => sum + weigh(id), 0);
    if (score > bestScore) [best, bestScore] = [name, score];
  }
  return best && { name: best, sure };
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

