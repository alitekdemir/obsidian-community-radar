# Development and translating

## Building

`src/*.js` is the plugin, joined in file-name order; `npm run build` also embeds `locales/*.json` into the `main.js` Obsidian loads. There are no runtime dependencies. Tests run offline in Node with a small fake of the Obsidian API:

```sh
npm install
npm test        # builds main.js first
```

To try a change in a vault, run `npm run build` and copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/plugin-radar/`, then reload the plugin.

## Releasing

1. Set the new version in `manifest.json`, `package.json`, `package-lock.json` and `versions.json`.
2. Add a `## <version>` section to `CHANGELOG.md`.
3. Push to `main`, then push a tag with the same version, without a `v` (e.g. `0.10.1`).

The [release workflow](../.github/workflows/release.yml) checks that the tag matches `manifest.json`, runs the tests, builds and attests `main.js`, `manifest.json` and `styles.css`, and publishes the release with that version's changelog section as its notes.

## Translating

All interface text lives in [`locales/`](../locales), one JSON file per language. To add yours:

1. Copy `locales/en.json` to `locales/<code>.json`, using the code Obsidian uses for your language (e.g. `de`, `fr`, `pt-BR`).
2. Set `language.name` (your language's own name, e.g. `Deutsch`) and `locale` (for number and date formats, e.g. `de-DE`), then translate the values. Keep `{placeholders}` exactly as they are.
3. Plural text is an object picked by `{n}`: `{"one": "{n} day ago", "other": "{n} days ago"}`. Use your language's [plural forms](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html) (`one`, `few`, `many`, `other`…); `other` is required. A language without plurals can use a plain string.
4. Run `npm install && npm test` (it checks every key and placeholder) and open a pull request.

Missing text falls back to English, so a partial translation still works. The new language appears in *Settings → Language* on its own.

Query field names (`downloads`, `gain30`…) stay English in every language, so saved queries keep working after a language switch.
