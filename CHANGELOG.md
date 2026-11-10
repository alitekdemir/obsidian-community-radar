# Changelog

## 0.10.0

### New

- **Every page is a query.** The tabs' rules are now queries you can read and change: hover a tab to see it, press **Query** to edit it; changed, the status line offers *Save ▾* (make it the page's query, or save as a new view) and *Revert*. **Settings › Page queries** lists them all, each with ↺ and one button for all. The old tab settings (Updated's days, Incubation's pause, Hide busy, Downloads ≥) moved into these queries by themselves. Basic and Query are per page now; in Basic the page's query shows faint in the box and your words narrow it.
- **One strip of pages**: ⌂ Home, the tabs (Tracked among them), your saved views, and a widget's list while it's open (✕ back home). A widget's or saved view's list is a page like a tab: it opens on its query (*widget order* is gone, it's the query's `order by`), Basic narrows it with Filter, Sort and words, and it can be saved as a view; a saved view is a query (older ones were converted), with **+N** in the strip for matches you haven't seen.
- New fields: `busy`, `hatched`, `dismissed`, `ignored`, `changed` (tracked, released since you reviewed it), `rise7`/`rise30` (% growth), `milestone`/`passed`, `text`. Hidden plugins stay out unless a query names `ignored`. In Query mode a bare unknown word is an error (*there's no field "busy"*); to search text write `"busy"` or `text ~ busy`.
- Query help: **?** in the box (fields, operators, functions, values; a click puts it at the caret), **Ctrl+Space** for suggestions anywhere, **/** jumps to the box, **Esc** clears it (Query: back to the page's query), your **recent queries** in the empty box. When nothing is found, the status line names the clause that emptied the list (*42 plugins without "released <= 7d"*); hovering the clause count shows what each clause finds alone.
- Query colours come from your theme's code colours, like your code blocks.
- A changed query gets a **save bar under the box** instead of a menu: what changed (*14d → 30d*, *+1 clause*), *Discard*, *New view…* and the save that fits (*Save to "Updated"*, *Update the "Tasks" view*, or *Save as a view…* on a widget's list); a broken query can't be saved. The box gets a yellow edge and the tab a dot until you save or discard.
- **Tooltips on query words**: rest the mouse on a field, operator, value, function or AND/OR/NOT/order by to see what it means (a field with its type and an example, `30d` as 30 days, `startOfMonth()` with today's date for it).
- **Columns** opens under its button, the table staying in view: your columns in order (drag, ✕ hides), each with its query field and the first row's value, the sorted one marked; the rest as chips in groups (Numbers, Time, Yours, Info) that add at the end, a tooltip saying what each holds. New columns: **Gained % · 7/30 days**, **Milestone**, **Status**; Sort offers Gained % too. Every page keeps its own columns, saved views and widget lists included. Esc or a click outside closes it.
- In Query mode a table header (or Sort) sorts by writing the query's `order by`; before, the arrow moved but the list kept the query's order.
- Page and widget queries write AND out (`released <= 14d AND NOT new AND …`).
- **Query language** in the search box (like Jira's JQL, English field names): `downloads > 500 released < 30d group in ("Tasks", Calendar) NOT installed calendar order by gain30 desc`. A space is AND; AND, OR, NOT and ( ) work too; words that aren't a clause search the text. Fields by type — numbers and days (downloads, gain7, gain30, released, age, gap, rating: `= != > >= < <=`, `is empty`), text (name, description, author, id: `=`, `~` contains, `!~`, `/regex/`, `in (…)`), lists (group, status: `=`, `!=`, `in`, `not in`, `is empty`), yes/no (favorite, installed, tracked, new). Values: 10k, 1.5m, 30d, 2w, 6m, 1y, 2026-01-01; quotes for spaces. Suggestions as you type: fields, then only the operators that fit, then the field's values (your groups and statuses, authors). **Basic | Query** at the box's end, like Jira: Query writes your filters (downloads threshold, added filters, sort) into the box and the panel steps back; Basic turns the query back into filters, and stays locked, saying why, when the query has something filters can't say (OR, ( ), in (…), NOT, regex, functions). Typing a query in Basic switches by itself, your filters first. The empty box offers your filters as a query and five examples. **Date functions**: today(), startOfWeek(), startOfMonth(), startOfYear() with a shift (`startOfMonth(-1)`), and lastSync() (the sync before the latest): `released > lastSync()`. The box colours each word by its role (field, operator, value, function, AND/OR/order by, NOT) and underlines a broken part; long queries wrap and new lines are kept (Enter adds a line in a query, Ctrl/Cmd+Enter applies at once). The list follows 1 s after you stop typing. An invalid query isn't applied — the list keeps the last valid one and the status line says where and why; otherwise it counts the clauses instead of repeating the query. Suggestions open only while you type, close inside a word or once a value is typed in full, and skip values already in `in (…)`; a yes/no field stands alone (`NOT installed`). Saved views keep the query, `order by` included. Plain search (commas, /regex/) works as before.
- **Translation instructions** in settings (AI translation): the instructions sent for descriptions and for READMEs can be changed; `{language}` becomes the target language, ↺ goes back to the default. The reply format is added after them, so a changed prompt can't break the answer.

### Changed

- *Sync now* says how far the release history reaches (or that it couldn't be had this time), and the status line shows its span: *history: 2020 – 2026-11-09*, marked *old* past two days.

## 0.9.3

### New

- **Filters**: one *Filter ▾* button, always first in the bar (only its count changes). Its panel holds every filter of the tab — a changed one is marked and has ↺ — and adds more: Released ≤, Incubation ≥, Gained · 30 days ≥, Age ≤, Author, Installed (✕ removes them; each tab keeps its own; home widgets ignore them). *Reset* sits in the panel; the status line says *N filters in effect*.
- **Quick filters** (a switch in the panel, per tab): the filters in effect show as chips on a row under the bar, set and reset right there.
- **Saved views**: *Save* at the end of the bar keeps the tab with its filters (search, added filters and sort included) under a name, as a widget on the home page. It counts its matches and shows *N new* for the ones that weren't there when you last opened it; ⋮ renames, hides or deletes it.
- **Table** layout (List · Cards · Table): Name plus a few columns (Downloads, Latest release, ★); the column picker adds Rating, Gained 30/7 days, Author, Incubation, Age, Release rhythm, Groups, Description and orders them by dragging (in the picker or by a column's header), per tab; Name takes the room, the other columns fit their content. A header click sorts; the ★ and Rating cells change on click; rows open their details and can be picked for bulk actions.
- **Bulk actions**: a box in each row's left gutter (the whole gutter takes the click; on hover, and on every row once you pick one; Shift+click for a range; on a card, its top-left corner, and a picked card gets an accent border) and a bar at the bottom: Favorite, Rate, Add to group (or a new one), **Suggest groups**, Mark reviewed (Tracked), Hide, Ignore. *Select the N shown*, then — like Gmail — *Select all N in this list*. Each action asks first, then leaves a result with **Undo** at the bottom left.
- **Suggest groups** works on the picked rows: the AI's groups show under each one and a click adds or removes the group right away. It replaces the separate grouping mode (*Suggest groups for this list* in ⋮ and its Accept step); *Suggest groups for ungrouped plugins* now picks them on Tracked › Ungrouped.
- **Recent actions** (⋮ on Home, the clock in the List's bar, and a command): the last 20 bulk actions, kept across restarts. Undo turns back only what the action did; a plugin you changed by hand since is skipped and counted.
- Recent actions also lists days on which many plugins were marked reviewed at once (like the old *Mark all reviewed*) and takes those marks back.
- Home's *Not seen yet* strip: with 7 or 30 days chosen, *new releases you track* counts the releases in that period (reviewed ones too).
- A widget's list has a *Sort* menu (the widget's own order first).

## 0.9.2

### New

- **Home**: the view opens on a home page (Home · List · Tracked at the top; *Opens on* in its ⋮ menu).
  - **Not seen yet**: new plugins, new releases you track, milestones passed and updates you haven't seen (or in the last 7 / 30 days). Opening a card's list marks them seen, so it counts down to ✓; restarting Obsidian doesn't reset it.
  - **Discover widgets**: New arrivals, Milestones (1K, 5K, 10K, 25K, 50K or 100K), Out of incubation, Rising, Quiet updates, New releases you track; *Installed, not tracked* can be added. Each shows its count, *N new* (not seen yet) and a preview, and is set in place: the value chip and ⋮ change its settings, ⓘ explains it, the grip reorders it (touch too), ⋮ hides it.
  - A widget opens the list of its plugins; its *N new* button opens only the new ones (*Only new* ✕ shows all), marked *new* on the rows. ✕ or Esc goes back home.
  - Motion: cards rise in, lift on hover and show their tools; off in the page's ⋮ or with the system's reduced motion.
- The server's history now records 1K, 5K, 10K, 25K, 50K and 100K milestones. *Milestones* lists a plugin under the highest one it reached in the period (a 33K plugin that passed 1K, 10K and 25K this month is a 25K).
- *Rising* by % (default): plugins that grew 20%+ from at least 1K downloads; by count in its ⋮.
- A small *+ Add a widget* card brings hidden widgets back.

### Changed

- *Release rhythm* in a plugin's details reads the last 12 months (a young plugin: its own age) in update waves, releases within a week counting as one update: *every ~N days* (up to 45), *every ~N months* (up to 135), *every 6 months*, *yearly* or *none for a year*, with the releases it counts and a year-plus pause before them, or the rhythm before it went quiet; one release says so instead of a dash. It was the median of every gap, so a busy first month outweighed years of silence.
- The details' *Release history* is a strip of the pauses between updates instead of dots: colored by length (under a month, 1–6 months, 6–12 months, over a year), widths by the log of the pause, the current silence striped; hover a part for its dates, releases and, on a second line, the pause after it. A plugin with more than the 50 kept releases reads *last 50 releases*, its strip *since* the oldest kept one. A sentence under it gives the year's updates and a year-plus pause before them, or how long it has been quiet. The *Release rhythm* tile keeps one short fact.
- *Hide busy plugins* counts update waves too: more than 9 in 6 months (about every three weeks). 21 hotfixes in two sittings no longer hide a plugin.
- A plugin counts as *new* for 14 days by default (was 30).
- Tracked moved from the tabs to the Home · List · Tracked switch, with its new-release count.
- The switch, tabs and filters stay at the top while the list scrolls, with no gap above them.
- *All* shows every plugin by default (Downloads ≥ off).
- On Tracked, a chosen group or status counts as a filter; ✕ puts it back to All.
- *Mark all reviewed* left the bar (it comes back as a bulk action with Undo). The new-plugin badge reads *NEW PLUGIN*, apart from *NEW RELEASE*.

## 0.9.1

### New

- **Release history from GitHub**: a daily [workflow](.github/workflows/metrics.yml) replays every stats snapshot since October 2020 and publishes the result (~600 KB) on the `metrics` branch; sync downloads it when a newer one is out. Six years instead of one, exact daily release dates, and the real listing date of every plugin (so *Age* and *New* hold for old plugins too). The plugin no longer builds a history itself: *Build release history* and *History depth* are gone, along with the ~50 MB of snapshots they downloaded.
- **Growth**: sort by *growth · 7 days* or *growth · 30 days* (downloads gained); the gain shows on each row (`+998`) and in the details window (*+1K in 30 days*).
- **Milestones**: *🎯 10K* on a plugin that passed 1K, 10K or 100K downloads in the last 30 days.

### Changed

- New installs keep their notes in *Plugins* (*Eklentiler* in Turkish) instead of *Community Radar*; an existing folder setting stays.
- Clearer wording in the settings. *Suggest groups* left the settings; it's in the ⋮ menu and the command palette.
- The highlighted row (a thin outline) shows only with keyboard shortcuts on.

## 0.9.0

### New

- **Incubation** (was *Revived*): plugins that released again after a long pause. *Incubation ≥* has presets from 30 to 360 days (default 60), and each plugin stays as long as its incubation was (at most 360 days), not just *N* days — a plugin quiet for 88 days and released 50 days ago is still found. The date reads *4 days ago (after a 70-day incubation)*; sort by *incubation* for the longest pauses.
- **New for N days** (*Settings*, default 30): how long a plugin counts as new. *Updated* leaves new plugins out.
- **Hide busy plugins** on *Updated* (on by default): plugins with more than 20 releases in 6 months stay out, so the rest get seen.
- **Filters first**: *Filters · N* leads the bar with every filter of the tab next to it (*Last N days*, *Downloads ≥*, *Incubation ≥*, *Hide busy plugins*); *N* counts the ones you changed from the tab's defaults, the search included, and its ✕ puts them back; with nothing changed the head stays out of the way (it shows in a narrow panel, where it opens the folded filters). Inside Similar it counts and clears Similar's own search, never All's (also on an empty list); sort and layout stay. In a narrow panel the filters fold under the head.
- **Similar as a filter**: *Similar →* filters the list to the closest plugins, shown as one chip (`‹ · ≈ Similar: name · ✕`). The All tab stays active as *All similar N* with the same bar (its *Downloads ≥* applies), rows keep every action, List / Cards included, and the matches come in pages of 50 (up to 300, closest first) instead of a fixed 30. `‹` steps back (up to 10 steps), `✕` or `Esc` returns to the tab, filters and scroll you had and lights up the row you started from. Also a command: *Show plugins similar to this note's plugin*.
- **Details window, redone**: name, version and author on one line with *Open in Obsidian*; four tiles (downloads, latest release, **age** since it was listed, release rhythm); the README in a dark box under its tabs; the five closest plugins with how close they are and *All (30) →*; release history and the GitHub repository at the bottom; the same actions as a row (star with 1–5 on hover); `‹ n / total ›`. *Hide* and *Exclude* move on to the next plugin instead of closing.
- **A click anywhere on a row** (not on a control) opens its details, as on a card.
- **`description` property** in tracking notes, kept up to date. Notes made before lose the copy at the top of the body on the next sync (only if it is still the same text).

### Changed

- The search is no longer remembered between sessions; filters, sort and layout are.
- The source is split into ordered files (`src/00-…40-*.js`); the build joins them.

### Removed

- The Similar strip under a row, the separate Similar list with its trail, and their settings.

## 0.8.1

### Fixed

- **README images** linked to a GitHub page (`github.com/…/blob/…`, as in *Kanban* and *Linter*) now point to the image itself and show up, in the details window and in your tracking notes (existing notes are fixed once, on upgrade).

### New

- **Support**: a *Sponsor* button at the bottom of the settings (and on the plugin's page in Obsidian) links to GitHub Sponsors.

## 0.8.0

Changes since 0.7.3 (0.7.4 was not released).

### New

- **Similar by meaning**: plugins are matched by what their names and descriptions mean, not only by shared words (*Gamificate your PKM* finds *Gamified Tasks*, *Scholar Quest*, *RPG Manager*). The vectors are built once a day in GitHub Actions with IBM's open `granite-embedding-311m-multilingual-r2` model and downloaded with a sync (~2.5 MB); the comparison runs on your device, with no AI request and no key. Until the file is in (or for a plugin listed today) Similar falls back to word matching (BM25, word pairs, near-copies spread out).
- **Similar list**: *See all* opens the matches as a full list with every row action. A trail starts at the tab you came from (`← All › Periodic Notes › Periodic Calendar`) and every step goes back; the head shows how many matches and how they were found. Sort by closeness, downloads, last update, A–Z or newest, and search within the results. Each result shows how close it is (*very close*, *close*, *related*, with a bar) and the terms it shares.
- **Card view**: a *List / Cards* switch in the filter bar shows any tab as cards: name, version and author, your tags, two lines of description, links, then downloads, date and actions in the footer.
- **Details window**: click a card, or a row's description (or press `Enter`), and it grows into a large window: downloads, latest release, when it was listed, how often it ships; the whole description and its translation; your note; the README; the five closest plugins; the release history as a timeline; and the actions. `←` / `→` walk the list, `Esc` closes.
- **README in your language** (on request): the details window has a *README · <language>* tab; it's dim until there is a translation, shows a *Translate the README* button with the size (and the cost when the model's price is known), and keeps the translation in the tracking note right above the original. A newer release marks it *older* with *Translate again*. Also a command: *Translate the README of this note*. *Settings → README translation* turns it off.
- **Heading of your notes** in new tracking notes can be set in settings (default: *My notes* in the interface language).

### Changed

- **Rows in three lines**: name and version with the date and downloads on the same line (downloads line up down the list), your tags under it, the description, then links on the left and actions on the right. More plugins fit on a screen; a narrow panel needs no special layout.
- **"after N days dormant"** is shown only when the pause was long (at least the Revived tab's threshold) and always on the Revived tab, as *after N days quiet*. It never meant a recent update.
- The notes folder defaults to **Community Radar** in every language (existing settings are kept).
- Small uppercase labels follow the plugin's language, not Obsidian's (no *SİMİLAR* in English on a Turkish system).
- README screenshots updated.

### Network

- `raw.githubusercontent.com/alitekdemir/obsidian-community-radar/embeddings/…`: the semantic vectors, on sync when a newer build is out.

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
