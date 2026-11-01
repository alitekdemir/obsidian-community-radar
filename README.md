# Plugin Radar

Discover new and updated Obsidian community plugins, find the ones that came back after a long pause, and track the ones you care about as notes.

*[Türkçe](README.tr.md)*

With ~50 new community plugins a day, the built-in browser is hard to keep up with. Plugin Radar adds a discovery view inside Obsidian with six tabs:

| Tab | Shows |
|---|---|
| **All** | Every community plugin, sorted by downloads, last update, name or newest listed |
| **✨ New** | Plugins listed in the last *N* days |
| **Updated** | Plugins released in the last *N* days |
| **Awakened** | Plugins released in the last *N* days **after a long pause** (e.g. no release for 90+ days before). Constantly updated plugins are filtered out. |
| **🔄 Changed** | Plugins you track that shipped a release since you last reviewed them |
| **Suggestions** | Installed plugins you haven't starred yet |

Clicking a plugin's name opens its page in Obsidian's own plugin browser, where you install it — Plugin Radar is for discovering and tracking, not installing.

Plugins you **star** or **add to a group** become small notes in your vault, with the plugin's README inside. Use [Bases](https://help.obsidian.md/bases) to browse and edit them as a table. Plugins you **exclude** never show up again.

## Features

- **Awakened detection** from the official release archive — exact, no guessing (see [How it works](#how-it-works)).
- **Tracking notes**: `group`, `favorite`, `note` and `reviewed` properties you can edit anywhere, plus `downloads`, `version` and `updated` kept up to date.
- **README in the note**, refreshed automatically when a new version ships. Your own notes in the note are never touched.
- **Translate descriptions** with your own API key — Claude, OpenAI, Gemini or OpenRouter. One request translates a whole page; translations are cached.
- **Badges** for new (✨), changed (🔄) and installed plugins; relative dates and release gaps on every row.
- English and Turkish interface (follows Obsidian's language).
- Works on desktop and mobile. No build step: plain JavaScript.

## Installation

Until Plugin Radar is in the community plugin directory:

**With BRAT:** install [BRAT](https://github.com/TfTHacker/obsidian42-brat), run *BRAT: Add a beta plugin*, enter `alitekdemir/plugin-radar`.

**Manually:** download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/alitekdemir/plugin-radar/releases/latest) into `<your vault>/.obsidian/plugins/plugin-radar/`, then enable **Plugin Radar** in *Settings → Community plugins*.

## Getting started

1. Run **Plugin Radar: Open plugin discovery** (or click the radar icon in the ribbon). The catalog downloads on first open.
2. Click **Build release history** once. It downloads about a year of daily snapshots (~50 MB, a few minutes) and is needed for the *Awakened* and *New* tabs. Later refreshes only fetch the days you missed.
3. Star (☆), group (＋) or exclude (⊘) plugins from any row.
4. Optional: copy [`docs/plugin-radar-bases.md`](docs/plugin-radar-bases.md) into your vault for a ready-made Bases table of your tracked plugins.

## Tracking notes

```yaml
---
plugin_id: homepage
group: startup
favorite: true
note: try with the daily note
reviewed: 2026-10-31      # a release after this date marks the plugin as 🔄 changed
downloads: 1416257
version: 4.6.0
updated: 2026-10-25
obsidian: "[plugin](obsidian://show-plugin?id=homepage)"
github: "[github](https://github.com/mirnovov/obsidian-homepage)"
---
```

The body has a **My notes** section for you and a **README** section that the plugin owns. README tags (`#tag`) and wiki links are escaped so they don't leak into your vault; code blocks are left as they are.

## How it works

Obsidian's [`obsidian-releases`](https://github.com/obsidianmd/obsidian-releases) repository commits `community-plugin-stats.json` **every day**. Each snapshot holds every plugin's latest release time. Plugin Radar reads these snapshots (daily for the last 30 days, weekly before that), keeps up to 50 release dates per plugin, and compares the current release with the previous one. That's how "released 7 days ago, after 52 days" is exact even for plugins quiet for years. The same snapshots tell when a plugin first appeared, which powers the *New* tab.

## Network use

Plugin Radar only makes these requests:

| Destination | When | What |
|---|---|---|
| `raw.githubusercontent.com` | Refresh, history build, new tracking note | The public plugin list, stats snapshots and plugin READMEs |
| `api.github.com` | History build/refresh (1–4 requests); README fallback | The list of stats snapshots. Unauthenticated, 60 requests/hour |
| Your AI provider (`api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com` or `openrouter.ai`) | **Only** when you click *Translate* and have configured a provider | The plugin descriptions to translate |

No telemetry, no account, nothing about your vault is sent anywhere. API keys are stored in Obsidian's keychain (SecretStorage) on each device, never in `data.json`; the plugin stores only the key's name (e.g. `anthropic-api-key`), so other plugins using the same name share it. The installed-plugins list comes from Obsidian's internal `app.plugins` and is read defensively.

## Data

| Data | Where |
|---|---|
| Your groups, stars, notes, review dates | Your tracking notes |
| Excluded plugins, translations, settings | `.obsidian/plugins/plugin-radar/data.json` |
| Catalog and release history (rebuildable caches) | `.obsidian/plugins/plugin-radar/cache/` |

## Commands

- Open plugin discovery
- Refresh data (catalog, history, notes)
- Rebuild release history
- Update README of this note / of all tracking notes
- Import from the Colab notebook (`tracker.json`) — for users of the original notebook this plugin grew out of

## Development

No build step: `main.js` is the plugin. Tests run offline in Node with a small fake of the Obsidian API:

```sh
npm install
npm test
```

To release, bump the version in `manifest.json`, `package.json` and `versions.json`, update `CHANGELOG.md`, then push a tag with the same version (e.g. `0.4.0`). The release workflow runs the tests and attaches `main.js`, `manifest.json` and `styles.css`.

## License

[MIT](LICENSE) © Ali Tekdemir
