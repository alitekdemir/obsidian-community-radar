# Settings, commands and shortcuts

## Settings

Settings come in five tabs, one at a time:

| Tab | Settings |
|---|---|
| General | Language (Auto follows Obsidian's), where the view opens (Home or where you left off), New plugin period (days a plugin counts as new: the badge and the New card's `listed <= 14d`; default 14), keyboard shortcuts (see below), support |
| Notes | Notes folder, the heading above your own notes, the Bases table of your tracking notes (**Create** or reset), the status field and your statuses (add, reorder, remove) |
| Data | Sync frequency (Manual · Every 6 hours · **Daily** · Weekly; nothing is downloaded between syncs), **Sync now**, README updates (**When I open the note** · On every sync · Manually), the release history (**Download again**) |
| AI | Provider (Anthropic, OpenAI, Google, OpenRouter), API key from Obsidian's keychain, model, target language, README translation (*On request* or *Off*), the translation instructions (folded under *Advanced*), usage per model (requests, tokens, cost; Reset), saved translations |
| Hidden | How many plugins you ignored, hid until their next release, or took off Suggested; **Manage** opens that kind on the Hidden page |

A list's query is changed in the list itself (**Query**), not here.

## Commands

| Command | |
|---|---|
| Open Community Radar | Opens the view (also the ribbon icon) |
| Go to Home | Opens the view on Home; give it a hotkey to jump there from anywhere |
| Sync now (catalog, history, notes) | |
| Download the release history again | |
| Update README of this note | In a tracking note |
| Update READMEs of all tracking notes | |
| Translate the README of this note | Needs an AI provider |
| Show plugins similar to this note's plugin | In a tracking note |
| Create or reset the Bases view | |
| Suggest groups for ungrouped plugins | Needs an AI provider |
| Recent actions | The last 20 bulk actions, with Undo |

The view's ⋮ menu (top right): Sync now, Translate visible, Hidden, Download the release history again, Settings. The **⋯** button at the end of the list's toolbar: **Save as a view…**

## Keyboard shortcuts

On while *Settings → Keyboard shortcuts* is on and the Community Radar tab is active. The ⌨ icon in the toolbar lists them.

| Key | |
|---|---|
| `j` / `k` | move between rows |
| `Enter` | open the details |
| `f` | star |
| `g` | groups |
| `1` … `5` / `0` | rate / clear the rating |
| `s` | similar plugins |
| `r` | README |
| `t` | translate |
| `o` | open in Obsidian |
| `h` | hide until the next release |
| `x` | ignore (a toast offers Undo; restore on the Hidden page) |

Always on: `/` focuses the search box, `Ctrl+Space` opens suggestions, `Esc` clears the box (Basic) or goes back to the page's query (Query). Outside the box, `Esc` steps back one level: the Similar filter, then the open widget tab, then the list itself to Home.

## Selecting many

Hover a row and tick its box (`Shift`+click ticks a range). **Select the N shown**, then **Select all N in this list**, picks more. The bar at the bottom: Favorite, Rate, Add to group, Suggest groups, Mark reviewed, Hide, Ignore. Each asks before it runs and can be undone right away, or later from **Recent actions** (Undo skips plugins you changed since).
