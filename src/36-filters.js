// ─── FilterBar ─────────────────────────────────────────────────────
/**
 * The bar above the list: Filter ▾ and its panel, quick-filter chips, Sort, the Tracked tab's menus, layout and
 * key help. Works on the view's state (see ViewPart).
 */
class FilterBar extends ViewPart {
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
    menuChip(bar, t("tracked.group"), options, settings.trackedGroup, (value) => this.view.update("trackedGroup", value));
    if (!settings.trackedGroup) {
      switchChip(bar, { label: t("tracked.sections"), on: Boolean(settings.trackedSections), onToggle: (on) => this.view.update("trackedSections", on) });
    }
    if (settings.statusEnabled) {
      menuChip(bar, t("tracked.status"), [["", t("tracked.anyStatus")], ...settings.statuses.map((st) => [st.key, st.label])],
        settings.trackedStatus, (value) => this.view.update("trackedStatus", value));
    }
  }

  /** The sort the list follows: the query's order by (Query mode, or Basic when you chose no sort), else yours. */
  get listSort() {
    const opts = modeOptions(this.view.pageSettings, this.view.page);
    const order = this.view.inQuery || opts.sorted === false
      ? compileQuery(this.view.inQuery ? this.settings.queries[this.view.page] : pageQuery(this.view.pageSettings, this.view.page), null, Date.now(), true).order : null;
    return order || { key: opts.sort, dir: opts.sortDir };
  }

  /** A sort from the Sort menu or a table header: in Query mode it rewrites the query's order by (the save bar shows it). */
  async setSort(value) {
    if (!this.view.inQuery) return this.updateTab("sortBy", value);
    this.settings.queries = { ...this.settings.queries, [this.view.page]: withOrder(this.settings.queries[this.view.page], value.key, value.dir) };
    this.view.queryDraft = null;
    this.view.visible = PAGE_SIZE;
    this.view.render();
    await this.plugin.saveData(this.plugin.data);
  }

  /** Saves a per-tab setting (downloadFilter, sortBy) for the current tab. */
  updateTab(key, value) {
    return this.view.update(key, { ...this.settings[key], [this.view.page]: value });
  }

  renderFilters(bar) {
    const mode = this.view.page;
    const opts = modeOptions(this.view.pageSettings, mode);
    this.renderFilterButton(bar, mode, opts);   // always first, never moves
    if (this.view.preset?.onlyNew) this.view.renderOnlyNew(bar);   // a widget's "N new": only those (✕ shows all)
    if (this.view.similar) this.view.similarFilter.renderChip(bar);   // the same bar as All, plus the Similar chip
    if (mode === "tracked") this.renderTrackedBar(bar);

    this.view.refs.sort = bar.createDiv({ cls: "pdt-sort" });
    const similar = this.view.similar;
    if (similar) {
      this.view.refs.search = this.view.searchBox.renderSearch(bar, similar.query, t("similar.search", { n: this.view.similarFilter.rows(false).length }), (value) => {
        similar.query = value;
        this.view.visible = PAGE_SIZE;
        this.view.refresh();
      });
    } else {
      const own = flatQuery(pageQuery(this.view.pageSettings, mode));
      const placeholder = this.view.inQuery ? own : `${own} · ${t("search.narrow")}`;
      this.view.refs.search = this.view.searchBox.renderSearch(bar, this.view.boxText, placeholder, async (value) => {
        // an invalid query isn't applied (like Jira): the list keeps the last valid one, the box keeps what you typed
        this.view.queryDraft = compileQuery(value, null, Date.now(), this.view.inQuery).error ? value : null;
        this.view.renderStatus(this.view.refs.status);
        if (this.view.queryDraft != null) return;
        if (this.view.inQuery) {
          this.settings.queries = { ...this.settings.queries, [mode]: value };
          this.view.searchBox.rememberQuery(value);
        } else this.settings.query = value;
        this.view.visible = PAGE_SIZE;
        this.view.bulkBar.clearSelection();   // another search, another list
        this.view.refresh();
        await this.plugin.saveData(this.plugin.data);
      }, true);
    }

    if (!LIST_MODES.includes(mode)) this.renderLayoutSwitch(bar);
    if (!similar && !LIST_MODES.includes(mode)) {
      const more = iconButton(bar, "more-horizontal", t("list.moreActions"), "pdt-list-more");
      more.onclick = (event) => {
        const menu = new Menu();
        menu.addItem((item) => item.setTitle(t("query.saveWidget")).setIcon("bookmark-plus").onClick(() => this.view.searchBox.saveView()));
        if (!this.view.preset && this.settings.pageQueries?.[mode] != null) {   // only once you saved your own over the tab's
          menu.addItem((item) => item.setTitle(t("query.resetPage")).setIcon("rotate-ccw").onClick(() => this.view.resetPageQuery(mode)));
        }
        menu.showAtMouseEvent(event);
      };
    }
    if (this.settings.keyboard) this.renderKeyHelp(bar);
    // quick filters (Jira style): the changed and added ones as chips on a row of their own, under the bar
    if (this.quickFilters && !this.view.inQuery) this.renderFilterChips(bar.parentElement.createDiv({ cls: "pdt-quick" }), mode, opts, false);
    bar.toggleClass("is-query", this.view.inQuery);   // Filter and Sort step back: the query decides
    this.updateFilterHead();
  }

  /** Sort menu and direction (the Similar filter sorts by closeness first, with its own sort). */
  renderSort() {
    const sort = this.view.refs.sort;
    if (!sort) return;
    sort.empty();
    const similar = this.view.similar;
    const { key, dir } = similar ? this.settings.similarSort : this.listSort;
    const setSort = (value) => (similar ? this.view.update("similarSort", value) : this.setSort(value));
    menuChip(sort, t("filter.sort"), (similar ? SIMILAR_SORT_KEYS : SORT_KEYS).map((k) => [k, sortLabel(k)]), key,
      (k) => setSort({ key: k, dir: naturalDir(k) }));
    const ascending = dir === "asc";
    const tip = t(`sort.${key === "name" ? (ascending ? "az" : "za") : ascending ? "asc" : "desc"}`);
    iconButton(sort, ascending ? "arrow-up-narrow-wide" : "arrow-down-wide-narrow", tip, "pdt-sort-dir").onclick =
      () => setSort({ key, dir: ascending ? "desc" : "asc" });
  }

  /** Quick filters on this tab: the filters you changed or added show under the bar (off: only in the panel). */
  get quickFilters() {
    return Boolean(this.settings.quickFilters?.[this.view.page]);
  }

  /**
   * "Filter ▾ (N)": always first in the bar, only its count changes. It opens a panel with every filter of the
   * tab (changed ones marked with ↺, added ones with ✕), the filters you can add, the quick-filter switch and Reset.
   */
  renderFilterButton(bar, mode, opts) {
    const wrap = bar.createDiv({ cls: `pdt-filter-menu${this.view.filtersOpen ? " is-open" : ""}` });
    const head = wrap.createEl("button", { cls: "pdt-chip pdt-filter-head", attr: { type: "button", "aria-expanded": String(Boolean(this.view.filtersOpen)), "aria-haspopup": "true" } });
    setIcon(head.createSpan({ cls: "pdt-chip-caret" }), "sliders-horizontal");
    head.createSpan({ text: t("filter.more") });
    this.view.refs.filterCount = head.createSpan({ cls: "pdt-filter-count" });
    setIcon(head.createSpan({ cls: "pdt-chip-caret" }), "chevron-down");
    head.onclick = () => { this.view.filtersOpen = !this.view.filtersOpen; this.view.render(); };
    if (!this.view.filtersOpen) return;

    const panel = wrap.createDiv({ cls: "pdt-filter-panel", attr: { role: "dialog", "aria-label": t("filter.more") } });
    panel.addEventListener("keydown", (event) => { if (event.key === "Escape") { this.view.filtersOpen = false; this.view.render(); } });
    this.renderFilterChips(panel, mode, opts, true);
    const addable = this.view.inQuery ? [] : addableFilters(this.settings, mode);
    if (this.view.inQuery) panel.createDiv({ cls: "pdt-filter-note", text: t("filter.queryNote") });
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
      onToggle: (on) => this.view.update("quickFilters", { ...this.settings.quickFilters, [mode]: on }) });
    const clear = foot.createEl("button", { cls: "pdt-filter-clear", attr: { type: "button" } });
    clear.onclick = () => this.clearFilters();
    this.view.refs.filterClear = clear;
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
    if (!this.view.similar && changed.has("query") && !this.view.inQuery) {
      own("query", (p) => { const chip = p.createDiv({ cls: "pdt-chip" }); chip.createSpan({ text: t("filter.tipSearch", { q: settings.query.trim() }) }); return chip; });
    }
    if (!this.view.inQuery) {
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
    this.view.bulkBar.clearSelection();
    const mode = this.view.page;
    const { [key]: old, ...rest } = this.settings.extraFilters?.[mode] || {};
    this.settings.extraFilters = { ...this.settings.extraFilters, [mode]: value === undefined ? rest : { ...rest, [key]: value } };
    this.view.visible = PAGE_SIZE;
    await this.plugin.saveData(this.plugin.data);
    this.view.render();
  }

  /** ↺ on a changed chip: that filter back to the tab's default. */
  async resetFilter(key) {
    this.view.bulkBar.clearSelection();
    const cleared = clearedFilters(this.settings, this.view.page);
    if (key === "downloadFilter") Object.assign(this.settings, { downloadFilter: cleared.downloadFilter, minDownloads: cleared.minDownloads });
    else this.settings[key] = cleared[key];
    this.view.visible = PAGE_SIZE;
    await this.plugin.saveData(this.plugin.data);
    this.view.render();
  }

  /** The button's count (and the panel's Reset) follow the filters, the search included, without redrawing the bar. */
  updateFilterHead() {
    const { filterCount, filterClear } = this.view.refs;
    if (!filterCount) return;
    const n = changedFilters(this.filterState(), this.view.page);
    filterCount.setText(n ? String(n) : "");
    filterCount.toggleClass("is-hidden", !n);
    filterClear?.setText(t("filter.reset", { n }));
    filterClear?.toggleClass("is-hidden", !n);
    setTooltip(filterCount.parentElement, filterSummary(this.filterState(), this.view.page));
  }

  /** The settings the filters read: inside the Similar filter, its own search stands in for the tab's. */
  filterState() {
    return this.view.similar ? { ...this.settings, query: this.view.similar.query } : this.view.pageSettings;
  }

  async clearFilters() {
    this.view.bulkBar.clearSelection();
    const { query, ...cleared } = clearedFilters(this.settings, this.view.page);
    if (this.view.similar) this.view.similar.query = "";   // the All tab's own search stays as it was
    else cleared.query = query;
    Object.assign(this.settings, cleared);
    this.view.visible = PAGE_SIZE;
    await this.plugin.saveData(this.plugin.data);
    this.view.render();
  }

  /** "Clear filters": the tab's filters (and the search) back to their defaults; sort and layout stay. */
  renderClearFilters(parent) {
    const button = parent.createEl("button", { cls: "pdt-ghost pdt-clear-filters", attr: { type: "button" } });
    setIcon(button.createSpan({ cls: "pdt-chip-caret" }), "filter-x");
    button.createSpan({ text: t("filter.clear") });
    button.onclick = () => this.clearFilters();
    return button;
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

  /** "3 filters in effect" for the status line, when quick filters don't show them (so a short list has its reason). */
  activeFilters() {
    const n = changedFilters(this.filterState(), this.view.page);
    return n && !this.quickFilters ? [t("filter.active", { n })] : [];
  }

  /** List / Card switch. */
  renderLayoutSwitch(bar) {
    const box = bar.createDiv({ cls: "pdt-layout", attr: { role: "group", "aria-label": t("layout.label") } });
    for (const [value, icon] of [["list", "list"], ["cards", "layout-grid"], ["table", "table"]]) {
      const button = box.createEl("button", { cls: "pdt-layout-option", attr: { type: "button", "aria-pressed": String(this.settings.layout === value), "aria-label": t(`layout.${value}`) } });
      setIcon(button.createSpan(), icon);   // icon only; the name in the tooltip
      setTooltip(button, t(`layout.${value}`));
      button.onclick = () => this.view.update("layout", value);
    }
  }
}
