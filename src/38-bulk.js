// ─── BulkBar ─────────────────────────────────────────────────────
/**
 * Picking rows and acting on them together: the bar at the list's foot, its toast with Undo, AI groups for the
 * picked rows. Works on the view's state (see ViewPart).
 */
class BulkBar extends ViewPart {
  // ── Group suggestions for the picked rows: the AI's groups under each row, a click saves right away ──
  /** Asks the AI for groups for the picked plugins (the first AI_BATCH); they show under the rows while picked. */
  async suggestGroups() {
    const ids = [...this.view.selected].slice(0, AI_BATCH);
    if (!this.plugin.translator.ready) return new Notice(t("groups.aiSetup"));
    const suggest = { ids: new Set(ids), lists: {}, loading: true, error: "" };
    this.view.suggest = suggest;
    this.view.refresh();
    try {
      suggest.lists = (await this.plugin.groupSuggestions(ids.map((id) => this.plugin.pluginById(id)).filter(Boolean))).lists;
    } catch (error) {
      suggest.error = error.message;
    }
    suggest.loading = false;
    if (this.view.suggest === suggest) this.view.refresh();   // unless the selection went meanwhile
  }

  // ─── Bulk actions ─────────────────────────────────────────────────────────
  /** Can rows be picked here? Not on the Ignored / Hidden lists (they have Restore). */
  get selectable() {
    return !LIST_MODES.includes(this.settings.mode);
  }

  /** Drops the picks (and the group suggestions that came with them). */
  clearSelection() {
    this.view.selected.clear();
    this.view.suggest = null;
  }

  /** Picks or drops a row; with Shift, every row between it and the last one picked. */
  pick(p, on, range = false) {
    const ids = this.view.rows.map((r) => r.id);
    const i = ids.indexOf(p.id);
    const from = range && this.view.lastPicked != null ? Math.min(i, this.view.lastPicked) : i;
    const to = range && this.view.lastPicked != null ? Math.max(i, this.view.lastPicked) : i;
    for (const id of ids.slice(from, to + 1)) (on ? this.view.selected.add(id) : this.view.selected.delete(id));
    this.view.lastPicked = i;
    this.syncSelection();
  }

  /** Rows and the bar follow the selection without redrawing the list. */
  syncSelection() {
    for (const row of this.view.refs.list?.querySelectorAll(".pdt-row, .pdt-trow") || []) {
      const on = this.view.selected.has(row.dataset.id);
      row.toggleClass("is-selected", on);
      const box = row.querySelector(".pdt-select");
      if (box) box.checked = on;
    }
    this.view.refs.list?.toggleClass("is-selecting", this.view.selected.size > 0);
    if (!this.view.selected.size && this.view.refs.list?.querySelector(".pdt-grouping-chips")) { this.view.suggest = null; this.view.refresh(); return; }   // no picks, no AI groups
    this.renderBulk();
  }

  /** The bottom of the list: the last action's result (with Undo), then a run's progress or the bar for what's picked. */
  renderBulk() {
    const footer = this.view.refs.bulk;
    if (!footer) return;
    footer.empty();
    if (this.view.toast) this.renderToast(footer);
    if (this.view.bulkRun) return this.renderRun(footer, this.view.bulkRun);
    if (!this.view.selected.size || !this.selectable) return;
    const bar = footer.createDiv({ cls: "pdt-bulk-bar", attr: { role: "toolbar", "aria-label": t("bulk.toolbar") } });
    const count = bar.createSpan({ cls: "pdt-bulk-count" });
    count.createSpan({ cls: "pdt-bulk-badge", text: formatCount(this.view.selected.size) });
    count.createSpan({ text: t("bulk.picked") });
    this.renderPickMore(bar);
    const action = (icon, label, onClick, { caret = false, tip = "" } = {}) => {
      const button = bar.createEl("button", { cls: "pdt-bulk-action", attr: { type: "button" } });
      setIcon(button.createSpan({ cls: "pdt-bulk-icon" }), icon);
      button.createSpan({ text: label });
      if (caret) setIcon(button.createSpan({ cls: "pdt-bulk-caret" }), "chevron-down");
      if (tip) setTooltip(button, tip, { placement: "top" });
      button.onclick = () => onClick(button);   // the button: a menu opens over it
    };
    const divider = () => bar.createSpan({ cls: "pdt-bulk-divider" });
    divider();
    action("bell-plus", t("bulk.track"), () => this.runBulk("track"));
    action("star", t("bulk.rate"), (button) => this.openRating(button), { caret: true });
    action("folder-plus", t("bulk.group"), (button) => showMenuBelow(button, [...this.plugin.notes.groups().map((g) => [g.name, g.name]), [null, t("bulk.newGroup")]], undefined,
      async (name) => {
        const group = name ?? await new TextModal(this.app, { title: t("bulk.newGroup"), cta: t("bulk.go.group", { n: this.view.selected.size }) }).ask();
        if (group) this.runBulk("group", group);
      }), { caret: true });
    action("sparkles", t("bulk.suggest"), () => this.suggestGroups(), { tip: t("bulk.suggestTip", { n: Math.min(this.view.selected.size, AI_BATCH) }) });
    if (this.settings.mode === "tracked") action("check-check", t("bulk.reviewed"), () => this.runBulk("reviewed"));
    divider();
    action("languages", t("bulk.translate"), (button) => this.openTranslate(button), { caret: true });
    divider();
    action("clock", t("bulk.snooze"), () => this.runBulk("snooze"), { tip: t("bulk.snoozeTip") });
    action("ban", t("bulk.exclude"), () => this.runBulk("exclude"), { tip: t("bulk.excludeTip") });
    divider();
    smallButton(bar, "x", t("bulk.clear"), () => { this.clearSelection(); this.syncSelection(); });
  }

  /** The last action's result, with Undo when it can be turned back. */
  renderToast(footer) {
    const { op, text, icon } = this.view.toast;
    const toast = footer.createDiv({ cls: "pdt-toast", attr: { role: "status" } });
    setIcon(toast.createSpan({ cls: "pdt-toast-icon" }), icon ?? (op ? "check" : "rotate-ccw"));
    toast.createSpan({ text });
    if (op?.changes.length) toast.createEl("button", { cls: "pdt-toast-undo", text: t("bulk.undo") }).onclick = () => this.undoOp(op);
    smallButton(toast, "x", t("bulk.close"), () => { this.view.toast = null; this.renderBulk(); });
  }

  /** Like Gmail: first the rows on screen, then every row of the list, the ones not shown yet included. */
  renderPickMore(bar) {
    const visible = this.view.rows.slice(0, this.view.visible);
    const pickAll = (rows) => () => { for (const p of rows) this.view.selected.add(p.id); this.syncSelection(); };
    if (visible.some((p) => !this.view.selected.has(p.id))) {
      bar.createEl("button", { cls: "pdt-bulk-link", text: t("bulk.selectShown", { n: visible.length }) }).onclick = pickAll(visible);
    } else if (this.view.rows.length > visible.length && this.view.selected.size < this.view.rows.length) {
      bar.createEl("button", { cls: "pdt-bulk-link", text: t("bulk.selectAll", { n: formatCount(this.view.rows.length) }) }).onclick = pickAll(this.view.rows);
    }
  }

  /** A run in place of the bar: "label · 12 / 50", its progress line and Stop (the one in hand still finishes). */
  renderRun(footer, run) {
    const bar = footer.createDiv({ cls: "pdt-bulk-bar is-running", attr: { role: "status" } });
    setIcon(bar.createSpan({ cls: "pdt-bulk-icon" }), "loader");
    const info = bar.createDiv({ cls: "pdt-bulk-run" });
    info.createSpan({ text: `${run.label} · ${run.done} / ${run.total}` });
    info.createDiv({ cls: "pdt-bulk-track" }).createDiv({ cls: "pdt-bulk-fill" }).setCssProps({ "--pdt-done": `${Math.round((run.done / Math.max(1, run.total)) * 100)}%` });
    const stop = bar.createEl("button", { cls: "pdt-bulk-action", text: run.stop ? t("bulk.stopping") : t("bulk.stop"), attr: { type: "button" } });
    stop.disabled = run.stop;
    stop.onclick = () => { run.stop = true; this.renderBulk(); };
  }

  /** The picked plugins, in the list's order. */
  picked() {
    return [...this.view.selected].map((id) => this.plugin.pluginById(id)).filter(Boolean);
  }

  /** Puanla: the same stars as a row's ★, over the button; Clear when any of the picked ones is rated. */
  openRating(button) {
    const rated = this.picked().some((p) => this.plugin.notes.index.get(p.id)?.rating);
    new Popover(button, { cls: "pdt-bulk-pop", label: t("bulk.rate"), above: true, fill: (box, pop) => {
      ratingButtons(box, 0, (n) => { pop.close(); this.runBulk("rating", n); });
      if (rated) box.createEl("button", { cls: "pdt-rate-clear", text: t("rating.clear"), attr: { type: "button" } }).onclick = () => { pop.close(); this.runBulk("rating", null); };
    } }).open();
  }

  // ── Çevir: the picked plugins' descriptions, Overviews and READMEs ──
  /** The Translate menu over its button; each item says what it does and, when known, what it'll take. */
  openTranslate(button) {
    const plugins = this.picked();
    const settings = this.plugin.data.settings;
    const descriptions = plugins.filter((p) => p.description && this.plugin.cachedTranslation(p) == null);
    const profiled = plugins.filter((p) => this.plugin.profiles?.plugins?.[p.id]).length;
    new Popover(button, { cls: "pdt-bulk-pop pdt-bulk-menu", label: t("bulk.translate"), above: true, fill: (box, pop) => {
      box.setAttribute("role", "menu");
      box.createDiv({ cls: "pdt-bulk-menu-head", text: t("bulk.tr.head", { n: plugins.length, lang: settings.targetLang }) });
      const item = (icon, title, sub, hint, run) => {
        const row = box.createEl("button", { cls: "pdt-bulk-item", attr: { type: "button", role: "menuitem" } });
        setIcon(row.createSpan({ cls: "pdt-bulk-icon" }), icon);
        const text = row.createSpan({ cls: "pdt-bulk-item-text" });
        text.createSpan({ text: title });
        text.createSpan({ cls: "pdt-bulk-item-sub", text: sub });
        row.createSpan({ cls: "pdt-bulk-item-hint", text: hint });
        row.onclick = () => { pop.close(); run(); };
      };
      item("type", t("bulk.tr.desc"), t("bulk.tr.descSub"),
        descriptions.length ? estimateLine(descriptions.map((p) => p.description).join("\n"), settings, true) : t("bulk.tr.allDone"), () => this.translateDescriptions(descriptions));
      item("list", t("bulk.tr.overview"), t("bulk.tr.overviewSub"), t("bulk.tr.profiled", { n: profiled }), () => this.translateOverviews(plugins));
      box.createDiv({ cls: "pdt-bulk-menu-sep" });
      item("download", t("bulk.tr.fetch"), t("bulk.tr.fetchSub"), t("bulk.tr.noAi"), () => this.downloadReadmes(plugins));
      item("file-text", t("bulk.tr.readme"), t("bulk.tr.readmeSub"), t("bulk.tr.later"), () => this.translateReadmes(plugins));
    } }).open();
  }

  /** Short descriptions: in requests of up to 50 (translateRows), shown in the list at once. */
  async translateDescriptions(plugins) {
    if (!plugins.length) return this.finish(t("bulk.tr.upToDate"));
    const text = plugins.map((p) => p.description).join("\n");
    if (!(await this.askTranslate("desc", plugins, text))) return;
    this.clearSelection();
    if (await this.plugin.translateRows(plugins)) plugins.forEach((p) => this.view.shownTranslations.add(p.id));
    this.finish(t("bulk.tr.done", { n: plugins.filter((p) => this.plugin.cachedTranslation(p) != null).length }));
  }

  /** Overviews: each profile fetched first (for what's out of date and the estimate), then one request a plugin. */
  async translateOverviews(plugins) {
    if (!this.translatorReady()) return;
    const profiled = plugins.filter((p) => this.plugin.profiles?.plugins?.[p.id]);
    if (!profiled.length) return new Notice(t("bulk.tr.noProfiles"));
    this.clearSelection();
    const texts = new Map();   // id → what goes to the AI, for the ones without an up-to-date translation
    await this.runEach(t("bulk.tr.preparing"), profiled, async (p) => {
      const parts = profileParts(this.plugin.profiles.plugins[p.id], await this.plugin.profileFile(p.id));
      const text = parts && profileTexts(parts).join("\n");
      const saved = this.plugin.profileTranslation(p.id);
      if (text && !(saved?.src === text && saved.lang === this.plugin.data.settings.targetLang)) texts.set(p.id, text);
      return Boolean(text);
    });
    const pending = profiled.filter((p) => texts.has(p.id));
    if (!pending.length) return this.finish(t("bulk.tr.upToDate"));
    if (!(await this.askTranslate("overview", pending, [...texts.values()].join("\n")))) return this.view.refresh();
    this.finish(this.summary(await this.runEach(t("bulk.tr.overviewRun"), pending, (p) => this.plugin.translateProfile(p, true))));
  }

  /** READMEs: missing or older ones downloaded first, then each translated whole, one after another. */
  async translateReadmes(plugins) {
    if (!this.translatorReady()) return;
    this.clearSelection();
    const texts = new Map();
    let fetched = 0;
    await this.runEach(t("bulk.tr.fetchRun"), plugins.filter((p) => p.repo), async (p) => {
      let { original, translation } = await this.plugin.readmeParts(p);
      if (!original || (p.version && original.version !== p.version)) {
        await this.plugin.fetchReadme(p);
        fetched++;
        ({ original, translation } = await this.plugin.readmeParts(p));
      }
      if (original && translation?.hash !== original.hash) texts.set(p.id, this.plugin.translationSource(original.text).text);
      return Boolean(original);
    });
    const pending = plugins.filter((p) => texts.has(p.id));
    if (!pending.length) return this.finish(t("bulk.tr.upToDate"));
    const note = [t("bulk.tr.fetched", { n: fetched }), pending.some((p) => !this.plugin.notes.file(p.id)) ? t("bulk.tr.noNotes") : null].filter(Boolean).join(" · ");
    if (!(await this.askTranslate("readme", pending, [...texts.values()].join("\n"), note))) return this.view.refresh();
    this.finish(this.summary(await this.runEach(t("bulk.tr.readmeRun"), pending, (p) => this.plugin.translateReadme(p, () => {}, true))));
  }

  /** READMEs into the notes (or the cache, for the untracked ones); no AI. Up-to-date ones are left alone. */
  async downloadReadmes(plugins) {
    this.clearSelection();
    const result = await this.runEach(t("bulk.tr.fetchRun"), plugins.filter((p) => p.repo), async (p) => {
      const { original } = await this.plugin.readmeParts(p);
      if (original && (!p.version || original.version === p.version)) return true;
      await this.plugin.fetchReadme(p);
      return Boolean((await this.plugin.readmeParts(p)).original);
    });
    this.finish(this.summary(result, "bulk.tr.fetchedN"));
  }

  translatorReady() {
    if (this.plugin.translator.ready) return true;
    new Notice(t("notice.translateSetup"));
    return false;
  }

  /** Asks before an AI run, with its estimate; true to go ahead. */
  askTranslate(kind, plugins, text, footnote = "") {
    const vars = { n: plugins.length, lang: this.plugin.data.settings.targetLang };
    return this.confirm({ title: t(`bulk.tr.ask.${kind}`, vars), plugins, text: estimateLine(text, this.plugin.data.settings), cta: t(`bulk.tr.go.${kind}`, vars), footnote });
  }

  /**
   * Runs `work(p)` for the plugins one after another, the bar showing how far it got (with Stop).
   * @param {function(object): Promise<boolean>} work  true when it's done for that plugin
   * @returns {Promise<{ok: number, failed: number, left: number}>} left: not started because of Stop
   */
  async runEach(label, plugins, work) {
    const run = { label, done: 0, total: plugins.length, stop: false };
    const result = { ok: 0, failed: 0, left: 0 };
    this.view.bulkRun = run;
    this.renderBulk();
    for (const p of plugins) {
      if (run.stop) break;
      try {
        result[(await work(p)) ? "ok" : "failed"]++;
      } catch (error) {
        console.error("[Community Radar] bulk", p.id, error);
        result.failed++;
      }
      run.done++;
      this.renderBulk();
    }
    result.left = plugins.length - run.done;
    this.view.bulkRun = null;
    return result;
  }

  /** "12 done · 1 failed · 3 stopped" for the toast. */
  summary({ ok, failed, left }, key = "bulk.tr.done") {
    return [t(key, { n: ok }), failed ? t("bulk.tr.failed", { n: failed }) : null, left ? t("bulk.tr.left", { n: left }) : null].filter(Boolean).join(" · ");
  }

  /** Ends a run: what it did in the toast, the list redrawn with the new translations. */
  finish(text) {
    this.view.toast = { op: null, icon: "check", text };
    this.view.refresh();
  }

  /** Asks, runs the action on what's picked, then shows what it did with Undo. */
  async runBulk(kind, value = null) {
    const plugins = this.picked();
    const vars = { n: plugins.length, value: kind === "rating" ? "★".repeat(value ?? 0) : value };
    const key = opKey({ kind, value });   // a rating of null is Clear: its own texts
    const ok = await this.confirm({ title: t(`bulk.ask.${key}`, vars), plugins, text: t(`bulk.what.${key}`), cta: t(`bulk.go.${key}`, vars) });
    if (!ok) return;
    this.clearSelection();
    const op = await this.plugin.bulk(kind, plugins, value);
    this.view.toast = { op, text: opLabel(op) };
    this.view.refresh();
  }

  confirm(options) {
    return new ConfirmModal(this.app, options).ask();
  }

  /** Undo of an operation (from the toast or Recent actions): what came back and what changed since. */
  async undoOp(op) {
    const { restored, skipped } = await this.plugin.undo(op);
    this.view.toast = { op: null, text: t("bulk.undoneN", { n: restored }) + (skipped ? t("bulk.skipped", { n: skipped }) : "") };
    this.view.refresh();
  }

  openRecent() {
    new RecentModal(this.plugin, (op) => this.undoOp(op)).open();
  }
}
