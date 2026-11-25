// ─── 4a. UI primitives, Popover, QuerySuggest, ResultModal ──────────────────

/** Marks `box` as being translated with pure-CSS effect `fx` (TRANSLATE_FX), staggering inline lines by `--i`. */
function showReading(box, fx, first = 0) {
  box.classList.add("is-translating", `pdt-fx-${fx}`);
  box.querySelectorAll(".pdt-ln, .pdt-lang-text").forEach((el, i) => el.style.setProperty("--i", String(first + i)));
}

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

/** Obsidian's menu of `options` ([value, title]) right under `anchor`; `current` checked. */
function showMenuBelow(anchor, options, current, onPick) {
  const menu = new Menu();
  for (const [value, title] of options) {
    menu.addItem((item) => item.setTitle(title).setChecked(value === current).onClick(() => onPick(value)));
  }
  const rect = anchor.getBoundingClientRect();
  return menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
}

/** A filter chip whose options open in Obsidian's own menu. */
function menuChip(parent, label, options, current, onPick) {
  const chip = parent.createDiv({ cls: "pdt-chip is-menu", attr: { role: "button", tabindex: "0" } });
  chip.createSpan({ text: label });
  const selected = options.some(([value]) => value === current) ? current : options[0][0];
  chip.createSpan({ cls: "pdt-chip-value", text: options.find(([value]) => value === selected)[1] });
  setIcon(chip.createSpan({ cls: "pdt-chip-caret" }), "chevron-down");
  const open = () => showMenuBelow(chip, options, selected, onPick);
  chip.onclick = open;
  onActivate(chip, open);
  return chip;
}

/** A chip with a typed whole number (e.g. "Last [7] days"); the caret opens presets in Obsidian's menu. */
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

/** An on/off chip: a check mark and the label; a click or Enter flips it. */
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

/** A few names for a sentence: "A, B, C +4". */
function namesLine(plugins, max = 5) {
  const names = plugins.slice(0, max).map((p) => p.name).join(", ");
  return plugins.length > max ? `${names} +${plugins.length - max}` : names;
}

/** What an operation did, in a sentence: "3 plugins hidden", "12 plugins added to Tasks". */
function opLabel(op) {
  return t(`bulk.done.${opKey(op)}`, { n: op.changes.length, value: op.value ?? "" });
}

/** The texts an operation goes by: its kind, but "unrate" for a rating cleared. */
function opKey({ kind, value }) {
  return kind === "rating" && value == null ? "unrate" : kind;
}

/** A column's name in the picker (the 🔖 column reads as "Library 🔖"). */
const columnLabel = (key) => t(key === "library" ? "table.library" : `col.${key}`);

/**
 * How far what a job took was from its estimate: "16% under the estimate" / "8% over" / "as estimated", by cost when
 * both have one, else by tokens; null when there's nothing to compare.
 */
function estimateGap(usage, expected) {
  const byCost = typeof usage.cost === "number" && expected.cost != null;
  const [got, want] = byCost ? [usage.cost, expected.cost] : [usage.tokens, expected.tokens];
  if (!want || got == null) return null;
  const pct = Math.round(((got - want) / want) * 100);
  if (pct === 0) return t("bulk.tr.asEstimated");
  return t(pct < 0 ? "bulk.tr.underEstimate" : "bulk.tr.overEstimate", { n: Math.abs(pct) });
}

/** What AI requests spent, as the provider reported it: "18,420 tokens · $0.0021" (the cost only when it told it). */
function spentText(usage) {
  return [t("details.tokensUsed", { n: formatCount(usage.tokens) }), typeof usage.cost === "number" ? formatCost(usage.cost) : null].filter(Boolean).join(" · ");
}

/** What an AI request just took, faint at the end of a title row. */
function usageTag(parent, usage) {
  const tag = parent.createSpan({ cls: "pdt-usage-tag", text: typeof usage.cost === "number" ? formatCost(usage.cost) : t("details.tokensUsed", { n: formatShort(usage.tokens) }) });
  setTooltip(tag, `${usage.model} · ${t("details.tokensUsed", { n: formatShort(usage.tokens) })}`);
}

/** Base class for modals that resolve a single answer when closed (`ask()` or `this.result`). */
class ResultModal extends Modal {
  constructor(app, fallback = null) {
    super(app);
    this.answer = fallback;
    this.closed = false;
  }

  ask() {
    return new Promise((resolve) => { this.resolve = resolve; this.open(); });
  }

  onClose() {
    this.closed = true;
    this.contentEl.empty();
    this.resolve?.(this.answer);
  }
}

/** Asks for one line of text (a name); `ask()` resolves with it trimmed, or null when dismissed or left empty. */
class TextModal extends ResultModal {
  constructor(app, { title, value = "", cta }) {
    super(app, null);
    Object.assign(this, { heading: title, value, cta });
  }

  onOpen() {
    this.titleEl.setText(this.heading);
    const input = this.contentEl.createEl("input", { type: "text", value: this.value, cls: "pdt-text-input", attr: { "aria-label": this.heading } });
    const done = () => { this.answer = input.value.trim() || null; this.close(); };
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") done(); });
    const row = this.contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: t("bulk.cancel"), attr: { type: "button" } }).onclick = () => this.close();
    row.createEl("button", { text: this.cta, cls: "mod-cta", attr: { type: "button" } }).onclick = done;
    input.focus();
    input.select();
  }
}

/** Asks before a bulk action: what it does, to which plugins, that it can be undone. `ask()` resolves true or false. */
class ConfirmModal extends ResultModal {
  /** @param {string} [footnote]  the faint line under the text; by default that Recent actions can undo it */
  constructor(app, { title, plugins = [], text, cta, footnote = t("bulk.undoable") }) {
    super(app, false);
    Object.assign(this, { heading: title, plugins, text, cta, footnote });
  }

  onOpen() {
    this.titleEl.setText(this.heading);
    if (this.plugins.length) {
      const list = this.contentEl.createEl("ul", { cls: "pdt-confirm-list" });
      for (const p of this.plugins.slice(0, 5)) list.createEl("li", { text: p.name });
      if (this.plugins.length > 5) list.createEl("li", { cls: "pdt-detail-muted", text: t("bulk.more", { n: this.plugins.length - 5 }) });
    }
    if (this.text) this.contentEl.createEl("p", { text: this.text });
    if (this.footnote) this.contentEl.createEl("p", { cls: "pdt-detail-muted", text: this.footnote });
    const row = this.contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: t("bulk.cancel"), attr: { type: "button" } }).onclick = () => this.close();
    const go = row.createEl("button", { text: this.cta, cls: "mod-cta", attr: { type: "button" } });
    go.onclick = () => { this.answer = true; this.close(); };
    go.focus();
  }
}

/**
 * A floating box anchored under (or above) a button; pop-out window safe, viewport-clamped for mobile,
 * closes on Esc or outside pointerdown/mousedown, and never leaks listeners on double open().
 */
class Popover {
  constructor(anchor, { cls, label, keep, fill, above = false, onClose = null } = {}) {
    Object.assign(this, { anchor, cls, label, keep, above, fillWith: fill, onCloseCb: onClose });
  }

  open() {
    if (this.el) this.close();
    const doc = this.anchor.ownerDocument || document;
    const win = doc.defaultView || window;
    this.doc = doc;
    this.el = doc.body.createDiv({ cls: `pdt-popover ${this.cls || ""}`, attr: { role: "dialog", "aria-label": this.label || "" } });
    this.outside = (event) => { if (!this.el?.contains(event.target) && !(this.keep && event.target.closest?.(this.keep))) this.close(); };
    this.esc = (event) => { if (event.key === "Escape") { event.stopPropagation(); this.close(); } };
    doc.addEventListener("pointerdown", this.outside, true);
    doc.addEventListener("mousedown", this.outside, true);
    doc.addEventListener("keydown", this.esc, true);
    this.render();
    this.position(win);
    return this;
  }

  position(win) {
    if (!this.el) return;
    const at = this.anchor.getBoundingClientRect();
    const vw = win.innerWidth || 0;
    const vh = win.innerHeight || 0;
    const w = this.el.offsetWidth || 0;
    if (this.above) {
      this.el.style.bottom = `${Math.max(8, vh - at.top + 6)}px`;
      const left = w && vw ? Math.min(Math.max(8, at.left), Math.max(8, vw - w - 8)) : Math.max(8, at.left);
      this.el.style.left = `${left}px`;
    } else {
      this.el.style.top = `${Math.max(8, at.bottom + 4)}px`;
      const right = Math.max(8, vw - at.right);
      const clampedRight = w && vw && vw - right - w < 8 ? Math.max(8, vw - w - 8) : right;
      this.el.style.right = `${clampedRight}px`;
    }
  }

  get isOpen() { return Boolean(this.el); }

  close() {
    if (!this.el) return;
    this.doc?.removeEventListener("pointerdown", this.outside, true);
    this.doc?.removeEventListener("mousedown", this.outside, true);
    this.doc?.removeEventListener("keydown", this.esc, true);
    this.el.remove();
    this.el = null;
    this.onCloseCb?.();
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
 * The table's column picker, under its button: shown columns in order (drag by grip or move with arrows, ✕ hides),
 * hidden columns as chips. Destroys its Sortable instance before every redraw and on close (zero DOM leaks).
 */
class ColumnsPopover extends Popover {
  constructor(anchor, { page, columns, sort, sample, onChange, onClose }) {
    super(anchor, { cls: "pdt-cols-pop", label: t("table.columns"), keep: ".pdt-table-cols", onClose });
    Object.assign(this, { page, sort, sample, onChange, shown: [...columns], sortable: null });
  }

  close() {
    this.sortable?.destroy();
    this.sortable = null;
    super.close();
  }

  fill(box) {
    this.sortable?.destroy();
    this.sortable = null;
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
    if (typeof Sortable !== "undefined" && list.children.length) {
      this.sortable = Sortable.create(list, {
        handle: ".pdt-cols-grip", animation: 150, delayOnTouchOnly: true, delay: 120,
        onEnd: (evt) => { if (evt.oldIndex !== evt.newIndex) this.save([...list.children].map((el) => el.dataset.key)); },
      });
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

  save(columns) {
    this.shown = columns ? columns : [...TABLE_DEFAULT];
    this.onChange(columns);
    this.render();
  }
}

/** The search box's suggestions for the query language: Obsidian's own suggestion popup. */
const QuerySuggest = obsidian.AbstractInputSuggest && class extends obsidian.AbstractInputSuggest {
  constructor(app, input, data) {
    super(app, input);
    Object.assign(this, { input, data });
    input.addEventListener("input", () => { this.typed = true; }, true);
    for (const type of ["focus", "mousedown"]) input.addEventListener(type, () => { this.typed = false; }, true);
  }

  getSuggestions() {
    const data = this.data();
    if (!this.input.value.trim()) {
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
    this.close();
    const value = this.input.value;
    const insert = item.insert.endsWith("(") ? item.insert : `${item.insert} `;
    this.input.value = value.slice(0, this.from) + insert + value.slice(this.caret).replace(/^[ \t]+/, "");
    const caret = this.from + insert.length;
    this.input.setSelectionRange(caret, caret);
    this.input.dispatchEvent(new Event("input"));
    this.input.focus();
  }
};
