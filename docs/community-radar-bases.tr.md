# Community Radar

*[English](community-radar-bases.md) · Türkçe*

Keşif görünümünü komut paletinden açın (**Community Radar'ı aç**). Bu not yalnızca kitaplığınızdaki eklentileri listeler; `groups`, `rating` ve `note` doğrudan tabloda düzenlenebilir.

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
    name: 4★ ve üzeri
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
    name: Grupsuz
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
