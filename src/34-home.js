// ─── 4d. Home page ─────────────────────────────────────────────────────────
/**
 * The home page of the view: "since your last visit" cards and widgets (see HOME_WIDGETS). A card or widget
 * opens the list with its plugins; its "N new" button opens only the new ones. Widgets are set in place: the
 * value chip and ⋮ change their settings, the grip reorders them, the page's ⋮ shows or adds them.
 */
class HomePage {
  constructor(view) {
    this.view = view;
  }

  get plugin() {
    return this.view.plugin;
  }

  get home() {
    return this.view.settings.home;
  }

  context(now) {
    return { state: this.plugin.state(), timeline: this.plugin.timeline, settings: this.view.settings, now };
  }

  async save(change) {
    change?.(this.home);
    await this.plugin.saveData(this.plugin.data);
    this.view.render();
  }

  /** Sync and the page's ⋮ go next to the section switch. */
  renderTools(bar) {
    const sync = bar.createEl("button", { cls: "pdt-home-tool", text: t("set.syncNow"), attr: { type: "button" } });
    sync.onclick = () => this.plugin.refresh();
    const more = bar.createEl("button", { cls: "pdt-home-tool is-icon", attr: { type: "button", "aria-label": t("home.menu") } });
    setIcon(more, "more-vertical");
    more.onclick = (event) => this.pageMenu(event);
  }

  render(root) {
    const page = root.createDiv({ cls: `pdt-home${this.home.motion ? "" : " is-still"}` });
    if (!this.plugin.catalog) {
      page.createDiv({ cls: "pdt-empty", text: this.plugin.busy ? t("status.syncing") : t("status.loading") });
      return;
    }
    const now = Date.now();
    const ctx = this.context(now);
    if (this.home.since.show) this.renderSince(page, ctx);
    this.renderWidgets(page, ctx);
  }

  /**
   * Opens a widget's list with its new plugins marked; from then on they count as seen (with "Not seen yet"; a
   * saved view always remembers what you saw).
   */
  openList(ctx, id, params, rows, then, onlyNew = false) {
    if (id === "tracked") return this.view.openTracked(UPDATES);
    const widget = homeWidget(this.home, id);
    const fresh = new Set((freshRows(ctx, widget, params, rows, then) || []).map((p) => p.id));
    const seen = widget.view ? seenIds(rows) : this.home.since.period === "seen" && seenUpTo(ctx, id, params, rows, then);
    if (seen) {
      this.home.seen = { ...this.home.seen, [id]: seen };
      this.plugin.saveData(this.plugin.data);
    }
    return this.view.openPreset(id, params, fresh, onlyNew);
  }

  /** A saved view from the strip: its list, the way its widget opens it (what's new marked, then seen). */
  openView(id) {
    const ctx = this.context(Date.now());
    const widget = homeWidget(this.home, id);
    if (!widget) return null;
    return this.openList(ctx, id, {}, widget.rows(ctx, {}), sinceMoment(this.home, id, ctx.now));
  }

  /** A saved view's query changed in its list: Save puts it in the view. */
  async updateView(id, query) {
    await this.save((h) => { h.views = h.views.map((v) => (VIEW_PREFIX + v.id === id ? { ...v, query } : v)); });
  }

  /** A widget's title: yours for a saved view. */
  title(id) {
    return homeWidget(this.home, id).view?.name ?? t(`home.${id}`);
  }

  /** Saves a query as a view: a tab in the strip and a widget on the home page, its matches so far seen. */
  async saveView(name, query, rows) {
    const view = { id: Date.now().toString(36), name, query };
    const id = VIEW_PREFIX + view.id;
    await this.save((h) => {
      h.views = [...(h.views || []), view];
      h.order = [...h.order, id];
      h.seen = { ...h.seen, [id]: seenIds(rows) };
    });
    return view;
  }

  /** "Not seen yet": one card per widget, counting what came in after you last opened its list. */
  renderSince(page, ctx) {
    const section = page.createDiv({ cls: "pdt-home-section" });
    const head = section.createDiv({ cls: "pdt-home-head" });
    const period = this.home.since.period;
    head.createEl("h2", { text: period === "seen" ? t("home.since") : t("home.sinceTitle", { n: period }) });
    const chip = head.createEl("button", { cls: "pdt-home-chip", text: `${this.sinceLabel(period)} ▾`, attr: { type: "button" } });
    chip.onclick = (event) => this.choose(event, SINCE_PERIODS.map((p) => [p, this.sinceLabel(p)]), period, (p) => this.save((h) => { h.since.period = p; }));
    chip.setText(`${t("home.period")} ▾`);

    const grid = section.createDiv({ cls: "pdt-home-since" });
    this.home.since.order.forEach((id, i) => {
      const tracked = id === "tracked";
      const then = sinceMoment(this.home, id, ctx.now);
      const params = { ...widgetParams(this.home, id), since: then };
      // tracked: "not seen" is what you haven't reviewed; a period counts the releases in it
      const reviewBased = tracked && period === "seen";
      const rows = reviewBased ? [] : tracked
        ? tabRows(ctx, "tracked", { trackedGroup: "", trackedStatus: "" }).filter((p) => (p.updated || 0) > then)
        : HOME_WIDGETS[id].rows(ctx, params);   // the since cards are built-in widgets
      const n = reviewBased ? this.plugin.updatesCount(ctx.state, ctx.now) : rows.length;
      const done = n === 0 && period === "seen";
      const open = tracked && !reviewBased ? () => this.view.openTracked("") : () => this.openList(ctx, id, params, rows, then);
      const card = this.card(grid, `pdt-home-mini is-${HOME_WIDGETS[id].tone}${n === 0 ? " is-done" : ""}`, i, open);
      card.dataset.id = id;
      this.grip(card);
      setIcon(card.createSpan({ cls: "pdt-home-mini-icon" }), HOME_WIDGETS[id].icon);
      card.createSpan({ cls: "pdt-home-mini-n", text: done ? "✓" : formatCount(n) });
      this.info(card, t(tracked && !reviewBased ? "home.since.tracked.infoDays" : `home.since.${id}.info`, { when: this.sinceLabel(period), n: stepLabel(params.n ?? 0) }));
      card.createSpan({ cls: "pdt-home-mini-label", text: t(`home.since.${id}`, { n: stepLabel(params.n ?? 0) }) });
      card.createSpan({ cls: "pdt-home-cta", text: t("home.list") });
    });
    this.sortable(grid, (order) => this.save((h) => { h.since.order = order; }));
  }

  renderWidgets(page, ctx) {
    const section = page.createDiv({ cls: "pdt-home-section" });
    section.createDiv({ cls: "pdt-home-head" }).createEl("h2", { text: t("home.discover") });
    const grid = section.createDiv({ cls: "pdt-home-grid" });
    const shown = this.home.order.filter((id) => !this.home.hidden.includes(id) && homeWidget(this.home, id));
    shown.forEach((id, i) => this.renderWidget(grid, ctx, id, i));
    // a small "+" card: hidden widgets and views come back here
    const add = this.card(grid, "pdt-home-add", shown.length, () => {});
    add.onclick = (event) => this.addMenu(event);
    setIcon(add.createSpan({ cls: "pdt-home-add-icon" }), "plus");
    add.createSpan({ cls: "pdt-home-add-title", text: t("home.addWidget") });
    add.createSpan({ cls: "pdt-home-add-hint", text: t("home.addHint") });
    this.sortable(grid, (order) => this.save((h) => { order = order.filter(Boolean); h.order = [...order, ...h.order.filter((id) => !order.includes(id))]; }));
  }

  renderWidget(grid, ctx, id, index) {
    const widget = homeWidget(this.home, id);
    const params = widgetParams(this.home, id);
    const then = sinceMoment(this.home, id, ctx.now);
    const { rows, fresh, headline } = widgetResult(ctx, widget, params, then);
    const open = (onlyNew) => this.openList(ctx, id, params, rows, then, onlyNew);
    const card = this.card(grid, `pdt-home-card is-${widget.tone}`, index, () => open(false));
    card.dataset.id = id;
    this.grip(card);

    const head = card.createDiv({ cls: "pdt-home-card-head" });
    setIcon(head.createSpan({ cls: "pdt-home-icon" }), widget.icon);
    head.createSpan({ cls: "pdt-home-title", text: this.title(id) });
    const info = widget.view ? this.viewInfo(widget.view) : t(widget.info?.(params) || `home.${id}.info`, this.paramWords(id, params));
    this.info(head, info);
    head.createSpan({ cls: "pdt-home-spacer" });
    const more = head.createEl("button", { cls: "pdt-home-more", attr: { type: "button", "aria-label": t("home.widgetMenu") } });
    setIcon(more, "more-vertical");
    more.onclick = (event) => { event.stopPropagation(); this.widgetMenu(event, id); };
    if (this.home.info) card.createDiv({ cls: "pdt-home-info-text", text: info });

    const metric = card.createDiv({ cls: "pdt-home-metric" });
    const left = metric.createDiv({ cls: "pdt-home-figure" });
    const line = left.createDiv({ cls: "pdt-home-line" });
    line.createSpan({ cls: "pdt-home-n", text: headline });
    if (fresh?.length) {
      const badge = line.createEl("button", { cls: "pdt-home-fresh", attr: { type: "button" } });
      badge.createSpan({ text: t("home.fresh", { n: formatCount(fresh.length), when: this.sinceLabel(widget.view ? "seen" : this.home.since.period) }) });
      setIcon(badge.createSpan({ cls: "pdt-home-fresh-go" }), "arrow-up-right");
      setTooltip(badge, t("home.freshTip", { n: formatCount(fresh.length) }), { delay: 150 });
      badge.onclick = (event) => { event.stopPropagation(); open(true); };
    }
    const unit = widget.view ? t("home.view.unitQuery") : t(widget.unit?.(params) || `home.${id}.unit`, this.paramWords(id, params));
    left.createSpan({ cls: "pdt-home-unit", text: unit });
    const key = Object.keys(widget.params)[0];
    if (key) {
      const chip = metric.createEl("button", { cls: "pdt-home-chip", text: `${this.paramText(key, params[key])} ▾`, attr: { type: "button" } });
      chip.onclick = (event) => {
        event.stopPropagation();
        this.choose(event, paramOptions(ctx, id, key).map((v) => [v, this.paramText(key, v)]), params[key], (v) => this.setParam(id, key, v));
      };
    }

    const preview = card.createDiv({ cls: "pdt-home-top" });
    const freshIds = new Set((fresh || []).map((p) => p.id));
    for (const p of rows.slice(0, this.home.preview)) {
      const item = preview.createDiv({ cls: `pdt-home-item${freshIds.has(p.id) ? " is-fresh" : ""}` });
      item.createSpan({ cls: "pdt-home-item-name", text: p.name });
      item.createSpan({ cls: "pdt-home-item-value", text: widget.value(ctx, p, params) });
    }
    if (!rows.length) preview.createDiv({ cls: "pdt-home-item is-empty", text: t(id === "tracked" ? "home.tracked.empty" : "home.none") });
    card.createSpan({ cls: "pdt-home-cta", text: t("home.open") });
  }

  /** A clickable card (keyboard too) that rises in after the ones before it. */
  card(grid, cls, index, onOpen) {
    const card = grid.createDiv({ cls: `${cls} is-in`, attr: { role: "link", tabindex: "0" } });
    card.style.setProperty("--pdt-i", String(index));
    card.onclick = (event) => { if (!event.target.closest("button, .pdt-grip")) onOpen(); };
    onActivate(card, onOpen);
    return card;
  }

  grip(card) {
    setIcon(card.createSpan({ cls: "pdt-grip", attr: { "aria-hidden": "true" } }), "grip-horizontal");
  }

  info(parent, text) {
    const icon = parent.createSpan({ cls: "pdt-home-info", attr: { "aria-label": text, tabindex: "0" } });
    setIcon(icon, "info");
    setTooltip(icon, text, { delay: 100 });
  }

  /** Drag by the grip to reorder; the new order of `data-id`s is saved. */
  sortable(grid, onOrder) {
    if (typeof Sortable === "undefined" || !grid.children.length) return;
    Sortable.create(grid, {
      handle: ".pdt-grip",
      filter: ".pdt-home-add",
      animation: this.home.motion ? 180 : 0,
      ghostClass: "is-ghost",
      onEnd: () => onOrder([...grid.children].map((el) => el.dataset.id)),
    });
  }

  sinceLabel(period) {
    return period === "seen" ? t("home.sinceSeen") : t("home.sinceDays", { n: period });
  }

  paramText(key, value) {
    if (key === "n") return stepLabel(value);
    if (key === "by") return t(`home.by.${value}`);
    if (key === "gap") return `≥ ${t("filter.days", { n: value })}`;
    return t("filter.days", { n: value });
  }

  /** A widget's settings as words for its info and unit lines. */
  paramWords(id, params) {
    return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, k === "n" ? stepLabel(v) : v]));
  }

  setParam(id, key, value) {
    return this.save((h) => { h.params = { ...h.params, [id]: { ...h.params?.[id], [key]: value } }; });
  }

  /** A small menu of options under the chip that opened it. */
  choose(event, options, current, onPick) {
    const menu = new Menu();
    for (const [value, text] of options) menu.addItem((item) => item.setTitle(text).setChecked(value === current).onClick(() => onPick(value)));
    menu.showAtMouseEvent(event);
  }

  /** What a saved view shows: its query. */
  viewInfo(view) {
    return `${t("home.view.infoQuery")}\n${view.query}`;
  }

  /** ⋮ of a widget: every setting, then Hide and Reset; a saved view: Rename, Hide, Delete. */
  widgetMenu(event, id) {
    const ctx = this.context(Date.now());
    const params = widgetParams(this.home, id);
    const widget = homeWidget(this.home, id);
    const menu = new Menu();
    if (widget.view) {
      menu.addItem((item) => item.setTitle(t("home.view.rename")).setIcon("pencil").onClick(async () => {
        const name = await new TextModal(this.plugin.app, { title: t("home.view.rename"), value: widget.view.name, cta: t("home.view.save") }).ask();
        if (name) await this.save((h) => { h.views = h.views.map((v) => (v.id === widget.view.id ? { ...v, name } : v)); });
      }));
      menu.addItem((item) => item.setTitle(t("home.hide")).setIcon("eye-off").onClick(() => this.save((h) => { h.hidden = [...h.hidden, id]; })));
      menu.addItem((item) => item.setTitle(t("home.view.delete")).setIcon("trash").onClick(() => this.save((h) => {
        h.views = h.views.filter((v) => v.id !== widget.view.id);
        h.order = h.order.filter((x) => x !== id);
        h.hidden = h.hidden.filter((x) => x !== id);
        delete h.seen?.[id];
      })));
      menu.showAtMouseEvent(event);
      return;
    }
    for (const key of Object.keys(widget.params)) {
      menu.addItem((item) => item.setTitle(t(`home.param.${key}`)).setDisabled(true));
      for (const v of paramOptions(ctx, id, key)) {
        menu.addItem((item) => item.setTitle(this.paramText(key, v)).setChecked(params[key] === v).onClick(() => this.setParam(id, key, v)));
      }
      menu.addSeparator();
    }
    menu.addItem((item) => item.setTitle(t("home.hide")).setIcon("eye-off").onClick(() => this.save((h) => { h.hidden = [...h.hidden, id]; })));
    menu.addItem((item) => item.setTitle(t("home.reset")).setIcon("rotate-ccw").onClick(() => this.save((h) => { delete h.params?.[id]; })));
    menu.showAtMouseEvent(event);
  }

  /** The "+" card: the hidden widgets to bring back. */
  addMenu(event) {
    const menu = new Menu();
    const hidden = this.home.hidden.filter((id) => homeWidget(this.home, id));
    for (const id of hidden) {
      menu.addItem((item) => item.setTitle(this.title(id)).setIcon(homeWidget(this.home, id).icon).onClick(() => this.save((h) => { h.hidden = h.hidden.filter((x) => x !== id); })));
    }
    if (!hidden.length) menu.addItem((item) => item.setTitle(t("home.allShown")).setDisabled(true));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t("home.view.how")).setIcon("bookmark-plus").setDisabled(true));
    menu.showAtMouseEvent(event);
  }

  /** ⋮ of the page: what shows, hidden widgets back, motion, the screen the view opens on. */
  pageMenu(event) {
    const home = this.home;
    const menu = new Menu();
    const toggle = (title, on, flip) => menu.addItem((item) => item.setTitle(title).setChecked(on).onClick(() => this.save(flip)));
    toggle(t("home.showSince"), home.since.show, (h) => { h.since.show = !h.since.show; });
    toggle(t("home.showInfo"), home.info, (h) => { h.info = !h.info; });
    toggle(t("home.motion"), home.motion, (h) => { h.motion = !h.motion; });
    menu.addItem((item) => item.setTitle(t("bulk.recent")).setIcon("history").onClick(() => this.view.openRecent()));
    menu.addSeparator();
    for (const id of home.hidden.filter((x) => homeWidget(home, x))) {
      menu.addItem((item) => item.setTitle(t("home.add", { name: this.title(id) })).setIcon("plus").onClick(() => this.save((h) => { h.hidden = h.hidden.filter((x) => x !== id); })));
    }
    menu.addItem((item) => item.setTitle(t("home.start", { where: t(this.view.settings.start === "home" ? "home.startHome" : "home.startLast") }))
      .onClick(() => this.view.update("start", this.view.settings.start === "home" ? "last" : "home")));
    menu.showAtMouseEvent(event);
  }
}
