// ─── README and note body ───────────────────────────────────────────────────
/** What Obsidian treats as a tag: letters/digits/_-/ with at least one non-digit (`#123` is not a tag). */
const TAG = /(^|[\s>(])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

/**
 * Walks lines of `markdown` tracking fenced code blocks (backticks or tildes of matching char/length; closing
 * fence may not carry trailing info) and indented code blocks. Calls `fn(line, index, inCode)`.
 */
function mapMarkdownLines(markdown, fn) {
  let fence = null;
  return markdown.split("\n").map((line, i) => {
    const raw = line.endsWith("\r") ? line.slice(0, -1) : line;
    const cr = line.endsWith("\r") ? "\r" : "";
    const open = raw.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const close = new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`);
      if (close.test(raw)) fence = null;
      return fn(raw, i, true) + cr;
    }
    if (open) {
      // single-line fence like ```code``` does not open a multi-line block
      const rest = raw.slice(open[0].length);
      if (!(open[1][0] === "`" && rest.includes(open[1]))) fence = open[1];
      return fn(raw, i, true) + cr;
    }
    const indented = /^( {4}|\t)/.test(raw) && !/^\s*([-*+]|\d+[.)])\s/.test(raw);
    return fn(raw, i, indented) + cr;
  }).join("\n");
}

/** Applies `transform` only to segments outside inline backtick spans (handles multi-backtick spans). */
function mapOutsideInlineCode(line, transform) {
  let out = "";
  let pos = 0;
  const re = /(`+)([\s\S]*?)\1/g;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > pos) out += transform(line.slice(pos, m.index));
    out += m[0];
    pos = re.lastIndex;
  }
  if (pos < line.length) out += transform(line.slice(pos));
  return out;
}

/** Escapes `#tags` and `[[links]]` in plain text; invisible in reading view. */
function escapeText(text) {
  if (/^\s*\[[^\]]+\]:\s/.test(text)) return text.replace(/\[\[/g, "\\[\\[");   // reference link definitions
  return text
    .replace(TAG, (match, before, tag, offset) => {
      if (before === "(" && text[offset - 1] === "]") return match;   // `](#section)` is a link target
      if (before === ">" && text.slice(Math.max(0, offset - 32), offset).includes("<")) return match;   // HTML hex color / tag content
      return `${before}\\#${tag}`;
    })
    .replace(/\[\[/g, "\\[\\[");
}

/** Code blocks (indented ones too) and inline code are left untouched. */
function escapeOutsideCode(markdown) {
  return mapMarkdownLines(markdown, (line, _, inCode) => (inCode ? line : mapOutsideInlineCode(line, escapeText)));
}

/** An image on a GitHub page (`github.com/o/r/blob/…`) → the file itself; other URLs unchanged. */
function rawImage(url) {
  return url.replace(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\//i, `${RAW}/$1/`);
}

/** Points images on GitHub pages to the files in notes written before 0.8.1; touches no link or code block. */
function migrateImages(content) {
  return mapMarkdownLines(content, (line, _, inCode) => (inCode ? line : mapOutsideInlineCode(line, (seg) => seg
    .replace(/(!\[[^\]]*\]\(\s*<?)([^)\s>]+)/g, (all, head, url) => head + rawImage(url))
    .replace(/(<img\b[^>]*?\bsrc=)(["'])([^"']+)\2/gi, (all, head, q, url) => `${head}${q}${rawImage(url)}${q}`))));
}

/** Points relative images and links to GitHub; images on a GitHub page (`/blob/`) to the file itself. */
// ─── English source ───────────────────────────────────────────────────────────
// A README in another language (mostly Chinese, Japanese, Russian, Korean) often links an English version
// (README_en.md) or holds an English section: the AI translates English best. The same rules as
// scripts/profiles/profiler.py, which makes the Overview from it.
const FOREIGN_README = 0.3;         // more of the letters than this outside Latin: not an English README
const MIN_ENGLISH_LETTERS = 300;    // a shorter "English" part is a stub, not a source
const CODE_FENCE = /^(```|~~~)[\s\S]*?^\1/gm;
const EN_FILE = /^readme[._-]?(en|en[-_](us|gb)|english)\.md$/i;   // README_en.md, readme.EN.md …
const EN_LABEL = /\b(english|en)\b/i;
const EN_HEADING = /^(en|(\w+ )?english( \w+){0,2})$/i;          // EN, English, In English, English summary …

/** Letters in a text, code blocks left out: [all, Latin, in `script` (see scriptOfLanguage)]. */
function letterCounts(text, script = null) {
  const body = String(text ?? "").replace(CODE_FENCE, "");
  let all = 0, latin = 0, own = 0;
  for (const ch of body) {
    if (!/\p{L}/u.test(ch)) continue;
    all++;
    if (/\p{Script=Latin}/u.test(ch)) latin++;
    else if (script && matchesScript(ch, script)) own++;
  }
  return [all, latin, own];
}

/** The share of letters outside the Latin script (0 for no letters). */
function foreignShare(text) {
  const [all, latin] = letterCounts(text);
  return all ? 1 - latin / all : 0;
}

/** English enough to translate from: mostly Latin letters, and enough of them. */
function isEnglishText(text) {
  const [all, latin] = letterCounts(text);
  return latin >= MIN_ENGLISH_LETTERS && 1 - latin / all <= FOREIGN_README;
}

/** Safe decodeURI that never throws URIError on malformed percent-sequences. */
function safeDecodeURI(text) {
  try { return decodeURI(text); } catch { return text; }
}

/** Encodes raw non-ASCII path segments without double-encoding existing percent escapes (e.g. %23). */
function safeEncodePath(path) {
  return path.split("/").map((seg) => seg.replace(/[^\x20-\x7e]|[\s#?]/g, (ch) => encodeURIComponent(ch))).join("/");
}

const isRelativeUrl = (url) => Boolean(url) && !/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url);

/**
 * The raw URL of the English README this one links to (README_en.md, or a .md labelled English): a GitHub page
 * becomes its raw file, a relative link is read from the default branch, other sites are left alone.
 */
function englishLink(markdown, repo) {
  const links = [...markdown.matchAll(/\[([^\]]*)\]\(<?([^)\s>]+)>?[^)]*\)/g)].map((m) => [m[1], m[2]])
    .concat([...markdown.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((m) => [m[2], m[1]]));
  for (const [label, target] of links) {
    const path = target.split("#")[0].split("?")[0];
    const name = path.split("/").pop();
    if (!/\.md$/i.test(name) || /^readme\.md$/i.test(name)) continue;
    if (!EN_FILE.test(name) && !EN_LABEL.test(label.replace(/<[^>]+>/g, ""))) continue;
    const blob = path.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/i);
    if (blob) return `${RAW}/${blob[1]}/${safeEncodePath(blob[2])}`;
    if (path.startsWith(`${RAW}/`)) return path;
    if (isRelativeUrl(path)) return `${RAW}/${repo}/HEAD/${safeEncodePath(path.replace(/^\.?\//, ""))}`;   // a folder may be 图片
  }
  return null;
}

/** The README's own English part: a heading named English to the next heading of its level or above; null if none or too short. */
function englishSection(markdown) {
  const lines = markdown.split("\n");
  let fence = null, start = null, level = 0;
  const check = (end) => { const s = lines.slice(start, end).join("\n"); return isEnglishText(s) ? s : null; };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, "");
    const open = raw.match(/^\s*(`{3,}|~{3,})/);
    if (fence) { if (new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`).test(raw)) fence = null; continue; }
    if (open) { if (!(open[1][0] === "`" && raw.slice(open[0].length).includes(open[1]))) fence = open[1]; continue; }
    const heading = raw.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (!heading) continue;
    if (start != null && heading[1].length <= level) {
      const found = check(i);
      if (found) return found;
      start = null;
    }
    if (start == null && EN_HEADING.test(heading[2].replace(/[^\p{L}\p{N}_ ]/gu, "").trim())) [start, level] = [i + 1, heading[1].length];
  }
  return start == null ? null : check(lines.length);
}

function absolutizeLinks(markdown, repo) {
  const rawBase = `${RAW}/${repo}/HEAD/`;
  const blobBase = `https://github.com/${repo}/blob/HEAD/`;
  const join = (base, url) => base + url.replace(/^\.?\//, "");
  const image = (url) => (isRelativeUrl(url) ? join(rawBase, url) : rawImage(url));
  const rewrite = (seg) => seg
    .replace(/(!?)\[((?:[^\[\]]|\[[^\]]*\])*)\]\(\s*<?([^)\s>]+)>?((?:\s+"[^"]*")?)\s*\)/g, (all, bang, text, url, title) =>
      bang ? `![${text}](${image(url)}${title})` : isRelativeUrl(url) ? `[${text}](${join(blobBase, url)}${title})` : all)
    .replace(/(<img\b[^>]*?\bsrc=)(["'])([^"']+)\2/gi, (all, head, q, url) => `${head}${q}${image(url)}${q}`)
    .replace(/(<a\b[^>]*?\bhref=)(["'])([^"']+)\2/gi, (all, head, q, url) =>
      isRelativeUrl(url) ? `${head}${q}${join(blobBase, url)}${q}` : all);
  return mapMarkdownLines(markdown, (line, _, inCode) => (inCode ? line : mapOutsideInlineCode(line, rewrite)));
}

/** A README as fetched from GitHub → as shown and kept: links pointed to GitHub, tags and wikilinks escaped. */
function readmeBody(readme, repo) {
  return readme == null ? t("readme.failed") : escapeOutsideCode(absolutizeLinks(readme.trim(), repo));
}

/** The README section of a note, markers included. */
function readmeSection(readme, plugin, now) {
  const version = plugin.version ? `v${plugin.version}` : t("readme.noVersion");
  const meta = t("readme.meta", { repo: plugin.repo, version, date: dayString(now) });
  return `${README_START}\n${meta}\n\n${readmeBody(readme, plugin.repo)}\n${README_END}`;
}

/** A short fingerprint of a text (FNV-1a, 8 hex digits): tells whether a README changed since it was translated. */
function textHash(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The README text inside a note (between the markers, without its "README · repo · version" line); null if none. */
function readmeText(content) {
  const a = content.indexOf(README_START);
  const b = a === -1 ? -1 : content.indexOf(README_END, a + README_START.length);
  if (a === -1 || b === -1) return null;
  const inner = content.slice(a + README_START.length, b).trim();
  return inner.split(/\r?\n/).slice(1).join("\n").trim() || null;
}

/**
 * The note's README translation: {hash, date, body} or null. `hash`: textHash of the README it was made from (kept
 * hidden in its meta line); null in translations made before 0.12, which then never count as outdated.
 */
function readmeTranslation(content) {
  const a = content.indexOf(README_TR_START);
  const b = a === -1 ? -1 : content.indexOf(README_TR_END, a + README_TR_START.length);
  if (a === -1 || b === -1) return null;
  const [meta, ...body] = content.slice(a + README_TR_START.length, b).trim().split(/\r?\n/);
  return { hash: meta.match(/%% src:(\w+) %%/)?.[1] ?? null, date: meta.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null, body: body.join("\n").trim() };
}

/** The translation's section text: its meta line (the source README's fingerprint hidden in it), then the body. */
function translationSection({ lang, version, hash, date, body }) {
  return `${t("readme.translationMeta", { lang, version: version ? `v${version}` : "–", date })} %% src:${hash} %%\n\n${body}`;
}

/** Puts the translation section in the note: replaces the old one, or goes right above the original README. */
function replaceReadmeTranslation(content, section, heading) {
  const block = `${README_TR_START}\n${section}\n${README_TR_END}`;
  const a = content.indexOf(README_TR_START);
  const b = a === -1 ? -1 : content.indexOf(README_TR_END, a + README_TR_START.length);
  if (a !== -1 && b !== -1) return content.slice(0, a) + block + content.slice(b + README_TR_END.length);
  const insert = `# ${heading}\n${block}\n\n`;
  const start = content.indexOf(README_START);
  if (start !== -1) {
    // prefer the `# README` heading immediately preceding README_START so a `# README` in user notes isn't matched
    const before = content.slice(0, start);
    const near = before.match(/(?:^|\r?\n)(# README[ \t]*\r?\n\s*)$/);
    const at = near ? start - near[1].length : start;
    return content.slice(0, at) + insert + content.slice(at);
  }
  const at = content.search(/^# README[ \t]*\r?$/m);
  return at !== -1 ? content.slice(0, at) + insert + content.slice(at) : `${content.trimEnd()}\n\n${insert}`;
}

/**
 * The README without its developer sections (DEV_SECTION headings, each down to the next heading of its level or
 * higher; headings inside code blocks don't count): {text, skipped: their titles}.
 */
function skipDevSections(markdown) {
  const kept = [];
  const skipped = [];
  let skipLevel = 0;   // the level of the heading being skipped; 0: keeping
  mapMarkdownLines(markdown, (line, _, inCode) => {
    const heading = !inCode && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      if (skipLevel && level <= skipLevel) skipLevel = 0;
      const title = heading[2].replace(/[^\p{L}\p{N}\s'-]/gu, "").trim();
      if (!skipLevel && DEV_SECTION.test(title) && title.split(/\s+/).length <= 4) {
        skipLevel = level;
        skipped.push(title);
      }
    }
    if (!skipLevel) kept.push(line);
    return line;
  });
  return { text: kept.join("\n").trim(), skipped };
}

function readmePrompt(markdown, targetLanguage, prompts) {
  return [
    promptInstructions(prompts, "readme", targetLanguage),
    "Reply with ONLY the translated Markdown, nothing before or after it.",
    "",
    markdown,
  ].join("\n");
}

/** The note's README meta line: {version ("1.2.0"), date ("2026-11-15") it was fetched}; nulls when unknown. */
function readmeMeta(content) {
  const start = content.indexOf(README_START);
  if (start === -1) return { version: null, date: null };
  const meta = content.slice(start + README_START.length).trimStart().split("\n", 1)[0];
  return { version: meta.match(/· v(\S+) ·/)?.[1] ?? null, date: meta.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null };
}

/** Version the note's README was fetched for ("1.2.0"); null when unknown. */
function readmeVersion(content) {
  return readmeMeta(content).version;
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

/** Body of a new library note (properties are written separately with processFrontMatter). */
function noteBody(heading = t("note.myNotes")) {
  return `# ${heading}\n\n\n# README\n${README_START}\n${README_END}\n`;
}

/** Notes made before 0.9 start with the description; it lives in the `description` property now. */
function stripDescription(content, description) {
  if (!description) return content;
  const fm = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  const head = fm ? fm[0] : "";
  const body = content.slice(head.length);
  const start = body.match(/^(?:\r?\n)*/)[0].length;
  const escaped = description.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.slice(start).match(new RegExp(`^${escaped}\\r?\\n\\r?\\n`));
  return match ? head + body.slice(0, start) + body.slice(start + match[0].length) : content;
}

/** Turns the "## Notlarım" heading of 0.1 notes into H1; touches no other line. */
function migrateHeadings(content) {
  return content.replace(/^## Notlarım[ \t]*(\r?)$/m, "# Notlarım$1");
}

/** Turns 0.7.1's status values (candidate, trying, using, dropped) into today's (see LEGACY_STATUS), frontmatter only. */
function migrateStatuses(content) {
  const fm = content.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/);
  if (!fm) return content;
  const updated = fm[1].replace(/^status: (candidate|trying|using|dropped)([ \t]*\r?)$/m, (all, old, tail) => `status: ${LEGACY_STATUS[old]}${tail}`);
  return updated === fm[1] ? content : updated + content.slice(fm[1].length);
}


/** The Bases file listing the library notes in `folder` (written by "Create / reset Bases view"). */
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
  const folderExpr = `file.inFolder(${q(folder)})`;
  // quote YAML scalar when folder name contains `: ` or ` #` which would break YAML parsing
  const folderFilter = /:\s|\s#/.test(folderExpr) ? q(folderExpr) : folderExpr;
  return [
    "filters:",
    "  and:",
    `    - ${folderFilter}`,
    "views:",
    ...view(t("base.all"), [], ["groups", "status", "rating", "note", "downloads", "version", "updated", "reviewed"]),
    ...view(t("base.topRated"), ["    filters:", "      and:", `        - rating >= ${TOP_RATING}`], ["groups", "status", "rating", "note", "downloads", "updated"]),
    ...view(t("base.ungrouped"), ["    filters:", "      and:", "        - groups.isEmpty()"], ["rating", "note", "downloads", "updated"]),
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

/** Trimmed, non-empty names without case-insensitive duplicates (locale-safe); the first spelling wins. */
function uniqueNames(names) {
  const seen = new Set();
  return names.map((n) => n.replace(/\s+/g, " ").trim()).filter((n) => {
    const key = fold(n);
    if (!n || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Library record from a note's frontmatter (only notes with `plugin_id`). */
function noteFromFrontmatter(path, fm) {
  if (!fm || !fm.plugin_id) return null;
  return {
    path,
    id: String(fm.plugin_id),
    groups: groupsOf(fm),
    status: typeof fm.status === "string" ? fm.status.trim() : "",   // shown only if it's one of your statuses
    rating: Number.isInteger(fm.rating) && fm.rating >= 1 && fm.rating <= 5 ? fm.rating : 0,
    note: fm.note ? String(fm.note) : "",
    reviewed: fm.reviewed ? String(fm.reviewed).slice(0, 10) : "",
    updated: fm.updated ? String(fm.updated).slice(0, 10) : "",
  };
}

