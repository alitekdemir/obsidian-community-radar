// ─── 3d. ReadmeService (fetching, caching, note adoption, README translation) ─
/** Manages README fetching, note/cache storage, deduplication and Markdown translation. */
class ReadmeService {
  constructor(plugin) {
    this.plugin = plugin;
  }

  /** Runs an async README job deduplicated by plugin id so parallel callers share one fetch/write. */
  serialize(id, work) {
    const jobs = this.plugin.readmeJobs;
    if (jobs.has(id)) return null;
    jobs.add(id);
    return Promise.resolve().then(work).finally(() => jobs.delete(id));
  }

  cacheName(id) {
    return `readmes/${safeFileName(id)}`;
  }

  /** Fetches one plugin's README into its note (or cache); logs instead of throwing, so one failure never stops a batch. */
  async fetchIntoNote(plugin) {
    if (!plugin) return;
    try {
      await this.fetch(plugin);   // keep() never replaces a README you have with nothing
    } catch (error) {
      console.warn(`[Pindex] couldn't fetch README for ${plugin.id}`, error);
    }
  }

  /** Fetches READMEs for `ids` with concurrency limit; transient GitHub errors keep existing READMEs untouched. */
  async fetchReadmes(ids, progress) {
    const p = this.plugin;
    let done = 0;
    await mapLimit(ids, PARALLEL, async (id) => {
      await this.fetchIntoNote(p.pluginById(id));
      progress?.(t("notice.readmeProgress", { done: ++done, total: ids.length }));
    });
  }

  async updateReadmes(ids) {
    const p = this.plugin;
    if (!(await p.sync.ensureCatalog())) return;
    await p.task(t("notice.readme"), async (progress) => {
      await this.fetchReadmes(ids, progress);
      return t("notice.readmeDone", { n: ids.length });
    });
  }

  /** Opened library note: marks its new release as seen, and in "open" mode refreshes stale READMEs. */
  async onNoteOpen(file) {
    const p = this.plugin;
    if (!p.notes.inFolder(file)) return;
    const note = [...p.notes.index.values()].find((n) => n.path === file.path);
    const plugin = note && p.pluginById(note.id);
    if (!plugin) return;
    if (isUnreviewed(plugin, note)) await p.markSeen(plugin);
    if (p.data.settings.readmeMode !== "open" || !plugin.version || readmeVersion(await p.app.vault.cachedRead(file)) === plugin.version) return;
    await this.refreshReadme(plugin);
  }

  /** Fetches one README in the background; ignored if a job for `plugin.id` is already running. */
  async refreshReadme(plugin) {
    if (!plugin.repo) return;
    await this.serialize(plugin.id, () => this.fetchIntoNote(plugin));
  }

  async openReadme(plugin) {
    const p = this.plugin;
    if (!p.notes.file(plugin.id)) await p.saveToLibrary(plugin, {});
    const file = p.notes.file(plugin.id);
    if (file) await p.app.workspace.openLinkText(`${file.path}#README`, "", "tab");
  }

  basePath() {
    const folder = this.plugin.notes.folder || t("default.folder");
    return normalizePath(`${folder}.base`);
  }

  async writeBase() {
    const p = this.plugin;
    const path = this.basePath();
    const content = baseFile(p.notes.folder);
    const existing = p.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await p.app.vault.modify(existing, content);
    } else {
      const parent = path.split("/").slice(0, -1).join("/");
      if (parent && !p.app.vault.getAbstractFileByPath(parent)) await p.app.vault.createFolder(parent);
      await p.app.vault.create(path, content);
    }
    new Notice(t(existing ? "notice.baseReset" : "notice.baseCreated", { path }));
    await p.app.workspace.openLinkText(path, "", "tab");
  }

  async parts(plugin) {
    const p = this.plugin;
    const file = p.notes.file(plugin.id);
    if (file) {
      const content = await p.app.vault.cachedRead(file);
      const text = readmeText(content);
      const saved = readmeTranslation(content);
      const fm = p.app.metadataCache.getFileCache(file)?.frontmatter || {};
      return {
        source: "note",
        original: text && { text, ...readmeMeta(content), hash: textHash(text) },
        translation: saved && {
          ...saved, model: fm.translation_model ?? null, tokens: fm.translation_tokens ?? null,
          cost: fm.translation_cost ?? null, from: fm.translation_from ?? null,
        },
      };
    }
    const entry = await p.cache.read(this.cacheName(plugin.id), null);
    const text = entry?.readme != null ? readmeBody(entry.readme, plugin.repo).trim() : null;
    return {
      source: entry ? "cache" : null,
      original: text && { text, version: entry.version, date: entry.fetched, hash: textHash(text) },
      translation: entry?.translation || null,
    };
  }

  async source(plugin, text) {
    const p = this.plugin;
    const own = { text, name: "README.md" };
    const [all, latin, mine] = letterCounts(text, scriptOfLanguage(p.data.settings.targetLang));
    if (!all || 1 - latin / all <= FOREIGN_README || mine / all > FOREIGN_README) return own;
    const url = englishLink(text, plugin.repo);
    const linked = url ? await p.github.text(url).catch(() => null) : null;
    if (linked && isEnglishText(linked)) return { text: linked, name: safeDecodeURI(url.split("/").pop()) };
    const section = englishSection(text);
    return section ? { text: section, name: "README.md#English" } : own;
  }

  translationSource(text) {
    return this.plugin.data.settings.readmeSaving ? skipDevSections(text) : { text, skipped: [] };
  }

  async keep(plugin, readme) {
    const p = this.plugin;
    const file = p.notes.file(plugin.id);
    if (file) {
      if (readme == null && readmeText(await p.app.vault.cachedRead(file))) return;   // never clobber existing README with null
      return p.notes.writeReadme(file, plugin, readme);
    }
    if (readme == null) return;
    const name = this.cacheName(plugin.id);
    await p.cache.write(name, { ...(await p.cache.read(name, {})), readme, version: plugin.version ?? null, fetched: dayString(Date.now()) });
  }

  async fetch(plugin) {
    if (!plugin.repo) return;
    const text = await this.plugin.github.readme(plugin.repo);
    await this.keep(plugin, text);
  }

  async newer(plugin, original) {
    let readme;
    try {
      readme = plugin.repo ? await this.plugin.github.readme(plugin.repo) : null;
    } catch {
      return null;
    }
    if (readme == null) return null;
    if (textHash(readmeBody(readme, plugin.repo).trim()) !== original.hash) return readme;
    await this.keep(plugin, readme);
    return null;
  }

  /** Adopts cached README and translation into a newly created note (serialized with readmeJobs, never throws unhandled). */
  async adopt(plugin, file) {
    const p = this.plugin;
    await this.serialize(plugin.id, async () => {
      try {
        const name = this.cacheName(plugin.id);
        const entry = await p.cache.read(name, null);
        if (!p.app.vault.getAbstractFileByPath(file.path)) return;   // note deleted before adoption ran
        if (entry?.readme != null && entry.version === (plugin.version ?? null)) {
          await p.notes.writeReadme(file, plugin, entry.readme);
        } else if (plugin.repo) {
          const text = await p.github.readme(plugin.repo);
          if (text != null) await p.notes.writeReadme(file, plugin, text);
        }
        if (!entry) return;
        if (entry.translation) await p.notes.writeTranslation(file, entry.translation);
        await p.cache.remove(name);
      } catch (error) {
        console.warn("[Pindex] couldn't adopt README", error);
      }
    });
  }

  async translate(plugin, progress = () => {}, quiet = false, model = null, { runId = null } = {}) {
    const p = this.plugin;
    if (!p.translator.ready) {
      if (!quiet) new Notice(t("notice.translateSetup"));
      return false;
    }
    try {
      let { original } = await this.parts(plugin);
      if (!original || (plugin.version && original.version !== plugin.version)) {
        progress(t("notice.readme"));
        await this.fetch(plugin);
        ({ original } = await this.parts(plugin));
      }
      if (!original) throw new Error(t("readme.failed"));
      progress(t("readme.translating"));
      const source = await this.source(plugin, original.text);
      const { text, skipped } = this.translationSource(source.text);
      const done = await p.translator.translateMarkdown(text, model, { runId });
      if (skipped.length) done.body += `\n\n*${t("readme.skipped", { list: skipped.join(" · ") })}*`;
      const translation = {
        ...done, lang: p.data.settings.targetLang, version: original.version, hash: original.hash, date: dayString(Date.now()),
        from: source.name === "README.md" ? null : source.name,
      };
      const file = p.notes.file(plugin.id);
      if (file) await p.notes.writeTranslation(file, translation);
      else {
        const name = this.cacheName(plugin.id);
        await p.cache.write(name, { ...(await p.cache.read(name, {})), translation });
      }
      return { model: done.model, tokens: done.tokens, cost: done.cost };
    } catch (error) {
      if (quiet) throw error;
      console.error("[Pindex] README translation", error);
      new Notice(t("notice.translateFailed", { error: error.message }), 12000);
      return false;
    }
  }

  /** Counts and estimates downloaded READMEs not yet translated (or stale), reading files concurrently. */
  async untranslated() {
    const p = this.plugin;
    const adapter = p.app.vault.adapter;
    const dir = `${p.cache.dir}/readmes`;
    const cached = new Set((await adapter.exists(dir)) ? (await adapter.list(dir)).files : []);
    const candidates = (p.catalog?.plugins || []).filter((x) => p.notes.file(x.id) || cached.has(p.cache.path(this.cacheName(x.id))));
    const texts = [];
    await mapLimit(candidates, 8, async (item) => {
      const { original, translation } = await this.parts(item);
      if (original && translation?.hash !== original.hash) texts.push(this.translationSource(original.text).text);
    });
    return { n: texts.length, estimate: p.estimate("readme", { text: texts.join("\n"), requests: texts.length }) };
  }
}
