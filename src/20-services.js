// ─── 3. Services ────────────────────────────────────────────────────────────
/** All GitHub requests. `requestUrl` isn't subject to CORS and works on mobile. */
class GitHub {
  async json(url) {
    const res = await requestUrl({ url, throw: false, headers: { Accept: "application/vnd.github+json" } });
    if (res.status === 403 || res.status === 429) throw new Error(t("notice.rateLimit"));
    if (res.status >= 400) throw new Error(`GitHub ${res.status}: ${url}`);
    return res.json;
  }

  async text(url) {
    const res = await requestUrl({ url, throw: false });
    return res.status < 400 ? res.text : null;
  }

  async catalog() {
    const [listing, stats] = await Promise.all([this.json(LISTING_URL), this.json(STATS_URL)]);
    return parseCatalog(listing, stats);
  }

  /** The release history built daily on GitHub: meta.json says when, timeline.json is the history (~600 KB sent). */
  metricsMeta() {
    return this.json(`${METRICS_URL}/meta.json`);
  }

  metricsTimeline() {
    return this.json(`${METRICS_URL}/timeline.json`);
  }

  /** The changes of the last few days (~150 KB): what a daily sync downloads instead of the whole timeline. */
  metricsDelta() {
    return this.json(`${METRICS_URL}/delta.json`);
  }

  /** The semantic vectors' index (ids, build time) and, when asked, the vectors themselves. */
  vectorsMeta() {
    return this.json(`${VECTORS_URL}.json`);
  }

  async vectorsData() {
    const res = await requestUrl({ url: `${VECTORS_URL}.bin`, throw: false });
    if (res.status >= 400) throw new Error(`GitHub ${res.status}: ${VECTORS_URL}.bin`);
    return res.arrayBuffer;
  }

  /** README: tries raw file names first (no rate limit), then falls back to the API (60/hour). */
  async readme(repo) {
    for (const name of ["README.md", "readme.md", "Readme.md", "README.MD"]) {
      const text = await this.text(`${RAW}/${repo}/HEAD/${name}`);
      if (text != null) return text;
    }
    const res = await requestUrl({
      url: `https://api.github.com/repos/${repo}/readme`,
      throw: false,
      headers: { Accept: "application/vnd.github.raw" },
    });
    return res.status < 400 ? res.text : null;
  }
}

/** Rebuildable cache files in the plugin folder. No personal data lives here. */
class Cache {
  constructor(adapter, dir) {
    this.adapter = adapter;
    this.dir = normalizePath(`${dir}/cache`);
  }

  path(name) {
    return `${this.dir}/${name}.json`;
  }

  async read(name, fallback) {
    try {
      return (await this.adapter.exists(this.path(name))) ? JSON.parse(await this.adapter.read(this.path(name))) : fallback;
    } catch (error) {
      console.warn(`[Community Radar] couldn't read the ${name} cache; it will be rebuilt`, error);
      return fallback;
    }
  }

  async write(name, value) {
    if (!(await this.adapter.exists(this.dir))) await this.adapter.mkdir(this.dir);
    await this.adapter.write(this.path(name), JSON.stringify(value));
  }

  async readBinary(name) {
    const path = `${this.dir}/${name}.bin`;
    try {
      return (await this.adapter.exists(path)) ? await this.adapter.readBinary(path) : null;
    } catch (error) {
      console.warn(`[Community Radar] couldn't read the ${name} cache; it will be downloaded again`, error);
      return null;
    }
  }

  async writeBinary(name, buffer) {
    if (!(await this.adapter.exists(this.dir))) await this.adapter.mkdir(this.dir);
    await this.adapter.writeBinary(`${this.dir}/${name}.bin`, buffer);
  }
}

/** Tracking notes in the notes folder: index, creation, properties and README updates. */
class Notes {
  constructor(app, settings) {
    this.app = app;
    this.settings = settings;
    this.index = new Map();  // plugin id → record (noteFromFrontmatter)
  }

  get folder() {
    return normalizePath(this.settings.folder);
  }

  inFolder(file) {
    return file instanceof TFile && file.extension === "md" && file.path.startsWith(`${this.folder}/`);
  }

  /** Markdown files inside the notes folder only; the rest of the vault is never listed. */
  files() {
    const files = [];
    const walk = (folder) => {
      for (const child of folder.children) {
        if (child instanceof TFolder) walk(child);
        else if (child instanceof TFile && child.extension === "md") files.push(child);
      }
    };
    const root = this.app.vault.getAbstractFileByPath(this.folder);
    if (root instanceof TFolder) walk(root);
    return files;
  }

  rebuild() {
    this.index.clear();
    for (const file of this.files()) this.refresh(file);
  }

  /** Mirrors edits made in Bases or by hand into the index. */
  refresh(file) {
    this.forget(file.path);
    if (!this.inFolder(file)) return;
    const note = noteFromFrontmatter(file.path, this.app.metadataCache.getFileCache(file)?.frontmatter);
    if (note) this.index.set(note.id, note);
  }

  forget(path) {
    for (const [id, note] of this.index) if (note.path === path) this.index.delete(id);
  }

  /** Your groups, alphabetical, with how many plugins each holds: [{name, count}]. */
  groups() {
    return [...this.members()].map(([name, ids]) => ({ name, count: ids.length }))
      .sort((a, b) => a.name.localeCompare(b.name, t("locale")));
  }

  /** Group name → ids of the plugins in it. */
  members() {
    const members = new Map();
    for (const note of this.index.values()) {
      for (const g of note.groups) members.set(g, [...(members.get(g) || []), note.id]);
    }
    return members;
  }

  /** Moves 0.6's `group` text into the `groups` list (the old property is removed); returns the count. */
  async migrateGroups() {
    let moved = 0;
    for (const file of this.files()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm?.plugin_id || !("group" in fm)) continue;
      await this.app.fileManager.processFrontMatter(file, (data) => {
        data.groups = groupsOf(data);
        delete data.group;
      });
      this.refresh(file);
      moved++;
    }
    return moved;
  }

  file(id) {
    const note = this.index.get(id);
    const file = note && this.app.vault.getAbstractFileByPath(note.path);
    return file instanceof TFile ? file : null;
  }

  uniquePath(plugin) {
    const base = `${this.folder}/${safeFileName(plugin.name)}`;
    return this.app.vault.getAbstractFileByPath(`${base}.md`) ? `${base} (${safeFileName(plugin.id)}).md` : `${base}.md`;
  }

  /**
   * Creates or updates the note.
   * @param {object} patch  personal fields: {groups?, favorite?, note?, reviewed?}
   * @returns {Promise<{file: TFile, created: boolean}>}
   */
  async upsert(plugin, patch) {
    let file = this.file(plugin.id);
    const created = !file;
    if (created) {
      if (!this.app.vault.getAbstractFileByPath(this.folder)) await this.app.vault.createFolder(this.folder);
      file = await this.app.vault.create(this.uniquePath(plugin), noteBody(this.settings.notesHeading.trim() || undefined));
    }
    let written = {};
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (created) {
        Object.assign(fm, { plugin_id: plugin.id, groups: [], favorite: false, note: "", reviewed: dayString(Date.now()) });
      }
      Object.assign(fm, patch, sourceFields(plugin));
      for (const [key, value] of Object.entries(patch)) if (value == null) delete fm[key];   // null clears a field
      written = { ...fm };
    });
    this.index.set(plugin.id, noteFromFrontmatter(file.path, written));  // don't wait for metadataCache
    return { file, created };
  }

  /** Writes catalog fields only when they changed; returns true when the release date changed. */
  async syncSource(plugin) {
    const file = this.file(plugin.id);
    if (!file) return false;
    const fresh = sourceFields(plugin);
    const current = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
    const changed = Object.entries(fresh).some(([key, value]) => String(current[key] ?? "") !== String(value ?? ""));
    if (changed) await this.app.fileManager.processFrontMatter(file, (fm) => Object.assign(fm, fresh));
    if (current.description == null && plugin.description) await this.app.vault.process(file, (content) => stripDescription(content, plugin.description));
    return String(current.updated ?? "").slice(0, 10) !== String(fresh.updated ?? "");
  }

  async writeReadme(file, plugin, readme) {
    const section = readmeSection(readme, plugin, Date.now());
    await this.app.vault.process(file, (content) => replaceReadme(content, section));
  }

  /** Applies a one-time text change to every tracking note; writes only the notes that change and returns their count. */
  async migrate(transform) {
    let changed = 0;
    for (const file of this.files()) {
      const content = await this.app.vault.cachedRead(file);
      if (transform(content) === content) continue;
      await this.app.vault.process(file, transform);
      changed++;
    }
    return changed;
  }
}

/**
 * The reason in an error reply: its JSON error, else the start of its text. Reading `json` throws when the body
 * isn't JSON (a proxy's HTML 502 page), so that read is guarded.
 */
function errorDetail(res) {
  let detail = null;
  try {
    detail = res.json?.error?.message || res.json?.error;
  } catch {
    // not JSON: the text below says it
  }
  detail ||= res.text?.slice(0, 200) || "";
  return typeof detail === "string" ? detail : JSON.stringify(detail);
}

/**
 * Description translation. The API key lives in Obsidian's keychain (SecretStorage); the plugin only
 * stores the key's NAME (e.g. "anthropic-api-key"), so plugins using the same name share it.
 */
class Translator {
  constructor(app, settings) {
    this.app = app;
    this.settings = settings;
  }

  get supported() {
    return Boolean(this.app.secretStorage && obsidian.SecretComponent);
  }

  keyName(provider = this.settings.provider) {
    return this.settings.keyNames?.[provider] || KEY_NAMES[provider] || "";
  }

  key(provider = this.settings.provider) {
    const name = this.keyName(provider);
    return name && this.app.secretStorage ? this.app.secretStorage.getSecret(name) : null;
  }

  get ready() {
    return Boolean(PROVIDERS[this.settings.provider] && this.settings.model && this.key());
  }

  async call({ url, headers, body }) {
    const res = await requestUrl({
      url,
      method: body ? "POST" : "GET",
      headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      throw: false,
    });
    if (res.status >= 400) {
      const label = PROVIDERS[this.settings.provider]?.label || t("provider.generic");
      throw new Error(`${label} ${res.status}: ${errorDetail(res)}`);
    }
    return res.json;
  }

  /** The provider's models: [{id, price}] (price only when the list has it). */
  async models(provider) {
    const spec = PROVIDERS[provider];
    const key = this.key(provider);
    if (!spec || !key) throw new Error(t("error.noKey", { name: this.keyName(provider) }));
    return spec.modelList(await this.call(spec.models(key))).sort((a, b) => a.id.localeCompare(b.id));
  }

  /** One prompt to the chosen model: its reply text; what it used goes to `onUsage` (the AI tab's table). */
  async chat(prompt) {
    const { provider, model } = this.settings;
    const spec = PROVIDERS[provider];
    const json = await this.call(spec.chat(model, this.key(), prompt));
    this.onUsage?.(provider, model, spec.usage(json));
    return spec.text(json);
  }

  /** Translates the texts in one request; output keeps the input order. */
  async translate(texts) {
    return parseTranslations(await this.chat(translationPrompt(texts, this.settings.targetLang, this.settings.prompts)), texts.length);
  }

  /**
   * Group suggestions for up to AI_BATCH plugins in one request.
   * @param {object[]} plugins  catalog entries
   * @param {{name: string, examples: string[]}[]} groups  the user's groups with a few plugin names each
   * @returns {Promise<Object<string, string[]>>} plugin id → suggestions
   */
  async suggestGroups(plugins, groups) {
    const reply = await this.chat(groupPrompt(plugins, groups, this.settings.targetLang));
    return parseGroupSuggestions(reply, plugins.map((p) => p.id), groups.map((g) => g.name));
  }

  /** Translates a README into the target language, a few sections per request; progress(done, total). */
  async translateMarkdown(markdown, progress = () => {}) {
    const chunks = markdownChunks(markdown);
    const out = [];
    for (const [i, chunk] of chunks.entries()) {
      progress(i, chunks.length);
      const reply = await this.chat(readmePrompt(chunk, this.settings.targetLang, this.settings.prompts));
      out.push(reply.trim().replace(/^```(?:markdown|md)?\n([\s\S]*)\n```$/, "$1"));   // some models wrap it in a fence
    }
    return out.join("\n\n");
  }

  /** A one-line translation to confirm that the provider, key and model work together. */
  async test() {
    const [sample] = await this.translate(["A plugin that tracks new releases."]);
    return sample;
  }

  /** Copies keys saved under 0.2's plugin-specific names to the shared suggested names. */
  migrateLegacyKeys() {
    if (!this.app.secretStorage) return 0;
    let moved = 0;
    for (const provider of Object.keys(PROVIDERS)) {
      const legacy = this.app.secretStorage.getSecret(`plugin-tracker-${provider}-key`);
      if (legacy && !this.app.secretStorage.getSecret(KEY_NAMES[provider])) {
        this.app.secretStorage.setSecret(KEY_NAMES[provider], legacy);
        moved++;
      }
    }
    return moved;
  }
}

