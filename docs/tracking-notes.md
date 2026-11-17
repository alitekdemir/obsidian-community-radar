# Tracking notes

*English · [Türkçe](tracking-notes.tr.md)*

Track a plugin (🔔), rate it (★), give it a status or add it to a group, and Community Radar writes a note for it in your notes folder (*Settings → Notes folder*). The note is yours: edit its properties in Obsidian, and the list follows. Click 🔔 again (or ⋯ → *Stop tracking*) and the note goes to Obsidian's trash, so you can bring it back from there; if it holds your groups, rating, status or notes, you're asked first. Plugins you rate 4★ or more gather under *Tracked → ★ 4+*.

## Properties

```yaml
---
plugin_id: homepage
groups:
  - startup
  - navigation
status: adopted           # optional; one of your statuses (Settings → Status field)
rating: 4                 # 1–5
note: try with the daily note
reviewed: 2026-10-31      # a release after this date marks the plugin NEW RELEASE
description: Open a note, base or workspace on startup, or set it for quick access later.
downloads: 1416257
version: 4.6.0
updated: 2026-10-25
obsidian: "[plugin](obsidian://show-plugin?id=homepage)"
github: "[github](https://github.com/mirnovov/obsidian-homepage)"
---
```

| Property | Who writes it |
|---|---|
| `plugin_id`, `description`, `downloads`, `version`, `updated`, `obsidian`, `github` | Community Radar, on each sync |
| `groups`, `status`, `rating`, `note`, `reviewed` | You (from the list, or by editing the note) |
| `translation_model`, `translation_tokens`, `translation_cost` | Community Radar, when it translates the README: the model, tokens and cost (USD) as the AI provider reported them; the cost only when the provider tells it (OpenRouter does) |

A plugin can be in several groups (`groups` is a list). `reviewed` is set when you mark a new release reviewed; a later release shows the plugin as **NEW RELEASE** in *Tracked*.

## Body

- **My notes** (the heading is set in *Settings → Heading of your notes*): yours, never touched.
- **README (your language)**: when you ask for a translation. A hidden fingerprint of the README it came from tells Community Radar when the README has changed since.
- **README**: owned by the plugin, between two hidden `%% community-radar:readme-start/end %%` comments. It's refreshed when you open the note (or on every sync, or only by command: *Settings → README updates*). Tags and wiki links in it are escaped so they don't leak into your vault; code blocks stay as they are.

![A tracking note: properties, My notes and the plugin's README](images/Radar_4-Note.png)

## Bases view

*Settings → Reset Bases view → Create* (or the command *Create or reset the Bases view*) writes a `.base` file that lists all your tracking notes as a table you can sort, filter and edit in place.

![Tracked plugins in a Bases table, editable in place](images/Radar_5-Bases_Note.png)

## AI, optional

With a provider and key in *Settings → AI*, Community Radar can:

- **Translate** a description (click it on a row, a card or in the details window, or *Translate visible* in the view's ⋮ menu) or a README (in the details window, or the command *Translate the README of this note*). A README translation shows its estimated cost first, and the bottom of the details window shows what it took. Translations are saved and reused: a README's goes into its note, or, for a plugin you don't track, into the plugin's cache; tracking it later moves it into the new note, with no second bill. A yellow dot on the translation tab means the README has changed since.
- **Suggest groups** for the rows you select (the **Group with AI** button in the selection bar), or for ungrouped tracked plugins (command). Click a suggestion to add it.

You can rewrite the instructions sent to the model in *Settings → AI*.
