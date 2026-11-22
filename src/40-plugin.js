// ─── 5. Plugin ──────────────────────────────────────────────────────────────
class PluginRadar extends Plugin {
  async onload() {
    addIcon(ICON, ICON_SVG);
    this.data = Object.assign({ excluded: {}, dismissed: {}, snoozed: {}, groupSuggestions: {}, migrations: {}, aiUsage: {} }, await this.loadData());
    setLanguage(this.uiLanguage());  // before defaultSettings(), whose folder name depends on the language
    this.data.settings = Object.assign(defaultSettings(), this.data.settings);
    this.data.settings.query = "";   // filters are remembered, the search isn't
    this.data.settings.home = normalizeHome(this.data.settings.home);
    if (!TRANSLATE_FX.includes(this.data.settings.translateFx)) this.data.settings.translateFx = "marker";   // an effect that's gone
    if (this.data.settings.start === "home") this.data.settings.section = "home";
    delete this.data.lastVisit;   // before 0.9.2: "new" counted from the last load, so every restart zeroed it
    if (!["all", "tracked", ...LIST_MODES].includes(this.data.settings.mode)) this.data.settings.mode = "all";   // 0.11: the other tabs are widgets
    delete this.data.settings.similarTrail;
    delete this.data.settings.historyMonths;   // 0.9.1: the history comes from GitHub
    delete this.data.settings.similarFrom;
    delete this.data.settings.modelPrice;   // 0.11.3: the price lives in modelCost only; formatPrice writes its text
    this.github = new GitHub();
    this.cache = new Cache(this.app.vault.adapter, this.manifest.dir);
    this.translations = new TranslationStore(this.app.vault.adapter, this.manifest.dir, () => this.data.settings.targetLang);   // read with the caches (onLayoutReady)
    this.notes = new Notes(this.app, this.data.settings);
    this.translator = new Translator(this.app, this.data.settings);
    this.translator.onUsage = (provider, model, kind, usage) => {   // the AI tab's usage table and the estimates
      this.data.aiUsage = addUsage(this.data.aiUsage, provider, model, kind, usage);
      this.saveData(this.data);
    };
    this.catalog = null;                                      // {fetchedAt, plugins}
    this.similar = null;                                      // Similar lists built on GitHub (parseSimilar); null → none yet
    this.profiles = null;                                     // AI profiles' index.json ({categories, tags, plugins}); null → none yet
    this.extras = null;                                       // loadExtras(), once
    this.profileFiles = new Map();                            // id → a plugin's whole profile (a promise), this session only
    this.settled = false;                                     // Obsidian's startup is over (see onLayoutReady): syncs may run
    this.timeline = newTimeline();
    this.busy = false;
    this.progress = "";             // the running task's progress, shown in the view's status line
    this.readmeJobs = new Set();    // plugin ids whose README is being fetched

    this.registerView(VIEW_TYPE, (leaf) => new DiscoveryView(leaf, this));
    this.addRibbonIcon(ICON, t("view.title"), () => this.openView());
    this.addSettingTab(new RadarSettingTab(this.app, this));
    this.watchMotion();
    this.addCommands();

    // Only changes inside the notes folder refresh the view, so typing elsewhere stays quiet. A sync rewrites every
    // tracked note (downloads change daily): the burst ends in one redraw, not one per note.
    const relevant = (path) => path.startsWith(`${this.notes.folder}/`);
    this.redrawSoon = debounce(() => this.redraw(), 200, true);
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      if (!relevant(file.path)) return;
      this.notes.refresh(file);
      this.redrawSoon();
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (!relevant(file.path)) return;
      this.notes.forget(file.path);
      this.redrawSoon();
    }));
    this.registerEvent(this.app.vault.on("rename", (file, old) => {
      if (!relevant(file.path) && !relevant(old)) return;
      this.notes.forget(old);
      this.notes.refresh(file);
      this.redrawSoon();
    }));

    this.registerEvent(this.app.workspace.on("file-open", (file) => this.onNoteOpen(file)));

    // A view left open is restored before the layout is ready, i.e. before the cache is read: ensureFresh() waits for
    // `started`, else it would take the empty catalog for a first install and sync at every startup
    let started;
    this.started = new Promise((resolve) => { started = resolve; });
    this.app.workspace.onLayoutReady(async () => {
      try {
        await this.importLegacyPlugin();
        this.notes.rebuild();
        // everything the lists show, read at once and drawn once: a second full redraw (the Similar lists and profiles
        // a few seconds later, ~80 ms to read) repainted the list and pushed Obsidian's LCP to ~5 s
        const [catalog, cached] = await Promise.all([this.cache.read("catalog", null), this.cache.read("timeline", null), this.loadExtras(), this.translations.load()]);
        this.catalog = catalog;
        if (cached?.v === TIMELINE_VERSION && cached.source === "server") this.timeline = cached;   // only the history built on GitHub (0.9.1+)
        await this.runMigrations();
      } finally {
        started();
      }
      this.redraw();
      // Obsidian is still starting: a due sync waits a little
      this.later(() => {
        this.settled = true;
        this.registerInterval(window.setInterval(() => this.syncIfDue(), SYNC_CHECK_MS));
        this.syncIfDue();
      }, SYNC_DELAY_MS);
    });
  }

  /**
   * data.json, one write at a time: writes started together could finish out of order and leave an older state on
   * disk. Saves asked for while one is being written become one more write after it (of the newest state).
   */
  saveData(data) {
    if (this.saving) {
      this.nextSave ||= this.saving.then(() => { this.nextSave = null; return this.saveData(data); });
      return this.nextSave;
    }
    const write = super.saveData(data);
    this.saving = write.catch(() => {}).then(() => { this.saving = null; });
    return write;
  }

  /** Runs `fn` after `ms`, unless the plugin is unloaded first. */
  later(fn, ms) {
    const id = window.setTimeout(fn, ms);
    this.register(() => window.clearTimeout(id));
  }

  /**
   * The AI profiles and the Similar lists from the cache, once (~8 MB, ~80 ms): with the catalog at startup, or
   * first by a sync that compares them. The caller redraws.
   */
  loadExtras() {
    this.extras ||= (async () => {
      const [profiles, similar] = await Promise.all([this.cache.read("profiles", null), this.cache.read("similar", null)]);
      this.profiles = profiles;
      this.similar = parseSimilar(similar);
    })();
    return this.extras;
  }

  uiLanguage() {
    const language = this.data.settings?.language;
    return language && language !== "auto" ? language : obsidianLanguage();
  }

  /**
   * The plugin ran earlier under other ids (see LEGACY_PLUGIN_IDS). On a fresh install, the newest
   * earlier install's settings, lists and caches are copied over once so nothing is lost by the rename.
   */
  async importLegacyPlugin() {
    if (this.data.migrations.legacyImport) return;
    this.data.migrations.legacyImport = dayString(Date.now());
    const adapter = this.app.vault.adapter;
    const hasOwnData = Object.keys(this.data.excluded).length || this.translations.count("description");
    let legacyDir = null;
    for (const id of LEGACY_PLUGIN_IDS) {
      const dir = normalizePath(`${this.app.vault.configDir}/plugins/${id}`);
      if (await adapter.exists(`${dir}/data.json`)) { legacyDir = dir; break; }
    }
    if (hasOwnData || !legacyDir) return this.saveData(this.data);
    try {
      const legacy = JSON.parse(await adapter.read(`${legacyDir}/data.json`));
      for (const key of ["excluded", "dismissed"]) this.data[key] = { ...legacy[key], ...this.data[key] };
      for (const [id, entry] of Object.entries(legacy.translations || {})) this.translations.put("description", id, entry);
      Object.assign(this.data.settings, legacy.settings || {});
      Object.assign(this.data.migrations, legacy.migrations || {}, { legacyImport: this.data.migrations.legacyImport });
      for (const name of ["catalog", "timeline"]) {
        const path = `${legacyDir}/cache/${name}.json`;
        if (await adapter.exists(path)) await this.cache.write(name, JSON.parse(await adapter.read(path)));
      }
      new Notice(t("notice.legacyImported"), 10000);
    } catch (error) {
      console.warn("[Community Radar] couldn't import data from the earlier version", error);
    }
    await this.saveData(this.data);
  }

  /**
   * One-time changes to notes, settings and keys when upgrading, oldest first. Each step runs once: its day is kept
   * under its key in `data.migrations`. A new step goes at the end of the list, with a key of its own.
   */
  async runMigrations() {
    const done = this.data.migrations;
    const st = this.data.settings;
    const tell = (key, n, timeout) => { if (n) new Notice(t(key, { n }), timeout); };   // only when something changed
    const steps = [
      ["h1Headings", async () => tell("notice.headings", await this.notes.migrate(migrateHeadings))],
      ["groupsList", async () => tell("notice.groupsMigrated", await this.notes.migrateGroups(), 10000)],
      ["statusKeys", async () => tell("notice.statusMigrated", await this.notes.migrate(migrateStatuses), 10000)],
      ["readmeMarkers", () => this.notes.migrate(migrateMarkers)],
      // 0.16: translations sent back as they were or in another language (cheap models, Chinese plugins) go
      ["translationCheck", async () => tell("notice.translationsDropped", await this.translations.dropUntranslated(), 10000)],
      // 0.9.2: "new" lasts 14 days by default; 30 was 0.9's default, not a choice
      ["newDays14", () => { if (st.newDays === 30) st.newDays = DEFAULT_NEW_DAYS; }],
      ["pageQueries", () => migratePageQueries(st)],
      // 0.10: a saved view is a query (its tab's query, then its filters); before fields011, which rewrites that query
      ["viewQueries", () => {
        if (st.home?.views) st.home.views = st.home.views.map((v) => (v.query != null ? v : { id: v.id, name: v.name, query: legacyViewQuery(v, st) }));
      }],
      ["fields011", () => migrateFields011(st)],
      ["readmeImages", () => this.notes.migrate(migrateImages)],
      ["keyNames", () => {
        const moved = this.translator.migrateLegacyKeys();
        if (moved) new Notice(t("notice.keysMoved", { n: moved, example: KEY_NAMES.anthropic }));
      }],
      // 0.11.3: before the order above was fixed, a pre-0.10 view could end up with the query "undefined"; its tab and
      // filters are still there, so it gets the query it meant
      ["viewQueriesRepair", () => {
        if (st.home?.views) st.home.views = st.home.views.map((v) => (v.query === "undefined" && v.mode ? { id: v.id, name: v.name, query: legacyViewQuery(v, st) } : v));
      }],
      // 0.14: Similar comes as lists built on GitHub; the semantic vectors (~2.5 MB) aren't needed any more
      ["dropVectors", () => Promise.all([this.cache.remove("vectors"), this.cache.remove("vectors", "bin")])],
      // 0.16: translations move out of data.json into translations.jsonl (data.json stays small and quick to save)
      ["translationStore", async () => {
        for (const [key, kind] of [["translations", "description"], ["profileTranslations", "overview"]]) {
          for (const [id, entry] of Object.entries(this.data[key] || {})) this.translations[kind][id] ??= entry;
          delete this.data[key];
        }
        await this.translations.rewrite();
      }],
      // 0.16: Tracked's Sections switch is the page query's `group by group`: a query saved without it gets it (unless off)
      ["trackedGroupBy", () => {
        const sections = st.trackedSections !== false;
        delete st.trackedSections;
        const add = (q) => (sections && typeof q === "string" && !splitQuery(q).group ? joinQuery(q, "group by group") : q);
        if (st.pageQueries?.tracked != null) st.pageQueries.tracked = add(st.pageQueries.tracked);
        if (st.queries?.tracked != null) st.queries.tracked = add(st.queries.tracked);
        if (!sections && st.pageQueries?.tracked == null) st.pageQueries = { ...st.pageQueries, tracked: "tracked\norder by rating desc" };   // the old default, flat
      }],
    ];
    for (const [key, run] of steps) {
      if (done[key]) continue;
      await run();
      done[key] = dayString(Date.now());
    }
    await this.saveData(this.data);
  }

  addCommands() {
    const command = (id, name, callback) => this.addCommand({ id, name, callback });
    command("open", t("cmd.open"), () => this.openView());
    command("refresh", t("cmd.refresh"), () => this.refresh());
    command("rebuild-history", t("cmd.rebuild"), () => this.downloadHistory());
    command("readme-current", t("cmd.readmeCurrent"), () => this.updateCurrentReadme());
    command("readme-all", t("cmd.readmeAll"), () => this.updateReadmes([...this.notes.index.keys()]));
    command("bases-view", t("cmd.base"), () => this.writeBase());
    this.addCommand({   // listed only while AI group suggestions are on (Settings › AI)
      id: "group-ungrouped", name: t("cmd.groupUngrouped"),
      checkCallback: (checking) => {
        if (!this.data.settings.aiGroups) return false;
        if (!checking) this.groupUngrouped();
        return true;
      },
    });
    command("readme-translate", t("cmd.readmeTranslate"), () => this.translateCurrentReadme());
    command("similar-current", t("cmd.similarCurrent"), () => this.similarOfCurrent());
    command("recent-actions", t("bulk.recent"), () => new RecentModal(this, async (op) => { await this.undo(op); }).open());
    command("home", t("cmd.home"), async () => {
      await this.openView();
      this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view?.update?.("section", "home");
    });
    command("help", t("help.title"), async () => {
      await this.openView();
      this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view?.openHelp?.();
    });
  }

  // ── State ────────────────────────────────────────────────────────────────
  /** Installed community plugins. `app.plugins` isn't part of the public API, so it's read defensively. */
  installed() {
    return new Set(Object.keys(this.app.plugins?.manifests || {}));
  }

  state() {
    return {
      catalog: [...(this.catalog?.plugins || []), ...removedRows(this.timeline.removed, this.app.plugins?.manifests)],
      releases: this.timeline.releases,
      firstSeen: this.timeline.firstSeen,
      notes: this.notes.index,
      excluded: new Set(Object.keys(this.data.excluded)),
      dismissed: new Set(Object.keys(this.data.dismissed)),
      snoozed: this.data.snoozed,
      installed: this.installed(),
      lastSync: this.catalog?.prevAt ?? null,
      timeline: this.timeline,   // milestones for the query's milestone fields
      profiles: this.profiles?.plugins || {},   // AI profiles by id: the category, tag, intent… fields
      categories: this.profiles?.categories || [],
      translations: this.translations,           // the `translated` field
      targetLang: this.data.settings.targetLang,
    };
  }

  /** A catalog plugin by id; the lookup is rebuilt when the catalog's list changes. */
  pluginById(id) {
    const plugins = this.catalog?.plugins;
    if (this.byIdPlugins !== plugins) {
      this.byIdPlugins = plugins;
      this.byId = new Map((plugins || []).map((p) => [p.id, p]));
    }
    return this.byId.get(id) || null;
  }

  /** Updates open views; `full` rebuilds them (e.g. after a language change). */
  redraw(full = false) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) (full ? leaf.view.render : leaf.view.refresh)?.call(leaf.view);
  }

  /** translatedFirst, from ⋮ or Settings: the new default goes for every row (the rows' own flips are dropped). */
  async setTranslatedFirst(on) {
    this.data.settings.translatedFirst = on;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) leaf.view.langFlips?.clear();
    await this.saveData(this.data);
    this.redraw();
  }

  async openView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing || this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  // ── Data ─────────────────────────────────────────────────────────────────
  /**
   * Runs one long task at a time. Progress shows in the view's status line and, unless `quiet`
   * (scheduled syncs), in a notice; a quiet task shows a notice only when it fails.
   */
  async task(label, work, { quiet = false } = {}) {
    if (this.busy) return quiet ? undefined : new Notice(t("notice.busy"));
    this.busy = true;
    this.progress = "";
    const notice = quiet ? null : new Notice(label, 0);
    const progress = (text) => {
      this.progress = text;
      notice?.setMessage(`${label}\n${text}`);
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) leaf.view.refreshStatus?.();
    };
    this.redraw();
    try {
      const message = await work(progress);
      notice?.setMessage(message || `${label} ✔`);
      setTimeout(() => notice?.hide(), 6000);
    } catch (error) {
      console.error("[Community Radar]", error);
      const failed = notice || new Notice("", 0);
      failed.setMessage(`${label} ✖\n${error.message}`);
      setTimeout(() => failed.hide(), 12000);
    } finally {
      this.busy = false;
      this.progress = "";
      this.redraw();
    }
  }

  /** On opening the view: sync when there is no data yet, otherwise follow the sync frequency (not during startup). */
  async ensureFresh() {
    await this.started;   // the cache first: an empty catalog before it is read isn't a first install
    if (!this.catalog) await this.refresh();
    else if (this.settled) await this.syncIfDue();
  }

  /** Quietly syncs when the chosen interval has passed; makes no request otherwise or when set to manual. */
  async syncIfDue() {
    const hours = this.data.settings.syncHours;
    const age = this.catalog ? Date.now() - this.catalog.fetchedAt : Infinity;
    if (hours > 0 && age >= hours * HOUR_MS) await this.refresh({ quiet: true });
  }

  async ensureCatalog() {
    await this.started;
    if (!this.catalog) await this.refresh();
    return Boolean(this.catalog);
  }

  refresh({ quiet = false } = {}) {
    return this.task(t("notice.refreshing"), async (progress) => {
      progress(t("notice.downloadingCatalog"));
      const plugins = await this.github.catalog();
      const delta = this.catalog ? catalogDelta(this.catalog.plugins, plugins) : null;
      this.catalog = { fetchedAt: Date.now(), prevAt: this.catalog?.fetchedAt, plugins, delta };   // prevAt: lastSync() in queries
      for (const p of plugins) if (p.id in this.data.snoozed && !isSnoozed(p, this.data.snoozed)) delete this.data.snoozed[p.id];
      await this.saveData(this.data);
      await this.cache.write("catalog", this.catalog);

      const history = await this.syncServerTimeline(progress);
      await this.syncProfiles(progress);
      await this.syncSimilar(progress);

      progress(t("notice.updatingNotes"));
      const released = [];
      for (const id of [...this.notes.index.keys()]) {
        const plugin = this.pluginById(id);
        if (plugin && (await this.notes.syncSource(plugin))) released.push(id);
      }
      if (released.length && this.data.settings.readmeMode === "sync") await this.fetchReadmes(released, progress);
      // the release history is part of Sync: say how far it reaches, or that it couldn't be had this time
      const reach = history ? t("notice.historyTo", { date: dayString(this.timeline.to) }) : t("notice.historyStale");
      return `${t("notice.refreshed", { n: formatCount(this.catalog.plugins.length), released: released.length })} · ${reach}`;
    }, { quiet });
  }

  /**
   * A file of the profiles branch, at most once a day (PROFILES_CHECK_HOURS): GitHub sends it only when it changed
   * since ours (ETag), else a bodiless 304. `<name>-meta` keeps the ETag and the check's time, so a 304 rewrites only
   * that small file. Returns the new content to use, or null (not due, unchanged, or failed: we keep what we have).
   * @param {() => any} current  what we have now (read after the cache is loaded)
   * @param {(json: object) => boolean} valid  a check of the downloaded content
   */
  async syncProfilesFile(name, file, current, valid, progress) {
    await this.loadExtras();   // compared with the copy we have
    try {
      const meta = await this.cache.read(`${name}-meta`, {});
      const have = current();
      if (have && Date.now() - (meta.checkedAt || 0) < PROFILES_CHECK_HOURS * HOUR_MS) return null;
      progress(t(`notice.${name}`));
      const fresh = await this.github.profilesFile(file, have ? meta.etag : null);   // no copy: ask for the whole file
      if (fresh && !valid(fresh.json)) throw new Error(`unexpected ${file}`);
      if (fresh) await this.cache.write(name, fresh.json);
      await this.cache.write(`${name}-meta`, { etag: fresh ? fresh.etag : meta.etag, checkedAt: Date.now() });
      return fresh?.json ?? null;
    } catch (error) {
      console.warn(`[Community Radar] couldn't update ${file}`, error);
      return null;
    }
  }

  /** The AI profiles' index (categories, tags, summaries); a new one drops the session's plugin files. */
  async syncProfiles(progress) {
    const index = await this.syncProfilesFile("profiles", "index.json", () => this.profiles, (json) => Boolean(json?.plugins), progress);
    if (!index) return;
    this.profiles = index;
    this.profileFiles.clear();
  }

  /** The Similar lists built on GitHub (similar.json). */
  async syncSimilar(progress) {
    const file = await this.syncProfilesFile("similar", "similar.json", () => this.similar, (json) => Boolean(parseSimilar(json)), progress);
    if (file) this.similar = parseSimilar(file);
  }

  /** A plugin's whole profile (the details window's long texts), downloaded once a session; null when there's none. */
  profileFile(id) {
    return this.loadProfile(id).catch(() => null);
  }

  /**
   * A plugin's whole profile, downloaded once a session: null when it has none; throws when it couldn't be downloaded,
   * and then isn't kept, so the next ask tries again (a dropped connection mustn't stick for the session).
   */
  loadProfile(id) {
    if (!this.profileFiles.has(id)) this.profileFiles.set(id, this.github.profile(id).catch((error) => { this.profileFiles.delete(id); throw error; }));
    return this.profileFiles.get(id);
  }

  /** A plugin's Overview in your language as saved: {src, lang, parts, model, tokens, cost, date}, or null. */
  profileTranslation(id) {
    return this.translations.overview[id] ?? null;
  }

  /** Is `id`'s saved Overview translation in your language and made from these parts (profileParts)? */
  overviewTranslated(id, parts) {
    const saved = this.profileTranslation(id);
    return Boolean(saved) && saved.src === profileTexts(parts).join("\n") && saved.lang === this.data.settings.targetLang;
  }

  /**
   * Translates a plugin's Overview (summary, problem, what it does, what it isn't, worth knowing, what it needs) in
   * one request and keeps it in data.json with what it took, as the provider reported it. Categories and tags stay
   * as they are. `withDescription`: its short description rides along in the same request when it has no
   * translation yet (kept like any other; the request's usage is the Overview's).
   * @returns {Promise<object|false>} what it took ({model, tokens, cost}) when done, else false
   */
  async translateProfile(plugin, quiet = false, withDescription = false, { model = null, force = false } = {}) {   // quiet: a bulk run; its errors go up to it
    if (!this.translator.ready) {
      new Notice(t("notice.translateSetup"));
      return false;
    }
    try {
      const file = await this.loadProfile(plugin.id).catch(() => { throw new Error(t("error.profileMissing")); });   // not half a translation
      const parts = profileParts(this.profiles?.plugins?.[plugin.id], file);
      if (!parts) return false;
      if (quiet && this.overviewTranslated(plugin.id, parts)) return true;   // a bulk run learns it's up to date only now
      const all = profileTexts(parts);
      const asked = all.map((text, i) => (text ? i : -1)).filter((i) => i >= 0);   // empty ones aren't sent
      const description = withDescription && plugin.description && (force || this.cachedTranslation(plugin) == null);
      const sent = [...(description ? [plugin.description] : []), ...asked.map((i) => all[i])];
      const done = await this.translator.translateWithUsage(sent, "overview", 1, model);
      const got = [...done.texts];
      const lang = this.data.settings.targetLang;
      const descProblem = description   // the first one sent
        ? await this.translations.put("description", plugin.id, { src: plugin.description, text: got.shift(), lang, model: done.model })
        : null;
      const texts = [...all];
      asked.forEach((i, k) => { texts[i] = got[k]; });
      const problem = await this.translations.put("overview", plugin.id, {
        src: all.join("\n"), lang, parts: profileFromTexts(parts, texts),
        model: done.model, tokens: done.tokens, cost: done.cost, date: dayString(Date.now()),
      });
      if (quiet) return problem ? { rejected: 1 } : { model: done.model, tokens: done.tokens, cost: done.cost };
      if (problem || descProblem) new Notice(t("notice.translateRejected", { model: done.model }), 12000);
      return problem ? false : { model: done.model, tokens: done.tokens, cost: done.cost };   // what it took
    } catch (error) {
      if (quiet) throw error;
      console.error("[Community Radar] Overview translation", error);
      new Notice(t("notice.translateFailed", { error: error.message }), 12000);
      return false;
    }
  }

  /**
   * What an AI job will take (aiEstimate), learnt from this model's earlier requests of the same kind with the same
   * Thinking setting. The prompt's fixed part (the instructions) is added once per request, as it's billed.
   * @param {"description"|"overview"|"readme"} kind
   * @param {{text?: string, chars?: number, requests?: number}} job  the texts it'll send (or just their length)
   * @returns {{chars: number, tokens: number, cost: ?number, measured: boolean}}
   */
  estimate(kind, { text = "", chars = text.length, requests = 1 }) {
    const s = this.data.settings;
    const tally = this.data.aiUsage?.[`${s.provider}/${s.model}`]?.kinds?.[usageKind(kind, this.translator.thinkingOff ? "off" : "default")];
    const fixed = (kind === "readme" ? readmePrompt("", s.targetLang, s.prompts) : translationPrompt([], s.targetLang, s.prompts)).length;
    return { chars, ...aiEstimate(tally, { chars: chars + requests * fixed, requests }, kind === "overview", s.modelCost) };
  }

  /** The plugins with a description and no translation of it yet. */
  untranslatedDescriptions(plugins) {
    return plugins.filter((p) => p.description && this.cachedTranslation(p) == null);
  }

  /** The profiled plugins whose Overview isn't translated into your language, or changed since (overviewPending). */
  pendingOverviews(plugins) {
    return plugins.filter((p) => this.profiles?.plugins?.[p.id] && this.overviewPending(p.id));
  }

  /** Translating these descriptions: in requests of PAGE_SIZE. */
  estimateDescriptions(plugins) {
    return this.estimate("description", { text: plugins.map((p) => p.description).join("\n"), requests: Math.ceil(plugins.length / PAGE_SIZE) });
  }

  /** Translating `n` Overviews, without downloading them: each is about OVERVIEW_CHARS long, one request each. */
  estimateOverviews(n) {
    return this.estimate("overview", { chars: n * OVERVIEW_CHARS, requests: n });
  }

  /**
   * The catalog's READMEs already downloaded (into a note or the cache) and not translated, or translated from an
   * older text, with what translating them would take. Their files are read: async.
   * @returns {Promise<{n: number, estimate: object}>}
   */
  async untranslatedReadmes() {
    const adapter = this.app.vault.adapter;
    const dir = `${this.cache.dir}/readmes`;
    const cached = new Set((await adapter.exists(dir)) ? (await adapter.list(dir)).files : []);
    const texts = [];
    for (const p of (this.catalog?.plugins || []).filter((x) => this.notes.file(x.id) || cached.has(this.cache.path(this.readmeCacheName(x.id))))) {
      const { original, translation } = await this.readmeParts(p);
      if (original && translation?.hash !== original.hash) texts.push(this.translationSource(original.text).text);
    }
    return { n: texts.length, estimate: this.estimate("readme", { text: texts.join("\n"), requests: texts.length }) };
  }

  /**
   * Is the Overview worth sending to a bulk run? Not when it's translated into your language and its summary (the
   * one part every plugin has here, without downloading its profile) is the same; the rest is checked when it goes.
   */
  overviewPending(id) {
    return !overviewCurrent(this.profileTranslation(id), this.profiles?.plugins?.[id]?.summary, this.data.settings.targetLang);
  }

  /**
   * The details window's `t`: the description and the Overview in your language, whatever of them is missing or out
   * of date, in one request. Only the description when the plugin has no profile or its Overview is up to date.
   * True when both are there.
   */
  async translateWithOverview(plugin) {
    const profile = this.profiles?.plugins?.[plugin.id];
    const parts = profile && profileParts(profile, await this.profileFile(plugin.id));
    if (parts && !this.overviewTranslated(plugin.id, parts)) return Boolean(await this.translateProfile(plugin, false, true));
    return this.translateRows([plugin]);
  }

  /**
   * The model picker (pinned and recent ones first, ☆ and ✕ on its rows): the model you pick, or null. The pick joins
   * the history; Settings' model stays as it is (Settings sets it itself). `models`: your provider's list when the
   * caller has it, else asked for here (a failure leaves the picker to names you type).
   */
  async pickModel(models = null) {
    const settings = this.data.settings;
    if (!models) {
      try {
        models = await this.translator.models(settings.provider);
      } catch (error) {
        new Notice(t("notice.modelsFailed", { error: error.message }));
      }
    }
    const modal = new ModelModal(this.app, models || [], settings.modelHistory, async (history) => {
      settings.modelHistory = history;
      await this.saveData(this.data);
    });
    modal.open();
    const model = await modal.result;
    if (!model) return null;
    settings.modelHistory = rememberModel(settings.modelHistory, model.id);
    await this.saveData(this.data);
    return model;
  }

  /**
   * ⋯ › Translate again…: the description and the Overview (one request; just the description without a profile)
   * made again with `model`, even when kept. A reply that fails the check (translationProblem) keeps the old ones.
   */
  async retranslate(plugin, model) {
    if (this.profiles?.plugins?.[plugin.id]) return Boolean(await this.translateProfile(plugin, false, true, { model, force: true }));
    return this.translateRows([plugin], { model, force: true });
  }

  /** Categories and tags with their counts, for the query box (worked out again only when the profiles change). */
  profileFacets() {
    if (this.facetsOf !== this.profiles) [this.facetsOf, this.facets] = [this.profiles, profileFacets(this.profiles)];
    return this.facets;
  }

  /**
   * The release history, built daily on GitHub (every day since 2020, with a year of downloads): when a newer one is
   * out, its last days (delta.json, ~150 KB) join the copy we have; the whole file (~1 MB) when ours is older than
   * they reach, or `force`. A failure keeps the one we have.
   */
  async syncServerTimeline(progress, force = false) {
    try {
      const meta = await this.github.metricsMeta();
      const ours = this.timeline;
      if (!force && meta.to <= (ours.to || 0)) return true;
      progress(t("notice.serverHistory"));
      const reaches = !force && ours.v === TIMELINE_VERSION && ours.series && meta.deltaFrom && ours.to >= meta.deltaFrom - DAY_MS;
      const timeline = (reaches && mergeTimeline(ours, await this.github.metricsDelta())) || await this.github.metricsTimeline();
      if (timeline?.v !== TIMELINE_VERSION || !timeline.to) throw new Error("unexpected timeline file");
      this.timeline = timeline;
      await this.cache.write("timeline", timeline);
      return true;
    } catch (error) {
      console.warn("[Community Radar] couldn't download the release history", error);
      return false;
    }
  }

  downloadHistory() {
    return this.task(t("notice.history"), async (progress) => {
      if (!(await this.syncServerTimeline(progress, true))) throw new Error(t("notice.historyFailed"));
      return t("notice.historyServer", { from: dayString(this.timeline.from), to: dayString(this.timeline.to) });
    });
  }

  // ── README ───────────────────────────────────────────────────────────────
  async fetchReadmes(ids, progress) {
    let done = 0;
    await mapLimit(ids, PARALLEL, async (id) => {
      const plugin = this.pluginById(id);
      const file = this.notes.file(id);
      if (plugin && file) await this.notes.writeReadme(file, plugin, plugin.repo ? await this.github.readme(plugin.repo) : null);
      progress(t("notice.readmeProgress", { done: ++done, total: ids.length }));
    });
  }

  async updateReadmes(ids) {
    if (!(await this.ensureCatalog())) return;
    await this.task(t("notice.readme"), async (progress) => {
      await this.fetchReadmes(ids, progress);
      return t("notice.readmeDone", { n: ids.length });
    });
  }

  /**
   * An opened tracking note: its new release counts as seen (you are looking at it), and in "When I open the note"
   * mode a README older than the release gets a fresh one.
   */
  async onNoteOpen(file) {
    if (!this.notes.inFolder(file)) return;
    const note = [...this.notes.index.values()].find((n) => n.path === file.path);
    const plugin = note && this.pluginById(note.id);
    if (!plugin) return;
    if (isUnreviewed(plugin, note)) await this.markSeen(plugin);
    if (this.data.settings.readmeMode !== "open" || !plugin.version || readmeVersion(await this.app.vault.cachedRead(file)) === plugin.version) return;
    await this.refreshReadme(plugin, file);
  }

  /** A tracked plugin's new release as seen: its note's reviewed date becomes today, so its "new release" goes. */
  async markSeen(plugin) {
    await this.track(plugin, { reviewed: dayString(Date.now()) });
    this.redraw();
  }

  /** Fetches one README in the background; a second request for the same plugin is ignored while it runs. */
  async refreshReadme(plugin, file) {
    if (!plugin.repo || this.readmeJobs.has(plugin.id)) return;
    this.readmeJobs.add(plugin.id);
    try {
      await this.notes.writeReadme(file, plugin, await this.github.readme(plugin.repo));
    } catch (error) {
      console.warn("[Community Radar] couldn't fetch the README", error);
    } finally {
      this.readmeJobs.delete(plugin.id);
    }
  }

  /** Opens the README in the plugin's tracking note, creating the note (with its README) when there is none. */
  async openReadme(plugin) {
    if (!this.notes.file(plugin.id)) await this.track(plugin, {});
    const file = this.notes.file(plugin.id);
    if (file) await this.app.workspace.openLinkText(`${file.path}#README`, "", "tab");
  }

  /** The Bases file sits next to the notes folder: "Eklentiler" → "Eklentiler.base". */
  basePath() {
    return normalizePath(`${this.notes.folder}.base`);
  }

  /** Creates the Bases view, or resets it to the template when it exists, then opens it. */
  async writeBase() {
    const path = this.basePath();
    const content = baseFile(this.notes.folder);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      const parent = path.split("/").slice(0, -1).join("/");
      if (parent && !this.app.vault.getAbstractFileByPath(parent)) await this.app.vault.createFolder(parent);
      await this.app.vault.create(path, content);
    }
    new Notice(t(existing ? "notice.baseReset" : "notice.baseCreated", { path }));
    await this.app.workspace.openLinkText(path, "", "tab");
  }

  /** Cache file of an untracked plugin's README and translation: cache/readmes/<id>.json. */
  readmeCacheName(id) {
    return `readmes/${safeFileName(id)}`;
  }

  /**
   * A plugin's README and its translation, from its tracking note when it has one, else from the cache (the note is
   * the one source once it exists). Missing parts are null.
   * @returns {Promise<{source: ?string, original: ?{text, version, date, hash}, translation: ?{body, hash, date, model, tokens, cost}}>}
   *   source: "note", "cache" or null; hash: textHash of the README text (the translation's: of the text it came from)
   */
  async readmeParts(plugin) {
    const file = this.notes.file(plugin.id);
    if (file) {
      const content = await this.app.vault.cachedRead(file);
      const text = readmeText(content);
      const saved = readmeTranslation(content);
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
      return {
        source: "note",
        original: text && { text, ...readmeMeta(content), hash: textHash(text) },
        translation: saved && { ...saved, model: fm.translation_model ?? null, tokens: fm.translation_tokens ?? null, cost: fm.translation_cost ?? null },
      };
    }
    const entry = await this.cache.read(this.readmeCacheName(plugin.id), null);
    const text = entry?.readme != null ? readmeBody(entry.readme, plugin.repo).trim() : null;
    return {
      source: entry ? "cache" : null,
      original: text && { text, version: entry.version, date: entry.fetched, hash: textHash(text) },
      translation: entry?.translation || null,
    };
  }

  /** What of a README goes to the AI: all of it, or without its developer sections when *Settings → AI → Save on README translations* is on. */
  translationSource(text) {
    return this.data.settings.readmeSaving ? skipDevSections(text) : { text, skipped: [] };
  }

  /** Keeps a README fetched from GitHub: in the plugin's tracking note, else in the cache (no note is made; a failed fetch isn't cached). */
  async keepReadme(plugin, readme) {
    const file = this.notes.file(plugin.id);
    if (file) return this.notes.writeReadme(file, plugin, readme);
    if (readme == null) return;
    const name = this.readmeCacheName(plugin.id);
    await this.cache.write(name, { ...(await this.cache.read(name, {})), readme, version: plugin.version ?? null, fetched: dayString(Date.now()) });
  }

  /** Fetches a plugin's README from GitHub and keeps it (keepReadme); the cached translation stays, its fingerprint tells if it's outdated. */
  async fetchReadme(plugin) {
    if (!plugin.repo) return;
    await this.keepReadme(plugin, await this.github.readme(plugin.repo));
  }

  /**
   * The README now on GitHub, when the kept one is from an older release: unchanged text only gets its version
   * brought up to date (nothing to tell, null); changed text is returned for the details window to offer.
   */
  async newerReadme(plugin, original) {
    const readme = plugin.repo ? await this.github.readme(plugin.repo) : null;
    if (readme == null) return null;
    if (textHash(readmeBody(readme, plugin.repo).trim()) !== original.hash) return readme;
    await this.keepReadme(plugin, readme);
    return null;
  }

  /**
   * Translates a plugin's README into the target language. Kept in its tracking note, right above the original, with
   * the model, tokens and cost in its properties; an untracked plugin's goes to the cache (no note is made). A missing
   * README, or one older than the release, is fetched first. Asked for only by the user; true when done.
   */
  async translateReadme(plugin, progress = () => {}, quiet = false, model = null) {   // quiet: a bulk run; its errors go up to it
    if (!this.translator.ready) {
      new Notice(t("notice.translateSetup"));
      return false;
    }
    try {
      let { original } = await this.readmeParts(plugin);
      if (!original || (plugin.version && original.version !== plugin.version)) {
        progress(t("notice.readme"));
        await this.fetchReadme(plugin);
        ({ original } = await this.readmeParts(plugin));
      }
      if (!original) throw new Error(t("readme.failed"));
      progress(t("readme.translating"));
      const { text, skipped } = this.translationSource(original.text);
      const done = await this.translator.translateMarkdown(text, model);
      if (skipped.length) done.body += `\n\n*${t("readme.skipped", { list: skipped.join(" · ") })}*`;
      const translation = { ...done, lang: this.data.settings.targetLang, version: original.version, hash: original.hash, date: dayString(Date.now()) };
      const file = this.notes.file(plugin.id);
      if (file) await this.notes.writeTranslation(file, translation);
      else {
        const name = this.readmeCacheName(plugin.id);
        await this.cache.write(name, { ...(await this.cache.read(name, {})), translation });
      }
      return { model: done.model, tokens: done.tokens, cost: done.cost };   // what it took
    } catch (error) {
      if (quiet) throw error;   // a bulk run counts it
      console.error("[Community Radar] README translation", error);
      new Notice(t("notice.translateFailed", { error: error.message }), 12000);
      return false;
    }
  }

  async translateCurrentReadme() {
    const file = this.app.workspace.getActiveFile();
    const note = file && noteFromFrontmatter(file.path, this.app.metadataCache.getFileCache(file)?.frontmatter);
    const plugin = note && this.pluginById(note.id);
    if (!plugin) return new Notice(t("notice.notTracking"));
    await this.task(t("readme.translateTitle", { name: plugin.name }), async (progress) => {
      if (await this.translateReadme(plugin, progress)) return t("readme.translated", { name: plugin.name });
      throw new Error(t("readme.notTranslated"));
    });
  }

  /** The Similar filter for the plugin of the open tracking note. */
  async similarOfCurrent() {
    const file = this.app.workspace.getActiveFile();
    const note = file && noteFromFrontmatter(file.path, this.app.metadataCache.getFileCache(file)?.frontmatter);
    const p = note && this.pluginById(note.id);
    if (!p) return new Notice(t("notice.notTracking"));
    await this.openView();
    await this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view.similarFilter.open(p);
  }

  async updateCurrentReadme() {
    const file = this.app.workspace.getActiveFile();
    const note = file && noteFromFrontmatter(file.path, this.app.metadataCache.getFileCache(file)?.frontmatter);
    if (!note) return new Notice(t("notice.notTracking"));
    await this.updateReadmes([note.id]);
  }

  // ── Translation ──────────────────────────────────────────────────────────
  /** Saved translation; invalid once the description changes. */
  cachedTranslation(plugin) {
    const saved = this.translations.description[plugin.id];
    return saved && saved.src === plugin.description ? saved.text : null;
  }

  /**
   * One request: the short descriptions of up to PAGE_SIZE plugins, kept in translations.jsonl. A reply that doesn't
   * fit (wrong count, not JSON) splits the batch in two and tries each half, so one odd description can't sink 49.
   * @returns {Promise<true>}
   */
  async translateBatch(batch, model = null) {
    try {
      const done = await this.translator.translateWithUsage(batch.map((p) => p.description), "description", batch.length > 1 ? 0 : 1, model);
      const lang = this.data.settings.targetLang;
      const problems = await Promise.all(batch.map((p, k) => this.translations.put("description", p.id, { src: p.description, text: done.texts[k], lang, model: done.model })));
      return { rejected: problems.filter(Boolean).length };   // failed the check: not kept (translationProblem)
    } catch (error) {
      if (!(error instanceof ReplyError) || batch.length < 2 || this.translator.halted) throw error;
      const half = Math.ceil(batch.length / 2);
      const first = await this.translateBatch(batch.slice(0, half), model);
      const second = await this.translateBatch(batch.slice(half), model);
      return { rejected: first.rejected + second.rejected };
    }
  }

  /** Translates these descriptions where missing (`force`: again, even kept ones), with `model` instead of Settings' if given. */
  async translateRows(plugins, { model = null, force = false } = {}) {
    const pending = plugins.filter((p) => p.description && (force || this.cachedTranslation(p) == null));
    if (!pending.length) return true;
    if (!this.translator.ready) {
      new Notice(t("notice.translateSetup"));
      return false;
    }
    const notice = new Notice(t("notice.translating", { n: pending.length }), 0);
    try {
      let rejected = 0;
      for (let i = 0; i < pending.length; i += PAGE_SIZE) rejected += (await this.translateBatch(pending.slice(i, i + PAGE_SIZE), model)).rejected;
      notice.hide();
      if (rejected) new Notice(t("notice.translateRejected", { model: model || this.data.settings.model }), 12000);
      return true;
    } catch (error) {
      console.error("[Community Radar] translation", error);
      notice.setMessage(t("notice.translateFailed", { error: error.message }));
      setTimeout(() => notice.hide(), 12000);
      return false;
    }
  }

  // ── User actions ─────────────────────────────────────────────────────────
  /** Creates or updates the note; a new note gets its README in the background. */
  async track(plugin, patch) {
    const { file, created } = await this.notes.upsert(plugin, patch);
    if (created) this.adoptReadme(plugin, file);  // not awaited: the note is usable right away
    return created;
  }

  /**
   * A new note takes the README and translation from the cache (no second download, no second AI bill) and the cache
   * entry goes: the note is their one source now. A README cached for an older release is fetched fresh instead.
   */
  async adoptReadme(plugin, file) {
    const name = this.readmeCacheName(plugin.id);
    const entry = await this.cache.read(name, null);
    if (entry?.readme != null && entry.version === (plugin.version ?? null)) await this.notes.writeReadme(file, plugin, entry.readme);
    else await this.refreshReadme(plugin, file);
    if (!entry) return;
    if (entry.translation) await this.notes.writeTranslation(file, entry.translation);
    await this.cache.remove(name);
  }

  /** 🔔: tracks a plugin (it gets its note) or lets it go (untrack). */
  async toggleTrack(plugin) {
    if (this.notes.index.has(plugin.id)) return this.untrack(plugin);
    await this.track(plugin, {});
    new Notice(t("notice.tracked", { name: plugin.name }));
  }

  /**
   * Stops tracking a plugin: its note goes to Obsidian's trash (as your setting says), so it can come back from
   * there. A note holding something of yours (groups, a rating, a status, a note) is asked about first.
   * @param {boolean} ask  false: no question (Undo of a bulk Track, whose notes were just made)
   * @returns {Promise<boolean>} true when the note went
   */
  async untrack(plugin, ask = true) {
    const note = this.notes.index.get(plugin.id);
    const file = note && this.notes.file(plugin.id);
    if (!file) return false;
    const yours = note.groups.length || note.rating || note.status || note.note;
    if (ask && yours && !(await new ConfirmModal(this.app, {
      title: t("untrack.title", { name: plugin.name }), plugins: [], text: t("untrack.text"), cta: t("action.untrack"), footnote: "",
    }).ask())) return false;
    await this.app.fileManager.trashFile(file);
    this.notes.forget(file.path);   // the vault's delete event comes later; the list redraws now
    if (ask) new Notice(t("notice.untracked", { name: plugin.name }));
    this.redraw();
    return true;
  }

  async chooseGroup(plugin) {
    const modal = new GroupModal(this, plugin);
    modal.open();
    const groups = await modal.result;
    if (!groups) return;
    const created = await this.track(plugin, { groups });
    const message = groups.length ? t("notice.grouped", { name: plugin.name, group: groups.join(", ") }) : t("notice.ungrouped", { name: plugin.name });
    new Notice(message + (created ? t("notice.noteCreated") : ""));
  }

  // ── Groups and similarity ────────────────────────────────────────────────
  /**
   * Settings › Animations, on <body> as one class (STILL_CLASS) that every still rule in styles.css hangs on: "off", or
   * "system" while the OS asks for reduced motion. Follows the OS's switch while it's "system"; gone when the plugin is.
   */
  watchMotion() {
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const follow = () => this.applyMotion();
    this.reducedMotion.addEventListener("change", follow);
    this.register(() => {
      this.reducedMotion.removeEventListener("change", follow);
      document.body.classList.remove(STILL_CLASS);
    });
    this.applyMotion();
  }

  /** Still or moving, as Settings › Animations and (on "system") the OS say. */
  applyMotion() {
    const { motion } = this.data.settings;
    const still = motion === "off" || (motion === "system" && this.reducedMotion.matches);
    document.body.classList.toggle(STILL_CLASS, still);
  }

  /** The group window's ★: {name, sure} or null (see closestGroup). */
  closestGroupFor(plugin) {
    return closestGroup(plugin.id, this.notes.members(), this.similar, this.profiles?.plugins);
  }

  /**
   * The plugins most like `plugin`, best first: [{p, rank, shared}] — its list built on GitHub, without the ignored
   * plugins and those no longer in the catalog. `rank` is the place in the whole list; `shared` says why (categories,
   * then tags in common). [] while the plugin has no list yet.
   */
  similarTo(plugin) {
    const profiles = this.profiles?.plugins;
    const mine = profiles?.[plugin.id];
    return similarIds(this.similar, plugin.id)
      .map((id, i) => ({ id, rank: i + 1, p: this.pluginById(id) }))
      .filter((x) => x.p && !(x.id in this.data.excluded))
      .map(({ p, rank }) => ({ p, rank, shared: sharedFacets(mine, profiles?.[p.id]) }));
  }

  /** Tracked plugins that have no group yet. */
  ungrouped() {
    return [...this.notes.index.values()].filter((n) => !n.groups.length).map((n) => this.pluginById(n.id)).filter(Boolean);
  }

  /** Your groups with up to three plugin names each, so the model sees what each group means. */
  groupExamples() {
    return [...this.notes.members()].map(([name, ids]) => ({ name, examples: ids.slice(0, 3).map((id) => this.pluginById(id)?.name || id) }));
  }

  /**
   * Group suggestions per plugin id. Saved ones are reused while the description is unchanged; the
   * rest are asked for in requests of AI_BATCH plugins.
   * @returns {Promise<{lists: Object<string, string[]>, usage: ?object}>} usage: what the requests took (sumUsage),
   *   null when every suggestion was saved already; shown, not kept
   */
  async groupSuggestions(plugins, progress = () => {}) {
    const saved = this.data.groupSuggestions;
    const missing = plugins.filter((p) => saved[p.id]?.src !== p.description);
    const groups = this.groupExamples();
    const usages = [];
    for (let i = 0; i < missing.length; i += AI_BATCH) {
      progress(t("batch.requesting", { done: Math.min(i + AI_BATCH, missing.length), total: missing.length }));
      const batch = missing.slice(i, i + AI_BATCH);
      const { found, usage } = await this.translator.suggestGroups(batch, groups);
      usages.push(usage);
      for (const p of batch) saved[p.id] = { src: p.description, list: found[p.id] };
      await this.saveData(this.data);
    }
    const lists = Object.fromEntries(plugins.map((p) => [p.id, saved[p.id]?.list || []]));
    return { lists, usage: usages.length ? sumUsage(usages, this.data.settings.model) : null };
  }

  /** One plugin's group suggestions: {list, usage} (see groupSuggestions). */
  async suggestGroups(plugin) {
    const { lists, usage } = await this.groupSuggestions([plugin]);
    return { list: lists[plugin.id], usage };
  }

  /** Tracked plugins with a release since you reviewed them (the Tracked tab's badge). */
  updatesCount(state = this.state(), now = Date.now()) {
    return discover(state, { ...modeOptions(this.data.settings, "tracked"), trackedGroup: UPDATES, trackedStatus: "", query: "" }, now).length;
  }

  /** Opens Tracked on Ungrouped with its plugins picked and their AI groups under the rows. */
  async groupUngrouped() {
    if (!(await this.ensureCatalog())) return;
    if (!this.ungrouped().length) return new Notice(t("batch.none"));
    if (!this.translator.ready) return new Notice(t("groups.aiSetup"));
    this.app.setting?.close?.();
    await this.openView();
    Object.assign(this.data.settings, { mode: "tracked", trackedGroup: UNGROUPED, trackedStatus: "" });
    await this.saveData(this.data);
    this.redraw(true);
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    if (!view) return;
    // pick the ungrouped plugins shown and ask for their groups: they show under the rows, a click saves
    for (const p of (view.rows || []).slice(0, Math.min(view.visible, AI_BATCH))) view.selected.add(p.id);
    view.bulkBar.syncSelection();
    await view.bulkBar.suggestGroups();
  }

  /** Ignores a plugin: every list leaves it out. Recorded, so the toast's Undo (or Recent actions) turns it back. */
  async exclude(plugin) {
    this.announce(t("notice.excluded", { name: plugin.name }), await this.bulk("exclude", [plugin]));
  }

  async dismiss(plugin) {
    this.data.dismissed[plugin.id] = dayString(Date.now());
    await this.saveData(this.data);
  }

  /** Hides a plugin until it ships a release newer than the current one (recorded like exclude, with Undo). */
  async snooze(plugin) {
    this.announce(t("notice.snoozed", { name: plugin.name }), await this.bulk("snooze", [plugin]));
  }

  /** Says what an action did: in the open Community Radar view with Undo, else as a notice. */
  announce(text, op) {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    for (const leaf of leaves) {
      leaf.view.toast = { text, op };
      leaf.view.refresh?.();
    }
    if (!leaves.length) new Notice(text);
  }

  /** How many plugins each kind of the Hidden page holds (snoozed: those still waiting for their next release). */
  hiddenCounts() {
    const snoozed = (this.catalog?.plugins || []).filter((p) => isSnoozed(p, this.data.snoozed)).length;
    return { excluded: Object.keys(this.data.excluded).length, snoozed, dismissed: Object.keys(this.data.dismissed).length };
  }

  /** Brings plugins back from one kind of the Hidden page (its store has the same name: excluded, snoozed, dismissed). */
  async restoreFrom(mode, ids) {
    for (const id of ids) delete this.data[mode][id];
    await this.saveData(this.data);
    this.redraw();
  }

  /** Writes one personal property of a tracked plugin's note; null removes it. */
  async setNoteField(plugin, key, value) {
    await this.track(plugin, { [key]: value });
    this.redraw();
  }

  /** Opens the view on one kind of the Hidden page. */
  async showList(mode) {
    this.app.setting?.close?.();
    await this.openView();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) await leaf.view.showHidden?.(mode);
  }

  /** Opens the Tracked tab filtered to one group. */
  async showGroup(group) {
    Object.assign(this.data.settings, { mode: "tracked", trackedGroup: group });
    await this.saveData(this.data);
    this.redraw(true);
  }

  /** Obsidian's settings on this plugin's tab (`app.setting` isn't public API, so it's used defensively). */
  openSettings() {
    this.app.setting?.open?.();
    this.app.setting?.openTabById?.(this.manifest.id);
  }

  // ── Bulk actions ─────────────────────────────────────────────────────────
  /**
   * Runs one action on many plugins and keeps what it changed (each plugin's value before and after) as an
   * operation in Recent actions, so Undo turns back exactly that. Plugins it wouldn't change aren't recorded.
   * @param {"track"|"rating"|"group"|"reviewed"|"snooze"|"exclude"} kind
   * @param value  the rating, or the group's name
   */
  async bulk(kind, plugins, value = null) {
    const today = dayString(Date.now());
    const changes = [];
    for (const p of plugins) {
      if (kind === "snooze" || kind === "exclude") {
        const store = this.data[kind === "snooze" ? "snoozed" : "excluded"];
        const after = kind === "snooze" ? p.updated || 0 : today;
        if (store[p.id] === after) continue;
        changes.push({ id: p.id, before: store[p.id] ?? null, after });
        store[p.id] = after;
        continue;
      }
      const note = this.notes.index.get(p.id);
      if (kind === "track") {
        if (note) continue;
        changes.push({ id: p.id, before: false, after: true, created: true });
        await this.track(p, {});
        continue;
      }
      if (kind === "reviewed" && !note) continue;   // only tracked plugins have a review date
      const groups = note?.groups || [];
      if (kind === "group") {
        if (groups.includes(value)) continue;
        changes.push({ id: p.id, before: false, after: true, created: !note });
        await this.track(p, { groups: [...groups, value] });
        continue;
      }
      const after = kind === "reviewed" ? today : value;
      const before = note?.[kind] ?? null;
      if (before === after) continue;
      changes.push({ id: p.id, before, after, created: !note });
      await this.track(p, { [kind]: after });
    }
    const op = { at: Date.now(), kind, value, changes };
    this.data.ops = [op, ...(this.data.ops || [])].slice(0, OPS_CAP);
    await this.saveData(this.data);
    this.redraw();
    return op;
  }

  /** Turns back what an operation did, only where its value is still there (changed since by hand: skipped). */
  async undo(op) {
    let restored = 0;
    let skipped = 0;
    for (const c of op.changes) {
      const p = this.pluginById(c.id);
      const note = this.notes.index.get(c.id);
      let still;
      if (op.kind === "snooze" || op.kind === "exclude") {
        const store = this.data[op.kind === "snooze" ? "snoozed" : "excluded"];
        still = store[c.id] === c.after;
        if (still) { if (c.before == null) delete store[c.id]; else store[c.id] = c.before; }
      } else if (op.kind === "track") {
        still = Boolean(p && note);
        if (still) await this.untrack(p, false);
      } else if (op.kind === "group") {
        still = Boolean(p && note?.groups.includes(op.value));
        if (still) await this.track(p, { groups: note.groups.filter((g) => g !== op.value) });
      } else {
        const field = op.field || op.kind;
        still = Boolean(p && note && note[field] === c.after);
        if (still) await this.track(p, { [field]: c.before || null });   // nothing before: the field goes
      }
      if (still) restored++; else skipped++;
    }
    op.undone = Date.now();
    await this.saveData(this.data);
    this.redraw();
    return { restored, skipped };
  }

  /** Days on which many tracked plugins were marked reviewed together (like the old "Mark all reviewed"), newest first. */
  massReviews(min = 5) {
    const byDay = new Map();
    for (const [id, note] of this.notes.index) if (note.reviewed) byDay.set(note.reviewed, [...(byDay.get(note.reviewed) || []), id]);
    return [...byDay].filter(([, ids]) => ids.length >= min).map(([date, ids]) => ({ date, ids })).sort((a, b) => b.date.localeCompare(a.date));
  }

  /** Takes back the "reviewed" marks of one day, as an operation of its own (so it can be undone too). */
  async unreview(date) {
    const changes = [];
    for (const [id, note] of this.notes.index) {
      const p = note.reviewed === date && this.pluginById(id);
      if (!p) continue;
      changes.push({ id, before: date, after: "" });
      await this.track(p, { reviewed: null });
    }
    const op = { at: Date.now(), kind: "unreviewed", field: "reviewed", value: date, changes };
    this.data.ops = [op, ...(this.data.ops || [])].slice(0, OPS_CAP);
    await this.saveData(this.data);
    this.redraw();
    return op;
  }
}

module.exports = PluginRadar;
Object.assign(core, { TranslationStore, Translator });   // classes: defined after 19-exports.js
module.exports.core = core;  // exposed for tests only
