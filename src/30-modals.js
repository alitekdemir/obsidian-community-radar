// ─── 4. UI ──────────────────────────────────────────────────────────────────
const $ = (root, selector) => root.querySelector(selector);

/** Obsidian's own tooltip (1.4.4+); falls back to the browser tooltip. */
const setTooltip = obsidian.setTooltip || ((el, text) => el.setAttribute("title", text));

function onActivate(el, handler) {
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handler(); }
  });
}

/** Obsidian's built-in icon button look (clickable-icon): transparent, highlighted on hover. */
function iconButton(parent, icon, tip, cls = "") {
  const button = parent.createDiv({ cls: `clickable-icon pdt-icon ${cls}`.trim(), attr: { "aria-label": tip, role: "button", tabindex: "0" } });
  setIcon(button, icon);
  setTooltip(button, tip);
  onActivate(button, () => button.click());
  return button;
}

/** A filter chip whose options open in Obsidian's own menu. */
function menuChip(parent, label, options, current, onPick) {
  const chip = parent.createDiv({ cls: "pdt-chip is-menu", attr: { role: "button", tabindex: "0" } });
  chip.createSpan({ text: label });
  const selected = options.some(([value]) => value === current) ? current : options[0][0];  // invalid here → first option
  chip.createSpan({ cls: "pdt-chip-value", text: options.find(([value]) => value === selected)[1] });
  setIcon(chip.createSpan({ cls: "pdt-chip-caret" }), "chevron-down");
  const open = () => {
    const menu = new Menu();
    for (const [value, text] of options) {
      menu.addItem((item) => item.setTitle(text).setChecked(value === selected).onClick(() => onPick(value)));
    }
    const rect = chip.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  };
  chip.onclick = open;
  onActivate(chip, open);
  return chip;
}

/** A chip with a typed whole number (e.g. "Last [7] days"); the caret opens presets (days unless `format` says) in Obsidian's menu. */
function numberChip(parent, { label, unit, value, min, max, presets, onChange, format = (n) => t("filter.days", { n }) }) {
  const chip = parent.createDiv({ cls: "pdt-chip is-number" });
  chip.createSpan({ text: label });
  const input = chip.createEl("input", { type: "number", value: String(value), attr: { min: String(min), max: String(max), "aria-label": label } });
  chip.createSpan({ text: unit });
  input.onchange = () => {
    const n = Math.round(Number(input.value));
    onChange(Number.isFinite(n) && input.value !== "" ? Math.min(max, Math.max(min, n)) : value);
  };
  const caret = chip.createSpan({ cls: "pdt-chip-caret is-button", attr: { role: "button", tabindex: "0", "aria-label": t("filter.presets") } });
  setIcon(caret, "chevron-down");
  setTooltip(caret, t("filter.presets"));
  const open = () => {
    const menu = new Menu();
    for (const n of presets) menu.addItem((item) => item.setTitle(format(n)).setChecked(n === value).onClick(() => onChange(n)));
    const rect = chip.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  };
  caret.onclick = open;
  onActivate(caret, open);
  return chip;
}

/** A filter chip that is itself the on/off switch; typing a value turns it on. */
/** An on/off chip with a check mark. */
function switchChip(parent, { label, on, tip, onToggle }) {
  const el = parent.createDiv({ cls: `pdt-chip is-toggle${on ? " is-on" : ""}` });
  const button = el.createSpan({ cls: "pdt-toggle", attr: { role: "button", tabindex: "0", "aria-pressed": String(on) } });
  setIcon(button.createSpan({ cls: "pdt-toggle-check" }), "check");
  button.createSpan({ text: label });
  if (tip) setTooltip(button, tip);
  button.onclick = () => onToggle(!on);
  onActivate(button, () => onToggle(!on));
  return el;
}

function toggleChip(parent, { label, value, on, onToggle, onValue }) {
  const chip = parent.createDiv({ cls: `pdt-chip is-toggle${on ? " is-on" : ""}` });
  const toggle = chip.createSpan({ cls: "pdt-toggle", attr: { role: "button", tabindex: "0", "aria-pressed": String(on) } });
  setIcon(toggle.createSpan({ cls: "pdt-toggle-check" }), "check");
  toggle.createSpan({ text: label });
  setTooltip(toggle, t(on ? "filter.toggleOn" : "filter.toggleOff"));
  toggle.onclick = () => onToggle(!on);
  onActivate(toggle, () => onToggle(!on));
  const input = chip.createEl("input", { type: "number", value: String(value), attr: { min: "0", "aria-label": label } });
  input.onchange = () => onValue(Math.max(0, Math.round(Number(input.value)) || 0));
  return chip;
}

/** A SuggestModal that resolves a promise with the chosen item (or null when dismissed). */
class PickerModal extends SuggestModal {
  constructor(app, placeholder) {
    super(app);
    this.setPlaceholder(placeholder);
    this.result = new Promise((resolve) => { this.resolve = resolve; });
    this.chosen = null;
  }

  onChooseSuggestion(item) {
    this.chosen = item;
  }

  onClose() {
    // Obsidian closes the modal before reporting the choice; one tick later the choice is final
    setTimeout(() => this.resolve(this.chosen), 0);
  }
}

/** Asks for one line of text (a name); `ask()` resolves with it trimmed, or null when dismissed or left empty. */
class TextModal extends Modal {
  constructor(app, { title, value = "", cta }) {
    super(app);
    Object.assign(this, { heading: title, value, cta, answer: null });
  }

  ask() {
    return new Promise((resolve) => { this.resolve = resolve; this.open(); });
  }

  onOpen() {
    this.titleEl.setText(this.heading);
    const input = this.contentEl.createEl("input", { type: "text", value: this.value, cls: "pdt-text-input" });
    const done = () => { this.answer = input.value.trim() || null; this.close(); };
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") done(); });
    const row = this.contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: this.cta, cls: "mod-cta" }).onclick = done;
    input.select();
  }

  onClose() {
    this.contentEl.empty();
    this.resolve?.(this.answer);
  }
}

/** A small box under a button, over the view; Esc or a click outside closes it. */
class Popover {
  /** `keep`: a selector a click on doesn't close it (its own button, which toggles); `fill(box)` draws it. */
  constructor(anchor, { cls, label, keep, fill } = {}) {
    Object.assign(this, { anchor, cls, label, keep, fillWith: fill });
  }

  open() {
    this.el = document.body.createDiv({ cls: `pdt-popover ${this.cls || ""}`, attr: { role: "dialog", "aria-label": this.label || "" } });
    const at = this.anchor.getBoundingClientRect();
    this.el.style.top = `${at.bottom + 4}px`;
    this.el.style.right = `${Math.max(8, window.innerWidth - at.right)}px`;
    this.outside = (event) => { if (!this.el.contains(event.target) && !(this.keep && event.target.closest?.(this.keep))) this.close(); };
    this.esc = (event) => { if (event.key === "Escape") { event.stopPropagation(); this.close(); } };
    document.addEventListener("mousedown", this.outside, true);
    document.addEventListener("keydown", this.esc, true);
    this.render();
    return this;
  }

  get isOpen() { return Boolean(this.el); }

  close() {
    if (!this.el) return;
    document.removeEventListener("mousedown", this.outside, true);
    document.removeEventListener("keydown", this.esc, true);
    this.el.remove();
    this.el = null;
  }

  render() {
    this.el.empty();
    this.fill(this.el);
  }

  fill(box) {
    this.fillWith?.(box, this);
  }
}

/**
 * The table's column picker, under its button: the shown columns in order (drag by the grip, ✕ hides), the rest as
 * chips in groups (a click adds one at the end). Each change goes to the table behind at once; Esc or a click
 * outside closes it. Name always stays first.
 */
class ColumnsPopover extends Popover {
  constructor(anchor, { page, columns, sort, sample, onChange }) {
    super(anchor, { cls: "pdt-cols-pop", label: t("table.columns"), keep: ".pdt-table-cols" });
    Object.assign(this, { page, sort, sample, onChange, shown: [...columns] });
  }

  fill(box) {
    const head = box.createDiv({ cls: "pdt-cols-head" });
    head.createEl("b", { text: t("table.columns") });
    head.createSpan({ cls: "pdt-cols-page", text: this.page });
    const section = (label, hint) => {
      const el = box.createDiv({ cls: "pdt-cols-sec" });
      el.createSpan({ text: label });
      el.createSpan({ cls: "pdt-cols-hint", text: hint });
    };
    const row = (parent, key, label, field, value) => {
      const el = parent.createDiv({ cls: "pdt-cols-row" });
      el.dataset.key = key;
      const name = el.createSpan({ cls: "pdt-cols-name", text: label });
      if ((key === "name" ? "name" : TABLE_COLUMNS[key].sort) === this.sort) name.createSpan({ cls: "pdt-cols-sorted", text: t("table.sorted") });
      el.createSpan({ cls: "pdt-cols-field", text: field || "" });
      el.createSpan({ cls: "pdt-cols-sample", text: value });
      return el;
    };

    section(t("table.shown", { n: this.shown.length + 1 }), t("table.dragHint"));
    const lock = row(box, "name", t("col.name"), "name", t("table.fixed"));
    lock.addClass("is-fixed");
    setIcon(lock.createSpan({ cls: "pdt-cols-grip" }), "lock");
    lock.prepend(lock.lastChild);
    lock.createSpan();
    const list = box.createDiv({ cls: "pdt-cols-list" });
    for (const key of this.shown) {
      const el = row(list, key, columnLabel(key), TABLE_COLUMNS[key].field, this.sample(key));
      setIcon(el.createSpan({ cls: "pdt-cols-grip" }), "grip-vertical");
      el.prepend(el.lastChild);
      const hide = el.createEl("button", { cls: "pdt-cols-x clickable-icon", attr: { type: "button", "aria-label": t("table.hide", { name: columnLabel(key) }) } });
      setIcon(hide, "x");
      hide.onclick = () => this.save(this.shown.filter((k) => k !== key));
    }
    if (typeof Sortable !== "undefined") {
      Sortable.create(list, { handle: ".pdt-cols-grip", animation: 150, onEnd: () => this.save([...list.children].map((el) => el.dataset.key)) });
    }

    const hidden = Object.keys(TABLE_COLUMNS).filter((k) => !this.shown.includes(k));
    if (hidden.length) section(t("table.add"), t("table.addHint"));
    for (const group of ["numbers", "time", "yours", "info"]) {
      const keys = hidden.filter((k) => TABLE_COLUMNS[k].group === group);
      if (!keys.length) continue;
      const line = box.createDiv({ cls: "pdt-cols-group" });
      line.createSpan({ cls: "pdt-cols-glabel", text: t(`table.group.${group}`) });
      const chips = line.createDiv({ cls: "pdt-cols-chips" });
      for (const key of keys) {
        const { field } = TABLE_COLUMNS[key];
        const chip = chips.createEl("button", { cls: "pdt-cols-chip", text: `+ ${columnLabel(key)}`, attr: { type: "button" } });
        const value = this.sample(key);
        setTooltip(chip, [field ? `${field} · ${t(`query.field.${field}`)}` : t(`table.hint.${key}`), !["", "–", "·"].includes(value) && t("table.example", { value })].filter(Boolean).join("\n"), { delay: 300 });
        chip.onclick = () => this.save([...this.shown, key]);
      }
    }

    const foot = box.createDiv({ cls: "pdt-cols-foot" });
    const reset = foot.createEl("button", { cls: "pdt-bulk-link", text: t("table.reset"), attr: { type: "button" } });
    reset.disabled = this.shown.join() === TABLE_DEFAULT.join();
    reset.onclick = () => this.save(null);
  }

  /** Your columns (null: the default few) to the table, and this list redrawn. */
  save(columns) {
    this.shown = columns ? columns : [...TABLE_DEFAULT];
    this.onChange(columns);
    this.render();
  }
}

/** A column's name in the picker ("★" reads as "Favorite ★"). */
const columnLabel = (key) => t(key === "favorite" ? "table.favorite" : `col.${key}`);

/**
 * The search box's suggestions for the query language: fields, then the operators that fit the field, then its
 * values (your groups and statuses, authors), as you type. Obsidian's own suggestion popup.
 */
const QuerySuggest = obsidian.AbstractInputSuggest && class extends obsidian.AbstractInputSuggest {
  constructor(app, input, data) {
    super(app, input);
    Object.assign(this, { input, data });
    // opens only while typing: on focus or a click the caret isn't where it lands yet; capture runs before the suggest's own listener
    input.addEventListener("input", () => { this.typed = true; }, true);
    for (const type of ["focus", "mousedown"]) input.addEventListener(type, () => { this.typed = false; }, true);
  }

  getSuggestions() {
    const data = this.data();
    if (!this.input.value.trim()) {   // the empty box: your filters as a query, then examples (also on focus)
      Object.assign(this, { from: 0, caret: this.input.value.length });
      return queryStarters(data.fromFilters, data.recent);
    }
    if (!this.typed) return [];
    const caret = this.input.selectionStart ?? this.input.value.length;
    const { from, items } = querySuggestions(this.input.value, caret, data);
    this.from = from;
    this.caret = caret;
    return items;
  }

  renderSuggestion(item, el) {
    el.addClass("pdt-qs");
    if (item.head) el.createDiv({ cls: "pdt-qs-head", text: item.head, attr: { lang: language } });
    el.createSpan({ cls: "pdt-qs-label", text: item.label });
    if (item.hint) el.createSpan({ cls: "pdt-qs-hint", text: item.hint });
  }

  selectSuggestion(item) {
    this.close();   // the input below may redraw the box (Query mode), so this list goes first
    const value = this.input.value;
    const insert = item.insert.endsWith("(") ? item.insert : `${item.insert} `;
    this.input.value = value.slice(0, this.from) + insert + value.slice(this.caret).replace(/^[ \t]+/, "");
    const caret = this.from + insert.length;
    this.input.setSelectionRange(caret, caret);
    this.input.dispatchEvent(new Event("input"));
    this.input.focus();
  }
};

/** A few names for a sentence: "A, B, C +4". */
function namesLine(plugins, max = 5) {
  const names = plugins.slice(0, max).map((p) => p.name).join(", ");
  return plugins.length > max ? `${names} +${plugins.length - max}` : names;
}

/** Asks before a bulk action: what it does, to which plugins, that it can be undone. `ask()` resolves true or false. */
class ConfirmModal extends Modal {
  constructor(app, { title, plugins, text, cta }) {
    super(app);
    Object.assign(this, { heading: title, plugins, text, cta, answer: false });
  }

  ask() {
    return new Promise((resolve) => { this.resolve = resolve; this.open(); });
  }

  onOpen() {
    this.titleEl.setText(this.heading);
    const list = this.contentEl.createEl("ul", { cls: "pdt-confirm-list" });
    for (const p of this.plugins.slice(0, 5)) list.createEl("li", { text: p.name });
    if (this.plugins.length > 5) list.createEl("li", { cls: "pdt-detail-muted", text: t("bulk.more", { n: this.plugins.length - 5 }) });
    if (this.text) this.contentEl.createEl("p", { text: this.text });
    this.contentEl.createEl("p", { cls: "pdt-detail-muted", text: t("bulk.undoable") });
    const row = this.contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: t("bulk.cancel") }).onclick = () => this.close();
    const go = row.createEl("button", { text: this.cta, cls: "mod-cta" });
    go.onclick = () => { this.answer = true; this.close(); };
    go.focus();
  }

  onClose() {
    this.contentEl.empty();
    this.resolve?.(this.answer);
  }
}

/** Recent actions: the last bulk actions, newest first, each with Undo (or when it was undone). */
class RecentModal extends Modal {
  constructor(plugin, onUndo) {
    super(plugin.app);
    Object.assign(this, { plugin, onUndo });
  }

  onOpen() {
    this.titleEl.setText(t("bulk.recent"));
    this.render();
  }

  render() {
    const box = this.contentEl;
    box.empty();
    box.createEl("p", { cls: "pdt-detail-muted", text: t("bulk.recentHint", { n: OPS_CAP }) });
    // reviewed marks set on one day for many plugins (before Recent actions existed): taken back here
    for (const { date, ids } of this.plugin.massReviews()) {
      const row = box.createDiv({ cls: "pdt-op" });
      row.createSpan({ cls: "pdt-op-when", text: date });
      const what = row.createDiv({ cls: "pdt-op-what" });
      what.createEl("b", { text: t("bulk.massReviewed", { n: ids.length }) });
      what.createSpan({ cls: "pdt-detail-muted", text: t("bulk.massHint") });
      row.createEl("button", { text: t("bulk.unreview") }).onclick = async () => { await this.plugin.unreview(date); this.render(); };
    }
    const ops = this.plugin.data.ops || [];
    if (!ops.length) box.createEl("p", { text: t("bulk.recentNone") });
    for (const op of ops) {
      const row = box.createDiv({ cls: "pdt-op" });
      row.createSpan({ cls: "pdt-op-when", text: formatTime(op.at, Date.now()) });
      const what = row.createDiv({ cls: "pdt-op-what" });
      what.createEl("b", { text: opLabel(op) });
      what.createSpan({ cls: "pdt-detail-muted", text: namesLine(op.changes.map((c) => this.plugin.pluginById(c.id) || { name: c.id }), 3) });
      if (op.undone) row.createSpan({ cls: "pdt-detail-muted", text: t("bulk.undone") });
      else if (op.changes.length) {
        row.createEl("button", { text: t("bulk.undo") }).onclick = async () => { await this.onUndo(op); this.render(); };
      }
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** What an operation did, in a sentence: "3 plugins hidden", "12 plugins added to Tasks". */
function opLabel(op) {
  return t(`bulk.done.${op.kind}`, { n: op.changes.length, value: op.value ?? "" });
}

/** A group chip: a button you switch on and off. */
function groupChip(parent, { name, on, removable = false, star = false, starTip = "", meta = "", onToggle }) {
  const chip = parent.createEl("button", { cls: `pdt-gchip${on ? " is-on" : ""}`, attr: { type: "button", "aria-pressed": String(on) } });
  if (on && !removable) setIcon(chip.createSpan({ cls: "pdt-gchip-icon" }), "check");
  chip.createSpan({ text: name });
  if (star) {
    setIcon(chip.createSpan({ cls: "pdt-gchip-star" }), "star");
    setTooltip(chip, starTip);
  }
  if (meta) chip.createSpan({ cls: "pdt-gchip-meta", text: meta });
  if (removable) setIcon(chip.createSpan({ cls: "pdt-gchip-icon" }), "x");
  chip.onclick = onToggle;
  return chip;
}

/**
 * One plugin's groups: the selected ones, your groups (the closest starred), AI suggestions and a box
 * for a new name. `result` resolves with the chosen groups on Confirm, or null when closed.
 */
class GroupModal extends Modal {
  constructor(plugin, target) {
    super(plugin.app);
    this.plugin = plugin;
    this.target = target;
    const note = plugin.notes.index.get(target.id);
    this.mine = plugin.notes.groups();
    this.closest = plugin.closestGroupFor(target);
    this.touched = Boolean(note?.groups.length);
    this.selected = this.touched ? [...note.groups] : this.closest ? [this.closest] : [];
    this.ai = { state: plugin.translator.ready ? "loading" : "setup", list: [], error: "" };
    this.showAll = false;
    this.draft = "";
    this.saved = null;
    this.result = new Promise((resolve) => { this.resolve = resolve; });
  }

  onOpen() {
    this.modalEl.addClass("pdt-group-modal");
    this.render();
    if (this.ai.state === "loading") this.loadSuggestions();
  }

  onClose() {
    this.contentEl.empty();
    this.resolve(this.saved);
  }

  async loadSuggestions() {
    try {
      const list = await this.plugin.suggestGroups(this.target);
      const known = new Set(this.mine.map((g) => g.name));
      const pick = list.find((g) => known.has(g));
      if (pick) this.closest = pick;   // the model's choice among your groups beats word overlap
      if (!this.touched) this.selected = this.closest ? [this.closest] : [];
      this.ai = { state: "ready", list: list.filter((g) => !known.has(g)), error: "" };
    } catch (error) {
      this.ai = { state: "failed", list: [], error: error.message };
    }
    this.render();
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
      const known = [...this.mine.map((g) => g.name), ...this.ai.list].find((g) => g.toLocaleLowerCase() === typed.toLocaleLowerCase());
      const name = known || typed;
      if (!this.selected.includes(name)) this.selected = [...this.selected, name];
      this.touched = true;
    }
    this.render();
  }

  render() {
    const el = this.contentEl;
    el.empty();
    this.titleEl.setText(this.target.version ? `${this.target.name} ${this.target.version}` : this.target.name);
    if (this.target.description) el.createEl("p", { cls: "pdt-gm-desc", text: this.target.description });
    const translation = this.plugin.cachedTranslation(this.target);
    if (translation) el.createDiv({ cls: "pdt-trans", text: translation });

    const section = (label) => {
      const box = el.createDiv({ cls: "pdt-gm-section" });
      box.createDiv({ cls: "pdt-gm-label", text: label, attr: { lang: language } });   // uppercase by the UI's rules, not Obsidian's (i → I, not İ)
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

    const { state, list, error } = this.ai;
    const ai = section(state === "ready" ? t("groups.aiCount", { n: list.length }) : t("groups.ai"));
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

/** Model picker: filters as you type, shows prices, accepts names that aren't listed. */
class ModelModal extends PickerModal {
  constructor(app, models) {
    super(app, t("model.placeholder"));
    this.models = models;
    this.latestOnly = false;
  }

  onOpen() {
    super.onOpen?.();
    const container = this.inputEl?.parentElement;
    if (!container) return;
    const bar = createDiv({ cls: "pdt-model-bar" });
    container.after(bar);
    const toggle = bar.createDiv({ cls: "pdt-chip is-menu", text: t("model.latestOnly"), attr: { role: "button", tabindex: "0" } });
    const flip = () => {
      this.latestOnly = !this.latestOnly;
      toggle.toggleClass("is-active", this.latestOnly);
      this.inputEl.dispatchEvent(new Event("input"));
    };
    toggle.onclick = flip;
    onActivate(toggle, flip);
  }

  getSuggestions(query) {
    return filterModels(this.models, query, this.latestOnly);
  }

  renderSuggestion(model, el) {
    el.addClass("pdt-model-item");
    el.createDiv({ cls: "pdt-model-id", text: model.custom ? t("model.custom", { name: model.id }) : model.id });
    if (model.price) el.createDiv({ cls: "pdt-model-price", text: formatPrice(model.price) });
  }
}


/**
 * The query cheat sheet: fields (with what they mean), operators, functions, values. A click puts it in the box
 * (`onPick`) and closes.
 */
class QueryHelpModal extends Modal {
  constructor(app, onPick) {
    super(app);
    this.onPick = onPick;
  }

  onOpen() {
    this.titleEl.setText(t("query.help.title"));
    this.modalEl.addClass("pdt-qhelp");
    const group = (title, items) => {
      this.contentEl.createEl("h4", { text: title });
      const list = this.contentEl.createDiv({ cls: "pdt-qhelp-list" });
      for (const [text, hint] of items) {
        const item = list.createEl("button", { cls: "pdt-qhelp-item", attr: { type: "button" } });
        item.createEl("code", { text });
        if (hint) item.createSpan({ text: hint });
        item.onclick = () => { this.close(); this.onPick(text); };
      }
    };
    group(t("query.help.fields"), Object.keys(QUERY_FIELDS).map((k) => [k, t(`query.field.${k}`)]));
    group(t("query.help.ops"), [["=", t("query.op.=")], ["!=", t("query.op.!=")], [">=", t("query.op.>=")], ["<=", t("query.op.<=")], ["~", t("query.op.~")], ["!~", t("query.op.!~")],
      ["in (", t("query.op.in")], ["not in (", t("query.op.not_in")], ["is empty", t("query.op.is_empty")], ["AND", ""], ["OR", ""], ["NOT", ""], ["order by", ""]]);
    group(t("query.help.functions"), QUERY_FUNC_NAMES.map((f) => [`${f}()`, t(`query.fn.${f}`)]));
    group(t("query.help.values"), [["10k", "10 000"], ["1.5m", "1 500 000"], ["30d", t("query.help.days")], ["2w · 6m · 1y", ""], ["2026-01-01", t("query.help.date")], ['"two words"', t("query.help.quoted")]]);
  }

  onClose() {
    this.contentEl.empty();
  }
}
