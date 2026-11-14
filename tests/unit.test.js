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
/** A timeline's downloads series from {id: downloads at each age}, as the server writes it (changes after the first). */
const series = (counts, ages = [90, 30, 7, 0]) => ({ days: ages.map((age) => Math.floor(NOW / DAY_MS) - age), points: Object.fromEntries(Object.entries(counts).map(([id, c]) => [id, c.map((x, i) => (i ? x - c[i - 1] : x))])) });

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



  "discover: Updated leaves out busy plugins (new ones stay: NOT listed <= 14d is yours to add); Incubation lists the latest hatchings"() {
    const busy = Array.from({ length: 25 }, (_, i) => ago(170 - i * 7));
    const catalog = [P("young", { updated: ago(2) }), P("busy", { updated: ago(2) }), P("calm", { updated: ago(2) }),
      P("hatched", { updated: ago(20) }), P("expired", { updated: ago(80) })];
    const state = {
      catalog, notes: new Map(), excluded: new Set(), dismissed: new Set(), installed: new Set(),
      releases: { busy: [...busy, ago(2)], calm: [ago(40), ago(2)], hatched: [ago(108), ago(20)], expired: [ago(150), ago(80)] },
      firstSeen: { young: ago(10), busy: 0, calm: 0, hatched: 0, expired: 0 },
    };
    // the tabs are their page queries now; the days and Hide busy live in them
    const page = (mode, o) => ({ pageQueries: { [mode]: core.defaultPageQuery(mode, { downloads: 0, ...o }) } });
    const ids = (o) => core.discover(state, { mode: "updated", minDownloads: 0, query: "", sort: "name", ...page("updated"), ...o }, NOW).map((p) => p.id);
    assert.deepEqual(ids({}), ["calm", "young"]);                 // busy updated 25 times; young (10 days old) stays
    assert.deepEqual(ids(page("updated", { busy: false })), ["busy", "calm", "young"]);
    assert.deepEqual(ids({ pageQueries: { updated: "released <= 14d AND NOT listed <= 14d" } }), ["busy", "calm"], "NOT listed <= 14d leaves young out");
    // New follows the New plugin period, like the badge: 10 days old is new at 14 days, not at 7
    const fresh = (newDays) => core.discover(state, { mode: "new", minDownloads: 0, query: "", sort: "name", newDays }, NOW).map((p) => p.id);
    assert.deepEqual(fresh(14), ["young"]);
    assert.deepEqual(fresh(7), []);
    assert.equal(core.pageQuery({ newDays: 7 }, "new"), "listed <= 7d AND NOT tracked\norder by listed desc");
    assert.equal(core.updateWaves(state.releases.busy, ago(180), NOW), 25);   // 26 releases, the last two the same day
    // 21 hotfixes in two sittings are two updates, not a busy plugin
    const sittings = [...Array.from({ length: 11 }, (_, i) => ago(120) + i * 6 * 3600e3), ...Array.from({ length: 10 }, (_, i) => ago(10) + i * 6 * 3600e3)];
    assert.equal(core.updateWaves(sittings, ago(180), NOW), 2);
    assert.deepEqual(core.releaseWaves([0, 6 * DAY_MS, 7 * DAY_MS]).map((w) => w.length), [2, 1], "within a week: one update; a week later: the next");
    assert.deepEqual(ids({ mode: "awakened" }), ["hatched"], "88 days quiet, back 20 days ago; expired came back 80 days ago");
    // filters added with + Filter work on any tab
    assert.deepEqual(ids({ mode: "all", extras: { incubated: 80 } }), ["hatched"], "incubation ≥ 80 on All");
    assert.deepEqual(ids({ mode: "all", extras: { released: 10 } }), ["busy", "calm", "young"]);
    state.installed = new Set(["calm"]);
    assert.deepEqual(ids({ mode: "all", extras: { installed: true, released: 10 } }), ["calm"]);
    state.installed = new Set();
    assert.ok(!core.addableFilters({ extraFilters: { all: { incubated: 60 } } }, "all").includes("incubated"), "added once");
    assert.ok(!core.addableFilters({}, "awakened").includes("incubated"), "Incubation has its own");
  },

  "filterSummary: the changed filters as they are now, merged Downloads"() {
    const base = core.clearedFilters({ downloadFilter: {} }, "updated");
    const settings = { ...base, minDownloads: 500, downloadFilter: { updated: true }, query: "kanban" };
    assert.equal(core.changedFilters(settings, "updated"), 2);
    assert.equal(core.filterSummary(settings, "updated"),
      "Bu sekmenin varsayılanından değişenler:\n• Arama: “kanban”\n• İndirme ≥ 500\nSıfırla hepsini varsayılana döndürür");
    assert.equal(core.filterSummary(base, "updated"), core.t("filter.tipNone"));
  },

  "lastHatch: the latest pause of 30+ days between update waves; later releases don't undo it"() {
    const plugin = P("x", { updated: ago(1) });
    assert.deepEqual(core.lastHatch({ x: [ago(400), ago(40), ago(30), ago(7), ago(1)] }, plugin), { at: ago(40), days: 360 }, "10 and 23 days are no incubation");
    assert.deepEqual(core.lastHatch({ x: [ago(400), ago(1)] }, plugin), { at: ago(1), days: 399 });
    assert.equal(core.lastHatch({ x: [ago(1)] }, plugin), null);   // no history
    assert.equal(core.lastHatch({ x: [ago(20), ago(1)] }, plugin), null, "19 days: no incubation");
  },

  "home widgets: the card counts and previews exactly the list it opens (one query each)"() {
    const day = core.dayString;
    const catalog = [
      P("fresh", { downloads: null, updated: null }),                                   // listed, no stats yet
      P("hidden", { downloads: 12000, updated: ago(2) }),                                // excluded: never on a card
      P("grow", { downloads: 2000, updated: ago(3) }),
      P("ms", { downloads: 10200, updated: ago(40) }),
      P("edge", { downloads: 800, updated: ago(14) }),                                    // released exactly 14 days ago
      P("tr", { downloads: 300, updated: ago(1) }),
      P("tr2", { downloads: 500, updated: ago(4) }),
      P("inst", { downloads: 700, updated: ago(90) }),
      P("instTracked", { downloads: 900, updated: ago(90) }),
      P("back", { downloads: 600, updated: ago(1) }),
    ];
    const state = {
      catalog, firstSeen: { hidden: ago(3), grow: ago(5), ms: 0, edge: 0, tr: 0, tr2: 0, inst: 0, instTracked: 0, back: 0 },
      releases: { back: [ago(200), ago(3)] },
      notes: new Map([["tr", { reviewed: day(ago(5)), groups: [] }], ["tr2", { reviewed: day(ago(6)), groups: [] }], ["instTracked", { groups: [] }]]),
      installed: new Set(["inst", "instTracked"]), excluded: new Set(["hidden"]), dismissed: new Set(), snoozed: {},
    };
    state.timeline = { to: NOW, milestoneSteps: [1000, 10000], milestones: { ms: [0, ago(5)], hidden: [0, ago(2)] },
      series: series({ grow: [1300, 1400, 1900, 2000], hidden: [5000, 6000, 11000, 12000], ms: [9000, 9500, 9900, 10200] }, [90, 30, 7, 0]) };
    const settings = core.defaultSettings();
    const ctx = { state, timeline: state.timeline, settings, now: NOW };
    const ids = (rows) => rows.map((p) => p.id);
    // the list a widget opens: its query on a page of its own (what openPreset shows)
    const list = (query) => ids(core.discover(state, core.modeOptions({ ...settings, queries: { all: query } }, "all"), NOW));
    const card = {};
    for (const [id, widget] of Object.entries(core.HOME_WIDGETS)) {
      const variants = id === "rising" ? [{ by: "pct" }, { by: "abs" }] : [{}];
      for (const extra of variants) {
        const params = { ...widget.defaults, ...extra };
        const rows = ids(core.widgetRows(ctx, widget, params));
        assert.deepEqual(rows, list(widget.query(ctx, params)), `${id} ${JSON.stringify(extra)}: card = list`);
        if (id !== "hidden") assert.ok(!rows.includes("hidden"), `${id}: an excluded plugin stays off the card`);
        const since = ids(core.widgetRows(ctx, widget, { ...params, since: ago(3) }));
        assert.ok(since.every((x) => rows.includes(x)), `${id}: "since" is part of the list`);
        card[id + (extra.by || "")] = rows;
      }
    }
    assert.ok(card.new.includes("fresh"), "a plugin without stats yet is new");
    assert.deepEqual(card.milestone, ["ms"], "reached 10K within 7 days");
    assert.deepEqual(card.risingpct, ["grow"]);
    assert.ok(card.updated.includes("edge"), "the 14th day is in");
    assert.deepEqual(card.tracked, ["tr", "tr2"], "newest release first, as the list sorts it");
    assert.deepEqual(card.suggested, ["inst"], "a tracked plugin isn't a suggestion");
    assert.deepEqual(card.awakened, ["back"]);
    // a tab's widget is the tab: its card counts the tab's query, saved changes included
    assert.equal(core.HOME_WIDGETS.updated.query(ctx, {}), core.pageQuery(settings, "updated"));
    const mine = { ...settings, pageQueries: { updated: "released <= 3d\norder by name asc" } };
    assert.equal(core.HOME_WIDGETS.updated.query({ ...ctx, settings: mine }, {}), "released <= 3d\norder by name asc");
    assert.equal(core.HOME_WIDGETS.updated.query({ ...ctx, settings: mine }, { since: ago(3) }), `released >= ${core.dayString(ago(3))}\norder by name asc`, "N new: its own window gives way to the day");
    const since = `listed >= ${core.dayString(ago(3))}`;
    assert.equal(core.narrowQuery("listed <= 14d AND NOT tracked\norder by listed desc", "listed", since), `${since} AND NOT tracked\norder by listed desc`);
    assert.equal(core.narrowQuery("NOT tracked", "listed", since), `NOT tracked AND ${since}`, "no window of its own: joined");
    assert.equal(core.narrowQuery("tracked OR installed", "listed", since), `(tracked OR installed) AND ${since}`, "an OR keeps its parentheses");
  },

  "downloads series: kept on calendar days; delta.json joins on to the copy, a gap asks for the whole file"() {
    const day = Math.floor(NOW / DAY_MS);
    const days = core.seriesDays(day);
    const daily = days.indexOf(day - 30);
    assert.equal(days.length - daily, 31, "every day of the last month");
    assert.ok(days.slice(0, daily).every((d) => (d + 3) % 7 === 0), "Mondays before it");
    assert.ok(day - days[0] >= 365 && day - days[0] < 372, "back a year");
    // a copy two days old, then the last three days from the server: 10 downloads a day for a, b listed yesterday
    const enc = (c) => c.map((x, i) => (i ? x - c[i - 1] : x));
    const count = (d) => (d - 20000) * 10;
    const old = core.seriesDays(day - 2);
    const copy = { v: 3, from: ago(2000), to: ago(2), releases: { a: [ago(100)] }, firstSeen: { a: 0 }, milestones: {}, removed: {},
      series: { days: old, points: { a: enc(old.map(count)) } } };
    const recent = [day - 3, day - 2, day - 1, day];
    const delta = { v: 3, from: ago(2), to: NOW, releases: { a: [ago(1)] }, firstSeen: { b: ago(1) }, milestones: { a: [ago(1)] }, removed: { x: [ago(1), "gone"] },
      series: { days: recent, points: { a: enc(recent.map(count)), b: enc([0, 0, 5, 9]) } } };
    const merged = core.mergeTimeline(copy, delta);
    assert.deepEqual(merged.series.days, days, "on today's days");
    assert.deepEqual(merged.series.points.a, enc(days.map(count)), "the copy's days and the new ones, one series");
    assert.equal(core.gainOver(merged, "a", 7), 70);
    assert.equal(core.gainOver(merged, "b", 1), 4, "a plugin listed yesterday: 0 before it");
    assert.deepEqual(merged.releases.a, [ago(100), ago(1)]);
    assert.ok(merged.to === NOW && merged.firstSeen.b === ago(1) && merged.removed.x && merged.milestones.a);
    const gap = { ...delta, series: { days: [day - 1, day], points: { a: [1, 1] } } };
    assert.equal(core.mergeTimeline(copy, gap), null, "the delta doesn't reach the copy: the whole file");
  },

  "saved queries from before 0.11 move to today's fields; one that doesn't parse finds nothing"() {
    assert.equal(core.migrateQuery("released <= 14d AND NOT tracked AND NOT busy AND downloads >= 100\norder by downloads asc"),
      "released <= 14d AND NOT tracked AND releases(180d) <= 9 AND downloads >= 100\norder by downloads asc");
    assert.equal(core.migrateQuery("busy OR new"), "releases(180d) > 9 OR listed <= 14d");
    assert.equal(core.migrateQuery("NOT new AND gain30 >= 1k\norder by rise7 desc"), "NOT listed <= 14d AND gain(30d) >= 1k\norder by rise(7d) desc");
    assert.equal(core.migrateQuery("milestone <= 30d order by milestone desc"), "milestone() <= 30d order by milestone() desc");
    assert.equal(core.migrateQuery('name ~ new AND "busy" AND milestone(10k) <= 30d AND gain(7d) > 0'), 'name ~ new AND "busy" AND milestone(10k) <= 30d AND gain(7d) > 0', "values and today's fields stay");
    const state = { catalog: [P("a")], notes: new Map(), excluded: new Set(), dismissed: new Set(), installed: new Set(), snoozed: {}, firstSeen: {}, releases: {} };
    assert.deepEqual(core.discover(state, { mode: "updated", pageQueries: { updated: "NOT busy" }, minDownloads: 0, query: "" }, NOW), [], "a stale saved query: nothing, not everything");
  },

  "query edges: before-the-history plugins are old, missing values sort last both ways, milestones sort"() {
    const catalog = [P("old", { downloads: 50000, updated: ago(500) }), P("young", { downloads: 2000, updated: ago(5) }),
      P("nostats", { downloads: null, updated: null })];
    const state = { catalog, notes: new Map(), excluded: new Set(), dismissed: new Set(), installed: new Set(), snoozed: {},
      firstSeen: { old: 0, young: ago(40) }, releases: { young: [ago(300), ago(5)] },
      timeline: { from: ago(2000), to: NOW, milestoneSteps: [1000, 10000], milestones: { old: [0, 0], young: [ago(10), null] },
        series: series({ old: [48000, 49000, 49500, 50000], young: [0, 500, 1500, 2100] }) } };
    const ids = (q) => core.discover(state, { mode: "all", queries: { all: q }, minDownloads: 0, query: "" }, NOW).map((p) => p.id);
    assert.deepEqual(ids("listed >= 1y"), ["old"], "listed before the history (2000 days ago): at least that old");
    assert.deepEqual(ids("listed <= 30d"), ["nostats"], "…and never new");
    assert.deepEqual(ids("milestone() >= 1y"), ["old"], "passed 10K before the history");
    assert.deepEqual(ids("milestone(1k) <= 30d"), ["young"], "reached 1K within the series (a week back: weekly points)");
    assert.deepEqual(ids("milestone(40k) <= 30d"), [], "over 40K when the series starts: long ago");
    assert.deepEqual(ids("gain(30d) >= 1k"), ["old", "young"]);
    assert.deepEqual(ids("gain(60d) > 1200"), ["old", "young"], "between two points: in proportion (young: 2100 − 250)");
    assert.equal(core.gainOver(state.timeline, "young", 60), 1850);
    assert.equal(core.gainOver(state.timeline, "young", 400), null, "beyond the series");
    assert.equal(core.compileQuery("gain >= 1k", state, NOW).error, core.t("query.error.param", { field: "gain" }), "a parametric field needs its ( )");
    assert.ok(core.compileQuery("gain(abc) >= 1k", state, NOW).error);
    assert.equal(ids("order by incubated asc")[0], "young", "no history goes last, asc too");
    assert.equal(ids("order by released asc").at(-1), "nostats", "no release date goes last, asc too");
    assert.deepEqual(ids("downloads > 0 order by milestone() desc"), ["young", "old"], "the latest milestone first");
    assert.deepEqual(ids("downloads > 0 order by gain(7d) desc"), ["young", "old"]);
    assert.deepEqual(core.compileQuery("order by gain()", state, NOW).order, { key: "gain(30d)", dir: "desc" }, "() is the default, written out");
    assert.throws(() => core.parseQuery("passed <= 30d", { strict: true }), "passed is gone: milestone says when, downloads which");
  },

  "home groups: defaults, the layout before groups becomes groups, each widget once a group"() {
    assert.deepEqual(core.normalizeHome().groups.map((g) => [g.id, g.look, g.since]), [["news", "small", true], ["state", "small", false], ["discover", "big", false]]);
    const legacy = core.normalizeHome({
      order: ["rising", "new", "view:a", "mine"], hidden: ["new"], since: { show: true, period: 7, order: ["updated", "new", "tracked"] },
      views: [{ id: "a", name: "A", query: "x" }],
    });
    assert.deepEqual(legacy.groups.map((g) => [g.id, g.items]), [["news", ["updated", "new", "tracked"]], ["state", ["mine", "suggested", "hidden"]], ["discover", ["rising", "view:a"]]]);
    assert.equal(legacy.since.period, 7);
    assert.ok(!("order" in legacy) && !("hidden" in legacy));
    assert.ok(core.unplacedWidgets(legacy).includes("milestone") && !core.unplacedWidgets(legacy).includes("view:a"));
    const kept = core.normalizeHome({ groups: [{ id: "x", name: "Mine", look: "odd", items: ["new", "new", "gone"] }] });
    assert.deepEqual(kept.groups[0], { id: "x", name: "Mine", look: "big", items: ["new"] }, "an unknown look is big; twice and gone drop out");
    assert.deepEqual(core.normalizeHome({ order: ["new"], since: { show: false } }).groups.map((g) => g.id), ["discover"], "At a glance was off: only the big cards");
  },

  "visits are days: the first opening of a day moves the last visit back; new counts from that day, opening empties nothing"() {
    const home = core.normalizeHome();
    assert.equal(core.recordVisit(home, ago(3)), true);
    assert.deepEqual(home.visit, { last: core.dayString(ago(3)), before: null });
    assert.equal(core.sinceMoment(home, NOW), NOW - 7 * core.constants.DAY_MS, "first use: a week back");
    assert.equal(core.recordVisit(home, NOW), true, "a new day");
    assert.equal(core.recordVisit(home, NOW + 3600e3 * 2), false, "the same day again: nothing moves");
    assert.deepEqual(home.visit, { last: core.dayString(NOW), before: core.dayString(ago(3)) });
    assert.equal(core.sinceMoment(home, NOW), core.dayStart(core.dayString(ago(3))), "from the start of the last visit day");
    home.since.period = 7;
    assert.equal(core.sinceMoment(home, NOW), ago(7));
    // asked "since", a widget's window is in its query, from that day on
    assert.equal(core.within("listed", core.sinceParams({ days: 30 }, ago(3))), `listed >= ${core.dayString(ago(3))}`);
    assert.equal(core.within("listed", { days: 30 }), "listed <= 30d");
    assert.equal(core.HOME_WIDGETS.tracked.query({}, { since: ago(3) }), `unreviewed AND released >= ${core.dayString(ago(3))}\norder by released desc`);
  },


  "presets: every ready-made query parses, has its three texts and a gallery section"() {
    for (const p of core.QUERY_PRESETS) {
      assert.doesNotThrow(() => core.parseQuery(p.query, { strict: true }), p.key);
      for (const suffix of ["", ".desc", ".why"]) assert.notEqual(core.t(`preset.${p.key}${suffix}`), `preset.${p.key}${suffix}`, `${p.key}${suffix} text`);
      assert.ok(core.GALLERY_SECTIONS[p.cat] && p.cat !== "hidden", `${p.key}: section`);
    }
    assert.equal(new Set(core.QUERY_PRESETS.map((p) => p.key)).size, core.QUERY_PRESETS.length, "keys are unique");
    const guide = require("fs").readFileSync(require("path").join(__dirname, "../docs/query.md"), "utf8");
    for (const p of core.QUERY_PRESETS) assert.ok(guide.includes(`\`${p.query.replace(/\s*\n\s*/g, " ")}\``), `docs/query.md lists ${p.key}`);
    for (const q of ['author ~ zsviczian', '"daily note" OR "journal"']) assert.doesNotThrow(() => core.parseQuery(q, { strict: true }), q);
  },

  "incubation is fair: every hatching gets the same days, a hotfix or a next release doesn't undo it"() {
    const fields = (rel) => { const p = P("x", { updated: rel.at(-1) }); const st = { releases: { x: rel } };
      return [core.QUERY_FIELDS.incubated.get(st, p, NOW), Math.round(core.QUERY_FIELDS.hatched.get(st, p, NOW))]; };
    assert.deepEqual(fields([ago(402), ago(2), ago(0)]), [400, 2], "v2.0 after 400 days, v2.0.1 two days later");
    assert.deepEqual(fields([ago(425), ago(25), ago(5)]), [400, 25], "back 25 days ago and still releasing: still hatched 25 days ago");
    assert.deepEqual(fields([ago(660), ago(300)]), [360, 300], "a year asleep earns no longer stay: hatched 300 days ago");
    const q = core.compileQuery(`incubated >= 60d AND hatched <= ${core.constants.HATCHED_DAYS}d`, { releases: { a: [ago(660), ago(300)], c: [ago(425), ago(25), ago(5)] } }, NOW, true);
    assert.deepEqual(["a", "c"].filter((id) => q.test(P(id, { updated: id === "a" ? ago(300) : ago(5) }))), ["c"]);
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
    const opts = { mode: "updated", minDownloads: 100, filterDownloads: true, sort: "downloads", query: "" };
    const ids = (o) => core.discover(state, { ...opts, ...o }, NOW).map((p) => p.id);
    const page = (mode, o) => ({ pageQueries: { [mode]: core.defaultPageQuery(mode, o) } });
    assert.deepEqual(ids({}), ["a"]);                       // b old, c excluded, d few downloads, e tracked
    assert.deepEqual(ids({ mode: "awakened", ...page("awakened", { incubated: 90 }) }), ["a"]);     // a was quiet for 299 days
    assert.deepEqual(ids({ mode: "awakened", ...page("awakened", { incubated: 365 }) }), []);
    assert.deepEqual(ids({ mode: "tracked", trackedGroup: core.UPDATES }), ["e"]);   // reviewed 10 days ago, released 1 day ago
    assert.deepEqual(ids({ mode: "tracked", trackedGroup: core.STARRED }), []);
    assert.deepEqual(ids({ mode: "suggested" }), ["a"]);   // installed and not tracked (e has a note)
    state.dismissed.add("a");
    assert.deepEqual(ids({ mode: "suggested" }), []);
    state.dismissed.delete("a");
    assert.deepEqual(ids({ mode: "new", filterDownloads: false }), ["d"]);   // listed in the last 14 days
    assert.deepEqual(ids({ mode: "new" }), []);                                // …but below 100 downloads
    assert.deepEqual(ids({ mode: "new", filterDownloads: false, newDays: 3 }), []);   // Settings › New plugin period: the New tab follows it
    const counts = core.modeCounts(state, opts, NOW);   // each tab with its default Downloads on/off (New: off)
    assert.deepEqual(counts, { all: 4, new: 1, updated: 1, awakened: 1, tracked: 1, suggested: 1 });  // all: every plugin but the excluded c (no Downloads ≥ by default)
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
    const ids = (o) => core.discover(state, { mode: "all", days: 7, minDownloads: 0, query: "", sort: "downloads", ...o }, NOW).map((p) => p.id);
    assert.deepEqual(ids({}), ["alpha", "mid", "zeta"]);                        // tracked "mid" stays, "gone" excluded
    assert.deepEqual(ids({ sort: "released" }), ["mid", "alpha", "zeta"]);
    assert.deepEqual(ids({ sort: "name" }), ["alpha", "mid", "zeta"]);            // case-insensitive
    assert.deepEqual(ids({ sort: "listed" }), ["mid", "alpha", "zeta"]);          // newest in the listing first
    assert.deepEqual(ids({ minDownloads: 100, filterDownloads: true }), ["alpha", "mid"]);
    assert.deepEqual(ids({ minDownloads: 100 }), ["alpha", "mid", "zeta"]);      // filter off: threshold ignored
    assert.deepEqual(ids({ sortDir: "asc" }), ["zeta", "mid", "alpha"]);          // fewest downloads first
    assert.deepEqual(ids({ sort: "name", sortDir: "desc" }), ["zeta", "mid", "alpha"]);   // Z → A
    assert.deepEqual(ids({ sort: "released", sortDir: "asc" }), ["zeta", "alpha", "mid"]); // oldest first
    assert.deepEqual(ids({ query: "/^(al|mi)/" }), ["alpha", "mid"]);
    const releases = { zeta: [ago(900), ago(300)], alpha: [ago(40), ago(5)], mid: [ago(2), ago(1)] };
    assert.deepEqual(core.sortRows([...catalog.slice(0, 3)], "incubated", "desc", { catalog, releases }).map((p) => p.id), ["zeta", "alpha", "mid"]);
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
      installed: new Set(["cal"]), firstSeen: { cal: now - 900 * DAY, tasks: now - 5 * DAY, old: 0 }, releases: {},
      timeline: { to: now, series: series({ cal: [1_990_000, 1_998_000, 1_999_990, 2_000_000], tasks: [600, 600, 600, 600] }) },
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
    assert.deepEqual(ids("gain(30d) > 1k"), ["cal"]);
    assert.deepEqual(ids("gain() > 1k"), ["cal"], "() is 30 days");
    assert.deepEqual(ids("gain(21d) > 1k"), ["cal"], "any window: between the points");
    assert.deepEqual(ids("listed <= 14d"), ["tasks"]);
    assert.deepEqual(core.compileQuery("downloads > 0 order by released asc", state, now).order, { key: "released", dir: "asc" });
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
    assert.deepEqual(sug("group in (Görev, "), ['"Not alma"'], "a value already listed isn't offered again");
    assert.deepEqual(sug("author = abbys"), [], "typed in full: the list closes");
    assert.deepEqual(sug("downloads <= 5100"), [], "a number being typed");
    assert.ok(sug("NOT installed ").includes("AND") && !sug("NOT installed ").includes("="), "a yes/no field stands alone");
    const mid = "author in (abbys, x)";
    assert.deepEqual(core.querySuggestions(mid, mid.indexOf("bys"), data).items, [], "inside a word: nothing");

    // what the box paints: one span per clause (NOT and order by their own), the broken part, free words
    const spans = (text) => core.compileQuery(text).spans.map((x) => `${x.kind}:${text.slice(x.from, x.to)}`);
    assert.deepEqual(spans("downloads >= 5k AND\n  NOT installed calendar order by gain(30d) desc"),
      ["clause:downloads >= 5k", "clause:installed", "neg:NOT installed", "order:order by gain(30d) desc"]);
    assert.deepEqual(core.compileQuery("downloads >= 5k calendar").free, ["calendar"]);
    assert.deepEqual(spans("author ~ brenan rating = on"), ["clause:author ~ brenan", "bad:rating = on"]);

    // syntax colours: each token's role
    const roles = (text) => core.queryHighlight(text).map((x) => `${x.cls || "-"}:${x.text}`).join(" ");
    assert.equal(roles('name = new AND author in (a, "b c") NOT installed cal order by gain(30d) desc'),
      'field:name op:= value:new kw:AND field:author op:in -:( value:a -:, value:b c -:) neg:NOT field:installed -:cal kw:order kw:by field:gain -:( number:30d -:) value:desc');
    assert.equal(roles("released >= startOfMonth(-1)"), "field:released op:>= fn:startOfMonth -:( number:-1 -:)");

    // date functions on date fields: today(), startOfWeek(), startOfMonth(n), startOfYear(), lastSync()
    const local = new Date(now);
    const monthStart = new Date(local.getFullYear(), local.getMonth(), 1).getTime();
    assert.deepEqual(ids("released >= startOfMonth()"), plugins.filter((p) => p.updated >= monthStart).map((p) => p.id));
    assert.deepEqual(ids("released >= startOfMonth(-1) released < startOfMonth()"), plugins.filter((p) => p.updated < monthStart && p.updated >= new Date(local.getFullYear(), local.getMonth() - 1, 1).getTime()).map((p) => p.id));
    assert.deepEqual(ids("released >= startOfYear()"), ["cal", "tasks"]);
    assert.deepEqual(ids("listed >= startOfWeek(-1)"), ["tasks"]);
    assert.equal(new Date(core.QUERY_FUNCS.startofweek(now, 0)).getDay(), 1, "weeks start on Monday");
    assert.deepEqual(core.compileQuery("released > lastSync()", { ...state, lastSync: now - 10 * DAY }, now) && plugins.filter((p) => core.compileQuery("released > lastSync()", { ...state, lastSync: now - 10 * DAY }, now).test(p)).map((p) => p.id), ["cal"]);
    assert.ok(core.compileQuery("downloads > today()", state, now).error, "functions only on date fields");
    assert.ok(core.compileQuery("released > soon()", state, now).error);
    assert.ok(sug("released >= ").includes("startOfMonth()"));
    assert.deepEqual(sug("released >= startOfMonth("), [], "nothing inside a function's ( )");

    // the fields behind the tabs and widgets: releases, incubated/hatched, dismissed, excluded, rise, milestone, text
    const state2 = { ...state, releases: { cal: Array.from({ length: 12 }, (_, k) => now - 3 * DAY - k * 14 * DAY).reverse(), tasks: [now - 200 * DAY, now - 40 * DAY] },
      dismissed: new Set(["old"]), excluded: new Set(["tasks"]), snoozed: {},
      timeline: { ...state.timeline, milestoneSteps: [1000, 10000], milestones: { cal: [now - 400 * DAY, now - 5 * DAY] } } };
    const ids2 = (q) => { const c = core.compileQuery(q, state2, now, true); if (c.error) throw new Error(c.error); return plugins.filter((p) => c.test(p)).map((p) => p.id); };
    assert.deepEqual(ids2("releases(180d) > 9"), ["cal"], "12 update waves in 180 days");
    assert.deepEqual(ids2("releases() >= 1"), ["cal"], "() is 30 days: one release 3 days ago");
    assert.deepEqual(ids2("incubated >= 60d hatched <= 60d"), ["tasks"], "released 40 days ago after a 160-day pause");
    assert.deepEqual(ids2("dismissed"), ["old"]);
    assert.deepEqual(ids2("excluded"), ["tasks"]);
    assert.deepEqual(ids2("snoozed"), []);
    assert.deepEqual(ids2("rise(30d) > 0"), ["cal"]);
    assert.deepEqual(ids2("milestone() <= 30d downloads >= 10k"), ["cal"]);
    assert.deepEqual(ids2("text ~ calendar"), ["cal"]);
    assert.deepEqual(ids2('"calendar"'), ["cal"], "quoted words search the text in Query mode");
    const unknown = core.compileQuery("downloads > 0 NOT bussy", state2, now, true);
    assert.match(unknown.error, /bussy/, "Query mode: a bare unknown word is an error, not a silent text search");
    assert.equal(unknown.at, "downloads > 0 NOT ".length);

    // Basic ↔ Query: the tab's filters as a query, and back
    const settings = { query: "calendar, big tasks", minDownloads: 1000, downloadFilter: { all: true }, extraFilters: { all: { author: "brenan", released: 30, installed: true } }, sortBy: { all: { key: "name", dir: "asc" } } };
    const text = core.filtersToQuery(settings, "all");
    assert.equal(text, '"calendar" AND "big tasks" AND downloads >= 1k AND released <= 30d AND author ~ brenan AND installed\norder by name asc');
    assert.equal(core.filtersToQuery({ ...settings, sortBy: {} }, "all"), '"calendar" AND "big tasks" AND downloads >= 1k AND released <= 30d AND author ~ brenan AND installed', "the tab's own sort isn't written");
    const back = core.queryToFilters(text, { ...settings, query: "", extraFilters: {}, downloadFilter: {}, sortBy: {} }, "all").patch;
    assert.deepEqual(back, { query: "calendar, big tasks", extraFilters: { all: { released: 30, author: "brenan", installed: true } }, sortBy: { all: { key: "name", dir: "asc" } }, downloadFilter: { all: true }, minDownloads: 1000 });
    assert.match(core.queryToFilters("author ~ x OR installed", settings, "all").reason, /OR/);
    assert.match(core.queryToFilters("group in (a) released >= startOfMonth()", settings, "all").reason, /in \(…\).*startOfMonth\(\)/);
    assert.match(core.queryToFilters("NOT installed rating >= 4", settings, "all").reason, /NOT.*rating >= 4/);
    assert.match(core.queryToFilters("released <= 30d", settings, "updated").reason, /released/, "Updated's own days aren't an added filter");
    // a sort from a header or the Sort menu replaces the query's order by, by its field name
    assert.equal(core.withOrder("installed AND downloads >= 1k\norder by downloads desc", "gain(30d)", "asc"), "installed AND downloads >= 1k\norder by gain(30d) asc");
    assert.equal(core.withOrder("", "released", "desc"), "order by released desc");
    assert.equal(core.parseQuery(core.withOrder("tracked", "rise(7d)", "desc")).order.key, "rise(7d)");
    // Basic → Query → Basic untouched: no filter counts as changed (your own sort comes back as your sort)
    for (const mode of ["new", "awakened"]) {
      const st = { query: "", minDownloads: 100, pageQueries: {}, queries: {}, extraFilters: {}, downloadFilter: { awakened: false }, sortBy: { new: { key: "listed", dir: "asc" }, awakened: { key: "incubated", dir: "desc" } } };
      assert.equal(core.changedFilters(st, mode), 0, `${mode}: a saved "off" equal to the default isn't a change`);
      const round = core.queryToBasic(core.joinQuery(core.pageQuery(st, mode), core.filtersToQuery(st, mode)), { ...st, sortBy: {}, downloadFilter: {} }, mode).patch;
      assert.equal(core.changedFilters({ ...st, ...round }, mode), 0, mode);
      assert.deepEqual(round.sortBy[mode], st.sortBy[mode]);
    }
    // what changed, short; a word explained
    assert.equal(core.queryDiff("released <= 14d AND NOT tracked\norder by downloads desc", "released <= 30d AND NOT tracked\norder by downloads desc"), "14d → 30d");
    assert.equal(core.queryDiff("name ~ x", "name ~ x AND installed AND tracked\norder by name asc"), "+2 koşul · sıralama");
    assert.equal(core.queryDiff("NOT tracked", "tracked"), "NOT tracked → tracked");
    const tips = core.queryHighlight("released <= 30d AND NOT tracked AND startOfMonth() order by name desc");
    const tip = (i) => core.queryTip(tips[i], tips[i - 1], NOW, {});
    assert.deepEqual(tip(0), { head: "released", kind: "gün / tarih", body: core.t("query.field.released"), example: "released <= 30d" });
    assert.equal(tip(1).body, core.t("query.tip.daysWithin"), "<= on a days field: at most that long ago");
    assert.equal(tip(2).body, "30 gün");
    assert.equal(tip(3).body, core.t("query.tip.and"));
    assert.equal(tip(4).head, "NOT");
    assert.equal(tip(5).kind, "evet/hayır");
    assert.equal(tip(7).head, "startOfMonth()");
    assert.equal(tip(7).example, core.t("query.tip.now", { date: core.dayString(new Date(new Date(NOW).getFullYear(), new Date(NOW).getMonth(), 1).getTime()) }));
    assert.equal(tip(10).head, "order by");
    // a view saved before 0.10 (a tab + filters) becomes the query it meant
    const legacy = core.legacyViewQuery({ mode: "new", filters: { query: "kanban", extraFilters: { new: { author: "abbys" } } } }, { pageQueries: {}, sortBy: {} });
    assert.equal(legacy, 'listed <= 14d AND NOT tracked AND "kanban" AND author ~ abbys\norder by listed desc');
    const starters = core.queryStarters("downloads >= 1k");
    assert.equal(starters[0].insert, "downloads >= 1k");
    assert.ok(starters[0].head && starters[1].head && starters.length === 1 + core.QUERY_PRESETS.length, "your filters, then the presets");
    assert.equal(starters[1].insert, core.QUERY_PRESETS[0].query);
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
    assert.equal(core.modeOptions(settings, "new").filterDownloads, true);      // your choice, on New too (the page query holds the defaults)
    assert.equal(core.modeOptions({ ...settings, downloadFilter: { updated: false } }, "updated").filterDownloads, false);   // saved
    assert.equal(core.modeOptions(settings, "changed").filterDownloads, false); // default
    assert.deepEqual(["sort", "sortDir"].map((k) => core.modeOptions(settings, "all")[k]), ["name", "desc"]);
    assert.deepEqual(["sort", "sortDir"].map((k) => core.modeOptions(settings, "new")[k]), ["listed", "desc"]);
    assert.deepEqual(["sort", "sortDir"].map((k) => core.modeOptions(settings, "tracked")[k]), ["rating", "desc"]);
    const rated = [{ id: "b", name: "B" }, { id: "a", name: "A" }, { id: "c", name: "C" }];
    const notes = new Map([["c", { rating: 5 }], ["b", { rating: 3 }]]);
    assert.deepEqual(core.sortRows(rated, "rating", "desc", { notes }).map((p) => p.id), ["c", "b", "a"]);
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
    assert.equal(rhythm(monthly.map((m) => m - 2 * Y)), "no release for a year | before: every ~30 days", "went quiet two years ago");
    assert.equal(rhythm([now - 90 * D, now - 60 * D, now - 30 * D]), "every ~45 days | 3 releases in 90 days", "young: its own span");
    assert.equal(rhythm([now - 500 * D, now - 300 * D, now - 100 * D]), "every 6 months | 2 releases in 12 months");
    assert.equal(rhythm([now - 5 * Y]), "no release for a year | its only release", "never a dash: one release says so");
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
