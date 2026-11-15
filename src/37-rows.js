// ─── RowRenderer ─────────────────────────────────────────────────────
/**
 * The list's rows: a row or card per plugin, the table, Tracked sections, Show more, the star and note chips, row
 * actions. Works on the view's state (see ViewPart).
 */
class RowRenderer extends ViewPart {
  /** A picked row's groups: the ones it has and the AI's, on/off; a click adds or removes the group at once. */
  renderSuggestions(box, p) {
    const suggest = this.view.suggest;
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

  /** Rows as the layout says: list or cards (renderRow), or the table. */
  renderRows(list, rows, now) {
    if (this.settings.layout === "table" && this.view.bulkBar.selectable) return this.renderTable(list, rows, now);
    for (const p of rows) this.renderRow(list, p, now);
  }

  /**
   * The table: a pick box, Name (its description on hover), then the tab's columns; a header click sorts by it,
   * the last header opens the column picker. Tracking and Rating cells change on click; a row opens its details.
   */
  renderTable(list, rows, now) {
    const page = this.view.page;
    const state = this.view.listState;
    const columns = tableColumns(this.settings, page);
    const { key: sort, dir: sortDir } = this.view.filterBar.listSort;
    const wrap = list.createDiv({ cls: "pdt-table-wrap" });
    const table = wrap.createEl("table", { cls: "pdt-table" });
    const head = table.createEl("thead").createEl("tr");
    const all = head.createEl("th", { cls: "pdt-table-pick" }).createEl("input", { type: "checkbox", cls: "pdt-select", attr: { "aria-label": t("table.pickShown") } });
    all.checked = rows.length > 0 && rows.every((p) => this.view.selected.has(p.id));
    all.onclick = () => { for (const p of rows) (all.checked ? this.view.selected.add(p.id) : this.view.selected.delete(p.id)); this.view.bulkBar.syncSelection(); };
    const header = (key, label, align = "left") => {
      const th = head.createEl("th", { cls: key === "name" ? "pdt-table-name" : `is-${align} is-${key} is-draggable` });
      th.dataset.key = key;
      const sortKey = key === "name" ? "name" : TABLE_COLUMNS[key].sort;
      if (!sortKey) return void th.setText(label);
      const on = sort === sortKey;
      th.setAttribute("aria-sort", on ? (sortDir === "asc" ? "ascending" : "descending") : "none");
      const button = th.createEl("button", { cls: `pdt-table-sort${on ? " is-on" : ""}`, text: on ? `${label} ${sortDir === "asc" ? "↑" : "↓"}` : label });
      button.onclick = () => this.view.filterBar.setSort({ key: sortKey, dir: on ? (sortDir === "asc" ? "desc" : "asc") : naturalDir(sortKey) });
    };
    header("name", t("col.name"));
    for (const key of columns) header(key, t(`col.${key}`), TABLE_COLUMNS[key].align);
    const saveColumns = async (next) => {
      this.settings.tableColumns = { ...this.settings.tableColumns, [page]: next };
      if (!next) delete this.settings.tableColumns[page];
      await this.plugin.saveData(this.plugin.data);
      this.view.refresh();
    };
    const pick = head.createEl("th", { cls: "pdt-table-cols" });
    const button = iconButton(pick, "columns-3", t("table.columns"));
    button.onclick = () => {
      if (this.view.columnsPop?.isOpen) return this.view.columnsPop.close();
      const title = this.view.preset ? this.view.home.title(this.view.preset.id) : t(`mode.${page}`);
      const sample = (key) => (rows[0] ? this.cellText(key, rows[0], state, now) : "");
      this.view.columnsPop = new ColumnsPopover(button, { page: title, columns, sort, sample, onChange: saveColumns }).open();
    };
    // a column's header drags to a new place (Name and the edges stay)
    Sortable.create(head, { draggable: "th.is-draggable", animation: 150, onEnd: () => saveColumns([...head.querySelectorAll("th.is-draggable")].map((th) => th.dataset.key)) });

    const body = table.createEl("tbody");
    for (const p of rows) {
      const note = state.notes.get(p.id);
      const tr = body.createEl("tr", { cls: `pdt-trow${this.view.selected.has(p.id) ? " is-selected" : ""}`, attr: { "data-id": p.id, tabindex: "0" } });
      tr.onclick = (event) => { if (!event.target.closest("a, button, input")) this.openDetails(p); };
      tr.addEventListener("contextmenu", (event) => { event.preventDefault(); this.showRowMenu(p, event); });
      const box = tr.createEl("td", { cls: "pdt-table-pick" }).createEl("input", { type: "checkbox", cls: "pdt-select", attr: { "aria-label": t("bulk.pick", { name: p.name }) } });
      box.checked = this.view.selected.has(p.id);
      box.onclick = (event) => { event.stopPropagation(); this.view.bulkBar.pick(p, box.checked, event.shiftKey); };
      const name = tr.createEl("td", { cls: "pdt-table-name" });
      this.nameLink(name, p);
      if (p.version) name.createSpan({ cls: "pdt-ver", text: p.version });
      if (p.description) setTooltip(name, p.description, { delay: 300 });
      for (const key of columns) {
        const td = tr.createEl("td", { cls: `is-${TABLE_COLUMNS[key].align || "left"} is-${key}` });
        if (key === "tracked") {
          const bell = td.createEl("button", { cls: `pdt-table-track${note ? " is-on" : ""}`, attr: { type: "button", "aria-label": t(note ? "action.untrack" : "action.track") } });
          setIcon(bell, note ? "bell-ring" : "bell-plus");
          bell.onclick = () => this.runRowAction(p, () => this.plugin.toggleTrack(p));
        } else if (key === "rating") {
          this.renderRating(td, p, note);
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
    if (this.view.rows.length <= this.view.visible) return;
    const more = list.createEl("button", {
      cls: "pdt-more",
      text: t("list.more", { n: Math.min(PAGE_SIZE, this.view.rows.length - this.view.visible), total: formatCount(this.view.rows.length), shown: this.view.visible }),
    });
    more.onclick = () => { this.view.visible += PAGE_SIZE; this.view.refresh(); };
  }

  /** One Tracked-tab section: a coloured, foldable group heading and its rows, indented on a rail. */
  renderSection(list, { name, rows }, now) {
    const label = name === UNGROUPED ? t("tracked.ungrouped") : name;
    const open = !this.view.collapsed.has(name);
    const section = list.createDiv({ cls: `pdt-section${name === UNGROUPED ? "" : ` pdt-hue-${groupHue(name)}`}` });
    const head = section.createEl("button", { cls: "pdt-section-head", attr: { type: "button", "aria-expanded": String(open) } });
    setIcon(head.createSpan({ cls: `pdt-section-caret${open ? "" : " is-closed"}` }), "chevron-down");
    head.createSpan({ cls: "pdt-swatch" });
    head.createSpan({ cls: "pdt-section-name", text: label });
    head.createSpan({ cls: "pdt-section-count", text: formatCount(rows.length) });
    head.createSpan({ cls: "pdt-section-rule" });
    head.onclick = () => {
      if (open) this.view.collapsed.add(name); else this.view.collapsed.delete(name);
      this.view.refresh();
    };
    if (!open) return;
    const body = section.createDiv({ cls: "pdt-section-body" });
    for (const p of rows) this.renderRow(body, p, now);
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
    const stale = this.view.stale?.has(p.id);
    const picked = this.view.selected.has(p.id);
    const row = list.createDiv({ cls: `pdt-row${p.id === this.view.cursorId ? " is-cursor" : ""}${stale ? " is-stale" : ""}${picked ? " is-selected" : ""}`, attr: { tabindex: "0", "data-id": p.id } });
    if (this.view.bulkBar.selectable) {
      // the box's whole gutter takes the click (a label around it), so a near miss picks instead of opening the details
      const hit = row.createEl("label", { cls: "pdt-select-hit" });
      const box = hit.createEl("input", { type: "checkbox", cls: "pdt-select", attr: { "aria-label": t("bulk.pick", { name: p.name }) } });
      row.addClass("has-select");
      box.checked = picked;
      hit.onclick = (event) => event.stopPropagation();
      box.onclick = (event) => { event.stopPropagation(); this.view.bulkBar.pick(p, box.checked, event.shiftKey); };
    }
    if (!LIST_MODES.includes(mode)) row.addEventListener("contextmenu", (event) => { event.preventDefault(); this.showRowMenu(p, event); });
    row.addEventListener("click", (event) => {
      this.view.setCursor(row);
      // a row or card opens its details from anywhere that isn't a control (or selected text)
      if (globalThis.getSelection?.()?.toString()) return;
      if (!event.target.closest("a, button, input, label, [role=button], .pdt-rate, .pdt-similar")) this.openDetails(p);
    });

    const head = row.createDiv({ cls: "pdt-head" });
    this.nameLink(head, p);
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
    const sortKey = this.view.similar ? this.settings.similarSort.key : modeOptions(this.settings, mode).sort;
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
    if (this.view.listState.installed.has(p.id)) signal("is-installed", t("badge.installed"));
    if (isSnoozed(p, plugin.data.snoozed)) signal("is-snoozed", t("badge.snoozed"));
    if (LIST_MODES.includes(mode) && typeof plugin.data[mode][p.id] === "string") {   // when you hid it (snoozed keeps a release, no day)
      signal("is-why", t(`hidden.when.${mode}`, { day: this.view.home.dayLabel(dayStart(plugin.data[mode][p.id])) }));
    }
    if (stale) signal("is-stale", t("row.stale"));
    if (this.view.preset?.freshIds?.has(p.id)) signal("is-fresh", t("home.freshMark"));
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
    const desc = body.createEl("p", { cls: "pdt-desc", text: p.description || "–" });
    if (p.description) {   // a click translates it (and hides the translation again)
      Object.assign(desc, { role: "button", tabIndex: 0 });
      setTooltip(desc, t("row.translateTip"));
      desc.onclick = () => this.toggleTranslation(p);
      onActivate(desc, () => this.toggleTranslation(p));
    }
    const translation = plugin.cachedTranslation(p);
    if (translation != null && this.view.shownTranslations.has(p.id)) body.createDiv({ cls: "pdt-trans", text: translation });
    const info = this.view.similar && this.view.similarInfo?.get(p.id);
    if (info) this.renderWhy(body, info);

    if (this.view.suggest?.ids.has(p.id)) this.renderSuggestions(row.createDiv({ cls: "pdt-extra pdt-grouping-chips pdt-gm-chips" }), p);
    const actions = row.createDiv({ cls: "pdt-actions" });
    const act = (icon, tip, fn, cls = "", keep = false) => {
      const button = iconButton(actions, icon, tip, cls);
      button.onclick = async () => {
        if (button.hasClass("is-busy")) return;  // a quick double click must not run the action twice
        button.addClass("is-busy");
        if (keep) await this.runRowAction(p, fn);
        else { await fn(); this.view.refresh(); }
      };
      return button;
    };
    if (LIST_MODES.includes(mode)) {
      act("undo-2", t("action.restore"), () => plugin.restoreFrom(mode, [p.id]));
      return;
    }
    this.renderTrack(act, p, note);
    this.renderRating(actions, p, note);
    iconButton(actions, "more-horizontal", t("row.menu"), "pdt-row-menu").onclick = (event) => this.showRowMenu(p, event);
  }

  /** The plugin's name, a link to its GitHub page (Obsidian's page when it has no repository). */
  nameLink(parent, p) {
    const href = p.repo ? `https://github.com/${p.repo}` : `obsidian://show-plugin?id=${encodeURIComponent(p.id)}`;
    const name = parent.createEl("a", { cls: "pdt-name", text: p.name, href });
    setTooltip(name, p.repo ? t("row.github") : t("details.openInObsidian"));
    return name;
  }

  /** The description's translation under it, on or off; the first time asks the AI for it. */
  async toggleTranslation(p) {
    const shown = this.view.shownTranslations;
    if (shown.has(p.id)) shown.delete(p.id);
    else if (this.plugin.cachedTranslation(p) != null || (await this.plugin.translateRows([p]))) shown.add(p.id);
    this.view.refresh();
  }

  /**
   * The row's menu, from ⋯ or a right click: every action besides ★, each saying on hover what it does and why.
   * Not tracked: hide until the next release. Tracked: nothing to mark, opening its details or note counts as seen.
   * @param {object} [on]  what follows an action (the details window passes its own; see rowEffects)
   */
  showRowMenu(p, event, on = this.rowEffects(p)) {
    const plugin = this.plugin;
    const note = plugin.notes.index.get(p.id);
    const menu = new Menu();
    const item = (icon, title, tip, run) => menu.addItem((i) => {
      i.setIcon(icon).setTitle(title).onClick(run);
      if (i.dom) setTooltip(i.dom, tip, { placement: "right" });   // MenuItem.dom isn't public API: the tip is a bonus
    });
    item(note ? "bell-off" : "bell-plus", t(note ? "action.untrack" : "action.track"), t(note ? "menu.untrackTip" : "menu.trackTip"),
      () => on.change(() => plugin.toggleTrack(p)));
    this.rateItem(menu, note?.rating || 0, (n) => on.change(() => plugin.setNoteField(p, "rating", n)));
    item("folder-plus", t("action.group"), t("menu.groupTip"), () => on.change(() => plugin.chooseGroup(p)));
    item("arrow-right", t("menu.similar"), t("menu.similarTip"), () => { on.away(); this.view.similarFilter.open(p); });
    if (p.repo) {
      item("file-text", t(note ? "menu.readmeOpen" : "menu.readmeDownload"), t(note ? "menu.readmeOpenTip" : "menu.readmeDownloadTip"), () => { on.away(); plugin.openReadme(p); });
    }
    menu.addSeparator();
    if (this.settings.mode === "suggested") item("x", t("action.dismiss"), t("menu.dismissTip"), () => on.leave(() => plugin.dismiss(p)));
    else if (!note) item("eye-off", t("action.snooze"), t("menu.snoozeTip"), () => on.leave(() => plugin.snooze(p)));
    item("ban", t("action.exclude"), t("menu.excludeTip"), () => on.leave(() => plugin.exclude(p)));
    menu.showAtMouseEvent(event);
    return menu;
  }

  /**
   * The menu's Rate: the same 1–5 stars as ★, beside the item. Hovering it shows them; a click keeps them (the menu
   * closes, they stay where they were) until a pick, a click elsewhere or Esc. `pick(n)`: n 1–5, null clears.
   */
  rateItem(menu, rating, pick) {
    let rect = null;   // where the item was: a click may come after the menu let go of it
    menu.addItem((i) => {
      i.setIcon("star").setTitle(t("rating.set")).onClick((event) => {
        const at = rect || i.dom?.getBoundingClientRect() || { left: event.clientX, right: event.clientX, top: event.clientY };   // no hover first: keyboard
        showRatingFloat(at, rating, pick, true);
      });
      if (!i.dom) return;   // MenuItem.dom isn't public API: without it, a click still opens the stars
      setTooltip(i.dom, t("menu.rateTip"), { placement: "right" });
      i.dom.addEventListener("mouseenter", () => { rect = i.dom.getBoundingClientRect(); showRatingFloat(rect, rating, pick, false); });
      i.dom.addEventListener("mouseleave", () => leaveRatingFloat());
    });
    menu.onHide?.(() => closeRatingFloat());   // unpinned stars go with the menu
  }

  /**
   * What follows an action on a row of the list: `change` keeps the row in place, `leave` redraws (it may leave the
   * list), `away` (the action opens something else) has nothing to do here. The details window has its own three.
   */
  rowEffects(p) {
    return {
      change: (fn) => this.runRowAction(p, fn),
      leave: async (fn) => { await fn(); this.view.refresh(); },
      away: () => {},
    };
  }

  /**
   * What each shortcut key (KEY_HELP) does to `p`, in the list and in the details window alike.
   * @param {object} on  rowEffects, plus `translate` (t) and, in the list, `details` (Enter)
   * @returns {Object<string, function>} key → action
   */
  shortcutActions(p, on) {
    const plugin = this.plugin;
    const listMode = LIST_MODES.includes(this.settings.mode);
    const away = (fn) => () => { on.away(); return fn(); };
    const actions = {
      f: () => on.change(() => plugin.toggleTrack(p)),   // f: follow
      g: () => on.change(() => plugin.chooseGroup(p)),
      x: () => on.leave(() => (listMode ? plugin.restoreFrom(this.settings.mode, [p.id]) : plugin.exclude(p))),
      h: () => on.leave(() => plugin.snooze(p)),
      t: () => on.translate(),
      r: away(() => plugin.openReadme(p)),
      s: away(() => this.view.similarFilter.open(p)),
      o: () => globalThis.open?.(`obsidian://show-plugin?id=${encodeURIComponent(p.id)}`),   // Obsidian's own page of it
    };
    if (on.details) actions.Enter = on.details;
    for (const n of [0, 1, 2, 3, 4, 5]) actions[n] = () => on.change(() => plugin.setNoteField(p, "rating", n || null));
    return actions;
  }

  /** Opens the details window of `p`; ←/→ in it walks the current list. */
  openDetails(p) {
    const rows = this.view.rows?.some((r) => r.id === p.id) ? this.view.rows : [p];
    const origin = [...this.view.contentEl.querySelectorAll(".pdt-row")].find((r) => r.dataset.id === p.id);
    new DetailModal(this.view, rows, rows.findIndex((r) => r.id === p.id), origin).open();
  }

  /** Runs a row action and keeps the row where it was even if it no longer matches the filter. */
  async runRowAction(p, fn) {
    const index = (this.view.rows || []).findIndex((r) => r.id === p.id);
    await fn();
    if (index !== -1) this.view.keep.set(p.id, index);
    this.view.refresh();
  }

  /** 🔔: a click tracks the plugin (it gets its note) or lets it go; lit while tracked. */
  renderTrack(act, p, note) {
    const bell = act(note ? "bell-ring" : "bell-plus", t(note ? "action.untrack" : "action.track"), () => this.plugin.toggleTrack(p), note ? "is-tracked" : "", true);
    setTooltip(bell, t(note ? "menu.untrackTip" : "menu.trackTip"), { delay: 300 });   // what a click does, the same words as the menu
  }

  /**
   * ★ with your rating beside it: hovering opens 1–5 stars, and a click (or Enter) keeps them open until you pick
   * one or click elsewhere. Rating a plugin tracks it. `run` applies a rating (a row keeps its place; the details
   * window passes its own).
   */
  renderRating(actions, p, note, run = (fn) => this.runRowAction(p, fn)) {
    const box = actions.createDiv({ cls: `pdt-rate${note?.rating ? " is-rated" : ""}`, attr: { role: "button", tabindex: "0", "aria-haspopup": "true", "aria-label": t("rating.set") } });
    box.onclick = (event) => { if (!event.target.closest(".pdt-rate-pop")) toggleRating(box); };
    onActivate(box, () => toggleRating(box));
    setIcon(box.createSpan({ cls: "pdt-rate-icon" }), "star");
    if (note?.rating) box.createSpan({ cls: "pdt-rate-value", text: String(note.rating) });
    const pop = box.createDiv({ cls: "pdt-rate-pop" });
    ratingButtons(pop, note?.rating || 0, (n) => run(() => this.plugin.setNoteField(p, "rating", n)));
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
      const chip = parent.createSpan({ cls: `pdt-pill is-rating${note.rating ? "" : " is-empty"}`, text: note.rating ? ratingStars(note.rating) : t("rating.set"), attr: { role: "button", tabindex: "0", "aria-label": note.rating ? t("rating.label", { n: note.rating }) : t("rating.set") } });
      const open = () => toggleRating(chip.closest("[data-id]")?.querySelector(".pdt-rate"), true);   // the row's own ★
      chip.onclick = open;
      onActivate(chip, open);
    }
  }

  /** A menu under `anchor` (see showMenuBelow); the list is redrawn after the pick. */
  pickFromMenu(anchor, options, current, onPick) {
    showMenuBelow(anchor, options, current, async (value) => {
      await onPick(value);
      this.view.refresh();
    });
  }
}

/**
 * Opens or closes a ★'s 1–5 stars (`open` forces it). Open, it stays until a click outside it or Esc; a pick
 * redraws the row, which closes it.
 */
function toggleRating(box, open = !box?.hasClass("is-open")) {
  if (!box) return;
  box.toggleClass("is-open", open);
  if (!open) return;
  const doc = box.ownerDocument;
  const close = (event) => {
    if (event.type === "keydown" ? event.key !== "Escape" : box.contains(event.target)) return;
    box.removeClass("is-open");
    doc.removeEventListener("pointerdown", close, true);
    doc.removeEventListener("keydown", close, true);
  };
  doc.addEventListener("pointerdown", close, true);
  doc.addEventListener("keydown", close, true);
}

/** The 1–5 stars, then Clear when rated, into `pop`; `pick(n)` applies one (null clears). */
function ratingButtons(pop, rating, pick) {
  pop.setAttribute("role", "group");
  pop.setAttribute("aria-label", t("rating.set"));
  const stars = pop.createDiv({ cls: "pdt-rate-stars" });   // laid out in reverse so hovering fills a star and those before it
  for (let n = 5; n >= 1; n--) {
    const button = stars.createEl("button", { cls: `pdt-rate-star${rating >= n ? " is-on" : ""}`, text: "★", attr: { type: "button", "aria-label": t("rating.label", { n }) } });
    button.onclick = () => pick(n);
  }
  if (rating) pop.createEl("button", { cls: "pdt-rate-clear", text: t("rating.clear"), attr: { type: "button" } }).onclick = () => pick(null);
}

// The one floating set of stars a menu's Rate shows (see RowRenderer.rateItem): {el, pinned, timer, close}
const ratingFloat = { el: null, pinned: false, timer: 0, close: null };

/**
 * Shows the stars beside `rect` (on the right; on the left when there's no room), once; `pin` keeps them until a
 * pick, a click elsewhere or Esc.
 */
function showRatingFloat(rect, rating, pick, pin) {
  clearTimeout(ratingFloat.timer);
  if (!ratingFloat.el) {
    const doc = globalThis.activeDocument ?? document;   // Obsidian's: the window the menu is in
    const el = doc.body.createDiv({ cls: "pdt-rate-pop pdt-rate-float" });
    ratingButtons(el, rating, (n) => { closeRatingFloat(true); pick(n); });
    const room = rect.right + 4 + el.offsetWidth <= doc.documentElement.clientWidth;
    el.setCssProps({ "--pdt-x": `${room ? rect.right + 4 : Math.max(4, rect.left - el.offsetWidth - 4)}px`, "--pdt-y": `${rect.top}px` });
    el.addEventListener("mouseenter", () => clearTimeout(ratingFloat.timer));
    el.addEventListener("mouseleave", () => leaveRatingFloat());
    const outside = (event) => {
      if (event.type === "keydown" ? event.key !== "Escape" : el.contains(event.target)) return;
      closeRatingFloat(true);
    };
    doc.addEventListener("pointerdown", outside, true);
    doc.addEventListener("keydown", outside, true);
    ratingFloat.close = () => { doc.removeEventListener("pointerdown", outside, true); doc.removeEventListener("keydown", outside, true); };
    ratingFloat.el = el;
  }
  if (pin) ratingFloat.pinned = true;
}

/** The pointer left the item or the stars: unpinned stars go a moment later (time to cross the gap between them). */
function leaveRatingFloat() {
  clearTimeout(ratingFloat.timer);
  ratingFloat.timer = setTimeout(() => closeRatingFloat(), 250);
}

/** Takes the floating stars away; pinned ones only when `force`d (a pick, a click elsewhere, Esc). */
function closeRatingFloat(force = false) {
  if (!ratingFloat.el || (ratingFloat.pinned && !force)) return;
  ratingFloat.close();
  ratingFloat.el.remove();
  Object.assign(ratingFloat, { el: null, pinned: false, close: null });
}
