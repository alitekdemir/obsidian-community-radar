# Query language

Every list in Community Radar is a query: *All*, and every card on Home (*New*, *Updated*, *Incubation*, *Suggested*, your saved views…). A card opens its list; press **Query** next to the box to see its query and change it; **Basic** goes back to plain search and the **Filter** panel. A changed query shows a **● N changes** badge: save it as a view (a card of its own on Home), or, for a built-in card, over the card's own query (its **⋮ › Edit the query**; **Reset the query to default** brings the default back once you saved your own).

```
downloads > 500 AND released < 30d AND group in ("Tasks", Calendar) AND NOT installed
order by gain(30d) desc
```

## Clauses

A clause is `field operator value`. Join clauses with `AND`, `OR` and `NOT`, group them with `( )`. A yes/no field stands alone: `installed`, `NOT tracked`. A space between clauses also means AND. Line breaks and extra spaces don't matter. In Query mode a word that isn't a clause is an error; put a text search in quotes: `"daily note"`.

`order by field desc` (or `asc`) at the end sorts the list.

## Fields

| Field | Type | Means |
|---|---|---|
| `text` | text | name, author, id and description together |
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
| `favorite` | yes/no | a favorite |
| `installed` | yes/no | installed in this vault |
| `tracked` | yes/no | tracked (has a note) |
| `unreviewed` | yes/no | tracked, with a release since you reviewed it |
| `dismissed` | yes/no | removed from Suggested |
| `excluded` | yes/no | ignored by you |
| `snoozed` | yes/no | hidden until its next release |
| `removed` | yes/no | taken off the official list by Obsidian; only installed ones show up, and only when the query names `removed` |

Field names are English in every language, so saved queries survive a language switch. Values are yours (your group names, your statuses).

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
gain(21d) >= 500 AND NOT tracked
milestone(10k) <= 30d order by downloads desc
releases(180d) > 9
```

## Operators

| Type | Operators |
|---|---|
| number, days | `=` `!=` `>` `>=` `<` `<=` `is empty` |
| text | `=` `!=` `~` (contains) `!~` (doesn't contain) `in (…)` `not in (…)` |
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
3. **New to you:** `AND NOT tracked`, then the order: `order by rise(30d) desc`

```
downloads <= 10k AND released <= 30d AND rise(30d) >= 20 AND NOT tracked
order by rise(30d) desc
```

If the list comes out empty, the status line says which condition emptied it.

## Ready-made queries

The same list as **+ Add widget** on Home and the empty query box. **Add** puts one on Home as a saved view; **Try in query** opens it in the list to change first.

| Name | Query | Finds |
|---|---|---|
| Updated this month | `released >= startOfMonth() order by downloads desc` | released since the 1st |
| Fast starters | `listed <= 60d AND downloads >= 1k AND NOT tracked order by downloads desc` | listed in the last 2 months, past 1K already |
| Hidden gems | `downloads <= 10k AND released <= 30d AND rise(30d) >= 20 AND NOT tracked order by rise(30d) desc` | 1K–10K, updated this month, growing 20%+ |
| Truly back | `incubated >= 180d AND hatched <= 30d AND NOT tracked order by hatched desc` | back this month after 6+ months |
| Fresh releases of popular plugins | `downloads >= 50k AND released <= 14d AND NOT tracked order by released desc` | changes that reach many people |
| Just passed 10K | `milestone(10k) <= 30d order by downloads desc` | reached 10K this month, whatever they reached after |
| Actively developed | `releases(30d) >= 3 AND downloads >= 1k AND NOT tracked order by gain(30d) desc` | 3+ updates this month |
| Abandoned installs | `installed AND released >= 1y order by released asc` | installed, no update for a year |
| To try | `tracked AND NOT installed order by rating desc` | tracked, not installed here |
| Ungrouped | `tracked AND group is empty order by name asc` | tracked without a group |
| Unrated | `tracked AND rating is empty order by downloads desc` | tracked, not rated yet |
| Sleeping tracked plugins | `tracked AND released >= 1y order by released asc` | tracked, no release for a year |

More: `author ~ zsviczian` (everything by one author), `"daily note" OR "journal"` (text search).

## Common surprises

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
