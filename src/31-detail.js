/** A short tag for the language translations go to: its code when the UI has it ("Türkçe" → TR), else its start. */
const languageTag = (name) => (Object.keys(LOCALE_NAMES).find((code) => LOCALE_NAMES[code] === name)
  || Object.keys(STRINGS).find((code) => STRINGS[code]["language.name"] === name)
  || String(name).slice(0, 2)).toUpperCase();

/**
 * A text in one language at a time behind its language chip: "文A EN", or "文A TR" (blue) when it shows the
 * translation. A click on the chip calls `swap` (it asks the AI the first time, then redraws); the text swaps in
 * place, so nothing moves. Used by the details window, the list's rows and cards, and the table's Description.
 * @returns {HTMLElement} the text's span
 */
function languageChip(parent, { original, translation, translated, target, swap }) {
  const chip = parent.createEl("button", { cls: `pdt-lang-chip${translated ? " is-on" : ""}`, attr: { type: "button", "aria-pressed": String(translated) } });
  setIcon(chip.createSpan({ cls: "pdt-lang-chip-icon" }), "languages");
  chip.createSpan({ text: translated ? languageTag(target) : "EN" });
  setTooltip(chip, t(translated ? "details.descOriginalTip" : "row.translateTip"));
  chip.onclick = swap;
  const text = parent.createSpan({ cls: "pdt-lang-text", text: translated ? translation : original });
  if (!translated) text.setAttribute("lang", "en");
  return text;
}

/**
 * What an AI job will take (PluginRadar.estimate): "12,400 characters · ≈ 6,200 tokens · ≈ $0.01 · model". Before
 * the model has done a few of the kind, the cost is the list price's floor: "≥ $0.01".
 */
function estimateLine(estimate, settings) {
  return [estimate.chars ? t("details.chars", { n: formatCount(estimate.chars) }) : null, ...estimateHint(estimate), settings.model].filter(Boolean).join(" · ");
}

/** A menu's hint for an AI job: its tokens, then its cost (when the price is known), one a line. */
function estimateHint(estimate) {
  return [t("details.tokens", { n: formatCount(estimate.tokens) }), estimateCost(estimate)].filter(Boolean);
}

/** An estimate's cost: "≈ $0.21" once measured, "≥ $0.13" from the list price; null when the price is unknown. */
function estimateCost(estimate) {
  return estimate.cost != null ? t(estimate.measured ? "details.cost" : "details.costMin", { cost: formatCost(estimate.cost) }) : null;
}

/**
 * A plugin's details in a large window that grows out of its card or row: the name with the description under it,
 * the numbers, then Overview (the AI profile, its categories and tags at the bottom) and README tabs, each in the
 * original or your language; on the side what it needs, the closest plugins and, pinned at the bottom, the release
 * history. ←/→ walk the list it was opened from, the list's shortcut keys work here too
 * (when turned on), a right click opens the row's menu; Esc closes.
 */
class DetailModal extends Modal {
  constructor(view, rows, index, origin) {
    super(view.app);
    this.view = view;
    this.plugin = view.plugin;
    this.rows = [...rows];
    this.index = Math.max(0, index);
    this.origin = origin;
    this.tab = null;            // "overview" | "readme"; null: the first one this plugin has
    this.loads = new Map();     // id → "busy" | "done": a README fetched the first time it's shown (once per window)
    this.newer = new Map();     // id → the README now on GitHub when it changed (null: asked, nothing new)
    this.busy = "";             // progress of a translation in this window
    this.working = null;        // {id, desc, overview}: the texts an AI request is translating now (shown as being read)
    this.renderSeq = 0;         // incremented on each render() to discard stale async callbacks
    this.readmeComponent = null;
    this.translated = this.plugin.data.settings.translatedFirst;   // Original | <language>: this window's choice, from Settings
    this.scope.register([], "ArrowLeft", () => { this.step(-1); return false; });
    this.scope.register([], "ArrowRight", () => { this.step(1); return false; });
    for (const key of ["j", "k", "l", "g", "x", "h", "t", "r", "s", "o", "0", "1", "2", "3", "4", "5"]) {
      this.scope.register([], key, () => this.onKey(key));
    }
  }

  get p() {
    return this.rows[this.index];
  }

  step(delta) {
    const next = this.index + delta;
    if (next < 0 || next >= this.rows.length || this.busy) return;
    this.index = next;
    this.tab = null;
    this.render();
  }

  onOpen() {
    this.modalEl.addClass("pdt-detail");
    this.containerEl?.addClass?.("pdt-detail-container");   // the CSS hides Obsidian's corner ✕ wherever it sits: ours is in the head row
    this.modalEl.toggleClass("is-full", this.plugin.data.settings.detailFull);
    this.component = new obsidian.Component();
    this.component.load();
    // a translation's model, tokens and cost reach the note's properties a moment after its text: the bottom row follows
    this.component.registerEvent(this.app.metadataCache.on("changed", (file) => {
      const p = this.p;
      if (!this.infoEl || this.tab !== "readme" || file.path !== this.plugin.notes.index.get(p.id)?.path) return;   // Overview has its own
      const seq = this.renderSeq;
      this.plugin.readmes.parts(p).then((parts) => { if (this.p === p && !this.closed && this.tab === "readme" && this.renderSeq === seq) this.renderInfo(this.infoEl, parts); });
    }));
    // grow out of the card: the animation starts at the card's centre (no motion if the system asks for less)
    const from = this.origin?.getBoundingClientRect?.();
    const box = this.modalEl.getBoundingClientRect?.();
    if (from && box) this.modalEl.setCssProps({ "--pdt-origin": `${from.left + from.width / 2 - box.left}px ${from.top + from.height / 2 - box.top}px` });
    this.modalEl.addClass("is-growing");
    // a right click opens the row's menu; links and the README keep the browser's own (copy, open link)
    const onMenu = (event) => {
      if (event.target.closest?.("a, input, textarea, .markdown-rendered")) return;
      event.preventDefault();
      this.view.rowRenderer.showRowMenu(this.p, event, this.effects());
    };
    if (this.component.registerDomEvent) this.component.registerDomEvent(this.modalEl, "contextmenu", onMenu);
    else this.modalEl.addEventListener("contextmenu", onMenu);
    this.render();
  }

  onClose() {
    this.closed = true;
    clearTimeout(this.seenTimer);
    this.readmeComponent?.unload();
    this.readmeComponent = null;
    this.component?.unload();
    this.contentEl.empty();
    this.view.refresh();
  }

  async act(fn) {
    await fn();
    if (!this.closed) this.render();
  }

  /** Hide / Exclude: the plugin leaves this list and the next one shows; the window closes after the last. */
  async drop(fn) {
    await fn();
    if (this.closed) return;
    this.rows.splice(this.index, 1);
    if (!this.rows.length) return this.close();
    this.index = Math.min(this.index, this.rows.length - 1);
    this.tab = null;
    this.render();
  }

  /** What follows an action here (see RowRenderer.rowEffects): a change redraws, leaving shows the next plugin, opening something else closes. */
  effects() {
    const p = this.p;
    const readme = this.tab === "readme";
    const kept = readme ? this.readmeKept === p.id : this.view.rowRenderer.rowEffects(p).retranslate;   // something to make again
    return { change: (fn) => this.act(fn), leave: (fn) => this.drop(fn), away: () => this.close(),
      retranslate: kept ? () => this.retranslate(p) : null, readme };
  }

  /**
   * ⋯ › Translate again…: what this tab shows (the description and the Overview, or the README) made again with a
   * model you pick (pinned and recent ones first); it then shows in your language. The text stays while it's read.
   */
  async retranslate(p) {
    if (this.busy) return;
    const model = await this.plugin.pickModel();
    if (!model || this.closed) return;
    const readme = this.tab === "readme";
    this.setLanguage(p, true);
    this.busy = t("details.translating");
    this.working = { id: p.id, desc: !readme, overview: !readme };
    this.render();
    let done = false;
    try {
      done = readme
        ? await this.plugin.readmes.translate(p, (text) => { this.busy = text; if (!this.closed && this.p === p) this.render(); }, false, model.id)
        : await this.plugin.retranslate(p, model.id);
    } finally {
      this.busy = "";
      this.working = null;
    }
    if (done && !readme) this.view.setDescTranslated(p, true);
    this.descLang = null;
    if (!this.closed) this.render();
  }

  /**
   * A shortcut key (KEY_HELP), as in the list when shortcuts are on: j/k walk like ←/→, the rest act on the plugin
   * shown. Returns true to leave the key to Obsidian (shortcuts off, typing in a field, a translation running).
   */
  onKey(key) {
    const doc = this.modalEl?.ownerDocument || globalThis.document;
    const typing = doc?.activeElement?.closest?.("input, textarea, select, [contenteditable]");
    if (!this.plugin.data.settings.keyboard || typing || this.busy) return true;
    if (key === "j" || key === "k") {
      this.step(key === "j" ? 1 : -1);
      return false;
    }
    const p = this.p;
    this.view.rowRenderer.shortcutActions(p, { ...this.effects(), translate: () => this.toggleTranslation(p) })[key]?.();
    return false;
  }

  async toggleTranslation(p) {
    if (this.busy) return;
    const tabs = this.plugin.data.settings.readmeTranslation !== "off";
    if (tabs && this.tab === "readme") return this.toggleReadme(p);
    const on = !this.descriptionTranslated(p);
    if (tabs) this.setLanguage(p, on);
    if (on) {
      this.busy = t("details.translating");
      this.working = { id: p.id, desc: this.plugin.cachedTranslation(p) == null, overview: tabs };
      this.render();
      let done = false;
      try {
        done = await (tabs ? this.plugin.translateWithOverview(p) : this.plugin.translateRows([p]));
      } finally {
        this.busy = "";
        this.working = null;
      }
      if (!done) { if (!this.closed) this.render(); return; }
    }
    this.view.setDescTranslated(p, on);
    this.descLang = null;
    this.view.refresh();
    if (!this.closed) this.render();
  }

  /** `t` on the README tab: the README in your language (translated the first time) or back in the original. */
  async toggleReadme(p) {
    const on = !this.wantsTranslation;
    this.setLanguage(p, on);
    if (on && !(await this.plugin.readmes.parts(p)).translation) {
      if (!this.closed) return this.translate(p);
      return;
    }
    if (!this.closed) this.render();
  }

  /** Is `part` ("desc" | "overview") of `p` being translated right now? Then it stays as it is, shown as being read. */
  isWorking(p, part) {
    return this.working?.id === p.id && this.working[part];
  }

  /** Is the description shown in your language here? Your click on its chip, else Original | <language> (or the list without it). */
  descriptionTranslated(p) {
    if (this.plugin.cachedTranslation(p) == null) return false;
    const own = this.descLang?.id === p.id ? this.descLang.lang : null;
    if (own) return own === "target";
    return this.plugin.data.settings.readmeTranslation !== "off" ? this.translated : this.view.descTranslated(p);
  }

  renderDescription(parent, p) {
    const desc = parent.createEl("p", { cls: "pdt-detail-about" });
    if (!p.description) return desc.setText("–");
    const translation = this.plugin.cachedTranslation(p);
    const translated = this.descriptionTranslated(p);
    desc.addClass("pdt-detail-desc");
    languageChip(desc, { original: p.description, translation, translated, target: this.plugin.data.settings.targetLang, swap: async () => {
      if (this.busy) return;
      if (!translated && translation == null) {
        this.busy = t("details.translating");
        this.working = { id: p.id, desc: true, overview: false };
        this.render();
        try {
          const ok = await this.plugin.translateRows([p]);
          if (!ok) return;
        } finally {
          this.busy = "";
          this.working = null;
        }
      }
      const next = !translated;
      this.descLang = { id: p.id, lang: next ? "target" : "original" };
      this.view.setDescTranslated(p, next);
      this.view.refresh();
      if (!this.closed) this.render();
    } });
    if (this.isWorking(p, "desc")) this.showReading(desc, 0);
  }

  /** A text being translated: it stays, shown as being read with the pure-CSS effect from Settings (showReading). */
  showReading(box, first) {
    showReading(box, this.plugin.data.settings.translateFx, first);
  }

  /**
   * A library plugin with a new release: after SEEN_AFTER_MS on screen here it counts as seen (no modal redraw,
   * so reading scroll position and text selection stay intact).
   */
  watchSeen(p, note) {
    clearTimeout(this.seenTimer);
    if (!isUnreviewed(p, note)) return;
    this.seenTimer = setTimeout(async () => {
      if (this.closed || this.p !== p) return;
      await this.plugin.markSeen(p);
    }, SEEN_AFTER_MS);
  }

  render() {
    if (this.closed) return;
    this.renderSeq++;
    const p = this.p;
    const plugin = this.plugin;
    const note = plugin.notes.index.get(p.id);
    if (this.watching !== p.id) {
      this.watching = p.id;
      this.watchSeen(p, note);
    }
    const { releases } = plugin.timeline;
    const dates = releases[p.id] || [];
    const now = Date.now();
    const cadence = releaseCadence(dates, now);
    this.renderHead(p, note);
    const el = this.contentEl;
    el.empty();
    this.renderStats(el.createDiv({ cls: "pdt-detail-stats" }), p, now, cadence);

    const columns = el.createDiv({ cls: "pdt-detail-columns" });
    const main = columns.createDiv({ cls: "pdt-detail-main" });
    if (note?.note) this.section(main, t("details.yourNote")).box.createEl("p", { text: note.note });
    const footer = el.createDiv({ cls: "pdt-detail-foot" });
    this.infoEl = footer.createDiv({ cls: "pdt-detail-info" });
    this.renderTabs(main, p, note, this.infoEl);

    const column = columns.createDiv({ cls: "pdt-detail-side" });
    const side = column.createDiv({ cls: "pdt-detail-side-top" });
    const profile = plugin.profiles?.plugins?.[p.id];
    if (profile) this.renderNeeds(side, p, profile);
    this.renderSimilar(side, p);

    const history = this.section(column, t("details.history"), " is-bottom");
    const capped = dates.length >= RELEASES_CAP;
    if (dates.length) history.head.createSpan({ cls: "pdt-detail-head-note", text: t(capped ? "details.historyCapped" : "details.historyLabel", { n: dates.length }) });
    this.renderHistory(history.box.createDiv({ cls: "pdt-detail-card" }), dates, now, cadence);

    this.renderNav(footer);
  }

  /** A titled block: {box, head} (the head holds the title and room for a note or a link). */
  section(parent, title, cls = "") {
    const box = parent.createDiv({ cls: `pdt-detail-section${cls}` });
    const head = box.createDiv({ cls: "pdt-detail-section-head" });
    head.createEl("h3", { text: title, attr: { lang: language } });
    return { box, head };
  }

  /** Your language (Original | <language>)? Settings' translatedFirst when the window opens, then this window's choice. */
  get wantsTranslation() {
    return this.plugin.data.settings.readmeTranslation !== "off" && this.translated;
  }

  /**
   * Does this tab show your language? When you chose it and there is a translation, or you asked here for this
   * plugin (then the tab offers to make one): a window opened later doesn't land on an empty translated tab.
   */
  inYourLanguage(p, hasTranslation) {
    return this.wantsTranslation && (hasTranslation || this.asked === p.id);
  }

  /** The closest plugins: a click shows one here (← comes back); "All (n) →" opens the Similar filter. */
  renderSimilar(side, p) {
    const similar = this.plugin.similarTo(p);
    const near = this.section(side, t("details.similar"));
    if (similar.length) {
      const all = near.head.createEl("a", { cls: "pdt-detail-head-link", text: t("details.similarAll", { n: similar.length }), href: "#" });
      all.onclick = (event) => { event.preventDefault(); this.close(); this.view.similarFilter.open(p); };
    }
    for (const x of similar.slice(0, 5)) {
      const item = near.box.createEl("button", { cls: "pdt-detail-near", attr: { type: "button" } });
      item.createSpan({ cls: "pdt-detail-near-name", text: x.p.name });
      const meter = item.createSpan({ cls: "pdt-why-meter" });
      meter.createSpan({ cls: "pdt-why-fill" }).setCssProps({ "--pdt-match": `${Math.max(6, Math.round(closenessShare(x.rank) * 100))}%` });
      item.createSpan({ cls: "pdt-detail-near-close", text: t(closeness(x.rank)) });
      setTooltip(item, x.p.description || x.p.name);
      item.onclick = () => {   // look at it here; ← comes back
        if (this.busy) return;
        this.rows.splice(this.index + 1, 0, x.p);
        this.step(1);
      };
    }
    if (!similar.length) near.box.createEl("p", { cls: "pdt-detail-muted", text: t("similar.none") });
  }

  /**
   * What the plugin needs, from its profile: the required ones first, then the optional ones (dimmed), each with its
   * kind's icon and name; a paid service in orange. Names in your language once the Overview is translated.
   */
  renderNeeds(side, p, profile) {
    const { box } = this.section(side, t("details.needs"));
    const requires = profile.requires || [];
    if (!requires.length) return box.createEl("p", { cls: "pdt-detail-muted", text: t("details.needsNone") });
    const saved = this.inYourLanguage(p, true) ? this.plugin.profileTranslation(p.id) : null;
    const names = saved?.parts.needs.length === requires.length ? saved.parts.needs : requires.map((r) => r.name);
    const card = box.createDiv({ cls: "pdt-needs" });
    if (!saved) card.setAttribute("lang", "en");   // the original names; the group titles say lang themselves

    for (const optional of [false, true]) {
      const group = requires.map((r, i) => ({ ...r, name: names[i] })).filter((r) => Boolean(r.optional) === optional);
      if (!group.length) continue;
      card.createDiv({ cls: "pdt-needs-head", text: t(optional ? "details.needsOptional" : "details.needsRequired"), attr: { lang: language } });
      for (const need of group) {
        const row = card.createDiv({ cls: `pdt-needs-row${optional ? " is-optional" : ""}${need.kind === "paidService" ? " is-paid" : ""}` });
        setIcon(row.createSpan({ cls: "pdt-needs-icon" }), PROFILE_NEEDS[need.kind] || "info");
        row.createSpan({ cls: "pdt-needs-name", text: need.name });
        row.createSpan({ cls: "pdt-needs-kind", text: t(`profile.needs.${need.kind}`) });
      }
    }
  }

  /** Its categories (the home one first, marked) and tags, at the bottom of Overview: a click lists their plugins. */
  renderCategories(parent, profile) {
    const { box } = this.section(parent, t("details.categories"), " pdt-overview-cats");
    const chip = (parent, text, cls, query, tip) => {
      const pill = parent.createSpan({ cls: `pdt-pill ${cls}`, text, attr: { role: "button", tabindex: "0" } });
      setTooltip(pill, tip);
      const open = () => { this.close(); this.view.openQuery(query); };
      pill.onclick = open;
      onActivate(pill, open);
    };
    const cats = box.createDiv({ cls: "pdt-profile-pills" });
    profileCategories(profile).forEach((c, i) => chip(cats, c, i ? "is-category" : "is-category is-primary", `category = ${quoteValue(c)}\norder by downloads desc`, t(i ? "details.categoryTip" : "details.primaryTip", { name: c })));
    if (!profile.tags?.length) return;
    const tags = box.createDiv({ cls: "pdt-profile-tags" });
    for (const tag of profile.tags) chip(tags, `#${tag}`, "is-tag", `tag = ${quoteValue(tag)}\norder by downloads desc`, t("details.tagTip", { name: tag }));
  }

  /**
   * Name, version and author on one line; on the right 🔖 (library), ★ (1–5 on hover) and ⋯ (the row's menu), "Open in Obsidian",
   * ⤢ and ✕. Your groups and rating under the name, when there are any.
   */
  renderHead(p, note) {
    const title = this.titleEl;
    title.empty();
    const left = title.createDiv({ cls: "pdt-detail-title" });
    const line = left.createDiv({ cls: "pdt-detail-line" });
    line.createSpan({ cls: "pdt-detail-name", text: p.name });
    const by = [p.version, p.author].filter(Boolean).join(" · ");
    if (p.repo) {   // the repository: version · author, with GitHub's mark
      const repo = line.createEl("a", { cls: "pdt-detail-by pdt-detail-repo", href: `https://github.com/${p.repo}` });
      setIcon(repo.createSpan({ cls: "pdt-detail-repo-icon" }), "github");
      repo.createSpan({ text: by });
      setTooltip(repo, `GitHub: ${p.repo}`);
    } else line.createSpan({ cls: "pdt-detail-by", text: by });
    const profile = this.plugin.profiles?.plugins?.[p.id];
    if (profile?.intent) setTooltip(line.createSpan({ cls: "pdt-badge is-intent", text: t(`profile.intent.${profile.intent}`) }), t(`profile.intent.${profile.intent}.tip`));
    if (profile?.lifecycle) line.createSpan({ cls: "pdt-badge is-warn", text: t(`profile.lifecycle.${profile.lifecycle}`) });
    if (p.removed) left.createEl("p", { cls: "pdt-detail-removed", text: t("details.removed", { reason: p.removed.reason || "–", date: dayString(p.removed.at) }) });
    this.renderDescription(left, p);
    if (note) {
      const tags = left.createDiv({ cls: "pdt-detail-tags" });
      for (const g of note.groups) tags.createSpan({ cls: `pdt-pill is-group pdt-hue-${groupHue(g)}`, text: g });
      if (note.rating) tags.createSpan({ cls: "pdt-detail-stars", text: ratingStars(note.rating) });
      tags.createSpan({ cls: "pdt-detail-muted", text: t("details.inLibrary") });
    }
    const actions = title.createDiv({ cls: "pdt-detail-head-actions" });
    const rows = this.view.rowRenderer;
    const act = (icon, tip, fn, cls = "") => {
      const button = iconButton(actions, icon, tip, cls);
      button.onclick = () => this.act(fn);
      return button;
    };
    rows.renderLibraryButton(act, p, note);
    rows.renderRating(actions, p, note, (fn) => this.act(fn));
    iconButton(actions, "more-horizontal", t("row.menu"), "pdt-row-menu").onclick = (event) => rows.showRowMenu(p, event, this.effects());
    const open = actions.createEl("a", { cls: "pdt-detail-open", text: t("details.openInObsidian"), href: `obsidian://show-plugin?id=${encodeURIComponent(p.id)}` });
    setTooltip(open, t("details.openInObsidianTip"));
    this.renderSizeToggle(actions);
    const close = actions.createEl("button", { cls: "clickable-icon pdt-detail-close", attr: { type: "button", "aria-label": t("details.close") } });
    setIcon(close, "x");   // in the row, the size of ⤢ (Obsidian's own ✕ is pinned to the corner, so the CSS hides it)
    close.onclick = () => this.close();
  }

  /** ⤢ / ⤡: fill the screen or go back to the window size; remembered for the next details window. */
  renderSizeToggle(parent) {
    const settings = this.plugin.data.settings;
    const button = parent.createEl("button", { cls: "clickable-icon pdt-detail-size", attr: { type: "button" } });
    const show = () => {
      const tip = t(settings.detailFull ? "details.restore" : "details.maximize");
      setIcon(button, settings.detailFull ? "minimize-2" : "maximize-2");
      button.setAttribute("aria-label", tip);
      setTooltip(button, tip);
    };
    show();
    button.addEventListener("click", async () => {
      settings.detailFull = !settings.detailFull;
      this.modalEl.style.removeProperty("width");    // a hand-resized size gives way to the chosen one
      this.modalEl.style.removeProperty("height");
      this.modalEl.toggleClass("is-full", settings.detailFull);
      show();
      await this.plugin.saveData(this.plugin.data);
    });
  }

  /** Four equal tiles: label, value, and what the value means. */
  renderStats(stats, p, now, cadence) {
    const { firstSeen, from } = this.plugin.timeline;
    const stat = (label, value, sub) => {
      const box = stats.createDiv({ cls: "pdt-detail-stat" });
      box.createDiv({ cls: "pdt-detail-label", text: label });
      box.createDiv({ cls: "pdt-detail-value", text: value });
      box.createDiv({ cls: "pdt-detail-sub", text: sub || " " });
    };
    const seen = firstSeen[p.id];
    const gained = gainOver(this.plugin.timeline, p.id, 30);
    stat(t("details.downloads"), p.downloads == null ? "–" : formatCount(p.downloads), gained != null ? t("details.growth30", { n: formatShort(gained) }) : t("details.downloadsSub"));
    stat(t("details.lastRelease"), p.updated ? relativeDays(p.updated, now) : "–", p.version);
    const before = t("details.ageBeforeYears", { n: Math.max(1, Math.floor((now - from) / (YEAR_DAYS * DAY_MS))) });
    stat(t("details.age"), seen > 0 ? ageLabel(seen, now) : seen === 0 ? before : "–", seen > 0 ? t("details.listedOn", { date: dayString(seen) }) : t("details.listed"));
    stat(t("details.cadence"), cadence ? cadenceLabel(cadence) : t("details.noData"), cadence ? cadenceSub(cadence) : t("details.noDataSub"));
  }

  /** Bottom right: ‹ n / total ›, the shortcut keys (when they're on) and "Esc closes". */
  renderNav(footer) {
    const nav = footer.createDiv({ cls: "pdt-detail-nav" });
    if (this.rows.length > 1) {
      const arrow = (icon, delta, label) => {
        const b = nav.createEl("button", { cls: "pdt-detail-arrow", attr: { type: "button", "aria-label": label } });
        setIcon(b, icon);
        b.disabled = this.index + delta < 0 || this.index + delta >= this.rows.length;
        b.onclick = () => this.step(delta);
      };
      arrow("chevron-left", -1, t("details.previous"));
      nav.createSpan({ cls: "pdt-detail-pos", text: t("details.position", { n: formatCount(this.index + 1), total: formatCount(this.rows.length) }) });
      arrow("chevron-right", 1, t("details.next"));
    }
    if (this.plugin.data.settings.keyboard) renderKeyHelp(nav, KEY_HELP.filter(([keys]) => keys[0] !== "Enter"));   // Enter opens this window
    nav.createSpan({ cls: "pdt-detail-muted", text: t("details.escClose") });
  }

  /**
   * The tabs' box: Overview (when the plugin has a profile) and README, "open in note" and, with translations on,
   * Original | <language> for both tabs (remembered for the next window). The body below holds the chosen tab.
   */
  renderTabs(main, p, note, info) {
    const plugin = this.plugin;
    const keys = [plugin.profiles?.plugins?.[p.id] && "overview", "readme"].filter(Boolean);
    if (!keys.includes(this.tab)) this.tab = keys[0];
    const box = main.createDiv({ cls: "pdt-detail-section pdt-detail-readme" });
    const tabs = box.createDiv({ cls: "pdt-detail-tabs", attr: { role: "tablist" } });
    for (const key of keys) {
      const on = this.tab === key;
      const b = tabs.createEl("button", { cls: `pdt-detail-tab${on ? " is-active" : ""}`, text: t(`details.tab.${key}`), attr: { type: "button", role: "tab", "aria-selected": String(on) } });
      b.onclick = () => { this.tab = key; this.render(); };
    }
    if (note) tabs.createEl("a", { cls: "pdt-detail-note-link", text: t("details.openNote"), href: "#" }).onclick = (event) => {
      event.preventDefault();
      this.close();
      plugin.readmes.openReadme(p);
    };
    const showLanguage = plugin.data.settings.readmeTranslation !== "off" ? this.renderLanguage(tabs, p) : () => {};
    const body = box.createDiv({ cls: "pdt-detail-readme-body" });
    if (this.tab === "overview") this.renderOverview(body, p, info, showLanguage);
    else this.renderReadme(body, p, note, info, showLanguage);
  }

  /**
   * Original | <language>: which text the tabs show. Choosing your language here asks for it for this plugin (the
   * tab offers a translation when there's none). Returns a setter: the tab marks what it really shows.
   */
  renderLanguage(parent, p) {
    const settings = this.plugin.data.settings;
    const group = parent.createDiv({ cls: "pdt-detail-lang", attr: { role: "group", "aria-label": t("details.language") } });
    const buttons = [[false, t("details.original")], [true, settings.targetLang]].map(([on, label]) => {
      const b = group.createEl("button", { text: label, attr: { type: "button" } });
      b.onclick = async () => {   // also while a translation runs: it goes on, is kept, and shows when you come back
        this.setLanguage(p, on);
        this.render();
      };
      return [on, b];
    });
    const show = (translated) => {
      for (const [on, b] of buttons) {
        b.toggleClass("is-on", on === translated);
        b.setAttribute("aria-pressed", String(on === translated));
      }
    };
    show(false);
    return show;
  }

  /** Original | <language>: `on` shows the tabs in your language in this window (Settings keeps the default) and asks for it for `p`. */
  setLanguage(p, on) {
    this.asked = on ? p.id : null;
    this.translated = on;
  }

  /**
   * Overview: what it's for, the problem it solves, what it does, what it isn't and what's worth knowing. The summary
   * comes with the index and shows at once, the rest from the plugin's own profile file a moment later. In your
   * language: the saved translation (kept even when the profile changed since: a bar offers a new one), or a button
   * that makes one.
   */
  renderOverview(body, p, info, showLanguage) {
    const plugin = this.plugin;
    const seq = this.renderSeq;
    const profile = plugin.profiles?.plugins?.[p.id];
    const translated = this.inYourLanguage(p, Boolean(plugin.profileTranslation(p.id)));
    const saved = translated ? plugin.profileTranslation(p.id) : null;
    showLanguage(translated);
    body.addClass("pdt-overview");
    const working = this.isWorking(p, "overview");
    if (translated && !saved && !working) {
      this.renderUntranslated(body, t("details.overviewNotTranslated", { lang: plugin.data.settings.targetLang }), t("details.translateOverview"), () => this.translateOverview(p));
      if (!this.busy) plugin.sync.profileFile(p.id).then((file) => {
        if (this.renderSeq === seq && this.p === p && !this.closed && !this.busy) this.renderEstimate(body, this.plugin.estimate("overview", { text: profileTexts(profileParts(profile, file)).join("\n") }));
      });
      return;
    }
    const shown = body.createDiv({ cls: "pdt-overview-parts" });
    const fill = (parts) => {
      this.renderParts(shown, parts, Boolean(saved));
      if (working) this.showReading(shown, 1);
    };
    fill(saved?.parts || profileParts(profile, null));
    this.renderCategories(body, profile);
    plugin.sync.profileFile(p.id).then((file) => {
      if (this.renderSeq !== seq || this.p !== p || this.closed || this.tab !== "overview") return;
      const parts = profileParts(profile, file);
      this.renderOverviewInfo(info, file, saved);
      if (!saved) {
        shown.empty();
        return fill(parts);
      }
      if (!plugin.overviewTranslated(p.id, parts)) this.staleBar(body, t("details.overviewOutdated"), t("details.translateAgain"), () => this.translateOverview(p), true);
    });
  }

  /**
   * The Overview's sections, each only when the profile has it; titled in the text's language (the original: English,
   * marked lang="en" so uppercase titles read I, not İ).
   */
  renderParts(el, parts, translated) {
    const label = (key) => (translated ? t(key) : tIn("en", key));
    el.setAttribute("lang", translated ? language : "en");
    const part = (title, cls) => {
      const box = el.createDiv({ cls: `pdt-overview-part${cls ? ` ${cls}` : ""}` });
      if (title) box.createEl("h4", { text: title });
      return box;
    };
    const para = (box, value) => box.createEl("p").createSpan({ cls: "pdt-ln", text: value });   // inline: line effects (showReading)
    if (parts.summary) para(part(label("details.what"), "is-lead"), parts.summary);
    if (parts.problem) para(part(label("details.problem")), parts.problem);
    if (parts.capabilities.length) {
      const list = part(label("details.capabilities")).createEl("ul", { cls: "pdt-overview-caps" });
      for (const item of parts.capabilities) {
        const li = list.createEl("li");
        setIcon(li.createSpan({ cls: "pdt-overview-check" }), "check");
        li.createSpan({ cls: "pdt-ln", text: item });
      }
    }
    const note = (label, text, cls) => {
      const box = part(null, `pdt-overview-note ${cls}`);
      setIcon(box.createSpan({ cls: "pdt-overview-note-icon" }), "info");
      const p = box.createEl("p");
      p.createEl("strong", { text: label });
      p.createSpan({ cls: "pdt-ln", text: ` ${text}` });
    };
    if (parts.disambiguation) note(label("details.disambiguation"), parts.disambiguation, "is-aside");
    if (parts.extras) note(label("details.extras"), parts.extras, "is-worth");
  }

  /** A tab not in your language yet: what's missing and the button that translates it. */
  renderUntranslated(body, text, label, run) {
    body.addClass("is-empty");
    if (this.busy) return body.createEl("p", { text: this.busy });
    body.createEl("p", { text });
    body.createEl("button", { cls: "mod-cta", text: label, attr: { type: "button" } }).onclick = run;
  }

  /** A bar over the tab's text: what's out of date and the button that fixes it. */
  staleBar(body, text, label, onClick, first = false) {
    const row = body.createDiv({ cls: "pdt-detail-stale" });
    row.createSpan({ text });
    row.createEl("button", { cls: "pdt-link-button", text: label, attr: { type: "button" } }).onclick = onClick;
    if (first) body.prepend(row);   // a bar added after the text: still on top
  }

  /** Appends translation usage info (shared by Overview and README footers). */
  renderTranslationUsage(info, record) {
    if (!record?.model) return;
    const took = [record.model, t("details.tokensUsed", { n: formatShort(record.tokens || 0) })];
    if (typeof record.cost === "number") took.push(formatCost(record.cost));
    if (record.from) took.unshift(t("details.translatedFrom", { name: record.from }));
    setTooltip(info.createSpan({ text: t("details.infoTranslation", { took: took.join(" · ") }) }), t("details.infoTranslationTip", { date: record.date || "–" }));
  }

  /** Bottom left on Overview: which model wrote the profile, and what its translation took. */
  renderOverviewInfo(info, file, saved) {
    info.empty();
    const model = String(file?.model || "").replace(/@v\d+$/, "");
    if (model) setTooltip(info.createSpan({ text: t("details.infoProfile", { model: model.split("/").pop() }) }), file.model);
    this.renderTranslationUsage(info, saved);
  }

  /** The Overview's Translate button: the original stays on screen, shown as being read, until the translation comes. */
  async translateOverview(p) {
    if (this.busy) return;
    this.busy = t("details.translating");
    this.working = { id: p.id, desc: false, overview: true };
    this.render();
    try {
      await this.plugin.translateProfile(p);
    } finally {
      this.busy = "";
      this.working = null;
    }
    if (!this.closed) this.render();
  }

  /** Bottom left on README: where it comes from and what its translation took. */
  renderInfo(info, { source, original, translation }) {
    info.empty();
    if (original) {
      info.createSpan({ text: t("details.infoReadme", {
        version: original.version ? `v${original.version}` : "–",
        where: t(source === "note" ? "details.inNote" : "details.inCache"),
        date: original.date || "–",
      }) });
    }
    this.renderTranslationUsage(info, translation);
  }

  renderHistory(box, dates, now, cadence) {
    if (!dates.length) {
      box.createEl("p", { cls: "pdt-detail-muted", text: t("details.noHistory") });
      return;
    }
    const gaps = releaseGaps(dates, now);
    const weight = (g) => Math.log1p(g.days) || 0.1;
    const total = gaps.reduce((sum, g) => sum + weight(g), 0);
    const strip = box.createDiv({ cls: "pdt-gaps", attr: { role: "img", "aria-label": t("details.historyLabel", { n: dates.length }) } });
    for (const g of gaps) {
      const tone = g.days < 30 ? "short" : g.days < YEAR_DAYS / 2 ? "mid" : g.days < YEAR_DAYS ? "long" : "gap";
      const cell = strip.createSpan({ cls: `pdt-gap is-${tone}${g.open ? " is-open" : ""}` });
      cell.setCssProps({ "--pdt-w": String(weight(g) / total) });
      if (g.days >= 30 && weight(g) / total >= 0.09) cell.setText(spanLabel(g.days));
      const span = spanLabel(g.days);
      const range = g.releases > 1 ? `${dayString(g.from)} – ${dayString(g.last)}` : dayString(g.from);
      const after = g.open ? t("details.gapOpen", { span }) : t("details.gapNext", { span, date: dayString(g.to) });
      setTooltip(cell, `${t("details.gapWave", { date: range, n: g.releases })}\n${after}`, { delay: 100 });
    }
    const ends = box.createDiv({ cls: "pdt-history-ends" });
    ends.createSpan({ text: dates.length >= RELEASES_CAP ? t("details.historySince", { date: dayString(dates[0]) }) : dayString(dates[0]) });
    ends.createSpan({ text: t("details.today") });
    if (cadence) box.createDiv({ cls: "pdt-history-note", text: cadenceNote(cadence, dates.at(-1), now) });
  }

  async renderReadme(body, p, note, info, showLanguage) {
    const plugin = this.plugin;
    const seq = this.renderSeq;
    const parts = await plugin.readmes.parts(p);
    if (this.renderSeq !== seq || this.p !== p || this.closed || this.tab !== "readme") return;
    const { original, translation } = parts;
    this.readmeKept = translation ? p.id : null;
    const translated = this.inYourLanguage(p, Boolean(translation));
    showLanguage(translated);
    const outdated = Boolean(original && translation?.hash && translation.hash !== original.hash);
    this.renderInfo(info, parts);
    const render = (markdown) => {
      // unload previous README's MarkdownRenderChild tree so children never accumulate across renders
      this.readmeComponent?.unload();
      this.readmeComponent = new obsidian.Component();
      this.readmeComponent.load();
      body.addClass("markdown-rendered");
      obsidian.MarkdownRenderer.render(this.app, markdown, body, note?.path || "", this.readmeComponent);
    };
    if (!translated) {
      if (original) {
        const newer = this.checkNewer(p, original);
        if (newer) this.staleBar(body, t("details.readmeChanged", { version: p.version }), t("details.readmeUpdate"), async () => {
          await plugin.readmes.keep(p, newer);
          this.newer.set(p.id, null);
          if (!this.closed) this.render();
        });
        return render(original.text);
      }
      body.addClass("is-empty");
      if (!p.repo || this.loads.get(p.id) === "done") return body.createEl("p", { cls: "pdt-detail-muted", text: t("readme.failed") });
      body.createEl("p", { cls: "pdt-detail-muted", text: t("details.loadingReadme") });
      this.loadReadme(p);
      return;
    }
    const estimate = original ? plugin.estimate("readme", { text: plugin.readmes.translationSource(original.text).text }) : null;
    const costLabel = estimate ? estimateCost(estimate) : null;
    const price = costLabel ? ` (${costLabel})` : "";
    if (translation && !this.busy) {
      if (outdated) this.staleBar(body, t("details.outdatedNote"), `${t("details.translateAgain")}${price}`, () => this.translate(p));
      return render(translation.body);
    }
    this.renderUntranslated(body, t("details.notTranslated", { lang: plugin.data.settings.targetLang }), t("details.translate"), () => this.translate(p));
    if (this.busy) return;
    if (estimate) return this.renderEstimate(body, estimate);
    if (p.repo && this.loads.get(p.id) !== "done") {
      body.createEl("p", { cls: "pdt-detail-muted", text: t("details.loadingReadme") });
      this.loadReadme(p);
    }
  }

  renderEstimate(body, estimate) {
    body.createEl("p", { cls: "pdt-detail-muted", text: estimateLine(estimate, this.plugin.data.settings) });
  }

  async loadReadme(p) {
    if (this.loads.has(p.id)) return;
    this.loads.set(p.id, "busy");
    try {
      await this.plugin.readmes.fetch(p);
    } catch (error) {
      console.warn("[Pindex] couldn't fetch the README", error);
    }
    this.loads.set(p.id, "done");
    if (this.p === p && !this.closed) this.render();
  }

  checkNewer(p, original) {
    if (this.newer.has(p.id)) return this.newer.get(p.id);
    if (!p.version || original.version === p.version) return null;
    this.newer.set(p.id, null);
    this.plugin.readmes.newer(p, original).then((readme) => {
      if (!readme) return;
      this.newer.set(p.id, readme);
      if (this.p === p && !this.closed) this.render();
    }, (error) => console.warn("[Pindex] couldn't check the README", error));
    return null;
  }

  async translate(p) {
    if (this.busy) return;
    this.busy = t("details.translating");
    this.render();
    try {
      await this.plugin.readmes.translate(p, (text) => { this.busy = text; if (!this.closed && this.p === p) this.render(); });
    } finally {
      this.busy = "";
    }
    if (!this.closed) this.render();
  }
}

