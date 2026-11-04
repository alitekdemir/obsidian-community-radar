# Community Radar

Open the discovery view from the command palette (**Open Community Radar**). This note lists only the plugins you track; `groups`, `favorite` and `note` can be edited right in the table.

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
      - favorite
      - note
      - downloads
      - version
      - updated
      - reviewed
      - obsidian
      - github
  - type: table
    name: By group
    groupBy:
      property: note.groups
      direction: ASC
    order:
      - file.name
      - favorite
      - note
      - downloads
      - updated
      - obsidian
      - github
  - type: table
    name: Starred
    filters:
      and:
        - favorite == true
    order:
      - file.name
      - groups
      - note
      - downloads
      - updated
      - obsidian
      - github
```
