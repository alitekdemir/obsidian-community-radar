/**
 * The discovery view, opened as a tab inside Obsidian.
 * render(): builds everything (on mode or filter changes). refresh(): updates only the counts, the status
 * and the list, so the search box keeps its focus.
 */
class DiscoveryView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.visible = PAGE_SIZE;
    this.shownTranslations = new Set();
    this.similar = null;          // Similar filter: {steps: [{id, scroll}], before: {mode, scroll, visible, originId, originIndex}, query}
    this.preset = null;           // a home widget's plugins in the list: {id, params, freshIds, onlyNew, query, sort}
    this.selected = new Set();    // ids picked for a bulk action (a tab, filter or search change clears them)
    this.lastPicked = null;       // row index of the last pick, for Shift+click ranges
    this.toast = null;            // the last bulk action's result: {text, op} (op: Undo turns it back)
    this.home = new HomePage(this);
    this.collapsed = new Set();   // Tracked tab sections folded away
    this.refs = {};
    this.cursorId = null;         // the row keyboard shortcuts act on
    this.suggest = null;          // AI groups for the picked rows: {ids, lists, loading, error}
    // Obsidian activates a view's scope while its tab is focused, so keys work without clicking a row
    this.scope = new Scope(this.app.scope);
    this.keep = new Map();        // id → index: rows an action moved out of the filter stay put until render()
    for (const key of ["j", "k", "f", "g", "x", "h", "t", "r", "s", "o", "Enter", "0", "1", "2", "3", "4", "5"]) {
      this.scope.register([], key, (event) => this.onKey(event, key));
    }
    this.scope.register([], "/", () => {   // / jumps to the search box (shortcuts on or off), unless you're typing
      if (globalThis.document?.activeElement?.closest?.("input, textarea, select, [contenteditable]") || !this.refs?.search) return true;
      this.refs.search.focus();
      return false;
    });
    this.scope.register([], "Escape", () => {   // Esc closes the Similar filter or a widget's list, like ✕
      if (!(this.similar || this.preset) || globalThis.document?.activeElement?.closest?.("input, textarea, select")) return true;
      if (this.similar) this.closeSimilar();
      else this.closePreset();
      return false;
    });
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return t("view.title"); }
  getIcon() { return ICON; }

  async onOpen() {
    this.contentEl.addClass("pdt-view");
    // the Filters panel closes on a click anywhere else
    this.registerDomEvent(globalThis.document, "pointerdown", (event) => {
      if (this.filtersOpen && !event.target.closest?.(".pdt-filter-menu, .menu")) { this.filtersOpen = false; this.render(); }
    });
    this.render();
    await this.plugin.ensureFresh();
  }

  /** Obsidian's ⋮ menu of the view: actions that don't need a place on screen. */
  onPaneMenu(menu, source) {
    super.onPaneMenu?.(menu, source);
    const plugin = this.plugin;
    const shown = (this.rows || []).slice(0, this.visible);
    const item = (icon, title, run) => menu.addItem((i) => i.setIcon(icon).setTitle(title).onClick(run));
    item("refresh-cw", t("set.syncNow"), () => plugin.refresh());
    item("languages", t("translate.visible", { n: shown.length }), () => this.translateVisible());
    item("ban", t("list.ignoredTitle", { n: plugin.ignoredCount() }), () => this.update("mode", "ignored"));
    item("eye-off", t("list.dismissedTitle", { n: Object.keys(plugin.data.dismissed).length }), () => this.update("mode", "dismissed"));
    item("history", t("cmd.rebuild"), () => plugin.downloadHistory());
    item("settings", t("menu.settings"), () => plugin.openSettings());
  }

  async translateVisible() {
    const rows = (this.rows || []).slice(0, this.visible);
    if (await this.plugin.translateRows(rows)) rows.forEach((p) => this.shownTranslations.add(p.id));
    this.refresh();
  }

  /**
   * A shortcut key (see KEY_HELP). Returns true to let Obsidian handle the key as usual: when shortcuts
   * are off, or while typing in a field.
   */
  onKey(event, key) {
    const typing = globalThis.document?.activeElement?.closest?.("input, textarea, select, [contenteditable]");
    if (!this.settings.keyboard || typing) return true;
    const rows = [...this.contentEl.querySelectorAll(".pdt-row")];
    if (!rows.length) return true;
    const index = rows.findIndex((r) => r.dataset.id === this.cursorId);
    if (key === "j" || key === "k") {
      const next = index === -1 ? 0 : Math.max(0, Math.min(rows.length - 1, index + (key === "j" ? 1 : -1)));
      this.setCursor(rows[next]);
      return false;
    }
    const row = rows[index];
    const p = row && this.plugin.pluginById(row.dataset.id);
    if (!p) return true;
    const listMode = LIST_MODES.includes(this.settings.mode);
    const actions = {
      f: () => this.plugin.toggleFavorite(p),
      g: () => this.plugin.chooseGroup(p),
      x: () => (listMode ? this.plugin.restoreFrom(this.settings.mode, [p.id]) : this.plugin.exclude(p)),
      h: () => this.plugin.snooze(p),
      t: () => $(row, ".pdt-tr")?.click(),
      r: () => this.plugin.openReadme(p),
      s: () => $(row, ".pdt-similar-link")?.click(),
      o: () => $(row, ".pdt-name")?.click(),
      Enter: () => $(row, ".pdt-desc")?.click(),
    };
    for (const n of [0, 1, 2, 3, 4, 5]) actions[n] = () => this.runRowAction(p, () => this.plugin.setNoteField(p, "rating", n || null));
    Promise.resolve(actions[key]()).then(() => {
      if (!"fxh012345".includes(key)) return;
      this.refresh();
      const again = [...this.contentEl.querySelectorAll(".pdt-row")];
      this.setCursor(again.find((r) => r.dataset.id === p.id) || again[Math.min(index, again.length - 1)]);
    });
    return false;
  }

  /** Highlights the row the shortcuts act on and keeps it in sight. */
  setCursor(row) {
    for (const r of this.contentEl.querySelectorAll(".pdt-row.is-cursor")) r.removeClass("is-cursor");
    if (!row) return;
    row.addClass("is-cursor");
    this.cursorId = row.dataset.id;
    row.scrollIntoView?.({ block: "nearest" });
  }

  // ── Group suggestions for the picked rows: the AI's groups under each row, a click saves right away ──
  /** Asks the AI for groups for the picked plugins (the first AI_BATCH); they show under the rows while picked. */
  async suggestGroups() {
    const ids = [...this.selected].slice(0, AI_BATCH);
    if (!this.plugin.translator.ready) return new Notice(t("groups.aiSetup"));
    const suggest = { ids: new Set(ids), lists: {}, loading: true, error: "" };
    this.suggest = suggest;
    this.refresh();
    try {
      suggest.lists = await this.plugin.groupSuggestions(ids.map((id) => this.plugin.pluginById(id)).filter(Boolean));
    } catch (error) {
      suggest.error = error.message;
    }
    suggest.loading = false;
    if (this.suggest === suggest) this.refresh();   // unless the selection went meanwhile
  }

  /** A picked row's groups: the ones it has and the AI's, on/off; a click adds or removes the group at once. */
  renderSuggestions(box, p) {
    const suggest = this.suggest;
    box.empty();
    setIcon(box.createSpan({ cls: "pdt-grouping-icon" }), "sparkles");
    if (suggest.loading) {
      for (let i = 0; i < 3; i++) box.createSpan({ cls: "pdt-skeleton" });
      return;
    }
    const current = this.plugin.notes.index.get(p.id)?.groups || [];
    const mine = new Set(this.plugin.notes.groups().map((g) => g.name));
    const options = uniqueNames([...current, ...(suggest.lists[p.id] || [])]);
    if (!options.length) box.createSpan({ cls: "pdt-gm-note", text: suggest.error ? t("groups.aiFailed", { error: suggest.error }) : t("batch.noSuggestions") });
    for (const name of options) {
      groupChip(box, {
        name, on: current.includes(name), star: mine.has(name), starTip: t("batch.legend"),
        onToggle: async () => {
          const now = this.plugin.notes.index.get(p.id)?.groups || [];
          await this.plugin.track(p, { groups: now.includes(name) ? now.filter((g) => g !== name) : [...now, name] });
          this.renderSuggestions(box, p);
        },
      });
    }
  }

  get settings() { return this.plugin.data.settings; }

  /** This page is in Query mode: its query in the box (a widget's or view's list always; the Similar filter has its own search). */
  get inQuery() { return !this.similar && inQueryMode(this.settings, this.page); }

  /** The page on screen: a tab, or a widget's or saved view's list (each a page of its own: its query, filters, sort). */
  get page() {
    const id = this.preset?.id;
    return !id ? this.settings.mode : id.startsWith(VIEW_PREFIX) ? id : `widget:${id}`;
  }

  /** The settings the core reads for this page: a widget's or view's list brings its query as the page's. */
  get pageSettings() {
    return this.preset ? { ...this.settings, pageQueries: { ...this.settings.pageQueries, [this.page]: this.preset.base } } : this.settings;
  }

  /** What the list's box holds: a draft that didn't parse, else the query (a widget's or view's, the page's) or your words (Basic). */
  get boxText() {
    return this.queryDraft ?? (this.inQuery ? this.settings.queries[this.page] : this.settings.query);
  }

  async update(key, value) {
    if (key === "mode" || key === "section") {   // another tab or section ends Filters, Similar, a widget's list, the toast and a draft
      Object.assign(this, { filtersOpen: false, similar: null, preset: null, toast: null, queryDraft: null });
    }
    this.clearSelection();   // what you picked was on that list
    if (key === "mode" && value !== "tracked" && !LIST_MODES.includes(value)) this.settings.listMode = value;
    this.settings[key] = value;
    this.visible = PAGE_SIZE;
    await this.plugin.saveData(this.plugin.data);
    this.render();
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.toggleClass("is-keyboard", Boolean(this.settings.keyboard));   // the highlighted row shows only for shortcuts
    this.keep.clear();
    this.refs = { counts: {} };
    const header = root.createDiv({ cls: "pdt-sticky" });   // switch, tabs and filters stay put while the list scrolls
    header.style.top = `-${root.ownerDocument.defaultView.getComputedStyle(root).paddingTop || "0px"}`;   // Chromium stops sticky below the padding (whoever sets it); rows would peek above
    const nav = header.createDiv({ cls: "pdt-nav" });
    this.renderNav(nav);
    if (this.settings.section === "home") {
      this.home.renderTools(nav);
      this.home.render(root);
      return;
    }
    this.renderFilters(header.createDiv({ cls: "pdt-filters" }));
    this.refs.status = root.createDiv({ cls: "pdt-status" });
    this.refs.list = root.createDiv({ cls: "pdt-list" });
    this.refs.bulk = root.createDiv({ cls: "pdt-bulk" });
    this.refresh();
  }

  refresh() {
    if (this.settings.section === "home") return this.render();   // the home page has no partial redraw
    if (!this.refs.list) return;
    const now = Date.now();
    const state = this.plugin.state();
    if (this.plugin.catalog) {
      const counts = modeCounts(state, this.settings, now);
      if (this.similar) counts.all = this.similarCount();   // the All tab counts the matches while the filter is on
      for (const [mode, el] of Object.entries(this.refs.counts)) el.setText(formatCount(counts[mode]));
    }
    this.updateFilterHead();
    this.renderStatus(this.refs.status);
    this.renderList(this.refs.list, state, now);
    this.refs.list.toggleClass("is-selecting", this.selected.size > 0);
    this.renderBulk();
  }

  // ─── Bulk actions ─────────────────────────────────────────────────────────
  /** Can rows be picked here? Not on the Ignored / Hidden lists (they have Restore). */
  get selectable() {
    return !LIST_MODES.includes(this.settings.mode);
  }

  /** Drops the picks (and the group suggestions that came with them). */
  clearSelection() {
    this.selected.clear();
    this.suggest = null;
  }

  /** Picks or drops a row; with Shift, every row between it and the last one picked. */
  pick(p, on, range = false) {
    const ids = this.rows.map((r) => r.id);
    const i = ids.indexOf(p.id);
    const from = range && this.lastPicked != null ? Math.min(i, this.lastPicked) : i;
    const to = range && this.lastPicked != null ? Math.max(i, this.lastPicked) : i;
    for (const id of ids.slice(from, to + 1)) (on ? this.selected.add(id) : this.selected.delete(id));
    this.lastPicked = i;
    this.syncSelection();
  }

  /** Rows and the bar follow the selection without redrawing the list. */
  syncSelection() {
    for (const row of this.refs.list?.querySelectorAll(".pdt-row, .pdt-trow") || []) {
      const on = this.selected.has(row.dataset.id);
      row.toggleClass("is-selected", on);
      const box = row.querySelector(".pdt-select");
      if (box) box.checked = on;
    }
    this.refs.list?.toggleClass("is-selecting", this.selected.size > 0);
    if (!this.selected.size && this.refs.list?.querySelector(".pdt-grouping-chips")) { this.suggest = null; this.refresh(); return; }   // no picks, no AI groups
    this.renderBulk();
  }

  /** The bottom of the list: the last action's result (with Undo), then the bar for what's picked. */
  renderBulk() {
    const footer = this.refs.bulk;
    if (!footer) return;
    footer.empty();
    if (this.toast) {
      const toast = footer.createDiv({ cls: "pdt-toast", attr: { role: "status" } });
      setIcon(toast.createSpan({ cls: "pdt-toast-icon" }), this.toast.op ? "check" : "rotate-ccw");
      toast.createSpan({ text: this.toast.text });
      if (this.toast.op?.changes.length) {
        toast.createEl("button", { cls: "pdt-toast-undo", text: t("bulk.undo") }).onclick = () => this.undoOp(this.toast.op);
      }
      const close = toast.createEl("button", { cls: "pdt-similar-step", attr: { "aria-label": t("bulk.close") } });
      setIcon(close, "x");
      close.onclick = () => { this.toast = null; this.renderBulk(); };
    }
    if (!this.selected.size || !this.selectable) return;
    const bar = footer.createDiv({ cls: "pdt-bulk-bar", attr: { role: "toolbar", "aria-label": t("bulk.toolbar") } });
    bar.createEl("b", { text: t("bulk.selected", { n: this.selected.size }) });
    // like Gmail: first the rows on screen, then every row of the list, the ones not shown yet included
    const visible = this.rows.slice(0, this.visible);
    const pickAll = (rows) => () => { for (const p of rows) this.selected.add(p.id); this.syncSelection(); };
    if (visible.some((p) => !this.selected.has(p.id))) {
      bar.createEl("button", { cls: "pdt-bulk-link", text: t("bulk.selectShown", { n: visible.length }) }).onclick = pickAll(visible);
    } else if (this.rows.length > visible.length && this.selected.size < this.rows.length) {
      bar.createEl("button", { cls: "pdt-bulk-link", text: t("bulk.selectAll", { n: formatCount(this.rows.length) }) }).onclick = pickAll(this.rows);
    }
    const action = (icon, label, onClick) => {
      const button = bar.createEl("button", { cls: "pdt-bulk-action" });
      setIcon(button.createSpan({ cls: "pdt-chip-caret" }), icon);
      button.createSpan({ text: label });
      button.onclick = (event) => onClick(event);
    };
    action("star", t("bulk.favorite"), () => this.runBulk("favorite"));
    action("star-half", t("bulk.rate"), (event) => this.bulkMenu(event, [1, 2, 3, 4, 5].map((n) => [n, "★".repeat(n)]), (n) => this.runBulk("rating", n)));
    action("folder-plus", t("bulk.group"), (event) => this.bulkMenu(event, [...this.plugin.notes.groups().map((g) => [g.name, g.name]), [null, t("bulk.newGroup")]],
      async (name) => {
        const group = name ?? await new TextModal(this.app, { title: t("bulk.newGroup"), cta: t("bulk.go.group", { n: this.selected.size }) }).ask();
        if (group) this.runBulk("group", group);
      }));
    action("sparkles", t("bulk.suggest", { n: Math.min(this.selected.size, AI_BATCH) }), () => this.suggestGroups());
    if (this.settings.mode === "tracked") action("check-check", t("bulk.reviewed"), () => this.runBulk("reviewed"));
    action("eye-off", t("bulk.snooze"), () => this.runBulk("snooze"));
    action("ban", t("bulk.exclude"), () => this.runBulk("exclude"));
    bar.createDiv({ cls: "pdt-nav-spacer" });
    bar.createEl("button", { cls: "pdt-bulk-link", text: t("bulk.clear") }).onclick = () => { this.clearSelection(); this.syncSelection(); };
  }

  bulkMenu(event, options, onPick) {
    const menu = new Menu();
    for (const [value, title] of options) menu.addItem((item) => item.setTitle(title).onClick(() => onPick(value)));
    menu.showAtMouseEvent(event);
  }

  /** Asks, runs the action on what's picked, then shows what it did with Undo. */
  async runBulk(kind, value = null) {
    const plugins = [...this.selected].map((id) => this.plugin.pluginById(id)).filter(Boolean);
    const vars = { n: plugins.length, value: kind === "rating" ? "★".repeat(value) : value };
    const ok = await this.confirm({ title: t(`bulk.ask.${kind}`, vars), plugins, text: t(`bulk.what.${kind}`), cta: t(`bulk.go.${kind}`, vars) });
    if (!ok) return;
    this.clearSelection();
    const op = await this.plugin.bulk(kind, plugins, value);
    this.toast = { op, text: opLabel(op) };
    this.refresh();
  }

  confirm(options) {
    return new ConfirmModal(this.app, options).ask();
  }

  /** Undo of an operation (from the toast or Recent actions): what came back and what changed since. */
  async undoOp(op) {
    const { restored, skipped } = await this.plugin.undo(op);
    this.toast = { op: null, text: t("bulk.undoneN", { n: restored }) + (skipped ? t("bulk.skipped", { n: skipped }) : "") };
    this.refresh();
  }

  openRecent() {
    new RecentModal(this.plugin, (op) => this.undoOp(op)).open();
  }

  similarCount() {
    return this.similarRows(false).length;
  }

  /**
   * The Similar filter's plugins: the matches of the last step that pass the All tab's Downloads ≥ and
   * (with `searched`) the filter's own search, sorted as chosen.
   */
  similarRows(searched = true) {
    const seed = this.plugin.pluginById(this.similar.steps.at(-1).id);
    const found = seed ? this.plugin.similarTo(seed) : [];
    const opts = modeOptions(this.settings, "all");
    const min = opts.filterDownloads ? opts.minDownloads : 0;
    const query = compileQuery(searched ? this.similar.query : "", this.plugin.state(), Date.now());
    const matching = found.map((x) => x.p).filter((p) => (p.downloads ?? 0) >= min && query.test(p));
    const { key, dir } = this.settings.similarSort;
    const { catalog, releases, notes, growth } = this.plugin.state();
    return key === "relevance" ? (dir === "asc" ? matching.reverse() : matching) : sortRows(matching, key, dir, catalog, releases, notes, growth);
  }

  /** Home · List · Tracked (with its new releases). */
  /**
   * ⌂ Home, then one strip of pages: the tabs (each is its query, on hover), your saved views, and a widget's
   * list while it's open (✕ back home). Recent actions at the end.
   */
  renderNav(nav) {
    const settings = this.settings;
    const onHome = settings.section === "home";
    const home = nav.createDiv({ cls: `pdt-nav-item is-home${onHome ? " is-active" : ""}`, attr: { role: "tab", tabindex: "0", "aria-label": t("nav.home") } });
    setIcon(home, "home");
    setTooltip(home, t("nav.home"));
    home.onclick = () => this.update("section", "home");
    onActivate(home, () => this.update("section", "home"));
    const strip = nav.createDiv({ cls: "pdt-seg pdt-strip", attr: { role: "tablist" } });
    const widgetKey = (id) => (id.startsWith(VIEW_PREFIX) ? id : `widget:${id}`);   // a widget's id can be a tab's ("new")
    const active = onHome ? null : this.preset ? widgetKey(this.preset.id) : settings.mode;
    const tab = (key, label, go, cls = "") => {
      const el = strip.createDiv({ cls: `pdt-tab ${cls}${key === active ? " is-active" : ""}`, attr: { role: "tab", tabindex: "0", "aria-selected": String(key === active) } });
      el.dataset.key = key;
      el.createSpan({ cls: "pdt-tab-label", text: label });
      el.onclick = go;
      onActivate(el, go);
      return el;
    };
    for (const mode of MODE_KEYS) {
      const go = mode === "tracked" ? () => this.openTracked(settings.trackedGroup) : () => { settings.section = "list"; return this.update("mode", mode); };
      const el = tab(mode, this.similar && mode === "all" ? t("similar.tab") : t(`mode.${mode}`), go);
      this.refs.counts[mode] = el.createSpan({ cls: "pdt-n", text: "…" });
      setTooltip(el, pageQuery(settings, mode));   // the page is its query
      if (mode === "tracked") {
        const updates = this.plugin.catalog ? this.plugin.updatesCount() : 0;
        if (updates) el.createSpan({ cls: "pdt-n is-updates", text: t("tracked.updatesBadge", { n: updates }) });
      }
    }
    const views = settings.home.views || [];
    const temp = this.preset && !this.preset.id.startsWith(VIEW_PREFIX) ? this.preset : null;
    if (views.length || temp) strip.createDiv({ cls: "pdt-strip-sep" });
    const ctx = views.length && this.plugin.catalog ? this.home.context(Date.now()) : null;
    for (const v of views) {
      const id = VIEW_PREFIX + v.id;
      const el = tab(id, v.name, () => this.home.openView(id), "is-view");
      setTooltip(el, v.query);
      const widget = ctx && homeWidget(settings.home, id);
      const fresh = widget ? freshRows(ctx, widget, {}, widget.rows(ctx, {}), sinceMoment(settings.home, id, ctx.now))?.length : 0;
      if (fresh) el.createSpan({ cls: "pdt-n is-fresh", text: `+${formatCount(fresh)}` });   // matches you haven't seen
    }
    if (temp) {   // a widget's list: shown, not saved; ✕ goes home
      const words = Object.entries(temp.params).filter(([k]) => k !== "since").map(([k, v]) => this.home.paramText(k, v)).join(" · ");
      const el = tab(widgetKey(temp.id), words ? `${this.home.title(temp.id)} · ${words}` : this.home.title(temp.id), () => {}, "is-temp");
      setIcon(el.createSpan({ cls: "pdt-tab-icon" }), homeWidget(settings.home, temp.id)?.icon || "list");
      el.prepend(el.lastChild);
      const close = el.createEl("button", { cls: "pdt-similar-step", attr: { type: "button", "aria-label": t("home.back") } });
      setIcon(close, "x");
      setTooltip(close, t("home.back"));
      close.onclick = (event) => { event.stopPropagation(); this.closePreset(); };
    }
    strip.querySelector(".is-active")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });   // a narrow panel scrolls to it
    if (!onHome && this.plugin.data.ops?.length) {
      iconButton(nav, "history", t("bulk.recent"), "pdt-nav-recent").onclick = () => this.openRecent();
    }
  }

  /** The Tracked list, on one of its groups (UPDATES: new releases). */
  openTracked(group = "") {
    this.settings.section = "list";
    this.settings.trackedGroup = group;
    return this.update("mode", "tracked");
  }

  /**
   * A home widget's (or saved view's) plugins as a list in Query mode: its query in the box, to edit and save as
   * a view; `freshIds` marked new (`onlyNew`: only them). ✕ (or Esc) goes back home.
   */
  openPreset(id, params, freshIds = new Set(), onlyNew = false) {
    Object.assign(this, { similar: null, filtersOpen: false, visible: PAGE_SIZE, queryDraft: null });
    const query = homeWidget(this.settings.home, id)?.query?.(this.home.context(Date.now()), params) ?? "";
    this.preset = { id, params, freshIds, onlyNew, base: query };
    // a page of its own, opened in Query mode on its query (Basic narrows it with filters, like a tab)
    this.settings.queries = { ...this.settings.queries, [this.page]: query };
    Object.assign(this.settings, { section: "list", mode: "all" });   // shown, not saved: ✕ goes home
    this.render();
    this.contentEl.scrollTop = 0;
  }

  closePreset() {
    const { [this.page]: gone, ...queries } = this.settings.queries || {};   // the list's box goes with it
    this.settings.queries = queries;
    this.preset = null;
    this.queryDraft = null;
    this.settings.section = "home";
    this.render();
  }

  /** The list as a page (its query, or Basic: the query narrowed by your filters), then only the new ones when asked. */
  presetRows() {
    const { freshIds, onlyNew } = this.preset;
    const rows = discover(this.plugin.state(), modeOptions(this.pageSettings, this.page), Date.now());
    return onlyNew ? rows.filter((p) => freshIds.has(p.id)) : rows;
  }

  /** "Only the N new" on a widget's list (✕ shows all of it). */
  renderOnlyNew(bar) {
    const fresh = bar.createDiv({ cls: "pdt-chip pdt-similar-chip is-fresh" });
    fresh.createSpan({ text: t("home.onlyNew", { when: this.home.sinceLabel(this.settings.home.since.period) }) });
    const all = fresh.createEl("button", { cls: "pdt-similar-step", attr: { type: "button", "aria-label": t("home.showAll") } });
    setIcon(all, "x");
    setTooltip(all, t("home.showAll"));
    all.onclick = () => { this.preset.onlyNew = false; this.render(); };
  }

  /** Tracked tab: one Group menu (All, New releases, Starred, Ungrouped, then your groups), Sections, Status. */
  renderTrackedBar(bar) {
    const settings = this.settings;
    const notes = [...this.plugin.notes.index.values()];
    const state = this.plugin.state();
    const options = [
      ["", t("tracked.allCount", { n: notes.length })],
      [UPDATES, t("tracked.updates", { n: this.plugin.updatesCount(state, Date.now()) })],
      [STARRED, t("tracked.starredCount", { n: notes.filter((n) => n.favorite).length })],
      [UNGROUPED, t("tracked.ungroupedCount", { n: notes.filter((n) => !n.groups.length).length })],
      ...this.plugin.notes.groups().map((g) => [g.name, `${g.name}  ${formatCount(g.count)}`]),
    ];
    menuChip(bar, t("tracked.group"), options, settings.trackedGroup, (value) => this.update("trackedGroup", value));
    if (!settings.trackedGroup) {
      switchChip(bar, { label: t("tracked.sections"), on: Boolean(settings.trackedSections), onToggle: (on) => this.update("trackedSections", on) });
    }
    if (settings.statusEnabled) {
      menuChip(bar, t("tracked.status"), [["", t("tracked.anyStatus")], ...settings.statuses.map((st) => [st.key, st.label])],
        settings.trackedStatus, (value) => this.update("trackedStatus", value));
    }
  }

  /** Saves a per-tab setting (downloadFilter, sortBy) for the current tab. */
  updateTab(key, value) {
    return this.update(key, { ...this.settings[key], [this.page]: value });
  }

  renderFilters(bar) {
    const mode = this.page;
    const opts = modeOptions(this.pageSettings, mode);
    this.renderFilterButton(bar, mode, opts);   // always first, never moves
    if (this.preset?.onlyNew) this.renderOnlyNew(bar);   // a widget's "N new": only those (✕ shows all)
    if (this.similar) this.renderSimilarChip(bar);   // the same bar as All, plus the Similar chip
    if (mode === "tracked") this.renderTrackedBar(bar);

    // the Similar filter sorts by closeness first, with its own sort and search
    const similar = this.similar;
    const { key, dir } = similar ? this.settings.similarSort : { key: opts.sort, dir: opts.sortDir };
    const setSort = (value) => (similar ? this.update("similarSort", value) : this.updateTab("sortBy", value));
    const sort = bar.createDiv({ cls: "pdt-sort" });
    menuChip(sort, t("filter.sort"), (similar ? SIMILAR_SORT_KEYS : SORT_KEYS).map((k) => [k, t(`sort.${k}`)]), key,
      (k) => setSort({ key: k, dir: NATURAL_DIR[k] || "desc" }));
    const ascending = dir === "asc";
    const tip = t(`sort.${key === "name" ? (ascending ? "az" : "za") : ascending ? "asc" : "desc"}`);
    iconButton(sort, ascending ? "arrow-up-narrow-wide" : "arrow-down-wide-narrow", tip, "pdt-sort-dir").onclick =
      () => setSort({ key, dir: ascending ? "desc" : "asc" });

    if (similar) {
      this.refs.search = this.renderSearch(bar, similar.query, t("similar.search", { n: this.similarRows(false).length }), (value) => {
        similar.query = value;
        this.visible = PAGE_SIZE;
        this.refresh();
      });
    } else {
      const flat = (q) => q.replace(/\s*\n\s*/g, " ");
      const own = flat(pageQuery(this.pageSettings, mode));
      const placeholder = this.inQuery ? own : `${own} · ${t("search.narrow")}`;
      this.refs.search = this.renderSearch(bar, this.boxText, placeholder, async (value) => {
        // an invalid query isn't applied (like Jira): the list keeps the last valid one, the box keeps what you typed
        this.queryDraft = compileQuery(value, null, Date.now(), this.inQuery).error ? value : null;
        this.renderStatus(this.refs.status);
        if (this.queryDraft != null) return;
        if (this.inQuery) {
          this.settings.queries = { ...this.settings.queries, [mode]: value };
          this.rememberQuery(value);
        } else this.settings.query = value;
        this.visible = PAGE_SIZE;
        this.clearSelection();   // another search, another list
        this.refresh();
        await this.plugin.saveData(this.plugin.data);
      }, true);
    }

    if (!LIST_MODES.includes(mode)) this.renderLayoutSwitch(bar);
    if (!similar && !LIST_MODES.includes(mode)) {
      const save = bar.createEl("button", { cls: "pdt-chip pdt-filter-save", attr: { type: "button" } });
      setIcon(save.createSpan({ cls: "pdt-chip-caret" }), "bookmark-plus");
      save.createSpan({ text: t("home.view.save") });
      setTooltip(save, t("home.view.saveTip"));
      save.onclick = () => this.saveView();
    }
    if (this.settings.keyboard) this.renderKeyHelp(bar);
    // quick filters (Jira style): the changed and added ones as chips on a row of their own, under the bar
    if (this.quickFilters && !this.inQuery) this.renderFilterChips(bar.parentElement.createDiv({ cls: "pdt-quick" }), mode, opts, false);
    bar.toggleClass("is-query", this.inQuery);   // Filter and Sort step back: the query decides
    this.updateFilterHead();
  }

  /** Quick filters on this tab: the filters you changed or added show under the bar (off: only in the panel). */
  get quickFilters() {
    return Boolean(this.settings.quickFilters?.[this.page]);
  }

  /**
   * "Filter ▾ (N)": always first in the bar, only its count changes. It opens a panel with every filter of the
   * tab (changed ones marked with ↺, added ones with ✕), the filters you can add, the quick-filter switch and Reset.
   */
  renderFilterButton(bar, mode, opts) {
    const wrap = bar.createDiv({ cls: `pdt-filter-menu${this.filtersOpen ? " is-open" : ""}` });
    const head = wrap.createEl("button", { cls: "pdt-chip pdt-filter-head", attr: { type: "button", "aria-expanded": String(Boolean(this.filtersOpen)), "aria-haspopup": "true" } });
    setIcon(head.createSpan({ cls: "pdt-chip-caret" }), "sliders-horizontal");
    head.createSpan({ text: t("filter.more") });
    this.refs.filterCount = head.createSpan({ cls: "pdt-filter-count" });
    setIcon(head.createSpan({ cls: "pdt-chip-caret" }), "chevron-down");
    head.onclick = () => { this.filtersOpen = !this.filtersOpen; this.render(); };
    if (!this.filtersOpen) return;

    const panel = wrap.createDiv({ cls: "pdt-filter-panel", attr: { role: "dialog", "aria-label": t("filter.more") } });
    panel.addEventListener("keydown", (event) => { if (event.key === "Escape") { this.filtersOpen = false; this.render(); } });
    this.renderFilterChips(panel, mode, opts, true);
    const addable = this.inQuery ? [] : addableFilters(this.settings, mode);
    if (this.inQuery) panel.createDiv({ cls: "pdt-filter-note", text: t("filter.queryNote") });
    if (addable.length) {
      panel.createDiv({ cls: "pdt-filter-group", text: t("filter.addTitle") });
      const adds = panel.createDiv({ cls: "pdt-filter-adds" });
      for (const key of addable) {
        const add = adds.createEl("button", { cls: "pdt-chip pdt-filter-add", attr: { type: "button" } });
        setIcon(add.createSpan({ cls: "pdt-chip-icon" }), EXTRA_FILTERS[key].icon);
        add.createSpan({ text: t(`filter.x.${key}`) });
        add.onclick = () => this.setExtra(key, EXTRA_FILTERS[key].value);
      }
    }
    const foot = panel.createDiv({ cls: "pdt-filter-foot" });
    switchChip(foot, { label: t("filter.quick"), tip: t("filter.quickTip"), on: this.quickFilters,
      onToggle: (on) => this.update("quickFilters", { ...this.settings.quickFilters, [mode]: on }) });
    const clear = foot.createEl("button", { cls: "pdt-filter-clear", attr: { type: "button" } });
    clear.onclick = () => this.clearFilters();
    this.refs.filterClear = clear;
  }

  /**
   * The tab's filters as chips: its own (all of them, or with `all` false only the changed ones, each with ↺),
   * then the added ones (✕). The panel lists all; the quick row only what's in effect, then Reset.
   */
  renderFilterChips(parent, mode, opts, all) {
    const settings = this.settings;
    const changed = new Set(changedFilterKeys(this.filterState(), mode));
    const own = (key, build) => {
      if (!all && !changed.has(key)) return;
      const chip = build(parent);
      if (!changed.has(key)) return;
      chip.addClass("is-changed");
      this.chipButton(chip, "rotate-ccw", t("filter.resetOne"), () => this.resetFilter(key));
    };
    if (all) parent.createDiv({ cls: "pdt-filter-group", text: t("filter.ownTitle") });
    if (!this.similar && changed.has("query") && !this.inQuery) {
      own("query", (p) => { const chip = p.createDiv({ cls: "pdt-chip" }); chip.createSpan({ text: t("filter.tipSearch", { q: settings.query.trim() }) }); return chip; });
    }
    if (!this.inQuery) {
      own("downloadFilter", (p) => toggleChip(p, {
        label: t("filter.downloads"),
        value: settings.minDownloads,
        on: opts.filterDownloads,
        onToggle: (on) => this.updateTab("downloadFilter", on),
        onValue: async (n) => {
          settings.minDownloads = n;
          await this.updateTab("downloadFilter", true);
        },
      }));
    }
    const extras = Object.entries(opts.extras).filter(([key]) => EXTRA_FILTERS[key]);
    if (all && extras.length) parent.createDiv({ cls: "pdt-filter-group", text: t("filter.addedTitle") });
    for (const [key, value] of extras) this.renderExtraChip(parent, key, value);
    if (!all && changed.size) parent.createEl("button", { cls: "pdt-filter-clear", text: t("filter.resetAll"), attr: { type: "button" } }).onclick = () => this.clearFilters();
  }

  /** A small round button at the end of a chip (↺ back to the default, ✕ remove). */
  chipButton(chip, icon, tip, onClick) {
    const button = chip.createEl("button", { cls: "pdt-similar-step pdt-chip-act", attr: { type: "button", "aria-label": tip } });
    setIcon(button, icon);
    setTooltip(button, tip);
    button.onclick = (event) => { event.stopPropagation(); onClick(); };
    return button;
  }

  /** A filter added with "+ Filter": its icon, name and value (typed, or a preset), ✕ removes it. */
  renderExtraChip(panel, key, value) {
    const filter = EXTRA_FILTERS[key];
    const label = t(`filter.x.${key}`);
    const set = (v) => this.setExtra(key, v);
    let chip;
    if (filter.kind === "number") {
      chip = numberChip(panel, { label, unit: filter.unit === "days" ? t("filter.daysUnit") : "", min: 0, max: 1e9, presets: filter.presets, value, onChange: set,
        format: (n) => extraValueText(key, n) });
    } else {
      chip = panel.createDiv({ cls: "pdt-chip" });
      chip.createSpan({ text: label });
      if (filter.kind === "text") {
        const input = chip.createEl("input", { type: "text", value, attr: { "aria-label": label, placeholder: "…" } });
        input.onchange = () => set(input.value.trim());
      }
    }
    chip.addClass("is-extra");
    const icon = chip.createSpan({ cls: "pdt-chip-icon" });
    setIcon(icon, filter.icon);
    chip.prepend(icon);
    this.chipButton(chip, "x", t("filter.remove"), () => this.setExtra(key, undefined));
    if (filter.kind === "text" && !value) chip.querySelector("input")?.focus();
  }

  /** Adds, changes (a value) or removes (undefined) a filter added with "+ Filter" on this tab. */
  async setExtra(key, value) {
    this.clearSelection();
    const mode = this.page;
    const { [key]: old, ...rest } = this.settings.extraFilters?.[mode] || {};
    this.settings.extraFilters = { ...this.settings.extraFilters, [mode]: value === undefined ? rest : { ...rest, [key]: value } };
    this.visible = PAGE_SIZE;
    await this.plugin.saveData(this.plugin.data);
    this.render();
  }

  /** Saves what the list shows as a view (its query): asks for a name, then it's a tab in the strip and a widget on the home page. */
  async saveView() {
    const mode = this.page;
    const query = this.inQuery ? this.boxText : joinQuery(pageQuery(this.pageSettings, mode), filtersToQuery(this.settings, mode));
    const suggested = this.preset ? this.home.title(this.preset.id) : t(`mode.${mode}`);
    const name = await new TextModal(this.app, { title: t("home.view.saveTitle"), value: suggested, cta: t("home.view.save") }).ask();
    if (!name) return;
    const view = await this.home.saveView(name, query, queryRows(this.home.context(Date.now()), query));
    new Notice(t("home.view.saved", { name }));
    this.home.openView(VIEW_PREFIX + view.id);
  }

  /** ↺ on a changed chip: that filter back to the tab's default. */
  async resetFilter(key) {
    this.clearSelection();
    const cleared = clearedFilters(this.settings, this.page);
    if (key === "downloadFilter") Object.assign(this.settings, { downloadFilter: cleared.downloadFilter, minDownloads: cleared.minDownloads });
    else this.settings[key] = cleared[key];
    this.visible = PAGE_SIZE;
    await this.plugin.saveData(this.plugin.data);
    this.render();
  }

  /** The button's count (and the panel's Reset) follow the filters, the search included, without redrawing the bar. */
  updateFilterHead() {
    const { filterCount, filterClear } = this.refs;
    if (!filterCount) return;
    const n = changedFilters(this.filterState(), this.page);
    filterCount.setText(n ? String(n) : "");
    filterCount.toggleClass("is-hidden", !n);
    filterClear?.setText(t("filter.reset", { n }));
    filterClear?.toggleClass("is-hidden", !n);
    setTooltip(filterCount.parentElement, filterSummary(this.filterState(), this.page));
  }

  /** The settings the filters read: inside the Similar filter, its own search stands in for the tab's. */
  filterState() {
    return this.similar ? { ...this.settings, query: this.similar.query } : this.pageSettings;
  }

  async clearFilters() {
    this.clearSelection();
    const { query, ...cleared } = clearedFilters(this.settings, this.page);
    if (this.similar) this.similar.query = "";   // the All tab's own search stays as it was
    else cleared.query = query;
    Object.assign(this.settings, cleared);
    this.visible = PAGE_SIZE;
    await this.plugin.saveData(this.plugin.data);
    this.render();
  }

  /** "Clear filters": the tab's filters (and the search) back to their defaults; sort and layout stay. */
  renderClearFilters(parent) {
    const button = parent.createEl("button", { cls: "pdt-ghost pdt-clear-filters", attr: { type: "button" } });
    setIcon(button.createSpan({ cls: "pdt-chip-caret" }), "filter-x");
    button.createSpan({ text: t("filter.clear") });
    button.onclick = () => this.clearFilters();
    return button;
  }

  /**
   * The search box (comma terms, /regex/ or the query language). A textarea over a painted copy of its text: the
   * copy colours each word by its role (field, operator, value, function, keyword) and underlines a broken part,
   * and gives the box its height (long queries wrap, new lines are kept). `onChange` runs 1 s after typing stops,
   * at once when the box is cleared or on Enter (Ctrl/Cmd+Enter in a query, where Enter starts a new line).
   * `modes` (the list's own box): the Basic | Query buttons and the switch to Query as an advanced query is typed.
   * Returns the textarea.
   */
  renderSearch(bar, value, placeholder, onChange, modes = false) {
    const queryMode = modes === "query" || (modes === true && this.inQuery);   // "query": always (a widget's list)
    const search = bar.createDiv({ cls: `pdt-search${queryMode ? " is-query" : ""}` });
    setIcon(search.createSpan({ cls: "pdt-search-icon" }), "search");
    const box = search.createDiv({ cls: "pdt-q" });
    const paint = box.createDiv({ cls: "pdt-q-paint", attr: { "aria-hidden": "true" } });
    const input = box.createEl("textarea", { cls: "pdt-q-input", attr: { rows: "1", placeholder, spellcheck: "false", autocomplete: "off", autocapitalize: "off" } });
    input.value = value || "";
    const badge = search.createSpan({ cls: "pdt-regex", text: ".*" });
    setTooltip(badge, t("search.regex"));
    const help = iconButton(search, "help-circle", t("query.help.title"), "pdt-qhelp-button");
    help.onclick = () => new QueryHelpModal(this.app, (text) => {   // a click puts it at the caret
      const at = input.selectionStart ?? input.value.length;
      const before = input.value.slice(0, at);
      const glue = before && !/\s$/.test(before) ? " " : "";
      input.value = `${before}${glue}${text} ${input.value.slice(input.selectionEnd ?? at)}`;
      const caret = before.length + glue.length + text.length + 1;
      input.focus();
      input.setSelectionRange(caret, caret);
      input.dispatchEvent(new Event("input"));
    }).open();
    const seg = modes === true && this.renderQueryModes(search, queryMode);
    const mark = () => {
      const text = input.value;
      const { regex, error, advanced, from = 0, to = 0 } = compileQuery(text, null, Date.now(), queryMode);
      search.toggleClass("is-regex", regex && !error);
      search.toggleClass("is-advanced", Boolean(advanced));
      search.toggleClass("is-invalid", Boolean(error));
      setTooltip(input, error || "");
      paint.empty();
      const bad = error ? [from, to] : null;
      const piece = (a, b, cls) => {
        if (a >= b) return;
        const broken = bad && a < bad[1] && b > bad[0];
        if (cls || broken) paint.createSpan({ cls: [cls && `pdt-q-${cls}`, broken && "is-bad"].filter(Boolean).join(" "), text: text.slice(a, b) });
        else paint.append(text.slice(a, b));
      };
      let at = 0;
      for (const tok of advanced ? queryHighlight(text) : []) {
        piece(at, tok.at, "");
        piece(tok.at, tok.end, tok.cls);
        at = tok.end;
      }
      piece(at, text.length, "");
      paint.append("\u200b");   // keeps a trailing new line's height
      if (seg) seg.refresh(text);
    };
    if (QuerySuggest) new QuerySuggest(this.app, input, () => this.queryData(modes === true));
    mark();
    let timer;
    const apply = (delay) => {
      clearTimeout(timer);
      timer = setTimeout(() => onChange(input.value), delay);
    };
    input.oninput = () => {
      if (modes === true && !queryMode && isAdvancedQuery(input.value)) return this.toQueryMode(input);   // typed a query: Query mode
      mark();
      apply(input.value.trim() ? 1000 : 0);
    };
    input.onkeydown = (event) => {
      if (event.key === " " && event.ctrlKey) {   // Ctrl+Space: the suggestions, wherever the caret is
        event.preventDefault();
        input.dispatchEvent(new Event("input"));
        return;
      }
      if (event.key === "Escape" && !event.defaultPrevented && input.value) {   // an open list took the first Esc
        event.preventDefault();
        event.stopPropagation();
        input.value = queryMode ? pageQuery(this.pageSettings, this.page) : "";
        input.oninput();
        return;
      }
      if (event.key !== "Enter" || event.defaultPrevented || event.isComposing) return;   // a picked suggestion took it
      if (event.ctrlKey || event.metaKey || !search.hasClass("is-advanced")) {
        event.preventDefault();
        apply(0);
      }
    };
    return input;
  }

  /**
   * Basic | Query, at the box's end (Jira's Basic / JQL). Query writes the filters into the box; Basic turns the
   * query back into filters, and is locked (with the reason) when the query has something filters can't say.
   */
  renderQueryModes(search, queryMode) {
    const seg = search.createDiv({ cls: "pdt-qmode", attr: { role: "group" } });
    const basic = seg.createEl("button", { cls: "pdt-qmode-option", text: t("query.mode.basic"), attr: { type: "button", "aria-pressed": String(!queryMode) } });
    const query = seg.createEl("button", { cls: "pdt-qmode-option", text: t("query.mode.query"), attr: { type: "button", "aria-pressed": String(queryMode) } });
    setTooltip(query, t("query.mode.queryTip"));
    let reason = "";
    basic.onclick = () => (!queryMode ? null : reason ? new Notice(reason) : this.toBasicMode());
    query.onclick = () => (queryMode ? null : this.toQueryMode());
    seg.refresh = (text) => {
      reason = queryMode ? queryToBasic(text, this.pageSettings, this.page).reason || "" : "";
      basic.toggleClass("is-locked", Boolean(reason));
      setTooltip(basic, reason || t("query.mode.basicTip"));
    };
    return seg;
  }

  /**
   * To Query mode: the page's query with your narrowing (words, Downloads ≥, added filters, your sort) goes into
   * the box, and the narrowing rests. From typing (`input`), what you typed comes after the page's query.
   */
  async toQueryMode(input = null) {
    const settings = this.settings;
    const mode = this.page;
    const page = pageQuery(this.pageSettings, mode);
    const full = joinQuery(page, filtersToQuery(settings, mode));
    let text = full;
    let caret = null;
    if (input) {
      const lead = splitOrder(joinQuery(page, filtersToQuery({ ...settings, query: "" }, mode)));
      const typed = input.value;
      const mine = splitOrder(typed);   // your own order by replaces the page's
      const joint = /^(AND|OR)\b/i.test(mine.filter) ? " " : " AND ";   // after the page's query, joined by AND
      const filter = [lead.filter, mine.filter].filter(Boolean).join(joint);
      text = typed.startsWith(lead.filter) ? typed : [filter, mine.order || lead.order].filter(Boolean).join("\n");
      caret = typed.startsWith(lead.filter) ? input.selectionStart : mine.filter ? (input.selectionStart ?? typed.length) + filter.length - mine.filter.length : text.length;
    }
    const valid = !compileQuery(text, null, Date.now(), true).error;
    const { [mode]: sort, ...sortBy } = settings.sortBy || {};
    const { [mode]: dl, ...downloadFilter } = settings.downloadFilter || {};
    Object.assign(settings, { query: "", sortBy, downloadFilter, extraFilters: { ...settings.extraFilters, [mode]: {} },
      queries: { ...settings.queries, [mode]: valid ? text : full } });
    this.queryDraft = valid ? null : text;
    this.visible = PAGE_SIZE;
    this.clearSelection();
    this.render();
    const box = this.refs.search;
    box.focus();
    box.setSelectionRange(caret ?? text.length, caret ?? text.length);
    await this.plugin.saveData(this.plugin.data);
  }

  /** Back to Basic: what follows the page's query becomes filters again, its order by the sort. */
  async toBasicMode() {
    const { patch, reason } = queryToBasic(this.boxText, this.pageSettings, this.page);
    if (reason) return new Notice(reason);
    Object.assign(this.settings, patch);
    this.queryDraft = null;
    this.visible = PAGE_SIZE;
    this.clearSelection();
    this.render();
    await this.plugin.saveData(this.plugin.data);
  }

  /** Query mode, the box no longer the page's query: make it the page's (Settings › Page queries undoes it). */
  async savePageQuery() {
    const mode = this.page;
    const text = this.settings.queries[mode];
    const { [mode]: old, ...rest } = this.settings.pageQueries || {};
    const same = (a, b) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
    this.settings.pageQueries = same(text, defaultPageQuery(mode)) ? rest : { ...rest, [mode]: text };
    await this.plugin.saveData(this.plugin.data);
    new Notice(t("query.pageSaved", { name: t(`mode.${mode}`) }));
    this.render();
  }

  /** The last queries you applied (up to RECENT_QUERIES), newest first, for the empty box's list. */
  rememberQuery(text) {
    const q = text.trim();
    if (!q) return;
    const flat = (x) => x.replace(/\s+/g, " ");
    this.settings.recentQueries = [q, ...(this.settings.recentQueries || []).filter((x) => flat(x) !== flat(q))].slice(0, RECENT_QUERIES);
  }

  /** Query mode: the box back to the page's own query. */
  async revertQuery() {
    const mode = this.page;
    this.settings.queries = { ...this.settings.queries, [mode]: pageQuery(this.settings, mode) };
    this.queryDraft = null;
    this.visible = PAGE_SIZE;
    this.render();
    await this.plugin.saveData(this.plugin.data);
  }

  /**
   * What the query suggestions offer as values: your groups (with counts), statuses, and the catalog's authors;
   * for the empty list box (`modes`), your filters as a query.
   */
  queryData(modes = false) {
    if (!this.authors || this.authors.at !== this.plugin.catalog?.fetchedAt) {
      const byAuthor = new Map();
      for (const p of this.plugin.catalog?.plugins || []) if (p.author) byAuthor.set(p.author, (byAuthor.get(p.author) || 0) + (p.downloads || 0));
      this.authors = { at: this.plugin.catalog?.fetchedAt, list: [...byAuthor].sort((a, b) => b[1] - a[1]).map(([name]) => name) };
    }
    const fromFilters = modes && !this.inQuery ? joinQuery(pageQuery(this.pageSettings, this.page), filtersToQuery({ ...this.pageSettings, query: "" }, this.page)) : "";
    return { groups: this.plugin.notes.groups(), statuses: this.settings.statuses || [], authors: this.authors.list, fromFilters, recent: this.settings.recentQueries || [] };
  }

  /** The Similar filter as one chip: ‹ back (when there is a step), ≈ Similar: name (opens its details), ✕. */
  renderSimilarChip(bar) {
    const { steps } = this.similar;
    const seed = this.plugin.pluginById(steps.at(-1).id);
    const chip = bar.createDiv({ cls: "pdt-chip pdt-similar-chip" });
    if (steps.length > 1) {
      const back = chip.createEl("button", { cls: "pdt-similar-step", attr: { type: "button", "aria-label": t("similar.back") } });
      setIcon(back, "chevron-left");
      setTooltip(back, t("similar.backTo", { name: this.plugin.pluginById(steps.at(-2).id)?.name ?? "–" }));
      back.onclick = () => this.similarBack();
    }
    chip.createSpan({ cls: "pdt-similar-sign", text: "≈" });
    chip.createSpan({ text: t("similar.chip") });
    const name = chip.createEl("a", { cls: "pdt-chip-value", text: seed?.name ?? "–", href: "#" });
    setTooltip(name, t("details.open"));
    name.onclick = (event) => { event.preventDefault(); if (seed) this.openDetails(seed); };
    const close = chip.createEl("button", { cls: "pdt-similar-step", attr: { type: "button", "aria-label": t("similar.closeFilter") } });
    setIcon(close, "x");
    setTooltip(close, t("similar.closeFilter"));
    close.onclick = () => this.closeSimilar();
  }

  /** ⌨ icon with a card of the shortcuts, shown on hover or keyboard focus. */
  renderKeyHelp(bar) {
    const help = bar.createDiv({ cls: "pdt-keys", attr: { tabindex: "0", "aria-label": t("keys.title") } });
    setIcon(help.createSpan({ cls: "pdt-keys-icon" }), "keyboard");
    const card = help.createDiv({ cls: "pdt-keys-card", attr: { role: "tooltip" } });
    card.createDiv({ cls: "pdt-keys-title", text: t("keys.title") });
    for (const [keys, label] of KEY_HELP) {
      const line = card.createDiv({ cls: "pdt-keys-row" });
      const cell = line.createSpan({ cls: "pdt-keys-keys" });
      for (const key of keys) cell.createEl("kbd", { text: key });
      line.createSpan({ text: t(label) });
    }
  }

  renderStatus(status) {
    const { catalog, timeline } = this.plugin;
    status.empty();
    const text = status.createDiv({ cls: "pdt-status-text" });
    const now = Date.now();
    if (!catalog) {
      text.setText(this.plugin.busy ? this.plugin.progress || t("status.syncing") : t("status.loading"));
    } else if (this.preset) {
      text.createDiv({ text: t("home.status", { n: formatCount(this.presetRows().length), name: this.home.title(this.preset.id) }) });
    } else if (this.similar) {   // one line about the filter instead of the sync line
      const seed = this.plugin.pluginById(this.similar.steps.at(-1).id);
      const found = seed ? this.plugin.similarTo(seed) : [];
      text.createDiv({ text: t("similar.status", { n: formatCount(this.similarCount()), how: t(found[0]?.cosine != null ? "similar.byMeaning" : "similar.byWords") }) });
    } else {
      text.createDiv({
        text: [
          t("status.plugins", { n: formatCount(catalog.plugins.length) }),
          t("status.lastSync", { time: formatTime(catalog.fetchedAt, now), age: formatAge(now - catalog.fetchedAt) }),
          timeline.to ? t(now - timeline.to > HISTORY_STALE_DAYS * DAY_MS ? "status.historyOld" : "status.history", { year: new Date(timeline.from).getFullYear(), date: dayString(timeline.to) }) : t("status.noHistory"),
          ...this.activeFilters(),
        ].join("  ·  "),
      });
      const { delta } = catalog;
      if (this.plugin.busy) text.createDiv({ cls: "pdt-progress", text: this.plugin.progress || t("status.syncing") });
      else if (delta) text.createDiv({ cls: "pdt-delta", text: t("status.delta", { added: formatCount(delta.added), updated: formatCount(delta.updated) }) });
    }
    const query = this.similar ? "" : this.boxText.trim();   // the Similar filter has its own search
    if (query) {  // a saved search shouldn't be forgotten: this is why the list is short
      const { error, advanced, at, clauses, free = [] } = compileQuery(query, null, Date.now(), this.inQuery);
      const wrap = status.createDiv({ cls: "pdt-query-wrap" });   // the query's line, and what you can do with it
      const tag = wrap.createDiv({ cls: `pdt-query${error ? " is-invalid" : ""}` });
      // a query isn't repeated: how many clauses, plus the words it searches
      const words = free.length ? ` + “${free.join(" ")}”` : "";
      tag.createSpan({ text: advanced
        ? (error ? t("query.invalid", { error, at: at + 1 }) : `${t("query.clauses", { n: clauses })}${words}`)
        : (error ? t("search.invalid", { error }) : t("status.query", { q: query })) });
      if (this.inQuery && advanced && !error) {
        // hover: what each clause finds on its own; nothing found: the clause that emptied the list
        tag.addEventListener("mouseenter", () => setTooltip(tag, this.clauseCounts(query).map(([c, n]) => `${c}  →  ${formatCount(n)}`).join("\n")), { once: true });
        const shown = this.preset ? this.presetRows().length : discover(this.plugin.state(), modeOptions(this.pageSettings, this.page), Date.now()).length;
        if (shown === 0) {
          const best = this.clauseCounts(query, true)[0];
          if (best?.[1] > 0) wrap.createSpan({ cls: "pdt-query-why", text: t("query.without", { clause: best[0], n: formatCount(best[1]) }) });
        }
      }
      if (this.inQuery) this.renderQueryChanged(wrap, query);
      const clear = this.inQuery ? null : tag.createSpan({ cls: "pdt-query-clear", text: t("status.clear"), attr: { role: "button", tabindex: "0" } });
      if (clear) clear.onclick = async () => {
        this.settings.query = "";
        this.queryDraft = null;
        if (this.refs.search) {
          this.refs.search.value = "";
          this.refs.search.oninput();   // repaints the box
        }
        this.visible = PAGE_SIZE;
        this.refresh();
        await this.plugin.saveData(this.plugin.data);
      };
      if (clear) onActivate(clear, () => clear.click());
    }
    const actions = status.createDiv({ cls: "pdt-status-actions" });
    if (!timeline.to && !this.plugin.busy) {
      actions.createEl("button", { cls: "mod-cta", text: t("status.build") }).onclick = () => this.plugin.downloadHistory();
    }
  }

  /**
   * Each clause of the query (NOT with its own) and how many plugins it finds on its own; `without`: how many the
   * query finds without it, most first (what emptied a list).
   */
  clauseCounts(query, without = false) {
    const spans = compileQuery(query, null, Date.now(), true).spans || [];
    const top = spans.filter((x) => x.kind !== "order" && !spans.some((y) => y !== x && y.from <= x.from && y.to >= x.to && y.kind === "neg"));
    const count = (text) => {
      const mode = this.page;
      return discover(this.plugin.state(), modeOptions({ ...this.pageSettings, queries: { ...this.settings.queries, [mode]: text } }, mode), Date.now()).length;
    };
    const rows = top.map((x) => {
      const clause = query.slice(x.from, x.to);
      return [clause, count(without ? `${query.slice(0, x.from)} ${query.slice(x.to)}` : clause)];
    });
    return without ? rows.sort((a, b) => b[1] - a[1]) : rows;
  }

  /** Query mode, the box no longer the page's own query: "changed · Save ▾ · Revert". */
  renderQueryChanged(status, query) {
    const same = (x, y) => x.replace(/\s+/g, " ").trim() === y.replace(/\s+/g, " ").trim();
    const preset = this.preset;
    const view = preset?.id.startsWith(VIEW_PREFIX);
    if (this.queryDraft != null) return;
    if (preset && !view && same(query, preset.base)) {   // a widget's list: it can become a view as it is
      const link = status.createSpan({ cls: "pdt-query-clear pdt-query-saveview", text: t("query.saveAsView"), attr: { role: "button", tabindex: "0" } });
      link.onclick = () => this.saveView();
      onActivate(link, () => this.saveView());
      return;
    }
    if (same(query, preset ? preset.base : pageQuery(this.pageSettings, this.page))) return;
    const box = status.createDiv({ cls: "pdt-query-changed" });
    box.createSpan({ text: t("query.changed") });
    const save = box.createEl("button", { cls: "pdt-query-save", text: t("query.save"), attr: { type: "button" } });
    save.onclick = (event) => {
      const menu = new Menu();
      if (view) menu.addItem((item) => item.setTitle(t("query.saveView", { name: this.home.title(preset.id) })).setIcon("save").onClick(async () => {
        await this.home.updateView(preset.id, query);
        preset.base = query;   // the view's query now: nothing changed any more
        this.render();
      }));
      else if (!preset) menu.addItem((item) => item.setTitle(t("query.saveAsPage", { name: t(`mode.${this.settings.mode}`) })).setIcon("save").onClick(() => this.savePageQuery()));
      menu.addItem((item) => item.setTitle(t("query.saveAsView")).setIcon("bookmark-plus").onClick(() => this.saveView()));
      menu.showAtMouseEvent(event);
    };
    const revert = box.createSpan({ cls: "pdt-query-clear", text: t("query.revert"), attr: { role: "button", tabindex: "0" } });
    revert.onclick = () => this.revertQuery();
    onActivate(revert, () => this.revertQuery());
  }

  /** "3 filters in effect" for the status line, when quick filters don't show them (so a short list has its reason). */
  activeFilters() {
    const n = changedFilters(this.filterState(), this.page);
    return n && !this.quickFilters ? [t("filter.active", { n })] : [];
  }

  /** Redraws only the status line (progress updates during a sync). */
  refreshStatus() {
    if (this.refs.status) this.renderStatus(this.refs.status);
  }

  renderList(list, state, now) {
    list.empty();
    this.rows = [];
    this.cards = this.settings.layout === "cards" && !LIST_MODES.includes(this.settings.mode);
    list.toggleClass("is-cards", this.cards);
    if (!this.plugin.catalog) return;
    const { timeline } = this.plugin;
    const mode = this.settings.mode;
    if (this.similar) return this.renderSimilarList(list, now);
    if (this.preset) {
      this.rows = this.presetRows();
      this.stale = new Set();
      if (!this.rows.length) return void list.createDiv({ cls: "pdt-empty", text: t("list.empty") });
      this.renderRows(list, this.rows.slice(0, this.visible), now);
      return this.renderMore(list);
    }
    if (mode === "awakened" && !timeline.to) {
      list.createDiv({ cls: "pdt-empty", text: t("list.needHistory") });
      return;
    }
    if (mode === "new" && !timeline.to) list.createDiv({ cls: "pdt-hint", text: t("list.legacyHint") });

    this.rows = discover(state, modeOptions(this.settings, mode), now);
    this.stale = new Set();
    for (const [id, index] of this.keep) {
      const p = this.rows.some((r) => r.id === id) ? null : this.plugin.pluginById(id);
      if (!p) continue;
      this.rows.splice(Math.min(index, this.rows.length), 0, p);
      this.stale.add(id);
    }
    if (LIST_MODES.includes(mode)) this.renderListBanner(list, mode);
    const sections = mode === "tracked" && !this.settings.trackedGroup && this.settings.trackedSections;
    const visible = sections ? this.rows : this.rows.slice(0, this.visible);   // sections show everything you track
    if (!this.rows.length) {
      const empty = list.createDiv({ cls: "pdt-empty", text: t("list.empty") });
      if (changedFilters(this.filterState(), mode) > 0) this.renderClearFilters(empty.createDiv());
      return;
    }
    if (sections) {
      for (const section of groupSections(this.rows, state.notes)) this.renderSection(list, section, now);
      return;
    }
    this.renderRows(list, visible, now);
    this.renderMore(list);
  }

  /** Rows as the layout says: list or cards (renderRow), or the table. */
  renderRows(list, rows, now) {
    if (this.settings.layout === "table" && this.selectable) return this.renderTable(list, rows, now);
    for (const p of rows) this.renderRow(list, p, now);
  }

  /**
   * The table: a pick box, Name (its description on hover), then the tab's columns; a header click sorts by it,
   * the last header opens the column picker. Favorite and Rating cells change on click; a row opens its details.
   */
  renderTable(list, rows, now) {
    const mode = this.settings.mode;
    const state = this.plugin.state();
    const columns = tableColumns(this.settings, mode);
    const { sort, sortDir } = modeOptions(this.settings, mode);
    const wrap = list.createDiv({ cls: "pdt-table-wrap" });
    const table = wrap.createEl("table", { cls: "pdt-table" });
    const head = table.createEl("thead").createEl("tr");
    const all = head.createEl("th", { cls: "pdt-table-pick" }).createEl("input", { type: "checkbox", cls: "pdt-select", attr: { "aria-label": t("table.pickShown") } });
    all.checked = rows.length > 0 && rows.every((p) => this.selected.has(p.id));
    all.onclick = () => { for (const p of rows) (all.checked ? this.selected.add(p.id) : this.selected.delete(p.id)); this.syncSelection(); };
    const header = (key, label, align = "left") => {
      const th = head.createEl("th", { cls: key === "name" ? "pdt-table-name" : `is-${align} is-${key} is-draggable` });
      th.dataset.key = key;
      const sortKey = key === "name" ? "name" : TABLE_COLUMNS[key].sort;
      if (!sortKey) return void th.setText(label);
      const on = sort === sortKey;
      th.setAttribute("aria-sort", on ? (sortDir === "asc" ? "ascending" : "descending") : "none");
      const button = th.createEl("button", { cls: `pdt-table-sort${on ? " is-on" : ""}`, text: on ? `${label} ${sortDir === "asc" ? "↑" : "↓"}` : label });
      button.onclick = () => this.updateTab("sortBy", { key: sortKey, dir: on ? (sortDir === "asc" ? "desc" : "asc") : NATURAL_DIR[sortKey] || "desc" });
    };
    header("name", t("col.name"));
    for (const key of columns) header(key, t(`col.${key}`), TABLE_COLUMNS[key].align);
    const saveColumns = async (next) => {
      this.settings.tableColumns = { ...this.settings.tableColumns, [mode]: next };
      if (!next) delete this.settings.tableColumns[mode];
      await this.plugin.saveData(this.plugin.data);
      this.refresh();
    };
    const pick = head.createEl("th", { cls: "pdt-table-cols" });
    iconButton(pick, "columns-3", t("table.columns")).onclick = () => new ColumnsModal(this.app, { columns, onChange: saveColumns }).open();
    // a column's header drags to a new place (Name and the edges stay)
    Sortable.create(head, { draggable: "th.is-draggable", animation: 150, onEnd: () => saveColumns([...head.querySelectorAll("th.is-draggable")].map((th) => th.dataset.key)) });

    const body = table.createEl("tbody");
    for (const p of rows) {
      const note = state.notes.get(p.id);
      const tr = body.createEl("tr", { cls: `pdt-trow${this.selected.has(p.id) ? " is-selected" : ""}`, attr: { "data-id": p.id, tabindex: "0" } });
      tr.onclick = (event) => { if (!event.target.closest("a, button, input")) this.openDetails(p); };
      const box = tr.createEl("td", { cls: "pdt-table-pick" }).createEl("input", { type: "checkbox", cls: "pdt-select", attr: { "aria-label": t("bulk.pick", { name: p.name }) } });
      box.checked = this.selected.has(p.id);
      box.onclick = (event) => { event.stopPropagation(); this.pick(p, box.checked, event.shiftKey); };
      const name = tr.createEl("td", { cls: "pdt-table-name" });
      name.createEl("a", { cls: "pdt-name", text: p.name, href: `obsidian://show-plugin?id=${encodeURIComponent(p.id)}` });
      if (p.version) name.createSpan({ cls: "pdt-ver", text: p.version });
      if (p.description) setTooltip(name, p.description, { delay: 300 });
      for (const key of columns) {
        const td = tr.createEl("td", { cls: `is-${TABLE_COLUMNS[key].align || "left"} is-${key}` });
        if (key === "favorite") {
          const star = td.createEl("button", { cls: `pdt-table-star${note?.favorite ? " is-on" : ""}`, text: note?.favorite ? "★" : "☆", attr: { "aria-label": t(note?.favorite ? "action.unfavorite" : "action.favorite") } });
          star.onclick = () => this.runRowAction(p, () => this.plugin.toggleFavorite(p));
        } else if (key === "rating") {
          const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);
          const cell = td.createEl("button", { cls: "pdt-table-rating", text: note?.rating ? stars(note.rating) : "·" });
          cell.onclick = () => this.pickFromMenu(cell, [[0, t("rating.clear")], ...[5, 4, 3, 2, 1].map((n) => [n, stars(n)])], note?.rating || 0,
            (value) => this.runRowAction(p, () => this.plugin.setNoteField(p, "rating", value || null)));
        } else {
          td.setText(TABLE_COLUMNS[key].text(state, p, now));
        }
      }
      tr.createEl("td");
    }
  }

  /** "Show 50 more" under a list that has more rows than shown. */
  renderMore(list) {
    if (this.rows.length <= this.visible) return;
    const more = list.createEl("button", {
      cls: "pdt-more",
      text: t("list.more", { n: Math.min(PAGE_SIZE, this.rows.length - this.visible), total: formatCount(this.rows.length), shown: this.visible }),
    });
    more.onclick = () => { this.visible += PAGE_SIZE; this.refresh(); };
  }

  /** Ignored / Hidden suggestions: title, back, and "restore all shown" (asks for a second click). */
  renderListBanner(list, mode) {
    const banner = list.createDiv({ cls: "pdt-banner" });
    const total = mode === "ignored" ? this.plugin.ignoredCount() : Object.keys(this.plugin.data.dismissed).length;
    banner.createSpan({ cls: "pdt-banner-title", text: t(mode === "ignored" ? "list.ignoredTitle" : "list.dismissedTitle", { n: formatCount(total) }) });
    const back = banner.createEl("button", { text: t("list.back"), attr: { type: "button" } });
    back.onclick = () => this.update("mode", "all");
    if (!this.rows.length) return;
    const all = banner.createEl("button", { cls: "mod-warning", text: t("list.restoreAll", { n: this.rows.length }), attr: { type: "button" } });
    let armed = false;
    all.onclick = async () => {
      if (!armed) {
        armed = true;
        all.setText(t("list.restoreConfirm", { n: this.rows.length }));
        setTimeout(() => { armed = false; all.setText(t("list.restoreAll", { n: this.rows.length })); }, 4000);
        return;
      }
      await this.plugin.restoreFrom(mode, this.rows.map((p) => p.id));
    };
  }

  /** One Tracked-tab section: a coloured, foldable group heading and its rows, indented on a rail. */
  renderSection(list, { name, rows }, now) {
    const label = name === UNGROUPED ? t("tracked.ungrouped") : name;
    const open = !this.collapsed.has(name);
    const section = list.createDiv({ cls: `pdt-section${name === UNGROUPED ? "" : ` pdt-hue-${groupHue(name)}`}` });
    const head = section.createEl("button", { cls: "pdt-section-head", attr: { type: "button", "aria-expanded": String(open) } });
    setIcon(head.createSpan({ cls: `pdt-section-caret${open ? "" : " is-closed"}` }), "chevron-down");
    head.createSpan({ cls: "pdt-swatch" });
    head.createSpan({ cls: "pdt-section-name", text: label });
    head.createSpan({ cls: "pdt-section-count", text: formatCount(rows.length) });
    head.createSpan({ cls: "pdt-section-rule" });
    head.onclick = () => {
      if (open) this.collapsed.add(name); else this.collapsed.delete(name);
      this.refresh();
    };
    if (!open) return;
    const body = section.createDiv({ cls: "pdt-section-body" });
    for (const p of rows) this.renderRow(body, p, now);
  }

  /**
   * Turns the Similar filter on for `p`, or steps to `p` inside it (back to it, if it is an earlier step).
   * The All tab stays (or becomes) active; ✕ brings back the tab, filters and scroll of before.
   */
  openSimilar(p) {
    const scroll = this.contentEl.scrollTop;
    if (!this.similar) {
      this.similar = {
        steps: [],
        before: { mode: this.settings.mode, scroll, visible: this.visible, originId: p.id, originIndex: (this.rows || []).findIndex((r) => r.id === p.id) },
        query: "",
      };
    } else this.similar.steps.at(-1).scroll = scroll;
    const steps = this.similar.steps;
    const at = steps.findIndex((step) => step.id === p.id);
    if (at !== -1) steps.splice(at + 1);
    else steps.push({ id: p.id, scroll: 0 });
    if (steps.length > SIMILAR_STEPS) steps.splice(0, steps.length - SIMILAR_STEPS);
    this.similar.query = "";
    Object.assign(this, { filtersOpen: false, visible: PAGE_SIZE });
    this.settings.mode = "all";   // shown, not saved: ✕ goes back to the tab you came from
    this.render();
    this.contentEl.scrollTop = steps.at(-1).scroll;
  }

  /** ‹: the previous plugin's matches, with the scroll position they had. */
  similarBack() {
    const steps = this.similar?.steps;
    if (!steps || steps.length < 2) return;
    steps.pop();
    this.similar.query = "";
    this.render();
    this.contentEl.scrollTop = steps.at(-1).scroll;
  }

  /** ✕ / Esc: the tab, filters and scroll of before, and the row you started from, highlighted for a moment. */
  closeSimilar() {
    if (!this.similar) return;
    const { before } = this.similar;
    this.similar = null;
    this.settings.mode = before.mode;
    this.visible = before.visible;
    this.render();
    this.contentEl.scrollTop = before.scroll;
    const rows = [...this.contentEl.querySelectorAll(".pdt-row")];
    // the row itself, or the one now in its place if an action took it out of the list
    const row = rows.find((r) => r.dataset.id === before.originId) || rows[Math.min(Math.max(before.originIndex, 0), rows.length - 1)];
    if (!row) return;
    this.setCursor(row);
    row.addClass("is-flash");
    setTimeout(() => row.removeClass("is-flash"), 1500);
    row.focus?.({ preventScroll: true });
  }

  /** The Similar filter's rows, each with why it matches, in pages like any list. */
  renderSimilarList(list, now) {
    const seed = this.plugin.pluginById(this.similar.steps.at(-1).id);
    const found = seed ? this.plugin.similarTo(seed) : [];
    this.stale = new Set();
    this.similarInfo = new Map(found.map((x) => [x.p.id, x]));
    this.rows = this.similarRows();
    if (!this.rows.length) {
      const empty = list.createDiv({ cls: "pdt-empty", text: t(found.length ? "list.empty" : "similar.none") });
      if (changedFilters(this.filterState(), "all") > 0) this.renderClearFilters(empty.createDiv());
      return;
    }
    for (const p of this.rows.slice(0, this.visible)) this.renderRow(list, p, now);
    this.renderMore(list);
  }

  /** The shared terms of a match, as small tags. */
  renderTerms(parent, terms) {
    if (!terms.length) return;
    const box = parent.createSpan({ cls: "pdt-terms", attr: { "aria-label": t("similar.why") } });
    for (const term of terms) box.createSpan({ cls: "pdt-term", text: term });
  }

  /** A Similar-list row's reason: how close it is within the list (bar and word) and what it shares. */
  renderWhy(parent, { match, shared, cosine }) {
    const pct = Math.round(match * 100);
    const label = t(closeness(match));
    const why = parent.createDiv({ cls: "pdt-why" });
    const meter = why.createSpan({ cls: "pdt-why-meter", attr: { role: "meter", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct), "aria-label": label } });
    meter.createSpan({ cls: "pdt-why-fill" }).setCssProps({ "--pdt-match": `${Math.max(pct, 6)}%` });
    setTooltip(meter, cosine != null ? t("similar.cosineTip", { cosine: decimal(cosine, 2) }) : t("similar.match", { pct }));
    why.createSpan({ cls: "pdt-why-label", text: label });
    if (shared.length) why.createSpan({ cls: "pdt-why-common", text: t("similar.why") });
    this.renderTerms(why, shared);
  }

  /**
   * One plugin, as a list row or a card (the same markup; CSS places the parts):
   * head (name, version) · metrics (updated, downloads) · tags (system signals, your note) ·
   * body (description, translation, why it's similar) · links · actions · more (AI groups while picked).
   * Clicking the row (anywhere but a control) opens the details window.
   */
  renderRow(list, p, now) {
    const plugin = this.plugin;
    const { firstSeen, releases } = plugin.timeline;
    const note = plugin.notes.index.get(p.id);
    const mode = this.settings.mode;
    const stale = this.stale?.has(p.id);
    const picked = this.selected.has(p.id);
    const row = list.createDiv({ cls: `pdt-row${p.id === this.cursorId ? " is-cursor" : ""}${stale ? " is-stale" : ""}${picked ? " is-selected" : ""}`, attr: { tabindex: "0", "data-id": p.id } });
    if (this.selectable) {
      // the box's whole gutter takes the click (a label around it), so a near miss picks instead of opening the details
      const hit = row.createEl("label", { cls: "pdt-select-hit" });
      const box = hit.createEl("input", { type: "checkbox", cls: "pdt-select", attr: { "aria-label": t("bulk.pick", { name: p.name }) } });
      row.addClass("has-select");
      box.checked = picked;
      hit.onclick = (event) => event.stopPropagation();
      box.onclick = (event) => { event.stopPropagation(); this.pick(p, box.checked, event.shiftKey); };
    }
    row.addEventListener("click", (event) => {
      this.setCursor(row);
      // a row or card opens its details from anywhere that isn't a control (or selected text)
      if (globalThis.getSelection?.()?.toString()) return;
      if (!event.target.closest("a, button, input, label, [role=button], .pdt-rate, .pdt-similar")) this.openDetails(p);
    });

    const head = row.createDiv({ cls: "pdt-head" });
    head.createEl("a", { cls: "pdt-name", text: p.name, href: `obsidian://show-plugin?id=${encodeURIComponent(p.id)}` });
    if (p.version) head.createSpan({ cls: "pdt-ver", text: p.version });
    if (p.author) head.createSpan({ cls: "pdt-author", text: p.author });

    // metrics: when it was updated, then downloads at the edge (a straight column down the list)
    const metrics = row.createDiv({ cls: "pdt-metrics" });
    const seen = firstSeen[p.id];
    // out of incubation: the pause before the latest release, when it was long (and always on the Incubation tab)
    const gap = plugin.timeline.to && p.updated ? dormantDays(releases, p) : null;
    const hatched = gap != null && (mode === "awakened" || gap >= this.settings.dormantDays);
    const when = metrics.createSpan({ cls: "pdt-when", text: p.updated ? relativeDays(p.updated, now) : seen > 0 ? t("row.added", { when: relativeDays(seen, now) }) : t("row.justListed") });
    if (hatched) {
      when.setText(t("row.hatched", { when: relativeDays(p.updated, now), n: gap }));
      setTooltip(when, t("row.hatchedTip", { n: gap }));
    }
    const downloads = metrics.createSpan({ cls: `pdt-downloads${p.downloads == null ? " is-empty" : ""}` });
    if (p.downloads == null) {
      downloads.setText(t("row.noStats"));
    } else {
      setIcon(downloads.createSpan({ cls: "pdt-dl-icon" }), "download");
      downloads.createSpan({ text: formatShort(p.downloads) });
      setTooltip(downloads, t("row.downloads", { n: formatCount(p.downloads) }));
    }
    // sorted by growth: what it gained in that window, before the total
    const sortKey = this.similar ? this.settings.similarSort.key : modeOptions(this.settings, mode).sort;
    const gained = plugin.timeline.growth?.[p.id]?.[GROWTH_INDEX[sortKey]];
    if (gained != null) {
      const growth = metrics.createSpan({ cls: "pdt-growth", text: `+${formatShort(gained)}` });
      setTooltip(growth, t(`row.${sortKey}`, { n: formatCount(gained) }));
      metrics.insertBefore(growth, downloads);
    }

    // tags: system signals, then your note (note link, groups, status, rating)
    const tags = row.createDiv({ cls: "pdt-tags" });
    const signal = (cls, text) => tags.createSpan({ cls: `pdt-signal ${cls}`, text });
    if (isNewPlugin(firstSeen, p, now, this.settings.newDays)) signal("is-new", t("badge.new"));
    if (isChanged(p, note)) signal("is-changed", t("badge.changed"));
    if (plugin.installed().has(p.id)) signal("is-installed", t("badge.installed"));
    if (isSnoozed(p, plugin.data.snoozed)) signal("is-snoozed", t("badge.snoozed"));
    if (stale) signal("is-stale", t("row.stale"));
    if (this.preset?.freshIds?.has(p.id)) signal("is-fresh", t("home.freshMark"));
    const milestone = recentMilestone(plugin.timeline.milestones?.[p.id], now, MILESTONE_DAYS, milestoneSteps(plugin.timeline));
    if (milestone) setTooltip(signal("is-milestone", t("badge.milestone", { n: stepLabel(milestone.n) })), t("badge.milestoneTip", { n: formatCount(milestone.n), when: relativeDays(milestone.at, now) }));
    if (note) {
      const link = tags.createSpan({ cls: "pdt-pill is-note", text: t("badge.note"), attr: { role: "button", tabindex: "0" } });
      setTooltip(link, t("badge.openNote"));
      const open = () => this.app.workspace.openLinkText(note.path, "", "tab");
      link.onclick = open;
      onActivate(link, open);
      for (const g of note.groups) {
        const badge = tags.createSpan({ cls: `pdt-pill is-group pdt-hue-${groupHue(g)}`, text: g, attr: { role: "button", tabindex: "0" } });
        setTooltip(badge, t("tracked.showGroup", { group: g }));
        const show = () => this.plugin.showGroup(g);
        badge.onclick = show;
        onActivate(badge, show);
      }
      this.renderNoteState(tags, p, note, mode === "tracked");
    }
    if (!tags.childElementCount) tags.remove();

    // body: description (two lines; a click opens the details), its translation, why it's similar
    const body = row.createDiv({ cls: "pdt-body" });
    const desc = body.createEl("p", { cls: "pdt-desc", text: p.description || "–", attr: { role: "button", tabindex: "0" } });
    setTooltip(desc, t("details.open"));
    desc.onclick = () => this.openDetails(p);
    onActivate(desc, () => this.openDetails(p));
    const translation = plugin.cachedTranslation(p);
    const showing = translation != null && this.shownTranslations.has(p.id);
    if (showing) body.createDiv({ cls: "pdt-trans", text: translation });
    const info = this.similar && this.similarInfo?.get(p.id);
    if (info) this.renderWhy(body, info);

    const links = row.createDiv({ cls: "pdt-meta" });
    const link = (cls, text, icon, onClick, href = "#") => {
      const a = links.createEl("a", { cls, text, href });
      if (icon) setIcon(a.createSpan({ cls: "pdt-gh-icon" }), icon);
      if (onClick) a.onclick = (event) => { event.preventDefault(); onClick(); };
      return a;
    };
    if (p.repo) {
      setTooltip(link("pdt-readme", t("row.readme"), "file-text", () => plugin.openReadme(p)), t(note ? "row.readmeOpen" : "row.readmeCreate"));
      link("pdt-gh", "GitHub", "external-link", null, `https://github.com/${p.repo}`);
    }
    // Similar → filters the list to this plugin's matches (one step further when the filter is already on)
    setTooltip(link("pdt-readme pdt-similar-link", t("row.similar"), "arrow-right", () => this.openSimilar(p)), t("row.similarTip"));
    if (p.description) {
      link("pdt-readme pdt-tr", showing ? t("translate.hide") : t("translate.row"), "languages", async () => {
        if (showing) this.shownTranslations.delete(p.id);
        else if (translation != null || (await plugin.translateRows([p]))) this.shownTranslations.add(p.id);
        this.refresh();
      });
    }

    if (this.suggest?.ids.has(p.id)) this.renderSuggestions(row.createDiv({ cls: "pdt-extra pdt-grouping-chips pdt-gm-chips" }), p);
    const actions = row.createDiv({ cls: "pdt-actions" });
    const act = (icon, tip, fn, cls = "", keep = false) => {
      const button = iconButton(actions, icon, tip, cls);
      button.onclick = async () => {
        if (button.hasClass("is-busy")) return;  // a quick double click must not run the action twice
        button.addClass("is-busy");
        if (keep) await this.runRowAction(p, fn);
        else { await fn(); this.refresh(); }
      };
      return button;
    };
    if (LIST_MODES.includes(mode)) {
      act("undo-2", t("action.restore"), () => plugin.restoreFrom(mode, [p.id]));
      return;
    }
    if (isChanged(p, note)) act("check", t("action.reviewed"), () => plugin.markReviewed([p]), "", true);
    this.renderStar(actions, act, p, note);
    act("folder-plus", note?.groups.length ? t("action.groupNamed", { group: note.groups.join(", ") }) : t("action.group"), () => plugin.chooseGroup(p), "", true);
    if (mode === "suggested") act("x", t("action.dismiss"), () => plugin.dismiss(p));
    else {
      act("eye-off", t("action.snooze"), () => plugin.snooze(p));
      act("ban", t("action.exclude"), () => plugin.exclude(p));
    }
  }

  /** Opens the details window of `p`; ←/→ in it walks the current list. */
  openDetails(p) {
    const rows = this.rows?.some((r) => r.id === p.id) ? this.rows : [p];
    const origin = [...this.contentEl.querySelectorAll(".pdt-row")].find((r) => r.dataset.id === p.id);
    new DetailModal(this, rows, rows.findIndex((r) => r.id === p.id), origin).open();
  }

  /** List / Card switch. */
  renderLayoutSwitch(bar) {
    const box = bar.createDiv({ cls: "pdt-layout", attr: { role: "group", "aria-label": t("layout.label") } });
    for (const [value, icon] of [["list", "list"], ["cards", "layout-grid"], ["table", "table"]]) {
      const button = box.createEl("button", { cls: "pdt-layout-option", attr: { type: "button", "aria-pressed": String(this.settings.layout === value) } });
      setIcon(button.createSpan(), icon);
      button.createSpan({ text: t(`layout.${value}`) });
      button.onclick = () => this.update("layout", value);
    }
  }

  /** Runs a row action and keeps the row where it was even if it no longer matches the filter. */
  async runRowAction(p, fn) {
    const index = (this.rows || []).findIndex((r) => r.id === p.id);
    await fn();
    if (index !== -1) this.keep.set(p.id, index);
    this.refresh();
  }

  /**
   * The star: a click toggles the favourite; hovering or focusing it opens 1–5 stars to rate.
   * `run` applies a rating (a row keeps its place; the details window passes its own).
   */
  renderStar(actions, act, p, note, run = (fn) => this.runRowAction(p, fn)) {
    const box = actions.createDiv({ cls: "pdt-rate" });
    const star = act("star", t(note?.favorite ? "action.unfavorite" : "action.favorite"), () => this.plugin.toggleFavorite(p), note?.favorite ? "is-favorite" : "", true);
    box.appendChild(star);
    const pop = box.createDiv({ cls: "pdt-rate-pop", attr: { role: "group", "aria-label": t("rating.set") } });
    const stars = pop.createDiv({ cls: "pdt-rate-stars" });   // laid out in reverse so hovering fills a star and those before it
    for (let n = 5; n >= 1; n--) {
      const button = stars.createEl("button", { cls: `pdt-rate-star${(note?.rating || 0) >= n ? " is-on" : ""}`, text: "★", attr: { type: "button", "aria-label": t("rating.label", { n }) } });
      button.onclick = () => run(() => this.plugin.setNoteField(p, "rating", n));
    }
    if (note?.rating) {
      const clear = pop.createEl("button", { cls: "pdt-rate-clear", text: t("rating.clear"), attr: { type: "button" } });
      clear.onclick = () => run(() => this.plugin.setNoteField(p, "rating", null));
    }
  }

  /** Status (when the field is on) and rating chips of a tracked plugin; empty ones only on the Tracked tab. */
  renderNoteState(parent, p, note, always) {
    const { statusEnabled, statuses } = this.settings;
    if (statusEnabled && (note.status || always)) {
      const known = statuses.find((st) => st.key === note.status);
      const options = [["", t("pstatus.clear")], ...statuses.map((st) => [st.key, st.label])];
      const chip = parent.createSpan({ cls: `pdt-pill is-status${note.status ? "" : " is-empty"}`, text: note.status ? known?.label || note.status : t("pstatus.set"), attr: { role: "button", tabindex: "0" } });
      const open = () => this.pickFromMenu(chip, options, note.status, (value) => this.runRowAction(p, () => this.plugin.setNoteField(p, "status", value || null)));
      chip.onclick = open;
      onActivate(chip, open);
    }
    if (note.rating || always) {
      const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);
      const options = [[0, t("rating.clear")], ...[5, 4, 3, 2, 1].map((n) => [n, stars(n)])];
      const chip = parent.createSpan({ cls: `pdt-pill is-rating${note.rating ? "" : " is-empty"}`, text: note.rating ? stars(note.rating) : t("rating.set"), attr: { role: "button", tabindex: "0", "aria-label": note.rating ? t("rating.label", { n: note.rating }) : t("rating.set") } });
      const open = () => this.pickFromMenu(chip, options, note.rating, (value) => this.runRowAction(p, () => this.plugin.setNoteField(p, "rating", value || null)));
      chip.onclick = open;
      onActivate(chip, open);
    }
  }

  pickFromMenu(anchor, options, current, onPick) {
    const menu = new Menu();
    for (const [value, title] of options) {
      menu.addItem((item) => item.setTitle(title).setChecked(value === current).onClick(async () => {
        await onPick(value);
        this.refresh();
      }));
    }
    const rect = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  }
}

