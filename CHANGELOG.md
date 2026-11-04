# Changelog

## 0.7.2

- **Grouping mode inside the view** replaces the batch window: *Suggest groups for this list* (⋮ menu) puts AI suggestions under each row of the current list (up to 50, one request). A sticky bar shows what will change (new notes, new groups) with *Top suggestion for all*, *Reset*, *Cancel* and *Accept*; changed rows are marked. *Settings → Suggest groups* opens the Tracked tab's *Ungrouped* list in this mode.
- Group suggestions come in your language **and** the widely used English or technical term (e.g. *Yapay Zekâ* and *AI*, *Alışkanlık Takibi* and *Habit Tracker*); a name matching one of your groups keeps your spelling.
- **Keyboard shortcuts** work as soon as the tab is active (Obsidian's own key scope) and move a visible highlight; they're **off by default** (*Settings → Keyboard shortcuts*). A ⌨ icon in the filter bar shows them in a readable card on hover or focus.
- The **Sync** button and **Translate visible** moved into the ⋮ menu; *Bases view* and *Keyboard shortcuts* left it (Bases stays in settings).

## 0.7.1

- **Tracked tab**: the plugins you track, with group chips (each group, *Ungrouped*) and **sections per group** — coloured, foldable headings, the rows indented under them; a plugin in two groups shows in both. Filters for ★ starred and status. A group badge on any row opens the tab on that group.
- **Status and rating** for tracked plugins (`status`: candidate · trying · using · dropped; `rating`: 1–5), set from chips on the row. Values that aren't valid are ignored and left untouched in the note.
- **Hide until the next release**: a row action that hides a plugin until it ships a newer release.
- **Ignored plugins** and **Hidden suggestions** moved from the settings page into the view: open them from the new ⋮ menu items or *Settings → Lists → Manage*, with search, sorting, *Restore* per row and *Restore all shown* (asks for a second click).
- **⋮ menu** of the view: Sync now, the two lists, Suggest groups, Bases view, Rebuild history, Keyboard shortcuts, Settings.
- **Sort by dormant period** (longest first), on every tab.
- **Keyboard** on a focused row: `j`/`k`, `f`, `g`, `x`, `h`, `t`, `r`, `s`, `o`, `Enter`.
- The Bases template's views are *All*, *Starred* and *Ungrouped* — Bases groups a list property as one value, so a "By group" view can't show a plugin under each of its groups; the Tracked tab does that. Press *Reset* under *Bases view* to update yours.
- Issue templates for bug reports, feature requests and translations.

## 0.7.0

- **Several groups per plugin.** Tracking notes now have a `groups` list instead of the `group` text; existing values move over once on first run (the old property is removed).
- **New group window**: chips you switch on and off — the selected groups, your groups with their size (the closest one starred and preselected), up to 10 AI suggestions (5 shown, the rest under *+n more*) and a box for a new name. **Confirm** saves; closing changes nothing. A saved translation of the description is shown under it.
- **Suggest groups** (settings and command): AI suggests groups for every tracked plugin without one, 50 plugins per request (names and short descriptions only). You review the list — several picks per plugin, stacked under the description on narrow screens — and nothing is saved before **Accept**. Suggestions are cached until a description changes.
- **Similar plugins**: a *Similar* link on every row opens up to 8 plugins with the most shared rare words in their names and descriptions, most downloaded first. Local only.
- The Bases template uses `groups`; press *Reset* under *Bases view* to update an existing one.
- The AI settings section is now called **AI (translation, group suggestions)**.

## 0.6.2

- **Downloads ≥** is a filter chip you switch on and off, on every tab, remembered per tab (on by default for All, Updated and Revived). Typing a number turns it on. Plugins under the threshold — new ones especially — are one click away.
- **Last N days** and **Dormant ≥** take a typed number (1–365 days, e.g. the last 1 day) or a preset from the menu.
- **Sort** on every tab by downloads, last update, **A–Z** or recently added, with a direction button; each tab keeps its own sort.
- **Regex search**: `/…/` searches the id, name, author and description case-insensitively (as in Obsidian's search). An invalid pattern is marked in red and leaves the list unfiltered.

## 0.6.1

- README markers in tracking notes are hidden Obsidian comments (`%% … %%`) instead of HTML comments, so they no longer show in Live Preview. Existing notes are converted once.
- **Bases view** in settings (and a command): creates a Bases table of your tracking notes next to the notes folder, or resets a broken one to the template.

## 0.6.0

- **Language setting**: Auto (follows Obsidian), English or Türkçe; switches right away. Interface text moved to `locales/*.json` so anyone can add a language (see *Translating* in the README).
- **Sync frequency**: Manual, every 6 hours, daily (default) or weekly; scheduled syncs run quietly in the background. **Sync now** in the view, in settings and in the command palette.
- The status line shows the last sync time, what it brought (*Since last sync: 5 new · 23 updated*) and live progress while syncing.
- **README updates**: when you open the note (default), on every sync, or manually.
- **README** link on every row opens the plugin's README inside Obsidian, in its tracking note (created when needed). It replaces the author name.
- Clearer English: *Revived*, *Needs review*, *Dormant ≥*, *Ignore*, *Hidden suggestions*, *added*.
- Source moved to `src/main.js`; `npm run build` produces `main.js`.

## 0.5.3

- Plugin id is back to `plugin-radar`: the directory keeps the id of the original submission. Data from a 0.5.2 (`community-radar`) install is copied once on first run; remove that folder afterwards.
- `package.json` has a no-op `build` script so the directory can verify the build (there is no build step).

## 0.5.2

- Plugin id changed to `community-radar` so the id, name (**Community Radar**) and repository (`obsidian-community-radar`) match. On first run, settings, excluded plugins, translations and caches are copied once from an earlier `plugin-radar` install; notes and API keys are untouched. Remove the old plugin afterwards.

## 0.5.1

- Renamed to **Community Radar** (the directory doesn't allow "Plugin" in names). The plugin id stays `plugin-radar`, so installs and settings carry over. Repository: `alitekdemir/obsidian-community-radar`.
- Tracking notes are read from the notes folder only; the plugin no longer lists the whole vault.
- Removed the one-off import from the Colab notebook.
- Release assets are attached and attested by a GitHub workflow.
- Tests use `yaml` instead of `js-yaml`; `package-lock.json` added.

## 0.5.0

- **All** tab: browse every community plugin, sorted by downloads, last update, name or newest listed, with a minimum-downloads filter and search. Tracked plugins stay visible here with their note badge; excluded ones stay hidden.
- Sort options that only exist in **All** (name, newest listed) fall back to downloads in the other tabs, and the sort chip always shows the sort actually in use.

## 0.4.0

- Renamed from the private "Eklenti Takip" to **Plugin Radar** (`plugin-radar`). Settings, excluded plugins, translations and caches from the earlier version are imported automatically on first run.
- English and Turkish interface, following Obsidian's language.
- Radar ribbon and tab icon.
- Model picker that filters as you type, shows OpenRouter prices, has a “latest only” toggle and accepts names that aren't listed (e.g. `~google/gemini-flash-latest`). “Test model” button.
- API keys picked from Obsidian's keychain with shared, conventional names (`anthropic-api-key`, `openai-api-key`, `gemini-api-key`, `openrouter-api-key`).

## 0.3.0

- Filter menus use Obsidian's own menu; row actions use Obsidian's icon buttons; tab tooltips.
- Gap highlight only in the Awakened tab; a saved search is shown in the status line with a clear button.

## 0.2.0

- Redesigned discovery view (segmented tabs with counts, meta line, badges, expandable descriptions).
- ✨ New tab based on first-seen dates from the release archive; 🔄 Changed badge.
- Description translation (Claude, OpenAI, Gemini, OpenRouter) with batching and caching.
- Release history depth: 3, 6, 12 or 24 months.

## 0.1.0

- Discovery view with New, Updated, Awakened, Changed and Suggestions modes.
- Tracking notes with README; Bases-friendly properties; exclusion list.
