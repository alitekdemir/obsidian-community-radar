// ─── 4b. Domain modals (Recent, Group, Model, Help, Gallery, Place) ─────────

/** Recent actions: the last bulk actions, newest first, each with Undo (or when it was undone). */
class RecentModal extends Modal {
  constructor(plugin, onUndo) {
    super(plugin.app);
    Object.assign(this, { plugin, onUndo, closed: false });
  }

  onOpen() {
    this.titleEl.setText(t("bulk.recent"));
    this.render();
  }

  render() {
    if (this.closed) return;
    const box = this.contentEl;
    box.empty();
    box.createEl("p", { cls: "pdt-detail-muted", text: t("bulk.recentHint", { n: OPS_CAP }) });
    const mass = this.plugin.ops.massReviews();
    for (const { date, ids } of mass) {
      const row = box.createDiv({ cls: "pdt-op" });
      row.createSpan({ cls: "pdt-op-when", text: date });
      const what = row.createDiv({ cls: "pdt-op-what" });
      what.createEl("b", { text: t("bulk.massReviewed", { n: ids.length }) });
      what.createSpan({ cls: "pdt-detail-muted", text: t("bulk.massHint") });
      const btn = row.createEl("button", { text: t("bulk.unreview"), attr: { type: "button" } });
      btn.onclick = async () => {
        btn.disabled = true;
        try { await this.plugin.ops.unreview(date); } finally { if (!this.closed) this.render(); }
      };
    }
    const ops = this.plugin.data.ops || [];
    if (!ops.length && !mass.length) box.createEl("p", { text: t("bulk.recentNone") });
    for (const op of ops) {
      const row = box.createDiv({ cls: "pdt-op" });
      row.createSpan({ cls: "pdt-op-when", text: formatTime(op.at, Date.now()) });
      const what = row.createDiv({ cls: "pdt-op-what" });
      what.createEl("b", { text: opLabel(op) });
      what.createSpan({ cls: "pdt-detail-muted", text: namesLine(op.changes.map((c) => this.plugin.pluginById(c.id) || { name: c.id }), 3) });
      if (op.undone) row.createSpan({ cls: "pdt-detail-muted", text: t("bulk.undone") });
      else if (op.changes.length) {
        const btn = row.createEl("button", { text: t("bulk.undo"), attr: { type: "button" } });
        btn.onclick = async () => {
          btn.disabled = true;
          try { await this.onUndo(op); } finally { if (!this.closed) this.render(); }
        };
      }
    }
  }

  onClose() {
    this.closed = true;
    this.contentEl.empty();
  }
}

/**
 * One plugin's groups: selected, yours (closest starred), AI suggestions and a new-name box.
 * Preserves input focus when async AI suggestions arrive; `result` resolves with chosen groups or null.
 */
class GroupModal extends Modal {
  constructor(plugin, target) {
    super(plugin.app);
    this.plugin = plugin;
    this.target = target;
    const note = plugin.notes.index.get(target.id);
    this.mine = plugin.notes.groups();
    const hint = plugin.closestGroupFor(target);
    this.closest = hint?.name ?? null;
    this.touched = Boolean(note?.groups.length);
    this.selected = this.touched ? [...note.groups] : hint?.sure ? [hint.name] : [];
    const aiState = !plugin.data.settings.aiGroups ? "off" : plugin.translator.ready ? "loading" : "setup";
    this.ai = { state: aiState, list: [], error: "" };
    this.showAll = false;
    this.draft = "";
    this.saved = null;
    this.closed = false;
    this.result = new Promise((resolve) => { this.resolve = resolve; });
  }

  onOpen() {
    this.modalEl.addClass("pdt-group-modal");
    this.render();
    if (this.ai.state === "loading") this.loadSuggestions();
  }

  onClose() {
    this.closed = true;
    this.contentEl.empty();
    this.resolve(this.saved);
  }

  async loadSuggestions() {
    try {
      const { list, usage } = await this.plugin.suggestGroups(this.target);
      if (this.closed) return;
      const known = new Set(this.mine.map((g) => g.name));
      const pick = list.find((g) => known.has(g));
      if (pick) {
        this.closest = pick;
        if (!this.touched) this.selected = [pick];
      }
      this.ai = { state: "ready", list: list.filter((g) => !known.has(g)), error: "", usage };
    } catch (error) {
      if (this.closed) return;
      this.ai = { state: "failed", list: [], error: error.message };
    }
    // preserve input focus & caret if the user is typing a new group name when AI finishes
    const active = this.contentEl.ownerDocument?.activeElement;
    const typing = active?.matches?.(".pdt-gm-new input");
    const pos = typing ? [active.selectionStart, active.selectionEnd] : null;
    this.render();
    if (typing) {
      const input = this.contentEl.querySelector(".pdt-gm-new input");
      if (input) { input.focus(); if (pos) input.setSelectionRange(pos[0], pos[1]); }
    }
  }

  toggle(name) {
    this.touched = true;
    this.selected = this.selected.includes(name) ? this.selected.filter((g) => g !== name) : [...this.selected, name];
    this.render();
  }

  addDraft() {
    const [typed] = uniqueNames([this.draft]);
    this.draft = "";
    if (typed) {
      const pool = [...this.selected, ...this.mine.map((g) => g.name), ...this.ai.list];
      const known = pool.find((g) => fold(g) === fold(typed));
      const name = known || typed;
      if (!this.selected.includes(name)) this.selected = [...this.selected, name];
      this.touched = true;
    }
    this.render();
  }

  renderAi(section) {
    const { state, list, error, usage } = this.ai;
    const ai = section(state === "ready" ? t("groups.aiCount", { n: list.length }) : t("groups.ai"), usage && ((head) => usageTag(head, usage)));
    if (state === "loading") ai.createSpan({ cls: "pdt-gm-note is-loading", text: t("groups.aiLoading") });
    if (state === "setup") ai.createSpan({ cls: "pdt-gm-note", text: t("groups.aiSetup") });
    if (state === "failed") ai.createSpan({ cls: "pdt-gm-note is-error", text: t("groups.aiFailed", { error }) });
    if (state === "ready") {
      for (const name of this.showAll ? list : list.slice(0, VISIBLE_SUGGESTIONS)) {
        groupChip(ai, { name, on: this.selected.includes(name), onToggle: () => this.toggle(name) });
      }
      if (list.length > VISIBLE_SUGGESTIONS) {
        const more = ai.createEl("button", { cls: "pdt-gm-more", attr: { type: "button", "aria-expanded": String(this.showAll) } });
        more.setText(this.showAll ? t("groups.less") : t("groups.more", { n: list.length - VISIBLE_SUGGESTIONS }));
        more.onclick = () => { this.showAll = !this.showAll; this.render(); };
      }
    }
  }

  render() {
    if (this.closed) return;
    const el = this.contentEl;
    el.empty();
    this.titleEl.setText(this.target.version ? `${this.target.name} ${this.target.version}` : this.target.name);
    if (this.target.description) el.createEl("p", { cls: "pdt-gm-desc", text: this.target.description });
    const translation = this.plugin.cachedTranslation(this.target);
    if (translation) el.createDiv({ cls: "pdt-trans", text: translation });

    const section = (label, aside) => {
      const box = el.createDiv({ cls: "pdt-gm-section" });
      const head = box.createDiv({ cls: "pdt-gm-label", text: label, attr: { lang: language } });
      aside?.(head);
      return box.createDiv({ cls: "pdt-gm-chips" });
    };

    const selected = section(t("groups.selected", { n: this.selected.length }));
    if (!this.selected.length) selected.createSpan({ cls: "pdt-gm-note", text: t("groups.none") });
    for (const name of this.selected) groupChip(selected, { name, on: true, removable: true, onToggle: () => this.toggle(name) });

    if (this.mine.length) {
      const mine = section(t("groups.mine"));
      for (const g of this.mine) {
        groupChip(mine, {
          name: g.name, on: this.selected.includes(g.name), meta: String(g.count),
          star: g.name === this.closest, starTip: t("groups.closest"), onToggle: () => this.toggle(g.name),
        });
      }
    }

    if (this.ai.state !== "off") this.renderAi(section);

    const add = el.createDiv({ cls: "pdt-gm-new" });
    const input = add.createEl("input", { type: "text", placeholder: t("groups.newPlaceholder"), value: this.draft, attr: { "aria-label": t("groups.newPlaceholder") } });
    input.oninput = () => { this.draft = input.value; };
    input.onkeydown = (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.addDraft();
    };
    add.createEl("button", { text: t("groups.add"), attr: { type: "button" } }).onclick = () => this.addDraft();

    const foot = el.createDiv({ cls: "pdt-gm-foot" });
    foot.createSpan({ cls: "pdt-gm-note", text: t("groups.hint") });
    foot.createEl("button", { text: t("groups.cancel"), attr: { type: "button" } }).onclick = () => this.close();
    const confirm = foot.createEl("button", { cls: "mod-cta", text: t("groups.confirm", { n: this.selected.length }), attr: { type: "button" } });
    confirm.onclick = () => {
      this.saved = [...this.selected];
      this.close();
    };
  }
}

/**
 * Model picker: filters as you type, shows prices, accepts custom ids, pins/remembers recent models.
 * Extends SuggestModal directly (no single-subclass PickerModal wrapper).
 */
class ModelModal extends SuggestModal {
  constructor(app, models, history, onHistory) {
    super(app);
    this.setPlaceholder(t("model.placeholder"));
    Object.assign(this, { models, history: history || [], onHistory, latestOnly: false, chosen: null });
    this.result = new Promise((resolve) => { this.resolve = resolve; });
  }

  onOpen() {
    super.onOpen?.();
    const container = this.inputEl?.parentElement;
    if (!container) return;
    const bar = createDiv({ cls: "pdt-model-bar" });
    container.after(bar);
    const toggle = bar.createDiv({ cls: "pdt-chip is-menu", text: t("model.latestOnly"), attr: { role: "button", tabindex: "0", "aria-pressed": "false" } });
    const flip = () => {
      this.latestOnly = !this.latestOnly;
      toggle.toggleClass("is-active", this.latestOnly);
      toggle.setAttribute("aria-pressed", String(this.latestOnly));
      this.inputEl.dispatchEvent(new Event("input"));
    };
    toggle.onclick = flip;
    onActivate(toggle, flip);
  }

  onChooseSuggestion(item) {
    this.chosen = item;
  }

  onClose() {
    setTimeout(() => this.resolve(this.chosen), 0);
  }

  getSuggestions(query) {
    if (!query.trim() && !this.latestOnly && this.history.length) return historyModels(this.models, this.history);
    return filterModels(this.models, query, this.latestOnly);
  }

  renderSuggestion(model, el) {
    el.addClass("pdt-model-item");
    if (model.head) el.createDiv({ cls: "pdt-qs-head", text: model.head });
    el.createDiv({ cls: "pdt-model-id", text: model.custom ? t("model.custom", { name: model.id }) : model.id });
    if (model.price) el.createDiv({ cls: "pdt-model-price", text: formatPrice(model.price) });
    if (model.custom) return;
    const pinned = this.history.some((h) => h.id === model.id && h.pinned);
    this.rowButton(el, "star", t(pinned ? "model.unpin" : "model.pin"), pinned, () => this.pin(model.id, !pinned));
    if (model.history) this.rowButton(el, "x", t("model.forget"), false, () => this.change(this.history.filter((h) => h.id !== model.id)));
  }

  rowButton(el, icon, label, active, act) {
    const button = el.createDiv({ cls: `pdt-model-act${active ? " is-active" : ""}`, attr: { role: "button", tabindex: "0", "aria-label": label } });
    setIcon(button, icon);
    button.addEventListener("mousedown", (e) => e.preventDefault());
    button.addEventListener("click", (e) => { e.stopPropagation(); act(); });
    onActivate(button, act);
  }

  pin(id, pinned) {
    const known = this.history.some((h) => h.id === id);
    this.change(known ? this.history.map((h) => (h.id === id ? { ...h, pinned } : h)) : [...this.history, { id, pinned }]);
  }

  change(history) {
    this.history = history;
    this.onHistory?.(history);
    this.inputEl.dispatchEvent(new Event("input"));
  }
}

/** Help › Quick start: what a click on each part of a card does. */
const HELP_CARD_TIPS = [["bookmark-plus", "library"], ["star", "rate"], ["github", "name"], ["languages", "desc"], ["mouse-pointer-click", "empty"], ["panel-top", "details"], ["sparkles", "profile"], ["more-horizontal", "menu"], ["square-check", "bulk"], ["bell-ring", "seen"]];
const DOCS_URL = `https://github.com/${PLUGIN_REPO}/blob/main/docs/`;

function fieldGroup(field) {
  if (field.profile) return "profile";
  if (field.param) return "params";
  if (field.days) return "days";
  return { text: "text", number: "numbers" }[field.type] || "flags";
}

const GUIDE_ROWS = {
  ops: [["=  /  !=", "=", "help.op.eq"], [">  /  >=", ">=", "help.op.gt"], ["<  /  <=", "<=", "help.op.lt"], ["~  /  !~", "~", "help.op.has"],
    ["in (…) / not in (…)", "in (", "help.op.in"], ["is empty", "is empty", "help.op.empty"], ["AND / OR / NOT", "AND", "help.op.bool"], ["order by … desc", "order by", "help.op.order"],
    ["group by …", "group by", "help.op.group"], ["limit 100 · limit 101-200", "limit", "help.op.limit"]],
  functions: Object.keys(QUERY_FUNCS).map((f) => [`${f}()`, `${f}()`, `query.fn.${f}`]),
  values: [["10k · 1.5m", "10k", "help.value.count"], ["-14d · -2w · -6m · -1y", "-14d", "help.value.ago"], ["14d · 2w · 6m · 1y", "14d", "help.value.span"], ["2026-01-01", "2026-01-01", "help.value.date"],
    [null, '""', "help.value.quoted"], ['("Tasks", Calendar)', "(", "help.value.list"]],
};

class HelpModal extends Modal {
  constructor(app, view, { tab = "start", onPick = null } = {}) {
    super(app);
    Object.assign(this, { view, tab, onPick });
    this.gallery = new GalleryPanel(view.home, () => this.close());
  }

  onOpen() {
    this.titleEl.setText(t("help.title"));
    this.modalEl.addClass("pdt-help");
    this.render();
  }

  onClose() {
    this.gallery.closed = true;
    this.contentEl.empty();
  }

  render() {
    const el = this.contentEl;
    el.empty();
    const tabs = el.createDiv({ cls: "pdt-help-tabs", attr: { role: "tablist" } });
    for (const key of ["start", "presets", "guide"]) {
      const on = key === this.tab;
      const button = tabs.createEl("button", { cls: `pdt-help-tab${on ? " is-on" : ""}`, text: t(`help.tab.${key}`), attr: { type: "button", role: "tab", "aria-selected": String(on) } });
      button.onclick = () => { this.tab = key; this.render(); };
    }
    const body = el.createDiv({ cls: "pdt-help-body" });
    if (this.tab === "start") this.renderStart(body);
    else if (this.tab === "presets") this.gallery.render(body);
    else this.renderGuide(body);
  }

  renderStart(el) {
    const view = this.view;
    const steps = [
      ["explore", () => { view.settings.section = "list"; return view.update("mode", "all"); }],
      ["library", () => view.openPage("library")],
      ["query", () => view.openQuery("gain(30d) >= 500 AND NOT library\norder by gain(30d) desc")],
    ];
    steps.forEach(([key, run], i) => {
      const step = el.createDiv({ cls: "pdt-help-step" });
      step.createSpan({ cls: "pdt-help-step-n", text: String(i + 1) });
      const text = step.createDiv({ cls: "pdt-help-step-text" });
      text.createDiv({ cls: "pdt-help-step-title", text: t(`help.step.${key}`) });
      text.createDiv({ cls: "pdt-help-step-desc", text: t(`help.step.${key}.desc`) });
      const go = step.createEl("button", { text: t(`help.step.${key}.cta`), attr: { type: "button" } });
      go.onclick = () => { this.close(); run(); };
    });
    this.renderCardTips(el);
    el.createEl("a", { cls: "pdt-help-more", text: t("help.more"), href: DOCS_URL + t("help.guideFile") });
  }

  renderCardTips(el) {
    const box = el.createDiv({ cls: "pdt-help-cards" });
    box.createDiv({ cls: "pdt-help-step-title", text: t("help.card.title") });
    const list = box.createEl("ul", { cls: "pdt-help-card-list" });
    for (const [icon, key] of HELP_CARD_TIPS) {
      const item = list.createEl("li");
      setIcon(item.createSpan({ cls: "pdt-help-card-icon", attr: { "aria-hidden": "true" } }), icon);
      item.createSpan({ text: t(`help.card.${key}`) });
    }
  }

  renderGuide(el) {
    const group = (key, rows) => {
      const head = el.createEl("h4");
      head.createSpan({ cls: "pdt-help-group-name", text: t(`help.group.${key}`) });
      const hint = t(`help.group.${key}.hint`);
      if (hint !== `help.group.${key}.hint`) head.createSpan({ cls: "pdt-help-group-hint", text: `· ${hint}` });
      const list = el.createDiv({ cls: "pdt-help-list" });
      for (const [code, insert, text] of rows) {
        const item = list.createEl(this.onPick ? "button" : "div", { cls: "pdt-help-item", attr: this.onPick ? { type: "button" } : {} });
        item.createEl("code", { text: code });
        item.createSpan({ text });
        if (this.onPick) item.onclick = () => { this.close(); this.onPick(insert); };
      }
    };
    const written = (k) => { const p = QUERY_FIELDS[k].param; return p ? `${k}(${p.fallback ?? "10k"})` : k; };
    for (const key of ["text", "numbers", "days", "params", "flags", "profile"]) {
      const fields = Object.keys(QUERY_FIELDS).filter((k) => fieldGroup(QUERY_FIELDS[k]) === key);
      group(key, fields.map((k) => [written(k), written(k), t(`query.field.${k}`)]));
    }
    for (const [key, rows] of Object.entries(GUIDE_ROWS)) group(key, rows.map(([code, insert, text]) => [code ?? t(`${text}.code`), insert, t(text)]));
    el.createEl("a", { cls: "pdt-help-more", text: t("help.more"), href: DOCS_URL + t("help.guideFile") });
  }
}

class GalleryPanel {
  constructor(home, close, target = null) {
    Object.assign(this, { home, close, target, section: "all", open: null, closed: false });
    this.counts = new Map();
  }

  count(ctx, query) {
    if (!this.counts.has(query)) this.counts.set(query, queryRows(ctx, query).length);
    return this.counts.get(query);
  }

  sections(ctx) {
    const home = this.home.home;
    const unplaced = unplacedWidgets(home).map((id) => {
      const widget = homeWidget(home, id);
      const params = widgetParams(home, id);
      const title = this.home.title(id);
      const query = widget.query(ctx, params);
      return {
        rowKey: `widget:${id}`, title, cat: widget.cat || "hidden",
        desc: widget.view ? "" : this.home.widgetInfo(id, params),
        query, count: this.count(ctx, query), action: t(widget.cat ? "gallery.add" : "gallery.restore"),
        run: async () => {
          const at = await this.home.ask({ id, widget, name: title, groupId: this.target });
          if (at) await this.home.place(id, at.group);
        },
      };
    });
    const preset = (p) => {
      const title = t(`preset.${p.key}`);
      const done = (home.views || []).some((v) => sameQuery(v.query, p.query));
      const widget = viewWidget({ id: "preview", name: title, query: p.query }, null);
      return {
        rowKey: `preset:${p.key}`, title, desc: t(`preset.${p.key}.desc`), why: t(`preset.${p.key}.why`),
        query: p.query, count: this.count(ctx, p.query), action: t(done ? "gallery.added" : "gallery.add"), done,
        run: async () => {
          const at = await this.home.ask({ id: VIEW_PREFIX + widget.view.id, widget, name: title, groupId: this.target });
          if (at) await this.home.saveView(title, p.query, queryRows(ctx, p.query), at.group);
        },
      };
    };
    return Object.keys(GALLERY_SECTIONS)
      .map((section) => ({ section, rows: [...unplaced.filter((w) => w.cat === section), ...QUERY_PRESETS.filter((p) => p.cat === section).map(preset)] }))
      .filter((s) => s.rows.length);
  }

  render(host) {
    const sections = this.sections(this.home.context(Date.now()));
    host.empty();
    const el = host.createDiv({ cls: "pdt-gallery" });
    el.createEl("p", { cls: "pdt-gallery-intro", text: t("gallery.intro") });
    const chips = el.createDiv({ cls: "pdt-gallery-chips" });
    const chip = (section, n) => {
      const on = this.section === section;
      const button = chips.createEl("button", { cls: `pdt-gallery-chip${on ? " is-on" : ""}`, attr: { type: "button", "aria-pressed": String(on) } });
      button.createSpan({ text: t(`gallery.section.${section}`) });
      button.createSpan({ cls: "pdt-gallery-chip-n", text: formatCount(n) });
      button.onclick = () => { this.section = section; this.render(host); };
    };
    chip("all", sections.reduce((n, s) => n + s.rows.length, 0));
    for (const s of sections) chip(s.section, s.rows.length);
    for (const s of sections) if (this.section === "all" || this.section === s.section) this.renderSection(el, s, () => { if (!this.closed) this.render(host); });

    const foot = el.createDiv({ cls: "pdt-gallery-foot" });
    foot.createSpan({ text: t("gallery.own") });
    const own = foot.createEl("button", { text: t("gallery.openQuery"), attr: { type: "button" } });
    own.onclick = () => { this.close(); this.home.view.openQuery(""); };
  }

  renderSection(el, { section, rows }, redraw) {
    const head = el.createDiv({ cls: "pdt-gallery-head", attr: { "data-section": section } });
    head.createEl("h3", { text: t(`gallery.section.${section}`) });
    head.createSpan({ text: t(`gallery.section.${section}.hint`) });
    for (const row of rows) {
      const open = this.open === row.rowKey;
      const item = el.createDiv({ cls: `pdt-gallery-row${open ? " is-open" : ""}`, attr: { "data-section": section } });
      const line = item.createDiv({ cls: "pdt-gallery-line", attr: { role: "button", tabindex: "0", "aria-expanded": String(open) } });
      const toggle = () => { this.open = open ? null : row.rowKey; redraw(); };
      line.onclick = (event) => { if (!event.target.closest?.("button")) toggle(); };
      onActivate(line, toggle);
      setIcon(line.createSpan({ cls: "pdt-gallery-icon", attr: { "aria-hidden": "true" } }), open ? "chevron-down" : "chevron-right");
      const text = line.createDiv({ cls: "pdt-gallery-text" });
      text.createDiv({ cls: "pdt-gallery-title", text: row.title });
      if (row.desc) text.createDiv({ cls: "pdt-gallery-desc", text: row.desc });
      const side = line.createDiv({ cls: "pdt-gallery-side" });
      side.createSpan({ cls: "pdt-gallery-n", text: formatCount(row.count) });
      const act = side.createEl("button", { cls: row.done ? "pdt-gallery-done" : "mod-cta", text: row.action, attr: { type: "button" } });
      act.disabled = Boolean(row.done);
      act.onclick = async () => {
        if (act.disabled) return;
        act.disabled = true;
        try { await row.run(); } finally { redraw(); }
      };

      const more = item.createDiv({ cls: "pdt-gallery-more" });
      if (row.why) more.createDiv({ cls: "pdt-gallery-why", text: row.why });
      const query = more.createDiv({ cls: "pdt-gallery-query" });
      query.createEl("code", { text: row.query });
      const tryIt = query.createEl("button", { cls: "pdt-gallery-try", text: t("gallery.try"), attr: { type: "button" } });
      tryIt.onclick = () => { this.close(); this.home.view.openQuery(row.query); };
    }
  }
}

class GalleryModal extends Modal {
  constructor(app, home, target = null) {
    super(app);
    this.panel = new GalleryPanel(home, () => this.close(), target);
  }

  onOpen() {
    this.titleEl.setText(t("home.addWidget"));
    this.modalEl.addClass("pdt-gallery-modal");
    this.panel.render(this.contentEl);
  }

  onClose() {
    this.panel.closed = true;
    this.contentEl.empty();
  }
}

const NEW_GROUP = "\u0000new";

class PlaceModal extends ResultModal {
  constructor(home, { id, widget, name, askName, groupId }) {
    super(home.plugin.app, null);
    const target = home.home.groups.find((g) => g.id === groupId);
    Object.assign(this, { home, id, widget, name, askName, look: target?.look ?? "big", group: groupId, newName: "" });
  }

  onOpen() {
    this.titleEl.setText(t(this.askName ? "home.view.saveTitle" : "home.place.title"));
    this.modalEl.addClass("pdt-place-modal");
    this.draw();
  }

  groups() {
    const groups = this.home.home.groups.filter((g) => g.look === this.look);
    if (this.group !== NEW_GROUP && !groups.some((g) => g.id === this.group)) this.group = groups[0]?.id ?? NEW_GROUP;
    return groups;
  }

  draw() {
    const el = this.contentEl;
    el.empty();
    const onEnter = (event) => { if (event.key === "Enter") { event.preventDefault(); this.done(); } };
    if (this.askName) {
      const name = el.createEl("input", { type: "text", value: this.name, cls: "pdt-text-input pdt-place-name", attr: { "aria-label": t("home.place.name") } });
      name.oninput = () => { this.name = name.value; };
      name.addEventListener("keydown", onEnter);
    }
    const groups = this.groups();
    const group = groups.find((g) => g.id === this.group);
    const ctx = this.home.context(Date.now());
    const looks = el.createDiv({ cls: "pdt-place-looks", attr: { role: "radiogroup", "aria-label": t("home.place.look") } });
    for (const look of GROUP_LOOKS) {
      const on = look === this.look;
      const option = looks.createDiv({ cls: `pdt-place-look is-${look}${on ? " is-on" : ""}`, attr: { role: "radio", tabindex: "0", "aria-checked": String(on) } });
      const head = option.createDiv({ cls: "pdt-place-look-head" });
      head.createSpan({ cls: "pdt-place-radio" });
      head.createSpan({ cls: "pdt-place-look-title", text: t(`home.place.${look}`) });
      head.createSpan({ cls: "pdt-place-look-where", text: t(`home.place.${look}.hint`) });
      const frame = option.createDiv({ cls: "pdt-place-frame" });
      this.home.preview(frame, ctx, look, this.id, this.widget, look === this.look ? group : this.home.home.groups.find((g) => g.look === look));
      const pick = () => { this.look = look; this.draw(); };
      option.onclick = pick;
      onActivate(option, pick);
    }

    const row = el.createDiv({ cls: "pdt-place-group" });
    row.createSpan({ cls: "pdt-place-label", text: t("home.place.group") });
    const select = row.createEl("select", { cls: "dropdown" });
    for (const g of groups) select.createEl("option", { value: g.id, text: this.home.groupName(g) });
    select.createEl("option", { value: NEW_GROUP, text: t("home.place.newGroup") });
    select.value = this.group;
    select.onchange = () => { this.group = select.value; this.draw(); };
    if (this.group === NEW_GROUP) {
      const input = row.createEl("input", { type: "text", value: this.newName, cls: "pdt-text-input", attr: { placeholder: t("home.place.newGroupName") } });
      input.oninput = () => { this.newName = input.value; };
      input.addEventListener("keydown", onEnter);
    }

    const buttons = el.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: t("home.place.cancel"), attr: { type: "button" } }).onclick = () => this.close();
    buttons.createEl("button", { cls: "mod-cta", text: t("home.place.add"), attr: { type: "button" } }).onclick = () => this.done();
  }

  done() {
    const name = this.name.trim();
    if (this.askName && !name) return;
    const group = this.group === NEW_GROUP ? this.home.addGroup(this.newName.trim(), this.look).id : this.group;
    this.answer = { name, group };
    this.close();
  }
}
