# Community Radar

*English · [Türkçe](community-radar-bases.tr.md)*

Open the discovery view from the command palette (**Open Community Radar**). This note lists only the plugins you track; `groups`, `rating` and `note` can be edited right in the table.

> Change `Community Radar` in `file.inFolder(...)` if you use another notes folder.

```base
filters:
  and:
    - file.inFolder("Community Radar")
views:
  - type: table
    name: All
    order:
      - file.name
      - groups
      - status
      - rating
      - note
      - downloads
      - version
      - updated
      - reviewed
      - obsidian
      - github
  - type: table
    name: Rated 4★ and up
    filters:
      and:
        - rating >= 4
    order:
      - file.name
      - groups
      - status
      - rating
      - note
      - downloads
      - updated
      - obsidian
      - github
  - type: table
    name: Ungrouped
    filters:
      and:
        - groups.isEmpty()
    order:
      - file.name
      - rating
      - note
      - downloads
      - updated
      - obsidian
      - github
```
