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
    this.similarOpen = new Set();
    this.similarQuery = "";       // search within the Similar list (not saved)
    this.collapsed = new Set();   // Tracked tab sections folded away
    this.refs = {};
    this.cursorId = null;         // the row keyboard shortcuts act on
    this.grouping = null;         // grouping mode: {ids, suggestions, picked, loading, error}
    // Obsidian activates a view's scope while its tab is focused, so keys work without clicking a row
    this.scope = new Scope(this.app.scope);
    this.keep = new Map();        // id → index: rows an action moved out of the filter stay put until render()
    for (const key of ["j", "k", "f", "g", "x", "h", "t", "r", "s", "o", "Enter", "0", "1", "2", "3", "4", "5"]) {
      this.scope.register([], key, (event) => this.onKey(event, key));
    }
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return t("view.title"); }
  getIcon() { return ICON; }

  async onOpen() {
    this.contentEl.addClass("pdt-view");
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
    item("folder-plus", t("menu.groupList", { n: Math.min(shown.length, AI_BATCH) }), () => this.startGrouping(shown));
    item("ban", t("list.ignoredTitle", { n: plugin.ignoredCount() }), () => this.update("mode", "ignored"));
    item("eye-off", t("list.dismissedTitle", { n: Object.keys(plugin.data.dismissed).length }), () => this.update("mode", "dismissed"));
    item("history", t("cmd.rebuild"), () => plugin.buildHistory(true));
    item("settings", t("menu.settings"), () => plugin.openSettings());
  }

  async translateVisible() {
    const rows = (this.rows || []).slice(0, this.visible);
    if (await this.plugin.translateRows(rows)) rows.forEach((p) => this.shownTranslations.add(p.id));
    this.refresh();
  }

  /**
   * A shortcut key (see KEY_HELP). Returns true to let Obsidian handle the key as usual: when shortcuts
   * are off, in grouping mode, or while typing in a field.
   */
  onKey(event, key) {
    const typing = globalThis.document?.activeElement?.closest?.("input, textarea, select, [contenteditable]");
    if (!this.settings.keyboard || this.grouping || typing) return true;
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

  // ── Grouping mode: AI suggestions for the plugins of the current list, picked on the rows ──
  async startGrouping(plugins) {
    const ids = plugins.slice(0, AI_BATCH).map((p) => p.id);
    if (!ids.length) return new Notice(t("grouping.empty"));
    if (!this.plugin.translator.ready) return new Notice(t("groups.aiSetup"));
    const grouping = { ids, suggestions: {}, picked: Object.fromEntries(ids.map((id) => [id, [...this.currentGroups(id)]])), loading: true, error: "" };
    this.grouping = grouping;
    this.refresh();
    try {
      grouping.suggestions = await this.plugin.groupSuggestions(ids.map((id) => this.plugin.pluginById(id)).filter(Boolean));
    } catch (error) {
      grouping.error = error.message;
    }
    grouping.loading = false;
    if (this.grouping === grouping) this.refresh();   // unless it was cancelled meanwhile
  }

  currentGroups(id) {
    return this.plugin.notes.index.get(id)?.groups || [];
  }

  stopGrouping() {
    this.grouping = null;
    this.render();
  }

  /** Writes the changed rows: new groups, cleared groups, or a new tracking note. */
  async acceptGrouping() {
    const { ids, picked } = this.grouping;
    let written = 0;
    for (const id of ids) {
      const plugin = this.plugin.pluginById(id);
      if (!plugin || sameNames(picked[id], this.currentGroups(id))) continue;
      await this.plugin.track(plugin, { groups: picked[id] });
      written++;
    }
    new Notice(t("notice.batchSaved", { n: written }));
    this.stopGrouping();
  }

  renderGrouping(list, now) {
    const grouping = this.grouping;
    this.rows = grouping.ids.map((id) => this.plugin.pluginById(id)).filter(Boolean);
    const bar = list.createDiv({ cls: "pdt-grouping-bar" });
    const text = bar.createDiv({ cls: "pdt-grouping-text" });
    text.createDiv({ cls: "pdt-banner-title", text: t("grouping.title", { n: this.rows.length }) });
    this.refs.groupingSummary = text.createDiv({ cls: "pdt-gm-note" });
    const button = (label, cls, run) => {
      const el = bar.createEl("button", { cls, text: label, attr: { type: "button" } });
      el.onclick = run;
      return el;
    };
    const pickAll = (choose) => {
      for (const id of grouping.ids) grouping.picked[id] = choose(id);
      for (const id of grouping.ids) this.renderGroupingChips(id);
      this.updateGroupingSummary();
    };
    button(t("grouping.pickTop"), "", () => pickAll((id) => {
      const current = this.currentGroups(id);
      return current.length ? [...current] : (grouping.suggestions[id] || []).slice(0, 1);
    }));
    button(t("grouping.reset"), "", () => pickAll((id) => [...this.currentGroups(id)]));
    button(t("groups.cancel"), "", () => this.stopGrouping());
    this.refs.groupingAccept = button("", "mod-cta", () => this.acceptGrouping());
    this.groupingRows = new Map();
    for (const p of this.rows) this.renderRow(list, p, now);
    this.updateGroupingSummary();
  }

  /** Redraws one row's chips only, so the list keeps its scroll position. */
  renderGroupingChips(id) {
    const grouping = this.grouping;
    const { row, box } = this.groupingRows.get(id) || {};
    if (!box) return;
    box.empty();
    setIcon(box.createSpan({ cls: "pdt-grouping-icon" }), "folder-plus");
    if (grouping.loading) {
      for (let i = 0; i < 3; i++) box.createSpan({ cls: "pdt-skeleton" });
      return;
    }
    const current = this.currentGroups(id);
    const mine = new Set(this.plugin.notes.groups().map((g) => g.name));
    const options = uniqueNames([...current, ...(grouping.suggestions[id] || [])]);
    if (!options.length) box.createSpan({ cls: "pdt-gm-note", text: grouping.error ? t("groups.aiFailed", { error: grouping.error }) : t("batch.noSuggestions") });
    for (const name of options) {
      groupChip(box, {
        name, on: grouping.picked[id].includes(name), star: mine.has(name), starTip: t("batch.legend"),
        onToggle: () => {
          const picked = grouping.picked[id];
          grouping.picked[id] = picked.includes(name) ? picked.filter((g) => g !== name) : [...picked, name];
          this.renderGroupingChips(id);
          this.updateGroupingSummary();
        },
      });
    }
    const changed = !sameNames(grouping.picked[id], current);
    row.toggleClass("is-grouping-changed", changed);
    if (changed) {
      const label = !this.plugin.notes.index.has(id) ? "grouping.willCreate" : grouping.picked[id].length ? "grouping.willChange" : "grouping.willClear";
      box.createSpan({ cls: "pdt-badge is-change", text: t(label) });
    }
  }

  updateGroupingSummary() {
    const { ids, picked } = this.grouping;
    const mine = new Set(this.plugin.notes.groups().map((g) => g.name));
    const changed = ids.filter((id) => !sameNames(picked[id], this.currentGroups(id)));
    const notes = changed.filter((id) => !this.plugin.notes.index.has(id)).length;
    const fresh = new Set(ids.flatMap((id) => picked[id]).filter((g) => !mine.has(g))).size;
    this.refs.groupingSummary?.setText(this.grouping.loading ? t("groups.aiLoading") : t("grouping.summary", { changed: changed.length, notes, fresh }));
    this.refs.groupingAccept?.setText(t("grouping.accept", { n: changed.length }));
  }

  get settings() { return this.plugin.data.settings; }

  async update(key, value) {
    if (key === "mode") this.grouping = null;   // another tab ends grouping mode
    this.settings[key] = value;
    this.visible = PAGE_SIZE;
    await this.plugin.saveData(this.plugin.data);
    this.render();
  }

  render() {
    const root = this.contentEl;
    root.empty();
    this.keep.clear();
    this.refs = { counts: {} };
    this.renderModes(root.createDiv({ cls: "pdt-seg" }));
    this.renderFilters(root.createDiv({ cls: "pdt-filters" }));
    this.refs.status = root.createDiv({ cls: "pdt-status" });
    this.refs.list = root.createDiv({ cls: "pdt-list" });
    this.refresh();
  }

  refresh() {
    if (!this.refs.list) return;
    const now = Date.now();
    const state = this.plugin.state();
    if (this.plugin.catalog) {
      const counts = modeCounts(state, this.settings, now);
      for (const [mode, el] of Object.entries(this.refs.counts)) el.setText(formatCount(counts[mode]));
      const updates = this.plugin.updatesCount(state, now);
      this.refs.updates?.setText(updates ? t("tracked.updatesBadge", { n: updates }) : "");
      this.refs.updates?.toggleClass("is-hidden", !updates);
    }
    this.renderStatus(this.refs.status);
    this.renderList(this.refs.list, state, now);
  }

  renderModes(seg) {
    const tipVars = { days: this.settings.days, gap: this.settings.dormantDays };
    for (const mode of MODE_KEYS) {
      const tab = seg.createDiv({ cls: `pdt-tab${mode === this.settings.mode ? " is-active" : ""}`, attr: { role: "tab", tabindex: "0" } });
      tab.createSpan({ text: t(`mode.${mode}`) });
      this.refs.counts[mode] = tab.createSpan({ cls: "pdt-n", text: "…" });
      if (mode === "tracked") this.refs.updates = tab.createSpan({ cls: "pdt-n is-updates is-hidden" });
      setTooltip(tab, t(`tip.${mode}`, tipVars));
      tab.onclick = () => this.update("mode", mode);
      onActivate(tab, () => this.update("mode", mode));
    }
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
      const on = Boolean(settings.trackedSections);
      const el = bar.createDiv({ cls: `pdt-chip is-toggle${on ? " is-on" : ""}` });
      const button = el.createSpan({ cls: "pdt-toggle", attr: { role: "button", tabindex: "0", "aria-pressed": String(on) } });
      setIcon(button.createSpan({ cls: "pdt-toggle-check" }), "check");
      button.createSpan({ text: t("tracked.sections") });
      button.onclick = () => this.update("trackedSections", !on);
      onActivate(button, () => this.update("trackedSections", !on));
    }
    if (settings.statusEnabled) {
      menuChip(bar, t("tracked.status"), [["", t("tracked.anyStatus")], ...settings.statuses.map((st) => [st.key, st.label])],
        settings.trackedStatus, (value) => this.update("trackedStatus", value));
    }
  }

  /** Saves a per-tab setting (downloadFilter, sortBy) for the current tab. */
  updateTab(key, value) {
    return this.update(key, { ...this.settings[key], [this.settings.mode]: value });
  }

  renderFilters(bar) {
    const mode = this.settings.mode;
    if (mode === SIMILAR_MODE) return this.renderSimilarBar(bar);
    const opts = modeOptions(this.settings, mode);
    if (mode === "tracked") this.renderTrackedBar(bar);
    const days = { label: t("filter.last"), unit: t("filter.daysUnit"), min: 1, max: 365, presets: DAY_PRESETS };

    if (mode === "new" || mode === "updated") {
      numberChip(bar, { ...days, value: this.settings.days, onChange: (n) => this.update("days", n) });
    }
    if (mode === "awakened") {
      numberChip(bar, { ...days, label: t("filter.gap"), max: 3650, presets: DORMANT_PRESETS, value: this.settings.dormantDays, onChange: (n) => this.update("dormantDays", n) });
    }
    if (mode !== "new") toggleChip(bar, {
      label: t("filter.downloads"),
      value: this.settings.minDownloads,
      on: opts.filterDownloads,
      onToggle: (on) => this.updateTab("downloadFilter", on),
      onValue: async (n) => {
        this.settings.minDownloads = n;
        await this.updateTab("downloadFilter", true);
      },
    });

    const sort = bar.createDiv({ cls: "pdt-sort" });
    menuChip(sort, t("filter.sort"), SORT_KEYS.map((key) => [key, t(`sort.${key}`)]), opts.sort,
      (key) => this.updateTab("sortBy", { key, dir: NATURAL_DIR[key] }));
    const ascending = opts.sortDir === "asc";
    const tip = t(`sort.${opts.sort === "name" ? (ascending ? "az" : "za") : ascending ? "asc" : "desc"}`);
    iconButton(sort, ascending ? "arrow-up-narrow-wide" : "arrow-down-wide-narrow", tip, "pdt-sort-dir").onclick =
      () => this.updateTab("sortBy", { key: opts.sort, dir: ascending ? "desc" : "asc" });

    this.refs.search = this.renderSearch(bar, this.settings.query, t("search.placeholder"), async (value) => {
      this.settings.query = value;
      this.visible = PAGE_SIZE;
      this.refresh();
      await this.plugin.saveData(this.plugin.data);
    });

    if (mode === "tracked" && this.settings.trackedGroup === UPDATES) {
      const all = bar.createEl("button", { cls: "pdt-ghost", text: t("changed.markAll") });
      all.onclick = async () => { await this.plugin.markReviewed(this.rows || []); this.refresh(); };
    }
    if (!LIST_MODES.includes(mode)) this.renderLayoutSwitch(bar);
    if (this.settings.keyboard) this.renderKeyHelp(bar);
  }

  /** The search box (comma terms or /regex/); `onChange` runs 250 ms after typing stops. Returns the input. */
  renderSearch(bar, value, placeholder, onChange) {
    const search = bar.createDiv({ cls: "pdt-search" });
    setIcon(search.createSpan({ cls: "pdt-search-icon" }), "search");
    const input = search.createEl("input", { type: "search", placeholder, value });
    const badge = search.createSpan({ cls: "pdt-regex", text: ".*" });
    setTooltip(badge, t("search.regex"));
    const mark = () => {
      const { regex, error } = compileQuery(input.value);
      search.toggleClass("is-regex", regex && !error);
      search.toggleClass("is-invalid", Boolean(error));
    };
    mark();
    let timer;
    input.oninput = () => {
      mark();
      clearTimeout(timer);
      timer = setTimeout(() => onChange(input.value), 250);
    };
    return input;
  }

  /** The Similar list's bar: sort (by meaning first), direction, a search within the results, shortcuts. */
  renderSimilarBar(bar) {
    const { key, dir } = this.settings.similarSort;
    const sort = bar.createDiv({ cls: "pdt-sort" });
    menuChip(sort, t("filter.sort"), SIMILAR_SORT_KEYS.map((k) => [k, t(`sort.${k}`)]), key,
      (k) => this.update("similarSort", { key: k, dir: NATURAL_DIR[k] || "desc" }));
    const ascending = dir === "asc";
    const tip = t(`sort.${key === "name" ? (ascending ? "az" : "za") : ascending ? "asc" : "desc"}`);
    iconButton(sort, ascending ? "arrow-up-narrow-wide" : "arrow-down-wide-narrow", tip, "pdt-sort-dir").onclick =
      () => this.update("similarSort", { key, dir: ascending ? "desc" : "asc" });
    const seed = this.plugin.pluginById(this.settings.similarTrail.at(-1));
    const n = seed ? this.plugin.similarTo(seed).length : 0;
    this.renderSearch(bar, this.similarQuery, t("similar.search", { n }), (value) => {
      this.similarQuery = value;
      this.refresh();
    });
    this.renderLayoutSwitch(bar);
    if (this.settings.keyboard) this.renderKeyHelp(bar);
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
    } else {
      text.createDiv({
        text: [
          t("status.plugins", { n: formatCount(catalog.plugins.length) }),
          t("status.lastSync", { time: formatTime(catalog.fetchedAt, now), age: formatAge(now - catalog.fetchedAt) }),
          timeline.to ? t("status.history", { label: historyLabel(timeline.months) }) : t("status.noHistory"),
        ].join("  ·  "),
      });
      const { delta } = catalog;
      if (this.plugin.busy) text.createDiv({ cls: "pdt-progress", text: this.plugin.progress || t("status.syncing") });
      else if (delta) text.createDiv({ cls: "pdt-delta", text: t("status.delta", { added: formatCount(delta.added), updated: formatCount(delta.updated) }) });
    }
    const query = this.settings.mode === SIMILAR_MODE ? "" : this.settings.query.trim();   // the Similar list ignores the search
    if (query) {  // a saved search shouldn't be forgotten: this is why the list is short
      const { error } = compileQuery(query);
      const tag = status.createDiv({ cls: `pdt-query${error ? " is-invalid" : ""}` });
      tag.createSpan({ text: error ? t("search.invalid", { error }) : t("status.query", { q: query }) });
      const clear = tag.createSpan({ cls: "pdt-query-clear", text: t("status.clear"), attr: { role: "button", tabindex: "0" } });
      clear.onclick = async () => {
        this.settings.query = "";
        if (this.refs.search) this.refs.search.value = "";
        this.visible = PAGE_SIZE;
        this.refresh();
        await this.plugin.saveData(this.plugin.data);
      };
      onActivate(clear, () => clear.click());
    }
    const actions = status.createDiv({ cls: "pdt-status-actions" });
    if (!timeline.to || timeline.legacy) {
      actions.createEl("button", { cls: "mod-cta", text: t(timeline.to ? "status.rebuild" : "status.build") })
        .onclick = () => this.plugin.buildHistory(true);
    }
  }

  /** Redraws only the status line (progress updates during a sync). */
  refreshStatus() {
    if (this.refs.status) this.renderStatus(this.refs.status);
  }

  renderList(list, state, now) {
    list.empty();
    this.rows = [];
    this.cards = this.settings.layout === "cards" && !this.grouping && !LIST_MODES.includes(this.settings.mode);
    list.toggleClass("is-cards", this.cards);
    if (!this.plugin.catalog) return;
    if (this.grouping) return this.renderGrouping(list, now);
    const { timeline } = this.plugin;
    const mode = this.settings.mode;
    if (mode === SIMILAR_MODE) return this.renderSimilarList(list, now);
    if (mode === "awakened" && !timeline.to) {
      list.createDiv({ cls: "pdt-empty", text: t("list.needHistory") });
      return;
    }
    if (mode === "new" && (!timeline.to || timeline.legacy)) list.createDiv({ cls: "pdt-hint", text: t("list.legacyHint") });

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
      list.createDiv({ cls: "pdt-empty", text: t("list.empty") });
      return;
    }
    if (sections) {
      for (const section of groupSections(this.rows, state.notes)) this.renderSection(list, section, now);
      return;
    }
    for (const plugin of visible) this.renderRow(list, plugin, now);
    if (this.rows.length > this.visible) {
      const more = list.createEl("button", {
        cls: "pdt-more",
        text: t("list.more", { n: Math.min(PAGE_SIZE, this.rows.length - this.visible), total: formatCount(this.rows.length), shown: this.visible }),
      });
      more.onclick = () => { this.visible += PAGE_SIZE; this.refresh(); };
    }
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

  /** The preview under a row: the best few matches, why they match, and the way into the full list. */
  renderSimilar(parent, p) {
    const box = parent.createDiv({ cls: "pdt-similar" });
    box.createDiv({ cls: "pdt-gm-label", text: t("similar.title"), attr: { lang: language } });
    const found = this.plugin.similarTo(p);
    if (!found.length) {
      box.createDiv({ cls: "pdt-gm-note", text: t("similar.none") });
      return;
    }
    for (const x of found.slice(0, SIMILAR_PREVIEW)) {
      const item = box.createDiv({ cls: "pdt-similar-item" });
      const head = item.createDiv({ cls: "pdt-similar-head" });
      head.createEl("a", { cls: "pdt-similar-name", text: x.p.name, href: `obsidian://show-plugin?id=${encodeURIComponent(x.p.id)}` });
      this.renderTerms(head, x.shared.slice(0, 3));
      if (x.p.downloads != null) {
        const dl = head.createSpan({ cls: "pdt-similar-dl" });
        setIcon(dl.createSpan({ cls: "pdt-dl-icon" }), "download");
        dl.createSpan({ text: formatShort(x.p.downloads) });
      }
      if (x.p.description) item.createDiv({ cls: "pdt-similar-desc", text: x.p.description });
    }
    const all = box.createEl("button", { cls: "pdt-similar-all", text: t("similar.seeAll", { n: found.length }), attr: { type: "button" } });
    setIcon(all.createSpan({ cls: "pdt-similar-all-icon" }), "arrow-right");
    all.onclick = () => this.openSimilar(p);
  }

  /** Opens the Similar list for `p`; inside it, adds `p` to the trail (or steps back to it). */
  async openSimilar(p) {
    const settings = this.settings;
    const trail = settings.mode === SIMILAR_MODE ? settings.similarTrail : [];
    const at = trail.indexOf(p.id);
    if (settings.mode !== SIMILAR_MODE) settings.similarFrom = settings.mode;
    settings.similarTrail = at === -1 ? [...trail, p.id] : trail.slice(0, at + 1);
    this.similarOpen.delete(p.id);
    this.similarQuery = "";
    await this.update("mode", SIMILAR_MODE);
    this.contentEl.scrollTop = 0;
  }

  /** The Similar list: plugins like the last one of the trail, closest first (or as sorted), each with why it matches. */
  renderSimilarList(list, now) {
    const trail = this.settings.similarTrail.map((id) => this.plugin.pluginById(id)).filter(Boolean);
    const seed = trail.at(-1);
    const found = seed ? this.plugin.similarTo(seed) : [];
    this.renderTrail(list, trail, found);
    this.stale = new Set();
    this.similarInfo = new Map(found.map((x) => [x.p.id, x]));
    const query = compileQuery(this.similarQuery);
    const { key, dir } = this.settings.similarSort;
    const matching = found.map((x) => x.p).filter((p) => query.test(p));
    const { catalog, releases, notes } = this.plugin.state();
    this.rows = key === "relevance" ? (dir === "asc" ? matching.reverse() : matching) : sortRows(matching, key, dir, catalog, releases, notes);
    if (!this.rows.length) {
      list.createDiv({ cls: "pdt-empty", text: t(found.length ? "list.empty" : "similar.none") });
      return;
    }
    for (const p of this.rows) this.renderRow(list, p, now);
  }

  /**
   * The Similar list's head: the trail (its first step is the tab you came from), the title with the
   * number of matches and how they were found, and the plugin's description.
   */
  renderTrail(list, trail, found) {
    const seed = trail.at(-1);
    const from = this.settings.similarFrom || "all";
    const nav = list.createEl("nav", { cls: "pdt-trail", attr: { "aria-label": t("similar.trail") } });
    const home = nav.createEl("button", { cls: "pdt-trail-step is-home", attr: { type: "button" } });
    setIcon(home.createSpan({ cls: "pdt-trail-icon" }), "arrow-left");
    home.createSpan({ text: MODE_KEYS.includes(from) ? t(`mode.${from}`) : t("list.back") });
    home.onclick = () => this.update("mode", from);
    trail.forEach((p, i) => {
      setIcon(nav.createSpan({ cls: "pdt-trail-sep" }), "chevron-right");
      const current = i === trail.length - 1;
      const step = nav.createEl("button", { cls: `pdt-trail-step${current ? " is-current" : ""}`, text: p.name, attr: { type: "button" } });
      if (current) step.setAttribute("aria-current", "page");
      else step.onclick = () => this.update("similarTrail", this.settings.similarTrail.slice(0, i + 1));
    });
    const head = list.createDiv({ cls: "pdt-similar-head-box" });
    const title = head.createDiv({ cls: "pdt-similar-title" });
    title.createSpan({ cls: "pdt-similar-title-text", text: t("similar.listTitle", { name: seed?.name ?? "–" }) });
    title.createSpan({ cls: "pdt-similar-count", text: t("similar.count", { n: found.length }) });
    title.createSpan({ cls: "pdt-similar-method", text: t(found[0]?.cosine != null ? "similar.byMeaning" : "similar.byWords") });
    if (seed?.description) head.createDiv({ cls: "pdt-similar-seed", text: seed.description });
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
   * body (description, translation, why it's similar) · links · actions · more (Similar preview, grouping).
   * Clicking the description (or the card) opens the details window.
   */
  renderRow(list, p, now) {
    const plugin = this.plugin;
    const { firstSeen, releases } = plugin.timeline;
    const note = plugin.notes.index.get(p.id);
    const mode = this.settings.mode;
    const stale = this.stale?.has(p.id);
    const row = list.createDiv({ cls: `pdt-row${p.id === this.cursorId ? " is-cursor" : ""}${stale ? " is-stale" : ""}`, attr: { tabindex: "0", "data-id": p.id } });
    row.addEventListener("click", (event) => {
      this.setCursor(row);
      // a card opens its details from anywhere that isn't a control
      if (this.cards && !event.target.closest("a, button, input, [role=button], .pdt-rate, .pdt-similar")) this.openDetails(p);
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

    // tags: system signals, then your note (note link, groups, status, rating)
    const tags = row.createDiv({ cls: "pdt-tags" });
    const signal = (cls, text) => tags.createSpan({ cls: `pdt-signal ${cls}`, text });
    if (isNewPlugin(firstSeen, p, now, this.settings.newDays)) signal("is-new", t("badge.new"));
    if (isChanged(p, note)) signal("is-changed", t("badge.changed"));
    if (plugin.installed().has(p.id)) signal("is-installed", t("badge.installed"));
    if (isSnoozed(p, plugin.data.snoozed)) signal("is-snoozed", t("badge.snoozed"));
    if (stale) signal("is-stale", t("row.stale"));
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
    const inSimilar = mode === SIMILAR_MODE;
    const info = inSimilar && this.similarInfo?.get(p.id);
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
    // in the Similar list it goes one step further down the trail; elsewhere it opens a preview
    const similarOpen = !inSimilar && this.similarOpen.has(p.id);
    const similar = link(`pdt-readme pdt-similar-link${similarOpen ? " is-open" : ""}`, t("row.similar"),
      inSimilar ? "arrow-right" : similarOpen ? "chevron-up" : "chevron-down", () => {
        if (inSimilar) return this.openSimilar(p);
        if (similarOpen) this.similarOpen.delete(p.id); else this.similarOpen.add(p.id);
        this.refresh();
      });
    if (!inSimilar) similar.setAttribute("aria-expanded", String(similarOpen));
    setTooltip(similar, t(inSimilar ? "similar.nextTip" : "row.similarTip"));
    if (p.description) {
      link("pdt-readme pdt-tr", showing ? t("translate.hide") : t("translate.row"), "languages", async () => {
        if (showing) this.shownTranslations.delete(p.id);
        else if (translation != null || (await plugin.translateRows([p]))) this.shownTranslations.add(p.id);
        this.refresh();
      });
    }

    if (this.grouping) {   // grouping mode: the row's group chips take the place of its actions
      this.groupingRows.set(p.id, { row, box: row.createDiv({ cls: "pdt-extra pdt-grouping-chips pdt-gm-chips" }) });
      this.renderGroupingChips(p.id);
      return;
    }
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
    if (similarOpen) this.renderSimilar(row.createDiv({ cls: "pdt-extra" }), p);
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
    for (const [value, icon] of [["list", "list"], ["cards", "layout-grid"]]) {
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

  /** The star: a click toggles the favourite; hovering or focusing it opens 1–5 stars to rate. */
  renderStar(actions, act, p, note) {
    const box = actions.createDiv({ cls: "pdt-rate" });
    const star = act("star", t(note?.favorite ? "action.unfavorite" : "action.favorite"), () => this.plugin.toggleFavorite(p), note?.favorite ? "is-favorite" : "", true);
    box.appendChild(star);
    const pop = box.createDiv({ cls: "pdt-rate-pop", attr: { role: "group", "aria-label": t("rating.set") } });
    const stars = pop.createDiv({ cls: "pdt-rate-stars" });   // laid out in reverse so hovering fills a star and those before it
    for (let n = 5; n >= 1; n--) {
      const button = stars.createEl("button", { cls: `pdt-rate-star${(note?.rating || 0) >= n ? " is-on" : ""}`, text: "★", attr: { type: "button", "aria-label": t("rating.label", { n }) } });
      button.onclick = () => this.runRowAction(p, () => this.plugin.setNoteField(p, "rating", n));
    }
    if (note?.rating) {
      const clear = pop.createEl("button", { cls: "pdt-rate-clear", text: t("rating.clear"), attr: { type: "button" } });
      clear.onclick = () => this.runRowAction(p, () => this.plugin.setNoteField(p, "rating", null));
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

