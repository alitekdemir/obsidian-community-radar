# Query language

*English · [Türkçe](query.tr.md)*

Every list in Pindex is a query: *All*, and every card on Home (*New*, *Updated*, *Incubation*, *Suggested*, your saved views…). A card opens its list; press **Query** next to the box to see its query and change it; **Basic** goes back to plain search and the **Filter** panel. A changed query shows a **● N changes** badge: save it as a view (a card of its own on Home), or, for a built-in card, over the card's own query (its **⋮ › Edit the query**; **Reset the query to default** brings the default back once you saved your own).

```
downloads > 500 AND released < 30d AND group in ("Tasks", Calendar) AND NOT installed
order by gain(30d) desc
```

## Clauses

A clause is `field operator value`. Join clauses with `AND`, `OR` and `NOT`, group them with `( )`. A yes/no field stands alone: `installed`, `NOT library`. A space between clauses also means AND. Line breaks and extra spaces don't matter. In Query mode a word that isn't a clause is an error; put a text search in quotes: `"daily note"`.

At the end, in this order: `group by field` splits the list into sections, one per value (group, category, primary, tag, intent, lifecycle, status, author; a plugin with several shows under each, the ones without come last); `order by field desc` (or `asc`) sorts it; `limit 100` keeps the first 100, `limit 101-200` the 101st to the 200th.

```
primary = tasks group by intent order by downloads desc limit 50
```

## Fields

| Field | Type | Means |
|---|---|---|
| `text` | text | name, author, id, description and AI summary together (what a plain word searches) |
| `name` | text | the plugin's name |
| `description` | text | its description |
| `author` | text | its author |
| `id` | text | its plugin id |
| `downloads` | number | downloads |
| `released` | days | days since the latest release, or a date |
| `listed` | days | days in the list, or a date (listed before the history began in October 2020: counted from then) |
| `incubated` | days | how long its latest incubation lasted: the last pause of 30+ days between update waves |
| `hatched` | days | days since it came out of that incubation, or a date; later releases don't change it |
| `rating` | number | your rating, 1–5 |
| `group` | list | a group in your note |
| `status` | list | the status in your note |
| `installed` | yes/no | installed in this vault |
| `library` | yes/no | in your library (has a note) |
| `unreviewed` | yes/no | in your library, with a release since you reviewed it |
| `dismissed` | yes/no | removed from Suggested |
| `excluded` | yes/no | ignored by you |
| `snoozed` | yes/no | hidden until its next release |
| `removed` | yes/no | taken off the official list by Obsidian; only installed ones show up, and only when the query names `removed` |
| `translated` | list | what's in your language: `description`, `overview` (up to date) |

Field names are English in every language, so saved queries survive a language switch. Values are yours (your group names, your statuses).

## AI profile fields

An AI reads every plugin's README on GitHub and writes a short profile: what it does, where it belongs, what it needs. The plugin downloads these once a day. A plugin not profiled yet has none of them.

| Field | Type | Means |
|---|---|---|
| `category` | list | its categories: its home and up to two more |
| `primary` | text | its home category, one per plugin |
| `tag` | list | its tags, from a fixed list of about 500 |
| `intent` | text | `new` (a new capability), `improve` (makes an Obsidian feature better), `alternative` (another take on an existing plugin) |
| `lifecycle` | list | `experimental` or `deprecated`; `is empty` for neither |
| `apikey` | yes/no | needs an API key to work; an optional one doesn't count |
| `paid` | yes/no | needs a paid service to work; an optional one doesn't count |
| `summary` | text | the AI summary of its README |

Categories and tags are written as the profiles name them (`project-management`, `daily-notes`), in every language; the query box suggests them with their counts. Examples: `category = ai AND NOT apikey AND NOT paid` (AI plugins that work without a key or a bill), `primary = tasks AND intent = alternative` (other ways to manage tasks), `tag = kanban order by downloads desc`.

## Fields with a parameter

These are written like a function. The parameter is yours; `()` takes the default.

| Field | Default | Means |
|---|---|---|
| `gain(30d)` | `gain()` = 30 days | downloads gained in the last N days |
| `rise(30d)` | `rise()` = 30 days | % growth in the last N days (only from 1K downloads up) |
| `releases(30d)` | `releases()` = 30 days | updates in the last N days (releases within a week count once) |
| `milestone(10k)` | `milestone()` = its latest milestone | days since it reached N downloads |

Any number works: `gain(21d)`, `rise(45d)`, `milestone(7k)`. The download history covers the last year: day by day for the last month, week by week before it (a window in between is read in proportion). A plain `gain` without `( )` is an error that says how to write it.

```
gain(21d) >= 500 AND NOT library
milestone(10k) <= 30d order by downloads desc
releases(180d) > 9
```

## Operators

| Type | Operators |
|---|---|
| number, days | `=` `!=` `>` `>=` `<` `<=` `is empty` |
| text | `=` `!=` `~` (contains every word, in any order) `!~` (doesn't) `in (…)` `not in (…)` |
| list | `=` `!=` `in (…)` `not in (…)` `is empty` |
| yes/no | stands alone; `NOT` for no |

## Reading days

A days field counts **back from today**, so the smaller number is the more recent one:

| You write | It means |
|---|---|
| `released <= 30d` | released **within** the last 30 days |
| `released >= 1y` | **no release for** a year or more |
| `listed <= 14d` | listed in the last two weeks |
| `incubated >= 60d` | its latest incubation lasted **60 days or more** |
| `hatched <= 30d` | came out of incubation **within** the last 30 days |
| `milestone(10k) <= 30d` | reached 10K downloads this month |

The four day fields on one plugin's timeline:

```
listed ── release ── … incubation … ── hatching · hotfix ── release ── today
   │                                    │                         │       │
   │                                    └──────── hatched ────────────────┤
   │                                                              └ released
   └──────────────── listed ──────────────────────────────────────────────┘
```

A plugin that has no value for a field (no history yet, no download stats, under 1K for `rise`) never matches a comparison on it and goes **last** when you sort by it, in either direction. `is empty` finds those.

### `released` vs `hatched`

Both read a release date, but not the same release:

| Field | Reads | When a new release comes out |
|---|---|---|
| `released` | the **latest** release | moves with every release |
| `hatched` | the **first** release after a pause of 30+ days | stays put; only a new 30+ day pause moves it |

Releases within a week of each other are one update wave: a fix inside a wave isn't a pause. `incubated` isn't a date but the pause's **length**.

An example plugin:

```
Jan 10   1.0
         ┆  120 days of silence ───────── incubated = 120d
May 10   1.1     ← out of incubation: hatched
May 13   1.1.1   ← same wave (3 days later): a fix
Jun  5   1.2     ← 23 days later: not a pause
Jun  8   today
```

The fields after each release:

| Date | Release | `released` | `hatched` | `incubated` |
|---|---|---|---|---|
| Jan 10 | 1.0 | Jan 10 | — | — |
| May 10 | 1.1 | May 10 | May 10 | 120d |
| May 13 | 1.1.1 | May 13 | May 10 | 120d |
| Jun 5 | 1.2 | Jun 5 | May 10 | 120d |

Each release is `released` when it comes out and gives way to the next one. `hatched` stays at May 10. Today (Jun 8) this plugin matches `released <= 3d`, `hatched <= 29d` and `incubated >= 120d`.

Had 1.2 come out 30 or more days after 1.1.1, it would be a new hatching: `hatched` would move to 1.2 and `incubated` to that pause's length. A plugin that never paused 30 days, or has no history yet, has no `hatched`; `released` is always there.

## Values

| Value | Example |
|---|---|
| Number, with `k` or `m` | `500`, `1k`, `2.5k`, `1m` |
| Days, weeks, months, years | `14d`, `2w`, `3m`, `1y` |
| Date | `2026-01-01` |
| Text with spaces | `"Daily notes"` |
| A list | `("Tasks", Calendar)` |

## Date functions

| Function | Is |
|---|---|
| `today()` | today at midnight |
| `startOfWeek()` | this Monday |
| `startOfMonth()` | the 1st of this month |
| `startOfYear()` | January 1st |
| `lastSync()` | the sync before the latest one |

Each takes an offset: `startOfMonth(-1)` is the 1st of last month, `today(-7)` a week ago.

```
released >= startOfMonth() order by downloads desc
listed >= lastSync()
```

## Build one in three steps

*Hidden gems*: good plugins that aren't famous yet.

1. **Size:** not a giant. `downloads <= 10k`
2. **Life:** maintained and growing. `AND released <= 30d AND rise(30d) >= 20`
3. **New to you:** `AND NOT library`, then the order: `order by rise(30d) desc`

```
downloads <= 10k AND released <= 30d AND rise(30d) >= 20 AND NOT library
order by rise(30d) desc
```

If the list comes out empty, the status line says which condition emptied it.

## Ready-made queries

The same list as **+ Add widget** on Home and the empty query box. **Add** puts one on Home as a saved view; **Try in query** opens it in the list to change first.

| Name | Query | Finds |
|---|---|---|
| Updated this month | `released >= startOfMonth() order by downloads desc` | released since the 1st |
| Fast starters | `listed <= 60d AND downloads >= 1k AND NOT library order by downloads desc` | listed in the last 2 months, past 1K already |
| Hidden gems | `downloads <= 10k AND released <= 30d AND rise(30d) >= 20 AND NOT library order by rise(30d) desc` | 1K–10K, updated this month, growing 20%+ |
| Awake again | `incubated >= 180d AND hatched <= 30d AND NOT library order by hatched desc` | back this month after 6+ months |
| New releases of popular plugins | `downloads >= 50k AND released <= 14d AND NOT library order by released desc` | changes that reach many people |
| Just passed 10K | `milestone(10k) <= 30d order by downloads desc` | reached 10K this month, whatever they reached after |
| Actively developed | `releases(30d) >= 3 AND downloads >= 1k AND NOT library order by gain(30d) desc` | 3+ updates this month |
| Abandoned installs | `installed AND released >= 1y order by released asc` | installed, no update for a year |
| To try | `library AND NOT installed order by rating desc` | in your library, not installed here |
| Ungrouped | `library AND group is empty order by name asc` | in your library, without a group |
| Unrated | `library AND rating is empty order by downloads desc` | in your library, not rated yet |
| Sleeping plugins in your library | `library AND released >= 1y order by released asc` | in your library, no release for a year |

On Home, the **Category watch** widget (in **+ Add widget › Notify**) lists the plugins that call a category home, the most downloaded first, and marks newly listed ones as "+N new": `primary = tasks AND NOT removed order by downloads desc`.

More: `author ~ zsviczian` (everything by one author), `"daily note" OR "journal"` (text search).

## Common surprises

- **`~` looks for words, not a phrase.** `name ~ "side note"` finds SideNote, Side-Notes and also Mobile Sidebar Notes: each word is somewhere in the name; spaces, hyphens and case don't count. For the exact text use `=`, for words in that order a regex: `name ~ /side.?note/`.
- **`rise()` is empty under 1K downloads.** 10 → 30 isn't rising; use `gain()` for small plugins.
- **`milestone(10k)` is the day it reached 10K,** whatever it reached after: a plugin that went from 9K to 30K this month is in `milestone(10k) <= 30d` and in `milestone(25k) <= 30d`.
- **Updated doesn't leave new plugins out.** Add `NOT listed <= 14d` to its query if you want them only on New.
- **Ignored and hidden plugins stay out** of every list unless the query names `excluded` or `snoozed`.
- **Out of incubation is the same 30 days for everyone.** A year asleep earns no longer stay; the latest comeback is on top. Releases after the comeback don't take a plugin off.

## Help in the box

- **Suggestions** open as you type: fields, operators, your groups and statuses, authors. `Ctrl+Space` opens them anytime; an empty box offers your recent queries and these examples.
- **Hover** any word for what it means (a date function shows the date it stands for).
- **`?`** in the box opens Help on the Query guide (a click puts an item in the box); the **?** in the view's header opens Help on Quick start, with the Ready-made queries next to it.
- **`/`** focuses the box. **Esc** clears it in Basic mode and goes back to the page's query in Query mode.
- An empty list says which condition emptied it: "312 plugins without `downloads >= 1k`".
