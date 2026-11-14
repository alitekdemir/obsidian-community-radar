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
      suggest.lists = await this.plugin.groupSuggestions(ids.map((id) => this.plugin.pluginById(id)).filter(Boolean));
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

  /** The bottom of the list: the last action's result (with Undo), then the bar for what's picked. */
  renderBulk() {
    const footer = this.view.refs.bulk;
    if (!footer) return;
    footer.empty();
    if (this.view.toast) {
      const toast = footer.createDiv({ cls: "pdt-toast", attr: { role: "status" } });
      setIcon(toast.createSpan({ cls: "pdt-toast-icon" }), this.view.toast.op ? "check" : "rotate-ccw");
      toast.createSpan({ text: this.view.toast.text });
      if (this.view.toast.op?.changes.length) {
        toast.createEl("button", { cls: "pdt-toast-undo", text: t("bulk.undo") }).onclick = () => this.undoOp(this.view.toast.op);
      }
      smallButton(toast, "x", t("bulk.close"), () => { this.view.toast = null; this.renderBulk(); });
    }
    if (!this.view.selected.size || !this.selectable) return;
    const bar = footer.createDiv({ cls: "pdt-bulk-bar", attr: { role: "toolbar", "aria-label": t("bulk.toolbar") } });
    bar.createEl("b", { text: t("bulk.selected", { n: this.view.selected.size }) });
    // like Gmail: first the rows on screen, then every row of the list, the ones not shown yet included
    const visible = this.view.rows.slice(0, this.view.visible);
    const pickAll = (rows) => () => { for (const p of rows) this.view.selected.add(p.id); this.syncSelection(); };
    if (visible.some((p) => !this.view.selected.has(p.id))) {
      bar.createEl("button", { cls: "pdt-bulk-link", text: t("bulk.selectShown", { n: visible.length }) }).onclick = pickAll(visible);
    } else if (this.view.rows.length > visible.length && this.view.selected.size < this.view.rows.length) {
      bar.createEl("button", { cls: "pdt-bulk-link", text: t("bulk.selectAll", { n: formatCount(this.view.rows.length) }) }).onclick = pickAll(this.view.rows);
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
        const group = name ?? await new TextModal(this.app, { title: t("bulk.newGroup"), cta: t("bulk.go.group", { n: this.view.selected.size }) }).ask();
        if (group) this.runBulk("group", group);
      }));
    action("sparkles", t("bulk.suggest", { n: Math.min(this.view.selected.size, AI_BATCH) }), () => this.suggestGroups());
    if (this.settings.mode === "tracked") action("check-check", t("bulk.reviewed"), () => this.runBulk("reviewed"));
    action("eye-off", t("bulk.snooze"), () => this.runBulk("snooze"));
    action("ban", t("bulk.exclude"), () => this.runBulk("exclude"));
    bar.createDiv({ cls: "pdt-nav-spacer" });
    bar.createEl("button", { cls: "pdt-bulk-link", text: t("bulk.clear") }).onclick = () => { this.clearSelection(); this.syncSelection(); };
  }

  /** Asks, runs the action on what's picked, then shows what it did with Undo. */
  async runBulk(kind, value = null) {
    const plugins = [...this.view.selected].map((id) => this.plugin.pluginById(id)).filter(Boolean);
    const vars = { n: plugins.length, value: kind === "rating" ? "★".repeat(value) : value };
    const ok = await this.confirm({ title: t(`bulk.ask.${kind}`, vars), plugins, text: t(`bulk.what.${kind}`), cta: t(`bulk.go.${kind}`, vars) });
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
