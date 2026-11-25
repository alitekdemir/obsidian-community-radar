# How it works

*English · [Türkçe](how-it-works.tr.md)*

## Where the data comes from

Obsidian's [`obsidian-releases`](https://github.com/obsidianmd/obsidian-releases) repository commits `community-plugin-stats.json` **every day**, back to October 2020. Each snapshot holds every plugin's downloads and latest release time.

Once a day, a [GitHub Actions workflow](../.github/workflows/metrics.yml) replays all of those snapshots and publishes the result on this repository's `metrics` branch: up to 50 release dates per plugin, the day it first appeared, its downloads over the last year (day by day for the last month, week by week before it), when it passed 1K, 5K, 10K, 25K, 50K and 100K downloads, and the plugins Obsidian took off its list (when, and why). Community Radar downloads that file (~600 KB compressed, ~1 MB uncompressed) once; after that, a sync downloads only the last week of changes (`delta.json`, about 150 KB) and adds it to its copy. A copy more than a week old gets the whole file again. That's how "4 days ago (after a 70-day incubation)" is exact even for plugins that were quiet for years, how *New* knows when a plugin was listed, and how `gain(21d)` or `milestone(10k)` work for any window or count.

Releases within a week of each other count as one **update wave**, so a plugin that ships a fix the day after a release isn't counted twice. *Updated* leaves out plugins with more than 9 waves in 180 days (`releases(180d) <= 9` in its query). Incubation is a pause of 30+ days between waves. The first release after it is the plugin's **hatching**: `incubated` is how long the pause lasted, `hatched` how long ago it ended. Every plugin stays on *Incubation* for the same 30 days after hatching (the latest on top), and releases after it, a hotfix or the next update, don't undo it.

## Similar

*Similar* lists the plugins that do the same job. Each plugin's 50 closest are worked out on GitHub ([scripts/similar](../scripts/similar/build.py), with the hourly [profiles workflow](../.github/workflows/profiles.yml)) from five things, weighted 2-1-3-1-1:

- its **description**, as a vector made daily by IBM's open [granite-embedding-311m-multilingual-r2](https://huggingface.co/ibm-granite/granite-embedding-311m-multilingual-r2) model (Apache 2.0, [embeddings workflow](../.github/workflows/embeddings.yml)), so meanings match across wordings and languages,
- its **name**,
- its **AI overview** (summary, the problem it solves, what it does), word by word,
- its **category**, and
- its **tags**, a rare shared tag counting more.

These weights won a blind test against 50 hand-graded plugins: its top 5 scored about a third higher (nDCG@5 0.77 vs 0.56) than with the description vector alone. The same test runs before every publish, and a list that scores lower isn't published. The lists go on the `profiles` branch as `similar.json`; Community Radar downloads them with Sync and only looks them up. *Very close* is the first 5, *close* the next 10, *related* the rest; "In common" shows the categories and tags two plugins share. A plugin listed in the last hours has no list until the next build. No AI provider is involved.

## AI profiles

Every hour a [GitHub Actions workflow](../.github/workflows/profiles.yml) has a free AI model read the README of each new or changed plugin and write a short profile: a summary, the problem it solves, what it does, its category (from a fixed list of 78) and tags (a fixed list of about 500), and what it needs (an API key, a paid service, an account…). A README in another language that links an English version (`README_en.md`…) or holds an English section is read in English. The profiles are published on the `profiles` branch; each one records the model that wrote it and the file it read. Community Radar downloads their index once a day, only when it changed, and reads a plugin's whole profile when you open its details (the Overview tab). Your device makes no AI request for them, unless you ask for the Overview in your language: that goes to your AI provider once and is kept in `translations.jsonl`.

## Network

Community Radar only makes these requests:

| Destination | When | What |
|---|---|---|
| `raw.githubusercontent.com` | Sync, README updates | The public plugin list and stats, and plugin READMEs |
| `api.github.com` | Only when a README isn't at a usual path | The README. Unauthenticated, 60 requests an hour |
| `raw.githubusercontent.com/alitekdemir/obsidian-community-radar/metrics/` | Sync, when a newer build is out | Release history and download metrics (~600 KB) |
| `raw.githubusercontent.com/alitekdemir/obsidian-community-radar/<version>/locales/` (`HEAD` when that version has no complete file) | Only for a UI language other than English: once on its first use, then after an update of the plugin | That language's UI strings (~60–90 KB); English is built in |
| `raw.githubusercontent.com/alitekdemir/obsidian-community-radar/profiles/` | Sync, at most once a day and only when changed; the details window | The AI profiles' index (~5.6 MB), the Similar lists (~2.8 MB, ~1.2 MB sent compressed), one plugin's profile (~2 KB) |
| Your AI provider (`api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com` or `openrouter.ai`) | **Only** when you translate or ask for group suggestions, with a provider set up | Plugin names and descriptions, the names of your groups, a README or an Overview you ask to translate |

No telemetry, no account, nothing about your vault is sent anywhere. In the vault, Community Radar only reads and writes notes in its own notes folder; it never lists your other files. API keys are kept in Obsidian's keychain (SecretStorage) on each device, never in `data.json`; the plugin stores only the key's name (e.g. `anthropic-api-key`), so other plugins using the same name share it. The list of installed plugins comes from Obsidian's internal `app.plugins`.

## Storage

| Data | Where |
|---|---|
| Your groups, ratings, statuses, notes, review dates | Your library notes |
| Settings, page queries, saved views, ignored plugins, recent actions | `.obsidian/plugins/plugin-radar/data.json` |
| Short description and Overview translations | `.obsidian/plugins/plugin-radar/translations.jsonl` |
| Catalog, release history, similar lists, AI profiles and your UI language's strings (caches, rebuilt on demand) | `.obsidian/plugins/plugin-radar/cache/` |
