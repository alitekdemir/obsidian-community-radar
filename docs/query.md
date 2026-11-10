# Query language

Every tab in Community Radar is a query. Press **Query** next to the box to see the tab's query and change it; **Basic** goes back to plain search and the **Filter** panel. A changed query shows a **● N changes** badge: it can replace the tab's own query (Settings → Page queries brings the default back) or be saved as a view.

```
downloads > 500 AND released < 30d AND group in ("Tasks", Calendar) AND NOT installed
order by gain30 desc
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
| `gain7`, `gain30` | number | downloads gained in 7 / 30 days |
| `rise7`, `rise30` | number | % growth in 7 / 30 days (only from 1K downloads up) |
| `milestone` | number | the highest milestone passed (1K, 5K, 10K, 25K, 50K, 100K) |
| `passed` | days | when it passed that milestone |
| `released` | days | days since the latest release, or a date |
| `age` | days | days in the list, or a date |
| `gap` | days | the pause before the latest release (incubation) |
| `rating` | number | your rating, 1–5 |
| `group` | list | a group in your note |
| `status` | list | the status in your note |
| `favorite` | yes/no | a favorite |
| `installed` | yes/no | installed in this vault |
| `tracked` | yes/no | tracked (has a note) |
| `new` | yes/no | listed in the last 14 days (Settings → New plugin period) |
| `busy` | yes/no | more than 9 update waves in 180 days (a wave: releases within a week) |
| `hatched` | yes/no | just out of incubation |
| `changed` | yes/no | tracked and released since you reviewed it |
| `dismissed` | yes/no | removed from Suggested |
| `ignored` | yes/no | ignored or hidden until its next release |

Field names are English in every language, so saved queries survive a language switch. Values are yours (your group names, your statuses).

## Operators

| Type | Operators |
|---|---|
| number, days | `=` `!=` `>` `>=` `<` `<=` `is empty` |
| text | `=` `!=` `~` (contains) `!~` (doesn't contain) `in (…)` `not in (…)` |
| list | `=` `!=` `in (…)` `not in (…)` `is empty` |
| yes/no | stands alone; `NOT` for no |

For days, `released < 30d` means "within the last 30 days" and `gap >= 60d` means "a pause of at least 60 days".

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
age >= lastSync()
```

## Examples

| Query | Finds |
|---|---|
| `released >= startOfMonth() order by downloads desc` | released this month, most downloaded first |
| `age < 30d AND gain30 >= 1k` | new and already rising |
| `gap >= 1y AND released < 30d` | back after a year or more |
| `tracked AND NOT installed` | tracked but not installed here |
| `tracked AND group is empty` | tracked without a group |
| `rise30 >= 50 AND downloads >= 1k order by rise30 desc` | growing fastest this month |
| `author ~ zsviczian` | everything by one author |

## Help in the box

- **Suggestions** open as you type: fields, operators, your groups and statuses, authors. `Ctrl+Space` opens them anytime; an empty box offers your recent queries and these examples.
- **Hover** any word for what it means (a date function shows the date it stands for).
- **`?`** opens this reference in short.
- **`/`** focuses the box. **Esc** clears it in Basic mode and goes back to the page's query in Query mode.
- An empty list says which condition emptied it: "312 plugins without `downloads >= 1k`".
