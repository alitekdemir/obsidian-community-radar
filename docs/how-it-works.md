# How it works

## Where the data comes from

Obsidian's [`obsidian-releases`](https://github.com/obsidianmd/obsidian-releases) repository commits `community-plugin-stats.json` **every day**, back to October 2020. Each snapshot holds every plugin's downloads and latest release time.

Once a day, a [GitHub Actions workflow](../.github/workflows/metrics.yml) replays all of those snapshots and publishes the result on this repository's `metrics` branch: up to 50 release dates per plugin, the day it first appeared, the downloads gained in the last 7 / 30 / 90 days, and when it passed 1K, 5K, 10K, 25K, 50K and 100K downloads. Community Radar downloads that file on a sync when a newer one is out. That's how "4 days ago (after a 70-day incubation)" is exact even for plugins that were quiet for years, and how the *New* tab knows when a plugin was listed.

Releases within a week of each other count as one **update wave**, so a plugin that ships a fix the day after a release isn't counted twice. A plugin with more than 9 waves in 180 days is *busy*, and *Updated* leaves it out.

## Similar

*Similar* compares meanings. Once a day, a [GitHub Actions workflow](../.github/workflows/embeddings.yml) turns every plugin's name and description into a vector with IBM's open [granite-embedding-311m-multilingual-r2](https://huggingface.co/ibm-granite/granite-embedding-311m-multilingual-r2) model (Apache 2.0; only new or edited plugins are re-encoded) and publishes them on the `embeddings` branch. Community Radar downloads that file and ranks plugins by cosine similarity on your device, adding a small share of shared-word matching (BM25) so a rare common word still counts. No AI provider is involved.

## Network

Community Radar only makes these requests:

| Destination | When | What |
|---|---|---|
| `raw.githubusercontent.com` | Sync, README updates | The public plugin list and stats, and plugin READMEs |
| `api.github.com` | Only when a README isn't at a usual path | The README. Unauthenticated, 60 requests an hour |
| `raw.githubusercontent.com/alitekdemir/obsidian-community-radar/metrics/` | Sync, when a newer build is out | Release history and download metrics (~600 KB) |
| `raw.githubusercontent.com/alitekdemir/obsidian-community-radar/embeddings/` | Sync, when a newer build is out | The vectors for Similar (~2.5 MB) |
| Your AI provider (`api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com` or `openrouter.ai`) | **Only** when you translate or ask for group suggestions, with a provider set up | Plugin names and descriptions, the names of your groups, and a README you ask to translate |

No telemetry, no account, nothing about your vault is sent anywhere. In the vault, Community Radar only reads and writes notes in its own notes folder; it never lists your other files. API keys are kept in Obsidian's keychain (SecretStorage) on each device, never in `data.json`; the plugin stores only the key's name (e.g. `anthropic-api-key`), so other plugins using the same name share it. The list of installed plugins comes from Obsidian's internal `app.plugins`.

## Storage

| Data | Where |
|---|---|
| Your groups, stars, ratings, statuses, notes, review dates | Your tracking notes |
| Settings, page queries, saved views, ignored plugins, translations, recent actions | `.obsidian/plugins/plugin-radar/data.json` |
| Catalog, release history and vectors (caches, rebuilt on demand) | `.obsidian/plugins/plugin-radar/cache/` |
