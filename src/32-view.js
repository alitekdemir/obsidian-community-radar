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
    this.preset = null;           // the widget list on screen: {key, id, params, freshIds, onlyNew, base} (one of widgetTabs)
    this.widgetTabs = [];         // every widget list you opened: each keeps its tab until you close it
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
    // Esc steps back one level: the Similar filter, then a widget's tab, then the list itself → Home
    this.scope.register([], "Escape", () => {
      if (this.settings.section === "home" || globalThis.document?.activeElement?.closest?.("input, textarea, select")) return true;
      if (this.similar) this.closeSimilar();
      else if (this.preset) this.closePreset();
      else this.update("section", "home");
      return false;
    });
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return t("view.title"); }
  getIcon() { return ICON; }

  async onOpen() {
    this.contentEl.addClass("pdt-view");
    this.addAction?.("help-circle", t("help.title"), () => this.openHelp());
    if (recordVisit(this.settings.home, Date.now())) this.plugin.saveData(this.plugin.data);   // opened today: a visit
    // the Filters panel closes on a click anywhere else
    this.registerDomEvent(globalThis.document, "pointerdown", (event) => {
      if (this.filtersOpen && !event.target.closest?.(".pdt-filter-menu, .menu")) { this.filtersOpen = false; this.render(); }
    });
    this.render();
    await this.plugin.ensureFresh();
  }

  async onClose() {
    this.columnsPop?.close();
  }

  /** Help on a tab: start (Quick start), presets (Ready-made queries) or guide (Query guide). */
  openHelp(tab = "start") {
    new HelpModal(this.app, this, { tab }).open();
  }

  /** Obsidian's ⋮ menu of the view: actions that don't need a place on screen. */
  onPaneMenu(menu, source) {
    super.onPaneMenu?.(menu, source);
    const plugin = this.plugin;
    const shown = (this.rows || []).slice(0, this.visible);
    const item = (icon, title, run) => menu.addItem((i) => i.setIcon(icon).setTitle(title).onClick(run));
    item("refresh-cw", t("set.syncNow"), () => plugin.refresh());
    item("languages", t("translate.visible", { n: shown.length }), () => this.translateVisible());
    item("ban", t("hidden.title", { n: this.hiddenTotal() }), () => this.openHidden());
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
    return this.preset?.key ?? this.settings.mode;
  }

  /** The settings the core reads for a widget tab: it brings its query as its page's. */
  tabSettings(tab) {
    return { ...this.settings, pageQueries: { ...this.settings.pageQueries, [tab.key]: tab.base } };
  }

  /** The settings the core reads for this page (a widget tab's, or the settings themselves). */
  get pageSettings() {
    return this.preset ? this.tabSettings(this.preset) : this.settings;
  }

  /** What the list's box holds: a draft that didn't parse, else the query (a widget's or view's, the page's) or your words (Basic). */
  get boxText() {
    return this.queryDraft ?? (this.inQuery ? this.settings.queries[this.page] : this.settings.query);
  }

  async update(key, value) {
    if (key === "mode" || key === "section") {   // another tab or section ends Filters, Similar, the toast and a draft (widget tabs stay)
      Object.assign(this, { filtersOpen: false, similar: null, preset: null, toast: null, queryDraft: null });
    }
    this.clearSelection();   // what you picked was on that list
    this.settings[key] = value;
    this.visible = PAGE_SIZE;
    await this.plugin.saveData(this.plugin.data);
    this.render();
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.toggleClass("is-keyboard", Boolean(this.settings.keyboard));   // the highlighted row shows only for shortcuts
    root.setAttribute("lang", language);   // uppercase headings by the UI's rules, not Obsidian's (i → I, not İ)
    this.keep.clear();
    this.refs = { counts: {} };
    const header = root.createDiv({ cls: "pdt-sticky" });   // switch, tabs and filters stay put while the list scrolls
    header.style.top = `-${root.ownerDocument.defaultView.getComputedStyle(root).paddingTop || "0px"}`;   // Chromium stops sticky below the padding (whoever sets it); rows would peek above
    const nav = header.createDiv({ cls: "pdt-nav" });
    this.renderNav(nav);
    if (this.settings.section === "home") {
      this.fillCounts(this.plugin.state(), Date.now());
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
    this.fillCounts(state, now);
    this.renderSort();   // in Query mode the query's order by decides, and it may just have changed
    this.updateFilterHead();
    this.renderStatus(this.refs.status);
    this.renderList(this.refs.list, state, now);
    this.refs.list.toggleClass("is-selecting", this.selected.size > 0);
    this.renderBulk();
  }

  /** The tabs' counts in the strip. */
  fillCounts(state, now) {
    if (!this.plugin.catalog) return;
    const counts = modeCounts(state, this.settings, now);
    if (this.similar) counts.all = this.similarCount();   // the All tab counts the matches while the filter is on
    for (const [mode, el] of Object.entries(this.refs.counts)) el.setText(formatCount(counts[mode]));
    for (const tab of this.widgetTabs) {   // a widget tab counts its list (your edits to its query included)
      this.refs.tabCounts?.[tab.key]?.setText(formatCount(discover(state, modeOptions(this.tabSettings(tab), tab.key), now).length));
    }
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
      smallButton(toast, "x", t("bulk.close"), () => { this.toast = null; this.renderBulk(); });
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
      button.onclick = () => onClick(button);   // the button: a menu opens under it
    };
    action("star", t("bulk.favorite"), () => this.runBulk("favorite"));
    action("star-half", t("bulk.rate"), (button) => showMenuBelow(button, [1, 2, 3, 4, 5].map((n) => [n, ratingStars(n)]), null, (n) => this.runBulk("rating", n)));
    action("folder-plus", t("bulk.group"), (button) => showMenuBelow(button, [...this.plugin.notes.groups().map((g) => [g.name, g.name]), [null, t("bulk.newGroup")]], undefined,
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
    return key === "relevance" ? (dir === "asc" ? matching.reverse() : matching) : sortRows(matching, key, dir, this.plugin.state());
  }

  /**
   * "⌂ Home | All": one two-part button, the place you're in filled. After it, a widget's list or a page a widget
   * opened (Tracked, Hidden) while it's open (✕ back home). Everything else lives on Home. Recent actions at the end.
   */
  renderNav(nav) {
    const settings = this.settings;
    const onHome = settings.section === "home";
    const active = onHome ? "home" : this.page;
    const place = nav.createDiv({ cls: "pdt-place", attr: { role: "tablist" } });
    const strip = nav.createDiv({ cls: "pdt-seg pdt-strip", attr: { role: "tablist" } });
    const tab = (parent, key, label, go, cls = "") => {
      const el = parent.createDiv({ cls: `pdt-tab ${cls}${key === active ? " is-active" : ""}`, attr: { role: "tab", tabindex: "0", "aria-selected": String(key === active) } });
      el.dataset.key = key;
      el.createSpan({ cls: "pdt-tab-label", text: label });
      el.onclick = go;
      onActivate(el, go);
      return el;
    };
    const home = tab(place, "home", t("nav.home"), () => this.update("section", "home"), "is-home");
    setIcon(home.createSpan({ cls: "pdt-tab-icon" }), "home");
    home.prepend(home.lastChild);
    const all = tab(place, "all", this.similar ? t("similar.tab") : t("mode.all"), () => { settings.section = "list"; return this.update("mode", "all"); });
    if (settings.queries?.all != null && !this.preset && !sameQuery(settings.queries.all, pageQuery(settings, "all"))) {
      all.createSpan({ cls: "pdt-tab-dot", attr: { "aria-label": t("query.changed") } });   // its query isn't saved
    }
    this.refs.counts.all = all.createSpan({ cls: "pdt-n", text: "…" });
    // the widget lists you opened: shown, not saved; each stays (with its count) until its ✕
    this.refs.tabCounts = {};
    for (const temp of this.widgetTabs) {
      const words = Object.entries(temp.params).map(([k, v]) => this.home.paramText(k, v)).join(" · ");
      const el = tab(strip, temp.key, words ? `${this.home.title(temp.id)} · ${words}` : this.home.title(temp.id), () => this.showTab(temp), "is-temp");
      setIcon(el.createSpan({ cls: "pdt-tab-icon" }), homeWidget(settings.home, temp.id)?.icon || "list");
      el.prepend(el.lastChild);
      this.refs.tabCounts[temp.key] = el.createSpan({ cls: "pdt-n", text: "…" });
      smallButton(el, "x", t("home.closeTab"), () => this.closeTab(temp));
    }
    // a page a widget opened (Tracked, Hidden): its tab while you're on it, ✕ back home
    if (!onHome && !this.preset && settings.mode !== "all") {
      const hidden = LIST_MODES.includes(settings.mode);
      const el = tab(strip, settings.mode, hidden ? t("hidden.tab") : t(`mode.${settings.mode}`), () => {}, "is-temp is-page");
      setIcon(el.createSpan({ cls: "pdt-tab-icon" }), hidden ? "eye-off" : HOME_WIDGETS.mine.icon);
      el.prepend(el.lastChild);
      this.refs.counts[settings.mode] = el.createSpan({ cls: "pdt-n", text: hidden ? formatCount(this.hiddenTotal()) : "…" });
      smallButton(el, "x", t("home.back"), () => {
        Object.assign(settings, { section: "home", mode: "all" });
        this.render();
      });
    }
    strip.toggleClass("is-empty", !strip.children.length);   // nothing open: it only keeps Sync and ⋮ on the right
    strip.querySelector(".is-active")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });   // a narrow panel scrolls to it
    if (!onHome && this.plugin.data.ops?.length) {
      iconButton(nav, "history", t("bulk.recent"), "pdt-nav-recent").onclick = () => this.openRecent();
    }
  }

  /** A page a widget opens: Tracked (with its groups) or Hidden. */
  openPage(page) {
    this.preset = null;   // the widget tabs stay
    return page === "hidden" ? this.openHidden() : this.openTracked();
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
    // a tab per widget and settings ("New" and "New · since your last visit" are two); opened again, it starts afresh
    const key = `${id.startsWith(VIEW_PREFIX) ? id : `widget:${id}`}${Object.keys(params).length ? `?${JSON.stringify(params)}` : ""}`;
    const tab = { key, id, params, freshIds, onlyNew, base: query };
    const at = this.widgetTabs.findIndex((x) => x.key === key);
    if (at < 0) this.widgetTabs.push(tab);
    else this.widgetTabs[at] = tab;
    this.preset = tab;
    // a page of its own, opened in Query mode on its query (Basic narrows it with filters, like a tab)
    this.settings.queries = { ...this.settings.queries, [key]: query };
    Object.assign(this.settings, { section: "list", mode: "all" });   // shown, not saved
    this.render();
    this.contentEl.scrollTop = 0;
  }

  /** The All list in Query mode on `text`: a gallery preset to try, edit or save as a view ("" : an empty box and its presets). */
  openQuery(text) {
    this.preset = null;   // the widget tabs stay
    Object.assign(this, { similar: null, filtersOpen: false, visible: PAGE_SIZE, queryDraft: null });
    this.settings.queries = { ...this.settings.queries, all: text };
    Object.assign(this.settings, { section: "list", mode: "all" });
    this.render();
    this.contentEl.scrollTop = 0;
  }

  /** Back to a widget tab: as you left it (its query, its new ones marked). */
  showTab(tab) {
    Object.assign(this, { preset: tab, similar: null, filtersOpen: false, visible: PAGE_SIZE, queryDraft: null });
    Object.assign(this.settings, { section: "list", mode: "all" });
    this.render();
  }

  /** Closes a widget tab (its box goes with it); the one on screen gives way to its neighbour, the last one to Home. */
  closeTab(tab) {
    const at = this.widgetTabs.indexOf(tab);
    this.widgetTabs.splice(at, 1);
    const { [tab.key]: gone, ...queries } = this.settings.queries || {};
    this.settings.queries = queries;
    if (tab !== this.preset) return this.render();
    const next = this.widgetTabs[Math.min(at, this.widgetTabs.length - 1)];
    if (next) return this.showTab(next);
    Object.assign(this, { preset: null, queryDraft: null });
    this.settings.section = "home";
    return this.render();
  }

  /** Esc, or a list done with: closes the widget tab on screen. */
  closePreset() {
    if (this.preset) this.closeTab(this.preset);
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
    fresh.createSpan({ text: `${t("home.onlyNew", { when: this.home.sinceLabel("seen") })} (${formatCount(this.preset.freshIds.size)})` });   // a saved view's
    smallButton(fresh, "x", t("home.showAll"), () => { this.preset.onlyNew = false; this.render(); });
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

  /** The sort the list follows: the query's order by (Query mode, or Basic when you chose no sort), else yours. */
  get listSort() {
    const opts = modeOptions(this.pageSettings, this.page);
    const order = this.inQuery || opts.sorted === false
      ? compileQuery(this.inQuery ? this.settings.queries[this.page] : pageQuery(this.pageSettings, this.page), null, Date.now(), true).order : null;
    return order || { key: opts.sort, dir: opts.sortDir };
  }

  /** A sort from the Sort menu or a table header: in Query mode it rewrites the query's order by (the save bar shows it). */
  async setSort(value) {
    if (!this.inQuery) return this.updateTab("sortBy", value);
    this.settings.queries = { ...this.settings.queries, [this.page]: withOrder(this.settings.queries[this.page], value.key, value.dir) };
    this.queryDraft = null;
    this.visible = PAGE_SIZE;
    this.render();
    await this.plugin.saveData(this.plugin.data);
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

    this.refs.sort = bar.createDiv({ cls: "pdt-sort" });
    const similar = this.similar;
    if (similar) {
      this.refs.search = this.renderSearch(bar, similar.query, t("similar.search", { n: this.similarRows(false).length }), (value) => {
        similar.query = value;
        this.visible = PAGE_SIZE;
        this.refresh();
      });
    } else {
      const own = flatQuery(pageQuery(this.pageSettings, mode));
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
      const more = iconButton(bar, "more-horizontal", t("list.moreActions"), "pdt-list-more");
      more.onclick = (event) => {
        const menu = new Menu();
        menu.addItem((item) => item.setTitle(t("query.saveWidget")).setIcon("bookmark-plus").onClick(() => this.saveView()));
        if (!this.preset && this.settings.pageQueries?.[mode] != null) {   // only once you saved your own over the tab's
          menu.addItem((item) => item.setTitle(t("query.resetPage")).setIcon("rotate-ccw").onClick(() => this.resetPageQuery(mode)));
        }
        menu.showAtMouseEvent(event);
      };
    }
    if (this.settings.keyboard) this.renderKeyHelp(bar);
    // quick filters (Jira style): the changed and added ones as chips on a row of their own, under the bar
    if (this.quickFilters && !this.inQuery) this.renderFilterChips(bar.parentElement.createDiv({ cls: "pdt-quick" }), mode, opts, false);
    bar.toggleClass("is-query", this.inQuery);   // Filter and Sort step back: the query decides
    this.updateFilterHead();
  }

  /** Sort menu and direction (the Similar filter sorts by closeness first, with its own sort). */
  renderSort() {
    const sort = this.refs.sort;
    if (!sort) return;
    sort.empty();
    const similar = this.similar;
    const { key, dir } = similar ? this.settings.similarSort : this.listSort;
    const setSort = (value) => (similar ? this.update("similarSort", value) : this.setSort(value));
    menuChip(sort, t("filter.sort"), (similar ? SIMILAR_SORT_KEYS : SORT_KEYS).map((k) => [k, sortLabel(k)]), key,
      (k) => setSort({ key: k, dir: naturalDir(k) }));
    const ascending = dir === "asc";
    const tip = t(`sort.${key === "name" ? (ascending ? "az" : "za") : ascending ? "asc" : "desc"}`);
    iconButton(sort, ascending ? "arrow-up-narrow-wide" : "arrow-down-wide-narrow", tip, "pdt-sort-dir").onclick =
      () => setSort({ key, dir: ascending ? "desc" : "asc" });
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
      smallButton(chip, "rotate-ccw", t("filter.resetOne"), () => this.resetFilter(key), "pdt-chip-act");
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
    smallButton(chip, "x", t("filter.remove"), () => this.setExtra(key, undefined), "pdt-chip-act");
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

  /** Saves what the list shows as a view (its query): asks its name and where it goes on Home, then opens it. */
  async saveView() {
    const mode = this.page;
    const query = this.inQuery ? this.boxText : joinQuery(pageQuery(this.pageSettings, mode), filtersToQuery(this.settings, mode));
    const suggested = this.preset ? this.home.title(this.preset.id) : t(`mode.${mode}`);
    const widget = viewWidget({ id: "preview", name: suggested, query }, null);   // how it will look, before it's saved
    const at = await this.home.ask({ id: VIEW_PREFIX + widget.view.id, widget, name: suggested, askName: true });
    if (!at) return;
    const name = at.name;
    const view = await this.home.saveView(name, query, queryRows(this.home.context(Date.now()), query), at.group);
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
    // the slot keeps the bar one row high; out of focus the box shows one line, in focus it opens down over the list
    const search = bar.createDiv({ cls: "pdt-search-slot" }).createDiv({ cls: `pdt-search${queryMode ? " is-query" : ""}` });
    setIcon(search.createSpan({ cls: "pdt-search-icon" }), "search");
    const box = search.createDiv({ cls: "pdt-q" });
    const paint = box.createDiv({ cls: "pdt-q-paint", attr: { "aria-hidden": "true" } });
    const input = box.createEl("textarea", { cls: "pdt-q-input", attr: { rows: "1", placeholder, spellcheck: "false", autocomplete: "off", autocapitalize: "off" } });
    input.value = value || "";
    const more = search.createSpan({ cls: "pdt-q-more" });   // "+1 line" while the box is folded
    const badge = search.createSpan({ cls: "pdt-regex", text: ".*" });
    setTooltip(badge, t("search.regex"));
    const help = iconButton(search, "help-circle", t("query.help.title"), "pdt-qhelp-button");
    help.onclick = () => new HelpModal(this.app, this, { tab: "guide", onPick: (text) => {   // a click puts it at the caret
      const at = input.selectionStart ?? input.value.length;
      const before = input.value.slice(0, at);
      const glue = before && !/\s$/.test(before) ? " " : "";
      input.value = `${before}${glue}${text} ${input.value.slice(input.selectionEnd ?? at)}`;
      const caret = before.length + glue.length + text.length + 1;
      input.focus();
      input.setSelectionRange(caret, caret);
      input.dispatchEvent(new Event("input"));
    } }).open();
    const seg = modes === true && this.renderQueryModes(search, queryMode);
    if (modes === true) {
      this.refs.changes = search.createEl("button", { cls: "pdt-q-changes is-hidden", attr: { type: "button" } });   // filled by renderChanges
      search.insertBefore(this.refs.changes, help);
    }
    let tokens = [];
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
      tokens = advanced ? queryHighlight(text) : [];
      tokens.forEach((tok, k) => {
        piece(at, tok.at, "");
        piece(tok.at, tok.end, tok.cls);
        if (tok.cls) paint.lastChild.dataset.k = String(k);
        at = tok.end;
      });
      piece(at, text.length, "");
      paint.append("\u200b");   // keeps a trailing new line's height
      const lines = text.split("\n").length - 1;
      more.setText(lines ? t("search.more", { n: lines }) : "");
      if (seg) seg.refresh(text);
    };
    if (QuerySuggest) new QuerySuggest(this.app, input, () => this.queryData(modes === true));
    mark();
    this.queryTips(box, input, paint, () => tokens);
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
   * A tooltip for the word under the mouse (field, operator, value, function, keyword), after a short rest; none
   * while typing. The textarea covers the painted words, so it steps aside for a moment to find the one below.
   */
  queryTips(box, input, paint, tokens) {
    const doc = box.ownerDocument;
    if (!doc.elementFromPoint) return;
    let timer;
    let shown = null;
    const hide = () => { clearTimeout(timer); shown?.remove(); shown = null; };
    input.addEventListener("mousemove", (event) => {
      hide();
      timer = setTimeout(() => {
        input.style.pointerEvents = "none";
        paint.style.pointerEvents = "auto";
        const el = doc.elementFromPoint(event.clientX, event.clientY);
        input.style.pointerEvents = paint.style.pointerEvents = "";
        const k = el?.dataset?.k;
        if (k == null) return;
        const list = tokens();
        const tip = queryTip(list[k], list[k - 1], Date.now(), this.plugin.state());
        if (!tip) return;
        shown = doc.body.createDiv({ cls: "pdt-qtip" });
        const head = shown.createDiv({ cls: "pdt-qtip-head" });
        head.createEl("code", { text: tip.head });
        if (tip.kind) head.createSpan({ cls: "pdt-qtip-kind", text: tip.kind });
        shown.createDiv({ text: tip.body });
        if (tip.example) shown.createDiv({ cls: "pdt-qtip-example", text: tip.example });
        const r = el.getBoundingClientRect();
        Object.assign(shown.style, { left: `${Math.round(r.left)}px`, top: `${Math.round(r.bottom + 6)}px` });
      }, 300);
    });
    for (const type of ["mouseleave", "keydown", "input", "blur"]) input.addEventListener(type, hide);
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

  /** A tab's query back to the default (its box too): the tab and its Home card show the default list again. */
  async resetPageQuery(mode) {
    const { [mode]: mine, ...pageQueries } = this.settings.pageQueries || {};
    const { [mode]: draft, ...queries } = this.settings.queries || {};
    Object.assign(this.settings, { pageQueries, queries });
    await this.plugin.saveData(this.plugin.data);
    new Notice(t("query.pageReset", { name: t(`mode.${mode}`) }));
    this.render();
  }

  /** A tab in Query mode, its query in the box to change (✓ Save makes it the tab's, and its Home card's). */
  editPageQuery(mode) {
    this.settings.queries = { ...this.settings.queries, [mode]: this.settings.queries?.[mode] ?? pageQuery(this.settings, mode) };
    this.settings.section = "list";
    return this.update("mode", mode);
  }

  /** Query mode, the box no longer the page's query: make it the page's (⋯ › Reset to default undoes it). */
  async savePageQuery() {
    const mode = this.page;
    const text = this.settings.queries[mode];
    const { [mode]: old, ...rest } = this.settings.pageQueries || {};
    const same = (a, b) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
    this.settings.pageQueries = same(text, defaultPageQuery(mode, { newDays: this.settings.newDays })) ? rest : { ...rest, [mode]: text };
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
      smallButton(chip, "chevron-left", t("similar.backTo", { name: this.plugin.pluginById(steps.at(-2).id)?.name ?? "–" }), () => this.similarBack());
    }
    chip.createSpan({ cls: "pdt-similar-sign", text: "≈" });
    chip.createSpan({ text: t("similar.chip") });
    const name = chip.createEl("a", { cls: "pdt-chip-value", text: seed?.name ?? "–", href: "#" });
    setTooltip(name, t("details.open"));
    name.onclick = (event) => { event.preventDefault(); if (seed) this.openDetails(seed); };
    smallButton(chip, "x", t("similar.closeFilter"), () => this.closeSimilar());
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
    this.renderChanges();
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
      return [clause, count(without ? dropClause(query, x) : clause)];
    });
    return without ? rows.sort((a, b) => b[1] - a[1]) : rows;
  }

  /**
   * While the query isn't the page's own: a "● 2 changes" badge in the box (what changed in its tooltip) and a dot on
   * the tab; the badge opens Discard · New view… · the one save that fits (this tab's query, this view; a widget's
   * list becomes a view). A broken query shows "● Error" and can only be discarded.
   */
  renderChanges() {
    const badge = this.refs.changes;
    if (!badge) return;
    const preset = this.preset;
    const view = preset?.id.startsWith(VIEW_PREFIX);
    const base = pageQuery(this.pageSettings, this.page);
    const text = this.boxText;
    const changed = this.inQuery && !sameQuery(text, base);
    const broken = this.queryDraft != null;
    const diff = changed && !broken ? queryDiff(base, text) : "";
    const tab = [...this.contentEl.querySelectorAll(".pdt-tab")].find((el) => el.dataset.key === this.page);   // keys hold quotes: no selector
    const dot = tab?.querySelector(".pdt-tab-dot");
    if (changed && tab && !dot) tab.createSpan({ cls: "pdt-tab-dot", attr: { "aria-label": t("query.changed") } });   // the tab shows it's unsaved
    if (!changed) dot?.remove();
    badge.toggleClass("is-hidden", !changed);
    badge.toggleClass("is-error", broken);
    if (!changed) return;
    badge.setText(`● ${broken ? t("query.error") : t("query.changes", { n: diff ? diff.split(" · ").length : 1 })}`);
    setTooltip(badge, broken ? t("query.cantSave") : diff || t("query.changed"));
    badge.onclick = () => {
      if (this.changesPop?.isOpen) return this.changesPop.close();
      this.changesPop = new Popover(badge, { cls: "pdt-changes-pop", label: t("query.changed"), keep: ".pdt-q-changes", fill: (box, pop) => {
        box.createDiv({ cls: "pdt-changes-what", text: broken ? t("query.cantSave") : diff || t("query.changed") });
        const row = box.createDiv({ cls: "pdt-changes-actions" });
        const button = (label, cls, run) => {
          const el = row.createEl("button", { cls, text: label, attr: { type: "button" } });
          el.onclick = async () => { pop.close(); await run(); };
          return el;
        };
        button(t("query.discard"), "pdt-changes-discard", () => this.revertQuery());
        if (broken) return;
        const widget = Boolean(preset && !view);
        if (widget) return button(t("query.saveWidget"), "mod-cta", () => this.saveView());
        button(t("query.newView"), "", () => this.saveView());
        if (view) {
          button(t("query.updateView", { name: this.home.title(preset.id) }), "mod-cta", async () => {
            await this.home.updateView(preset.id, text);
            preset.base = text;   // the view's query now: nothing changed any more
            this.render();
          });
        } else {
          button(t("query.replacePage", { name: t(`mode.${this.settings.mode}`) }), "mod-cta", () => this.savePageQuery());
          box.createDiv({ cls: "pdt-changes-hint", text: t("query.replaceHint") });
        }
      } }).open();
    };
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
    const page = this.page;
    const state = this.plugin.state();
    const columns = tableColumns(this.settings, page);
    const { key: sort, dir: sortDir } = this.listSort;
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
      button.onclick = () => this.setSort({ key: sortKey, dir: on ? (sortDir === "asc" ? "desc" : "asc") : naturalDir(sortKey) });
    };
    header("name", t("col.name"));
    for (const key of columns) header(key, t(`col.${key}`), TABLE_COLUMNS[key].align);
    const saveColumns = async (next) => {
      this.settings.tableColumns = { ...this.settings.tableColumns, [page]: next };
      if (!next) delete this.settings.tableColumns[page];
      await this.plugin.saveData(this.plugin.data);
      this.refresh();
    };
    const pick = head.createEl("th", { cls: "pdt-table-cols" });
    const button = iconButton(pick, "columns-3", t("table.columns"));
    button.onclick = () => {
      if (this.columnsPop?.isOpen) return this.columnsPop.close();
      const title = this.preset ? this.home.title(this.preset.id) : t(`mode.${page}`);
      const sample = (key) => (rows[0] ? this.cellText(key, rows[0], state, now) : "");
      this.columnsPop = new ColumnsPopover(button, { page: title, columns, sort, sample, onChange: saveColumns }).open();
    };
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
          const cell = td.createEl("button", { cls: "pdt-table-rating", text: this.cellText(key, p, state, now) });
          cell.onclick = () => this.pickFromMenu(cell, ratingOptions(), note?.rating || 0,
            (value) => this.runRowAction(p, () => this.plugin.setNoteField(p, "rating", value || null)));
        } else {
          td.setText(this.cellText(key, p, state, now));
        }
      }
      tr.createEl("td");
    }
  }

  /** A table cell's text (a status by its label). */
  cellText(key, p, state, now) {
    const text = TABLE_COLUMNS[key].text(state, p, now);
    return key === "status" && text ? this.settings.statuses?.find((st) => st.key === text)?.label || text : text;
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

  /** All hidden plugins, of every kind (the Hidden tab's count). */
  hiddenTotal() {
    return Object.values(this.plugin.hiddenCounts()).reduce((a, b) => a + b, 0);
  }

  /** The Hidden page, on the kind you were last on (else the first that holds anything). */
  openHidden() {
    const counts = this.plugin.hiddenCounts();
    const kind = LIST_MODES.includes(this.lastHidden) ? this.lastHidden : LIST_MODES.find((k) => counts[k]) || LIST_MODES[0];
    return this.showHidden(kind);
  }

  /** One kind of the Hidden page, in Query mode: the box says what the list is (excluded, snoozed or dismissed). */
  showHidden(kind) {
    this.settings.queries = { ...this.settings.queries, [kind]: this.settings.queries?.[kind] ?? pageQuery(this.settings, kind) };
    this.settings.section = "list";
    return this.update("mode", kind);
  }

  /** The Hidden page's head: its three kinds (each one a query: excluded, snoozed, dismissed), and "restore all shown" (asks twice). */
  renderListBanner(list, mode) {
    this.lastHidden = mode;
    const banner = list.createDiv({ cls: "pdt-banner" });
    const kinds = banner.createDiv({ cls: "pdt-hidden-kinds", attr: { role: "radiogroup", "aria-label": t("hidden.kinds") } });
    const counts = this.plugin.hiddenCounts();
    for (const kind of LIST_MODES) {
      const on = kind === mode;
      const chip = kinds.createEl("button", { cls: `pdt-chip pdt-hidden-kind${on ? " is-on" : ""}`, attr: { type: "button", role: "radio", "aria-checked": String(on) } });
      chip.createSpan({ text: t(`mode.${kind}`) });
      chip.createSpan({ cls: "pdt-n", text: formatCount(counts[kind]) });
      chip.onclick = () => this.showHidden(kind);
    }
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
    // just out of incubation (within HATCHED_DAYS of it): the pause it came out of, when long (always on the Incubation tab)
    const hatch = plugin.timeline.to && p.updated ? lastHatch(releases, p) : null;
    const pause = hatch && now - hatch.at <= HATCHED_DAYS * DAY_MS ? hatch.days : null;
    const hatched = pause != null && (mode === "awakened" || pause >= INCUBATION_DAYS);
    const when = metrics.createSpan({ cls: "pdt-when", text: p.updated ? relativeDays(p.updated, now) : seen > 0 ? t("row.added", { when: relativeDays(seen, now) }) : t("row.justListed") });
    if (hatched) {
      when.setText(t("row.hatched", { when: relativeDays(p.updated, now), n: pause }));
      setTooltip(when, t("row.hatchedTip", { n: pause }));
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
    const ref = fieldRef(sortKey);
    const gained = ref?.name === "gain" ? gainOver(plugin.timeline, p.id, ref.arg) : null;
    if (gained != null) {
      const growth = metrics.createSpan({ cls: "pdt-growth", text: `+${formatShort(gained)}` });
      setTooltip(growth, t("row.gain", { n: formatCount(gained), days: ref.arg }));
      metrics.insertBefore(growth, downloads);
    }

    // tags: system signals, then your note (note link, groups, status, rating)
    const tags = row.createDiv({ cls: "pdt-tags" });
    const signal = (cls, text) => tags.createSpan({ cls: `pdt-signal ${cls}`, text });
    if (isNewPlugin(firstSeen, p, now, this.settings.newDays)) signal("is-new", t("badge.new"));
    if (isUnreviewed(p, note)) signal("is-changed", t("badge.changed"));
    if (plugin.installed().has(p.id)) signal("is-installed", t("badge.installed"));
    if (isSnoozed(p, plugin.data.snoozed)) signal("is-snoozed", t("badge.snoozed"));
    if (LIST_MODES.includes(mode) && typeof plugin.data[mode][p.id] === "string") {   // when you hid it (snoozed keeps a release, no day)
      signal("is-why", t(`hidden.when.${mode}`, { day: this.home.dayLabel(dayStart(plugin.data[mode][p.id])) }));
    }
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
    if (isUnreviewed(p, note)) act("check", t("action.reviewed"), () => plugin.bulk("reviewed", [p]), "", true);   // in Recent actions, with Undo
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
      const button = box.createEl("button", { cls: "pdt-layout-option", attr: { type: "button", "aria-pressed": String(this.settings.layout === value), "aria-label": t(`layout.${value}`) } });
      setIcon(button.createSpan(), icon);   // icon only; the name in the tooltip
      setTooltip(button, t(`layout.${value}`));
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
      const options = ratingOptions();
      const chip = parent.createSpan({ cls: `pdt-pill is-rating${note.rating ? "" : " is-empty"}`, text: note.rating ? ratingStars(note.rating) : t("rating.set"), attr: { role: "button", tabindex: "0", "aria-label": note.rating ? t("rating.label", { n: note.rating }) : t("rating.set") } });
      const open = () => this.pickFromMenu(chip, options, note.rating, (value) => this.runRowAction(p, () => this.plugin.setNoteField(p, "rating", value || null)));
      chip.onclick = open;
      onActivate(chip, open);
    }
  }

  /** A menu under `anchor` (see showMenuBelow); the list is redrawn after the pick. */
  pickFromMenu(anchor, options, current, onPick) {
    showMenuBelow(anchor, options, current, async (value) => {
      await onPick(value);
      this.refresh();
    });
  }
}

