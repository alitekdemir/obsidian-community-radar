// Unit tests for the pure core (no network). Run: npm test
const Module = require("module");
const fake = require("./fake-obsidian");
const load = Module._load;
Module._load = function (req, ...rest) { return req === "obsidian" ? fake : load.call(this, req, ...rest); };
const { core } = require("../main.js");
core.setLanguage("tr");  // most expectations below are written for the Turkish UI
const assert = require("assert/strict");
const { DAY_MS } = core.constants;

const NOW = Date.parse("2026-10-31T12:00:00Z");
const ago = (d) => NOW - d * DAY_MS;
const P = (id, extra = {}) => ({ id, name: id.toUpperCase(), author: "a", repo: `a/${id}`, description: `${id} desc`,
  downloads: 1000, updated: ago(1), version: "1.0.0", ...extra });

const tests = {
  "parseCatalog: picks the highest version and strips the review note"() {
    const [p] = core.parseCatalog(
      [{ id: "x", name: "X", author: "A", repo: "a/x", description: "Cool. - This plugin has not been manually reviewed by Obsidian staff." }],
      { x: { downloads: 5, updated: 10, "1.9.0": 1, "1.10.0": 1, "v0.9": 1, publish: 3 } });
    assert.equal(p.version, "1.10.0");
    assert.equal(p.description, "Cool.");
  },

  "isNewPlugin: listed within the window; 0 (before the history) is old; no stats yet is new"() {
    const firstSeen = { old: 0, fresh: ago(3) };
    assert.ok(core.isNewPlugin(firstSeen, P("fresh"), NOW));
    assert.ok(!core.isNewPlugin(firstSeen, P("old"), NOW));
    assert.ok(core.isNewPlugin(firstSeen, P("listed", { downloads: null }), NOW));   // no stats yet
    assert.ok(!core.isNewPlugin(firstSeen, P("fresh"), NOW, 2));                     // outside the window
  },



  "discover 0.9: Updated leaves out new and busy plugins; incubation keeps a plugin as long as its pause"() {
    const busy = Array.from({ length: 25 }, (_, i) => ago(170 - i * 7));
    const catalog = [P("young", { updated: ago(2) }), P("busy", { updated: ago(2) }), P("calm", { updated: ago(2) }),
      P("hatched", { updated: ago(50) }), P("expired", { updated: ago(80) })];
    const state = {
      catalog, notes: new Map(), excluded: new Set(), dismissed: new Set(), installed: new Set(),
      releases: { busy: [...busy, ago(2)], calm: [ago(40), ago(2)], hatched: [ago(138), ago(50)], expired: [ago(150), ago(80)] },
      firstSeen: { young: ago(20), busy: 0, calm: 0, hatched: 0, expired: 0 },
    };
    const ids = (o) => core.discover(state, { mode: "updated", days: 14, dormantDays: 60, newDays: 30, hideBusy: true, minDownloads: 0, query: "", sort: "name", ...o }, NOW).map((p) => p.id);
    assert.deepEqual(ids({}), ["calm"]);                          // young is 20 days old, busy updated 25 times
    assert.deepEqual(ids({ newDays: 10, hideBusy: false }), ["busy", "calm", "young"]);
    assert.equal(core.updateWaves(state.releases.busy, ago(180), NOW), 25);   // 26 releases, the last two the same day
    // 21 hotfixes in two sittings are two updates, not a busy plugin
    const sittings = [...Array.from({ length: 11 }, (_, i) => ago(120) + i * 6 * 3600e3), ...Array.from({ length: 10 }, (_, i) => ago(10) + i * 6 * 3600e3)];
    assert.equal(core.updateWaves(sittings, ago(180), NOW), 2);
    assert.deepEqual(core.releaseWaves([0, 6 * DAY_MS, 7 * DAY_MS]).map((w) => w.length), [2, 1], "within a week: one update; a week later: the next");
    assert.deepEqual(ids({ mode: "awakened" }), ["hatched"]);
    // filters added with + Filter work on any tab
    assert.deepEqual(ids({ mode: "all", extras: { gap: 80 } }), ["hatched"], "incubation ≥ 80 on All");
    assert.deepEqual(ids({ mode: "all", extras: { released: 10 } }), ["busy", "calm", "young"]);
    state.installed = new Set(["calm"]);
    assert.deepEqual(ids({ mode: "all", extras: { installed: true, released: 10 } }), ["calm"]);
    state.installed = new Set();
    assert.ok(!core.addableFilters({ extraFilters: { all: { gap: 60 } } }, "all").includes("gap"), "added once");
    assert.ok(!core.addableFilters({}, "awakened").includes("gap"), "Incubation has its own");     // 88-day pause, released 50 days ago; expired: 70-day pause, 80 days ago
  },

  "filterSummary: the changed filters as they are now, merged Downloads"() {
    const base = core.clearedFilters({ downloadFilter: {} }, "updated");
    const settings = { ...base, days: 7, minDownloads: 500, downloadFilter: { updated: true }, query: "kanban" };
    assert.equal(core.changedFilters(settings, "updated"), 3);
    assert.equal(core.filterSummary(settings, "updated"),
      "Bu sekmenin varsayılanından değişenler:\n• Arama: “kanban”\n• Son 7 gün\n• İndirme ≥ 500\n✕ hepsini varsayılana döndürür");
    assert.equal(core.filterSummary(base, "updated"), core.t("filter.tipNone"));
  },

  "dormantDays: a plugin with releases in between is not 90 days dormant (7/30/40 days example)"() {
    const plugin = P("x");
    assert.equal(core.dormantDays({ x: [ago(400), ago(40), ago(30), ago(7), ago(1)] }, plugin), 6);
    assert.equal(core.dormantDays({ x: [ago(400), ago(1)] }, plugin), 399);
    assert.equal(core.dormantDays({ x: [ago(1)] }, plugin), null);   // no history
  },

  "discover: excluded and tracked plugins stay out of discovery; modes are correct"() {
    const catalog = [P("a"), P("b", { updated: ago(100) }), P("c"), P("d", { downloads: 5 }), P("e")];
    const state = {
      catalog,
      releases: { a: [ago(300), ago(1)], c: [ago(20), ago(1)], e: [ago(200), ago(1)] },
      firstSeen: { a: 0, b: 0, c: 0, d: ago(5), e: 0 },
      notes: new Map([["e", { group: "ai", favorite: false, reviewed: core.dayString(ago(10)) }]]),
      excluded: new Set(["c"]), dismissed: new Set(), installed: new Set(["a", "e"]),
    };
    const opts = { mode: "updated", days: 14, dormantDays: 90, minDownloads: 100, filterDownloads: true, sort: "downloads", query: "" };
    const ids = (o) => core.discover(state, { ...opts, ...o }, NOW).map((p) => p.id);
    assert.deepEqual(ids({}), ["a"]);                       // b old, c excluded, d few downloads, e tracked
    assert.deepEqual(ids({ mode: "awakened" }), ["a"]);     // a was quiet for 299 days
    assert.deepEqual(ids({ mode: "awakened", dormantDays: 365 }), []);
    assert.deepEqual(ids({ mode: "tracked", trackedGroup: core.UPDATES }), ["e"]);   // reviewed 10 days ago, released 1 day ago
    assert.deepEqual(ids({ mode: "tracked", trackedGroup: core.STARRED }), []);
    assert.deepEqual(ids({ mode: "suggested" }), ["a", "e"]);   // installed and not starred
    state.dismissed.add("a");
    assert.deepEqual(ids({ mode: "suggested" }), ["e"]);
    state.dismissed.delete("a");
    assert.deepEqual(ids({ mode: "new", filterDownloads: false }), ["d"]);   // listed in the last 14 days
    assert.deepEqual(ids({ mode: "new" }), []);                                // …but below 100 downloads
    assert.deepEqual(ids({ mode: "new", filterDownloads: false, days: 3 }), []);
    const counts = core.modeCounts(state, opts, NOW);   // each tab with its default Downloads on/off (New: off)
    assert.deepEqual(counts, { all: 4, new: 1, updated: 1, awakened: 1, tracked: 1, suggested: 2 });  // all: every plugin but the excluded c (no Downloads ≥ by default)
    const off = core.modeCounts(state, { ...opts, downloadFilter: { all: false } }, NOW);
    assert.equal(off.all, 4);                                 // All with the filter off: d is back
    assert.deepEqual(ids({ query: "a, desc" }), ["a"]);
  },

  "discover all: every plugin incl. tracked, excluded hidden, four sorts in both directions"() {
    const catalog = [
      P("zeta", { name: "Zeta", downloads: 10, updated: ago(300) }),
      P("alpha", { name: "alpha", downloads: 900, updated: ago(5) }),
      P("mid", { name: "Mid", downloads: 500, updated: ago(1) }),
      P("gone", { name: "Gone", downloads: 9999 }),
    ];
    const state = { catalog, releases: {}, firstSeen: {}, notes: new Map([["mid", { group: "x" }]]),
      excluded: new Set(["gone"]), dismissed: new Set(), installed: new Set() };
    const ids = (o) => core.discover(state, { mode: "all", days: 7, dormantDays: 90, minDownloads: 0, query: "", sort: "downloads", ...o }, NOW).map((p) => p.id);
    assert.deepEqual(ids({}), ["alpha", "mid", "zeta"]);                        // tracked "mid" stays, "gone" excluded
    assert.deepEqual(ids({ sort: "updated" }), ["mid", "alpha", "zeta"]);
    assert.deepEqual(ids({ sort: "name" }), ["alpha", "mid", "zeta"]);            // case-insensitive
    assert.deepEqual(ids({ sort: "listed" }), ["mid", "alpha", "zeta"]);          // newest in the listing first
    assert.deepEqual(ids({ minDownloads: 100, filterDownloads: true }), ["alpha", "mid"]);
    assert.deepEqual(ids({ minDownloads: 100 }), ["alpha", "mid", "zeta"]);      // filter off: threshold ignored
    assert.deepEqual(ids({ sortDir: "asc" }), ["zeta", "mid", "alpha"]);          // fewest downloads first
    assert.deepEqual(ids({ sort: "name", sortDir: "desc" }), ["zeta", "mid", "alpha"]);   // Z → A
    assert.deepEqual(ids({ sort: "updated", sortDir: "asc" }), ["zeta", "alpha", "mid"]); // oldest first
    assert.deepEqual(ids({ query: "/^(al|mi)/" }), ["alpha", "mid"]);
    const releases = { zeta: [ago(900), ago(300)], alpha: [ago(40), ago(5)], mid: [ago(2), ago(1)] };
    assert.deepEqual(core.sortRows([...catalog.slice(0, 3)], "dormant", "desc", catalog, releases).map((p) => p.id), ["zeta", "alpha", "mid"]);
    assert.deepEqual(core.groupSections([catalog[0], catalog[1], catalog[2]], new Map([["zeta", { groups: ["B", "A"] }], ["alpha", { groups: ["A"] }], ["mid", { groups: [] }]]))
      .map((s) => [s.name, s.rows.map((p) => p.id)]), [["A", ["zeta", "alpha"]], ["B", ["zeta"]], [core.UNGROUPED, ["mid"]]]);
    assert.equal(core.groupHue("Task"), core.groupHue("Task"));
  },

  "query language: fields, operators by type, in (…), is empty, AND/OR/NOT, free text, order by, errors with a position"() {
    const DAY = 86400000;
    const now = Date.parse("2026-11-09T12:00:00Z");
    const P = (id, o) => ({ id, name: id, author: "Ali", description: "", downloads: 0, updated: now, ...o });
    const plugins = [
      P("cal", { name: "Calendar", author: "Liam", downloads: 2_000_000, updated: now - 3 * DAY, description: "A calendar view" }),
      P("tasks", { name: "Tasks", author: "İlker Çalışkan", downloads: 600, updated: now - 40 * DAY }),
      P("old", { name: "Old Thing", author: "abbys", downloads: 50, updated: now - 400 * DAY }),
    ];
    const state = {
      notes: new Map([["cal", { groups: ["Görev", "Takvim"], rating: 4, favorite: true, status: "using" }], ["tasks", { groups: ["Görev"], rating: 0 }]]),
      installed: new Set(["cal"]), firstSeen: { cal: now - 900 * DAY, tasks: now - 5 * DAY, old: 0 }, releases: {}, growth: { cal: [10, 2000, 0] },
    };
    const ids = (q) => { const c = core.compileQuery(q, state, now); if (c.error) throw new Error(c.error); return plugins.filter((p) => c.test(p)).map((p) => p.id); };
    assert.deepEqual(ids("downloads > 500"), ["cal", "tasks"]);
    assert.deepEqual(ids("downloads >= 1.5m"), ["cal"]);
    assert.deepEqual(ids("released < 30d"), ["cal"]);
    assert.deepEqual(ids("released > 2026-01-01"), ["cal", "tasks"], "a date compares moments");
    assert.deepEqual(ids('group in ("Görev", Takvim)'), ["cal", "tasks"]);
    assert.deepEqual(ids("group not in (takvim)"), ["tasks", "old"]);
    assert.deepEqual(ids("group = görev AND NOT installed"), ["tasks"]);
    assert.deepEqual(ids("group is empty"), ["old"]);
    assert.deepEqual(ids("rating >= 4 OR author ~ abb"), ["cal", "old"]);
    assert.deepEqual(ids('author in ("ilker çalışkan", abbys)'), ["tasks", "old"], "Turkish İ folds");
    assert.deepEqual(ids("tracked = true calendar"), ["cal"], "words that aren't a clause search the text");
    assert.deepEqual(ids("downloads > 0 AND tracked"), ["cal", "tasks"], "a yes/no field alone, once the query is advanced");
    assert.deepEqual(ids("(group = takvim OR downloads < 100) favorite = false"), ["old"]);
    assert.deepEqual(ids("name ~ /^t/"), ["tasks"]);
    assert.deepEqual(ids("gain30 > 1k"), ["cal"]);
    assert.deepEqual(ids("new = true"), ["tasks"]);
    assert.deepEqual(core.compileQuery("downloads > 0 order by released asc", state, now).order, { key: "updated", dir: "asc" });
    // errors: not applied (everything passes), with where and why
    const bad = core.compileQuery("author ~ brenan rating = on", state, now);
    assert.ok(bad.error && bad.at === 25 && bad.test(plugins[0]));
    assert.ok(core.compileQuery("group > 3", state, now).error, "a list has no >");
    assert.ok(core.compileQuery("favorite = maybe", state, now).error);
    assert.ok(core.compileQuery('group in ("a", b', state, now).error);
    assert.equal(core.isAdvancedQuery("task, project"), false, "plain search stays plain");
    // suggestions: fields, then the type's operators, then the field's values
    const data = { groups: [{ name: "Görev", count: 2 }, { name: "Not alma", count: 9 }], statuses: [{ key: "using", label: "Using" }], authors: ["Liam", "abbys"] };
    const sug = (text) => core.querySuggestions(text, text.length, data).items.map((x) => x.insert);
    assert.ok(sug("dow").includes("downloads"));
    assert.deepEqual(sug("group "), ["=", "!=", "in (", "not in (", "is empty"]);
    assert.ok(!sug("favorite ").includes(">"), "no number operators for a yes/no field");
    assert.deepEqual(sug("group in ("), ["Görev", '"Not alma"']);
    assert.deepEqual(sug('group in ("Görev", N'), ['"Not alma"']);
    assert.deepEqual(sug("author = a"), ["abbys"]);
    assert.ok(sug("downloads > 5 ").includes("AND"));
  },

  "compileQuery: comma terms, /regex/ (case-insensitive, in order), invalid regex never blanks the list"() {
    const p = { id: "project-tasks", name: "Project Tasks", author: "Ali", description: "Plan a project, then track each task." };
    const q = (text) => core.compileQuery(text);
    assert.equal(q("task, project").test(p), true);
    assert.equal(q("task, kanban").test(p), false);
    assert.equal(q("/project.+task/").test(p), true);
    assert.equal(q("/task.+kanban/").test(p), false);
    assert.equal(q("/PROJECT\\s+TASKS/").test(p), true);                    // case-insensitive
    assert.equal(q("/kanban|ali/").test(p), true);                             // author is searched too
    const bad = q("/task(/");
    assert.equal(bad.regex, true);
    assert.ok(bad.error);
    assert.equal(bad.test(p), true);
    assert.equal(q("/").regex, false);                                         // a lone slash is plain text
  },

  "modeOptions: per-tab Downloads and sort with defaults; invalid saved values fall back"() {
    const settings = { ...core.defaultSettings(), downloadFilter: { new: true }, sortBy: { all: { key: "name", dir: "desc" }, updated: { key: "bogus" } } };
    assert.equal(core.modeOptions(settings, "all").filterDownloads, false);     // default: every plugin
    assert.equal(core.modeOptions(settings, "new").filterDownloads, false);     // never on New, even if saved
    assert.equal(core.modeOptions({ ...settings, downloadFilter: { updated: false } }, "updated").filterDownloads, false);   // saved
    assert.equal(core.modeOptions(settings, "changed").filterDownloads, false); // default
    assert.deepEqual(["sort", "sortDir"].map((k) => core.modeOptions(settings, "all")[k]), ["name", "desc"]);
    assert.deepEqual(["sort", "sortDir"].map((k) => core.modeOptions(settings, "new")[k]), ["listed", "desc"]);
    assert.deepEqual(["sort", "sortDir"].map((k) => core.modeOptions(settings, "tracked")[k]), ["rating", "desc"]);
    const rated = [{ id: "b", name: "B" }, { id: "a", name: "A" }, { id: "c", name: "C" }];
    const notes = new Map([["c", { rating: 5 }], ["b", { rating: 3 }]]);
    assert.deepEqual(core.sortRows(rated, "rating", "desc", [], {}, notes).map((p) => p.id), ["c", "b", "a"]);
    assert.equal(core.statusKey("🧪 Deneme süreci", []), "deneme-süreci");
    assert.equal(core.statusKey("To try", ["to-try"]), "to-try-2");
    assert.deepEqual(["sort", "sortDir"].map((k) => core.modeOptions(settings, "updated")[k]), ["downloads", "desc"]);
  },

  "groupsOf / uniqueNames: list, legacy text, duplicates and blanks"() {
    assert.deepEqual(core.groupsOf({ groups: ["Task", " task ", "", "AI"] }), ["Task", "AI"]);
    assert.deepEqual(core.groupsOf({ group: "Task" }), ["Task"]);
    assert.deepEqual(core.groupsOf({ groups: ["AI"], group: "Task" }), ["AI", "Task"]);
    assert.deepEqual(core.groupsOf({ groups: "Solo" }), ["Solo"]);
    assert.deepEqual(core.groupsOf({}), []);
    assert.deepEqual(core.noteFromFrontmatter("x.md", { plugin_id: "x", group: "Ai" }).groups, ["Ai"]);
  },

  "parseGroupSuggestions: keeps your spelling, drops junk, caps at 10, ignores unknown ids"() {
    const reply = "Sure!\n```json\n" + JSON.stringify({
      a: ["task", "Project Management", "Project management", "", 42, "A very long name with far too many words", ...Array.from({ length: 12 }, (_, i) => `G${i}`)],
      b: "not a list",
      zz: ["Ignored"],
    }) + "\n```";
    const out = core.parseGroupSuggestions(reply, ["a", "b", "c"], ["Task"]);
    assert.deepEqual(Object.keys(out), ["a", "b", "c"]);
    assert.deepEqual(out.a.slice(0, 3), ["Task", "Project Management", "G0"]);
    assert.equal(out.a.length, 10);
    assert.deepEqual(out.b, []);
    assert.throws(() => core.parseGroupSuggestions("no json here", ["a"], []));
    const prompt = core.groupPrompt([{ id: "a", name: "A", description: "d" }], [{ name: "Task", examples: ["Tasks"] }], "Türkçe");
    assert.ok(prompt.includes("Türkçe") && prompt.includes('"examples":["Tasks"]') && prompt.trim().endsWith("]"));
  },

  "similarPlugins: BM25 on names and descriptions, word pairs, why it matches, near-copies spread out; closestGroup"() {
    const catalog = [
      P("kanban", { name: "Kanban", description: "Markdown kanban boards for tasks", downloads: 900 }),
      P("board", { name: "Task Board", description: "A kanban board for your tasks and projects", downloads: 500 }),
      P("tasks", { name: "Tasks", description: "Track tasks with due dates and recurring tasks", downloads: 2000 }),
      P("draw", { name: "Excalidraw", description: "Sketch drawings and diagrams", downloads: 3000 }),
      P("cal", { name: "Calendar", description: "Explore your daily notes", downloads: 100 }),
      P("daily", { name: "Daily Notes Plus", description: "Better daily notes with templates", downloads: 50 }),
      P("dupe1", { name: "Kanban Lite", description: "Markdown kanban boards", downloads: 10 }),
      P("dupe2", { name: "Kanban Lite 2", description: "Markdown kanban boards", downloads: 9 }),
      ...Array.from({ length: 40 }, (_, i) => P(`filler${i}`, { name: `Filler ${i}`, description: `Unrelated thing number ${i} for markdown`, downloads: i })),
    ];
    const index = core.textIndex(catalog);
    assert.ok(index.byId.get("tasks").has("task"), "plural folded");
    assert.ok(index.byId.get("cal").has("daily note"), "word pairs, even with a generic word");
    assert.ok(!index.byId.get("cal").has("note"), "a generic word alone doesn't count");

    const similar = core.similarPlugins(catalog[1], catalog, index);
    const ids = similar.map((x) => x.p.id);
    assert.ok(ids.includes("kanban") && !ids.includes("draw") && !ids.includes("board"));
    assert.ok(similar.every((x, i) => i === 0 || x.match <= 1) && similar[0].match > 0);
    assert.ok(similar.find((x) => x.p.id === "kanban").shared.includes("kanban"), "why: the shared terms");
    assert.equal(core.similarPlugins(catalog[1], catalog, index, { exclude: new Set(["kanban"]) }).some((x) => x.p.id === "kanban"), false);
    assert.equal(core.similarPlugins(catalog[1], catalog, index, { limit: 2 }).length, 2);
    assert.deepEqual(core.similarPlugins(catalog[4], catalog, index).map((x) => x.p.id), ["daily"]);

    // two identical copies: the second one waits behind a different idea (maximal marginal relevance)
    const top = core.similarPlugins(catalog[0], catalog, index, { limit: 3 }).map((x) => x.p.id);
    assert.ok(top.includes("dupe1") || top.includes("dupe2"));
    assert.ok(!(top[0].startsWith("dupe") && top[1].startsWith("dupe")), `near-copies not side by side: ${top}`);

    const members = new Map([["Task", ["tasks", "kanban"]], ["Visual", ["draw"]]]);
    assert.equal(core.closestGroup(catalog[1], members, index), "Task");
    assert.equal(core.closestGroup(P("x", { name: "Weather", description: "Shows the forecast" }), members, index), null);
  },

  "semantic Similar: cosine order with a little word help, closeness within the list, the vectors file"() {
    const catalog = [P("a", { name: "Alpha", description: "kanban board" }), P("b", { name: "Beta", description: "board for tasks" }),
      P("c", { name: "Gamma", description: "drawing" }), P("d", { name: "Delta", description: "kanban" }), P("new", { name: "New" })];
    const index = core.textIndex(catalog);
    const rows = { a: [127, 0, 0], b: [100, 78, 0], c: [0, 0, 127], d: [90, 0, 90] };
    const meta = { model: "m", dim: 3, count: 4, built: "x", ids: Object.keys(rows) };
    const vectors = core.parseVectors(meta, Int8Array.from(Object.values(rows).flat()).buffer);
    assert.equal(vectors.rows.get("c"), 2);
    assert.equal(core.parseVectors({ ...meta, count: 5 }, new ArrayBuffer(12)), null, "size must match");
    const found = core.semanticPlugins(catalog[0], catalog, vectors, index, { limit: 3 });
    assert.deepEqual(found.map((x) => x.p.id), ["b", "d", "c"]);
    assert.equal(found[0].match, 1);
    assert.equal(found.at(-1).match, 0);
    assert.ok(found.find((x) => x.p.id === "d").shared.includes("kanban"), "shared words still explain it");
    assert.equal(core.semanticPlugins(catalog[4], catalog, vectors, index), null, "no vector yet: fall back to words");
    assert.deepEqual(core.semanticPlugins(catalog[0], catalog, vectors, index, { exclude: new Set(["b"]) }).map((x) => x.p.id), ["d", "c"]);
    assert.equal(core.closeness(0.9), "similar.veryClose");
    assert.equal(core.closeness(0.5), "similar.close");
    assert.equal(core.closeness(0.1), "similar.related");
  },

  "README translation: kept above the original, version read back, split into requests, estimated; release cadence"() {
    core.setLanguage("en");
    const plugin = P("x", { version: "2.0.0", repo: "me/x" });
    let note = core.replaceReadme(core.noteBody(plugin), core.readmeSection("# Hi\nText", plugin, NOW));
    assert.equal(core.readmeText(note), "# Hi\nText");
    assert.equal(core.readmeTranslation(note), null);
    note = core.replaceReadmeTranslation(note, "> Translation (Türkçe) · v2.0.0 · 2026-11-06\n\n# Merhaba", "README (Türkçe)");
    assert.deepEqual(core.readmeTranslation(note), { version: "2.0.0", body: "# Merhaba" });
    assert.ok(note.indexOf("# README (Türkçe)") < note.indexOf("# README\n"), "right above the original");
    const again = core.replaceReadmeTranslation(note, "> Translation (Türkçe) · v2.1.0 · 2026-12-01\n\nYeni", "README (Türkçe)");
    assert.equal(core.readmeTranslation(again).version, "2.1.0");
    assert.equal(again.split("README (Türkçe)").length, 2, "replaced, not added twice");
    assert.ok(core.noteBody(plugin, "Notes").startsWith("# Notes\n"), "your heading");

    const long = ["# A", "x".repeat(50), "## B", "y".repeat(50), "## C", "z".repeat(50)].join("\n");
    const chunks = core.markdownChunks(long, 70);
    assert.equal(chunks.length, 3);
    assert.equal(chunks.join("\n"), long, "nothing lost");
    assert.deepEqual(core.markdownChunks("short"), ["short"]);
    const estimate = core.translationEstimate("x".repeat(4000), { input: 1, output: 5 });
    assert.equal(estimate.tokens, 2000);
    assert.ok(Math.abs(estimate.cost - (1000 * 1 + 1200 * 5) / 1e6) < 1e-9);
    assert.equal(core.translationEstimate("abc", null).cost, null);
    const D = core.constants.DAY_MS;
    // release rhythm: update waves in the last year (a patch within 3 days joins its wave)
    const Y = 365 * D;
    const now = 3000 * D;
    const rhythm = (dates) => { const c = core.releaseCadence(dates, now); return c && `${core.cadenceLabel(c)} | ${core.cadenceSub(c)}`; };
    // translation instructions: yours (with {language}) or the default; the reply format is always added
    const custom = core.translationPrompt(["x"], "Türkçe", { description: "Into {language}, informal." });
    assert.ok(custom.startsWith("Into Türkçe, informal.\nReply with ONLY a JSON array"));
    assert.ok(core.translationPrompt(["x"], "Türkçe", {}).startsWith("Translate each of the following Obsidian plugin descriptions into Türkçe."));
    const historyNote = (dates) => core.cadenceNote(core.releaseCadence(dates, now), dates.at(-1), now);
    const monthly = Array.from({ length: 12 }, (_, i) => now - i * 30 * D).reverse();
    assert.equal(rhythm([now - 400 * D, ...monthly, now - 30 * D + D]), "every ~30 days | 13 releases in 12 months", "the next-day patch isn't another update");
    // busy early, then a year and four years apart (Hotkeys for templates)
    const early = Array.from({ length: 12 }, (_, i) => i * 5 * D);
    assert.equal(rhythm([...early, now - 5 * Y, now - 4 * D]), "yearly | 1 release in 12 months", "the tile keeps one short fact");
    assert.equal(historyNote([...early, now - 5 * Y, now - 4 * D]), "Last 12 months: 1 update, 1 release · previous gap 5 years", "the long pause goes under the history");
    assert.equal(rhythm(monthly.map((m) => m - 2 * Y)), "none for a year | before: every ~30 days", "went quiet two years ago");
    assert.equal(rhythm([now - 90 * D, now - 60 * D, now - 30 * D]), "every ~45 days | 3 releases in 90 days", "young: its own span");
    assert.equal(rhythm([now - 500 * D, now - 300 * D, now - 100 * D]), "every 6 months | 2 releases in 12 months");
    assert.equal(rhythm([now - 5 * Y]), "none for a year | its only release", "never a dash: one release says so");
    assert.equal(rhythm([now - 20 * D, now - 19 * D]), "one update | 2 releases in 20 days", "a young plugin's one wave");
    assert.equal(rhythm([now - 90 * D, now - 70 * D, now - 50 * D, now - 30 * D, now - 10 * D]), "every ~23 days | 5 releases in 90 days", "by days between waves, not their count");
    assert.equal(historyNote([...early, now - 5 * Y, now - 100 * D, now - 4 * D]), "Last 12 months: 2 updates, 2 releases · previous gap 4.7 years", "a second wave keeps the long pause");
    assert.equal(historyNote(monthly.map((m) => m - 2 * Y)), "No release for 2 years · before: every ~30 days");
    // the history strip: pauses between waves, the last one open until now
    const gaps = core.releaseGaps([now - 400 * D, now - 399 * D, now - 10 * D], now);
    assert.deepEqual(gaps.map((g) => [Math.round(g.days), g.releases, g.open]), [[390, 2, false], [10, 1, true]]);
    assert.deepEqual([3, 20, 100, 600].map(core.spanLabel), ["3 days", "3 weeks", "3 months", "1.6 years"]);
    assert.equal(core.releaseCadence([], now), null);
    core.setLanguage("tr");   // the other tests read Turkish
  },

  "escapeOutsideCode: tags are escaped, code and headings are untouched"() {
    const md = [
      "# Başlık", "Use #todo and #tag/nested, not #123 or a#b.", "Link [[Note]]",
      "```js", "const x = '#keep'; // [[keep]]", "```",
      "- liste", "    ```", "    #keep-indented-fence", "    ```",
      "Inline `#keep` and #escape", "    #keep-indented-code",
      "[Cloud](#grill-cloud) Week \\#44] and (#paren) #çalışma #a/b #44",
    ].join("\n");
    const out = core.escapeOutsideCode(md);
    assert.ok(out.includes("# Başlık\n"));
    assert.ok(out.includes("Use \\#todo and \\#tag/nested, not #123 or a#b."));
    assert.ok(out.includes("Link \\[\\[Note]]"));
    assert.ok(out.includes("const x = '#keep'; // [[keep]]"));
    assert.ok(out.includes("    #keep-indented-fence"));
    assert.ok(out.includes("Inline `#keep` and \\#escape"));
    assert.ok(out.includes("    #keep-indented-code"));
    assert.ok(out.includes("[Cloud](#grill-cloud)"), "link targets must stay intact");
    assert.ok(out.includes("(\\#paren) \\#çalışma \\#a/b #44"), out.split("\n").pop());
  },

  "absolutizeLinks: relative images/links point to GitHub"() {
    const out = core.absolutizeLinks(
      '![s](./img/a.png) [doc](docs/x.md) [ext](https://x.y) [top](#install) <img src="b.gif"> <a href="LICENSE">L</a>', "o/r");
    assert.ok(out.includes("![s](https://raw.githubusercontent.com/o/r/HEAD/img/a.png)"));
    assert.ok(out.includes("[doc](https://github.com/o/r/blob/HEAD/docs/x.md)"));
    assert.ok(out.includes("[ext](https://x.y)") && out.includes("[top](#install)"));
    assert.ok(out.includes('<img src="https://raw.githubusercontent.com/o/r/HEAD/b.gif">'));
    assert.ok(out.includes('<a href="https://github.com/o/r/blob/HEAD/LICENSE">'));
  },

  "absolutizeLinks: images on a GitHub page point to the file; page links stay"() {
    const out = core.absolutizeLinks(
      "![k](https://github.com/m/kanban/blob/main/docs/a.png) [p](https://github.com/m/kanban/blob/main/x.md) "
      + '<img src="https://github.com/p/linter/blob/master/b.gif?raw=true">', "o/r");
    assert.ok(out.includes("![k](https://raw.githubusercontent.com/m/kanban/main/docs/a.png)"));
    assert.ok(out.includes("[p](https://github.com/m/kanban/blob/main/x.md)"));
    assert.ok(out.includes('<img src="https://raw.githubusercontent.com/p/linter/master/b.gif?raw=true">'));
  },

  "migrateImages: only images on GitHub pages change"() {
    const note = "[p](https://github.com/m/k/blob/main/x.md)\n![s](https://github.com/m/k/blob/main/a%20b.png)\n<img src='https://github.com/m/k/blob/main/c.gif'>\n![ok](https://x.y/d.png)";
    const out = core.migrateImages(note);
    assert.equal(out, "[p](https://github.com/m/k/blob/main/x.md)\n![s](https://raw.githubusercontent.com/m/k/main/a%20b.png)\n<img src='https://raw.githubusercontent.com/m/k/main/c.gif'>\n![ok](https://x.y/d.png)");
    assert.equal(core.migrateImages(out), out, "idempotent");
  },

  "replaceReadme: only the marked section changes; appended when markers are missing"() {
    const plugin = P("x");
    const body = core.noteBody(plugin).replace("# Notlarım\n\n", "# Notlarım\nBenim notum\n");
    const once = core.replaceReadme(body, core.readmeSection("ESKI-README #tag", plugin, NOW));
    const twice = core.replaceReadme(once, core.readmeSection("YENI-README", plugin, NOW));
    assert.ok(twice.includes("Benim notum") && twice.includes("YENI-README") && !twice.includes("ESKI-README"));
    assert.equal(twice.split(core.constants.README_START).length, 2);
    const noMarkers = core.replaceReadme("Elle düzenlenmiş not", core.readmeSection("UCUNCU", plugin, NOW));
    assert.ok(noMarkers.startsWith("Elle düzenlenmiş not") && noMarkers.includes("# README") && noMarkers.includes("UCUNCU"));
    assert.ok(core.readmeSection(null, plugin, NOW).includes("README alınamadı"));
    assert.ok(core.readmeSection("x", P("y", { version: null }), NOW).includes("sürüm henüz yok"));
    assert.ok(noMarkers.includes("\n# README\n"));
  },

  "noteBody uses H1; migrateHeadings changes only our two headings"() {
    const body = core.noteBody(P("x"));
    assert.ok(body.startsWith("# Notlarım\n") && body.includes("\n# README\n"), "no description in the body: it's a property");
    const desc = "Create and use dynamic templates.";
    const old0 = `---\nplugin_id: x\n---\n${desc}\n\n${body}`;
    assert.equal(core.stripDescription(old0, desc), `---\nplugin_id: x\n---\n${body}`);
    assert.equal(core.stripDescription(old0, "Another text"), old0);   // changed since: left alone
    assert.equal(core.sourceFields(P("x", { description: desc })).description, desc);
    const old = [
      "açıklama", "", "## Notlarım", "kendi notum", "## Kendi başlığım", "",
      "## README", core.constants.LEGACY_README_START, "## README içindeki başlık", core.constants.LEGACY_README_END,
    ].join("\n");
    const out = core.migrateHeadings(old);
    assert.ok(out.includes("\n# Notlarım\n") && out.includes("\n# README\n" + core.constants.LEGACY_README_START));
    assert.ok(out.includes("## Kendi başlığım") && out.includes("## README içindeki başlık"));
    assert.equal(core.migrateHeadings(out), out);   // a second run changes nothing
    const hidden = core.migrateMarkers(out);
    assert.ok(hidden.includes(core.constants.README_START) && hidden.includes(core.constants.README_END) && !hidden.includes("<!--"));
    assert.equal(core.migrateMarkers(hidden), hidden);
  },

  "formatShort and relativeDays (Turkish)"() {
    assert.deepEqual([2575475, 1416257, 354882, 1416, 950, null].map(core.formatShort),
      ["2,6 Mn", "1,4 Mn", "355 bin", "1,4 bin", "950", "–"]);
    assert.deepEqual([0, 1, 7, 52, 95, 548].map((d) => core.relativeDays(ago(d), NOW)),
      ["bugün", "dün", "7 gün önce", "52 gün önce", "3 ay önce", "1,5 yıl önce"]);
  },

  "translation: prompt, reply parsing and bad replies"() {
    const prompt = core.translationPrompt(["a b", 'say "hi"'], "Türkçe");
    assert.ok(prompt.includes("Türkçe") && prompt.includes('["a b","say \\"hi\\""]'));
    assert.deepEqual(core.parseTranslations('```json\n["bir", " iki "]\n```', 2), ["bir", "iki"]);
    assert.deepEqual(core.parseTranslations('Here you go: ["x"] thanks', 1), ["x"]);
    assert.throws(() => core.parseTranslations('["x"]', 2), /uyuşmuyor/);
    assert.throws(() => core.parseTranslations("üzgünüm", 1), /JSON/);
  },

  "providers: endpoints, key in header, reply text and model list"() {
    const { PROVIDERS } = core;
    const expect = {
      anthropic: ["https://api.anthropic.com/v1/messages", "x-api-key", { content: [{ text: "ok" }] }],
      openai: ["https://api.openai.com/v1/chat/completions", "Authorization", { choices: [{ message: { content: "ok" } }] }],
      gemini: ["https://generativelanguage.googleapis.com/v1beta/models/m:generateContent", "x-goog-api-key",
        { candidates: [{ content: { parts: [{ text: "ok" }] } }] }],
      openrouter: ["https://openrouter.ai/api/v1/chat/completions", "Authorization", { choices: [{ message: { content: "ok" } }] }],
    };
    for (const [id, [url, header, reply]] of Object.entries(expect)) {
      const req = PROVIDERS[id].chat("m", "KEY", "p");
      assert.equal(req.url, url, id);
      assert.ok(String(req.headers[header]).includes("KEY"), id);
      assert.ok(!req.url.includes("KEY"), `${id}: the key must not be in the URL`);
      assert.equal(PROVIDERS[id].text(reply), "ok", id);
    }
    const ids = (list) => list.map((m) => m.id);
    assert.deepEqual(ids(PROVIDERS.gemini.modelList({ models: [
      { name: "models/gemini-x", supportedGenerationMethods: ["generateContent"] },
      { name: "models/embed", supportedGenerationMethods: ["embedContent"] }] })), ["gemini-x"]);
    assert.deepEqual(ids(PROVIDERS.openai.modelList({ data: [{ id: "gpt-x" }, { id: "whisper-1" }, { id: "o4-mini" }] })), ["gpt-x", "o4-mini"]);
    const [paid, free, odd] = PROVIDERS.openrouter.modelList({ data: [
      { id: "a/m", pricing: { prompt: "0.0000003", completion: "0.0000025" } },
      { id: "b/free", pricing: { prompt: "0", completion: "0" } },
      { id: "c/none" }] });
    assert.deepEqual(paid.price, { input: 0.3, output: 2.5 });
    assert.equal(core.formatPrice(paid.price), "$0,30 / $2,50 · 1M token");
    assert.equal(core.formatPrice(free.price), "ücretsiz");
    assert.equal(odd.price, null);
    assert.equal(core.formatPrice({ input: 15, output: 75 }), "$15,0 / $75,0 · 1M token");
  },

  "filterModels: filters by typed terms, offers unlisted names first, latest filter"() {
    const models = [{ id: "google/gemini-2.5-flash" }, { id: "google/gemini-flash-latest" }, { id: "openai/gpt-x" }];
    const ids = (q, latest = false) => core.filterModels(models, q, latest).map((m) => (m.custom ? `+${m.id}` : m.id));
    assert.deepEqual(ids("gem"), ["+gem", "google/gemini-2.5-flash", "google/gemini-flash-latest"]);
    assert.deepEqual(ids("gemini flash"), ["google/gemini-2.5-flash", "google/gemini-flash-latest"]);  // with spaces: no custom name
    assert.deepEqual(ids("", true), ["google/gemini-flash-latest"]);
    assert.deepEqual(ids("~google/gemini-flash-latest"), ["+~google/gemini-flash-latest"]);
    assert.deepEqual(ids("openai/gpt-x"), ["openai/gpt-x"]);   // exact match: no custom row
    for (const name of Object.values(core.KEY_NAMES)) assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/);  // SecretStorage id rule
  },

  "locales: every language has English's keys and placeholders; plural forms are valid"() {
    const placeholders = (value) => [...new Set(Object.values(typeof value === "object" ? value : { other: value })
      .flatMap((text) => text.match(/\{\w+\}/g) || []))].sort();
    const en = core.STRINGS.en;
    for (const [code, strings] of Object.entries(core.STRINGS)) {
      assert.deepEqual(Object.keys(en).filter((k) => !(k in strings)), [], `${code}: missing keys`);
      assert.deepEqual(Object.keys(strings).filter((k) => !(k in en)), [], `${code}: unknown keys`);
      const categories = new Intl.PluralRules(strings.locale).resolvedOptions().pluralCategories;
      for (const [key, value] of Object.entries(strings)) {
        assert.deepEqual(placeholders(value), placeholders(en[key]), `${code}: placeholders of ${key}`);
        if (typeof value !== "object") continue;
        assert.ok(value.other, `${code}: ${key} needs an "other" form`);
        for (const form of Object.keys(value)) assert.ok(categories.includes(form), `${code}: ${key} has unknown plural form "${form}"`);
      }
    }
  },

  "i18n: language matching, English formats and plurals"() {
    assert.deepEqual(["tr", "TR-tr", "en-GB", "pt-BR", "", undefined].map(core.matchLanguage), ["tr", "tr", "en", "en", "en", "en"]);
    core.setLanguage("en-GB");
    try {
      assert.deepEqual([2575475, 354882, 1416, null].map(core.formatShort), ["2.6M", "355K", "1.4K", "–"]);
      assert.equal(core.formatCount(1234567), "1,234,567");
      assert.deepEqual([1, 548].map((d) => core.relativeDays(ago(d), NOW)), ["yesterday", "1.5 years ago"]);
      assert.equal(core.t("filter.days", { n: 1 }), "1 day");
      assert.equal(core.t("filter.days", { n: 52 }), "52 days");
      assert.equal(core.t("row.hatched", { when: "4 days ago", n: 70 }), "4 days ago (after a 70-day incubation)");
      assert.equal(core.t("status.delta", { added: 5, updated: 23 }), "Since last sync: 5 new · 23 updated");
      assert.equal(core.t("missing.key"), "missing.key");
      assert.ok(core.noteBody(P("x")).startsWith("# My notes\n"));
      assert.equal(core.defaultSettings().folder, "Plugins");
    } finally {
      core.setLanguage("tr");
    }
    assert.equal(core.defaultSettings().folder, "Eklentiler");   // "Plugins" in English
    assert.equal(core.t("row.hatched", { when: "4 gün önce", n: 70 }), "4 gün önce (70 günlük kuluçkadan çıktı)");
    assert.equal(core.formatShort(2575475), "2,6 Mn");
  },

  "catalogDelta counts new plugins and newer releases"() {
    const before = [{ id: "a", updated: 1 }, { id: "b", updated: 5 }, { id: "c" }];
    const after = [{ id: "a", updated: 2 }, { id: "b", updated: 5 }, { id: "c", updated: 3 }, { id: "d", updated: 9 }];
    assert.deepEqual(core.catalogDelta(before, after), { added: 1, updated: 2 });
  },

  "readmeVersion reads the version from the README meta line"() {
    const plugin = { ...P("x"), repo: "o/x", version: "1.2.0" };
    const note = core.replaceReadme(core.noteBody(plugin), core.readmeSection("# Hi", plugin, NOW));
    assert.equal(core.readmeVersion(note), "1.2.0");
    assert.equal(core.readmeVersion(core.noteBody(plugin)), null);   // markers but no meta yet
    assert.equal(core.readmeVersion("no markers"), null);
  },

  async "mapLimit: keeps order and respects the limit"() {
    let running = 0, peak = 0;
    const out = await core.mapLimit([5, 1, 3, 2], 2, async (n) => {
      running++; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n * 5));
      running--; return n * 10;
    });
    assert.deepEqual(out, [50, 10, 30, 20]);
    assert.equal(peak, 2);
  },
};

(async () => {
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try { await fn(); } catch (error) { failed++; console.log(`  ✖ ${name}\n    ${error.message}`); }
  }
  const total = Object.keys(tests).length;
  console.log(failed ? `✖ ${failed}/${total} tests failed` : `✅ ${total}/${total} unit tests passed`);
  process.exitCode = failed ? 1 : 0;
})();
