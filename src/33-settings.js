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

    new Setting(containerEl)
      .setName(t("set.readmeTranslation"))
      .setDesc(t("set.readmeTranslationDesc"))
      .addDropdown((d) => d.addOption("ask", t("set.readmeTranslationAsk")).addOption("off", t("set.readmeTranslationOff"))
        .setValue(settings.readmeTranslation).onChange(async (value) => {
          settings.readmeTranslation = value;
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

    new Setting(containerEl)
      .setName(t("set.keyboard"))
      .setDesc(t("set.keyboardDesc"))
      .addToggle((toggle) => toggle.setValue(Boolean(settings.keyboard)).onChange(async (value) => {
        settings.keyboard = value;
        await save();
        plugin.redraw(true);
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

    this.displayStatuses(containerEl, settings, save);

    // ── Sync
    new Setting(containerEl).setName(t("set.sync")).setHeading();
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

    // ── Release history
    new Setting(containerEl).setName(t("set.history")).setHeading();
    const { timeline } = plugin;
    new Setting(containerEl)
      .setName(t("set.historySource"))
      .setDesc(timeline.to ? t("set.historyDesc", { from: dayString(timeline.from), to: dayString(timeline.to) }) : t("set.notBuilt"))
      .addButton((b) => b.setButtonText(t("set.rebuild")).onClick(async () => {
        await plugin.downloadHistory();
        this.display();
      }));

    this.displayTranslation(containerEl, settings, save);

    // ── Lists: managed in the view, with search and Restore (a settings list can't cope with thousands)
    this.displayPageQueries(containerEl, settings, save);

    new Setting(containerEl).setName(t("set.lists")).setHeading();
    new Setting(containerEl)
      .setName(t("set.excluded", { n: formatCount(plugin.ignoredCount()) }))
      .setDesc(t("set.listsDesc"))
      .addButton((b) => b.setButtonText(t("set.manage")).onClick(() => plugin.showList("ignored")));
    new Setting(containerEl)
      .setName(t("set.dismissed", { n: formatCount(Object.keys(plugin.data.dismissed).length) }))
      .addButton((b) => b.setButtonText(t("set.manage")).onClick(() => plugin.showList("dismissed")));

    if (plugin.manifest.fundingUrl) {
      new Setting(containerEl)
        .setName(t("set.support"))
        .setDesc(t("set.supportDesc"))
        .addButton((b) => b.setButtonText(t("set.sponsor")).onClick(() => window.open(plugin.manifest.fundingUrl)));
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

  displayTranslation(containerEl, settings, save) {
    const plugin = this.plugin;
    const translator = plugin.translator;
    new Setting(containerEl).setName(t("set.translation")).setHeading();
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
          Object.assign(settings, { provider: value, model: "", modelPrice: "" });
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
        settings.modelPrice ? t("set.modelPrice", { price: settings.modelPrice }) : "",
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

      new Setting(containerEl)
        .setName(t("set.targetLang"))
        .addText((text) => text.setValue(settings.targetLang).onChange(async (value) => {
          settings.targetLang = value.trim() || defaultSettings().targetLang;
          await save();
        }));
      // the instructions sent with each translation; the reply format is added after them and stays fixed
      for (const kind of Object.keys(DEFAULT_PROMPTS)) {
        const mine = settings.prompts?.[kind] || "";
        new Setting(containerEl)
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

    const saved = Object.keys(plugin.data.translations).length;
    new Setting(containerEl)
      .setName(t("set.saved"))
      .setDesc(t("set.savedDesc", { n: formatCount(saved) }))
      .addButton((b) => b.setButtonText(t("set.delete")).setDisabled(!saved).onClick(async () => {
        plugin.data.translations = {};
        await save();
        this.display();
      }));
  }

  /**
   * Page queries: what each page shows, as a query. Yours replace the default (a changed one has a yellow edge);
   * ↺ puts one back, the button below all of them. A query that doesn't parse isn't saved (red edge, the reason).
   */
  displayPageQueries(containerEl, settings, save) {
    new Setting(containerEl).setName(t("set.pageQueries")).setDesc(t("set.pageQueriesDesc")).setHeading();
    for (const mode of [...MODE_KEYS, ...LIST_MODES]) {
      const mine = settings.pageQueries?.[mode];
      const setting = new Setting(containerEl).setName(t(`mode.${mode}`)).setClass("pdt-setting-query");
      setting.addTextArea((area) => {
        area.setValue(pageQuery(settings, mode)).onChange(async (value) => {
          const { error } = compileQuery(value, null, Date.now(), true);
          area.inputEl.toggleClass("is-invalid", Boolean(error));
          setting.setDesc(error || "");
          if (error) return;
          const { [mode]: old, ...rest } = settings.pageQueries || {};
          const same = value.replace(/\s+/g, " ").trim() === defaultPageQuery(mode).replace(/\s+/g, " ").trim();
          settings.pageQueries = same ? rest : { ...rest, [mode]: value };
          area.inputEl.toggleClass("is-changed", !same);
          await save();
          this.plugin.redraw();
        });
        area.inputEl.rows = 2;
        area.inputEl.spellcheck = false;
        area.inputEl.toggleClass("is-changed", mine != null);
      });
      setting.addExtraButton((b) => b.setIcon("rotate-ccw").setTooltip(t("set.pageQueryReset")).setDisabled(mine == null).onClick(async () => {
        const { [mode]: old, ...rest } = settings.pageQueries || {};
        settings.pageQueries = rest;
        await save();
        this.plugin.redraw();
        this.display();
      }));
    }
    new Setting(containerEl).addButton((b) => b.setButtonText(t("set.pageQueriesReset")).setDisabled(!Object.keys(settings.pageQueries || {}).length).onClick(async () => {
      settings.pageQueries = {};
      await save();
      this.plugin.redraw();
      this.display();
    }));
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
    const modal = new ModelModal(this.app, this.modelList || []);
    modal.open();
    const model = await modal.result;
    if (!model) return;
    Object.assign(settings, { model: model.id, modelPrice: formatPrice(model.price), modelCost: model.price || null });
    await save();
    this.display();
  }
}

