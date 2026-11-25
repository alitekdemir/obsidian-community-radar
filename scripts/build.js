// Builds main.js from src/*.js (joined in file-name order, one scope) with locales/en.json embedded as fallback
// and LOCALE_NAMES for the language picker; other locales/*.json are fetched on demand from GitHub and cached locally.
// `--all-locales` (npm run build:dev) embeds every language instead: a local test build then shows your own
// locales/*.json edits without pushing them first. Releases are built without it.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const allLocales = process.argv.includes("--all-locales");
const NAMES_MARKER = "/* LOCALE_NAMES */ {}";
const LOCALES_MARKER = "/* LOCALES */ {}";

const dir = path.join(root, "locales");
const locales = Object.fromEntries(
  fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
    .map((f) => [path.basename(f, ".json"), JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))]),
);
if (!locales.en) throw new Error("locales/en.json is required: it is the fallback for every other language");
const localeNames = Object.fromEntries(Object.entries(locales).map(([code, data]) => [code, data["language.name"] || code]));

const srcDir = path.join(root, "src");
const source = fs.readdirSync(srcDir).filter((f) => f.endsWith(".js")).sort()
  .map((f) => fs.readFileSync(path.join(srcDir, f), "utf8")).join("");
for (const marker of [NAMES_MARKER, LOCALES_MARKER]) {
  if (!source.includes(marker)) throw new Error(`src/*.js have no ${marker} marker`);
}

const embedded = allLocales ? locales : { en: locales.en };
const header = `// Built by scripts/build.js from src/*.js and locales/${allLocales ? "*" : "en"}.json; edit those files, not this one.\n`;
const built = source
  .replace(NAMES_MARKER, () => JSON.stringify(localeNames))
  .replace(LOCALES_MARKER, () => JSON.stringify(embedded));
fs.writeFileSync(path.join(root, "main.js"), header + built);
const remote = Object.keys(localeNames).filter((c) => !(c in embedded)).join(", ") || "none";
console.log(`main.js built · embedded: ${Object.keys(embedded).join(", ")} · on-demand locales: ${remote}`);
