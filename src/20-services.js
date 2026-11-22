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

  /**
   * A JSON file of the profiles branch (index.json, similar.json), unless it is still `etag` (then null: GitHub
   * answers 304 and sends nothing).
   * @returns {Promise<{json: object, etag: string|null}|null>}
   */
  async profilesFile(file, etag) {
    const url = `${PROFILES_URL}/${file}`;
    const res = await requestUrl({ url, throw: false, headers: etag ? { "If-None-Match": etag } : {} });
    if (res.status === 304) return null;
    if (res.status >= 400) throw new Error(`GitHub ${res.status}: ${url}`);
    const header = Object.entries(res.headers || {}).find(([name]) => name.toLowerCase() === "etag");   // the header's case varies
    return { json: res.json, etag: header?.[1] ?? null };
  }

  /** One plugin's whole profile (problem, capabilities…); null when there's none; throws when it can't be downloaded. */
  async profile(id) {
    const url = `${PROFILES_URL}/profiles/${encodeURIComponent(id)}.json`;
    const res = await requestUrl({ url, throw: false });
    if (res.status === 404) return null;
    if (res.status >= 400) throw new Error(`GitHub ${res.status}: ${url}`);
    return res.json;
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

  path(name, ext = "json") {
    return `${this.dir}/${name}.${ext}`;
  }

  /** Makes the folder of `path` (the cache folder, or one inside it such as readmes/) on its first write. */
  async ensureDir(path) {
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (!(await this.adapter.exists(dir))) await this.adapter.mkdir(dir);
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
    await this.ensureDir(this.path(name));
    await this.adapter.write(this.path(name), JSON.stringify(value));
  }

  async remove(name, ext = "json") {
    if (await this.adapter.exists(this.path(name, ext))) await this.adapter.remove(this.path(name, ext));
  }
}

/**
 * The saved translations, short descriptions (`description`: id → {src, text}) and Overviews (`overview`: id →
 * {src, lang, parts, model, tokens, cost, date}), in their own file beside data.json: data.json is rewritten whole on
 * every save and read at startup, which a catalog's worth of Overviews (~2 KB each) would make slow. One JSON line per
 * translation is appended (the file is never rewritten for a new one), so a crash costs at most the line being
 * written; the last line for an id wins. The cache's clean-ups don't touch it: translations are paid for.
 */
class TranslationStore {
  static KINDS = { d: "description", o: "overview" };   // the line's `k` → the map it fills

  /** @param {() => string} lang  your target language now (for the check of descriptions kept without one) */
  constructor(adapter, dir, lang = () => "") {
    this.adapter = adapter;
    this.lang = lang;
    this.path = normalizePath(`${dir}/translations.jsonl`);
    this.description = {};
    this.overview = {};
    this.writing = Promise.resolve();   // appends and rewrites, one at a time and in order
  }

  /**
   * Reads the file; a broken line (the one a crash cut short) is skipped, two that lost the newline between them
   * (two writers at once, e.g. the plugin reloaded mid-run) are read apart. Rewritten when it's mostly old lines.
   */
  async load() {
    const text = (await this.adapter.exists(this.path)) ? await this.adapter.read(this.path) : "";
    let lines = 0;
    const read = (line) => {
      const { k, id, ...entry } = JSON.parse(line);
      if (TranslationStore.KINDS[k] && id) this[TranslationStore.KINDS[k]][id] = entry;
    };
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      lines++;
      try {
        read(line);
      } catch {
        try {
          line.split(/(?<=\})(?=\{"k":)/).forEach(read);   // only here: splitting every line costs ~100 ms at startup
        } catch {
          console.warn("[Community Radar] skipped a broken line in translations.jsonl");
        }
      }
    }
    if (lines > 1.5 * this.count() + 100) await this.rewrite();   // a translation made again leaves its old line behind
  }

  /**
   * Drops the kept translations that fail the check (translationProblem), from before it existed; new ones are
   * checked as they come (put). Once, as a migration: checking all of them takes ~0.7 s.
   * @returns {Promise<number>} how many went
   */
  async dropUntranslated() {
    let dropped = 0;
    for (const kind of Object.values(TranslationStore.KINDS)) {
      for (const [id, entry] of Object.entries(this[kind])) {
        if (!this.problem(kind, entry)) continue;
        delete this[kind][id];
        dropped++;
      }
    }
    if (dropped) await this.rewrite();
    return dropped;
  }

  /** translationProblem for a translation of `kind` (its own language, else your target language now). */
  problem(kind, entry) {
    const { sources, texts } = translationPairs(kind, entry);
    return translationProblem(sources, texts, entry.lang || this.lang());
  }

  count(kind) {
    return kind ? Object.keys(this[kind]).length : this.count("description") + this.count("overview");
  }

  /**
   * Keeps one translation (`kind`: description | overview) and appends its line, unless it fails the check.
   * @returns {Promise<null|string>} null when kept, else why not (translationProblem); a kept one stays as it was
   */
  async put(kind, id, entry) {
    const problem = this.problem(kind, entry);
    if (problem) return problem;
    this[kind][id] = entry;
    const k = Object.keys(TranslationStore.KINDS).find((key) => TranslationStore.KINDS[key] === kind);
    await this.queue(() => this.adapter.append(this.path, `${JSON.stringify({ k, id, ...entry })}\n`));
    return null;
  }

  /** Forgets every translation of a kind (the file is rewritten without them). */
  clear(kind) {
    this[kind] = {};
    return this.queue(() => this.writeAll());
  }

  rewrite() {
    return this.queue(() => this.writeAll());
  }

  /** The file as it should be: one line per translation. */
  writeAll() {
    const lines = Object.entries(TranslationStore.KINDS)
      .flatMap(([k, kind]) => Object.entries(this[kind]).map(([id, entry]) => `${JSON.stringify({ k, id, ...entry })}\n`));
    return this.adapter.write(this.path, lines.join(""));
  }

  /** Runs a write after the ones before it (a failed one doesn't stop the next). */
  queue(write) {
    this.writing = this.writing.then(write, write);
    return this.writing;
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
   * @param {object} patch  personal fields: {groups?, rating?, status?, note?, reviewed?}
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
        Object.assign(fm, { plugin_id: plugin.id, groups: [], note: "", reviewed: dayString(Date.now()) });
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

  /**
   * Puts a README translation in the note, right above the original, and what it took in its properties:
   * `translation_model`, `translation_tokens` and `translation_cost` (USD, only when the provider reported it).
   * @param {{lang, version, hash, date, body, model, tokens, cost}} translation
   */
  async writeTranslation(file, translation) {
    const heading = t("readme.translatedHeading", { lang: translation.lang });
    await this.app.vault.process(file, (content) => replaceReadmeTranslation(content, translationSection(translation), heading));
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.translation_model = translation.model;
      fm.translation_tokens = translation.tokens;
      if (typeof translation.cost === "number") fm.translation_cost = Number(translation.cost.toFixed(6));
      else delete fm.translation_cost;
      if (translation.from) fm.translation_from = translation.from;   // its English version (README_en.md…)
      else delete fm.translation_from;
    });
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
  static RETRY_MS = [2000, 8000, 30000];   // waits before the 2nd, 3rd and 4th try of a request that failed in passing

  constructor(app, settings) {
    this.app = app;
    this.settings = settings;
    this.watchers = new Set();   // (event, data) => void: "usage" after each reply, "rateLimited" on a 429 (bulk runs)
    this.halted = false;         // a bulk run was stopped: a request waiting to try again gives up
  }

  /**
   * Is thinking turned off for the requests? Only where it can be: the provider has the switch (PROVIDERS[…].thinking)
   * and the model may stop thinking (one that must think would refuse the request; one that never does needs nothing).
   */
  get thinkingOff() {
    const { thinking, provider, modelThinking } = this.settings;
    return thinking === "off" && Boolean(PROVIDERS[provider]?.thinking) && modelThinking !== "mandatory" && modelThinking !== "none";
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
      const error = new Error(`${label} ${res.status}: ${errorDetail(res)}`);
      const header = Object.entries(res.headers || {}).find(([name]) => name.toLowerCase() === "retry-after");
      Object.assign(error, { status: res.status, retryAfter: Number(header?.[1]) || null });   // seconds the provider asks for
      throw error;
    }
    return res.json;
  }

  /**
   * `send()` again after a failure in passing: no connection, a timeout, a rate limit (429) or the provider's own
   * error (5xx), waiting RETRY_MS (or what the provider asks, up to a minute) in between. Other errors (a wrong key,
   * a model that doesn't exist) fail at once; so does every wait once a bulk run is stopped.
   */
  async retrying(send) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await send();
      } catch (error) {
        const passing = error.status == null || error.status === 408 || error.status === 429 || error.status >= 500;
        if (!passing || attempt >= Translator.RETRY_MS.length || this.halted) throw error;
        if (error.status === 429) this.emit("rateLimited", error);
        const wait = error.retryAfter ? Math.min(error.retryAfter * 1000, 60000) : Translator.RETRY_MS[attempt];
        await sleep(wait);
        if (this.halted) throw error;
      }
    }
  }

  emit(event, data) {
    for (const watch of this.watchers) watch(event, data);
  }

  /** The provider's models: [{id, price}] (price only when the list has it). */
  async models(provider) {
    const spec = PROVIDERS[provider];
    const key = this.key(provider);
    if (!spec || !key) throw new Error(t("error.noKey", { name: this.keyName(provider) }));
    return spec.modelList(await this.call(spec.models(key))).sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * One prompt to the chosen model: {text, usage} as the provider reported them. The usage goes to `onUsage` (the AI
   * tab's table and the estimates, under `kind`: description | overview | readme | groups) and to the watchers.
   * A reply cut short (the model ran out of room) is a ReplyError: what came is paid for, but unusable.
   */
  /** One AI request; `model`: another one than Settings' for this request only (Translate again… picks it). */
  async request(prompt, kind, model = this.settings.model) {
    const { provider, routeSort } = this.settings;
    const spec = PROVIDERS[provider];
    const thinking = this.thinkingOff ? "off" : "default";
    const json = await this.retrying(() => this.call(spec.chat(model, this.key(), prompt, { thinking, sort: routeSort })));   // only OpenRouter reads the sort
    const usage = { ...spec.usage(json), chars: prompt.length };
    this.onUsage?.(provider, model, usageKind(kind, thinking), usage);
    this.emit("usage", usage);
    if (spec.truncated?.(json)) throw new ReplyError(t("error.truncated"));
    return { text: spec.text(json), usage };
  }

  /** Translates the texts in one request; output keeps the input order. */
  async translate(texts) {
    return (await this.translateWithUsage(texts)).texts;
  }

  /**
   * translate(), with what it took: {texts, model, tokens, cost} as the provider reported them (sumUsage). A reply
   * that doesn't fit (ReplyError) is asked for again `retries` times; each try is billed and counted.
   */
  async translateWithUsage(texts, kind = "description", retries = 1, model = null) {
    const prompt = translationPrompt(texts, this.settings.targetLang, this.settings.prompts);
    const asked = model || this.settings.model;
    for (let attempt = 0; ; attempt++) {
      try {
        const { text, usage } = await this.request(prompt, kind, asked);
        return { texts: parseTranslations(text, texts.length), ...sumUsage([usage], asked) };
      } catch (error) {
        if (!(error instanceof ReplyError) || attempt >= retries || this.halted) throw error;
      }
    }
  }

  /**
   * Group suggestions for up to AI_BATCH plugins in one request.
   * @param {object[]} plugins  catalog entries
   * @param {{name: string, examples: string[]}[]} groups  the user's groups with a few plugin names each
   * @returns {Promise<Object<string, string[]>>} plugin id → suggestions
   */
  async suggestGroups(plugins, groups) {
    const { text, usage } = await this.request(groupPrompt(plugins, groups, this.settings.targetLang), "groups");
    return { found: parseGroupSuggestions(text, plugins.map((p) => p.id), groups.map((g) => g.name)), usage };
  }

  /**
   * Translates a README into the target language, whole, in one request (today's models take it easily).
   * @returns {Promise<{body: string, model: string, tokens: number, cost: ?number}>} the text and what it took (sumUsage)
   */
  async translateMarkdown(markdown, model = null) {
    const asked = model || this.settings.model;
    const { text, usage } = await this.request(readmePrompt(markdown, this.settings.targetLang, this.settings.prompts), "readme", asked);
    const body = text.trim().replace(/^```(?:markdown|md)?\n([\s\S]*)\n```$/, "$1");   // some models wrap it in a fence
    if (!body) throw new ReplyError(t("error.emptyText"));
    return { body, ...sumUsage([usage], asked) };
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

