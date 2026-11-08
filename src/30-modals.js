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

/** A chip with a typed whole number (e.g. "Last [7] days"); the caret opens presets in Obsidian's menu. */
function numberChip(parent, { label, unit, value, min, max, presets, onChange }) {
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
    for (const n of presets) menu.addItem((item) => item.setTitle(t("filter.days", { n })).setChecked(n === value).onClick(() => onChange(n)));
    const rect = chip.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  };
  caret.onclick = open;
  onActivate(caret, open);
  return chip;
}

/** A filter chip that is itself the on/off switch; typing a value turns it on. */
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

