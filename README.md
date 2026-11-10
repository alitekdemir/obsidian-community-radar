# Community Radar

**Your radar for Obsidian's 10,000+ community plugins.** See what's new, what's rising and what woke up after years of silence. Ask the list questions like you would in Jira, find plugins that do the same job by meaning, and keep the ones you care about as notes in your vault.

*[Türkçe](README.tr.md)*

![Community Radar: home, query, table, details, similar, tracked](docs/images/demo.webp)

## Why

- **Too much to follow.** About 50 new plugins arrive every day, and hundreds more ship updates. Obsidian's browser shows them all the same way. Community Radar opens on what changed since you last looked.
- **Growth and pauses are invisible.** Obsidian only shows today's download count. Community Radar replays every daily snapshot since 2020: what gained the most this month, what passed 10K, what released again after a year.
- **What you found gets lost.** A plugin you liked last month is a name you can't remember. Here it's a note with your groups, rating and notes, and a README that stays current.

## What it does

### 🏠 A home that shows what changed

![Home: the last 7 days and the discovery widgets](docs/images/home.png)

The top strip counts what you haven't seen yet: new plugins, new releases of plugins you track, milestones passed and quiet updates. It resets when you open the list, not when you restart Obsidian. Below it, widgets each answer one question: *New arrivals*, *Milestones*, *Out of incubation*, *Rising*, *Quiet updates*, *New releases you track*, *Installed, not tracked*. Change a widget's period or threshold right on the card. Its **N new** badge opens only the new ones.

### 🥚 Plugins that came back

![Incubation: plugins releasing again after a long pause](docs/images/incubation.png)

*Incubation* lists plugins that released again after at least 60 days of silence, for example "4 days ago (after a 1,462-day incubation)". *Updated* leaves out plugins that ship every few days, so a real update isn't buried. Both read the full release history, not just the latest version.

### 🔍 A query language, with Basic mode for everyone else

![The query box: colors, a change badge and its actions](docs/images/query-save.png)

Every tab is a query you can read and change:

```
age <= 30d AND downloads >= 50 AND NOT tracked
order by gain30 desc
```

27 fields, date functions like `startOfMonth()` and `lastSync()`, suggestions as you type (`Ctrl+Space`), colors, and an explanation when you hover any word. Press `?` for the cheat sheet. If nothing matches, it says which condition emptied the list. Prefer clicking? **Basic** mode has the same filters behind a **Filter** button. A changed query can replace the tab's own query or be saved as a **view**: a tab of its own that counts new matches, and a widget on Home. See [the query reference](docs/query.md).

### ≈ Similar, by meaning

![Plugins similar to Templater, closest first](docs/images/similar.png)

**Similar →** on any plugin lists up to 300 others that do something close, closest first, even with no shared words. It runs on your device with vectors built daily from every plugin's description. No API key needed.

### 📊 List, cards or a table, and many plugins at once

![Table view with the column picker](docs/images/table.png)

Switch between **List**, **Cards** and **Table**. The table has 16 columns to pick from, such as downloads, gained in 7 or 30 days, % growth, milestone and release rhythm. Each page keeps its own columns. Tick rows (or **Select all N**) to favorite, rate, group, hide or ignore many at once. **Recent actions** keeps your last 20 bulk changes, and **Undo** skips anything you edited since. Click a row for the details window: stats, README, release history and similar plugins.

![Details window: stats, README, release history, similar](docs/images/details.png)

### 📝 Notes you own, and optional AI

![Tracked plugins, in sections by group](docs/images/tracked.png)

Star a plugin or add it to a group and it gets a note in your vault: groups, favorite, rating, status and your notes in the properties, with its README kept current below. One click builds an **Obsidian Bases** table of all of them. With an API key (Anthropic, OpenAI, Google or OpenRouter), you can translate descriptions and READMEs into your language and get group suggestions for the rows you select. AI stays off until you set it up. See [tracking notes](docs/tracking-notes.md).

## Install

Open **Settings → Community plugins → Browse**, search for **Community Radar**, then **Install** and **Enable**. Open it from the ribbon or with the command **Open Community Radar**.

## Get started in 60 seconds

1. The first sync downloads the plugin list and the release history (about 3 MB).
2. Look at **Home**: what's new since your last visit.
3. Open a widget's list. Star a plugin you like; a note appears in your vault.
4. Press **Query** on any tab to see its rule, change it, and save it as your own view.

## Privacy

No account, no telemetry. Community Radar reads only its own notes folder. It downloads public files from GitHub, and calls an AI provider only when you ask for a translation or group suggestions. API keys stay in Obsidian's keychain. [Every request, listed.](docs/how-it-works.md#network)

## Documentation

- [Query language](docs/query.md): fields, operators, dates, examples
- [Tracking notes](docs/tracking-notes.md): the note's properties and the Bases view
- [Settings and commands](docs/settings-commands.md): every setting, command and shortcut
- [How it works](docs/how-it-works.md): where the data comes from, network, storage
- [Development and translating](docs/development.md)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE) © Ali Tekdemir · [Sponsor](https://github.com/sponsors/alitekdemir)
