const SETTING_TABS = ["general", "notes", "data", "ai", "hidden"];   // the settings, one tab at a time

/**
 * Settings › Translation effect's preview: a small copy of the details window (the description, one Overview part) in
 * English, as an original is, shown as being read with `fx` by the same showReading the window uses. Redrawn on every
 * change; its effect ends with it (a Matrix one stops when the box leaves the page).
 */
function fxPreview(box, fx) {
  box.empty();
  const desc = box.createEl("p", { cls: "pdt-detail-about", attr: { lang: "en" } });
  desc.createSpan({ cls: "pdt-fx-preview-tag", text: "EN" });
  desc.createSpan({ cls: "pdt-lang-text", text: FX_PREVIEW.description });
  const parts = box.createDiv({ cls: "pdt-overview-parts", attr: { lang: "en" } });
  const part = parts.createDiv({ cls: "pdt-overview-part is-lead" });
  part.createEl("h4", { text: tIn("en", "details.what") });
  part.createEl("p").createSpan({ cls: "pdt-ln", text: FX_PREVIEW.summary });
  const still = document.body.classList.contains(STILL_CLASS);
  showReading(desc, fx, 0, still);
  showReading(parts, fx, 1, still);
}

class RadarSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.modelList = null;
  }

  display() {
    const { containerEl } = this;
    const plugin = this.plugin;
    const settings = plugin.data.settings;
    const save = () => plugin.saveData(plugin.data);
    containerEl.empty();
    const tab = SETTING_TABS.includes(this.tab) ? this.tab : SETTING_TABS[0];   // the last one you looked at, while open
    this.renderTabs(containerEl, tab);
    const body = containerEl.createDiv({ cls: "pdt-settings-body", attr: { role: "tabpanel" } });
    const sections = { general: this.displayGeneral, notes: this.displayNotes, data: this.displayData, ai: this.displayTranslation, hidden: this.displayHidden };
    sections[tab].call(this, body, settings, save);
  }

  /** The tab strip: one section of the settings at a time (Hidden carries its count). */
  renderTabs(containerEl, current) {
    const strip = containerEl.createDiv({ cls: "pdt-settings-tabs", attr: { role: "tablist" } });
    const hidden = Object.values(this.plugin.hiddenCounts()).reduce((a, b) => a + b, 0);
    for (const key of SETTING_TABS) {
      const on = key === current;
      const button = strip.createEl("button", { cls: `pdt-settings-tab${on ? " is-active" : ""}`, text: t(`set.tab.${key}`), attr: { type: "button", role: "tab", "aria-selected": String(on) } });
      if (key === "hidden" && hidden) button.createSpan({ cls: "pdt-settings-tab-n", text: formatCount(hidden) });
      button.onclick = () => { this.tab = key; this.display(); };
    }
  }

  /** General: language, where the view opens, how long a plugin is new, keyboard, support. */
  displayGeneral(containerEl, settings, save) {
    const plugin = this.plugin;
    new Setting(containerEl)
      .setName(t("set.language"))
      .setDesc(t("set.languageDesc"))
      .addDropdown((d) => {
        d.addOption("auto", t("set.languageAuto", { name: STRINGS[matchLanguage(obsidianLanguage())]["language.name"] }));
        for (const [code, strings] of Object.entries(STRINGS)) d.addOption(code, strings["language.name"]);
        d.setValue(settings.language).onChange(async (value) => {
          settings.language = value;
          await save();
          setLanguage(plugin.uiLanguage());
          plugin.redraw(true);
          this.display();
        });
      });

    new Setting(containerEl)
      .setName(t("set.start"))
      .setDesc(t("set.startDesc"))
      .addDropdown((d) => d.addOption("home", t("home.startHome")).addOption("last", t("home.startLast"))
        .setValue(settings.start).onChange(async (value) => {
          settings.start = value;
          await save();
        }));

    new Setting(containerEl)
      .setName(t("set.newDays"))
      .setDesc(t("set.newDaysDesc"))
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.setValue(String(settings.newDays)).onChange(async (value) => {
          const n = Math.round(Number(value));
          if (!(n >= 1)) return;
          settings.newDays = n;
          await save();
          plugin.redraw(true);
        });
      });

    new Setting(containerEl)
      .setName(t("set.keyboard"))
      .setDesc(t("set.keyboardDesc"))
      .addToggle((toggle) => toggle.setValue(Boolean(settings.keyboard)).onChange(async (value) => {
        settings.keyboard = value;
        await save();
        plugin.redraw(true);
      }));

    new Setting(containerEl)
      .setName(t("set.motion"))
      .setDesc(t("set.motionDesc"))
      .addDropdown((d) => d.addOption("system", t("set.motionSystem")).addOption("on", t("set.motionOn")).addOption("off", t("set.motionOff"))
        .setValue(settings.motion).onChange(async (value) => {
          settings.motion = value;
          await save();
          plugin.applyMotion();
          playPreview();   // the preview below shows it at once: moving or still
        }));

    new Setting(containerEl)
      .setName(t("set.translateFx"))
      .setDesc(t("set.translateFxDesc"))
      .addDropdown((d) => {
        for (const key of TRANSLATE_FX) d.addOption(key, t(`set.translateFx.${key}`));
        d.setValue(settings.translateFx).onChange(async (value) => {
          settings.translateFx = value;
          await save();
          playPreview();
        });
      });
    const preview = containerEl.createDiv({ cls: "pdt-fx-preview" });
    const playPreview = () => fxPreview(preview, settings.translateFx);
    playPreview();

    if (plugin.manifest.fundingUrl) {
      new Setting(containerEl)
        .setName(t("set.support"))
        .setDesc(t("set.supportDesc"))
        .addButton((b) => b.setButtonText(t("set.sponsor")).onClick(() => window.open(plugin.manifest.fundingUrl)));
    }
  }

  /** Notes: where tracking notes live, their heading, the status field, the Bases table. */
  displayNotes(containerEl, settings, save) {
    const plugin = this.plugin;
    new Setting(containerEl)
      .setName(t("set.folder"))
      .setDesc(t("set.folderDesc"))
      .addText((text) => text.setValue(settings.folder).onChange(async (value) => {
        settings.folder = value.trim() || defaultSettings().folder;
        await save();
        plugin.notes.rebuild();
      }));

    new Setting(containerEl)
      .setName(t("set.notesHeading"))
      .setDesc(t("set.notesHeadingDesc"))
      .addText((text) => text.setPlaceholder(t("note.myNotes")).setValue(settings.notesHeading).onChange(async (value) => {
        settings.notesHeading = value.trim();
        await save();
      }));

    const basePath = plugin.basePath();
    const baseExists = Boolean(this.app.vault.getAbstractFileByPath(basePath));
    new Setting(containerEl)
      .setName(t("set.base"))
      .setDesc(t("set.baseDesc", { path: basePath }))
      .addButton((b) => {
        b.setButtonText(t(baseExists ? "set.baseReset" : "set.baseCreate"));
        if (baseExists) b.setWarning();
        b.onClick(async () => {
          await plugin.writeBase();
          this.display();
        });
      });

    this.displayStatuses(containerEl, settings, save);
  }

  /** Data: how often to sync, the README in notes, sync now, the release history. */
  displayData(containerEl, settings, save) {
    const plugin = this.plugin;
    new Setting(containerEl)
      .setName(t("set.syncHours"))
      .setDesc(t("set.syncHoursDesc"))
      .addDropdown((d) => {
        for (const hours of SYNC_HOURS) d.addOption(String(hours), t(`sync.${hours}`));
        d.setValue(String(settings.syncHours)).onChange(async (value) => {
          settings.syncHours = Number(value);
          await save();
        });
      });
    const { catalog } = plugin;
    const now = Date.now();
    new Setting(containerEl)
      .setName(t("set.syncNow"))
      .setDesc(catalog ? t("set.lastSync", { time: formatTime(catalog.fetchedAt, now), age: formatAge(now - catalog.fetchedAt) }) : t("set.neverSynced"))
      .addButton((b) => b.setButtonText(t("set.syncNow")).setCta().onClick(async () => {
        b.setDisabled(true);
        await plugin.refresh();
        this.display();
      }));
    new Setting(containerEl)
      .setName(t("set.readmeMode"))
      .setDesc(t("set.readmeModeDesc"))
      .addDropdown((d) => {
        for (const mode of README_MODES) d.addOption(mode, t(`readmeMode.${mode}`));
        d.setValue(settings.readmeMode).onChange(async (value) => {
          settings.readmeMode = value;
          await save();
        });
      });
    const { timeline } = plugin;
    new Setting(containerEl)
      .setName(t("set.historySource"))
      .setDesc(timeline.to ? t("set.historyDesc", { from: dayString(timeline.from), to: dayString(timeline.to) }) : t("set.notBuilt"))
      .addButton((b) => b.setButtonText(t("set.rebuild")).onClick(async () => {
        await plugin.downloadHistory();
        this.display();
      }));
  }

  /** Hidden: the three kinds, each opening the Hidden page on it (search, sort and Restore are there). */
  displayHidden(containerEl) {
    const counts = this.plugin.hiddenCounts();
    for (const kind of LIST_MODES) {
      new Setting(containerEl)
        .setName(`${t(`mode.${kind}`)} (${formatCount(counts[kind])})`)
        .setDesc(t(`set.hidden.${kind}`))
        .addButton((b) => b.setButtonText(t("set.manage")).onClick(() => this.plugin.showList(kind)));
    }
  }

  /** The optional status field: on/off, then the list of statuses (label with an emoji, order, add, remove). */
  displayStatuses(containerEl, settings, save) {
    new Setting(containerEl)
      .setName(t("set.status"))
      .setDesc(t("set.statusDesc"))
      .addToggle((toggle) => toggle.setValue(Boolean(settings.statusEnabled)).onChange(async (value) => {
        settings.statusEnabled = value;
        await save();
        this.plugin.redraw(true);
        this.display();
      }));
    if (!settings.statusEnabled) return;
    const move = async (from, to) => {
      const list = [...settings.statuses];
      list.splice(to, 0, ...list.splice(from, 1));
      settings.statuses = list;
      await save();
      this.display();
    };
    settings.statuses.forEach((status, i) => {
      new Setting(containerEl)
        .setClass("pdt-status-setting")
        .setDesc(t("set.statusKey", { key: status.key }))
        .addText((text) => text.setValue(status.label).onChange(async (value) => {
          status.label = value.trim() || status.key;   // the key in your notes never changes
          await save();
        }))
        .addExtraButton((b) => b.setIcon("arrow-up").setTooltip(t("set.statusUp")).setDisabled(i === 0).onClick(() => move(i, i - 1)))
        .addExtraButton((b) => b.setIcon("arrow-down").setTooltip(t("set.statusDown")).setDisabled(i === settings.statuses.length - 1).onClick(() => move(i, i + 1)))
        .addExtraButton((b) => b.setIcon("trash-2").setTooltip(t("set.statusRemove")).onClick(async () => {
          settings.statuses = settings.statuses.filter((st) => st !== status);
          await save();
          this.display();
        }));
    });
    let draft = "";
    new Setting(containerEl)
      .setName(t("set.statusAdd"))
      .setDesc(t("set.statusAddDesc"))
      .addText((text) => text.setPlaceholder(t("set.statusPlaceholder")).onChange((value) => { draft = value; }))
      .addButton((b) => b.setButtonText(t("groups.add")).onClick(async () => {
        const label = draft.trim();
        if (!label) return;
        settings.statuses = [...settings.statuses, { key: statusKey(label, settings.statuses.map((st) => st.key)), label }];
        await save();
        this.display();
      }));
  }

  /** AI: provider, key, model, target language, README translation, the instructions (folded), saved translations. */
  displayTranslation(containerEl, settings, save) {
    const plugin = this.plugin;
    const translator = plugin.translator;
    if (!translator.supported) {
      new Setting(containerEl).setDesc(t("set.needsKeychain"));
      return;
    }

    new Setting(containerEl)
      .setName(t("set.provider"))
      .addDropdown((d) => {
        d.addOption("", t("set.none"));
        for (const [id, spec] of Object.entries(PROVIDERS)) d.addOption(id, spec.label);
        d.setValue(settings.provider).onChange(async (value) => {
          Object.assign(settings, { provider: value, model: "", modelCost: null, modelThinking: null });   // another provider: no model yet
          this.modelList = null;
          await save();
          this.display();
        });
      });

    if (settings.provider) {
      const provider = settings.provider;
      const keySetting = new Setting(containerEl)
        .setName(t("set.key"))
        .setDesc(`${t("set.keyDesc", { name: KEY_NAMES[provider] })} ${t(translator.key() ? "set.keyFound" : "set.keyMissing")}`);
      new obsidian.SecretComponent(this.app, keySetting.controlEl)
        .setValue(translator.keyName(provider))
        .onChange(async (name) => {
          settings.keyNames = { ...settings.keyNames, [provider]: name || "" };
          this.modelList = null;
          await save();
          this.display();
        });

      const description = [
        settings.modelCost ? t("set.modelPrice", { price: formatPrice(settings.modelCost) }) : "",
        this.modelList && provider !== "openrouter" ? t("set.noPrices") : "",
        t("set.modelHint"),
      ].filter(Boolean).join(" ");
      new Setting(containerEl)
        .setName(settings.model ? `${t("set.model")}: ${settings.model}` : t("set.model"))
        .setDesc(description)
        .addButton((b) => b.setButtonText(t("set.modelPick")).setCta().onClick(() => this.pickModel(settings, save)))
        .addButton((b) => b.setButtonText(t("set.modelTest")).setDisabled(!translator.ready).onClick(async () => {
          b.setDisabled(true);
          try {
            new Notice(t("notice.modelOk", { model: settings.model, sample: await translator.test() }));
          } catch (error) {
            new Notice(t("notice.modelFailed", { error: error.message }), 12000);
          }
          b.setDisabled(false);
        }));

      this.renderThinking(containerEl, settings, save);

      new Setting(containerEl)
        .setName(t("set.targetLang"))
        .addText((text) => text.setValue(settings.targetLang).onChange(async (value) => {
          settings.targetLang = value.trim() || defaultSettings().targetLang;
          await save();
        }));
      new Setting(containerEl)
        .setName(t("set.translatedFirst"))
        .setDesc(t("set.translatedFirstDesc"))
        .addToggle((toggle) => toggle.setValue(settings.translatedFirst).onChange((value) => this.plugin.setTranslatedFirst(value)));
      new Setting(containerEl)
        .setName(t("set.readmeTranslation"))
        .setDesc(t("set.readmeTranslationDesc"))
        .addDropdown((d) => d.addOption("ask", t("set.readmeTranslationAsk")).addOption("off", t("set.readmeTranslationOff"))
          .setValue(settings.readmeTranslation).onChange(async (value) => {
            settings.readmeTranslation = value;
            await save();
          }));
      new Setting(containerEl)
        .setName(t("set.readmeSaving"))
        .setDesc(t("set.readmeSavingDesc"))
        .addToggle((toggle) => toggle.setValue(settings.readmeSaving).onChange(async (value) => {
          settings.readmeSaving = value;
          await save();
        }));
      new Setting(containerEl)
        .setName(t("set.aiGroups"))
        .setDesc(t("set.aiGroupsDesc"))
        .addToggle((toggle) => toggle.setValue(settings.aiGroups).onChange(async (value) => {
          settings.aiGroups = value;
          await save();
          this.plugin.redraw(true);   // the selection bar's Group with AI
        }));
      // the instructions sent with each translation (folded: rarely changed); the reply format after them stays fixed
      const advanced = containerEl.createEl("details", { cls: "pdt-settings-advanced" });
      advanced.createEl("summary", { text: t("set.advanced") });
      for (const kind of Object.keys(DEFAULT_PROMPTS)) {
        const mine = settings.prompts?.[kind] || "";
        new Setting(advanced)
          .setName(t(`set.prompt.${kind}`))
          .setDesc(t("set.promptDesc"))
          .setClass("pdt-setting-prompt")
          .addTextArea((area) => {
            area.setPlaceholder(DEFAULT_PROMPTS[kind]).setValue(mine || DEFAULT_PROMPTS[kind]).onChange(async (value) => {
              const text = value.trim();
              settings.prompts = { ...settings.prompts, [kind]: text === DEFAULT_PROMPTS[kind] ? "" : text };
              await save();
            });
            area.inputEl.rows = 4;
          })
          .addExtraButton((b) => b.setIcon("rotate-ccw").setTooltip(t("set.promptReset")).setDisabled(!mine).onClick(async () => {
            settings.prompts = { ...settings.prompts, [kind]: "" };
            await save();
            this.display();
          }));
      }
    }

    this.renderUsage(containerEl, save);

    // Delete takes the short descriptions only (cheap to make again); Overview translations are kept
    const saved = plugin.translations.count("description");
    new Setting(containerEl)
      .setName(t("set.saved"))
      .setDesc(t("set.savedDesc", { n: formatCount(saved), o: formatCount(plugin.translations.count("overview")) }))
      .addButton((b) => b.setButtonText(t("set.delete")).setDisabled(!saved).onClick(async () => {
        if (!(await new ConfirmModal(this.app, { title: t("set.deleteAsk", { n: formatCount(saved) }), text: t("set.deleteDesc"), cta: t("set.delete"), footnote: "" }).ask())) return;
        await plugin.translations.clear("description");
        this.display();
      }));
  }

  /**
   * What each model has used so far (requests, tokens, cost) with a total row, so the user can compare models.
   * Cost shows only where the provider reports it (OpenRouter); elsewhere a dash.
   */
  renderUsage(containerEl, save) {
    const rows = Object.values(this.plugin.data.aiUsage || {}).sort((a, b) => b.requests - a.requests);
    new Setting(containerEl)
      .setName(t("set.usage"))
      .setDesc(t("set.usageDesc"))
      .addButton((b) => b.setButtonText(t("set.usageReset")).setDisabled(!rows.length).onClick(async () => {
        const ok = await new ConfirmModal(this.app, { title: t("set.usageResetAsk"), text: t("set.usageResetDesc"), cta: t("set.usageReset"), footnote: "" }).ask();
        if (!ok) return;
        this.plugin.data.aiUsage = {};
        await save();
        this.display();
      }));
    if (rows.length) this.renderUsageTable(containerEl, rows);
    this.renderTodo(containerEl);
  }

  /** Each model's row, then the total. */
  renderUsageTable(containerEl, rows) {
    const sum = (key) => rows.reduce((total, row) => total + (row[key] || 0), 0);
    const priced = rows.some((row) => row.cost != null);
    const total = { model: t("set.usageTotal"), requests: sum("requests"), input: sum("input"), output: sum("output"), cost: priced ? sum("cost") : null };
    const cost = (value) => (value == null ? "—" : formatCost(value));

    const table = containerEl.createEl("table", { cls: "pdt-usage" });
    const head = table.createEl("thead").createEl("tr");
    for (const key of ["model", "requests", "input", "output", "cost"]) head.createEl("th", { text: t(`set.usageCol.${key}`) });
    const body = table.createEl("tbody");
    for (const row of [...rows, total]) {
      const tr = body.createEl("tr", { cls: row === total ? "is-total" : "" });
      tr.createEl("td", { text: row.model, attr: row.provider ? { title: PROVIDERS[row.provider]?.label || row.provider } : {} });
      for (const key of ["requests", "input", "output"]) tr.createEl("td", { text: formatCount(row[key]) });
      tr.createEl("td", { text: cost(row.cost) });
    }
  }

  /**
   * Under the table, in small print: what of the catalog isn't translated yet and what it would take with this model
   * ("Not translated: 9.6K short descriptions ≈ $0.21 · 10.3K Overviews ≥ $0.13 · 235 READMEs ≈ $1.90"). The READMEs
   * are counted from their files, so that part comes a moment later.
   */
  renderTodo(containerEl) {
    const plugin = this.plugin;
    if (!plugin.translator.ready || !plugin.catalog) return;
    const plugins = plugin.catalog.plugins;
    const descriptions = plugin.untranslatedDescriptions(plugins);
    const overviews = plugin.pendingOverviews(plugins).length;
    const known = [
      ["set.todo.desc", { n: descriptions.length, estimate: plugin.estimateDescriptions(descriptions) }],
      ["set.todo.overview", { n: overviews, estimate: plugin.estimateOverviews(overviews) }],
    ];
    const part = ([key, { n, estimate }]) => [t(key, { n: formatCount(n) }), n ? estimateCost(estimate) || t("details.tokens", { n: formatCount(estimate.tokens) }) : null].filter(Boolean).join(" ");
    const line = containerEl.createDiv({ cls: "pdt-usage-todo setting-item-description" });
    const draw = (readme) => line.setText(t("set.todo", { list: [...known.map(part), readme ? part(["set.todo.readme", readme]) : t("set.todo.counting")].join(" · ") }));
    draw(null);
    plugin.untranslatedReadmes().then(draw).catch((error) => console.warn("[Community Radar] untranslated READMEs", error));
  }

  /**
   * Thinking: the model's default or off. Greyed out, with the reason under it, where it can't apply: a provider
   * without the switch (THINKING_NOTES), a model that must think, or one that doesn't think at all.
   */
  renderThinking(containerEl, settings, save) {
    const note = THINKING_NOTES[settings.provider]
      || { mandatory: "set.thinking.mandatory", none: "set.thinking.none" }[settings.modelThinking];
    new Setting(containerEl)
      .setName(t("set.thinking"))
      .setDesc(t(note || "set.thinkingDesc"))
      .addDropdown((d) => d.addOption("default", t("set.thinking.default")).addOption("off", t("set.thinking.off"))
        .setValue(note ? "default" : settings.thinking)
        .setDisabled(Boolean(note))
        .onChange(async (value) => {
          settings.thinking = value;
          await save();
          this.display();   // the estimates and the summary below go by it
        }));
    if (settings.provider !== "openrouter") return;
    new Setting(containerEl)
      .setName(t("set.route"))
      .setDesc(t("set.routeDesc"))
      .addDropdown((d) => {
        for (const sort of ROUTE_SORTS) d.addOption(sort, t(`route.${sort || "balanced"}`));
        d.setValue(settings.routeSort).onChange(async (value) => {
          settings.routeSort = value;
          await save();
        });
      });
  }

  /** Loads the model list once (if it can), then opens the filtering picker; typed names are allowed. */
  async pickModel(settings, save) {
    if (!this.modelList) {
      try {
        this.modelList = await this.plugin.translator.models(settings.provider);
      } catch (error) {
        new Notice(t("notice.modelsFailed", { error: error.message }));
      }
    }
    const model = await this.plugin.pickModel(this.modelList || []);
    if (!model) return;
    Object.assign(settings, { model: model.id, modelCost: model.price || null, modelThinking: model.thinking ?? null });
    await save();
    this.display();
  }
}

