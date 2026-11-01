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

  "selectSnapshots: daily for 30 days, weekly before (last commit of the week)"() {
    const commits = Array.from({ length: 120 }, (_, i) => ({ sha: `s${i}`, date: ago(119 - i) }));
    const picked = core.selectSnapshots(commits, NOW);
    const recent = picked.filter((c) => NOW - c.date <= 30 * DAY_MS);
    assert.equal(recent.length, 31);                       // 0..30 days ago
    const older = picked.filter((c) => NOW - c.date > 30 * DAY_MS);
    assert.ok(older.length >= 12 && older.length <= 14, older.length);
    assert.deepEqual(picked.map((c) => c.date), [...picked.map((c) => c.date)].sort((a, b) => a - b));  // order kept
  },

  "mergeSnapshot: appends only on change, caps at 50, skips undated"() {
    const timeline = core.newTimeline(12);
    for (let d = 80; d >= 0; d--) core.mergeSnapshot(timeline, { x: { updated: ago(d) }, y: { updated: ago(5) }, z: { updated: 0 } }, ago(d));
    assert.equal(timeline.releases.x.length, 50);
    assert.equal(timeline.releases.y.length, 1);
    assert.equal(timeline.releases.z, undefined);
  },

  "mergeSnapshot: first snapshot marks plugins as old (0), later ones get their first-seen day"() {
    const timeline = core.newTimeline(12);
    core.mergeSnapshot(timeline, { old: { updated: ago(400) } }, ago(100));
    core.mergeSnapshot(timeline, { old: { updated: ago(400) }, fresh: { updated: 0 } }, ago(3));
    assert.deepEqual(timeline.firstSeen, { old: 0, fresh: ago(3) });
    assert.ok(core.isNewPlugin(timeline.firstSeen, P("fresh"), NOW));
    assert.ok(!core.isNewPlugin(timeline.firstSeen, P("old"), NOW));
    assert.ok(core.isNewPlugin(timeline.firstSeen, P("listed", { downloads: null }), NOW));  // no stats yet
    assert.ok(!core.isNewPlugin(timeline.firstSeen, P("fresh"), NOW, 2));                    // outside the window
  },

  "upgradeTimeline: keeps old history and flags a rebuild for first-seen dates"() {
    const old = { from: 1, to: 2, releases: { a: [1] } };
    const up = core.upgradeTimeline(old);
    assert.deepEqual(up.releases, { a: [1] });
    assert.equal(up.legacy, true);
    assert.equal(up.v, core.constants.TIMELINE_VERSION);
    assert.equal(core.upgradeTimeline(core.newTimeline(6)).legacy, undefined);
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
    const opts = { mode: "updated", days: 14, dormantDays: 90, minDownloads: 100, sort: "downloads", query: "" };
    const ids = (o) => core.discover(state, { ...opts, ...o }, NOW).map((p) => p.id);
    assert.deepEqual(ids({}), ["a"]);                       // b old, c excluded, d few downloads, e tracked
    assert.deepEqual(ids({ mode: "awakened" }), ["a"]);     // a was quiet for 299 days
    assert.deepEqual(ids({ mode: "awakened", dormantDays: 365 }), []);
    assert.deepEqual(ids({ mode: "changed" }), ["e"]);      // reviewed 10 days ago, released 1 day ago
    assert.deepEqual(ids({ mode: "suggested" }), ["a", "e"]);   // installed and not starred
    state.dismissed.add("a");
    assert.deepEqual(ids({ mode: "suggested" }), ["e"]);
    state.dismissed.delete("a");
    assert.deepEqual(ids({ mode: "new" }), ["d"]);            // listed in the last 14 days; no download filter
    assert.deepEqual(ids({ mode: "new", days: 3 }), []);
    const counts = core.modeCounts(state, opts, NOW);
    assert.deepEqual(counts, { all: 3, new: 1, updated: 1, awakened: 1, changed: 1, suggested: 2 });  // all: a, b, e (c excluded, d below 100 downloads)
    assert.deepEqual(ids({ query: "a, desc" }), ["a"]);
  },

  "discover all: every plugin incl. tracked, excluded hidden, four sorts; other tabs ignore All-only sorts"() {
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
    assert.deepEqual(ids({ minDownloads: 100 }), ["alpha", "mid"]);
    const updated = core.discover(state, { mode: "updated", days: 7, minDownloads: 0, query: "", sort: "name" }, NOW).map((p) => p.id);
    assert.deepEqual(updated, ["alpha"]);                                         // "name" isn't offered here → downloads
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
    assert.ok(body.includes("\n# Notlarım\n") && body.includes("\n# README\n"));
    const old = [
      "açıklama", "", "## Notlarım", "kendi notum", "## Kendi başlığım", "",
      "## README", core.constants.README_START, "## README içindeki başlık", core.constants.README_END,
    ].join("\n");
    const out = core.migrateHeadings(old);
    assert.ok(out.includes("\n# Notlarım\n") && out.includes("\n# README\n" + core.constants.README_START));
    assert.ok(out.includes("## Kendi başlığım") && out.includes("## README içindeki başlık"));
    assert.equal(core.migrateHeadings(out), out);   // a second run changes nothing
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

  "i18n: English and Turkish have the same keys; English formats"() {
    const en = Object.keys(core.STRINGS.en).sort();
    const tr = Object.keys(core.STRINGS.tr).sort();
    assert.deepEqual(en.filter((k) => !tr.includes(k)), [], "missing in Turkish");
    assert.deepEqual(tr.filter((k) => !en.includes(k)), [], "missing in English");
    core.setLanguage("en-GB");
    try {
      assert.deepEqual([2575475, 354882, 1416, null].map(core.formatShort), ["2.6M", "355K", "1.4K", "–"]);
      assert.equal(core.formatCount(1234567), "1,234,567");
      assert.deepEqual([1, 548].map((d) => core.relativeDays(ago(d), NOW)), ["yesterday", "1.5 years ago"]);
      assert.equal(core.t("row.gap", { n: 1 }), "after 1 day");
      assert.equal(core.t("row.gap", { n: 52 }), "after 52 days");
      assert.equal(core.historyLabel(12), "last year");
      assert.ok(core.noteBody(P("x")).includes("\n# My notes\n"));
      assert.equal(core.defaultSettings().folder, "Community Radar");
    } finally {
      core.setLanguage("tr");
    }
    assert.equal(core.defaultSettings().folder, "Eklentiler");
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
