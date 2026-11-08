/**
 * A plugin's details in a large window that grows out of its card or row: the numbers, the whole
 * description and its translation, your note, the README (and its translation, on request), the closest
 * plugins and the release history. ←/→ walk the list it was opened from; Esc closes.
 */
class DetailModal extends Modal {
  constructor(view, rows, index, origin) {
    super(view.app);
    this.view = view;
    this.plugin = view.plugin;
    this.rows = [...rows];
    this.index = Math.max(0, index);
    this.origin = origin;
    this.tab = "readme";
    this.fetched = new Map();   // README fetched for an untracked plugin (shown, not saved)
    this.busy = "";             // progress of a translation in this window
    this.scope.register([], "ArrowLeft", () => { this.step(-1); return false; });
    this.scope.register([], "ArrowRight", () => { this.step(1); return false; });
  }

  get p() {
    return this.rows[this.index];
  }

  step(delta) {
    const next = this.index + delta;
    if (next < 0 || next >= this.rows.length || this.busy) return;
    this.index = next;
    this.tab = "readme";
    this.render();
  }

  onOpen() {
    this.modalEl.addClass("pdt-detail");
    this.component = new obsidian.Component();
    this.component.load();
    // grow out of the card: the animation starts at the card's centre (no motion if the system asks for less)
    const from = this.origin?.getBoundingClientRect?.();
    const box = this.modalEl.getBoundingClientRect?.();
    if (from && box) this.modalEl.setCssProps({ "--pdt-origin": `${from.left + from.width / 2 - box.left}px ${from.top + from.height / 2 - box.top}px` });
    this.modalEl.addClass("is-growing");
    this.render();
  }

  onClose() {
    this.component?.unload();
    this.contentEl.empty();
    this.view.refresh();
  }

  async act(fn, close = false) {
    await fn();
    if (close) this.close();
    else this.render();
  }

  render() {
    const p = this.p;
    const plugin = this.plugin;
    const note = plugin.notes.index.get(p.id);
    const { firstSeen, releases, months } = plugin.timeline;
    const now = Date.now();
    this.titleEl.empty();
    this.titleEl.createSpan({ cls: "pdt-detail-name", text: p.name });
    this.titleEl.createSpan({ cls: "pdt-detail-by", text: [p.version, p.author].filter(Boolean).join(" · ") });
    const el = this.contentEl;
    el.empty();

    const top = el.createDiv({ cls: "pdt-detail-top" });
    const tags = top.createDiv({ cls: "pdt-detail-tags" });
    for (const g of note?.groups || []) tags.createSpan({ cls: `pdt-pill is-group pdt-hue-${groupHue(g)}`, text: g });
    if (note?.rating) tags.createSpan({ cls: "pdt-pill is-rating", text: "★".repeat(note.rating) + "☆".repeat(5 - note.rating) });
    if (this.rows.length > 1) top.createSpan({ cls: "pdt-detail-pos", text: t("details.position", { n: this.index + 1, total: this.rows.length }) });
    top.createEl("a", { cls: "pdt-detail-open mod-cta", text: t("details.openInObsidian"), href: `obsidian://show-plugin?id=${encodeURIComponent(p.id)}` });

    const stats = el.createDiv({ cls: "pdt-detail-stats" });
    const stat = (value, label) => {
      const box = stats.createDiv({ cls: "pdt-detail-stat" });
      box.createDiv({ cls: "pdt-detail-value", text: value });
      box.createDiv({ cls: "pdt-detail-label", text: label });
    };
    const seen = firstSeen[p.id];
    const cadence = releaseCadence(releases[p.id]);
    stat(p.downloads == null ? "–" : formatCount(p.downloads), t("details.downloads"));
    stat(p.updated ? relativeDays(p.updated, now) : "–", t("details.lastRelease"));
    const before = months >= 12 ? t("details.beforeYears", { n: Math.round(months / 12) }) : t("details.beforeMonths", { n: months });
    stat(seen > 0 ? relativeDays(seen, now) : seen === 0 ? before : "–", t("details.listed"));   // 0: there before the history starts
    stat(cadence ? t("details.every", { n: cadence }) : "–", t("details.cadence"));

    const columns = el.createDiv({ cls: "pdt-detail-columns" });
    const main = columns.createDiv({ cls: "pdt-detail-main" });
    const section = (parent, title) => {
      const box = parent.createDiv({ cls: "pdt-detail-section" });
      box.createEl("h3", { text: title, attr: { lang: language } });
      return box;
    };
    const about = section(main, t("details.description"));
    about.createEl("p", { text: p.description || "–" });
    const translation = plugin.cachedTranslation(p);
    if (translation) about.createEl("p", { cls: "pdt-detail-trans", text: translation });
    else if (p.description && plugin.translator.ready) {
      about.createEl("button", { cls: "pdt-link-button", text: t("translate.row") }).onclick = async () => {
        if (await plugin.translateRows([p])) this.render();
      };
    }
    if (note?.note) section(main, t("details.yourNote")).createEl("p", { text: note.note });
    this.renderReadme(main, p, note);

    const side = columns.createDiv({ cls: "pdt-detail-side" });
    const similar = plugin.similarTo(p);
    const near = section(side, t("details.similar"));
    for (const x of similar.slice(0, 5)) {
      const item = near.createEl("button", { cls: "pdt-detail-near", attr: { type: "button" } });
      item.createSpan({ cls: "pdt-detail-near-name", text: x.p.name });
      const meter = item.createSpan({ cls: "pdt-why-meter" });
      meter.createSpan({ cls: "pdt-why-fill" }).setCssProps({ "--pdt-match": `${Math.max(6, Math.round(x.match * 100))}%` });
      setTooltip(item, x.p.description || x.p.name);
      item.onclick = () => {   // look at it here; ← comes back
        this.rows.splice(this.index + 1, 0, x.p);
        this.step(1);
      };
    }
    if (similar.length) {
      const all = near.createEl("button", { cls: "pdt-link-button", text: t("similar.seeAll", { n: similar.length }), attr: { type: "button" } });
      all.onclick = () => { this.close(); this.view.openSimilar(p); };
    } else near.createEl("p", { cls: "pdt-detail-muted", text: t("similar.none") });
    this.renderHistory(section(side, t("details.history")), releases[p.id] || [], now);

    const footer = el.createDiv({ cls: "pdt-detail-actions" });
    const button = (icon, text, fn, close = false) => {
      const b = footer.createEl("button", { attr: { type: "button" } });
      setIcon(b.createSpan({ cls: "pdt-detail-icon" }), icon);
      b.createSpan({ text });
      b.onclick = () => this.act(fn, close);
      return b;
    };
    button("star", t(note?.favorite ? "action.unfavorite" : "action.favorite"), () => plugin.toggleFavorite(p)).toggleClass("is-favorite", Boolean(note?.favorite));
    button("folder-plus", t("action.group"), () => plugin.chooseGroup(p));
    button("eye-off", t("action.snooze"), () => plugin.snooze(p), true);
    button("ban", t("action.exclude"), () => plugin.exclude(p), true);
    if (this.rows.length > 1) footer.createSpan({ cls: "pdt-detail-keys", text: t("details.keys") });
  }

  /** Release dates as dots on a line from the first known one to today. */
  renderHistory(box, dates, now) {
    const shown = dates.slice(-24);
    if (!shown.length) {
      box.createEl("p", { cls: "pdt-detail-muted", text: t("details.noHistory") });
      return;
    }
    const start = shown[0];
    const span = Math.max(now - start, DAY_MS);
    const line = box.createDiv({ cls: "pdt-history", attr: { role: "img", "aria-label": t("details.historyLabel", { n: shown.length }) } });
    for (const date of shown) {
      const dot = line.createSpan({ cls: "pdt-history-dot" });
      dot.setCssProps({ "--pdt-at": `${((date - start) / span) * 100}%` });
      setTooltip(dot, dayString(date));
    }
    const ends = box.createDiv({ cls: "pdt-history-ends" });
    ends.createSpan({ text: dayString(start) });
    ends.createSpan({ text: t("details.today") });
  }

  /** README / README · <language> tabs; the translation tab is dim until there is one, and translates on request. */
  async renderReadme(parent, p, note) {
    const plugin = this.plugin;
    const box = parent.createDiv({ cls: "pdt-detail-section pdt-detail-readme" });
    const translating = plugin.data.settings.readmeTranslation !== "off";
    const { original, translation } = await plugin.readmeParts(p);
    if (this.p !== p) return;   // moved on while reading
    const text = original || this.fetched.get(p.id);
    const tabs = box.createDiv({ cls: "pdt-detail-tabs", attr: { role: "tablist" } });
    const tab = (key, label, extra = "") => {
      const b = tabs.createEl("button", { cls: `pdt-detail-tab${this.tab === key ? " is-active" : ""}${extra}`, attr: { type: "button", role: "tab", "aria-selected": String(this.tab === key) } });
      b.createSpan({ text: label });
      b.onclick = () => { this.tab = key; this.render(); };
      return b;
    };
    tab("readme", "README");
    if (translating) {
      const stale = translation && translation.version !== p.version;
      const t2 = tab("translation", t("details.readmeIn", { lang: plugin.data.settings.targetLang }), translation ? "" : " is-dim");
      if (!translation) t2.createSpan({ cls: "pdt-detail-tab-note", text: t("details.none") });
      else if (stale) t2.createSpan({ cls: "pdt-detail-tab-note is-stale", text: t("details.stale") });
    }
    if (note) tabs.createEl("a", { cls: "pdt-detail-note-link", text: t("details.openNote"), href: "#" }).onclick = (event) => {
      event.preventDefault();
      this.close();
      plugin.openReadme(p);
    };
    const body = box.createDiv({ cls: "pdt-detail-readme-body" });
    const render = (markdown) => {
      body.addClass("markdown-rendered");
      obsidian.MarkdownRenderer.render(this.app, markdown, body, note?.path || "", this.component);
    };
    if (this.tab === "readme") {
      if (text) return render(text);
      if (!p.repo) return body.createEl("p", { cls: "pdt-detail-muted", text: t("readme.failed") });
      const get = body.createEl("button", { text: t("details.fetchReadme"), attr: { type: "button" } });
      get.onclick = async () => {
        get.disabled = true;
        const readme = await plugin.github.readme(p.repo);
        this.fetched.set(p.id, readme == null ? t("readme.failed") : escapeOutsideCode(absolutizeLinks(readme.trim(), p.repo)));
        this.render();
      };
      return;
    }
    if (translation && !this.busy) {
      if (translation.version !== p.version) {
        const again = body.createDiv({ cls: "pdt-detail-stale" });
        again.createSpan({ text: t("details.staleNote", { version: translation.version || "?" }) });
        again.createEl("button", { cls: "pdt-link-button", text: t("details.translateAgain"), attr: { type: "button" } }).onclick = () => this.translate(p);
      }
      return render(translation.body);
    }
    body.addClass("is-empty");
    if (this.busy) {
      body.createEl("p", { text: this.busy });
      return;
    }
    body.createEl("p", { text: t("details.notTranslated", { lang: plugin.data.settings.targetLang }) });
    body.createEl("button", { cls: "mod-cta", text: t("details.translate"), attr: { type: "button" } }).onclick = () => this.translate(p);
    const estimate = translationEstimate(text || "", plugin.data.settings.modelCost);
    if (text) {
      body.createEl("p", {
        cls: "pdt-detail-muted",
        text: [t("details.chars", { n: formatCount(estimate.chars) }), t("details.tokens", { n: formatCount(estimate.tokens) }),
          estimate.cost != null ? t("details.cost", { cost: decimal(estimate.cost, 3) }) : null, plugin.data.settings.model].filter(Boolean).join(" · "),
      });
    }
  }

  async translate(p) {
    this.busy = t("details.translating");
    this.render();
    await this.plugin.translateReadme(p, (text) => { this.busy = text; if (this.p === p) this.render(); });
    this.busy = "";
    this.render();
  }
}

