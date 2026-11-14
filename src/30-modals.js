// ─── 4. UI ──────────────────────────────────────────────────────────────────
const $ = (root, selector) => root.querySelector(selector);

/** Obsidian's own tooltip (1.4.4+); falls back to the browser tooltip. */
const setTooltip = obsidian.setTooltip || ((el, text) => el.setAttribute("title", text));

function onActivate(el, handler) {
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handler(); }
  });
}

/**
 * A small round icon button inside a chip, tab or toast (✕ close, ‹ back, ↺ reset). Its click stays with it, so it
 * never also opens what it sits on.
 */
function smallButton(parent, icon, tip, onClick, cls = "") {
  const button = parent.createEl("button", { cls: `pdt-similar-step ${cls}`.trim(), attr: { type: "button", "aria-label": tip } });
  setIcon(button, icon);
  setTooltip(button, tip);
  button.onclick = (event) => {
    event?.stopPropagation?.();
    onClick();
  };
  return button;
}

/** Obsidian's built-in icon button look (clickable-icon): transparent, highlighted on hover. */
function iconButton(parent, icon, tip, cls = "") {
  const button = parent.createDiv({ cls: `clickable-icon pdt-icon ${cls}`.trim(), attr: { "aria-label": tip, role: "button", tabindex: "0" } });
  setIcon(button, icon);
  setTooltip(button, tip);
  onActivate(button, () => button.click());
  return button;
}

/** Obsidian's menu of `options` ([value, title]) right under `anchor`, `current` checked; a pick calls onPick(value). */
function showMenuBelow(anchor, options, current, onPick) {
  const menu = new Menu();
  for (const [value, title] of options) {
    menu.addItem((item) => item.setTitle(title).setChecked(value === current).onClick(() => onPick(value)));
  }
  const rect = anchor.getBoundingClientRect();
  menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  return menu;
}

/** A filter chip whose options open in Obsidian's own menu. */
function menuChip(parent, label, options, current, onPick) {
  const chip = parent.createDiv({ cls: "pdt-chip is-menu", attr: { role: "button", tabindex: "0" } });
  chip.createSpan({ text: label });
  const selected = options.some(([value]) => value === current) ? current : options[0][0];  // invalid here → first option
  chip.createSpan({ cls: "pdt-chip-value", text: options.find(([value]) => value === selected)[1] });
  setIcon(chip.createSpan({ cls: "pdt-chip-caret" }), "chevron-down");
  const open = () => showMenuBelow(chip, options, selected, onPick);
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
  const open = () => showMenuBelow(chip, presets.map((n) => [n, format(n)]), value, onChange);
  caret.onclick = open;
  onActivate(caret, open);
  return chip;
}

/** An on/off chip: a check mark and the label; a click or Enter flips it. Returns the chip (more can go inside). */
function switchChip(parent, { label, on, tip, onToggle }) {
  const chip = parent.createDiv({ cls: `pdt-chip is-toggle${on ? " is-on" : ""}` });
  const button = chip.createSpan({ cls: "pdt-toggle", attr: { role: "button", tabindex: "0", "aria-pressed": String(on) } });
  setIcon(button.createSpan({ cls: "pdt-toggle-check" }), "check");
  button.createSpan({ text: label });
  if (tip) setTooltip(button, tip);
  button.onclick = () => onToggle(!on);
  onActivate(button, () => onToggle(!on));
  return chip;
}

/** A filter chip that is itself the on/off switch, with a number to type (Downloads ≥ [100]). */
function toggleChip(parent, { label, value, on, onToggle, onValue }) {
  const chip = switchChip(parent, { label, on, tip: t(on ? "filter.toggleOn" : "filter.toggleOff"), onToggle });
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


/** Where the full query guide lives (the Help window's last link). */
const GUIDE_URL = "https://github.com/alitekdemir/obsidian-community-radar/blob/main/docs/query.md";

/** The query guide's field groups, from each field's own type (no second list to keep): which group a field is in. */
function fieldGroup(field) {
  if (field.param) return "params";
  if (field.days) return "days";
  return { text: "text", number: "numbers" }[field.type] || "flags";   // flags: yes/no and your note's lists
}

/** The guide's rows after the fields: what's shown, what a click puts in the box, and its text (help.<key>). */
const GUIDE_ROWS = {
  ops: [["=  /  !=", "=", "help.op.eq"], [">  /  >=", ">=", "help.op.gt"], ["<  /  <=", "<=", "help.op.lt"], ["~  /  !~", "~", "help.op.has"],
    ["in (…) / not in (…)", "in (", "help.op.in"], ["is empty", "is empty", "help.op.empty"], ["AND / OR / NOT", "AND", "help.op.bool"], ["order by … desc", "order by", "help.op.order"]],
  functions: Object.keys(QUERY_FUNCS).map((f) => [`${f}()`, `${f}()`, `query.fn.${f}`]),   // the same text as the box's hints
  values: [["10k · 1.5m", "10k", "help.value.count"], ["14d · 2w · 6m · 1y", "14d", "help.value.span"], ["2026-01-01", "2026-01-01", "help.value.date"],
    [null, '""', "help.value.quoted"], ['("Tasks", Calendar)', "(", "help.value.list"]],   // null: the example is in your language
};

/**
 * Help: Quick start (three steps, each one click), Ready-made queries (the gallery) and the Query guide (fields by
 * group, operators, date functions, values). Opened from the view's ? (`tab`), the query box's ? (the guide; a
 * click on an item puts it in the box: `onPick`), the Quick start card and the Help command.
 */
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

  /** Three steps, each with what to do and a button that does it. */
  renderStart(el) {
    const view = this.view;
    const steps = [
      ["explore", () => { view.settings.section = "list"; return view.update("mode", "all"); }],
      ["track", () => view.openPage("tracked")],
      ["query", () => view.openQuery("gain(30d) >= 500 AND NOT tracked\norder by gain(30d) desc")],
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
    el.createEl("a", { cls: "pdt-help-more", text: t("help.more"), href: GUIDE_URL });
  }

  /** The query language in short: fields by group, then operators, date functions and values; a group may carry a hint. */
  renderGuide(el) {
    const group = (key, rows) => {
      const head = el.createEl("h4");
      head.createSpan({ cls: "pdt-help-group-name", text: t(`help.group.${key}`) });
      const hint = t(`help.group.${key}.hint`);
      if (hint !== `help.group.${key}.hint`) head.createSpan({ cls: "pdt-help-group-hint", text: `· ${hint}` });   // only some groups have one
      const list = el.createDiv({ cls: "pdt-help-list" });
      for (const [code, insert, text] of rows) {
        const item = list.createEl(this.onPick ? "button" : "div", { cls: "pdt-help-item", attr: this.onPick ? { type: "button" } : {} });
        item.createEl("code", { text: code });
        item.createSpan({ text });
        if (this.onPick) item.onclick = () => { this.close(); this.onPick(insert); };
      }
    };
    // a field as it's written: gain(30d) for one with a parameter
    const written = (k) => { const p = QUERY_FIELDS[k].param; return p ? `${k}(${p.fallback ?? "10k"})` : k; };
    for (const key of ["text", "numbers", "days", "params", "flags"]) {
      const fields = Object.keys(QUERY_FIELDS).filter((k) => fieldGroup(QUERY_FIELDS[k]) === key);
      group(key, fields.map((k) => [written(k), written(k), t(`query.field.${k}`)]));
    }
    for (const [key, rows] of Object.entries(GUIDE_ROWS)) group(key, rows.map(([code, insert, text]) => [code ?? t(`${text}.code`), insert, t(text)]));
    el.createEl("a", { cls: "pdt-help-more", text: t("help.more"), href: GUIDE_URL });
  }
}

/**
 * The ready-made queries (QUERY_PRESETS) by section, after your hidden widgets to bring back. Each row says what it
 * finds and why it helps, shows its query and how many plugins it finds now; Add saves it as a view (a Home widget
 * that marks new matches), "Try in query" opens it in the list to edit first. Drawn into any element: "+ Add widget"
 * and Help's Ready-made queries share it; `close` closes the window it's in.
 */
class GalleryPanel {
  /** `target`: the group a group's "Add widget" opened it for (else the Add window asks where). */
  constructor(home, close, target = null) {
    Object.assign(this, { home, close, target, section: "all", open: null });   // open: the query whose row is unfolded
  }

  /** The rows of every section, worked out now: [{section, rows: [{title, desc, why, query, count, action, done, run}]}]. */
  sections(ctx) {
    const home = this.home.home;
    const hidden = unplacedWidgets(home).map((id) => {
      const widget = homeWidget(home, id);
      const params = widgetParams(home, id);
      const title = this.home.title(id);
      return {
        title,
        desc: widget.view ? "" : this.home.widgetInfo(id, params),
        query: widget.query(ctx, params), count: widgetRows(ctx, widget, params).length, action: t("gallery.restore"),
        run: async () => {
          const at = await this.home.ask({ id, widget, name: title, groupId: this.target });
          if (at) await this.home.place(id, at.group);
        },
      };
    });
    const preset = (p) => {
      const title = t(`preset.${p.key}`);
      const rows = queryRows(ctx, p.query);
      const done = (home.views || []).some((v) => sameQuery(v.query, p.query));   // added already
      const widget = viewWidget({ id: "preview", name: title, query: p.query }, null);   // how it will look, before it's saved
      return { title, desc: t(`preset.${p.key}.desc`), why: t(`preset.${p.key}.why`), query: p.query, count: rows.length,
        action: t(done ? "gallery.added" : "gallery.add"), done,
        run: async () => {
          const at = await this.home.ask({ id: VIEW_PREFIX + widget.view.id, widget, name: title, groupId: this.target });
          if (at) await this.home.saveView(title, p.query, rows, at.group);
        } };
    };
    return Object.keys(GALLERY_SECTIONS)
      .map((section) => ({ section, rows: section === "hidden" ? hidden : QUERY_PRESETS.filter((p) => p.cat === section).map(preset) }))
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
    for (const s of sections) if (this.section === "all" || this.section === s.section) this.renderSection(el, s, () => this.render(host));

    const foot = el.createDiv({ cls: "pdt-gallery-foot" });
    foot.createSpan({ text: t("gallery.own") });
    const own = foot.createEl("button", { text: t("gallery.openQuery"), attr: { type: "button" } });
    own.onclick = () => { this.close(); this.home.view.openQuery(""); };
  }

  /**
   * A section: its heading, then one row per widget or preset. A row is one line (title, what it finds, count, Add);
   * a click on it unfolds why it helps, its whole query and "Try in query".
   */
  renderSection(el, { section, rows }, redraw) {
    const head = el.createDiv({ cls: "pdt-gallery-head", attr: { "data-section": section } });   // data-section: its tone (CSS)
    head.createEl("h3", { text: t(`gallery.section.${section}`) });
    head.createSpan({ text: t(`gallery.section.${section}.hint`) });
    for (const row of rows) {
      const open = this.open === row.query;
      const item = el.createDiv({ cls: `pdt-gallery-row${open ? " is-open" : ""}`, attr: { "data-section": section } });
      const line = item.createDiv({ cls: "pdt-gallery-line", attr: { role: "button", tabindex: "0", "aria-expanded": String(open) } });
      const toggle = () => { this.open = open ? null : row.query; redraw(); };
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
      act.onclick = async () => { await row.run(); redraw(); };

      const more = item.createDiv({ cls: "pdt-gallery-more" });   // shown when the row is open (CSS)
      if (row.why) more.createDiv({ cls: "pdt-gallery-why", text: row.why });
      const query = more.createDiv({ cls: "pdt-gallery-query" });
      query.createEl("code", { text: row.query });
      const tryIt = query.createEl("button", { cls: "pdt-gallery-try", text: t("gallery.try"), attr: { type: "button" } });
      tryIt.onclick = () => { this.close(); this.home.view.openQuery(row.query); };
    }
  }
}

/** "+ Add widget": the gallery in a window of its own; from a group's ⋯, it adds into that group. */
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
    this.contentEl.empty();
  }
}

const NEW_GROUP = "\u0000new";   // the group list's "+ New group…" (no group id can be it)

/**
 * Where a widget goes on Home: a small or a big card, each drawn as it will look (the small one after the group's
 * last cards), then a group of that kind or a new one. With `askName` (the list saved as a widget) its name first.
 * `ask()` resolves {name, group} (a new group is made, unsaved: placing it saves) or null.
 */
class PlaceModal extends Modal {
  constructor(home, { id, widget, name, askName, groupId }) {
    super(home.plugin.app);
    const target = home.home.groups.find((g) => g.id === groupId);
    Object.assign(this, { home, id, widget, name, askName, look: target?.look ?? "big", group: groupId, newName: "", answer: null });
  }

  ask() {
    return new Promise((resolve) => { this.resolve = resolve; this.open(); });
  }

  onOpen() {
    this.titleEl.setText(t(this.askName ? "home.view.saveTitle" : "home.place.title"));
    this.modalEl.addClass("pdt-place-modal");
    this.draw();
  }

  onClose() {
    this.contentEl.empty();
    this.resolve?.(this.answer);
  }

  /** The groups of the chosen kind; the pick stays when it's one of them, else the first (none: a new one). */
  groups() {
    const groups = this.home.home.groups.filter((g) => g.look === this.look);
    if (this.group !== NEW_GROUP && !groups.some((g) => g.id === this.group)) this.group = groups[0]?.id ?? NEW_GROUP;
    return groups;
  }

  draw() {
    const el = this.contentEl;
    el.empty();
    if (this.askName) {
      const name = el.createEl("input", { type: "text", value: this.name, cls: "pdt-text-input pdt-place-name", attr: { "aria-label": t("home.place.name") } });
      name.oninput = () => { this.name = name.value; };
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
      // each option draws the card the way it will look: the small one among the chosen small group's cards
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
