// ─── README and note body ───────────────────────────────────────────────────
/** What Obsidian treats as a tag: letters/digits/_-/ with at least one non-digit (`#123` is not a tag). */
const TAG = /(^|[\s>(])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

/** Escapes `#tags` and `[[links]]` in plain text; invisible in reading view. */
function escapeText(text) {
  return text
    .replace(TAG, (match, before, tag, offset) =>
      (before === "(" && text[offset - 1] === "]" ? match : `${before}\\#${tag}`))  // `](#section)` is a link target
    .replace(/\[\[/g, "\\[\\[");
}

/** Code blocks (indented ones too) and inline code are left untouched. */
function escapeOutsideCode(markdown) {
  let fence = null;
  return markdown.split("\n").map((line) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return line;
    }
    if (marker) { fence = marker[1]; return line; }
    if (/^( {4}|\t)/.test(line) && !/^\s*([-*+]|\d+[.)])\s/.test(line)) return line;  // indented code
    return line.split(/(`+[^`]*`+)/).map((chunk, i) => (i % 2 ? chunk : escapeText(chunk))).join("");
  }).join("\n");
}

/** An image on a GitHub page (`github.com/o/r/blob/…`) → the file itself; other URLs unchanged. */
function rawImage(url) {
  return url.replace(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\//i, `${RAW}/$1/`);
}

/** Points images on GitHub pages to the files in notes written before 0.8.1; touches no link. */
function migrateImages(content) {
  return content
    .replace(/(!\[[^\]]*\]\(\s*<?)([^)\s>]+)/g, (all, head, url) => head + rawImage(url))
    .replace(/(<img\b[^>]*?\bsrc=)(["'])([^"']+)\2/gi, (all, head, q, url) => `${head}${q}${rawImage(url)}${q}`);
}

/** Points relative images and links to GitHub; images on a GitHub page (`/blob/`) to the file itself. */
function absolutizeLinks(markdown, repo) {
  const rawBase = `${RAW}/${repo}/HEAD/`;
  const blobBase = `https://github.com/${repo}/blob/HEAD/`;
  const isRelative = (url) => url && !/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url);
  const join = (base, url) => base + url.replace(/^\.?\//, "");
  const image = (url) => isRelative(url) ? join(rawBase, url) : rawImage(url);
  return markdown
    .replace(/(!?)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?((?:\s+"[^"]*")?)\s*\)/g, (all, bang, text, url, title) =>
      bang ? `![${text}](${image(url)}${title})` : isRelative(url) ? `[${text}](${join(blobBase, url)}${title})` : all)
    .replace(/(<img\b[^>]*?\bsrc=)(["'])([^"']+)\2/gi, (all, head, q, url) => `${head}${q}${image(url)}${q}`)
    .replace(/(<a\b[^>]*?\bhref=)(["'])([^"']+)\2/gi, (all, head, q, url) =>
      isRelative(url) ? `${head}${q}${join(blobBase, url)}${q}` : all);
}

/** The README section of a note, markers included. */
function readmeSection(readme, plugin, now) {
  const version = plugin.version ? `v${plugin.version}` : t("readme.noVersion");
  const meta = t("readme.meta", { repo: plugin.repo, version, date: dayString(now) });
  const body = readme == null ? t("readme.failed") : escapeOutsideCode(absolutizeLinks(readme.trim(), plugin.repo));
  return `${README_START}\n${meta}\n\n${body}\n${README_END}`;
}

/** The README text inside a note (between the markers, without its "README · repo · version" line); null if none. */
function readmeText(content) {
  const a = content.indexOf(README_START);
  const b = content.indexOf(README_END);
  if (a === -1 || b < a) return null;
  const inner = content.slice(a + README_START.length, b).trim();
  return inner.split("\n").slice(1).join("\n").trim() || null;
}

/** The note's README translation: {version, body} (version: the README it was made from) or null. */
function readmeTranslation(content) {
  const a = content.indexOf(README_TR_START);
  const b = content.indexOf(README_TR_END);
  if (a === -1 || b < a) return null;
  const [meta, ...body] = content.slice(a + README_TR_START.length, b).trim().split("\n");
  return { version: meta.match(/· v(\S+) ·/)?.[1] ?? null, body: body.join("\n").trim() };
}

/** Puts the translation section in the note: replaces the old one, or goes right above the original README. */
function replaceReadmeTranslation(content, section, heading) {
  const block = `${README_TR_START}\n${section}\n${README_TR_END}`;
  const a = content.indexOf(README_TR_START);
  const b = content.indexOf(README_TR_END);
  if (a !== -1 && b > a) return content.slice(0, a) + block + content.slice(b + README_TR_END.length);
  const insert = `# ${heading}\n${block}\n\n`;
  const at = content.search(/^# README[ \t]*$/m);
  if (at !== -1) return content.slice(0, at) + insert + content.slice(at);
  const start = content.indexOf(README_START);
  return start !== -1 ? content.slice(0, start) + insert + content.slice(start) : `${content.trimEnd()}\n\n${insert}`;
}

/** A README cut before headings into requests of at most `max` characters (a longer section stays whole). */
function markdownChunks(markdown, max = README_CHUNK) {
  const chunks = [];
  let current = "";
  for (const part of markdown.split(/\n(?=#{1,3} )/)) {
    if (current && current.length + part.length + 1 > max) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n${part}` : part;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Rough request size of translating `text`: tokens in and out (~4 characters a token), and the cost when the price is known. */
function translationEstimate(text, price) {
  const tokens = Math.ceil(text.length / 4);
  const cost = price ? (tokens * (price.input || 0) + tokens * 1.2 * (price.output || 0)) / 1e6 : null;
  return { chars: text.length, tokens: tokens * 2, cost };
}

function readmePrompt(markdown, targetLanguage) {
  return [
    `Translate this part of an Obsidian plugin's README (Markdown) into ${targetLanguage}.`,
    "Keep the Markdown exactly: headings, lists, tables, links, image URLs and HTML tags.",
    "Don't translate code blocks, inline code, commands, settings keys or product names.",
    "Reply with ONLY the translated Markdown, nothing before or after it.",
    "",
    markdown,
  ].join("\n");
}

/** Version the note's README was fetched for ("1.2.0"), read from its meta line; null when unknown. */
function readmeVersion(content) {
  const start = content.indexOf(README_START);
  if (start === -1) return null;
  const meta = content.slice(start + README_START.length).trimStart().split("\n", 1)[0];
  return meta.match(/· v(\S+) ·/)?.[1] ?? null;
}

/** Replaces the README section; appends one when the markers are missing. Nothing else is touched. */
function replaceReadme(content, section) {
  const start = content.indexOf(README_START);
  const end = content.indexOf(README_END, start);
  if (start === -1 || end === -1) return `${content.replace(/\s*$/, "")}\n\n# README\n${section}\n`;
  return content.slice(0, start) + section + content.slice(end + README_END.length);
}

/** What a sync brought: plugins that weren't in the previous catalog, and plugins with a newer release. */
function catalogDelta(before, after) {
  const previous = new Map(before.map((p) => [p.id, p]));
  let added = 0;
  let updated = 0;
  for (const p of after) {
    const old = previous.get(p.id);
    if (!old) added++;
    else if (p.updated && p.updated > (old.updated || 0)) updated++;
  }
  return { added, updated };
}

/** Body of a new tracking note (properties are written separately with processFrontMatter). */
function noteBody(plugin, heading = t("note.myNotes")) {
  return `# ${heading}\n\n\n# README\n${README_START}\n${README_END}\n`;
}

/** Notes made before 0.9 start with the description; it lives in the `description` property now. */
function stripDescription(content, description) {
  if (!description) return content;
  const fm = content.match(/^---\n[\s\S]*?\n---\n/);
  const head = fm ? fm[0] : "";
  const body = content.slice(head.length);
  const line = `${description.trim()}\n\n`;
  const start = body.match(/^\n*/)[0].length;
  return body.startsWith(line, start) ? head + body.slice(0, start) + body.slice(start + line.length) : content;
}

/** Turns the H2 headings of 0.1 notes into H1; touches no other line. */
function migrateHeadings(content) {
  return content
    .replace(/^## Notlarım[ \t]*$/m, "# Notlarım")
    .replace(/^## README[ \t]*\n(?=<!-- plugin-tracker:readme-start -->)/m, "# README\n");
}

/** Swaps the README markers of notes made before 0.6.1 for hidden Obsidian comments. */
function migrateMarkers(content) {
  return content.replace(LEGACY_README_START, README_START).replace(LEGACY_README_END, README_END);
}

/** The Bases file listing the tracking notes in `folder` (written by "Create / reset Bases view"). */
function baseFile(folder) {
  const q = JSON.stringify;  // a JSON string is a valid YAML string
  const links = ["obsidian", "github"];
  const view = (name, extra, columns) => [
    "  - type: table",
    `    name: ${q(name)}`,
    ...extra,
    "    order:",
    ...["file.name", ...columns, ...links].map((c) => `      - ${c}`),
  ];
  return [
    "filters:",
    "  and:",
    `    - file.inFolder(${q(folder)})`,
    "views:",
    ...view(t("base.all"), [], ["groups", "favorite", "status", "rating", "note", "downloads", "version", "updated", "reviewed"]),
    ...view(t("base.starred"), ["    filters:", "      and:", "        - favorite == true"], ["groups", "status", "rating", "note", "downloads", "updated"]),
    ...view(t("base.ungrouped"), ["    filters:", "      and:", "        - groups.isEmpty()"], ["favorite", "note", "downloads", "updated"]),
    "",
  ].join("\n");
}

/** Properties that come from the catalog; refreshed on every data refresh. */
function sourceFields(plugin) {
  return {
    description: plugin.description || null,
    downloads: plugin.downloads ?? null,
    version: plugin.version ?? null,
    updated: plugin.updated ? dayString(plugin.updated) : null,
    obsidian: `[plugin](obsidian://show-plugin?id=${encodeURIComponent(plugin.id)})`,
    github: plugin.repo ? `[github](https://github.com/${plugin.repo})` : null,
  };
}

/** A note's groups: the `groups` list, plus a 0.6-style `group` text until it's migrated. */
function groupsOf(fm) {
  const raw = [...(Array.isArray(fm.groups) ? fm.groups : fm.groups ? [fm.groups] : []), ...(fm.group ? [fm.group] : [])];
  return uniqueNames(raw.map((g) => String(g ?? "")));
}

/** The same names, in any order. */
function sameNames(a, b) {
  return a.length === b.length && a.every((n) => b.includes(n));
}

/** Trimmed, non-empty names without case-insensitive duplicates; the first spelling wins. */
function uniqueNames(names) {
  const seen = new Set();
  return names.map((n) => n.replace(/\s+/g, " ").trim()).filter((n) => {
    const key = n.toLocaleLowerCase();
    if (!n || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Tracking record from a note's frontmatter (only notes with `plugin_id`). */
function noteFromFrontmatter(path, fm) {
  if (!fm || !fm.plugin_id) return null;
  return {
    path,
    id: String(fm.plugin_id),
    groups: groupsOf(fm),
    favorite: fm.favorite === true,
    status: typeof fm.status === "string" ? fm.status.trim() : "",   // shown only if it's one of your statuses
    rating: Number.isInteger(fm.rating) && fm.rating >= 1 && fm.rating <= 5 ? fm.rating : 0,
    note: fm.note ? String(fm.note) : "",
    reviewed: fm.reviewed ? String(fm.reviewed).slice(0, 10) : "",
    updated: fm.updated ? String(fm.updated).slice(0, 10) : "",
  };
}

