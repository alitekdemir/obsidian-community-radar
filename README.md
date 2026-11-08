# Community Radar

Discover new and updated Obsidian community plugins, find the ones that came back after a long pause, and track the ones you care about as notes.

*[Türkçe](README.tr.md)*

With ~50 new community plugins a day, the built-in browser is hard to keep up with. Community Radar adds a discovery view inside Obsidian with six tabs:

| Tab | Shows |
|---|---|
| **All** | Every community plugin |
| **✨ New** | Plugins added in the last *N* days. A plugin counts as new for 30 days after it's listed (*Settings → New for*). |
| **Updated** | Plugins released in the last *N* days, except new ones. *Hide busy plugins* (on by default) leaves out those with more than 20 releases in 6 months, so the others get seen. |
| **Incubation** | Plugins that **released again after a long pause** (an incubation of at least 60 days; presets 30–360). Each stays as long as its incubation was (at most 360 days), so a plugin quiet for 88 days is still here 50 days later — not buried under daily releasers. |
| **Tracked** | Plugins you track, in sections per group (a plugin in two groups shows in both); one Group menu for All, New releases, Starred, Ungrouped and your groups |
| **Suggestions** | Installed plugins you haven't starred yet |

![The All tab: every community plugin with downloads, last update, dormant period and README / GitHub links](docs/images/Radar_1-All.png)

Clicking a plugin's name opens its page in Obsidian's own plugin browser, where you install it — Community Radar is for discovering and tracking, not installing. **README** on a row opens the plugin's README inside Obsidian, in its tracking note.

Plugins you **star** or **add to a group** become small notes in your vault, with the plugin's README inside. Use [Bases](https://help.obsidian.md/bases) to browse and edit them as a table. Plugins you **ignore** never show up again; **hide until the next release** brings a plugin back by itself when it ships one. Both lists open from the view's ⋮ menu, with search and *Restore*.

![The Revived tab: plugins released in the last 14 days after at least 90 days dormant, longest pause first](docs/images/Radar_3-Revived.png)

![The Tracked tab: your plugins in coloured sections per group, sorted by rating](docs/images/Radar_9-Tracked.png)

## Features

- **Filters on every tab**: *Downloads ≥* is a chip you switch on and off per tab, day ranges can be typed (e.g. last 1 day) or picked, and rows sort by downloads, last update, A–Z or recently added, in either direction.
- **Search** with comma-separated terms (all must match) or a `/regular expression/`, as in Obsidian's own search — e.g. `/project.+task/`.
- **Revived detection** from the official release archive — exact, no guessing (see [How it works](#how-it-works)).
- **Scheduled sync** every 6 hours, daily, weekly or manually. The view shows when the last sync ran and what it brought (*Since last sync: 5 new · 23 updated*).
- **Groups**: a plugin can be in several groups (a `groups` list). The group window stars the closest of your groups and adds AI suggestions you switch on and off; **Suggest groups for this list** (⋮ menu) puts AI suggestions under every row of the list you're looking at — up to 50, one request — in English and your language (*AI* next to *Yapay Zekâ*); pick on the rows and nothing is saved until **Accept**.
- **Similar plugins by meaning**: *Similar →* on a row filters the list to the closest plugins, shown as one chip in the bar (`‹ · ≈ Similar: Periodic Notes · ✕`). The All tab stays, as *All similar N*, with the same bar (*Downloads ≥* applies); rows stay rows, with every action and List / Cards, in pages of 50 (up to 300, closest first); each says how close it is (*very close*, *close*, *related*) and which terms it shares. Sort by closeness (or downloads, last update, A–Z, newest, rating) and search within the results. *Similar →* on a result goes one step further and `‹` comes back; `✕` or `Esc` returns to the tab, filters and scroll you had, with the row you started from lit up. Also from the details window (*All (30) →*) and the command *Show plugins similar to this note's plugin*. The meaning comes from vectors built daily with an open model in this repository's GitHub Actions; your device only downloads them (~2.5 MB) and compares — no AI request, no key. Until they're in, matching uses shared words.

  ![The Similar list: a trail back to the tab you came from, the number of matches, closeness and shared terms on every result](docs/images/Radar_7-Similar.png)

- **Filters** lead the bar: **Filters · N** counts the ones you changed from the tab's defaults (the search included) and its ✕ puts them back; the tab's filters sit next to it (*Last N days*, *Downloads ≥*, *Incubation ≥*, *Hide busy plugins*) and fold under it in a narrow panel. They're remembered; the search isn't.
- **Cards**: a *List / Cards* switch shows any tab as cards. Click a row or card anywhere but a control (or press `Enter`) and it grows into a **details window**: downloads, latest release, age (since it was listed) and how often it ships; the whole description and its translation; your note; the README in a dark box; the five closest plugins; the release history and the GitHub repository; and the same actions as a row. `←` / `→` walk the list; *Hide* and *Exclude* move on to the next plugin.

  ![The card view](docs/images/Radar_10-Cards.png)

  ![The details window of a plugin](docs/images/Radar_11-Details.png)

- **README in your language**, on request: the details window has a *README · <language>* tab that translates it with your AI provider (showing the size, and the cost when the model's price is known) and keeps the translation in the tracking note above the original. It's marked *older* when a new release changes the README.

- **Rating**: hover the ☆ on a row to give 1–5 stars (`rating`). The Tracked tab sorts by rating, so your favourites lead every group.
- **New releases** of tracked plugins: a yellow count on the Tracked tab, a *NEW RELEASE* signal on the row and a *New releases* entry in its Group menu, with *Mark all reviewed*.
- **Status** (optional, off by default): your own list of statuses, emoji included — e.g. 🔖 To try, 👀 Watching, 🧪 Testing, ✅ Adopted, 🔁 Replaced — edited in settings and stored as `status`.
- Rows are easy to scan: the name with the date and downloads on the same line (downloads line up down the list), signals and your note (groups, status, rating) under it, the description, then links on the left and actions on the right. A row that an action moves out of the current filter stays (faded) until you reopen the view.
- **Sort by incubation** to see which plugins were quiet the longest.
- **Keyboard** (off by default; *Settings → Keyboard shortcuts*): while the tab is active, `j`/`k` move the highlight and `f` star, `g` groups, `x` ignore, `h` hide until next release, `t` translate, `r` README, `s` similar, `o` open, `Enter` details, `1`–`5` rate, `0` clear the rating. The ⌨ icon in the filter bar lists them.
- **Tracking notes**: `groups`, `favorite`, `note` and `reviewed` properties you can edit anywhere, plus `description`, `downloads`, `version` and `updated` kept up to date.
- **README in the note**, refreshed when a new version ships — when you open the note, on every sync, or only on demand. Your own notes in the note are never touched.
- **Translate descriptions** with your own API key — Claude, OpenAI, Gemini or OpenRouter. One request translates a whole page; translations are cached.

  ![A translated description under the original](docs/images/Radar_2-One_Translate.png)

- **Signals** for NEW, NEW RELEASE and INSTALLED plugins, and *4 days ago (after a 70-day incubation)* when the pause before the latest release was long.
- **English and Turkish** interface, following Obsidian's language or chosen in settings. [Add your language](#translating).
- Works on desktop and mobile.

## Installation

In Obsidian, open **Settings → Community plugins → Browse**, search for **Community Radar**, install and enable it.

**With BRAT** (pre-releases): install [BRAT](https://github.com/TfTHacker/obsidian42-brat), run *BRAT: Add a beta plugin*, enter `alitekdemir/obsidian-community-radar`.

**Manually:** download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/alitekdemir/obsidian-community-radar/releases/latest) into `<your vault>/.obsidian/plugins/plugin-radar/` (the folder name is the plugin id), then enable **Community Radar** in *Settings → Community plugins*.

## Getting started

1. Run **Community Radar: Open Community Radar** (or click the radar icon in the ribbon). The catalog downloads on first open.
2. Click **Build release history** once. It downloads about a year of daily snapshots (~50 MB, a few minutes) and is needed for the *Incubation* and *New* tabs. Later syncs only fetch the days you missed.
3. Star (☆), group (＋) or ignore (⊘) plugins from any row.
4. Optional: *Settings → Community Radar → Bases view → Create* adds a ready-made [Bases](https://help.obsidian.md/bases) table of your tracked plugins next to the notes folder (e.g. `Community Radar.base`). If you break it, **Reset** rewrites it from the template.

## Settings

![Translation settings: provider, API key from Obsidian's keychain, model with price, target language](docs/images/Radar_6-AI_Settings.png)

| Setting | Options |
|---|---|
| Language | Auto (Obsidian's language), English, Türkçe |
| Notes folder | Where tracking notes are created (default: *Community Radar*) |
| Heading of your notes | The heading above your own notes in new tracking notes (default: *My notes* in the interface language) |
| README translation | On request (details window, command) or off |
| Suggest groups | Opens the Tracked tab's *Ungrouped* list in grouping mode |
| Keyboard shortcuts | Off by default |
| Status field | Off by default; add, rename (emoji welcome), reorder or remove statuses |
| Lists | *Manage* opens the ignored plugins or hidden suggestions in the view |
| Bases view | **Create** or **Reset** the Bases table of your tracking notes |
| Sync frequency | Manual · Every 6 hours · **Daily** · Weekly. Between syncs nothing is downloaded. **Sync now** runs one immediately. |
| README updates | **When I open the note** · On every sync · Manually (command palette) |
| History depth | 3, 6, 12 or 24 months |
| AI | Provider, API key (from Obsidian's keychain), model, target language — used for translations and group suggestions |

## Tracking notes

```yaml
---
plugin_id: homepage
groups:
  - startup
  - navigation
favorite: true
status: adopted           # optional; one of your statuses (Settings → Status field)
rating: 4                 # 1–5
note: try with the daily note
reviewed: 2026-10-31      # a release after this date marks the plugin NEW RELEASE
downloads: 1416257
version: 4.6.0
updated: 2026-10-25
obsidian: "[plugin](obsidian://show-plugin?id=homepage)"
github: "[github](https://github.com/mirnovov/obsidian-homepage)"
---
```

The body has a **My notes** section for you, a **README (your language)** section when you've asked for a translation, and a **README** section that the plugin owns, between two hidden `%% community-radar:readme-start/end %%` comments. README tags (`#tag`) and wiki links are escaped so they don't leak into your vault; code blocks are left as they are.

![A tracking note: properties, My notes and the plugin's README](docs/images/Radar_4-Note.png)

![Tracked plugins in a Bases table, editable in place](docs/images/Radar_5-Bases_Note.png)

## How it works

Obsidian's [`obsidian-releases`](https://github.com/obsidianmd/obsidian-releases) repository commits `community-plugin-stats.json` **every day**. Each snapshot holds every plugin's latest release time. Community Radar reads these snapshots (daily for the last 30 days, weekly before that), keeps up to 50 release dates per plugin, and compares the current release with the previous one. That's how "4 days ago (after a 70-day incubation)" is exact even for plugins quiet for years. The same snapshots tell when a plugin first appeared, which powers the *New* tab.

*Similar* compares meanings: once a day, a [GitHub Actions workflow](.github/workflows/embeddings.yml) turns every plugin's name and description into a vector with IBM's open [granite-embedding-311m-multilingual-r2](https://huggingface.co/ibm-granite/granite-embedding-311m-multilingual-r2) model (only new or edited plugins; Apache 2.0) and publishes them on the `embeddings` branch. The plugin downloads that file and ranks plugins by cosine similarity on your device, with a small share of shared-word matching (BM25) so a rare common name still counts.

## Network use

Community Radar only makes these requests:

| Destination | When | What |
|---|---|---|
| `raw.githubusercontent.com` | Sync, history build, README updates | The public plugin list, stats snapshots and plugin READMEs |
| `api.github.com` | History build and sync (1–4 requests); README fallback | The list of stats snapshots. Unauthenticated, 60 requests/hour |
| `raw.githubusercontent.com/alitekdemir/obsidian-community-radar/embeddings/` | Sync, when a newer build is out | The semantic vectors for Similar (~2.5 MB, built daily by [this workflow](.github/workflows/embeddings.yml)) |
| Your AI provider (`api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com` or `openrouter.ai`) | **Only** when you translate or ask for group suggestions, with a provider configured | Plugin names and descriptions, the names of your groups, and a README you ask to translate |

No telemetry, no account, nothing about your vault is sent anywhere. Inside the vault, the plugin only reads and writes notes in its own notes folder; it never lists the rest of your files. API keys are stored in Obsidian's keychain (SecretStorage) on each device, never in `data.json`; the plugin stores only the key's name (e.g. `anthropic-api-key`), so other plugins using the same name share it. The installed-plugins list comes from Obsidian's internal `app.plugins` and is read defensively.

## Data

| Data | Where |
|---|---|
| Your groups, stars, notes, review dates | Your tracking notes |
| Ignored plugins, translations, settings | `.obsidian/plugins/plugin-radar/data.json` |
| Catalog, release history and semantic vectors (rebuildable caches) | `.obsidian/plugins/plugin-radar/cache/` |

## Commands

- Open Community Radar
- Sync now (catalog, history, notes)
- Rebuild release history
- Update README of this note / of all tracking notes
- Create or reset the Bases view
- Suggest groups for ungrouped plugins
- Translate the README of this note

The view's ⋮ menu has: Sync now, Translate visible, Suggest groups for this list, Ignored plugins, Hidden suggestions, Rebuild history and Settings.

## Translating

All interface text lives in [`locales/`](locales), one JSON file per language. To add yours:

1. Copy `locales/en.json` to `locales/<code>.json` — the code Obsidian uses for your language, e.g. `de`, `fr`, `pt-BR`.
2. Set `language.name` (your language's own name, e.g. `Deutsch`) and `locale` (for number and date formats, e.g. `de-DE`), then translate the values. Keep `{placeholders}` exactly as they are.
3. Plural text is an object picked by the number `{n}`: `{"one": "{n} day ago", "other": "{n} days ago"}`. Use your language's [plural forms](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html) (`one`, `few`, `many`, `other`…); `other` is required. A language without plural forms can use a plain string.
4. Run `npm install && npm test` — it checks that your file has every key and placeholder — and open a pull request.

Missing text falls back to English, so a partly translated file still works. The new language appears in *Settings → Language* automatically.

## Development

`src/*.js` is the plugin (joined in file-name order); `npm run build` embeds `locales/*.json` into the `main.js` Obsidian loads (Obsidian installs only `main.js`, `manifest.json` and `styles.css`). There are no dependencies at runtime. Tests run offline in Node with a small fake of the Obsidian API:

```sh
npm install
npm test        # builds main.js first
```

To try changes in a vault, run `npm run build` and copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/plugin-radar/`.

To release, bump the version in `manifest.json`, `package.json` and `versions.json`, update `CHANGELOG.md`, then publish a GitHub release whose tag is that version (e.g. `0.6.0`, no `v`). Don't attach files: the release workflow tests, builds and attests `main.js`, `manifest.json` and `styles.css` and attaches them.

## License

[MIT](LICENSE) © Ali Tekdemir
