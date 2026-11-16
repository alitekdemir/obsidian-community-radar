"""What Community Radar asks a model about a plugin, and how the answer is cleaned up.

Shared by the hourly GitHub Actions run (``update.py``). The prompt, schema and
README cleaning are the ones the Colab model bench measured and the full scan
used (prompt v3), plus a closed tag vocabulary (v4).
"""

import html
import json
import re

from markdown_it import MarkdownIt

PROMPT_VERSION = 4  # v4: tags come from the closed vocabulary in tags.json

CORE_FEATURES = [
    "Audio recorder", "Backlinks", "Bases", "Bookmarks", "Canvas", "Command palette",
    "Daily notes", "File recovery", "Files", "Footnotes view", "Format converter",
    "Graph view", "Note composer", "Outgoing links", "Outline", "Page preview",
    "Properties view", "Publish", "Quick switcher", "Random note", "Search",
    "Slash commands", "Slides", "Sync", "Tags view", "Templates", "Unique note creator",
    "Web viewer", "Word count", "Workspaces",
    # editor features that are not core plugins
    "Live Preview", "Task lists", "Callouts", "Embeds", "Mermaid", "Math", "Vim mode",
    "Spellcheck", "Themes and CSS snippets", "Hotkeys",
]

# README sections dropped before the model sees them: pure noise for a profile.
# Matched against the whole heading text, so "Install and enable, that is it" stays.
# Kept on purpose: Installation (BRAT = beta, API keys), Credits (fork evidence),
# FAQ/Troubleshooting (the docs-5 anchor).
DROP_SECTIONS = re.compile(
    r"(licen[cs]e|contribut\w*|contributing guidelines|development|building|build from source"
    r"|support( me| the project)?|donat\w*|sponsor\w*|funding|changelog|change log|release notes)",
    re.IGNORECASE,
)

# Only the slugs whose borders get confused; the rest are self-explanatory.
CATEGORY_NOTES = """\
- integrations: connects Obsidian to a named outside app or service (Todoist, Zotero, Readwise).
- syncing: keeps a vault or files in sync across devices or storage; not app-specific task sync.
- import / export: one-way conversion of files into or out of the vault.
- files / folders / attachments: managing vault files, folder structure, embedded media files.
- formatting: rewrites text or Markdown layout. editing: helps while typing (commands, cursor, toolbar).
- data: queries or computes over note metadata. tables: Markdown table editing or table views.
  properties: editing frontmatter/properties themselves."""

PROMPT = """\
Obsidian is a note-taking app that keeps notes as local Markdown files in a folder (a vault).
It ships with core features (listed below); community plugins add new features or improve
existing ones.

You profile Obsidian community plugins for a plugin directory. Read the plugin's README and
manifest description and return one JSON object matching the schema. The README is given as
plain text: links, images and HTML are removed, and each code block is shown as [code example]. Use only what the README
and description say; never use outside knowledge about this plugin. Write plain, specific
English with no marketing words.

Obsidian core features (for coreOverlap): {core}

Category slugs (closed list): {slugs}

Tag vocabulary (closed list): {tags}
Notes on overlapping categories:
{notes}

Field rules
- basis: "readme" if the README explains the plugin; "stub" if it is a sentence or two that
  points to documentation elsewhere; "description" if there is no README.
- summary: one sentence, at most 160 characters: what it is and what it does. Start with a
  noun phrase ("Rule-based formatter that..."), never "This plugin".
- problem: one sentence: the gap or pain in Obsidian it addresses.
- motivation: why the author built it, only if the README says so; otherwise null.
- intent: "alternative" if the README positions it against a named plugin or app (fork,
  successor, replacement, "alternative to", "re-imagining of"); "improve" if it extends an
  Obsidian core feature or a named plugin; otherwise "new".
- intentEvidence: verbatim README quote (max 20 words) supporting intent, or null.
- disambiguation: one sentence only when the plugin's NAME suggests a different job than it
  does (e.g. "Not a code linter; it only rewrites Markdown layout.", "Not a digital-garden
  publishing tool."). Not for pricing, limits or how a feature behaves; otherwise null.
- capabilities: 1-5 short "verb + object" phrases covering the main jobs.
- primary: the ONE slug where a user looking for exactly this plugin would search: its core
  job, not a side feature. A plugin whose main job is connecting to an outside app or service
  is "integrations"; the domain (e.g. tasks) goes to also.
- also: 0-2 more slugs, only where someone browsing that category would expect to find this
  plugin; never repeat primary. Prefer fewer.
- tags: 2-8 tags from the tag vocabulary (closed list), the most specific ones that fit: named
  services/apps, formats, methods, techniques. Never a tag outside the list; [] if none fits.
- audience: niche audiences only (ttrpg-game-masters, academics, developers); [] if general.
- coreOverlap.level: "partial" if it does part of a core feature's job or builds on one,
  "full" if it duplicates one, else "none"; features: names from the core list.
- relations: other plugins or apps the README names, written as in the README, with type
  extends | alternative | fork | inspired | replaces | integrates and a verbatim evidence quote
  (max 20 words). Only ones the README names.
- requires: what the user must have: plugin | externalApp | apiKey | paidService | account;
  optional=true when only some features need it.
- lifecycle: "experimental" if the README says work in progress, alpha, beta or unstable;
  "deprecated" if it says deprecated, unmaintained or archived; else null.
  replacedBy: the named successor when deprecated, else null.
- scores.docs (README quality): 1 no real content | 2 stub or bare list | 3 says what it does
  and lists features but no usage examples | 4 what and how, with examples or screenshots |
  5 also why, limits and troubleshooting; complete on its own.
- scores.focus: 5 one job, however many options | 4 one job plus a side feature | 3 several
  related jobs | 2 a toolkit of loosely related tools | 1 an all-in-one suite.
- extras: anything notable the fields miss (warnings, freemium, docs elsewhere), or null."""


def build_schema(slugs: list[str]) -> dict:
    """Strict JSON Schema of one profile (all keys required, no extras).

    Counts, lengths and quotes are fixed afterwards by ``normalize_profile``
    because providers support those keywords unevenly in strict mode.
    """
    text, opt_text = {"type": "string"}, {"type": ["string", "null"]}
    strings = {"type": "array", "items": text}

    def choice(*values) -> dict:
        """String enum with an explicit type; a None value becomes an anyOf null branch,
        the only nullable-enum form every provider accepts in strict mode."""
        labels = {"type": "string", "enum": [v for v in values if v is not None]}
        return {"anyOf": [labels, {"type": "null"}]} if None in values else labels

    def obj(**props) -> dict:
        return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}

    return obj(
        basis=choice("readme", "stub", "description"),
        summary=text, problem=text, motivation=opt_text,
        intent=choice("new", "improve", "alternative"), intentEvidence=opt_text,
        disambiguation=opt_text, capabilities=strings,
        primary=choice(*slugs), also={"type": "array", "items": choice(*slugs)},
        tags=strings, audience=strings,
        coreOverlap=obj(level=choice("none", "partial", "full"), features=strings),
        relations={"type": "array", "items": obj(
            plugin=text,
            type=choice("extends", "alternative", "fork", "inspired", "replaces", "integrates"),
            evidence=text)},
        requires={"type": "array", "items": obj(
            kind=choice("plugin", "externalApp", "apiKey", "paidService", "account"),
            name=text, optional={"type": "boolean"})},
        lifecycle=choice("experimental", "deprecated", None), replacedBy=opt_text,
        scores=obj(docs={"type": "integer"}, focus={"type": "integer"}),
        extras=opt_text,
    )


def clean_readme(markdown: str | None, html_blocks: bool = True) -> str:
    """GitHub Markdown → plain text the model reads; nothing a reader sees is lost.

    Keeps headings (as ``## Title``), paragraphs, list items and table cells.
    Links keep only their label; images, badges, HTML tags and bare URLs go;
    each code block becomes ``[code example]`` so the docs score still sees
    examples. Whole sections whose heading matches ``DROP_SECTIONS`` are skipped.

    Markdown inside an HTML block is cleaned by one nested call with
    ``html_blocks=False``, so leftover HTML (an unclosed ``<details``) is read as
    plain text instead of opening another HTML block forever.
    """
    parser = MarkdownIt("commonmark", {"html": html_blocks}).enable("table")
    tokens = parser.parse(markdown or "")
    lines: list[str] = []
    row: list[str] = []
    skip_level = None   # heading level of the section being dropped
    depth, bullet = 0, False  # list nesting; True until a list item's first line is written

    def inline_text(token) -> str:
        parts = []
        for child in token.children or []:
            if child.type in ("text", "code_inline"):
                parts.append(child.content)
            elif child.type in ("softbreak", "hardbreak"):
                parts.append(" ")
        return re.sub(r"https?://\S+", "", "".join(parts)).strip()  # bare URLs carry no meaning

    for i, token in enumerate(tokens):
        if token.type == "heading_open":
            level, title = int(token.tag[1]), inline_text(tokens[i + 1])
            if skip_level and level <= skip_level:
                skip_level = None  # a same-or-higher heading ends the dropped section
            if not skip_level and DROP_SECTIONS.fullmatch(re.sub(r"[^\w ]", "", title).strip()):
                skip_level = level
        if skip_level:
            continue
        if token.type in ("bullet_list_open", "ordered_list_open"):
            depth += 1
        elif token.type in ("bullet_list_close", "ordered_list_close"):
            depth -= 1
        elif token.type == "list_item_open":
            bullet = True
        elif token.type in ("fence", "code_block"):
            lines.append("[code example]")
        elif token.type == "html_block":  # e.g. <details> holding Markdown: drop the tags, clean the rest
            inner = html.unescape(re.sub(r"<!--.*?-->|<[^>]+>", "\n", token.content, flags=re.S))
            lines.append(clean_readme("\n".join(line.strip() for line in inner.split("\n")), html_blocks=False))
        elif token.type == "inline":
            text = html.unescape(inline_text(token))
            if tokens[i - 1].type in ("th_open", "td_open"):
                row.append(text)
            elif tokens[i - 1].type == "heading_open":
                lines.append("#" * int(tokens[i - 1].tag[1]) + " " + text)
            elif text:
                lines.append("  " * (depth - 1) + "- " + text if bullet else text)
                bullet = False
        elif token.type == "tr_close":
            lines.append(" | ".join(row))
            row = []
    return "\n".join(line for line in lines if line.strip())


def squash(text: str) -> str:
    """Plain, lowercase, single-spaced text for quote matching.

    Models quote what a reader sees, so Markdown links keep only their label
    and HTML tags and emphasis marks are dropped before comparing.
    """
    text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", text or "")  # [label](url) → label
    text = re.sub(r"<[^>]+>|[*_`]", "", text)                       # tags, emphasis, code marks
    return re.sub(r"\s+", " ", text).strip().lower()


def evidence_source(plugin: dict) -> str:
    """The text every quote must come from: the cleaned README plus the manifest description."""
    return squash(plugin["text"] + " " + plugin["description"])


def parse_json(content: str) -> dict:
    """JSON from a model answer, tolerating ```json fences and leading prose."""
    match = re.search(r"\{.*\}", content, re.S)
    return json.loads(match.group(0) if match else content)


def user_message(plugin: dict) -> str:
    """The per-plugin input: name, manifest description and the full README."""
    return (f"Plugin: {plugin['name']} (id: {plugin['id']})\n"
            f"Manifest description: {plugin['description']}\n"
            f"README:\n<<<\n{plugin['text'] or '(no README)'}\n>>>")


def normalize_profile(profile: dict, plugin: dict, slugs: set[str]) -> tuple[dict, list[str]]:
    """Fixes, in code, the rule breaks a model makes; returns the profile and what changed.

    Content is never rewritten: tags are re-spelled and filtered, lists capped,
    quotes that aren't in the README dropped (set to None), scores clamped.
    """
    p = json.loads(json.dumps(profile))  # deep copy
    fixes = []
    source = evidence_source(plugin)

    tags = []
    for tag in p["tags"]:
        kebab = re.sub(r"[^a-z0-9]+", "-", tag.lower()).strip("-")
        if kebab and kebab not in slugs and kebab not in tags:  # a category is not a tag
            tags.append(kebab)
    if tags[:8] != p["tags"]:
        fixes.append("tags")
    p["tags"] = tags[:8]

    also = [slug for slug in dict.fromkeys(p["also"]) if slug != p["primary"]][:2]
    if also != p["also"]:
        fixes.append("also")
    p["also"] = also

    if len(p["capabilities"]) > 5:
        fixes.append("capabilities")
        p["capabilities"] = p["capabilities"][:5]

    if p["intentEvidence"] and squash(p["intentEvidence"]) not in source:
        fixes.append("intentEvidence")
        p["intentEvidence"] = None
    for relation in p["relations"]:
        if relation["evidence"] and squash(relation["evidence"]) not in source:
            fixes.append("relationEvidence")
            relation["evidence"] = None  # keep the named relation, drop the made-up quote

    scores = {key: min(5, max(1, value)) for key, value in p["scores"].items()}
    if scores != p["scores"]:
        fixes.append("scores")
    p["scores"] = scores
    return p, fixes


def system_prompt(slugs: list[str], tags: list[str]) -> str:
    """The instructions every call gets, with the closed category and tag lists filled in."""
    return PROMPT.format(core=", ".join(CORE_FEATURES), slugs=", ".join(slugs), notes=CATEGORY_NOTES,
                         tags=", ".join(tags))
