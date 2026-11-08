// ─── 5. Plugin ──────────────────────────────────────────────────────────────
class PluginRadar extends Plugin {
  async onload() {
    addIcon(ICON, ICON_SVG);
    this.data = Object.assign({ excluded: {}, dismissed: {}, snoozed: {}, translations: {}, groupSuggestions: {}, migrations: {} }, await this.loadData());
    setLanguage(this.uiLanguage());  // before defaultSettings(), whose folder name depends on the language
    this.data.settings = Object.assign(defaultSettings(), this.data.settings);
    this.data.settings.query = "";   // filters are remembered, the search isn't
    if (this.data.settings.mode === "changed") Object.assign(this.data.settings, { mode: "tracked", trackedGroup: UPDATES });   // 0.7.2's tab
    if (this.data.settings.mode === SIMILAR_MODE && !this.data.settings.similarTrail?.length) this.data.settings.mode = "all";
    this.github = new GitHub();
    this.cache = new Cache(this.app.vault.adapter, this.manifest.dir);
    this.notes = new Notes(this.app, this.data.settings);
    this.translator = new Translator(this.app, this.data.settings);
    this.catalog = null;                                      // {fetchedAt, plugins}
    this.vectors = null;                                      // semantic Similar (parseVectors); null → word matching
    this.timeline = newTimeline(this.data.settings.historyMonths);
    this.busy = false;
    this.progress = "";             // the running task's progress, shown in the view's status line
    this.readmeJobs = new Set();    // plugin ids whose README is being fetched
    this.similarCache = new Map();  // "id|limit|excluded" → similarTo result

    this.registerView(VIEW_TYPE, (leaf) => new DiscoveryView(leaf, this));
    this.addRibbonIcon(ICON, t("view.title"), () => this.openView());
    this.addSettingTab(new RadarSettingTab(this.app, this));
    this.addCommands();

    // Only changes inside the notes folder refresh the view, so typing elsewhere stays quiet
    const relevant = (path) => path.startsWith(`${this.notes.folder}/`);
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      if (!relevant(file.path)) return;
      this.notes.refresh(file);
      this.redraw();
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (!relevant(file.path)) return;
      this.notes.forget(file.path);
      this.redraw();
    }));
    this.registerEvent(this.app.vault.on("rename", (file, old) => {
      if (!relevant(file.path) && !relevant(old)) return;
      this.notes.forget(old);
      this.notes.refresh(file);
      this.redraw();
    }));

    this.registerEvent(this.app.workspace.on("file-open", (file) => this.onNoteOpen(file)));

    this.app.workspace.onLayoutReady(async () => {
      await this.importLegacyPlugin();
      this.notes.rebuild();
      this.catalog = await this.cache.read("catalog", null);
      this.timeline = upgradeTimeline(await this.cache.read("timeline", this.timeline));
      this.vectors = parseVectors(await this.cache.read("vectors", null), await this.cache.readBinary("vectors"));
      await this.runMigrations();
      this.redraw();
      this.registerInterval(window.setInterval(() => this.syncIfDue(), SYNC_CHECK_MS));
      await this.syncIfDue();
    });
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
    const hasOwnData = Object.keys(this.data.excluded).length || Object.keys(this.data.translations).length;
    let legacyDir = null;
    for (const id of LEGACY_PLUGIN_IDS) {
      const dir = normalizePath(`${this.app.vault.configDir}/plugins/${id}`);
      if (await adapter.exists(`${dir}/data.json`)) { legacyDir = dir; break; }
    }
    if (hasOwnData || !legacyDir) return this.saveData(this.data);
    try {
      const legacy = JSON.parse(await adapter.read(`${legacyDir}/data.json`));
      for (const key of ["excluded", "dismissed", "translations"]) this.data[key] = { ...legacy[key], ...this.data[key] };
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

  /** One-time changes applied to notes and keys when upgrading. */
  async runMigrations() {
    const done = this.data.migrations;
    if (!done.h1Headings) {
      const changed = await this.notes.migrate(migrateHeadings);
      done.h1Headings = dayString(Date.now());
      if (changed) new Notice(t("notice.headings", { n: changed }));
    }
    if (!done.groupsList) {
      const moved = await this.notes.migrateGroups();
      done.groupsList = dayString(Date.now());
      if (moved) new Notice(t("notice.groupsMigrated", { n: moved }), 10000);
    }
    if (!done.statusKeys) {   // 0.7.1's statuses → the new ones
      const moved = await this.notes.migrate((content) => content.replace(/^status: (candidate|trying|using|dropped)[ \t]*$/m, (all, old) => `status: ${LEGACY_STATUS[old]}`));
      done.statusKeys = dayString(Date.now());
      if (moved) new Notice(t("notice.statusMigrated", { n: moved }), 10000);
    }
    if (!done.readmeMarkers) {
      await this.notes.migrate(migrateMarkers);
      done.readmeMarkers = dayString(Date.now());
    }
    if (!done.readmeImages) {
      await this.notes.migrate(migrateImages);
      done.readmeImages = dayString(Date.now());
    }
    if (!done.keyNames) {
      const moved = this.translator.migrateLegacyKeys();
      done.keyNames = dayString(Date.now());
      if (moved) new Notice(t("notice.keysMoved", { n: moved, example: KEY_NAMES.anthropic }));
    }
    await this.saveData(this.data);
  }

  addCommands() {
    const command = (id, name, callback) => this.addCommand({ id, name, callback });
    command("open", t("cmd.open"), () => this.openView());
    command("refresh", t("cmd.refresh"), () => this.refresh());
    command("rebuild-history", t("cmd.rebuild"), () => this.buildHistory(true));
    command("readme-current", t("cmd.readmeCurrent"), () => this.updateCurrentReadme());
    command("readme-all", t("cmd.readmeAll"), () => this.updateReadmes([...this.notes.index.keys()]));
    command("bases-view", t("cmd.base"), () => this.writeBase());
    command("group-ungrouped", t("cmd.groupUngrouped"), () => this.groupUngrouped());
    command("readme-translate", t("cmd.readmeTranslate"), () => this.translateCurrentReadme());
  }

  // ── State ────────────────────────────────────────────────────────────────
  /** Installed community plugins. `app.plugins` isn't part of the public API, so it's read defensively. */
  installed() {
    return new Set(Object.keys(this.app.plugins?.manifests || {}));
  }

  state() {
    return {
      catalog: this.catalog?.plugins || [],
      releases: this.timeline.releases,
      firstSeen: this.timeline.firstSeen,
      notes: this.notes.index,
      excluded: new Set(Object.keys(this.data.excluded)),
      dismissed: new Set(Object.keys(this.data.dismissed)),
      snoozed: this.data.snoozed,
      installed: this.installed(),
    };
  }

  pluginById(id) {
    return this.catalog?.plugins.find((p) => p.id === id) || null;
  }

  /** Updates open views; `full` rebuilds them (e.g. after a language change). */
  redraw(full = false) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) (full ? leaf.view.render : leaf.view.refresh)?.call(leaf.view);
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

  /** On opening the view: sync when there is no data yet, otherwise follow the sync frequency. */
  async ensureFresh() {
    if (!this.catalog) await this.refresh();
    else await this.syncIfDue();
  }

  /** Quietly syncs when the chosen interval has passed; makes no request otherwise or when set to manual. */
  async syncIfDue() {
    const hours = this.data.settings.syncHours;
    const age = this.catalog ? Date.now() - this.catalog.fetchedAt : Infinity;
    if (hours > 0 && age >= hours * HOUR_MS) await this.refresh({ quiet: true });
  }

  async ensureCatalog() {
    if (!this.catalog) await this.refresh();
    return Boolean(this.catalog);
  }

  refresh({ quiet = false } = {}) {
    return this.task(t("notice.refreshing"), async (progress) => {
      progress(t("notice.downloadingCatalog"));
      const plugins = await this.github.catalog();
      const delta = this.catalog ? catalogDelta(this.catalog.plugins, plugins) : null;
      this.catalog = { fetchedAt: Date.now(), plugins, delta };
      for (const p of plugins) if (p.id in this.data.snoozed && !isSnoozed(p, this.data.snoozed)) delete this.data.snoozed[p.id];
      await this.saveData(this.data);
      await this.cache.write("catalog", this.catalog);

      if (this.timeline.to) await this.syncTimeline(false, progress);
      await this.syncVectors(progress);

      progress(t("notice.updatingNotes"));
      const released = [];
      for (const id of [...this.notes.index.keys()]) {
        const plugin = this.pluginById(id);
        if (plugin && (await this.notes.syncSource(plugin))) released.push(id);
      }
      if (released.length && this.data.settings.readmeMode === "sync") await this.fetchReadmes(released, progress);
      return t("notice.refreshed", { n: formatCount(this.catalog.plugins.length), released: released.length });
    }, { quiet });
  }

  /** Downloads the semantic vectors when a newer build is out; a failure only leaves Similar on word matching. */
  async syncVectors(progress) {
    try {
      const meta = await this.github.vectorsMeta();
      if (this.vectors && meta.built === this.vectors.built) return;
      progress(t("notice.vectors"));
      const vectors = parseVectors(meta, await this.github.vectorsData());
      if (!vectors) throw new Error("vector file doesn't match its index");
      await this.cache.write("vectors", meta);
      await this.cache.writeBinary("vectors", vectors.data.buffer);
      this.vectors = vectors;
      this.similarCache.clear();
    } catch (error) {
      console.warn("[Community Radar] couldn't update the semantic vectors; Similar uses words", error);
    }
  }

  buildHistory(rebuild) {
    return this.task(t("notice.history"), (progress) => this.syncTimeline(rebuild, progress));
  }

  /**
   * Downloads the missing days' snapshots and merges them into the history. After a long break it
   * fills every missing day; it saves after each batch, so an interrupted run keeps its progress.
   */
  async syncTimeline(rebuild, progress) {
    const now = Date.now();
    if (rebuild || !this.timeline.to) this.timeline = newTimeline(this.data.settings.historyMonths);
    const since = this.timeline.to || now - this.timeline.months * MONTH_MS;

    progress(t("notice.listingSnapshots"));
    const snapshots = selectSnapshots(await this.github.statsCommits(since), now);
    for (let i = 0; i < snapshots.length; i += PARALLEL) {
      const batch = snapshots.slice(i, i + PARALLEL);
      const stats = await mapLimit(batch, PARALLEL, (s) => this.github.snapshot(s.sha));
      stats.forEach((s, k) => mergeSnapshot(this.timeline, s, batch[k].date));  // order kept: oldest first
      this.timeline.from ||= batch[0].date;
      this.timeline.to = batch[batch.length - 1].date;
      await this.cache.write("timeline", this.timeline);
      progress(t("notice.snapshotProgress", { done: Math.min(i + PARALLEL, snapshots.length), total: snapshots.length, date: dayString(this.timeline.to) }));
    }
    return snapshots.length
      ? t("notice.historyDone", { label: historyLabel(this.timeline.months), from: dayString(this.timeline.from), to: dayString(this.timeline.to), n: snapshots.length })
      : t("notice.historyCurrent");
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

  /** "When I open the note" mode: an opened tracking note whose README is older than the release gets a fresh one. */
  async onNoteOpen(file) {
    if (this.data.settings.readmeMode !== "open" || !this.notes.inFolder(file)) return;
    const note = [...this.notes.index.values()].find((n) => n.path === file.path);
    const plugin = note && this.pluginById(note.id);
    if (!plugin?.version || readmeVersion(await this.app.vault.cachedRead(file)) === plugin.version) return;
    await this.refreshReadme(plugin, file);
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

  /** The README and its translation as kept in the tracking note: {original, translation}; nulls when missing. */
  async readmeParts(plugin) {
    const file = this.notes.file(plugin.id);
    if (!file) return { original: null, translation: null };
    const content = await this.app.vault.cachedRead(file);
    return { original: readmeText(content), translation: readmeTranslation(content) };
  }

  /**
   * Translates a plugin's README into the target language and keeps it in its tracking note, right above
   * the original (a note is created when there is none; the README is fetched when missing or older than
   * the release). Asked for only by the user; true when done.
   */
  async translateReadme(plugin, progress = () => {}) {
    if (!this.translator.ready) {
      new Notice(t("notice.translateSetup"));
      return false;
    }
    try {
      if (!this.notes.file(plugin.id)) await this.notes.upsert(plugin, {});
      const file = this.notes.file(plugin.id);
      let content = await this.app.vault.read(file);
      if (!readmeText(content) || readmeVersion(content) !== plugin.version) {
        progress(t("notice.readme"));
        await this.notes.writeReadme(file, plugin, plugin.repo ? await this.github.readme(plugin.repo) : null);
        content = await this.app.vault.read(file);
      }
      const original = readmeText(content);
      if (!original) throw new Error(t("readme.failed"));
      const lang = this.data.settings.targetLang;
      const body = await this.translator.translateMarkdown(original, (done, total) => progress(t("readme.translating", { done: done + 1, total })));
      const section = `${t("readme.translationMeta", { lang, version: plugin.version || "?", date: dayString(Date.now()) })}\n\n${body}`;
      await this.app.vault.process(file, (text) => replaceReadmeTranslation(text, section, t("readme.translatedHeading", { lang })));
      return true;
    } catch (error) {
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

  async updateCurrentReadme() {
    const file = this.app.workspace.getActiveFile();
    const note = file && noteFromFrontmatter(file.path, this.app.metadataCache.getFileCache(file)?.frontmatter);
    if (!note) return new Notice(t("notice.notTracking"));
    await this.updateReadmes([note.id]);
  }

  // ── Translation ──────────────────────────────────────────────────────────
  /** Saved translation; invalid once the description changes. */
  cachedTranslation(plugin) {
    const saved = this.data.translations[plugin.id];
    return saved && saved.src === plugin.description ? saved.text : null;
  }

  /** Translates untranslated descriptions in single requests of up to 50 and saves them. True on success. */
  async translateRows(plugins) {
    const pending = plugins.filter((p) => p.description && this.cachedTranslation(p) == null);
    if (!pending.length) return true;
    if (!this.translator.ready) {
      new Notice(t("notice.translateSetup"));
      return false;
    }
    const notice = new Notice(t("notice.translating", { n: pending.length }), 0);
    try {
      for (let i = 0; i < pending.length; i += PAGE_SIZE) {
        const batch = pending.slice(i, i + PAGE_SIZE);
        const texts = await this.translator.translate(batch.map((p) => p.description));
        batch.forEach((p, k) => { this.data.translations[p.id] = { src: p.description, text: texts[k] }; });
        await this.saveData(this.data);
      }
      notice.hide();
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
    if (created) this.refreshReadme(plugin, file);  // not awaited: the note is usable right away
    return created;
  }

  async toggleFavorite(plugin) {
    const favorite = !this.notes.index.get(plugin.id)?.favorite;
    const created = await this.track(plugin, { favorite });
    new Notice(t("notice.favorite", { star: favorite ? "★" : "☆", name: plugin.name }) + (created ? t("notice.noteCreated") : ""));
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
  /** Word index of the current catalog, built once per catalog. */
  textIndex() {
    if (this.indexedCatalog !== this.catalog) {
      this.indexedCatalog = this.catalog;
      this.wordIndex = textIndex(this.catalog?.plugins || []);
    }
    return this.wordIndex;
  }

  closestGroupFor(plugin) {
    return closestGroup(plugin, this.notes.members(), this.textIndex());
  }

  /**
   * [{p, score, match, shared, cosine?}], best match first: by meaning when the vectors are in
   * (semanticPlugins), by words otherwise (similarPlugins). Cached per plugin until the data changes.
   */
  similarTo(plugin, limit = SIMILAR_LIST) {
    const key = `${plugin.id}|${limit}`;
    if (this.similarCatalog !== this.catalog) {
      this.similarCatalog = this.catalog;
      this.similarCache.clear();
    }
    if (!this.similarCache.has(key)) {
      const catalog = this.catalog?.plugins || [];
      const options = { exclude: new Set(Object.keys(this.data.excluded)), limit };
      const found = (this.vectors && semanticPlugins(plugin, catalog, this.vectors, this.textIndex(), options))
        || similarPlugins(plugin, catalog, this.textIndex(), options);
      this.similarCache.set(key, found);
    }
    return this.similarCache.get(key);
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
   */
  async groupSuggestions(plugins, progress = () => {}) {
    const saved = this.data.groupSuggestions;
    const missing = plugins.filter((p) => saved[p.id]?.src !== p.description);
    const groups = this.groupExamples();
    for (let i = 0; i < missing.length; i += AI_BATCH) {
      progress(t("batch.requesting", { done: Math.min(i + AI_BATCH, missing.length), total: missing.length }));
      const batch = missing.slice(i, i + AI_BATCH);
      const found = await this.translator.suggestGroups(batch, groups);
      for (const p of batch) saved[p.id] = { src: p.description, list: found[p.id] };
      await this.saveData(this.data);
    }
    return Object.fromEntries(plugins.map((p) => [p.id, saved[p.id]?.list || []]));
  }

  async suggestGroups(plugin) {
    return (await this.groupSuggestions([plugin]))[plugin.id];
  }

  /** Opens the Tracked tab on Ungrouped and starts grouping mode there; nothing is written before Accept. */
  /** Tracked plugins with a release since you reviewed them (the Tracked tab's badge). */
  updatesCount(state = this.state(), now = Date.now()) {
    return discover(state, { ...modeOptions(this.data.settings, "tracked"), trackedGroup: UPDATES, trackedStatus: "", query: "" }, now).length;
  }

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
    await view?.startGrouping((view.rows || []).slice(0, view.visible));
  }

  async exclude(plugin) {
    this.data.excluded[plugin.id] = dayString(Date.now());
    this.similarCache.clear();
    await this.saveData(this.data);
    new Notice(t("notice.excluded", { name: plugin.name }));
  }

  async dismiss(plugin) {
    this.data.dismissed[plugin.id] = dayString(Date.now());
    await this.saveData(this.data);
  }

  /** Hides a plugin until it ships a release newer than the current one. */
  async snooze(plugin) {
    this.data.snoozed[plugin.id] = plugin.updated || 0;
    await this.saveData(this.data);
    new Notice(t("notice.snoozed", { name: plugin.name }));
  }

  /** Ignored list = ignored plugins + those hidden until their next release. */
  ignoredCount() {
    const snoozed = (this.catalog?.plugins || []).filter((p) => isSnoozed(p, this.data.snoozed) && !(p.id in this.data.excluded)).length;
    return Object.keys(this.data.excluded).length + snoozed;
  }

  /** Brings plugins back from the Ignored (also un-snoozes) or Hidden suggestions list. */
  async restoreFrom(mode, ids) {
    for (const id of ids) {
      if (mode === "ignored") { delete this.data.excluded[id]; delete this.data.snoozed[id]; }
      else delete this.data.dismissed[id];
    }
    this.similarCache.clear();
    await this.saveData(this.data);
    this.redraw();
  }

  /** Writes one personal property of a tracked plugin's note; null removes it. */
  async setNoteField(plugin, key, value) {
    await this.track(plugin, { [key]: value });
    this.redraw();
  }

  /** Opens the view on a list mode (Ignored, Hidden suggestions). */
  async showList(mode) {
    this.app.setting?.close?.();
    await this.openView();
    this.data.settings.mode = mode;
    await this.saveData(this.data);
    this.redraw(true);
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

  async markReviewed(plugins) {
    const today = dayString(Date.now());
    for (const plugin of plugins) {
      const file = this.notes.file(plugin.id);
      if (!file) continue;
      await this.app.fileManager.processFrontMatter(file, (fm) => { fm.reviewed = today; });
      this.notes.index.get(plugin.id).reviewed = today;
    }
    this.redraw();
  }

}

module.exports = PluginRadar;
module.exports.core = core;  // exposed for tests only
