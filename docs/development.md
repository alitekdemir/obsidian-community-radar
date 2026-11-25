# Development and translating

*English · [Türkçe](development.tr.md)*

## Building

`src/*.js` is the plugin, joined in file-name order; `npm run build` embeds `locales/en.json` (the fallback) and the language list into `main.js`, while other `locales/*.json` files are fetched from GitHub on demand and cached locally. There are no runtime dependencies. Tests run offline in Node with a small fake of the Obsidian API:

```sh
npm install
npm test        # builds main.js first
```

To try a change in a vault, run `npm run build:dev` (it embeds every `locales/*.json`, so your own translation edits show without pushing them first) and copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/plugin-radar/`, then reload the plugin.

## Between releases

Changes go to `main` without a release: only a tag publishes one. Each change adds a line under `## Unreleased` at the top of `CHANGELOG.md` and leaves the version alone — Obsidian reads `manifest.json` on `main` as the latest version, so a version with no release of the same tag offers users an update they can't download.

## Releasing

1. Set the new version in `manifest.json`, `package.json`, `package-lock.json` and `versions.json`.
2. Rename `## Unreleased` in `CHANGELOG.md` to `## <version>`.
3. Push to `main`, then push a tag with the same version, without a `v` (e.g. `0.10.1`).

The [release workflow](../.github/workflows/release.yml) checks that the tag matches `manifest.json`, runs the tests, builds and attests `main.js`, `manifest.json` and `styles.css`, and publishes the release with that version's changelog section as its notes.

## Translating

All interface text lives in [`locales/`](../locales), one JSON file per language. To add yours:

1. Copy `locales/en.json` to `locales/<code>.json`, using the code Obsidian uses for your language (e.g. `de`, `fr`, `pt-BR`).
2. Set `language.name` (your language's own name, e.g. `Deutsch`) and `locale` (for number and date formats, e.g. `de-DE`), then translate the values. Keep `{placeholders}` exactly as they are.
3. Plural text is an object picked by `{n}`: `{"one": "{n} day ago", "other": "{n} days ago"}`. Use your language's [plural forms](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html) (`one`, `few`, `many`, `other`…); `other` is required. A language without plurals can use a plain string.
4. Run `npm install && npm test` (it checks every key and placeholder) and open a pull request.

Missing text falls back to English, so a partial translation still works. The new language appears in *Settings → Language* on its own.

The interface speaks English, Türkçe, Deutsch, Русский, 日本語 and 简体中文 (`zh-TW` falls back to Simplified Chinese). `en.json` is the source: every other file is translated from it. German, Russian, Japanese and Chinese are machine-assisted; corrections are welcome. A new key goes into every `locales/*.json` in the same commit; the test fails otherwise. `help.guideFile` names the query guide the Help window links to: a language with a translated guide (`docs/query.<code>.md`) points to it, the others keep `query.md`.

### Kept in English

- **Names:** Community Radar, Obsidian, GitHub, README, Markdown, JSON, API, providers and models.
- **Query syntax:** field names (`downloads`, `gain(30d)`…), `AND` `OR` `NOT`, `order by`, `asc` / `desc`, `in`, `is empty`, `true` / `false`, date functions and units (`30d`, `10k`). Saved queries keep working after a language switch.
- **Note properties** (`plugin_id`, `groups`, `status`…), file paths and keys (`j`, `Esc`, `Ctrl+Space`).

### Terms

Obsidian's own words come from its [official translations](https://github.com/obsidianmd/obsidian-translations), so the plugin reads like Obsidian:

| en | tr | de | ru | ja | zh |
|---|---|---|---|---|---|
| plugin | eklenti | Erweiterung | плагин | プラグイン | 插件 |
| Community plugins | Topluluk eklentileri | Externe Erweiterungen | Сторонние плагины | コミュニティプラグイン | 第三方插件 |
| vault | kasa | Vault | хранилище | 保管庫 | 仓库 |
| note | not | Notiz | заметка | ノート | 笔记 |
| Bases | Bases | Basen | Базы данных | ベース | 数据库 |
| keychain | anahtar deposu | Schlüsselbund | связка ключей | キーチェーン | 钥匙串 |
| command palette | komut paleti | Befehlspalette | палитра команд | コマンドパレット | 命令面板 |
| release | sürüm | Version | релиз | リリース | 版本 / 发布 |
| library, add to / remove from library | kitaplık, kitaplığa ekle / kitaplıktan çıkar | Bibliothek, zur Bibliothek hinzufügen / aus der Bibliothek entfernen | библиотека, в библиотеку / убрать из библиотеки | ライブラリ, ライブラリに追加 / 削除 | 插件库, 加入 / 移出插件库 |
| incubation, hatched | kuluçka, kuluçkadan çıkış | Inkubation, aus der Inkubation | инкубация, выход из инкубации | 休眠期間, 休眠明け | 休眠期, 复苏 |
| query, view | sorgu, görünüm | Abfrage, Ansicht | запрос, вид | クエリ, ビュー | 查询, 视图 |
| AI | yapay zekâ | KI | ИИ | AI | AI |
