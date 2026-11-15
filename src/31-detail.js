/**
 * A plugin's details in a large window that grows out of its card or row: the numbers, the whole
 * description and its translation, your note, the README (and its translation, on request), the closest
 * plugins and the release history. ←/→ walk the list it was opened from, the list's shortcut keys work here too
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
    this.tab = "readme";
    this.loads = new Map();     // id → "busy" | "done": a README fetched the first time it's shown (once per window)
    this.newer = new Map();     // id → the README now on GitHub when it changed (null: asked, nothing new)
    this.busy = "";             // progress of a translation in this window
    this.scope.register([], "ArrowLeft", () => { this.step(-1); return false; });
    this.scope.register([], "ArrowRight", () => { this.step(1); return false; });
    for (const key of ["j", "k", "f", "g", "x", "h", "t", "r", "s", "o", "0", "1", "2", "3", "4", "5"]) {
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
    this.tab = "readme";
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
      if (!this.infoEl || file.path !== this.plugin.notes.index.get(p.id)?.path) return;
      this.plugin.readmeParts(p).then((parts) => { if (this.p === p && !this.closed) this.renderInfo(this.infoEl, parts); });
    }));
    // grow out of the card: the animation starts at the card's centre (no motion if the system asks for less)
    const from = this.origin?.getBoundingClientRect?.();
    const box = this.modalEl.getBoundingClientRect?.();
    if (from && box) this.modalEl.setCssProps({ "--pdt-origin": `${from.left + from.width / 2 - box.left}px ${from.top + from.height / 2 - box.top}px` });
    this.modalEl.addClass("is-growing");
    // a right click opens the row's menu; links and the README keep the browser's own (copy, open link)
    this.modalEl.addEventListener("contextmenu", (event) => {
      if (event.target.closest?.("a, input, textarea, .markdown-rendered")) return;
      event.preventDefault();
      this.view.rowRenderer.showRowMenu(this.p, event, this.effects());
    });
    this.render();
  }

  onClose() {
    this.closed = true;
    clearTimeout(this.seenTimer);
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

  /** What follows an action here (see RowRenderer.rowEffects): a change redraws, leaving shows the next plugin, opening something else closes. */
  effects() {
    return { change: (fn) => this.act(fn), leave: (fn) => this.drop(fn), away: () => this.close() };
  }

  /**
   * A shortcut key (KEY_HELP), as in the list when shortcuts are on: j/k walk like ←/→, the rest act on the plugin
   * shown. Returns true to leave the key to Obsidian (shortcuts off, typing in a field, a translation running).
   */
  onKey(key) {
    const typing = globalThis.document?.activeElement?.closest?.("input, textarea, select, [contenteditable]");
    if (!this.plugin.data.settings.keyboard || typing || this.busy) return true;
    if (key === "j" || key === "k") {
      this.step(key === "j" ? 1 : -1);
      return false;
    }
    const p = this.p;
    this.view.rowRenderer.shortcutActions(p, { ...this.effects(), translate: () => this.toggleTranslation(p) })[key]?.();
    return false;
  }

  /** The description's translation under it, on or off (as on a row; the first time asks the AI). */
  async toggleTranslation(p) {
    await this.view.rowRenderer.toggleTranslation(p);
    this.render();
  }

  /**
   * A tracked plugin with a new release: after SEEN_AFTER_MS on screen here it counts as seen (a quick look past it,
   * or closing the window sooner, doesn't).
   */
  watchSeen(p, note) {
    clearTimeout(this.seenTimer);
    if (!isUnreviewed(p, note)) return;
    this.seenTimer = setTimeout(async () => {
      if (this.closed || this.p !== p) return;
      await this.plugin.markSeen(p);
      this.render();
    }, SEEN_AFTER_MS);
  }

  render() {
    const p = this.p;
    const plugin = this.plugin;
    const note = plugin.notes.index.get(p.id);
    if (this.watching !== p.id) {   // once per plugin shown, not on every redraw
      this.watching = p.id;
      this.watchSeen(p, note);
    }
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
    if (p.removed) about.createEl("p", { cls: "pdt-detail-removed", text: t("details.removed", { reason: p.removed.reason || "–", date: dayString(p.removed.at) }) });
    const desc = about.createEl("p", { text: p.description || "–" });
    if (p.description) {   // a click translates it (and hides the translation again), as on a row
      Object.assign(desc, { role: "button", tabIndex: 0 });
      desc.addClass("pdt-detail-desc");
      setTooltip(desc, t("row.translateTip"));
      desc.onclick = () => this.toggleTranslation(p);
      onActivate(desc, () => this.toggleTranslation(p));
    }
    const translation = plugin.cachedTranslation(p);
    if (translation != null && this.view.shownTranslations.has(p.id)) about.createEl("p", { cls: "pdt-detail-trans", text: translation });
    if (note?.note) section(main, t("details.yourNote")).box.createEl("p", { text: note.note });
    const footer = el.createDiv({ cls: "pdt-detail-foot" });      // under the columns; made here for the README to fill its info
    this.infoEl = footer.createDiv({ cls: "pdt-detail-info" });
    this.renderReadme(main, p, note, this.infoEl);

    const side = columns.createDiv({ cls: "pdt-detail-side" });
    const similar = plugin.similarTo(p);
    const near = section(side, t("details.similar"));
    if (similar.length) {
      const all = near.head.createEl("a", { cls: "pdt-detail-head-link", text: t("details.similarAll", { n: similar.length }), href: "#" });
      all.onclick = (event) => { event.preventDefault(); this.close(); this.view.similarFilter.open(p); };
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
    // the server keeps the last RELEASES_CAP releases: a busy plugin had more, and its strip starts at the oldest kept one
    const capped = dates.length >= RELEASES_CAP;
    if (dates.length) history.head.createSpan({ cls: "pdt-detail-head-note", text: t(capped ? "details.historyCapped" : "details.historyLabel", { n: dates.length }) });
    this.renderHistory(history.box.createDiv({ cls: "pdt-detail-card" }), dates, now);
    if (p.repo) {
      const repo = history.box.createEl("a", { cls: "pdt-detail-card pdt-detail-repo", href: `https://github.com/${p.repo}` });
      setIcon(repo.createSpan({ cls: "pdt-detail-icon" }), "github");
      repo.createSpan({ cls: "pdt-detail-repo-name", text: p.repo });
      repo.createSpan({ cls: "pdt-detail-head-note", text: "GitHub ↗" });
    }

    this.renderNav(footer);
  }

  /**
   * Name, version and author on one line; on the right 🔔 (track), ★ (1–5 on hover) and ⋯ (the row's menu), "Open in Obsidian",
   * ⤢ and ✕. Your groups and rating under the name, when there are any.
   */
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
      if (note.rating) tags.createSpan({ cls: "pdt-detail-stars", text: ratingStars(note.rating) });
      tags.createSpan({ cls: "pdt-detail-muted", text: t("details.tracked") });
    }
    const actions = title.createDiv({ cls: "pdt-detail-head-actions" });
    const rows = this.view.rowRenderer;
    const act = (icon, tip, fn, cls = "") => {
      const button = iconButton(actions, icon, tip, cls);
      button.onclick = () => this.act(fn);
      return button;
    };
    rows.renderTrack(act, p, note);
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
      setIcon(button, settings.detailFull ? "minimize-2" : "maximize-2");
      button.setAttribute("aria-label", t(settings.detailFull ? "details.restore" : "details.maximize"));
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
    const gained = gainOver(this.plugin.timeline, p.id, 30);
    stat(t("details.downloads"), p.downloads == null ? "–" : formatCount(p.downloads), gained != null ? t("details.growth30", { n: formatShort(gained) }) : t("details.downloadsSub"));
    stat(t("details.lastRelease"), p.updated ? relativeDays(p.updated, now) : "–", p.version);
    // age counts from the day it was listed; 0: it was there before the history starts
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
   * Bottom left: where the README comes from (your note or the cache), its version and when it was fetched; then
   * what its translation took, as the provider reported it: model, tokens and the cost (when it tells it).
   */
  renderInfo(info, { source, original, translation }) {
    info.empty();
    if (original) {
      info.createSpan({ text: t("details.infoReadme", {
        version: original.version ? `v${original.version}` : "–",
        where: t(source === "note" ? "details.inNote" : "details.inCache"),
        date: original.date || "–",
      }) });
    }
    if (!translation?.model) return;   // made before 0.12: nothing was recorded
    const took = [translation.model, t("details.tokensUsed", { n: formatShort(translation.tokens || 0) })];
    if (typeof translation.cost === "number") took.push(formatCost(translation.cost));
    const item = info.createSpan({ text: t("details.infoTranslation", { took: took.join(" · ") }) });
    setTooltip(item, t("details.infoTranslationTip", { date: translation.date || "–" }));
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
      const tone = g.days < 30 ? "short" : g.days < YEAR_DAYS / 2 ? "mid" : g.days < YEAR_DAYS ? "long" : "gap";   // under a month, 1–6 months, 6–12, a year+
      const cell = strip.createSpan({ cls: `pdt-gap is-${tone}${g.open ? " is-open" : ""}` });
      cell.setCssProps({ "--pdt-w": String(weight(g) / total) });
      if (g.days >= 30 && weight(g) / total >= 0.09) cell.setText(spanLabel(g.days));
      const span = spanLabel(g.days);
      const dates = g.releases > 1 ? `${dayString(g.from)} – ${dayString(g.last)}` : dayString(g.from);
      const after = g.open ? t("details.gapOpen", { span }) : t("details.gapNext", { span, date: dayString(g.to) });
      setTooltip(cell, `${t("details.gapWave", { date: dates, n: g.releases })}\n${after}`, { delay: 100 });
    }
    const ends = box.createDiv({ cls: "pdt-history-ends" });
    ends.createSpan({ text: dates.length >= RELEASES_CAP ? t("details.historySince", { date: dayString(dates[0]) }) : dayString(dates[0]) });
    ends.createSpan({ text: t("details.today") });
    const cadence = releaseCadence(dates, now);
    if (cadence) box.createDiv({ cls: "pdt-history-note", text: cadenceNote(cadence, dates.at(-1), now) });
  }

  /**
   * README / README · <language> tabs. The README shows right away: from your note or the cache, fetched the first
   * time. The translation tab is dim until there is one and translates on request; it is marked outdated only when
   * the README's text changed since (an unchanged README of a newer release doesn't count).
   */
  async renderReadme(parent, p, note, info) {
    const plugin = this.plugin;
    const box = parent.createDiv({ cls: "pdt-detail-section pdt-detail-readme" });
    const translating = plugin.data.settings.readmeTranslation !== "off";
    const parts = await plugin.readmeParts(p);
    if (this.p !== p || this.closed) return;   // moved on while reading
    const { original, translation } = parts;
    const outdated = Boolean(original && translation?.hash && translation.hash !== original.hash);
    this.renderInfo(info, parts);
    const tabs = box.createDiv({ cls: "pdt-detail-tabs", attr: { role: "tablist" } });
    const tab = (key, label, extra = "") => {
      const b = tabs.createEl("button", { cls: `pdt-detail-tab${this.tab === key ? " is-active" : ""}${extra}`, attr: { type: "button", role: "tab", "aria-selected": String(this.tab === key) } });
      b.createSpan({ text: label });
      b.onclick = () => { this.tab = key; this.render(); };
      return b;
    };
    tab("readme", "README");
    if (translating) {
      const t2 = tab("translation", t("details.readmeIn", { lang: plugin.data.settings.targetLang }), translation ? "" : " is-dim");
      if (!translation) t2.createSpan({ cls: "pdt-detail-tab-note", text: t("details.none") });
      else if (outdated) setTooltip(t2.createSpan({ cls: "pdt-detail-tab-dot" }), t("details.outdated"));
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
    const bar = (text, label, onClick) => {
      const row = body.createDiv({ cls: "pdt-detail-stale" });
      row.createSpan({ text });
      row.createEl("button", { cls: "pdt-link-button", text: label, attr: { type: "button" } }).onclick = onClick;
    };
    if (this.tab === "readme") {
      if (original) {
        const newer = this.checkNewer(p, original);
        if (newer) bar(t("details.readmeChanged", { version: p.version }), t("details.readmeUpdate"), async () => {
          await plugin.keepReadme(p, newer);
          this.newer.set(p.id, null);
          this.render();
        });
        return render(original.text);
      }
      body.addClass("is-empty");
      if (!p.repo || this.loads.get(p.id) === "done") return body.createEl("p", { cls: "pdt-detail-muted", text: t("readme.failed") });
      body.createEl("p", { cls: "pdt-detail-muted", text: t("details.loadingReadme") });
      this.loadReadme(p);
      return;
    }
    const estimate = translationEstimate(plugin.translationSource(original?.text || "").text, plugin.data.settings.modelCost);
    const price = estimate.cost != null ? ` (${t("details.cost", { cost: formatCost(estimate.cost) })})` : "";
    if (translation && !this.busy) {
      if (outdated) bar(t("details.outdatedNote"), `${t("details.translateAgain")}${price}`, () => this.translate(p));
      return render(translation.body);
    }
    body.addClass("is-empty");
    if (this.busy) {
      body.createEl("p", { text: this.busy });
      return;
    }
    body.createEl("p", { text: t("details.notTranslated", { lang: plugin.data.settings.targetLang }) });
    body.createEl("button", { cls: "mod-cta", text: t("details.translate"), attr: { type: "button" } }).onclick = () => this.translate(p);
    if (original) {
      body.createEl("p", {
        cls: "pdt-detail-muted",
        text: [t("details.chars", { n: formatCount(estimate.chars) }), t("details.tokens", { n: formatCount(estimate.tokens) }),
          estimate.cost != null ? t("details.cost", { cost: formatCost(estimate.cost) }) : null, plugin.data.settings.model].filter(Boolean).join(" · "),
      });
    }
  }

  /** A README not seen before: fetched in the background (into your note, else the cache), then shown. Once per window. */
  async loadReadme(p) {
    if (this.loads.has(p.id)) return;
    this.loads.set(p.id, "busy");
    try {
      await this.plugin.fetchReadme(p);
    } catch (error) {
      console.warn("[Community Radar] couldn't fetch the README", error);
    }
    this.loads.set(p.id, "done");
    if (this.p === p && !this.closed) this.render();
  }

  /**
   * The README now on GitHub when the kept one is from an older release and its text changed; null otherwise.
   * GitHub is asked once per window, in the background; the answer redraws the window when there's something new.
   */
  checkNewer(p, original) {
    if (this.newer.has(p.id)) return this.newer.get(p.id);
    if (!p.version || original.version === p.version) return null;
    this.newer.set(p.id, null);
    this.plugin.newerReadme(p, original).then((readme) => {
      if (!readme) return;
      this.newer.set(p.id, readme);
      if (this.p === p && !this.closed) this.render();
    }, (error) => console.warn("[Community Radar] couldn't check the README", error));
    return null;
  }

  async translate(p) {
    this.busy = t("details.translating");
    this.render();
    await this.plugin.translateReadme(p, (text) => { this.busy = text; if (this.p === p) this.render(); });
    this.busy = "";
    this.render();
  }
}

