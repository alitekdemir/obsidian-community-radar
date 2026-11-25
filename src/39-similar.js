// ─── SimilarFilter ─────────────────────────────────────────────────────
/**
 * The Similar filter: the All list narrowed to one plugin's closest matches, step by step (‹ back), ✕ to where you
 * were. Works on the view's state (see ViewPart).
 */
class SimilarFilter extends ViewPart {
  count() {
    return this.rows(false).length;
  }

  /**
   * The Similar filter's plugins: the matches of the last step filtered through `matchRows` (SSOT for All's Downloads ≥,
   * extra filters, hidden lists and the filter's own search), sorted as chosen.
   */
  rows(searched = true, precomputed = null) {
    const seed = this.plugin.pluginById(this.view.similar.steps.at(-1).id);
    const found = precomputed ?? (seed ? this.plugin.similarTo(seed) : []);
    const state = this.plugin.state();
    const now = Date.now();
    // ignore All's Query mode and saved pageQuery so Similar applies All's Basic filters + its own search
    const opts = { ...modeOptions({ ...this.settings, queries: {}, pageQueries: {} }, "all"), query: searched ? this.view.similar.query : "" };
    const { rows } = matchRows({ ...state, catalog: found.map((x) => x.p) }, opts, now);
    const { key, dir } = this.settings.similarSort;
    return key === "relevance" ? (dir === "asc" ? [...rows].reverse() : rows) : sortRows(rows, key, dir, state, now);
  }

  /** The Similar filter as one chip: ‹ back (when there is a step), ≈ Similar: name (opens its details), ✕. */
  renderChip(bar) {
    const { steps } = this.view.similar;
    const seed = this.plugin.pluginById(steps.at(-1).id);
    const chip = bar.createDiv({ cls: "pdt-chip pdt-similar-chip" });
    if (steps.length > 1) {
      smallButton(chip, "chevron-left", t("similar.backTo", { name: this.plugin.pluginById(steps.at(-2).id)?.name ?? "–" }), () => this.back());
    }
    chip.createSpan({ cls: "pdt-similar-sign", text: "≈" });
    chip.createSpan({ text: t("similar.chip") });
    const name = chip.createEl("a", { cls: "pdt-chip-value", text: seed?.name ?? "–", href: "#" });
    setTooltip(name, t("details.open"));
    name.onclick = (event) => { event.preventDefault(); if (seed) this.view.rowRenderer.openDetails(seed); };
    smallButton(chip, "x", t("similar.closeFilter"), () => this.close());
  }

  /**
   * Turns the Similar filter on for `p`, or steps to `p` inside it (back to it, if it is an earlier step).
   * The All tab stays (or becomes) active; ✕ brings back the tab, filters and scroll of before.
   */
  open(p) {
    const scroll = this.view.contentEl.scrollTop;
    if (!this.view.similar) {
      this.view.similar = {
        steps: [],
        before: {
          section: this.settings.section, preset: this.view.preset, mode: this.settings.mode,
          scroll, visible: this.view.visible, originId: p.id,
          originIndex: (this.view.rows || []).findIndex((r) => r.id === p.id),
        },
        query: "",
      };
    } else this.view.similar.steps.at(-1).scroll = scroll;
    const steps = this.view.similar.steps;
    const at = steps.findIndex((step) => step.id === p.id);
    if (at !== -1) steps.splice(at + 1);
    else steps.push({ id: p.id, scroll: 0 });
    if (steps.length > SIMILAR_STEPS) steps.splice(0, steps.length - SIMILAR_STEPS);
    this.view.similar.query = "";
    this.view.bulkBar.clearSelection();
    Object.assign(this.view, { filtersOpen: false, visible: PAGE_SIZE, preset: null });
    this.settings.section = "list";
    this.settings.mode = "all";   // shown, not saved: ✕ goes back to the tab/section you came from
    this.view.render();
    this.view.contentEl.scrollTop = steps.at(-1).scroll;
  }

  /** ‹: the previous plugin's matches, with the scroll position they had. */
  back() {
    const steps = this.view.similar?.steps;
    if (!steps || steps.length < 2) return;
    steps.pop();
    this.view.similar.query = "";
    this.view.bulkBar.clearSelection();
    this.view.render();
    this.view.contentEl.scrollTop = steps.at(-1).scroll;
  }

  /** ✕ / Esc: the tab, filters and scroll of before, and the row you started from, highlighted for a moment. */
  close() {
    if (!this.view.similar) return;
    const { before } = this.view.similar;
    this.view.similar = null;
    this.settings.section = before.section;
    this.view.preset = before.preset;
    this.settings.mode = before.mode;
    this.view.visible = before.visible;
    this.view.bulkBar.clearSelection();
    this.view.render();
    this.view.contentEl.scrollTop = before.scroll;
    const rows = [...this.view.contentEl.querySelectorAll(".pdt-row, .pdt-trow")];
    // the row itself, or the one now in its place if an action took it out of the list
    const row = rows.find((r) => r.dataset.id === before.originId) || rows[Math.min(Math.max(before.originIndex, 0), rows.length - 1)];
    if (!row) return;
    this.view.setCursor(row);
    row.addClass("is-flash");
    setTimeout(() => row.removeClass("is-flash"), 1500);
    row.focus?.({ preventScroll: true });
  }

  /** The Similar filter's rows, each with why it matches, in pages like any list. */
  renderList(list, now) {
    const seed = this.plugin.pluginById(this.view.similar.steps.at(-1).id);
    const found = seed ? this.plugin.similarTo(seed) : [];
    this.view.stale = new Set();
    this.view.similarInfo = new Map(found.map((x) => [x.p.id, x]));
    this.view.rows = this.rows(true, found);
    if (!this.view.rows.length) {
      const empty = list.createDiv({ cls: "pdt-empty", text: t(found.length ? "list.empty" : "similar.none") });
      if (changedFilters(this.view.filterBar.filterState(), "all") > 0) this.view.filterBar.renderClearFilters(empty.createDiv());
      return;
    }
    for (const p of this.view.rows.slice(0, this.view.visible)) this.view.rowRenderer.renderRow(list, p, now);
    this.view.rowRenderer.renderMore(list);
  }
}
