// End-to-end without network: fixture catalog + snapshots, jsdom for the view, in-memory vault.
const assert = require("assert/strict");
const { JSDOM } = require("jsdom");

// ── DOM with Obsidian's element helpers
const { window } = new JSDOM("<!doctype html><body></body>");
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Event = window.Event;
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.window = window;
const P = window.HTMLElement.prototype;
P.createEl = function (tag, o = {}) {
  const el = window.document.createElement(tag);
  if (o.text) el.textContent = o.text;
  if (o.cls) el.className = o.cls;
  for (const k of ["href", "type", "value", "placeholder"]) if (o[k] != null) { el.setAttribute(k, o[k]); el[k] = o[k]; }
  for (const [k, v] of Object.entries(o.attr || {})) el.setAttribute(k, v);
  this.appendChild(el);
  return el;
};
P.createDiv = function (o = {}) { return this.createEl("div", typeof o === "string" ? { cls: o } : o); };
P.createSpan = function (o = {}) { return this.createEl("span", o); };
P.empty = function () { this.innerHTML = ""; };
P.setText = function (text) { this.textContent = text; };
P.addClass = function (c) { this.classList.add(c); };
P.hasClass = function (c) { return this.classList.contains(c); };
P.toggleClass = function (c, on) { this.classList.toggle(c, on); };
globalThis.createDiv = (o = {}) => window.document.body.createDiv(o);
Object.defineProperty(P, "scrollHeight", { get() { return this.textContent.length > 80 ? 90 : 40; } });  // jsdom has no layout
Object.defineProperty(P, "clientHeight", { get() { return 40; } });

// ── Fake obsidian module
const Module = require("module");
const fake = require("./fake-obsidian");
fake.ItemView = class {
  constructor(leaf) { this.leaf = leaf; this.app = leaf.app; this.contentEl = window.document.createElement("div"); }
  registerDomEvent(el, type, fn) { el.addEventListener(type, fn); }
};
fake.PluginSettingTab = class { constructor(app) { this.app = app; this.containerEl = window.document.createElement("div"); } };
const component = (el, tag) => {
  const input = el.createEl(tag);
  const c = {
    inputEl: input,
    setValue(v) { input.value = v; return c; }, getValue() { return input.value; },
    setPlaceholder() { return c; }, onChange(f) { input.onchange = () => f(input.value); return c; },
    addOption(v, text) { input.createEl("option", { value: v, text }); return c; },
    setButtonText(text) { input.textContent = text; return c; }, setCta() { input.classList.add("mod-cta"); return c; },
    onClick(f) { input.onclick = f; return c; }, setDisabled(d) { input.disabled = d; return c; },
    setWarning() { input.classList.add("mod-warning"); return c; },
  };
  return c;
};
fake.Setting = class {
  constructor(el) { this.el = el.createDiv({ cls: "setting" }); this.controlEl = this.el.createDiv({ cls: "control" }); }
  setName(text) { this.el.createDiv({ cls: "name", text }); return this; }
  setDesc(text) { this.el.createDiv({ cls: "desc", text }); return this; }
  setHeading() { this.el.classList.add("heading"); return this; }
  addText(fn) { fn(component(this.controlEl, "input")); return this; }
  addDropdown(fn) { fn(component(this.controlEl, "select")); return this; }
  addButton(fn) { fn(component(this.controlEl, "button")); return this; }
};
const opened = [];
const modals = [];
fake.Modal = class {
  constructor(app) {
    this.app = app;
    this.modalEl = window.document.createElement("div");
    this.titleEl = this.modalEl.createDiv({ cls: "modal-title" });
    this.contentEl = this.modalEl.createDiv({ cls: "modal-content" });
  }
  open() { modals.push(this); this.onOpen?.(); }
  close() { this.onClose?.(); }
};
fake.SuggestModal = class {
  constructor(app) {
    this.app = app;
    this.modalEl = window.document.createElement("div");                 // modal → input container → input
    this.inputEl = this.modalEl.createDiv({ cls: "prompt-input-container" }).createEl("input");
  }
  setPlaceholder() {}
  open() { opened.push(this); this.onOpen?.(); }
};
const load = Module._load;
Module._load = function (req, ...rest) { return req === "obsidian" ? fake : load.call(this, req, ...rest); };
const PluginRadar = require("../main.js");
const { core } = PluginRadar;
const $ = (root, sel) => root.querySelector(sel);
const $$ = (root, sel) => [...root.querySelectorAll(sel)];
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// ── Fixture: 4 plugins, 3 snapshots
const DAY = core.constants.DAY_MS;
const NOW = Date.now();
const ago = (d) => NOW - d * DAY;
const listing = [
  { id: "homepage", name: "Homepage", author: "mirnovov", repo: "mirnovov/obsidian-homepage", description: "Open a note, base, or workspace on startup, or set it for quick access later." },
  { id: "dataview", name: "Dataview", author: "Michael Brenan", repo: "blacksmithgu/obsidian-dataview", description: "Complex data views for the data-obsessed." },
  { id: "busy", name: "Busy Plugin", author: "Bee", repo: "bee/busy", description: "Releases all the time." },
  { id: "fresh", name: "Fresh Plugin", author: "New", repo: "new/fresh", description: "Brand new." },
];
const stat = (downloads, updated) => ({ downloads, updated, "1.0.0": 1 });
const snapshots = [
  { sha: "a".repeat(40), date: ago(60), stats: { homepage: stat(1000, ago(120)), dataview: stat(5000, ago(400)), busy: stat(300, ago(61)) } },
  { sha: "b".repeat(40), date: ago(10), stats: { homepage: stat(1100, ago(120)), dataview: stat(5100, ago(400)), busy: stat(320, ago(11)) } },
  { sha: "c".repeat(40), date: ago(1), stats: { homepage: stat(1200, ago(3)), dataview: stat(5200, ago(400)), busy: stat(350, ago(2)), fresh: stat(5, ago(2)) } },
];
fake.network.handlers.push(
  ["https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json", () => ({ status: 200, json: listing })],
  ["https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugin-stats.json", () => ({ status: 200, json: snapshots[2].stats })],
  ["https://api.github.com/repos/obsidianmd/obsidian-releases/commits", ({ url }) => {
    const since = Date.parse(new URL(url).searchParams.get("since"));
    const list = snapshots.filter((s) => s.date >= since).reverse().map((s) => ({ sha: s.sha, commit: { committer: { date: new Date(s.date).toISOString() } } }));
    return { status: 200, json: list };
  }],
  ["https://raw.githubusercontent.com/obsidianmd/obsidian-releases/", ({ url }) => ({ status: 200, json: snapshots.find((s) => url.includes(s.sha)).stats })],
  ["https://raw.githubusercontent.com/", () => ({ status: 200, text: "# Readme\nUse #tag here.\n```\n#keep\n```" })],
);

const tests = {
  async "data from the newest other install (community-radar) is imported once; old notes get H1 headings"(ctx) {
    const app = fake.makeApp();
    app.vault.adapter.disk.set(".obsidian/plugins/community-radar/data.json", JSON.stringify({
      settings: { folder: "Eklentiler", mode: "updated", days: 14 }, excluded: { busy: "2026-10-01" }, translations: {},
      migrations: {},
    }));
    app.vault.adapter.disk.set(".obsidian/plugins/plugin-discovery-tracker/data.json", JSON.stringify({
      settings: { folder: "Older" }, excluded: { stale: "2026-01-01" }, translations: {}, migrations: {},
    }));
    app.vault.files.set("Eklentiler/Homepage.md",
      `---\nplugin_id: homepage\ngroup: ai\nreviewed: '${core.dayString(ago(20))}'\n---\nx\n\n## Notlarım\nmine\n\n## README\n${core.constants.LEGACY_README_START}\n${core.constants.LEGACY_README_END}\n`);
    app.secretStorage.setSecret("plugin-tracker-anthropic-key", "sk-legacy");
    const plugin = new PluginRadar(app, { dir: ".obsidian/plugins/plugin-radar" });
    await plugin.onload();
    await tick(10);
    assert.equal(plugin.data.settings.folder, "Eklentiler");
    assert.deepEqual(Object.keys(plugin.data.excluded), ["busy"]);
    const homepage = app.vault.files.get("Eklentiler/Homepage.md");
    assert.ok(homepage.includes("\n# Notlarım\nmine"));
    assert.ok(homepage.includes(`\n# README\n${core.constants.README_START}\n${core.constants.README_END}`), "markers migrated");
    assert.ok(!homepage.includes("<!--"));
    assert.equal(app.secretStorage.getSecret("anthropic-api-key"), "sk-legacy");
    assert.deepEqual(plugin.notes.index.get("homepage").groups, ["ai"]);
    const migrated = app.vault.files.get("Eklentiler/Homepage.md");
    assert.match(migrated, /\ngroups:\n\s+- ai\n/);                 // `group: ai` became a list…
    assert.ok(!/\ngroup:/.test(migrated));                            // …and the old property is gone
    Object.assign(ctx, { app, plugin });
  },

  async "notes are read from the notes folder only (no vault-wide listing), subfolders included"({ app, plugin }) {
    const { getMarkdownFiles, getFiles } = app.vault;
    app.vault.getMarkdownFiles = app.vault.getFiles = () => { throw new Error("vault-wide listing"); };
    app.vault.files.set("Eklentiler/arşiv/Dataview.md", "---\nplugin_id: dataview\ngroup: eski\n---\n");
    app.vault.files.set("Başka/Not.md", "---\nplugin_id: outside\n---\n");
    try {
      plugin.notes.rebuild();
      assert.deepEqual([...plugin.notes.index.keys()].sort(), ["dataview", "homepage"]);  // "outside" isn't in the folder
    } finally {
      Object.assign(app.vault, { getMarkdownFiles, getFiles });
      app.vault.files.delete("Eklentiler/arşiv/Dataview.md");
      plugin.notes.rebuild();
    }
  },

  async "refresh + history: first-seen, gaps and modes"({ plugin }) {
    await plugin.refresh();
    await plugin.buildHistory(true);
    const { timeline } = plugin;
    assert.equal(timeline.firstSeen.fresh, ago(1));       // appeared in the last snapshot
    assert.equal(timeline.firstSeen.homepage, 0);         // already there at the start
    const homepage = plugin.pluginById("homepage");
    assert.equal(core.dormantDays(timeline.releases, homepage), 117);
    const counts = core.modeCounts(plugin.state(), { ...plugin.data.settings, days: 14, query: "" }, NOW);
    assert.equal(counts.new, 1);                          // fresh
    assert.equal(counts.changed, 1);                      // homepage: reviewed 20 days ago, released 3 days ago
  },

  async "view: tabs with tooltips, menu chips, rows, no excluded/tracked rows"(ctx) {
    const { app, plugin } = ctx;
    const view = plugin.viewFactory({ app });
    app.workspace.getLeavesOfType = () => [{ view }];
    plugin.data.settings.mode = "updated";
    plugin.data.settings.minDownloads = 0;
    view.render();
    const el = view.contentEl;
    assert.equal($$(el, ".pdt-tab").length, 7);
    assert.ok($$(el, ".pdt-tab").every((tab) => tab.getAttribute("data-tooltip")));
    const names = $$(el, ".pdt-name").map((a) => a.textContent);
    assert.deepEqual(names, ["Dataview", "Fresh Plugin"].filter((n) => names.includes(n)));  // busy excluded, homepage tracked
    assert.ok(!names.includes("Busy Plugin") && !names.includes("Homepage"));
    const sort = $$(el, ".pdt-chip.is-menu").find((c) => c.textContent.startsWith("Sırala") || c.textContent.startsWith("Sort"));
    fake.menus.length = 0;
    sort.onclick();
    assert.deepEqual(fake.menus[0].items.map((i) => i.checked), [true, false, false, false, false]);   // same five sorts on every tab
    await fake.menus[0].items[1].click();
    assert.deepEqual(plugin.data.settings.sortBy.updated, { key: "updated", dir: "desc" });
    assert.ok($(el, ".pdt-icon").classList.contains("clickable-icon"));

    // All tab: tracked Homepage is listed with its note badge; four sorts; back to Updated shows a valid sort
    await view.update("mode", "all");
    const allNames = $$(el, ".pdt-name").map((a) => a.textContent);
    assert.ok(allNames.includes("Homepage") && !allNames.includes("Busy Plugin"));
    const homepageRow = $$(el, ".pdt-row").find((r) => $(r, ".pdt-name").textContent === "Homepage");
    assert.ok($(homepageRow, ".pdt-badge.is-note"));
    fake.menus.length = 0;
    const sortChip = () => $$(el, ".pdt-chip.is-menu").find((c) => /^(Sırala|Sort)/.test(c.textContent));
    sortChip().onclick();
    assert.equal(fake.menus[0].items.length, 5);
    await fake.menus[0].items[2].click();                       // name
    assert.deepEqual($$(el, ".pdt-name").map((a) => a.textContent), [...allNames].sort((a, b) => a.localeCompare(b, core.t("locale"))));
    await view.update("mode", "updated");
    const chipText = sortChip().textContent;
    assert.ok(chipText.endsWith(core.t("sort.updated")), chipText);   // each tab keeps its own sort
    await view.updateTab("sortBy", { key: "downloads", dir: "desc" });
    ctx.view = view;
  },

  async "filters: Downloads chip toggles per tab, typed days, sort direction, regex search"({ plugin, view }) {
    const el = view.contentEl;
    const settings = plugin.data.settings;
    const names = () => $$(el, ".pdt-name").map((a) => a.textContent);
    await view.update("mode", "all");
    settings.minDownloads = 1000;
    view.render();
    const chip = () => $(el, ".pdt-chip.is-toggle");
    assert.ok(chip().classList.contains("is-on"));
    assert.ok(!names().includes("Fresh Plugin"));                              // 5 downloads
    $(chip(), ".pdt-toggle").onclick();
    await tick();
    assert.ok(!chip().classList.contains("is-on"));
    assert.ok(names().includes("Fresh Plugin"));
    assert.equal(settings.downloadFilter.all, false);
    assert.equal(core.modeOptions(settings, "updated").filterDownloads, true);   // other tabs keep theirs
    const min = $(chip(), "input");
    min.value = "2000";
    await min.onchange();
    assert.ok(chip().classList.contains("is-on"));                             // typing a value turns it on
    assert.equal(settings.minDownloads, 2000);

    await view.update("mode", "updated");
    const savedDays = settings.days;
    const typeDays = async (value) => { const input = $(el, ".pdt-chip.is-number input"); input.value = value; await input.onchange(); };
    await typeDays("1");
    assert.equal(settings.days, 1);
    await typeDays("999");
    assert.equal(settings.days, 365);                                          // clamped
    await typeDays("");
    assert.equal(settings.days, 365);                                          // empty: unchanged
    fake.menus.length = 0;
    $(el, ".pdt-chip.is-number .pdt-chip-caret").onclick();
    assert.equal(fake.menus[0].items[0].title, core.t("filter.days", { n: 1 }));
    await view.update("days", savedDays);

    await view.update("mode", "all");
    settings.minDownloads = 0;
    view.render();
    const before = names();
    const dir = core.modeOptions(settings, "all").sortDir;
    $(el, ".pdt-sort-dir").onclick();
    await tick();
    assert.deepEqual(names(), [...before].reverse());
    assert.notEqual(settings.sortBy.all.dir, dir);
    await view.updateTab("sortBy", { key: "downloads", dir: "desc" });
    const sortedNames = names();

    const search = $(el, ".pdt-search input");
    search.value = "/home(/";
    search.oninput();
    assert.ok($(el, ".pdt-search").classList.contains("is-invalid"));
    settings.query = search.value;
    view.refresh();
    assert.ok($(el, ".pdt-query.is-invalid"));
    assert.deepEqual(names(), sortedNames);                                    // invalid regex: unfiltered
    search.value = "/^home|^data/";
    search.oninput();
    assert.ok($(el, ".pdt-search").classList.contains("is-regex"));
    settings.query = search.value;
    view.refresh();
    assert.deepEqual(names().sort(), ["Dataview", "Homepage"]);
    await tick(300);                                                         // let the debounced search settle first
    settings.query = "";
    view.render();
  },

  async "row actions: star creates a note with README; double click runs once"({ app, plugin, view }) {
    const el = view.contentEl;
    let calls = 0;
    const original = plugin.toggleFavorite.bind(plugin);
    plugin.toggleFavorite = async (p) => { calls++; await tick(20); return original(p); };
    const row = $$(el, ".pdt-row").find((r) => $(r, ".pdt-name").textContent === "Fresh Plugin");
    const star = row.querySelector('[data-icon="star"]');
    await Promise.all([star.onclick(), star.onclick()]);
    await tick(20);
    assert.equal(calls, 1);
    const note = app.vault.files.get("Eklentiler/Fresh Plugin.md");
    assert.ok(note.includes("favorite: true"));
    assert.match(note, /obsidian: ["']\[plugin\]\(obsidian:\/\/show-plugin\?id=fresh\)["']/);  // quoted, so YAML keeps it a string
    assert.ok(note.includes("\\#tag") && note.includes("\n#keep\n"), "tags escaped outside code only");
    plugin.toggleFavorite = original;
  },

  async "model picker: filters as you type, offers typed aliases, latest-only toggle"({ app, plugin }) {
    plugin.data.settings.provider = "openrouter";
    app.secretStorage.setSecret("openrouter-api-key", "or-key");
    const tab = plugin.settingTab;
    const pick = tab.pickModel(plugin.data.settings, () => plugin.saveData(plugin.data));
    await tick(10);
    const modal = opened.at(-1);
    assert.deepEqual(modal.getSuggestions("latest").map((m) => m.id), ["latest", "model-b-latest"]);
    $(modal.modalEl, ".pdt-model-bar .pdt-chip").onclick();
    assert.deepEqual(modal.getSuggestions("").map((m) => m.id), ["model-b-latest"]);
    const alias = modal.getSuggestions("~google/gemini-flash-latest")[0];
    assert.ok(alias.custom);
    modal.onChooseSuggestion(alias);
    modal.onClose();
    await pick;
    assert.equal(plugin.data.settings.model, "~google/gemini-flash-latest");
  },

  async "translation: one request per batch, key only in header, cached"({ app, plugin }) {
    fake.network.calls.length = 0;
    const rows = plugin.catalog.plugins.slice(0, 3);
    assert.equal(await plugin.translateRows(rows), true);
    const llm = fake.network.calls.filter((c) => c.url.includes("openrouter"));
    assert.equal(llm.length, 1);
    assert.equal(llm[0].body.model, "~google/gemini-flash-latest");
    assert.equal(llm[0].headers.Authorization, "Bearer or-key");
    assert.ok(!JSON.stringify(plugin._data).includes("or-key"));
    assert.equal(plugin.cachedTranslation(rows[0]), `TR: ${rows[0].description}`);
    fake.network.calls.length = 0;
    await plugin.translateRows(rows);
    assert.equal(fake.network.calls.length, 0);
    assert.ok((await plugin.translator.test()).startsWith("TR: "));
  },

  async "status line: last sync, what the sync brought, a labelled Sync button"({ plugin, view }) {
    const el = view.contentEl;
    plugin.catalog.plugins = plugin.catalog.plugins.filter((p) => p.id !== "fresh");  // pretend "fresh" is new
    await plugin.refresh();
    view.refresh();
    const status = $(el, ".pdt-status").textContent;
    assert.ok(status.includes(core.t("status.lastSync", { time: "", age: core.t("age.justNow") }).split(" · ")[0]), status);
    assert.equal($(el, ".pdt-delta").textContent, core.t("status.delta", { added: 1, updated: 0 }));
    const sync = $(el, ".pdt-sync");
    assert.equal(sync.textContent, core.t("status.sync"));
    assert.ok(!sync.classList.contains("is-syncing"));
  },

  async "sync frequency: no request when manual or not due; quiet sync when due"({ plugin }) {
    const settings = plugin.data.settings;
    const syncs = () => fake.network.calls.filter((c) => c.url.endsWith("community-plugins.json")).length;
    fake.network.calls.length = 0;
    const notices = fake.Notice.all.length;
    settings.syncHours = 0;
    plugin.catalog.fetchedAt = NOW - 30 * DAY;
    await plugin.syncIfDue();
    assert.equal(syncs(), 0);                              // manual
    settings.syncHours = 6;
    plugin.catalog.fetchedAt = Date.now() - 2 * 3600_000;
    await plugin.syncIfDue();
    assert.equal(syncs(), 0);                              // 2 h old, not due
    plugin.catalog.fetchedAt = Date.now() - 7 * 3600_000;
    await plugin.syncIfDue();
    assert.equal(syncs(), 1);                              // due
    assert.equal(fake.Notice.all.length, notices);         // quiet: no notice
    settings.syncHours = 24;
  },

  async "README: link opens the note's README, creating the note; opening a stale note refreshes it"({ app, plugin, view }) {
    const el = view.contentEl;
    await view.update("mode", "all");
    const row = $$(el, ".pdt-row").find((r) => $(r, ".pdt-name").textContent === "Dataview");
    assert.ok(!$(row, ".pdt-author"));                     // the README link took the author's place
    app.workspace.opened.length = 0;
    await $(row, ".pdt-readme").onclick({ preventDefault() {} });
    await tick(20);
    assert.deepEqual(app.workspace.opened, [{ link: "Eklentiler/Dataview.md#README", pane: "tab" }]);
    const path = "Eklentiler/Dataview.md";
    assert.ok(app.vault.files.get(path).includes("README · blacksmithgu/obsidian-dataview"));

    const readmes = () => fake.network.calls.filter((c) => c.url.includes("blacksmithgu/obsidian-dataview")).length;
    const file = app.vault.getAbstractFileByPath(path);
    fake.network.calls.length = 0;
    await app.workspace.trigger("file-open", file);
    assert.equal(readmes(), 0);                            // README matches the current version
    plugin.pluginById("dataview").version = "9.9.9";
    await app.workspace.trigger("file-open", file);
    assert.equal(readmes(), 1);
    assert.equal(core.readmeVersion(app.vault.files.get(path)), "9.9.9");
    plugin.data.settings.readmeMode = "manual";
    plugin.pluginById("dataview").version = "10.0.0";
    await app.workspace.trigger("file-open", file);
    assert.equal(readmes(), 1);                            // manual mode: untouched
    plugin.data.settings.readmeMode = "open";
  },

  async "group window: ★ closest preselected, AI chips (5 + more), new name, Confirm writes the groups list"({ app, plugin }) {
    const target = plugin.pluginById("dataview");
    const tick2 = () => tick(10);
    fake.network.prompts.length = 0;
    const pick = plugin.chooseGroup(target);
    await tick2();
    const modal = modals.at(-1);
    const el = modal.contentEl;
    const section = (i) => $$(el, ".pdt-gm-section")[i];
    const chip = (name, i = 1) => [...section(i).querySelectorAll(".pdt-gchip")].find((c) => c.textContent.startsWith(name));   // 1: your groups
    assert.ok(fake.network.prompts[0].includes('"name":"ai"'), "existing groups go into the prompt");
    assert.ok(chip("ai").classList.contains("is-on"), "the model picked an existing group: it is starred and selected");
    assert.ok($(chip("ai"), ".pdt-gchip-star"));
    const aiChips = () => section(2).querySelectorAll(".pdt-gchip");
    assert.equal(aiChips().length, 5);                                  // 6 new suggestions: 5 shown…
    $(el, ".pdt-gm-more").onclick();
    assert.equal(aiChips().length, 6);                                  // …and the rest after "+1 more"
    chip("Planning", 2).onclick();
    const input = $(el, ".pdt-gm-new input");
    input.value = "  my   tools ";
    input.oninput();
    input.onkeydown({ key: "Enter", preventDefault() {} });
    assert.deepEqual(modal.selected, ["ai", "Planning", "my tools"]);
    $(el, ".pdt-gm-foot .mod-cta").onclick();
    await pick;
    await tick2();
    assert.deepEqual(plugin.notes.index.get("dataview").groups, ["ai", "Planning", "my tools"]);
    assert.match(app.vault.files.get("Eklentiler/Dataview.md"), /\ngroups:\n\s+- ai\n\s+- Planning\n\s+- my tools\n/);

    fake.network.prompts.length = 0;                                    // a second look reuses the saved suggestions
    plugin.chooseGroup(target);
    await tick2();
    assert.equal(fake.network.prompts.length, 0);
    assert.deepEqual(modals.at(-1).selected, ["ai", "Planning", "my tools"]);   // current groups, not the suggestion
    modals.at(-1).close();
  },

  async "batch grouping: one request for the ungrouped, several picks per plugin, nothing saved before Accept"({ app, plugin }) {
    await plugin.track(plugin.pluginById("busy"), {});
    await plugin.track(plugin.pluginById("fresh"), {});
    const ungrouped = plugin.ungrouped().map((p) => p.id).sort();
    assert.ok(ungrouped.includes("busy") && ungrouped.includes("fresh"));
    fake.network.prompts.length = 0;
    const run = plugin.groupUngrouped();
    await tick(20);
    assert.equal(fake.network.prompts.length, 1);                       // all of them in one request
    const modal = modals.at(-1);
    const rows = $$(modal.contentEl, ".pdt-batch-row");
    assert.equal(rows.length, ungrouped.length);
    const before = app.vault.files.get("Eklentiler/Busy Plugin.md");
    const busy = rows[modal.rows.findIndex((r) => r.plugin.id === "busy")];
    $$(busy, ".pdt-gchip").find((c) => c.textContent.startsWith("Productivity")).onclick();
    assert.equal(app.vault.files.get("Eklentiler/Busy Plugin.md"), before);   // nothing written yet
    assert.match($(modal.contentEl, ".pdt-gm-foot .mod-cta").textContent, new RegExp(`\\(${ungrouped.length}\\)`));
    $(modal.contentEl, ".pdt-gm-foot .mod-cta").onclick();
    await run;
    assert.deepEqual(plugin.notes.index.get("busy").groups, ["ai", "Productivity"]);
    assert.deepEqual(plugin.notes.index.get("fresh").groups, ["ai"]);
    assert.equal(plugin.ungrouped().length, 0);
  },

  async "similar plugins: strip under a row, local words only"({ plugin, view }) {
    const index = core.textIndex(plugin.catalog.plugins);
    assert.ok(index.byId.get("homepage").has("startup"));
    await view.update("mode", "all");
    const row = $$(view.contentEl, ".pdt-row").find((r) => $(r, ".pdt-name").textContent === "Dataview");
    $(row, ".pdt-similar-link").onclick({ preventDefault() {} });
    const strip = $$(view.contentEl, ".pdt-row").find((r) => $(r, ".pdt-name").textContent === "Dataview").querySelector(".pdt-similar");
    assert.ok(strip, "strip opened");
    assert.ok($(strip, ".pdt-gm-note") || $(strip, ".pdt-gchip"));
  },

  async "Tracked tab: group chips, sections per group (a plugin in two groups shows twice), status and rating"({ app, plugin, view }) {
    const el = view.contentEl;
    const settings = plugin.data.settings;
    await plugin.track(plugin.pluginById("homepage"), { groups: ["ai", "Planning"] });
    await view.update("mode", "tracked");
    const chips = $$(el, ".pdt-groupbar .pdt-gchip").map((c) => c.firstChild.nextSibling?.textContent || c.textContent);
    assert.ok(chips.includes("Planning") && chips.includes("ai"));
    const sections = () => $$(el, ".pdt-section").map((s) => [$(s, ".pdt-section-name").textContent, $$(s, ".pdt-name").map((a) => a.textContent)]);
    const byName = Object.fromEntries(sections());
    assert.ok(byName.ai.includes("Homepage") && byName.Planning.includes("Homepage"), "in both of its groups");
    const ai = $$(el, ".pdt-section").find((s) => $(s, ".pdt-section-name").textContent === "ai");
    $(ai, ".pdt-section-head").onclick();
    assert.equal($(($$(el, ".pdt-section").find((s) => $(s, ".pdt-section-name").textContent === "ai")), ".pdt-row"), null);   // folded
    view.collapsed.clear();

    // a group badge on a row opens the Tracked tab on that group
    await view.update("mode", "all");
    const badge = $$(el, ".pdt-badge.is-group").find((b) => b.textContent === "Planning");
    await badge.onclick();
    assert.equal(settings.mode, "tracked");
    assert.equal(settings.trackedGroup, "Planning");
    view.render();
    assert.ok($$(el, ".pdt-name").map((a) => a.textContent).includes("Homepage"));
    assert.ok($$(el, ".pdt-name").every((a) => plugin.notes.index.get(a.closest(".pdt-row").dataset.id).groups.includes("Planning")));

    // status and rating: chosen from a menu, written to the note, validated on read
    const row = $$(el, ".pdt-row").find((r) => $(r, ".pdt-name").textContent === "Homepage");
    fake.menus.length = 0;
    $(row, ".pdt-badge.is-status").onclick();
    await fake.menus[0].items.find((i) => i.title === core.t("pstatus.using")).click();
    fake.menus.length = 0;
    const homepageRow = () => $$(el, ".pdt-row").find((r) => $(r, ".pdt-name").textContent === "Homepage");
    $(homepageRow(), ".pdt-badge.is-rating").onclick();
    await fake.menus[0].items.find((i) => i.title === "★★★★☆").click();
    const note = app.vault.files.get(plugin.notes.index.get("homepage").path);
    assert.match(note, /\nstatus: using\n/);
    assert.match(note, /\nrating: 4\n/);
    assert.equal(plugin.notes.index.get("homepage").rating, 4);
    assert.equal(core.noteFromFrontmatter("x", { plugin_id: "x", status: "maybe", rating: 9 }).status, "");
    assert.equal(core.noteFromFrontmatter("x", { plugin_id: "x", status: "maybe", rating: 9 }).rating, 0);
    settings.trackedStatus = "using";
    settings.trackedGroup = "";
    view.render();
    assert.deepEqual($$(el, ".pdt-name").map((a) => a.textContent), ["Homepage", "Homepage"]);   // its two sections
    fake.menus.length = 0;
    $(homepageRow(), ".pdt-badge.is-status").onclick();
    await fake.menus[0].items[0].click();                                  // "No status" removes the property
    assert.ok(!/\nstatus:/.test(app.vault.files.get(plugin.notes.index.get("homepage").path)));
    Object.assign(settings, { trackedStatus: "", trackedGroup: "" });
    await view.update("mode", "all");
  },

  async "ignore, hide until next release, Ignored list with Restore and restore-all; ⋮ menu"({ plugin, view }) {
    const el = view.contentEl;
    const names = () => $$(el, ".pdt-name").map((a) => a.textContent);
    const dataview = plugin.pluginById("dataview");
    await plugin.snooze(dataview);
    view.refresh();
    assert.ok(!names().includes("Dataview"));
    assert.ok(core.isSnoozed(dataview, plugin.data.snoozed));
    assert.ok(!core.isSnoozed({ ...dataview, updated: dataview.updated + 1 }, plugin.data.snoozed), "a newer release brings it back");

    const menu = new fake.Menu();
    view.onPaneMenu(menu, "more-options");
    const titles = menu.items.map((i) => i.title);
    assert.ok(titles.includes(core.t("list.ignoredTitle", { n: plugin.ignoredCount() })));
    await menu.items.find((i) => i.title.startsWith(core.t("list.ignoredTitle", { n: "" }).split("(")[0])).click();
    assert.equal(plugin.data.settings.mode, "ignored");
    const listed = names();
    assert.ok(listed.includes("Dataview") && listed.includes("Busy Plugin"), "snoozed and ignored together");
    assert.ok($$(el, ".pdt-badge.is-snoozed").length >= 1);
    const row = $$(el, ".pdt-row").find((r) => $(r, ".pdt-name").textContent === "Dataview");
    await row.querySelector('[data-icon="undo-2"]').onclick();
    await tick();
    assert.ok(!("dataview" in plugin.data.snoozed));
    assert.ok(!names().includes("Dataview"));

    await plugin.snooze(dataview);
    view.render();
    const all = $(el, ".pdt-banner .mod-warning");
    await all.onclick();                                                    // first click only arms it
    assert.ok(plugin.ignoredCount() >= 2);
    await all.onclick();
    assert.equal(plugin.ignoredCount(), 0);
    assert.equal(Object.keys(plugin.data.excluded).length, 0);
    await plugin.exclude(plugin.pluginById("busy"));                        // back as the earlier tests expect
    await view.update("mode", "all");
  },

  async "keyboard: j/k move between rows, f stars the focused row, keys in the search box are left alone"({ plugin, view }) {
    const el = view.contentEl;
    window.document.body.appendChild(el);
    view.registerDomEvent(el, "keydown", (event) => view.onKey(event));   // onOpen isn't run in these tests
    const press = async (target, key) => {
      const event = new window.KeyboardEvent("keydown", { key, bubbles: true });
      target.dispatchEvent(event);
      await tick(20);
    };
    const rows = $$(el, ".pdt-row");
    rows[0].focus();
    await press(rows[0], "j");
    assert.equal(window.document.activeElement, rows[1]);
    const id = rows[1].dataset.id;
    const before = Boolean(plugin.notes.index.get(id)?.favorite);
    await press(rows[1], "f");
    assert.equal(Boolean(plugin.notes.index.get(id)?.favorite), !before);
    assert.equal(window.document.activeElement?.dataset.id, id);            // focus stays on the row
    await press(window.document.activeElement, "f");                        // back as it was
    const search = $(el, ".pdt-search input");
    const mode = plugin.data.settings.mode;
    await press(search, "j");
    assert.equal(plugin.data.settings.mode, mode);
    el.remove();
  },

  async "settings: keychain picker, model buttons, lists"({ plugin }) {
    plugin.settingTab.display();
    const el = plugin.settingTab.containerEl;
    const names = $$(el, ".name").map((n) => n.textContent);
    assert.ok(names.some((n) => n.includes("~google/gemini-flash-latest")));
    assert.ok($$(el, "button").some((b) => b.classList.contains("mod-cta")));
    assert.ok($$(el, ".desc").some((d) => d.textContent.includes("openrouter-api-key")));
    const values = (select) => [...select.options].map((o) => o.value).join();
    const selects = $$(el, "select");
    assert.equal(selects.find((d) => values(d) === "0,6,24,168").value, "24");
    assert.ok(selects.some((d) => values(d) === "open,sync,manual"));
    assert.ok(!$$(el, "button").some((b) => b.textContent === "Restore"), "no per-plugin list in settings");
    const manage = $$(el, "button").filter((b) => b.textContent === core.t("set.manage"));
    assert.equal(manage.length, 2);
  },

  async "Bases view: created next to the notes folder, reset from settings, opened"({ app, plugin }) {
    const YAML = require("yaml");
    const tab = plugin.settingTab;
    const baseButton = () => $$(tab.containerEl, "button").find((b) => [core.t("set.baseCreate"), core.t("set.baseReset")].includes(b.textContent));
    tab.display();
    assert.equal(baseButton().textContent, core.t("set.baseCreate"));
    app.workspace.opened.length = 0;
    await baseButton().onclick();
    const base = YAML.parse(app.vault.files.get("Eklentiler.base"));
    assert.deepEqual(base.filters, { and: ['file.inFolder("Eklentiler")'] });
    assert.deepEqual(base.views.map((v) => v.name), ["base.all", "base.starred", "base.ungrouped"].map((k) => core.t(k)));
    assert.deepEqual(base.views[2].filters, { and: ["groups.isEmpty()"] });   // Bases can't split a list into groups: no "By group"
    assert.deepEqual(app.workspace.opened, [{ link: "Eklentiler.base", pane: "tab" }]);

    app.vault.files.set("Eklentiler.base", "broken: [");
    assert.equal(baseButton().textContent, core.t("set.baseReset"));
    assert.ok(baseButton().classList.contains("mod-warning"));
    await baseButton().onclick();
    assert.deepEqual(YAML.parse(app.vault.files.get("Eklentiler.base")).filters, base.filters);
  },

  async "language: the setting switches the UI right away; auto follows Obsidian"({ plugin, view }) {
    const tab = plugin.settingTab;
    tab.display();
    const select = () => $$(tab.containerEl, "select").find((d) => [...d.options].some((o) => o.value === "auto"));
    assert.deepEqual([...select().options].map((o) => o.textContent), ["Auto (English)", "English", "Türkçe"]);
    const choose = async (value) => { select().value = value; await select().onchange(); };
    await choose("tr");
    assert.ok($(view.contentEl, ".pdt-tab").textContent.startsWith("Tümü"));
    assert.equal($(tab.containerEl, ".name").textContent, "Dil");
    await choose("en");
    assert.ok($(view.contentEl, ".pdt-tab").textContent.startsWith("All"));
    assert.equal(plugin.data.settings.language, "en");
    await choose("auto");
    assert.equal(core.t("set.language"), "Language");      // the fake Obsidian runs in English
    core.setLanguage("tr");
  },

};

(async () => {
  core.setLanguage("tr");
  const ctx = {};
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try { await fn(ctx); } catch (error) { failed++; console.log(`  ✖ ${name}\n    ${error.stack.split("\n").slice(0, 8).join("\n    ")}`); }
  }
  const total = Object.keys(tests).length;
  console.log(failed ? `✖ ${failed}/${total} view tests failed` : `✅ ${total}/${total} view tests passed`);
  process.exitCode = failed ? 1 : 0;
})();
