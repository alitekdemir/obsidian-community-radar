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
    const lastVisit = this.plugin.lastVisit;
    if (lastVisit) bar.createSpan({ cls: "pdt-home-visit", text: t("home.lastVisit", { when: relativeDays(lastVisit, Date.now()) }) });
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
    const then = sinceMoment(this.home.since.period, this.plugin.lastVisit, now);
    if (this.home.since.show) this.renderSince(page, ctx, then);
    this.renderWidgets(page, ctx, then);
  }

  /** "Since your last visit": one card per widget, counting what came in after `then`. */
  renderSince(page, ctx, then) {
    const section = page.createDiv({ cls: "pdt-home-section" });
    const head = section.createDiv({ cls: "pdt-home-head" });
    const period = this.home.since.period;
    head.createEl("h2", { text: period === "visit" ? t("home.since") : t("home.sinceTitle", { n: period }) });
    const chip = head.createEl("button", { cls: "pdt-home-chip", text: `${this.sinceLabel(period)} ▾`, attr: { type: "button" } });
    chip.onclick = (event) => this.choose(event, SINCE_PERIODS.map((p) => [p, this.sinceLabel(p)]), period, (p) => this.save((h) => { h.since.period = p; }));
    chip.setText(`${t("home.period")} ▾`);

    const grid = section.createDiv({ cls: "pdt-home-since" });
    this.home.since.order.forEach((id, i) => {
      const tracked = id === "tracked";
      const params = { ...widgetParams(this.home, id), since: then };
      const n = tracked ? this.plugin.updatesCount(ctx.state, ctx.now) : HOME_WIDGETS[id].rows(ctx, params).length;
      const card = this.card(grid, `pdt-home-mini is-${HOME_WIDGETS[id].tone}`, i, () => (tracked ? this.view.openTracked(UPDATES) : this.view.openPreset(id, params)));
      card.dataset.id = id;
      this.grip(card);
      setIcon(card.createSpan({ cls: "pdt-home-mini-icon" }), HOME_WIDGETS[id].icon);
      card.createSpan({ cls: "pdt-home-mini-n", text: formatCount(n) });
      this.info(card, t(`home.since.${id}.info`, { when: this.sinceLabel(period), n: formatShort(params.n ?? 0) }));
      card.createSpan({ cls: "pdt-home-mini-label", text: t(`home.since.${id}`, { n: formatShort(params.n ?? 0) }) });
      card.createSpan({ cls: "pdt-home-cta", text: t("home.list") });
    });
    this.sortable(grid, (order) => this.save((h) => { h.since.order = order; }));
  }

  renderWidgets(page, ctx, then) {
    const section = page.createDiv({ cls: "pdt-home-section" });
    section.createDiv({ cls: "pdt-home-head" }).createEl("h2", { text: t("home.discover") });
    const grid = section.createDiv({ cls: "pdt-home-grid" });
    const shown = this.home.order.filter((id) => !this.home.hidden.includes(id));
    shown.forEach((id, i) => this.renderWidget(grid, ctx, id, then, i));
    // a small "+" card: hidden widgets come back here (your own filters will too)
    const add = this.card(grid, "pdt-home-add", shown.length, () => {});
    add.onclick = (event) => this.addMenu(event);
    setIcon(add.createSpan({ cls: "pdt-home-add-icon" }), "plus");
    add.createSpan({ cls: "pdt-home-add-title", text: t("home.addWidget") });
    add.createSpan({ cls: "pdt-home-add-hint", text: t("home.addHint") });
    this.sortable(grid, (order) => this.save((h) => { order = order.filter(Boolean); h.order = [...order, ...h.order.filter((id) => !order.includes(id))]; }));
  }

  renderWidget(grid, ctx, id, then, index) {
    const widget = HOME_WIDGETS[id];
    const params = widgetParams(this.home, id);
    const { rows, fresh, headline } = widgetResult(ctx, id, params, then);
    const open = (onlyNew) => (id === "tracked" ? this.view.openTracked(UPDATES) : this.view.openPreset(id, params, onlyNew));
    const card = this.card(grid, `pdt-home-card is-${widget.tone}`, index, () => open(null));
    card.dataset.id = id;
    this.grip(card);

    const head = card.createDiv({ cls: "pdt-home-card-head" });
    setIcon(head.createSpan({ cls: "pdt-home-icon" }), widget.icon);
    head.createSpan({ cls: "pdt-home-title", text: t(`home.${id}`) });
    const info = t(widget.info?.(params) || `home.${id}.info`, this.paramWords(id, params));
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
      badge.createSpan({ text: t("home.fresh", { n: formatCount(fresh.length), when: this.sinceLabel(this.home.since.period) }) });
      setIcon(badge.createSpan({ cls: "pdt-home-fresh-go" }), "arrow-up-right");
      setTooltip(badge, t("home.freshTip", { n: formatCount(fresh.length) }), { delay: 150 });
      badge.onclick = (event) => { event.stopPropagation(); open(then); };
    }
    left.createSpan({ cls: "pdt-home-unit", text: t(widget.unit?.(params) || `home.${id}.unit`, this.paramWords(id, params)) });
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
    return period === "visit" ? t("home.sinceVisit") : t("home.sinceDays", { n: period });
  }

  paramText(key, value) {
    if (key === "n") return formatShort(value);
    if (key === "by") return t(`home.by.${value}`);
    if (key === "gap") return `≥ ${t("filter.days", { n: value })}`;
    return t("filter.days", { n: value });
  }

  /** A widget's settings as words for its info and unit lines. */
  paramWords(id, params) {
    return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, k === "n" ? formatShort(v) : v]));
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

  /** ⋮ of a widget: every setting, then Hide and Reset. */
  widgetMenu(event, id) {
    const ctx = this.context(Date.now());
    const params = widgetParams(this.home, id);
    const menu = new Menu();
    for (const key of Object.keys(HOME_WIDGETS[id].params)) {
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
    for (const id of this.home.hidden) {
      menu.addItem((item) => item.setTitle(t(`home.${id}`)).setIcon(HOME_WIDGETS[id].icon).onClick(() => this.save((h) => { h.hidden = h.hidden.filter((x) => x !== id); })));
    }
    if (!this.home.hidden.length) menu.addItem((item) => item.setTitle(t("home.allShown")).setDisabled(true));
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
    menu.addSeparator();
    for (const id of home.hidden) {
      menu.addItem((item) => item.setTitle(t("home.add", { name: t(`home.${id}`) })).setIcon("plus").onClick(() => this.save((h) => { h.hidden = h.hidden.filter((x) => x !== id); })));
    }
    menu.addItem((item) => item.setTitle(t("home.start", { where: t(this.view.settings.start === "home" ? "home.startHome" : "home.startLast") }))
      .onClick(() => this.view.update("start", this.view.settings.start === "home" ? "last" : "home")));
    menu.showAtMouseEvent(event);
  }
}
