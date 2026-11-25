// ─── 3c. SyncService (catalog, timeline, profiles, similar) ──────────────────
/** Coordinates remote GitHub data refreshes, ETag-guarded profile/similar caches, and per-plugin profile loading. */
class SyncService {
  constructor(plugin) {
    this.plugin = plugin;
  }

  /** Loads AI profiles and Similar lists from local cache once. */
  loadExtras() {
    const p = this.plugin;
    p.extras ||= (async () => {
      const [profiles, similar] = await Promise.all([p.cache.read("profiles", null), p.cache.read("similar", null)]);
      p.profiles = profiles;
      p.similar = parseSimilar(similar);
    })();
    return p.extras;
  }

  /** On opening the view: sync when there is no data yet, otherwise follow sync frequency (not during startup). */
  async ensureFresh() {
    await this.plugin.started;
    if (!this.plugin.catalog) await this.refresh();
    else if (this.plugin.settled) await this.syncIfDue();
  }

  /** Quietly syncs when the chosen interval has passed; makes no request otherwise or when set to manual. */
  async syncIfDue() {
    const hours = this.plugin.data.settings.syncHours;
    const age = this.plugin.catalog ? Date.now() - this.plugin.catalog.fetchedAt : Infinity;
    if (hours > 0 && age >= hours * HOUR_MS) await this.refresh({ quiet: true });
  }

  async ensureCatalog() {
    await this.plugin.started;
    if (!this.plugin.catalog) await this.refresh();
    return Boolean(this.plugin.catalog);
  }

  refresh({ quiet = false } = {}) {
    const p = this.plugin;
    return p.task(t("notice.refreshing"), async (progress) => {
      progress(t("notice.downloadingCatalog"));
      const plugins = await p.github.catalog();
      const delta = p.catalog ? catalogDelta(p.catalog.plugins, plugins) : null;
      p.catalog = { fetchedAt: Date.now(), prevAt: p.catalog?.fetchedAt, plugins, delta };
      for (const item of plugins) {
        if (item.id in p.data.snoozed && !isSnoozed(item, p.data.snoozed)) delete p.data.snoozed[item.id];
      }
      await p.saveData(p.data);
      await p.cache.write("catalog", p.catalog);

      // timeline, profiles index, similar lists and any missing UI locale are independent: fetch in parallel
      const wantedLang = matchLanguage(p.uiLanguage());
      const [history] = await Promise.all([
        this.syncServerTimeline(progress),
        this.syncProfiles(progress),
        this.syncSimilar(progress),
        wantedLang !== "en" && !STRINGS[wantedLang] ? p.applyLanguage() : null,
      ]);

      progress(t("notice.updatingNotes"));
      const released = [];
      for (const id of [...p.notes.index.keys()]) {
        const plugin = p.pluginById(id);
        if (plugin && (await p.notes.syncSource(plugin))) released.push(id);
      }
      if (released.length && p.data.settings.readmeMode === "sync") await p.readmes.fetchReadmes(released, progress);
      const reach = history ? t("notice.historyTo", { date: dayString(p.timeline.to) }) : t("notice.historyStale");
      return `${t("notice.refreshed", { n: formatCount(p.catalog.plugins.length), released: released.length })} · ${reach}`;
    }, { quiet });
  }

  /**
   * Downloads a file from the profiles branch at most once per PROFILES_CHECK_HOURS (ETag-guarded 304).
   * @returns {Promise<object|null>}
   */
  async syncProfilesFile(name, file, current, valid, progress) {
    const p = this.plugin;
    await this.loadExtras();
    try {
      const meta = await p.cache.read(`${name}-meta`, {});
      const have = current();
      if (have && Date.now() - (meta.checkedAt || 0) < PROFILES_CHECK_HOURS * HOUR_MS) return null;
      progress(t(`notice.${name}`));
      const fresh = await p.github.profilesFile(file, have ? meta.etag : null);
      if (fresh && !valid(fresh.json)) throw new Error(`unexpected ${file}`);
      if (fresh) await p.cache.write(name, fresh.json);
      await p.cache.write(`${name}-meta`, { etag: fresh ? fresh.etag : meta.etag, checkedAt: Date.now() });
      return fresh?.json ?? null;
    } catch (error) {
      console.warn(`[Community Radar] couldn't update ${file}`, error);
      return null;
    }
  }

  async syncProfiles(progress) {
    const p = this.plugin;
    const index = await this.syncProfilesFile("profiles", "index.json", () => p.profiles, (json) => Boolean(json?.plugins), progress);
    if (!index) return;
    p.profiles = index;
    p.profileFiles.clear();
  }

  async syncSimilar(progress) {
    const p = this.plugin;
    const file = await this.syncProfilesFile("similar", "similar.json", () => p.similar, (json) => Boolean(parseSimilar(json)), progress);
    if (file) p.similar = parseSimilar(file);
  }

  /** A plugin's whole profile, downloaded once per session; null when absent, throws on network failure (not cached). */
  loadProfile(id) {
    const p = this.plugin;
    if (!p.profileFiles.has(id)) {
      p.profileFiles.set(id, p.github.profile(id).catch((error) => { p.profileFiles.delete(id); throw error; }));
    }
    return p.profileFiles.get(id);
  }

  profileFile(id) {
    return this.loadProfile(id).catch(() => null);
  }

  /** Downloads delta.json or full timeline.json when a newer release history is published on GitHub. */
  async syncServerTimeline(progress, force = false) {
    const p = this.plugin;
    try {
      const meta = await p.github.metricsMeta();
      const ours = p.timeline;
      if (!force && meta.to <= (ours.to || 0)) return true;
      progress(t("notice.serverHistory"));
      const reaches = !force && ours.v === TIMELINE_VERSION && ours.series && meta.deltaFrom && ours.to >= meta.deltaFrom - DAY_MS;
      const timeline = (reaches && mergeTimeline(ours, await p.github.metricsDelta())) || await p.github.metricsTimeline();
      if (timeline?.v !== TIMELINE_VERSION || !timeline.to) throw new Error("unexpected timeline file");
      p.timeline = timeline;
      await p.cache.write("timeline", timeline);
      return true;
    } catch (error) {
      console.warn("[Community Radar] couldn't download the release history", error);
      return false;
    }
  }

  downloadHistory() {
    const p = this.plugin;
    return p.task(t("notice.history"), async (progress) => {
      if (!(await this.syncServerTimeline(progress, true))) throw new Error(t("notice.historyFailed"));
      return t("notice.historyServer", { from: dayString(p.timeline.from), to: dayString(p.timeline.to) });
    });
  }
}
