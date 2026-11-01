# Changelog

## 0.5.0 — first public release

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
