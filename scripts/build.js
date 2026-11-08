// Builds main.js from src/*.js (joined in file-name order, one scope) with every locales/*.json embedded:
// Obsidian installs only main.js, manifest.json and styles.css, so neither can ship as separate files.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const MARKER = "/* LOCALES */ {}";

const dir = path.join(root, "locales");
const locales = Object.fromEntries(
  fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
    .map((f) => [path.basename(f, ".json"), JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))]),
);
if (!locales.en) throw new Error("locales/en.json is required: it is the fallback for every other language");

const srcDir = path.join(root, "src");
const source = fs.readdirSync(srcDir).filter((f) => f.endsWith(".js")).sort()
  .map((f) => fs.readFileSync(path.join(srcDir, f), "utf8")).join("");
if (!source.includes(MARKER)) throw new Error(`src/*.js have no ${MARKER} marker`);

const header = "// Built by scripts/build.js from src/*.js and locales/*.json; edit those files, not this one.\n";
fs.writeFileSync(path.join(root, "main.js"), header + source.replace(MARKER, () => JSON.stringify(locales, null, 2)));
console.log(`main.js built · locales: ${Object.keys(locales).join(", ")}`);
