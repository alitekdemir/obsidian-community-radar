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

  async act(fn) {
    await fn();
    this.render();
  }

  /** Hide / Exclude: the plugin leaves this list and the next one shows; the window closes after the last. */
  async drop(fn) {
    await fn();
    this.rows.splice(this.index, 1);
    if (!this.rows.length) return this.close();
    this.index = Math.min(this.index, this.rows.length - 1);
    this.tab = "readme";
    this.render();
  }

  render() {
    const p = this.p;
    const plugin = this.plugin;
    const note = plugin.notes.index.get(p.id);
    const { releases } = plugin.timeline;
    const now = Date.now();
    this.renderHead(p, note);
    const el = this.contentEl;
    el.empty();
    this.renderStats(el.createDiv({ cls: "pdt-detail-stats" }), p, now);

    const columns = el.createDiv({ cls: "pdt-detail-columns" });
    const main = columns.createDiv({ cls: "pdt-detail-main" });
    const section = (parent, title, cls = "") => {
      const box = parent.createDiv({ cls: `pdt-detail-section${cls}` });
      const head = box.createDiv({ cls: "pdt-detail-section-head" });
      head.createEl("h3", { text: title, attr: { lang: language } });
      return { box, head };
    };
    const about = section(main, t("details.description")).box;
    about.createEl("p", { text: p.description || "–" });
    const translation = plugin.cachedTranslation(p);
    if (translation) about.createEl("p", { cls: "pdt-detail-trans", text: translation });
    else if (p.description && plugin.translator.ready) {
      about.createEl("button", { cls: "pdt-link-button", text: t("translate.row") }).onclick = async () => {
        if (await plugin.translateRows([p])) this.render();
      };
    }
    if (note?.note) section(main, t("details.yourNote")).box.createEl("p", { text: note.note });
    this.renderReadme(main, p, note);

    const side = columns.createDiv({ cls: "pdt-detail-side" });
    const similar = plugin.similarTo(p);
    const near = section(side, t("details.similar"));
    if (similar.length) {
      const all = near.head.createEl("a", { cls: "pdt-detail-head-link", text: t("details.similarAll", { n: similar.length }), href: "#" });
      all.onclick = (event) => { event.preventDefault(); this.close(); this.view.openSimilar(p); };
    }
    for (const x of similar.slice(0, 5)) {
      const item = near.box.createEl("button", { cls: "pdt-detail-near", attr: { type: "button" } });
      item.createSpan({ cls: "pdt-detail-near-name", text: x.p.name });
      const meter = item.createSpan({ cls: "pdt-why-meter" });
      meter.createSpan({ cls: "pdt-why-fill" }).setCssProps({ "--pdt-match": `${Math.max(6, Math.round(x.match * 100))}%` });
      item.createSpan({ cls: "pdt-detail-near-close", text: t(closeness(x.match)) });
      setTooltip(item, x.p.description || x.p.name);
      item.onclick = () => {   // look at it here; ← comes back
        this.rows.splice(this.index + 1, 0, x.p);
        this.step(1);
      };
    }
    if (!similar.length) near.box.createEl("p", { cls: "pdt-detail-muted", text: t("similar.none") });

    // bottom of the column, level with the README box: release history, then the repository
    const history = section(side, t("details.history"), " is-bottom");
    const dates = releases[p.id] || [];
    if (dates.length) history.head.createSpan({ cls: "pdt-detail-head-note", text: t("details.historyLabel", { n: dates.length }) });
    this.renderHistory(history.box.createDiv({ cls: "pdt-detail-card" }), dates, now);
    if (p.repo) {
      const repo = history.box.createEl("a", { cls: "pdt-detail-card pdt-detail-repo", href: `https://github.com/${p.repo}` });
      setIcon(repo.createSpan({ cls: "pdt-detail-icon" }), "github");
      repo.createSpan({ cls: "pdt-detail-repo-name", text: p.repo });
      repo.createSpan({ cls: "pdt-detail-head-note", text: "GitHub ↗" });
    }

    this.renderActions(el.createDiv({ cls: "pdt-detail-actions" }), p, note);
  }

  /** Name, version and author on one line, "Open in Obsidian" on the right; your groups and rating under it, when there are any. */
  renderHead(p, note) {
    const title = this.titleEl;
    title.empty();
    const left = title.createDiv({ cls: "pdt-detail-title" });
    const line = left.createDiv({ cls: "pdt-detail-line" });
    line.createSpan({ cls: "pdt-detail-name", text: p.name });
    line.createSpan({ cls: "pdt-detail-by", text: [p.version, p.author].filter(Boolean).join(" · ") });
    if (note) {
      const tags = left.createDiv({ cls: "pdt-detail-tags" });
      for (const g of note.groups) tags.createSpan({ cls: `pdt-pill is-group pdt-hue-${groupHue(g)}`, text: g });
      if (note.rating) tags.createSpan({ cls: "pdt-detail-stars", text: "★".repeat(note.rating) + "☆".repeat(5 - note.rating) });
      tags.createSpan({ cls: "pdt-detail-muted", text: t("details.tracked") });
    }
    title.createEl("a", { cls: "pdt-detail-open", text: t("details.openInObsidian"), href: `obsidian://show-plugin?id=${encodeURIComponent(p.id)}` });
  }

  /** Four equal tiles: label, value, and what the value means. */
  renderStats(stats, p, now) {
    const { firstSeen, releases, from } = this.plugin.timeline;
    const stat = (label, value, sub) => {
      const box = stats.createDiv({ cls: "pdt-detail-stat" });
      box.createDiv({ cls: "pdt-detail-label", text: label });
      box.createDiv({ cls: "pdt-detail-value", text: value });
      box.createDiv({ cls: "pdt-detail-sub", text: sub || " " });
    };
    const seen = firstSeen[p.id];
    const dates = releases[p.id] || [];
    const cadence = releaseCadence(dates, now);
    const gained = this.plugin.timeline.growth?.[p.id]?.[1];
    stat(t("details.downloads"), p.downloads == null ? "–" : formatCount(p.downloads), gained != null ? t("details.growth30", { n: formatShort(gained) }) : t("details.downloadsSub"));
    stat(t("details.lastRelease"), p.updated ? relativeDays(p.updated, now) : "–", p.version);
    // age counts from the day it was listed; 0: it was there before the history starts
    const before = t("details.ageBeforeYears", { n: Math.max(1, Math.floor((now - from) / (365 * DAY_MS))) });
    stat(t("details.age"), seen > 0 ? ageLabel(seen, now) : seen === 0 ? before : "–", seen > 0 ? t("details.listedOn", { date: dayString(seen) }) : t("details.listed"));
    stat(t("details.cadence"), cadence ? cadenceLabel(cadence) : t("details.noData"), cadence ? cadenceSub(cadence) : t("details.noDataSub"));
  }

  /** The same actions as a row (star with 1–5 on hover, group, hide, exclude), then ‹ n / total › on the right. */
  renderActions(footer, p, note) {
    const plugin = this.plugin;
    const button = (icon, label, onClick, cls = "") => {
      const b = footer.createEl("button", { cls, attr: { type: "button" } });
      setIcon(b.createSpan({ cls: "pdt-detail-icon" }), icon);
      b.createSpan({ text: label });
      b.onclick = onClick;
      return b;
    };
    const star = (icon, tip, fn, cls) => { const b = button(icon, t("details.favorite"), () => this.act(fn), cls); setTooltip(b, tip); return b; };
    this.view.renderStar(footer, star, p, note, (fn) => this.act(fn));
    button("folder-plus", t("action.group"), () => this.act(() => plugin.chooseGroup(p)));
    button("eye-off", t("action.snooze"), () => this.drop(() => plugin.snooze(p)));
    button("ban", t("action.exclude"), () => this.drop(() => plugin.exclude(p)));
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
    nav.createSpan({ cls: "pdt-detail-muted", text: t("details.escClose") });
  }

  /**
   * The release history as a strip of the pauses between update waves, colored by length (under a month, 1–6 months,
   * 6–12 months, over a year), the last one striped while it lasts. Widths grow with the log of the pause, so a
   * 4-year silence is wider than a 1-year one without squeezing the busy months into a point.
   */
  renderHistory(box, dates, now) {
    if (!dates.length) {
      box.createEl("p", { cls: "pdt-detail-muted", text: t("details.noHistory") });
      return;
    }
    const gaps = releaseGaps(dates, now);
    const weight = (g) => Math.log1p(g.days) || 0.1;   // an update today still gets a sliver
    const total = gaps.reduce((sum, g) => sum + weight(g), 0);
    const strip = box.createDiv({ cls: "pdt-gaps", attr: { role: "img", "aria-label": t("details.historyLabel", { n: dates.length }) } });
    for (const g of gaps) {
      const tone = g.days < 30 ? "short" : g.days < 182 ? "mid" : g.days < YEAR_DAYS ? "long" : "gap";
      const cell = strip.createSpan({ cls: `pdt-gap is-${tone}${g.open ? " is-open" : ""}` });
      cell.setCssProps({ "--pdt-w": String(weight(g) / total) });
      if (g.days >= 30 && weight(g) / total >= 0.09) cell.setText(spanLabel(g.days));
      const span = spanLabel(g.days);
      const wave = t("details.gapWave", { date: dayString(g.from), n: g.releases });
      setTooltip(cell, g.open ? `${wave} · ${t("details.gapOpen", { span })}` : `${wave} · ${t("details.gapNext", { span, date: dayString(g.to) })}`, { delay: 100 });
    }
    const ends = box.createDiv({ cls: "pdt-history-ends" });
    ends.createSpan({ text: dayString(dates[0]) });
    ends.createSpan({ text: t("details.today") });
    const cadence = releaseCadence(dates, now);
    if (cadence) box.createDiv({ cls: "pdt-history-note", text: cadenceNote(cadence, dates.at(-1), now) });
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

