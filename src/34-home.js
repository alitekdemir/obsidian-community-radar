// ─── 4d. Home page ─────────────────────────────────────────────────────────
/**
 * The home page of the view: groups of widgets (see defaultGroups, HOME_WIDGETS), small cards or big ones. A card
 * opens the list with its plugins; a big card's "N new" opens only the new ones. Everything is set in place: a
 * group's ⋯ (or a right click on its title) renames, widens, adds or deletes it, its grip reorders the groups; a
 * card's grip reorders the cards, its ⋮ (a small card: right click) changes its settings or takes it off.
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
    const page = root.createDiv({ cls: "pdt-home" });
    if (!this.plugin.catalog) {
      page.createDiv({ cls: "pdt-empty", text: this.plugin.busy ? t("status.syncing") : t("status.loading") });
      return;
    }
    const now = Date.now();
    if (recordVisit(this.home, now)) this.plugin.saveData(this.plugin.data);   // a new day: the last visit moves back
    const ctx = this.context(now);
    if (this.home.quickstart) this.renderQuickstart(page);
    this.renderHead(page);
    const groups = page.createDiv({ cls: "pdt-home-groups" });
    let first = 0;   // cards rise in one after another, across the groups
    for (const group of this.home.groups) {
      this.renderGroup(groups, ctx, group, first);
      first += group.items.length;
    }
    this.sortable(groups, ".pdt-home-group-grip", (ids) => this.save((h) => { h.groups = ids.map((id) => h.groups.find((g) => g.id === id)); }));
    // "+ Add widget": the gallery, then where it goes
    const add = this.card(page.createDiv({ cls: "pdt-home-grid" }), "pdt-home-add", 0, () => this.addMenu());
    add.onclick = () => this.addMenu();   // the whole card: it has no buttons of its own
    setIcon(add.createSpan({ cls: "pdt-home-add-icon" }), "plus");
    add.createSpan({ cls: "pdt-home-add-title", text: t("home.addWidget") });
    add.createSpan({ cls: "pdt-home-add-hint", text: t("home.addHint") });
  }

  /**
   * Opens a widget's list with its new plugins marked. Built-in widgets count from your last visit day, so opening
   * empties nothing; a saved view (no "came in" moment) remembers what you saw and marks the rest next time.
   */
  openList(ctx, id, params, rows, then, onlyNew = false) {
    const widget = homeWidget(this.home, id);
    const fresh = new Set((freshRows(ctx, widget, params, rows, then) || []).map((p) => p.id));
    if (widget.view) {
      this.home.seen = { ...this.home.seen, [id]: seenIds(rows) };
      this.plugin.saveData(this.plugin.data);
    }
    return this.view.openPreset(id, params, fresh, onlyNew);
  }

  /** A saved view from the strip: its list, the way its widget opens it (what's new marked, then seen). */
  openView(id) {
    const ctx = this.context(Date.now());
    const widget = homeWidget(this.home, id);
    if (!widget) return null;
    return this.openList(ctx, id, {}, widgetRows(ctx, widget, {}), sinceMoment(this.home, ctx.now));
  }

  /** A saved view's query changed in its list: Save puts it in the view. */
  async updateView(id, query) {
    await this.save((h) => { h.views = h.views.map((v) => (VIEW_PREFIX + v.id === id ? { ...v, query } : v)); });
  }

  /** A widget's title: yours for a saved view. */
  title(id, widget = homeWidget(this.home, id)) {
    return widget.view?.name ?? (widget.tab === id ? t(`mode.${id}`) : t(`home.${id}`));   // a page's widget: the page's name
  }

  /** Saves a query as a view: a widget in `groupId` (default: the first big-card group), its matches so far seen. */
  async saveView(name, query, rows, groupId) {
    const view = { id: Date.now().toString(36), name, query };
    const id = VIEW_PREFIX + view.id;
    await this.save((h) => {
      h.views = [...(h.views || []), view];
      this.groupFor(h, groupId).items.push(id);
      h.seen = { ...h.seen, [id]: seenIds(rows) };
    });
    return view;
  }

  /** Puts a widget at the end of a group (a widget already there stays where it is). */
  place(id, groupId) {
    return this.save((h) => {
      const group = this.groupFor(h, groupId);
      if (!group.items.includes(id)) group.items.push(id);
    });
  }

  /** The group by id; none given (or gone): the first big-card group, made when there's none. */
  groupFor(home, groupId) {
    return home.groups.find((g) => g.id === groupId) ?? home.groups.find((g) => g.look === "big") ?? this.addGroup("", "big", home);
  }

  /** A new empty group of one look, after `after` (else last); returns it. Not saved: the caller saves. */
  addGroup(name, look, home = this.home, after = null) {
    const group = { id: Date.now().toString(36), name, look, half: false, since: false, items: [] };
    const at = home.groups.findIndex((g) => g.id === after);
    home.groups.splice(at === -1 ? home.groups.length : at + 1, 0, group);
    return group;
  }

  /** Changes one group and saves. */
  saveGroup(id, change) {
    return this.save((h) => change(h.groups.find((g) => g.id === id)));
  }

  /** A group's name: yours, else the built-in group's own. */
  groupName(group) {
    const own = `home.group.${group.id}`;   // news, state, discover
    return group.name || (STRINGS.en[own] ? t(own) : t("home.group.untitled"));
  }

  /**
   * Where a widget goes: straight into `groupId` when it's given (a group's "Add widget"), else the Add window asks
   * small or big card and which group. Resolves {name, group} or null (cancelled).
   */
  ask({ id, widget = homeWidget(this.home, id), name = "", askName = false, groupId = null }) {
    if (groupId && !askName) return Promise.resolve({ name, group: groupId });
    return new PlaceModal(this, { id, widget, name, askName, groupId }).ask();
  }

  /** The Quick start card: opens Help on its first tab; ✕ puts it away for good (Help keeps it). */
  renderQuickstart(page) {
    const card = page.createDiv({ cls: "pdt-home-quickstart" });
    setIcon(card.createSpan({ cls: "pdt-home-quickstart-icon" }), "rocket");
    const text = card.createDiv({ cls: "pdt-home-quickstart-text" });
    text.createDiv({ cls: "pdt-home-quickstart-title", text: t("home.quickstart") });
    text.createDiv({ text: t("home.quickstart.desc") });
    card.createEl("button", { cls: "mod-cta", text: t("home.quickstart.cta"), attr: { type: "button" } }).onclick = () => this.view.openHelp("start");
    const close = card.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": t("home.quickstart.close") } });
    setIcon(close, "x");
    close.onclick = () => this.save((h) => { h.quickstart = false; });
  }

  /** "At a glance" and its period: what small "since" cards and the big cards' "N new" count from. */
  renderHead(page) {
    const head = page.createDiv({ cls: "pdt-home-head" });
    const period = this.home.since.period;
    head.createEl("h2", { text: t("home.since") });
    const chip = head.createEl("button", { cls: "pdt-home-chip", text: `${this.sinceLabel(period)} ▾`, attr: { type: "button" } });
    chip.onclick = (event) => this.choose(event, SINCE_PERIODS.map((p) => [p, this.sinceLabel(p)]), period, (p) => this.save((h) => { h.since.period = p; }));
    if (period === "seen") setTooltip(chip, t("home.sinceSeenTip", { day: this.dayLabel(sinceMoment(this.home, Date.now())) }));
  }

  /** A group: its title (grip and ⋯ show on hover; a right click opens the menu too), then its cards. */
  renderGroup(parent, ctx, group, first) {
    const box = parent.createDiv({ cls: `pdt-home-group is-${group.look}${group.half ? " is-half" : ""}` });
    box.dataset.id = group.id;
    const head = box.createDiv({ cls: "pdt-home-group-head" });
    setIcon(head.createSpan({ cls: "pdt-home-group-grip", attr: { "aria-hidden": "true" } }), "grip-vertical");
    head.createEl("h3", { text: this.groupName(group) });
    if (group.look === "small") head.createSpan({ cls: "pdt-home-group-hint", text: t(group.since ? "home.group.sinceHint" : "home.group.totalHint") });
    const more = head.createEl("button", { cls: "clickable-icon pdt-home-group-more", attr: { type: "button", "aria-label": t("home.group.menu") } });
    setIcon(more, "more-horizontal");
    more.onclick = (event) => this.groupMenu(event, group);
    head.addEventListener("contextmenu", (event) => { event.preventDefault(); this.groupMenu(event, group); });

    const grid = box.createDiv({ cls: group.look === "small" ? "pdt-home-since" : "pdt-home-grid" });
    group.items.forEach((id, i) => (group.look === "small" ? this.renderMini(grid, ctx, group, id, first + i) : this.renderWidget(grid, ctx, id, first + i, group)));
    if (!group.items.length) box.createDiv({ cls: "pdt-home-group-empty", text: t("home.group.empty") });
    this.sortable(grid, ".pdt-grip", (order) => this.saveGroup(group.id, (g) => { g.items = order.filter(Boolean); }));
  }

  /**
   * A small card: a number and its label. In a "since" group it's the widget asked from the period on (your last
   * visit day, or the last 7 / 30 days), else its total. `preview` ({widget, cls}): drawn for the Add window, inert.
   */
  renderMini(grid, ctx, group, id, index, preview = null) {
    const widget = preview?.widget ?? homeWidget(this.home, id);
    const own = preview ? { ...widget.defaults } : widgetParams(this.home, id);
    const then = sinceMoment(this.home, ctx.now);
    const { params, rows, label, info } = group.since ? this.sinceCount(ctx, id, widget, own, then) : {
      params: own, rows: widgetRows(ctx, widget, own), label: this.title(id, widget), info: this.widgetInfo(id, own, widget),
    };
    const n = rows.length;
    const done = group.since && n === 0 && this.home.since.period === "seen";
    const open = () => (widget.page ? this.view.openPage(widget.page) : this.openList(ctx, id, params, rows, then));
    const card = this.card(grid, `pdt-home-mini is-${widget.tone}${n === 0 ? " is-done" : ""}${preview ? ` is-preview ${preview.cls || ""}` : ""}`, index, preview ? () => {} : open);
    card.dataset.id = id;
    if (!preview) {
      this.grip(card);
      card.addEventListener("contextmenu", (event) => { event.preventDefault(); this.widgetMenu(event, id, group); });
    }
    setIcon(card.createSpan({ cls: "pdt-home-mini-icon" }), widget.icon);
    card.createSpan({ cls: "pdt-home-mini-n", text: done ? "✓" : formatCount(n) });
    this.info(card, info);
    card.createSpan({ cls: "pdt-home-mini-label", text: label });
    card.createSpan({ cls: "pdt-home-cta", text: t(widget.page ? "home.open" : "home.list") });
  }

  /**
   * A small card in a "since" group: the widget asked from `then` on. Tracked, since your last visit, is what you
   * haven't reviewed (no day); a saved view counts the matches you haven't seen. Returns {params, rows, label, info}.
   */
  sinceCount(ctx, id, widget, own, then) {
    const period = this.home.since.period;
    const builtIn = SINCE_CARDS.includes(id);   // these have their own "since" wording
    const reviewBased = id === "tracked" && period === "seen";
    if (widget.view) {
      const all = widgetRows(ctx, widget, own);
      return { params: own, rows: freshRows(ctx, widget, own, all, then) ?? all, label: this.title(id, widget), info: this.widgetInfo(id, own, widget) };
    }
    // its query asked for the period: 7 / 30 of its days, or from your last visit day on
    const params = reviewBased ? own : period !== "seen" && own.days != null ? { ...own, days: period } : sinceParams(own, then);
    const words = { when: this.sinceLabel(period), n: stepLabel(own.n ?? 0) };
    return {
      params,
      rows: widgetRows(ctx, widget, params),
      label: builtIn ? t(`home.since.${id}`, words) : this.title(id, widget),
      info: builtIn ? t(id === "tracked" && !reviewBased ? "home.since.tracked.infoDays" : `home.since.${id}.info`, words) : this.widgetInfo(id, own, widget),
    };
  }

  /** The Add window's picture of a widget: a big card, or a small one after the group's last two (dimmed). */
  preview(frame, ctx, look, id, widget, group) {
    if (look === "big") return this.renderWidget(frame, ctx, id, 0, null, { widget });
    const near = (group?.look === "small" ? group.items.filter((x) => x !== id) : []).slice(-2);
    near.forEach((x, i) => this.renderMini(frame, ctx, group, x, i, { widget: homeWidget(this.home, x), cls: "is-dim" }));
    return this.renderMini(frame, ctx, group ?? { since: false }, id, near.length, { widget, cls: "is-new" });
  }

  /** A big card: title and ⋮, the headline and "N new", its setting chip, the top plugins. `preview`: see renderMini. */
  renderWidget(grid, ctx, id, index, group, preview = null) {
    const widget = preview?.widget ?? homeWidget(this.home, id);
    const params = preview ? { ...widget.defaults } : widgetParams(this.home, id);
    const then = sinceMoment(this.home, ctx.now);
    const { rows, fresh, headline } = widgetResult(ctx, widget, params, then);
    // a page's widget opens the page; "N new": a saved view narrows its list to them, a built-in widget asks "since"
    const open = (onlyNew) => {
      if (widget.page && !onlyNew) return this.view.openPage(widget.page);
      return onlyNew && !widget.view
        ? this.openList(ctx, id, sinceParams(params, then), fresh, then)
        : this.openList(ctx, id, params, rows, then, onlyNew);
    };
    const card = this.card(grid, `pdt-home-card is-${widget.tone}${preview ? " is-preview" : ""}`, index, preview ? () => {} : () => open(false));
    card.dataset.id = id;
    if (!preview) this.grip(card);

    const head = card.createDiv({ cls: "pdt-home-card-head" });
    setIcon(head.createSpan({ cls: "pdt-home-icon" }), widget.icon);
    head.createSpan({ cls: "pdt-home-title", text: this.title(id, widget) });
    const info = this.widgetInfo(id, params, widget);
    this.info(head, info);
    head.createSpan({ cls: "pdt-home-spacer" });
    const more = head.createEl("button", { cls: "pdt-home-more", attr: { type: "button", "aria-label": t("home.widgetMenu") } });
    setIcon(more, "more-vertical");
    more.onclick = (event) => { event.stopPropagation(); this.widgetMenu(event, id, group); };
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
    const unit = widget.view ? t("home.view.unitQuery") : widget.tab ? t("home.tabUnit") : t(widget.unit?.(params) || `home.${id}.unit`, this.paramWords(params));
    left.createSpan({ cls: "pdt-home-unit", text: unit });
    const key = Object.keys(widget.params)[0];
    if (key) {
      const chip = metric.createEl("button", { cls: "pdt-home-chip", text: `${this.paramText(key, params[key])} ▾`, attr: { type: "button" } });
      chip.onclick = (event) => {
        event.stopPropagation();
        if (preview) return;
        this.choose(event, paramOptions(ctx, id, key).map((v) => [v, this.paramText(key, v)]), params[key], (v) => this.setParam(id, key, v));
      };
    }

    const top = card.createDiv({ cls: "pdt-home-top" });
    const freshIds = new Set((fresh || []).map((p) => p.id));
    for (const p of rows.slice(0, this.home.preview)) {
      const item = top.createDiv({ cls: `pdt-home-item${freshIds.has(p.id) ? " is-fresh" : ""}` });
      item.createSpan({ cls: "pdt-home-item-name", text: p.name });
      item.createSpan({ cls: "pdt-home-item-value", text: widget.value(ctx, p, params) });
    }
    if (!rows.length) top.createDiv({ cls: "pdt-home-item is-empty", text: t(id === "tracked" ? "home.tracked.empty" : "home.none") });
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

  /** Drag by `handle` to reorder; the new order of the children's `data-id`s is saved. */
  sortable(grid, handle, onOrder) {
    if (typeof Sortable === "undefined" || !grid.children.length) return;
    Sortable.create(grid, {
      handle,
      animation: 180,
      ghostClass: "is-ghost",
      onEnd: () => onOrder([...grid.children].map((el) => el.dataset.id)),
    });
  }

  sinceLabel(period) {
    return period === "seen" ? t("home.sinceSeen") : t("home.sinceDays", { n: period });
  }

  /** A day as people say it: 11 Nov. */
  dayLabel(ms) {
    return new Date(ms).toLocaleDateString(t("locale"), { day: "numeric", month: "short" });
  }

  paramText(key, value) {
    if (key === "since") return t("home.sinceDay", { day: this.dayLabel(value) });
    if (key === "n") return stepLabel(value);
    if (key === "by") return t(`home.by.${value}`);
    if (key === "incubated") return `≥ ${t("filter.days", { n: value })}`;
    return t("filter.days", { n: value });
  }

  /** What a widget lists, in words: a saved view's or a tab's query, else its own text with its settings. */
  widgetInfo(id, params, widget = homeWidget(this.home, id)) {
    if (widget.view) return this.viewInfo(widget.view);
    if (widget.tab) return t("home.tabInfo", { tab: t(`mode.${widget.tab}`), query: flatQuery(pageQuery(this.plugin.data.settings, widget.tab)) });
    return t(widget.info?.(params) || `home.${id}.info`, this.paramWords(params));
  }

  /** A widget's settings as words for its info and unit lines. */
  paramWords(params) {
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

  /** ⋮ of a widget (a small card: right click): every setting, then Reset and "Take off the group"; a saved view: Rename, Delete. */
  widgetMenu(event, id, group) {
    const ctx = this.context(Date.now());
    const params = widgetParams(this.home, id);
    const widget = homeWidget(this.home, id);
    const menu = new Menu();
    const takeOff = () => group && menu.addItem((item) => item.setTitle(t("home.group.remove")).setIcon("eye-off")
      .onClick(() => this.saveGroup(group.id, (g) => { g.items = g.items.filter((x) => x !== id); })));
    if (widget.view) {
      menu.addItem((item) => item.setTitle(t("home.view.rename")).setIcon("pencil").onClick(async () => {
        const name = await new TextModal(this.plugin.app, { title: t("home.view.rename"), value: widget.view.name, cta: t("home.view.save") }).ask();
        if (name) await this.save((h) => { h.views = h.views.map((v) => (v.id === widget.view.id ? { ...v, name } : v)); });
      }));
      takeOff();
      menu.addItem((item) => item.setTitle(t("home.view.delete")).setIcon("trash").onClick(() => this.save((h) => {
        h.views = h.views.filter((v) => v.id !== widget.view.id);
        for (const g of h.groups) g.items = g.items.filter((x) => x !== id);
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
    if (widget.tab) {   // a tab's widget: its query is the tab's, changed in the list
      menu.addItem((item) => item.setTitle(t("home.editTab", { tab: t(`mode.${widget.tab}`) })).setIcon("pencil").onClick(() => this.view.editPageQuery(widget.tab)));
      if (this.plugin.data.settings.pageQueries?.[widget.tab] != null) {   // only once you saved your own over it
        menu.addItem((item) => item.setTitle(t("query.resetPage")).setIcon("rotate-ccw").onClick(() => this.view.resetPageQuery(widget.tab)));
      }
    }
    if (this.home.params?.[id]) {   // only when you changed one of its settings
      menu.addItem((item) => item.setTitle(t("home.reset")).setIcon("rotate-ccw").onClick(() => this.save((h) => { delete h.params?.[id]; })));
    }
    takeOff();
    menu.showAtMouseEvent(event);
  }

  /** A group's ⋯ (or a right click on its title): Rename, side by side, count "since", Add widget, New group, Delete. */
  groupMenu(event, group) {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(t("home.group.rename")).setIcon("pencil").onClick(async () => {
      const name = await new TextModal(this.plugin.app, { title: t("home.group.rename"), value: this.groupName(group), cta: t("home.view.save") }).ask();
      if (name) await this.saveGroup(group.id, (g) => { g.name = name; });
    }));
    menu.addItem((item) => item.setTitle(t("home.group.half")).setIcon("columns-2").setChecked(group.half)
      .onClick(() => this.saveGroup(group.id, (g) => { g.half = !g.half; })));
    if (group.look === "small") {
      menu.addItem((item) => item.setTitle(t("home.group.since")).setIcon("calendar-clock").setChecked(group.since)
        .onClick(() => this.saveGroup(group.id, (g) => { g.since = !g.since; })));
    }
    menu.addItem((item) => item.setTitle(t("home.group.add")).setIcon("plus").onClick(() => this.addMenu(group.id)));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t("home.group.new")).setIcon("folder-plus").onClick(async () => {
      const name = await new TextModal(this.plugin.app, { title: t("home.group.new"), value: "", cta: t("home.view.save") }).ask();
      if (name) await this.save((h) => { this.addGroup(name, group.look, h, group.id); });
    }));
    menu.addItem((item) => item.setTitle(t("home.group.delete")).setIcon("trash")
      .onClick(() => this.save((h) => { h.groups = h.groups.filter((g) => g.id !== group.id); })));
    menu.showAtMouseEvent(event);
  }

  /** "+ Add widget": the gallery (widgets on no group to bring back, ready-made queries); from a group's ⋯, into that group. */
  addMenu(groupId = null) {
    new GalleryModal(this.plugin.app, this, groupId).open();
  }

  /** ⋮ of the page: descriptions, recent actions, Add widget, the screen the view opens on. */
  pageMenu(event) {
    const home = this.home;
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(t("home.showInfo")).setChecked(home.info).onClick(() => this.save((h) => { h.info = !h.info; })));
    menu.addItem((item) => item.setTitle(t("bulk.recent")).setIcon("history").onClick(() => this.view.openRecent()));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t("home.addWidget")).setIcon("plus").onClick(() => this.addMenu()));
    menu.addItem((item) => item.setTitle(t("home.start", { where: t(this.view.settings.start === "home" ? "home.startHome" : "home.startLast") }))
      .onClick(() => this.view.update("start", this.view.settings.start === "home" ? "last" : "home")));
    menu.showAtMouseEvent(event);
  }
}
