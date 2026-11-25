// ─── 3b. Migrations (one-time upgrades) ───────────────────────────────────────
const BY_PAGE_SETTINGS = ["sortBy", "downloadFilter", "extraFilters", "quickFilters", "queries", "pageQueries", "tableColumns"];

/**
 * 0.16: what was named after "tracked" takes the Library's names: the page (`mode`, its Group and Status menus and
 * every per-page setting), the 🔖 table column, the "New in your library" card (`libraryReleases`) and bulk Undo
 * entries. Runs in onload before the defaults merge and normalizeHome, which would drop the old names; with none
 * left it changes nothing, so running it again is safe. Changes `data` in place.
 */
function migrateLibraryNames(data) {
  const st = data.settings;
  if (st) {
    const rename = (obj, from, to) => { if (obj && from in obj) { obj[to] = obj[from]; delete obj[from]; } };
    if (st.mode === "tracked") st.mode = "library";
    rename(st, "trackedGroup", "libraryGroup");
    rename(st, "trackedStatus", "libraryStatus");
    for (const key of BY_PAGE_SETTINGS) rename(st[key], "tracked", "library");
    for (const [page, cols] of Object.entries(st.tableColumns || {})) {
      if (Array.isArray(cols)) st.tableColumns[page] = cols.map((c) => (c === "tracked" ? "library" : c));
    }
    const home = st.home;
    if (home) {
      const card = (id) => (id === "tracked" ? "libraryReleases" : id);
      if (Array.isArray(home.groups)) home.groups = home.groups.map((g) => ({ ...g, items: (g.items || []).map(card) }));
      for (const key of ["order", "hidden"]) if (Array.isArray(home[key])) home[key] = home[key].map(card);   // before 0.11
      if (Array.isArray(home.since?.order)) home.since.order = home.since.order.map(card);
      rename(home.params, "tracked", "libraryReleases");
      rename(home.seen, "tracked", "libraryReleases");
    }
  }
  if (Array.isArray(data.ops)) data.ops = data.ops.map((op) => (op?.kind === "track" ? { ...op, kind: "library" } : op));
}

/**
 * One-time changes to notes, settings and keys when upgrading, oldest first.
 * Persists `data.json` only when at least one migration step actually ran.
 */
async function runMigrations(plugin) {
  const done = plugin.data.migrations;
  const st = plugin.data.settings;
  const tell = (key, n, timeout) => { if (n) new Notice(t(key, { n }), timeout); };
  const steps = [
    ["h1Headings", async () => tell("notice.headings", await plugin.notes.migrate(migrateHeadings))],
    ["groupsList", async () => tell("notice.groupsMigrated", await plugin.notes.migrateGroups(), 10000)],
    ["statusKeys", async () => tell("notice.statusMigrated", await plugin.notes.migrate(migrateStatuses), 10000)],
    // 0.9.2: "new" lasts 14 days by default; 30 was 0.9's default, not a choice
    ["newDays14", () => { if (st.newDays === 30) st.newDays = DEFAULT_NEW_DAYS; }],
    ["pageQueries", () => migratePageQueries(st)],
    // 0.10: a saved view is a query (its tab's query, then its filters); before fields011, which rewrites that query
    ["viewQueries", () => {
      if (st.home?.views) st.home.views = st.home.views.map((v) => (v.query != null ? v : { id: v.id, name: v.name, query: legacyViewQuery(v, st) }));
    }],
    ["fields011", () => migrateFields011(st)],
    ["readmeImages", () => plugin.notes.migrate(migrateImages)],
    // 0.11.3: before the order above was fixed, a pre-0.10 view could end up with the query "undefined"
    ["viewQueriesRepair", () => {
      if (st.home?.views) st.home.views = st.home.views.map((v) => (v.query === "undefined" && v.mode ? { id: v.id, name: v.name, query: legacyViewQuery(v, st) } : v));
    }],
    // 0.14: Similar comes as lists built on GitHub; the semantic vectors (~2.5 MB) aren't needed any more
    ["dropVectors", () => Promise.all([plugin.cache.remove("vectors"), plugin.cache.remove("vectors", "bin")])],
    // 0.16: move translations from data.json into translations.jsonl BEFORE running translationCheck
    ["translationStore", async () => {
      let moved = false;
      for (const [key, kind] of [["translations", "description"], ["profileTranslations", "overview"]]) {
        if (plugin.data[key]) moved = true;
        for (const [id, entry] of Object.entries(plugin.data[key] || {})) plugin.translations[kind][id] ??= entry;
        delete plugin.data[key];
      }
      await plugin.translations.rewrite();
      if (moved && done.translationCheck) tell("notice.translationsDropped", await plugin.translations.dropUntranslated(), 10000);
    }],
    // 0.16: translations sent back as they were or in another language go
    ["translationCheck", async () => tell("notice.translationsDropped", await plugin.translations.dropUntranslated(), 10000)],
    // 0.16: the Library page's Sections switch is its query's `group by group`
    ["libraryGroupBy", () => {
      const sections = st.trackedSections !== false;   // the switch as 0.15 saved it: that name is what's in the file
      delete st.trackedSections;
      const add = (q) => (sections && typeof q === "string" && !splitQuery(q).group ? joinQuery(q, "group by group") : q);
      if (st.pageQueries?.library != null) st.pageQueries.library = add(st.pageQueries.library);   // keys renamed in onload (migrateLibraryNames)
      if (st.queries?.library != null) st.queries.library = add(st.queries.library);
      if (!sections && st.pageQueries?.library == null) st.pageQueries = { ...st.pageQueries, library: "library\norder by rating desc" };
    }],
    // 0.16: the query field `tracked` is `library`, like the Library page (after libraryGroupBy, which writes queries)
    ["libraryField", () => migrateLibraryField(st)],
  ];
  let ran = false;
  for (const [key, run] of steps) {
    if (done[key]) continue;
    await run();
    done[key] = dayString(Date.now());
    ran = true;
  }
  if (ran) await plugin.saveData(plugin.data);
}
