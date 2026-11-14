# Community Radar

*[English](community-radar-bases.md) · Türkçe*

Keşif görünümünü komut paletinden açın (**Community Radar'ı aç**). Bu not yalnızca takip ettiğiniz eklentileri listeler; `groups`, `favorite` ve `note` doğrudan tabloda düzenlenebilir.

> Başka bir not klasörü kullanıyorsanız `file.inFolder(...)` içindeki `Community Radar`'ı değiştirin.

```base
filters:
  and:
    - file.inFolder("Community Radar")
views:
  - type: table
    name: Tümü
    order:
      - file.name
      - groups
      - favorite
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
    name: Favoriler
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
  - type: table
    name: Grupsuz
    filters:
      and:
        - groups.isEmpty()
    order:
      - file.name
      - favorite
      - note
      - downloads
      - updated
      - obsidian
      - github
```
