// ─── 5. Plugin ──────────────────────────────────────────────────────────────
class PindexPlugin extends Plugin {
  async onload() {
    addIcon(ICON, ICON_SVG);
    this.github = new GitHub();
    this.cache = new Cache(this.app.vault.adapter, this.manifest.dir);
    this.data = Object.assign({ excluded: {}, dismissed: {}, snoozed: {}, groupSuggestions: {}, migrations: {}, aiUsage: {} }, await this.loadData());
    await this.applyLanguage();  // before defaultSettings(), whose folder name depends on the language
    migrateLibraryNames(this.data);   // 0.16 names, before the defaults merge and normalizeHome drop the old ones
    this.data.settings = Object.assign(defaultSettings(), this.data.settings);
    this.data.settings.query = "";   // filters are remembered, the search isn't
    this.data.settings.home = normalizeHome(this.data.settings.home);
    if (!TRANSLATE_FX.includes(this.data.settings.translateFx)) this.data.settings.translateFx = TRANSLATE_FX[0];
    if (this.data.settings.start === "home") this.data.settings.section = "home";
    delete this.data.lastVisit;
    if (!["all", "library", ...LIST_MODES].includes(this.data.settings.mode)) this.data.settings.mode = "all";
    delete this.data.settings.similarTrail;
    delete this.data.settings.historyMonths;
    delete this.data.settings.similarFrom;
    delete this.data.settings.modelPrice;

    this.translations = new TranslationStore(this.app.vault.adapter, this.manifest.dir, () => this.data.settings.targetLang);
    this.notes = new Notes(this.app, this.data.settings);
    this.translator = new Translator(this.app, this.data.settings);
    this.translator.onUsage = (provider, model, kind, usage) => {
      this.data.aiUsage = addUsage(this.data.aiUsage, provider, model, kind, usage);
      this.saveData(this.data).catch((e) => console.warn("[Pindex] saveData", e));
    };
    this.sync = new SyncService(this);
    this.readmes = new ReadmeService(this);
    this.ops = new BulkOps(this);

    this.catalog = null;             // {fetchedAt, plugins}
    this.similar = null;             // parseSimilar(similar.json)
    this.profiles = null;            // index.json ({categories, tags, plugins})
    this.extras = null;              // loadExtras() promise, once
    this.profileFiles = new Map();   // id → profile promise, this session only
    this.settled = false;            // startup over: scheduled syncs may run
    this.timeline = newTimeline();
    this.busy = false;
    this.progress = "";
    this.readmeJobs = new Set();

    this.registerView(VIEW_TYPE, (leaf) => new DiscoveryView(leaf, this));
    this.addRibbonIcon(ICON, t("view.title"), () => this.openView());
    this.addSettingTab(new PindexSettingTab(this.app, this));
    this.watchMotion();
    this.addCommands();

    const relevant = (path) => this.notes.hasPath(path);
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
    this.registerEvent(this.app.workspace.on("file-open", (file) => this.readmes.onNoteOpen(file)));

    let started;
    this.started = new Promise((resolve) => { started = resolve; });
    this.app.workspace.onLayoutReady(async () => {
      try {
        await this.translations.load();
        this.notes.rebuild();
        const [catalog, cached] = await Promise.all([
          this.cache.read("catalog", null),
          this.cache.read("timeline", null),
          this.sync.loadExtras(),
        ]);
        this.catalog = catalog;
        if (cached?.v === TIMELINE_VERSION && cached.source === "server") this.timeline = cached;
        await runMigrations(this);
      } finally {
        started();
      }
      this.redraw();
      this.later(() => {
        this.settled = true;
        this.registerInterval(window.setInterval(() => this.sync.syncIfDue(), SYNC_CHECK_MS));
        this.sync.syncIfDue();
      }, SYNC_DELAY_MS);
    });
  }

  onunload() {
    this.redrawSoon?.cancel?.();
    if (this.translator) this.translator.halted = true;
    if (typeof closeRatingFloat === "function") closeRatingFloat(true);
  }

  /** Serializes `data.json` writes so newer calls never finish before older ones; always writes the latest `data`. */
  saveData(data) {
    if (this.saving) {
      this.pendingData = data;
      this.nextSave ||= this.saving.then(() => {
        const next = this.pendingData;
        this.nextSave = null;
        this.pendingData = null;
        return this.saveData(next);
      });
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

  uiLanguage() {
    const lang = this.data.settings?.language;
    return lang && lang !== "auto" ? lang : obsidianLanguage();
  }

  /**
   * Makes sure the UI language's strings are loaded, then switches to it. English is embedded; any other language
   * comes from the local cache (`cache/locale-<code>.json`) or, on first use, from GitHub. Startup waits at most
   * `wait` ms for that download: past it the UI goes on in English and redraws once the strings arrive. A cached
   * locale from another version, or one missing keys of this build, is refreshed in the background.
   */
  async applyLanguage({ wait = LOCALE_WAIT_MS } = {}) {
    const code = matchLanguage(this.uiLanguage());
    if (code !== "en" && !STRINGS[code]) {
      const cached = await this.cache.read(`locale-${code}`, null);
      if (cached?.strings?.locale) {
        STRINGS[code] = cached.strings;
        if (cached.version !== (this.manifest.version || null) || !isCompleteLocale(cached.strings)) this.fetchLocaleLater(code);
      } else {
        const download = this.fetchLocale(code);
        const timer = new AbortController();
        const done = await Promise.race([download, sleep(wait, timer.signal).then(() => null)]);
        timer.abort();   // clears the timer when the download won
        if (done === null) this.fetchLocaleLater(code, download);   // too slow: go on in English, redraw when it lands
      }
    }
    return setLanguage(code);   // the code even before its strings arrive: t() falls back to English until then
  }

  /** Redraws the views in `code` once its download (`pending`, or a new one) succeeds. */
  fetchLocaleLater(code, pending = this.fetchLocale(code)) {
    pending.then((ok) => { if (ok && language === code) this.redraw(true); });
  }

  /** Downloads `locales/<code>.json` from GitHub and persists it in the plugin cache; returns true on success. */
  async fetchLocale(code) {
    try {
      const strings = await this.github.locale(code, this.manifest.version);
      if (!strings || (STRINGS[code] && localeKeyCount(strings) < localeKeyCount(STRINGS[code]))) return false;
      STRINGS[code] = strings;
      await this.cache.write(`locale-${code}`, { version: this.manifest.version || null, strings });
      return true;
    } catch (error) {
      console.warn(`[Pindex] couldn't download locale "${code}"; falling back to English`, error);
      return false;
    }
  }

  addCommands() {
    const command = (id, name, callback) => this.addCommand({ id, name, callback });
    command("open", t("cmd.open"), () => this.openView());
    command("refresh", t("cmd.refresh"), () => this.sync.refresh());
    command("rebuild-history", t("cmd.rebuild"), () => this.sync.downloadHistory());
    command("readme-current", t("cmd.readmeCurrent"), () => this.updateCurrentReadme());
    command("readme-all", t("cmd.readmeAll"), () => this.readmes.updateReadmes([...this.notes.index.keys()]));
    command("bases-view", t("cmd.base"), () => this.readmes.writeBase());
    this.addCommand({
      id: "group-ungrouped", name: t("cmd.groupUngrouped"),
      checkCallback: (checking) => {
        if (!this.data.settings.aiGroups) return false;
        if (!checking) this.groupUngrouped();
        return true;
      },
    });
    command("readme-translate", t("cmd.readmeTranslate"), () => this.translateCurrentReadme());
    command("similar-current", t("cmd.similarCurrent"), () => this.similarOfCurrent());
    command("recent-actions", t("bulk.recent"), () => new RecentModal(this, async (op) => {
      const { restored, skipped } = await this.ops.undo(op);
      new Notice(t("bulk.undoneN", { n: restored }) + (skipped ? t("bulk.skipped", { n: skipped }) : ""));
    }).open());
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
      timeline: this.timeline,
      profiles: this.profiles?.plugins || {},
      categories: this.profiles?.categories || [],
      translations: this.translations,
      targetLang: this.data.settings.targetLang,
    };
  }

  pluginById(id) {
    const plugins = this.catalog?.plugins;
    const removed = this.timeline?.removed;
    const manifests = this.app.plugins?.manifests;
    if (this.byIdPlugins !== plugins || this.byIdRemoved !== removed || this.byIdManifests !== manifests) {
      this.byIdPlugins = plugins;
      this.byIdRemoved = removed;
      this.byIdManifests = manifests;
      const rows = [...removedRows(removed, manifests), ...(plugins || [])];   // catalog entry wins if relisted
      this.byId = new Map(rows.map((p) => [p.id, p]));
    }
    return this.byId.get(id) || null;
  }

  redraw(full = false) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) (full ? leaf.view.render : leaf.view.refresh)?.call(leaf.view);
  }

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

  /** Runs one long task at a time with progress in the view status line and a Notice (unless `quiet`). */
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
      if (notice) this.later(() => notice.hide(), 6000);
    } catch (error) {
      console.error("[Pindex]", error);
      const failed = notice || new Notice("", 0);
      failed.setMessage(`${label} ✖\n${error.message}`);
      this.later(() => failed.hide(), 12000);
    } finally {
      this.busy = false;
      this.progress = "";
      this.redraw();
    }
  }

  /** Active library note's catalog plugin (ensuring catalog is loaded first), or null with a notice. */
  async activeLibraryPlugin() {
    const file = this.app.workspace.getActiveFile();
    const note = file && noteFromFrontmatter(file.path, this.app.metadataCache.getFileCache(file)?.frontmatter);
    if (!note) { new Notice(t("notice.notLibraryNote")); return null; }
    if (!(await this.sync.ensureCatalog())) return null;
    const plugin = this.pluginById(note.id);
    if (!plugin) { new Notice(t("notice.notLibraryNote")); return null; }
    return { note, plugin };
  }

  async translateCurrentReadme() {
    const active = await this.activeLibraryPlugin();
    if (!active) return;
    await this.task(t("readme.translateTitle", { name: active.plugin.name }), async (progress) => {
      if (await this.readmes.translate(active.plugin, progress, true)) return t("readme.translated", { name: active.plugin.name });
      throw new Error(t("readme.notTranslated"));
    });
  }

  async similarOfCurrent() {
    const active = await this.activeLibraryPlugin();
    if (!active) return;
    await this.openView();
    await this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view.similarFilter.open(active.plugin);
  }

  async updateCurrentReadme() {
    const file = this.app.workspace.getActiveFile();
    const note = file && noteFromFrontmatter(file.path, this.app.metadataCache.getFileCache(file)?.frontmatter);
    if (!note) return new Notice(t("notice.notLibraryNote"));
    await this.readmes.updateReadmes([note.id]);
  }

  // ── AI Translation & Profiles ────────────────────────────────────────────
  profileTranslation(id) {
    return this.translations.overview[id] ?? null;
  }

  overviewTranslated(id, parts) {
    const saved = this.profileTranslation(id);
    return Boolean(saved) && saved.src === profileTexts(parts).join("\n") && saved.lang === this.data.settings.targetLang;
  }

  overviewPending(id) {
    return !overviewCurrent(this.profileTranslation(id), this.profiles?.plugins?.[id]?.summary, this.data.settings.targetLang);
  }

  /** Saved short-description translation; invalid when source description or target language changes. */
  cachedTranslation(plugin) {
    const saved = this.translations.description[plugin.id];
    if (!saved || saved.src !== plugin.description) return null;
    if (saved.lang && saved.lang !== this.data.settings.targetLang) return null;
    return saved.text;
  }

  async translateProfile(plugin, quiet = false, withDescription = false, { model = null, force = false, runId = null } = {}) {
    if (!this.translator.ready) {
      if (!quiet) new Notice(t("notice.translateSetup"));
      return false;
    }
    try {
      const file = await this.sync.loadProfile(plugin.id).catch(() => { throw new Error(t("error.profileMissing")); });
      const parts = profileParts(this.profiles?.plugins?.[plugin.id], file);
      if (!parts) return false;
      if (quiet && this.overviewTranslated(plugin.id, parts)) return true;
      const all = profileTexts(parts);
      const asked = all.map((text, i) => (text ? i : -1)).filter((i) => i >= 0);
      const description = withDescription && plugin.description && (force || this.cachedTranslation(plugin) == null);
      const sent = [...(description ? [plugin.description] : []), ...asked.map((i) => all[i])];
      const done = await this.translator.translateWithUsage(sent, "overview", 1, model, { runId });
      const got = [...done.texts];
      const lang = this.data.settings.targetLang;
      const descProblem = description
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
      return problem ? false : { model: done.model, tokens: done.tokens, cost: done.cost };
    } catch (error) {
      if (quiet) throw error;
      console.error("[Pindex] Overview translation", error);
      new Notice(t("notice.translateFailed", { error: error.message }), 12000);
      return false;
    }
  }

  estimate(kind, { text = "", chars = text.length, requests = 1 }) {
    const s = this.data.settings;
    const tally = this.data.aiUsage?.[`${s.provider}/${s.model}`]?.kinds?.[usageKind(kind, this.translator.thinkingOff ? "off" : "default")];
    const fixed = (kind === "readme" ? readmePrompt("", s.targetLang, s.prompts) : translationPrompt([], s.targetLang, s.prompts)).length;
    return { chars, ...aiEstimate(tally, { chars: chars + requests * fixed, requests }, kind === "overview", s.modelCost) };
  }

  untranslatedDescriptions(plugins) {
    return plugins.filter((p) => p.description && this.cachedTranslation(p) == null);
  }

  pendingOverviews(plugins) {
    return plugins.filter((p) => this.profiles?.plugins?.[p.id] && this.overviewPending(p.id));
  }

  estimateDescriptions(plugins) {
    return this.estimate("description", { text: plugins.map((p) => p.description).join("\n"), requests: Math.ceil(plugins.length / PAGE_SIZE) });
  }

  estimateOverviews(n) {
    return this.estimate("overview", { chars: n * OVERVIEW_CHARS, requests: n });
  }

  async translateWithOverview(plugin) {
    const profile = this.profiles?.plugins?.[plugin.id];
    const parts = profile && profileParts(profile, await this.sync.profileFile(plugin.id));
    if (parts && !this.overviewTranslated(plugin.id, parts)) return Boolean(await this.translateProfile(plugin, false, true));
    return this.translateRows([plugin]);
  }

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

  async retranslate(plugin, model) {
    if (this.profiles?.plugins?.[plugin.id]) return Boolean(await this.translateProfile(plugin, false, true, { model, force: true }));
    return this.translateRows([plugin], { model, force: true });
  }

  profileFacets() {
    if (this.facetsOf !== this.profiles) [this.facetsOf, this.facets] = [this.profiles, profileFacets(this.profiles)];
    return this.facets;
  }

  async translateBatch(batch, model = null, { runId = null } = {}) {
    try {
      const done = await this.translator.translateWithUsage(batch.map((p) => p.description), "description", batch.length > 1 ? 0 : 1, model, { runId });
      const lang = this.data.settings.targetLang;
      const problems = await this.translations.putMany("description", batch.map((p, k) => ({
        id: p.id, entry: { src: p.description, text: done.texts[k], lang, model: done.model },
      })));
      return { rejected: problems.filter(Boolean).length };
    } catch (error) {
      if (!(error instanceof ReplyError) || batch.length < 2 || (runId != null && this.translator.halted)) throw error;
      const half = Math.ceil(batch.length / 2);
      const first = await this.translateBatch(batch.slice(0, half), model, { runId });
      const second = await this.translateBatch(batch.slice(half), model, { runId });
      return { rejected: first.rejected + second.rejected };
    }
  }

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
      console.error("[Pindex] translation", error);
      notice.setMessage(t("notice.translateFailed", { error: error.message }));
      this.later(() => notice.hide(), 12000);
      return false;
    }
  }

  // ── User actions ─────────────────────────────────────────────────────────
  async saveToLibrary(plugin, patch, { adoptReadme = true } = {}) {
    const { file, created } = await this.notes.upsert(plugin, patch);
    if (created && adoptReadme) this.readmes.adopt(plugin, file);
    return created;
  }

  async markSeen(plugin) {
    await this.saveToLibrary(plugin, { reviewed: dayString(Date.now()) });
    this.redraw();
  }

  async toggleLibrary(plugin) {
    if (this.notes.index.has(plugin.id)) return this.removeFromLibrary(plugin);
    await this.saveToLibrary(plugin, {});
    new Notice(t("notice.addedToLibrary", { name: plugin.name }));
  }

  async removeFromLibrary(plugin, ask = true, { redraw = true } = {}) {
    const note = this.notes.index.get(plugin.id);
    const file = note && this.notes.file(plugin.id);
    if (!file) return false;
    const yours = note.groups.length || note.rating || note.status || note.note;
    if (ask && yours && !(await new ConfirmModal(this.app, {
      title: t("removeFromLibrary.title", { name: plugin.name }), plugins: [], text: t("removeFromLibrary.text"), cta: t("action.removeFromLibrary"), footnote: "",
    }).ask())) return false;
    await this.app.fileManager.trashFile(file);
    this.notes.forget(file.path);
    if (ask) new Notice(t("notice.removedFromLibrary", { name: plugin.name }));
    if (redraw) this.redraw();
    return true;
  }

  async chooseGroup(plugin) {
    const modal = new GroupModal(this, plugin);
    modal.open();
    const groups = await modal.result;
    if (!groups) return;
    const created = await this.saveToLibrary(plugin, { groups });
    const message = groups.length ? t("notice.grouped", { name: plugin.name, group: groups.join(", ") }) : t("notice.ungrouped", { name: plugin.name });
    new Notice(message + (created ? t("notice.noteCreated") : ""));
  }

  async setNoteField(plugin, key, value, { redraw = true } = {}) {
    await this.saveToLibrary(plugin, { [key]: value });
    if (redraw) this.redraw();
  }

  // ── Motion, groups, similarity & navigation ──────────────────────────────
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

  applyMotion() {
    const { motion } = this.data.settings;
    const still = motion === "off" || (motion === "system" && this.reducedMotion.matches);
    document.body.classList.toggle(STILL_CLASS, still);
  }

  closestGroupFor(plugin) {
    return closestGroup(plugin.id, this.notes.members(), this.similar, this.profiles?.plugins);
  }

  similarTo(plugin) {
    const profiles = this.profiles?.plugins;
    const mine = profiles?.[plugin.id];
    return similarIds(this.similar, plugin.id)
      .map((id, i) => ({ id, rank: i + 1, p: this.pluginById(id) }))
      .filter((x) => x.p && !(x.id in this.data.excluded) && !isSnoozed(x.p, this.data.snoozed))
      .map(({ p, rank }) => ({ p, rank, shared: sharedFacets(mine, profiles?.[p.id]) }));
  }

  ungrouped() {
    return [...this.notes.index.values()].filter((n) => !n.groups.length).map((n) => this.pluginById(n.id)).filter(Boolean);
  }

  groupExamples() {
    return [...this.notes.members()].map(([name, ids]) => ({ name, examples: ids.slice(0, 3).map((id) => this.pluginById(id)?.name || id) }));
  }

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

  async suggestGroups(plugin) {
    const { lists, usage } = await this.groupSuggestions([plugin]);
    return { list: lists[plugin.id], usage };
  }

  /** Library plugins with a release since you reviewed them (direct scan of library notes, no full catalog sort). */
  updatesCount() {
    let count = 0;
    for (const [id, note] of this.notes.index) {
      const p = this.pluginById(id);
      if (p && isUnreviewed(p, note)) count++;
    }
    return count;
  }

  async groupUngrouped() {
    if (!(await this.sync.ensureCatalog())) return;
    if (!this.ungrouped().length) return new Notice(t("batch.none"));
    if (!this.translator.ready) return new Notice(t("groups.aiSetup"));
    this.app.setting?.close?.();
    await this.openView();
    const { library: _, ...queries } = this.data.settings.queries || {};
    Object.assign(this.data.settings, { section: "list", mode: "library", libraryGroup: UNGROUPED, libraryStatus: "", queries });
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) Object.assign(leaf.view, { preset: null, similar: null, queryDraft: null });
    await this.saveData(this.data);
    this.redraw(true);
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    if (!view) return;
    for (const p of (view.rows || []).slice(0, Math.min(view.visible, AI_BATCH))) view.selected.add(p.id);
    view.bulkBar.syncSelection();
    await view.bulkBar.suggestGroups();
  }

  async showList(mode) {
    this.app.setting?.close?.();
    await this.openView();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) await leaf.view.showHidden?.(mode);
  }

  async showGroup(group) {
    const { library: _, ...queries } = this.data.settings.queries || {};
    Object.assign(this.data.settings, { section: "list", mode: "library", libraryGroup: group, queries });
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) Object.assign(leaf.view, { preset: null, similar: null, queryDraft: null });
    await this.saveData(this.data);
    this.redraw(true);
  }

  openSettings() {
    this.app.setting?.open?.();
    this.app.setting?.openTabById?.(this.manifest.id);
  }
}

module.exports = PindexPlugin;
Object.assign(core, { TranslationStore, Translator });   // classes: defined after 19-exports.js
module.exports.core = core;  // exposed for tests only
