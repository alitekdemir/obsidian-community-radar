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
   * the last header opens the column picker. Favorite and Rating cells change on click; a row opens its details.
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
      const box = tr.createEl("td", { cls: "pdt-table-pick" }).createEl("input", { type: "checkbox", cls: "pdt-select", attr: { "aria-label": t("bulk.pick", { name: p.name }) } });
      box.checked = this.view.selected.has(p.id);
      box.onclick = (event) => { event.stopPropagation(); this.view.bulkBar.pick(p, box.checked, event.shiftKey); };
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
    row.addEventListener("click", (event) => {
      this.view.setCursor(row);
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
    const desc = body.createEl("p", { cls: "pdt-desc", text: p.description || "–", attr: { role: "button", tabindex: "0" } });
    setTooltip(desc, t("details.open"));
    desc.onclick = () => this.openDetails(p);
    onActivate(desc, () => this.openDetails(p));
    const translation = plugin.cachedTranslation(p);
    const showing = translation != null && this.view.shownTranslations.has(p.id);
    if (showing) body.createDiv({ cls: "pdt-trans", text: translation });
    const info = this.view.similar && this.view.similarInfo?.get(p.id);
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
    setTooltip(link("pdt-readme pdt-similar-link", t("row.similar"), "arrow-right", () => this.view.similarFilter.open(p)), t("row.similarTip"));
    if (p.description) {
      link("pdt-readme pdt-tr", showing ? t("translate.hide") : t("translate.row"), "languages", async () => {
        if (showing) this.view.shownTranslations.delete(p.id);
        else if (translation != null || (await plugin.translateRows([p]))) this.view.shownTranslations.add(p.id);
        this.view.refresh();
      });
    }

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
      this.view.refresh();
    });
  }
}
