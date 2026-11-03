# Changelog

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
