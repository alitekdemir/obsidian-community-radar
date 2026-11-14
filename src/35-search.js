// ─── SearchBox ─────────────────────────────────────────────────────
/**
 * The list's search box: the query language with its colours, tips and suggestions, Basic | Query, the unsaved-
 * changes badge. Works on the view's state (see ViewPart).
 */
class SearchBox extends ViewPart {
  /** Saves what the list shows as a view (its query): asks its name and where it goes on Home, then opens it. */
  async saveView() {
    const mode = this.view.page;
    const query = this.view.inQuery ? this.view.boxText : joinQuery(pageQuery(this.view.pageSettings, mode), filtersToQuery(this.settings, mode));
    const suggested = this.view.preset ? this.view.home.title(this.view.preset.id) : t(`mode.${mode}`);
    const widget = viewWidget({ id: "preview", name: suggested, query }, null);   // how it will look, before it's saved
    const at = await this.view.home.ask({ id: VIEW_PREFIX + widget.view.id, widget, name: suggested, askName: true });
    if (!at) return;
    const name = at.name;
    const view = await this.view.home.saveView(name, query, queryRows(this.view.home.context(Date.now()), query), at.group);
    new Notice(t("home.view.saved", { name }));
    this.view.home.openView(VIEW_PREFIX + view.id);
  }

  /**
   * The search box (comma terms, /regex/ or the query language). A textarea over a painted copy of its text: the
   * copy colours each word by its role (field, operator, value, function, keyword) and underlines a broken part,
   * and gives the box its height (long queries wrap, new lines are kept). `onChange` runs 1 s after typing stops,
   * at once when the box is cleared or on Enter (Ctrl/Cmd+Enter in a query, where Enter starts a new line).
   * `modes` (the list's own box): the Basic | Query buttons and the switch to Query as an advanced query is typed.
   * Returns the textarea.
   */
  renderSearch(bar, value, placeholder, onChange, modes = false) {
    const queryMode = modes === "query" || (modes === true && this.view.inQuery);   // "query": always (a widget's list)
    // the slot keeps the bar one row high; out of focus the box shows one line, in focus it opens down over the list
    const search = bar.createDiv({ cls: "pdt-search-slot" }).createDiv({ cls: `pdt-search${queryMode ? " is-query" : ""}` });
    setIcon(search.createSpan({ cls: "pdt-search-icon" }), "search");
    const box = search.createDiv({ cls: "pdt-q" });
    const paint = box.createDiv({ cls: "pdt-q-paint", attr: { "aria-hidden": "true" } });
    const input = box.createEl("textarea", { cls: "pdt-q-input", attr: { rows: "1", placeholder, spellcheck: "false", autocomplete: "off", autocapitalize: "off" } });
    input.value = value || "";
    const more = search.createSpan({ cls: "pdt-q-more" });   // "+1 line" while the box is folded
    const badge = search.createSpan({ cls: "pdt-regex", text: ".*" });
    setTooltip(badge, t("search.regex"));
    const help = iconButton(search, "help-circle", t("query.help.title"), "pdt-qhelp-button");
    help.onclick = () => new HelpModal(this.app, this.view, { tab: "guide", onPick: (text) => {   // a click puts it at the caret
      const at = input.selectionStart ?? input.value.length;
      const before = input.value.slice(0, at);
      const glue = before && !/\s$/.test(before) ? " " : "";
      input.value = `${before}${glue}${text} ${input.value.slice(input.selectionEnd ?? at)}`;
      const caret = before.length + glue.length + text.length + 1;
      input.focus();
      input.setSelectionRange(caret, caret);
      input.dispatchEvent(new Event("input"));
    } }).open();
    const seg = modes === true && this.renderQueryModes(search, queryMode);
    if (modes === true) {
      this.view.refs.changes = search.createEl("button", { cls: "pdt-q-changes is-hidden", attr: { type: "button" } });   // filled by renderChanges
      search.insertBefore(this.view.refs.changes, help);
    }
    let tokens = [];
    const mark = () => {
      const text = input.value;
      const { regex, error, advanced, from = 0, to = 0 } = compileQuery(text, null, Date.now(), queryMode);
      search.toggleClass("is-regex", regex && !error);
      search.toggleClass("is-advanced", Boolean(advanced));
      search.toggleClass("is-invalid", Boolean(error));
      setTooltip(input, error || "");
      paint.empty();
      const bad = error ? [from, to] : null;
      const piece = (a, b, cls) => {
        if (a >= b) return;
        const broken = bad && a < bad[1] && b > bad[0];
        if (cls || broken) paint.createSpan({ cls: [cls && `pdt-q-${cls}`, broken && "is-bad"].filter(Boolean).join(" "), text: text.slice(a, b) });
        else paint.append(text.slice(a, b));
      };
      let at = 0;
      tokens = advanced ? queryHighlight(text) : [];
      tokens.forEach((tok, k) => {
        piece(at, tok.at, "");
        piece(tok.at, tok.end, tok.cls);
        if (tok.cls) paint.lastChild.dataset.k = String(k);
        at = tok.end;
      });
      piece(at, text.length, "");
      paint.append("\u200b");   // keeps a trailing new line's height
      const lines = text.split("\n").length - 1;
      more.setText(lines ? t("search.more", { n: lines }) : "");
      if (seg) seg.refresh(text);
    };
    if (QuerySuggest) new QuerySuggest(this.app, input, () => this.queryData(modes === true));
    mark();
    this.queryTips(box, input, paint, () => tokens);
    let timer;
    const apply = (delay) => {
      clearTimeout(timer);
      timer = setTimeout(() => onChange(input.value), delay);
    };
    input.oninput = () => {
      if (modes === true && !queryMode && isAdvancedQuery(input.value)) return this.toQueryMode(input);   // typed a query: Query mode
      mark();
      apply(input.value.trim() ? 1000 : 0);
    };
    input.onkeydown = (event) => {
      if (event.key === " " && event.ctrlKey) {   // Ctrl+Space: the suggestions, wherever the caret is
        event.preventDefault();
        input.dispatchEvent(new Event("input"));
        return;
      }
      if (event.key === "Escape" && !event.defaultPrevented && input.value) {   // an open list took the first Esc
        event.preventDefault();
        event.stopPropagation();
        input.value = queryMode ? pageQuery(this.view.pageSettings, this.view.page) : "";
        input.oninput();
        return;
      }
      if (event.key !== "Enter" || event.defaultPrevented || event.isComposing) return;   // a picked suggestion took it
      if (event.ctrlKey || event.metaKey || !search.hasClass("is-advanced")) {
        event.preventDefault();
        apply(0);
      }
    };
    return input;
  }

  /**
   * A tooltip for the word under the mouse (field, operator, value, function, keyword), after a short rest; none
   * while typing. The textarea covers the painted words, so it steps aside for a moment to find the one below.
   */
  queryTips(box, input, paint, tokens) {
    const doc = box.ownerDocument;
    if (!doc.elementFromPoint) return;
    let timer;
    let shown = null;
    const hide = () => { clearTimeout(timer); shown?.remove(); shown = null; };
    input.addEventListener("mousemove", (event) => {
      hide();
      timer = setTimeout(() => {
        input.style.pointerEvents = "none";
        paint.style.pointerEvents = "auto";
        const el = doc.elementFromPoint(event.clientX, event.clientY);
        input.style.pointerEvents = paint.style.pointerEvents = "";
        const k = el?.dataset?.k;
        if (k == null) return;
        const list = tokens();
        const tip = queryTip(list[k], list[k - 1], Date.now(), this.plugin.state());
        if (!tip) return;
        shown = doc.body.createDiv({ cls: "pdt-qtip" });
        const head = shown.createDiv({ cls: "pdt-qtip-head" });
        head.createEl("code", { text: tip.head });
        if (tip.kind) head.createSpan({ cls: "pdt-qtip-kind", text: tip.kind });
        shown.createDiv({ text: tip.body });
        if (tip.example) shown.createDiv({ cls: "pdt-qtip-example", text: tip.example });
        const r = el.getBoundingClientRect();
        Object.assign(shown.style, { left: `${Math.round(r.left)}px`, top: `${Math.round(r.bottom + 6)}px` });
      }, 300);
    });
    for (const type of ["mouseleave", "keydown", "input", "blur"]) input.addEventListener(type, hide);
  }

  /**
   * Basic | Query, at the box's end (Jira's Basic / JQL). Query writes the filters into the box; Basic turns the
   * query back into filters, and is locked (with the reason) when the query has something filters can't say.
   */
  renderQueryModes(search, queryMode) {
    const seg = search.createDiv({ cls: "pdt-qmode", attr: { role: "group" } });
    const basic = seg.createEl("button", { cls: "pdt-qmode-option", text: t("query.mode.basic"), attr: { type: "button", "aria-pressed": String(!queryMode) } });
    const query = seg.createEl("button", { cls: "pdt-qmode-option", text: t("query.mode.query"), attr: { type: "button", "aria-pressed": String(queryMode) } });
    setTooltip(query, t("query.mode.queryTip"));
    let reason = "";
    basic.onclick = () => (!queryMode ? null : reason ? new Notice(reason) : this.toBasicMode());
    query.onclick = () => (queryMode ? null : this.toQueryMode());
    seg.refresh = (text) => {
      reason = queryMode ? queryToBasic(text, this.view.pageSettings, this.view.page).reason || "" : "";
      basic.toggleClass("is-locked", Boolean(reason));
      setTooltip(basic, reason || t("query.mode.basicTip"));
    };
    return seg;
  }

  /**
   * To Query mode: the page's query with your narrowing (words, Downloads ≥, added filters, your sort) goes into
   * the box, and the narrowing rests. From typing (`input`), what you typed comes after the page's query.
   */
  async toQueryMode(input = null) {
    const settings = this.settings;
    const mode = this.view.page;
    const page = pageQuery(this.view.pageSettings, mode);
    const full = joinQuery(page, filtersToQuery(settings, mode));
    let text = full;
    let caret = null;
    if (input) {
      const lead = splitOrder(joinQuery(page, filtersToQuery({ ...settings, query: "" }, mode)));
      const typed = input.value;
      const mine = splitOrder(typed);   // your own order by replaces the page's
      const joint = /^(AND|OR)\b/i.test(mine.filter) ? " " : " AND ";   // after the page's query, joined by AND
      const filter = [lead.filter, mine.filter].filter(Boolean).join(joint);
      text = typed.startsWith(lead.filter) ? typed : [filter, mine.order || lead.order].filter(Boolean).join("\n");
      caret = typed.startsWith(lead.filter) ? input.selectionStart : mine.filter ? (input.selectionStart ?? typed.length) + filter.length - mine.filter.length : text.length;
    }
    const valid = !compileQuery(text, null, Date.now(), true).error;
    const { [mode]: sort, ...sortBy } = settings.sortBy || {};
    const { [mode]: dl, ...downloadFilter } = settings.downloadFilter || {};
    Object.assign(settings, { query: "", sortBy, downloadFilter, extraFilters: { ...settings.extraFilters, [mode]: {} },
      queries: { ...settings.queries, [mode]: valid ? text : full } });
    this.view.queryDraft = valid ? null : text;
    this.view.visible = PAGE_SIZE;
    this.view.bulkBar.clearSelection();
    this.view.render();
    const box = this.view.refs.search;
    box.focus();
    box.setSelectionRange(caret ?? text.length, caret ?? text.length);
    await this.plugin.saveData(this.plugin.data);
  }

  /** Back to Basic: what follows the page's query becomes filters again, its order by the sort. */
  async toBasicMode() {
    const { patch, reason } = queryToBasic(this.view.boxText, this.view.pageSettings, this.view.page);
    if (reason) return new Notice(reason);
    Object.assign(this.settings, patch);
    this.view.queryDraft = null;
    this.view.visible = PAGE_SIZE;
    this.view.bulkBar.clearSelection();
    this.view.render();
    await this.plugin.saveData(this.plugin.data);
  }

  /** The last queries you applied (up to RECENT_QUERIES), newest first, for the empty box's list. */
  rememberQuery(text) {
    const q = text.trim();
    if (!q) return;
    const flat = (x) => x.replace(/\s+/g, " ");
    this.settings.recentQueries = [q, ...(this.settings.recentQueries || []).filter((x) => flat(x) !== flat(q))].slice(0, RECENT_QUERIES);
  }

  /** Query mode: the box back to the page's own query. */
  async revertQuery() {
    const mode = this.view.page;
    this.settings.queries = { ...this.settings.queries, [mode]: pageQuery(this.settings, mode) };
    this.view.queryDraft = null;
    this.view.visible = PAGE_SIZE;
    this.view.render();
    await this.plugin.saveData(this.plugin.data);
  }

  /**
   * What the query suggestions offer as values: your groups (with counts), statuses, and the catalog's authors;
   * for the empty list box (`modes`), your filters as a query.
   */
  queryData(modes = false) {
    if (!this.view.authors || this.view.authors.at !== this.plugin.catalog?.fetchedAt) {
      const byAuthor = new Map();
      for (const p of this.plugin.catalog?.plugins || []) if (p.author) byAuthor.set(p.author, (byAuthor.get(p.author) || 0) + (p.downloads || 0));
      this.view.authors = { at: this.plugin.catalog?.fetchedAt, list: [...byAuthor].sort((a, b) => b[1] - a[1]).map(([name]) => name) };
    }
    const fromFilters = modes && !this.view.inQuery ? joinQuery(pageQuery(this.view.pageSettings, this.view.page), filtersToQuery({ ...this.view.pageSettings, query: "" }, this.view.page)) : "";
    return { groups: this.plugin.notes.groups(), statuses: this.settings.statuses || [], authors: this.view.authors.list, fromFilters, recent: this.settings.recentQueries || [] };
  }

  /**
   * Each clause of the query (NOT with its own) and how many plugins it finds on its own; `without`: how many the
   * query finds without it, most first (what emptied a list).
   */
  clauseCounts(query, without = false) {
    const spans = compileQuery(query, null, Date.now(), true).spans || [];
    const top = spans.filter((x) => x.kind !== "order" && !spans.some((y) => y !== x && y.from <= x.from && y.to >= x.to && y.kind === "neg"));
    const count = (text) => {
      const mode = this.view.page;
      return discover(this.plugin.state(), modeOptions({ ...this.view.pageSettings, queries: { ...this.settings.queries, [mode]: text } }, mode), Date.now()).length;
    };
    const rows = top.map((x) => {
      const clause = query.slice(x.from, x.to);
      return [clause, count(without ? dropClause(query, x) : clause)];
    });
    return without ? rows.sort((a, b) => b[1] - a[1]) : rows;
  }

  /**
   * While the query isn't the page's own: a "● 2 changes" badge in the box (what changed in its tooltip) and a dot on
   * the tab; the badge opens Discard · New view… · the one save that fits (this tab's query, this view; a widget's
   * list becomes a view). A broken query shows "● Error" and can only be discarded.
   */
  renderChanges() {
    const badge = this.view.refs.changes;
    if (!badge) return;
    const preset = this.view.preset;
    const view = preset?.id.startsWith(VIEW_PREFIX);
    const base = pageQuery(this.view.pageSettings, this.view.page);
    const text = this.view.boxText;
    const changed = this.view.inQuery && !sameQuery(text, base);
    const broken = this.view.queryDraft != null;
    const diff = changed && !broken ? queryDiff(base, text) : "";
    const tab = [...this.view.contentEl.querySelectorAll(".pdt-tab")].find((el) => el.dataset.key === this.view.page);   // keys hold quotes: no selector
    const dot = tab?.querySelector(".pdt-tab-dot");
    if (changed && tab && !dot) tab.createSpan({ cls: "pdt-tab-dot", attr: { "aria-label": t("query.changed") } });   // the tab shows it's unsaved
    if (!changed) dot?.remove();
    badge.toggleClass("is-hidden", !changed);
    badge.toggleClass("is-error", broken);
    if (!changed) return;
    badge.setText(`● ${broken ? t("query.error") : t("query.changes", { n: diff ? diff.split(" · ").length : 1 })}`);
    setTooltip(badge, broken ? t("query.cantSave") : diff || t("query.changed"));
    badge.onclick = () => {
      if (this.view.changesPop?.isOpen) return this.view.changesPop.close();
      this.view.changesPop = new Popover(badge, { cls: "pdt-changes-pop", label: t("query.changed"), keep: ".pdt-q-changes", fill: (box, pop) => {
        box.createDiv({ cls: "pdt-changes-what", text: broken ? t("query.cantSave") : diff || t("query.changed") });
        const row = box.createDiv({ cls: "pdt-changes-actions" });
        const button = (label, cls, run) => {
          const el = row.createEl("button", { cls, text: label, attr: { type: "button" } });
          el.onclick = async () => { pop.close(); await run(); };
          return el;
        };
        button(t("query.discard"), "pdt-changes-discard", () => this.revertQuery());
        if (broken) return;
        const widget = Boolean(preset && !view);
        if (widget) return button(t("query.saveWidget"), "mod-cta", () => this.saveView());
        button(t("query.newView"), "", () => this.saveView());
        if (view) {
          button(t("query.updateView", { name: this.view.home.title(preset.id) }), "mod-cta", async () => {
            await this.view.home.updateView(preset.id, text);
            preset.base = text;   // the view's query now: nothing changed any more
            this.view.render();
          });
        } else {
          button(t("query.replacePage", { name: t(`mode.${this.settings.mode}`) }), "mod-cta", () => this.view.savePageQuery());
          box.createDiv({ cls: "pdt-changes-hint", text: t("query.replaceHint") });
        }
      } }).open();
    };
  }
}
