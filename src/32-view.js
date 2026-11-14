/**
 * A part of the view with one job (the search box, the filter bar, the rows, the bulk bar, the Similar filter, Home).
 * It holds no state of its own: everything lives on the view, read through `this.view`.
 */
class ViewPart {
  constructor(view) {
    this.view = view;
  }

  get plugin() { return this.view.plugin; }
  get settings() { return this.view.settings; }
  get app() { return this.view.app; }
}

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
    this.searchBox = new SearchBox(this);
    this.filterBar = new FilterBar(this);
    this.rowRenderer = new RowRenderer(this);
    this.bulkBar = new BulkBar(this);
    this.similarFilter = new SimilarFilter(this);
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
      if (this.similar) this.similarFilter.close();
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
    for (const n of [0, 1, 2, 3, 4, 5]) actions[n] = () => this.rowRenderer.runRowAction(p, () => this.plugin.setNoteField(p, "rating", n || null));
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
    this.bulkBar.clearSelection();   // what you picked was on that list
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
    this.filterBar.renderFilters(header.createDiv({ cls: "pdt-filters" }));
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
    this.filterBar.renderSort();   // in Query mode the query's order by decides, and it may just have changed
    this.filterBar.updateFilterHead();
    this.renderList(this.refs.list, state, now);   // first: the status line reads how many it found (this.matched)
    this.renderStatus(this.refs.status);
    this.refs.list.toggleClass("is-selecting", this.selected.size > 0);
    this.bulkBar.renderBulk();
  }

  /**
   * The counts of the tabs on screen: All, and the page a widget opened. The Hidden tab keeps the total it was drawn
   * with (every kind); while the Similar filter is on, All counts its matches.
   */
  fillCounts(state, now) {
    if (!this.plugin.catalog) return;
    const modes = Object.keys(this.refs.counts).filter((mode) => MODE_KEYS.includes(mode) && !(mode === "all" && this.similar));
    const counts = modeCounts(state, this.settings, now, modes);
    if (this.similar) counts.all = this.similarFilter.count();
    for (const [mode, el] of Object.entries(this.refs.counts)) if (mode in counts) el.setText(formatCount(counts[mode]));
    for (const tab of this.widgetTabs) {   // a widget tab counts its list (your edits to its query included)
      this.refs.tabCounts?.[tab.key]?.setText(formatCount(matchRows(state, modeOptions(this.tabSettings(tab), tab.key), now).rows.length));
    }
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
      iconButton(nav, "history", t("bulk.recent"), "pdt-nav-recent").onclick = () => this.bulkBar.openRecent();
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

  renderStatus(status) {
    const { catalog, timeline } = this.plugin;
    status.empty();
    const text = status.createDiv({ cls: "pdt-status-text" });
    const now = Date.now();
    if (!catalog) {
      text.setText(this.plugin.busy ? this.plugin.progress || t("status.syncing") : t("status.loading"));
    } else if (this.preset) {
      text.createDiv({ text: t("home.status", { n: formatCount(this.matched ?? this.presetRows().length), name: this.home.title(this.preset.id) }) });
    } else if (this.similar) {   // one line about the filter instead of the sync line
      const seed = this.plugin.pluginById(this.similar.steps.at(-1).id);
      const found = seed ? this.plugin.similarTo(seed) : [];
      text.createDiv({ text: t("similar.status", { n: formatCount(this.similarFilter.count()), how: t(found[0]?.cosine != null ? "similar.byMeaning" : "similar.byWords") }) });
    } else {
      text.createDiv({
        text: [
          t("status.plugins", { n: formatCount(catalog.plugins.length) }),
          t("status.lastSync", { time: formatTime(catalog.fetchedAt, now), age: formatAge(now - catalog.fetchedAt) }),
          timeline.to ? t(now - timeline.to > HISTORY_STALE_DAYS * DAY_MS ? "status.historyOld" : "status.history", { year: new Date(timeline.from).getFullYear(), date: dayString(timeline.to) }) : t("status.noHistory"),
          ...this.filterBar.activeFilters(),
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
        tag.addEventListener("mouseenter", () => setTooltip(tag, this.searchBox.clauseCounts(query).map(([c, n]) => `${c}  →  ${formatCount(n)}`).join("\n")), { once: true });
        const shown = this.matched ?? matchRows(this.plugin.state(), modeOptions(this.pageSettings, this.page), Date.now()).rows.length;
        if (shown === 0) {
          const best = this.searchBox.clauseCounts(query, true)[0];
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
    this.searchBox.renderChanges();
    const actions = status.createDiv({ cls: "pdt-status-actions" });
    if (!timeline.to && !this.plugin.busy) {
      actions.createEl("button", { cls: "mod-cta", text: t("status.build") }).onclick = () => this.plugin.downloadHistory();
    }
  }

  /** Redraws only the status line (progress updates during a sync). */
  refreshStatus() {
    if (this.refs.status) this.renderStatus(this.refs.status);
  }

  renderList(list, state, now) {
    list.empty();
    this.rows = [];
    this.matched = null;      // how many the page finds (rows an action moved out, kept in place, not counted)
    this.listState = state;   // the rows read it (installed, notes) instead of building it again per row
    this.cards = this.settings.layout === "cards" && !LIST_MODES.includes(this.settings.mode);
    list.toggleClass("is-cards", this.cards);
    if (!this.plugin.catalog) return;
    const { timeline } = this.plugin;
    const mode = this.settings.mode;
    if (this.similar) return this.similarFilter.renderList(list, now);
    if (this.preset) {
      this.rows = this.presetRows();
      this.matched = this.rows.length;
      this.stale = new Set();
      if (!this.rows.length) return void list.createDiv({ cls: "pdt-empty", text: t("list.empty") });
      this.rowRenderer.renderRows(list, this.rows.slice(0, this.visible), now);
      return this.rowRenderer.renderMore(list);
    }
    if (mode === "awakened" && !timeline.to) {
      list.createDiv({ cls: "pdt-empty", text: t("list.needHistory") });
      return;
    }
    if (mode === "new" && !timeline.to) list.createDiv({ cls: "pdt-hint", text: t("list.legacyHint") });

    this.rows = discover(state, modeOptions(this.settings, mode), now);
    this.matched = this.rows.length;
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
      if (changedFilters(this.filterBar.filterState(), mode) > 0) this.filterBar.renderClearFilters(empty.createDiv());
      return;
    }
    if (sections) {
      for (const section of groupSections(this.rows, state.notes)) this.rowRenderer.renderSection(list, section, now);
      return;
    }
    this.rowRenderer.renderRows(list, visible, now);
    this.rowRenderer.renderMore(list);
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
}

