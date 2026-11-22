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
    if (this.settings.aiGroups) action("sparkles", t("bulk.suggest"), () => this.suggestGroups(), { tip: t("bulk.suggestTip", { n: Math.min(this.view.selected.size, AI_BATCH) }) });
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

  /**
   * A run in place of the bar: "label · 12 / 50 · spent", its progress line and Stop. Drawn once, then updateRun()
   * changes its text and line in place: redrawn after every plugin, Stop was replaced between press and release and
   * the click never landed.
   */
  renderRun(footer, run) {
    const bar = footer.createDiv({ cls: "pdt-bulk-bar is-running", attr: { role: "status" } });
    setIcon(bar.createSpan({ cls: "pdt-bulk-icon" }), "loader");
    const info = bar.createDiv({ cls: "pdt-bulk-run" });
    const text = info.createSpan();
    const fill = info.createDiv({ cls: "pdt-bulk-track" }).createDiv({ cls: "pdt-bulk-fill" });
    const stop = bar.createEl("button", { cls: "pdt-bulk-action", attr: { type: "button" } });
    stop.onclick = () => this.halt(run);
    run.refs = { text, fill, stop };
    this.updateRun(run);
  }

  /** The run's numbers in the bar, without redrawing it. */
  updateRun(run) {
    const footer = this.view.refs.bulk;
    if (!footer) return;
    if (!run.refs || !footer.contains(run.refs.text)) return this.renderBulk();   // the bar was redrawn meanwhile (a toast came)
    const { text, fill, stop } = run.refs;
    text.setText([run.label, `${formatCount(run.done)} / ${formatCount(run.total)}`, run.usage ? spentText(run.usage) : null].filter(Boolean).join(" · "));
    fill.setCssProps({ "--pdt-done": `${Math.round((run.done / Math.max(1, run.total)) * 100)}%` });
    stop.setText(run.stop ? t("bulk.stoppingN", { n: run.active }) : t("bulk.stop"));
    stop.disabled = run.stop;
  }

  /**
   * Stops a run: no new request starts, a request waiting to try again gives up, the ones under way finish and are
   * kept. `reason` (not you: the run stopped itself) shows in its toast.
   */
  halt(run, reason = "") {
    if (run.stop) return;
    Object.assign(run, { stop: true, reason });
    this.plugin.translator.halted = true;
    this.updateRun(run);
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
    const descriptions = this.plugin.untranslatedDescriptions(plugins);
    const overviews = this.plugin.pendingOverviews(plugins);
    new Popover(button, { cls: "pdt-bulk-pop pdt-bulk-menu", label: t("bulk.translate"), above: true, fill: (box, pop) => {
      box.setAttribute("role", "menu");
      box.createDiv({ cls: "pdt-bulk-menu-head", text: t("bulk.tr.head", { n: plugins.length, lang: settings.targetLang }) });
      const item = (icon, title, sub, hint, run) => {
        const row = box.createEl("button", { cls: "pdt-bulk-item", attr: { type: "button", role: "menuitem" } });
        setIcon(row.createSpan({ cls: "pdt-bulk-icon" }), icon);
        const text = row.createSpan({ cls: "pdt-bulk-item-text" });
        text.createSpan({ text: title });
        text.createSpan({ cls: "pdt-bulk-item-sub", text: sub });
        const lines = row.createSpan({ cls: "pdt-bulk-item-hint" });   // an estimate: tokens over cost, so the title keeps its room
        for (const line of [hint].flat()) lines.createSpan({ text: line });
        row.onclick = () => { pop.close(); run(); };
      };
      item("type", t("bulk.tr.desc"), t("bulk.tr.descSub"),
        descriptions.length ? estimateHint(this.plugin.estimateDescriptions(descriptions)) : t("bulk.tr.allDone"), () => this.translateDescriptions(plugins));
      item("list", t("bulk.tr.overview"), t("bulk.tr.overviewSub"),
        overviews.length ? estimateHint(this.plugin.estimateOverviews(overviews.length)) : t("bulk.tr.allDone"), () => this.translateOverviews(plugins));
      box.createDiv({ cls: "pdt-bulk-menu-sep" });
      item("download", t("bulk.tr.fetch"), t("bulk.tr.fetchSub"), t("bulk.tr.noAi"), () => this.downloadReadmes(plugins));
      item("file-text", t("bulk.tr.readme"), t("bulk.tr.readmeSub"), t("bulk.tr.later"), () => this.translateReadmes(plugins));
    } }).open();
  }

  /**
   * Short descriptions: in requests of up to PAGE_SIZE (translateBatch), a few at once, then shown in the list in
   * your language. The bar counts plugins ("50 / 93"), not requests.
   */
  async translateDescriptions(plugins) {
    const pending = this.plugin.untranslatedDescriptions(plugins);
    if (!pending.length) return this.finish(t("bulk.tr.upToDate"));
    if (!this.translatorReady()) return;
    const estimate = this.plugin.estimateDescriptions(pending);
    if (!(await this.askTranslate("desc", pending, estimate))) return;
    this.clearSelection();
    const batches = [];
    for (let i = 0; i < pending.length; i += PAGE_SIZE) batches.push(pending.slice(i, i + PAGE_SIZE));
    const result = await this.runEach(t("bulk.tr.descRun"), batches, (batch) => this.plugin.translateBatch(batch),
      { weight: (batch) => batch.length, ai: true, estimate });
    pending.filter((p) => this.plugin.cachedTranslation(p) != null).forEach((p) => this.view.setDescTranslated(p, true));
    this.finish(this.summary(result));
  }

  /**
   * Overviews: one request a plugin. Nothing is downloaded before you agree (the estimate comes from what this model's
   * Overviews cost so far); each profile is downloaded when its turn comes, and one found up to date then is skipped.
   */
  async translateOverviews(plugins) {
    if (!this.translatorReady()) return;
    if (!plugins.some((p) => this.plugin.profiles?.plugins?.[p.id])) return new Notice(t("bulk.tr.noProfiles"));
    const pending = this.plugin.pendingOverviews(plugins);
    if (!pending.length) return this.finish(t("bulk.tr.upToDate"));
    const estimate = this.plugin.estimateOverviews(pending.length);
    if (!(await this.askTranslate("overview", pending, estimate))) return;
    this.clearSelection();
    this.finish(this.summary(await this.runEach(t("bulk.tr.overviewRun"), pending, (p) => this.plugin.translateProfile(p, true), { ai: true, estimate })));
  }

  /** READMEs: missing or older ones downloaded first, then each translated whole, one after another. */
  async translateReadmes(plugins) {
    if (!this.translatorReady()) return;
    this.clearSelection();
    const texts = new Map();
    let fetched = 0;
    const download = await this.runEach(t("bulk.tr.fetchRun"), plugins.filter((p) => p.repo), async (p) => {
      let { original, translation } = await this.plugin.readmeParts(p);
      if (!original || (p.version && original.version !== p.version)) {
        await this.plugin.fetchReadme(p);
        fetched++;
        ({ original, translation } = await this.plugin.readmeParts(p));
      }
      if (original && translation?.hash !== original.hash) texts.set(p.id, this.plugin.translationSource(original.text).text);
      return Boolean(original);
    });
    if (download.left) return this.finish(this.summary(download, "bulk.tr.fetchedN"));   // stopped: nothing goes to the AI
    const pending = plugins.filter((p) => texts.has(p.id));
    if (!pending.length) return this.finish(t("bulk.tr.upToDate"));
    const note = [t("bulk.tr.fetched", { n: fetched }), pending.some((p) => !this.plugin.notes.file(p.id)) ? t("bulk.tr.noNotes") : null].filter(Boolean).join(" · ");
    const estimate = this.plugin.estimate("readme", { text: [...texts.values()].join("\n"), requests: pending.length });
    if (!(await this.askTranslate("readme", pending, estimate, note))) return this.view.refresh();
    this.finish(this.summary(await this.runEach(t("bulk.tr.readmeRun"), pending, (p) => this.plugin.translateReadme(p, () => {}, true), { ai: true, estimate })));
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

  /** Asks before an AI run, with its estimate (and the spending cap that comes with it); true to go ahead. */
  askTranslate(kind, plugins, estimate, footnote = "") {
    const vars = { n: plugins.length, lang: this.plugin.data.settings.targetLang };
    const cap = estimate.cost ? t("bulk.tr.cap", { cost: formatCost(estimate.cost * BUDGET_SLACK) }) : null;
    return this.confirm({ title: t(`bulk.tr.ask.${kind}`, vars), plugins, text: estimateLine(estimate, this.plugin.data.settings), cta: t(`bulk.tr.go.${kind}`, vars),
      footnote: [footnote, cap].filter(Boolean).join(" · ") });
  }

  /**
   * Runs `work(item)` for the items, several at once, the bar showing how far it got, what it cost so far and Stop.
   * An AI run (`ai`) also counts every request its work makes (failed tries too: they're billed) and stops itself:
   * after RUN_FAILURES failures in a row (no connection, the provider down; the reason goes to the toast), or once it
   * has spent BUDGET_SLACK times the `estimate` you agreed to. A rate limit (429) leaves it one request fewer at once.
   * Done ones are kept as they finish, so the same run again carries on where this one stopped.
   * @param {function(*): Promise<boolean|object>} work  falsy: failed (or throws); else done
   * @param {{weight?: function(*): number, ai?: boolean, estimate?: object}} [options]  weight: how many plugins an
   *   item is (a batch of descriptions is many)
   * @returns {Promise<{ok, failed, left, requests, usage, reason}>} plugins done, failed, not started; AI requests and
   *   their usage summed (sumUsage: the cost only when every reply told it); why it stopped itself
   */
  async runEach(label, items, work, { weight = () => 1, ai = false, estimate = null } = {}) {
    const translator = this.plugin.translator;
    const run = { label, done: 0, total: items.reduce((n, item) => n + weight(item), 0), stop: false, reason: "", active: 0,
      limit: ai ? AI_PARALLEL : PARALLEL, usage: null };
    const result = { ok: 0, failed: 0, rejected: 0, left: 0, requests: 0, usage: null, reason: "", expected: null };
    const usages = [];
    const cap = estimate?.cost ? estimate.cost * BUDGET_SLACK : null;
    const watch = (event, data) => {
      if (event === "rateLimited") run.limit = Math.max(1, run.limit - 1);
      if (event !== "usage") return;
      usages.push({ input: (data.input || 0) + (data.output || 0), cost: data.cost, model: data.model });
      result.requests = usages.length;
      run.usage = result.usage = sumUsage(usages, this.plugin.data.settings.model);
      if (cap != null && run.usage.cost > cap) this.halt(run, t("bulk.tr.overBudget", { cost: formatCost(run.usage.cost) }));
      this.updateRun(run);
    };
    if (ai) translator.watchers.add(watch);
    translator.halted = false;
    this.view.bulkRun = run;
    this.renderBulk();
    let next = 0;
    let failures = 0;
    const worker = async (slot) => {
      while (!run.stop && next < items.length) {
        if (slot >= run.limit) { await sleep(500); continue; }   // the run slowed down after a rate limit
        const item = items[next++];
        const n = weight(item);
        run.active++;
        let done = false;
        let rejected = 0;   // answered, but not translated: not kept (translationProblem)
        try {
          const got = await work(item);
          done = Boolean(got);
          rejected = got?.rejected || 0;
        } catch (error) {
          console.error("[Community Radar] bulk", error);
          run.error = error.message;
        }
        run.active--;
        if (done) {
          result.ok += n - rejected;
          result.rejected += rejected;
        } else result.failed += n;
        failures = done ? 0 : failures + 1;
        run.done += n;
        if (failures >= RUN_FAILURES) this.halt(run, t("bulk.tr.tooManyErrors", { n: failures, error: run.error || t("bulk.tr.unknownError") }));
        this.updateRun(run);
      }
    };
    await Promise.all(Array.from({ length: Math.min(run.limit, items.length) }, (_, slot) => worker(slot)));
    translator.watchers.delete(watch);
    translator.halted = false;
    result.left = run.total - run.done;
    result.reason = run.reason;
    // what the estimate said for the part that ran (a stopped run did less): the summary compares what it took
    const share = run.total ? run.done / run.total : 0;
    if (estimate && share) result.expected = { tokens: estimate.tokens * share, cost: estimate.cost == null ? null : estimate.cost * share };
    this.view.bulkRun = null;
    return result;
  }

  /**
   * "93 translated · 2 requests · 18,420 tokens · $0.0021 · 16% under the estimate · model" (+ failed, not translated,
   * stopped, why) for the toast.
   */
  summary({ ok, failed, rejected = 0, left, requests, usage, reason, expected = null }, key = "bulk.tr.done") {
    return [t(key, { n: ok }), failed ? t("bulk.tr.failed", { n: failed }) : null, rejected ? t("bulk.tr.rejected", { n: rejected }) : null,
      left ? t("bulk.tr.left", { n: left }) : null, requests ? t("bulk.tr.requests", { n: requests }) : null, usage ? spentText(usage) : null,
      usage && expected ? estimateGap(usage, expected) : null, usage?.model, reason || null].filter(Boolean).join(" · ");
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
