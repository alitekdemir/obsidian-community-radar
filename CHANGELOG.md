# Changelog

## 0.7.3

Changes since 0.6.2 (0.7.0–0.7.2 were not released).

### New

- **Groups**: a plugin can be in several groups (a `groups` list). The group window shows your groups with their size, stars and preselects the closest one, adds up to 10 AI suggestions (5 shown, the rest under *+n more*) and a box for a new name; **Confirm** saves, closing changes nothing. A saved translation of the description is shown under it.
- **Grouping mode**: *Suggest groups for this list* (⋮ menu) puts AI suggestions under every row of the current list (up to 50, one request; names and short descriptions only). A sticky bar shows what will change, with *Top suggestion for all*, *Reset*, *Cancel* and *Accept*; nothing is saved before **Accept**. *Settings → Suggest groups* opens the Tracked tab's *Ungrouped* list in this mode. Suggestions come in your language **and** the widely used English term (*Yapay Zekâ* and *AI*), are cached until a description changes, and a name matching one of your groups keeps your spelling.
- **Tracked tab**: your plugins in coloured, foldable sections per group; a plugin in two groups shows in both. One *Group* menu: All, New releases, Starred, Ungrouped, then your groups. A group pill on any row opens the tab on that group.
- **New releases** of tracked plugins: a yellow count on the Tracked tab, a *NEW RELEASE* signal and a *Reviewed* action on the row, *Mark all reviewed* in the Group menu.
- **Rating**: hover (or focus) the ☆ on a row to give 1–5 stars (`rating`). The Tracked tab sorts by rating by default (ties A–Z).
- **Status** (optional, off by default; *Settings → Status field*): your own list — rename with an emoji, reorder, add, remove. Defaults: 🔖 To try, 👀 Watching, 🧪 Testing, ✅ Adopted, 🔁 Replaced.
- **Similar plugins**: a *Similar* link on every row shows up to 8 plugins sharing the most rare words in name and description, found locally.
- **Hide until the next release**: the plugin comes back by itself when it ships one.
- **Ignored plugins** and **Hidden suggestions** open in the view (⋮ menu or *Settings → Lists → Manage*) with search, sorting, *Restore* and *Restore all shown*.
- **Keyboard shortcuts** (off by default; *Settings → Keyboard shortcuts*): work as soon as the tab is active and move a visible highlight; the ⌨ icon in the filter bar lists them.
- **Sort by dormant period** and **by rating**.
- Issue templates for bug reports, feature requests and translations.

### Changed

- **Rows in four layers**: system signals next to the name, your note (note, groups, status, rating) on its own line, a metrics column with **downloads first**, then links (README · GitHub · Similar · Translate).
- **Rows stay put**: a row that an action moves out of the filter stays, faded, until the view is reopened or a filter changes.
- The *Needs review* tab is gone; new releases live in the Tracked tab.
- The **New** tab never applies the *Downloads ≥* filter.
- **Sync now** and **Translate visible** moved into the ⋮ menu; *Bases view* is only in settings.
- The AI settings section is now **AI (translation, group suggestions)**.

### Upgrade notes

- `group` becomes the `groups` list on first run; the old property is removed.
- Old status values move over once: candidate → to-try, trying → testing, using → adopted, dropped → replaced.
- The Bases template's views are now *All*, *Starred* and *Ungrouped* (Bases treats a list as one value, so per-group sections live in the Tracked tab). Press *Settings → Bases view → Reset* to update yours.

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
