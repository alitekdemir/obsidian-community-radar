"""Builds the semantic vectors Community Radar uses for "Similar" (runs in GitHub Actions).

Each community plugin's name and description becomes a vector; the plugin downloads one small file
instead of running a model. Unchanged plugins reuse last run's vectors, so a daily run only embeds
the plugins that are new or edited.

Usage:
    python embed.py --out DIR [--model KEY ...] [--report FILE]

Output per model, in DIR:
    <key>.bin   int8 vectors, one row per plugin, rows in the order of <key>.json "ids"
    <key>.json  {"model", "dim", "count", "built", "ids", "hashes"}
"""

import argparse
import datetime
import hashlib
import json
import re
import urllib.request
from pathlib import Path

import numpy as np

LISTING_URL = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json"
UNREVIEWED_NOTE = re.compile(r"\s*-?\s*This plugin has not been manually reviewed by Obsidian staff\.?\s*", re.I)

# key → Hugging Face id, vector size (None = the model's own), extra load arguments
MODELS = {
    "granite-311m": ("ibm-granite/granite-embedding-311m-multilingual-r2", 256, {}),
    "granite-97m": ("ibm-granite/granite-embedding-97m-multilingual-r2", None, {}),
    "harrier-270m": ("microsoft/harrier-oss-v1-270m", None, {"model_kwargs": {"torch_dtype": "float32"}}),
}
DEFAULT_MODEL = "granite-311m"

# plugins the comparison report shows, chosen to cover different kinds of plugins
REPORT_IDS = [
    "gamified-pkm", "obsidian-excalidraw-plugin", "periodic-notes", "obsidian-tasks-plugin", "homepage",
    "dataview", "obsidian-kanban", "calendar", "templater-obsidian", "smart-connections",
    "obsidian-spaced-repetition", "pomodoro-timer", "obsidian-zotero-desktop-connector", "plugin-radar",
]
REPORT_TOP = 8


def load_catalog():
    """The official plugin list: [{id, name, description}], descriptions without Obsidian's review note."""
    with urllib.request.urlopen(LISTING_URL, timeout=60) as response:
        plugins = json.load(response)
    return [{"id": p["id"], "name": p["name"], "text": f'{p["name"]}: {UNREVIEWED_NOTE.sub(" ", p.get("description", "")).strip()}'}
            for p in plugins]


def text_hash(text):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def to_int8(vectors):
    """Unit-length float vectors → int8 (×127); cosine similarity survives with ~1% error."""
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    return np.clip(np.round(vectors / np.maximum(norms, 1e-12) * 127), -127, 127).astype(np.int8)


def previous(out, key):
    """Last run's vectors by text hash, so unchanged plugins aren't embedded again."""
    meta_path, bin_path = out / f"{key}.json", out / f"{key}.bin"
    if not (meta_path.exists() and bin_path.exists()):
        return {}
    meta = json.loads(meta_path.read_text())
    rows = np.fromfile(bin_path, dtype=np.int8).reshape(meta["count"], meta["dim"])
    return dict(zip(meta["hashes"], rows))


def build(catalog, key, out):
    """Embeds what changed, writes <key>.bin/.json and returns the int8 matrix."""
    from sentence_transformers import SentenceTransformer

    model_id, dim, kwargs = MODELS[key]
    hashes = [text_hash(p["text"]) for p in catalog]
    cached = previous(out, key)
    missing = [i for i, h in enumerate(hashes) if h not in cached]
    print(f"{key}: {len(catalog)} plugins, {len(missing)} to embed, {len(catalog) - len(missing)} reused")
    fresh = {}
    if missing:
        model = SentenceTransformer(model_id, truncate_dim=dim, **kwargs)
        model.max_seq_length = 256   # names and descriptions are short; long padding only costs time
        vectors = model.encode([catalog[i]["text"] for i in missing], batch_size=64, show_progress_bar=True,
                               normalize_embeddings=True, convert_to_numpy=True)
        fresh = dict(zip((hashes[i] for i in missing), to_int8(vectors.astype(np.float32))))
    matrix = np.stack([fresh.get(h, cached.get(h)) for h in hashes])
    matrix.tofile(out / f"{key}.bin")
    (out / f"{key}.json").write_text(json.dumps({
        "model": model_id, "dim": int(matrix.shape[1]), "count": len(catalog),
        "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ids": [p["id"] for p in catalog], "hashes": hashes,
    }, separators=(",", ":")))
    return matrix


def neighbours(matrix, index, top):
    """Rows closest to row `index` by cosine similarity: [(row, similarity 0–1)]."""
    scores = matrix.astype(np.int32) @ matrix[index].astype(np.int32) / (127 * 127)
    scores[index] = -2
    best = np.argsort(-scores)[:top]
    return [(int(i), float(scores[i])) for i in best]


def load(out, key):
    """A built model's (ids, int8 matrix), or None."""
    meta_path, bin_path = out / f"{key}.json", out / f"{key}.bin"
    if not (meta_path.exists() and bin_path.exists()):
        return None
    meta = json.loads(meta_path.read_text())
    return meta["ids"], np.fromfile(bin_path, dtype=np.int8).reshape(meta["count"], meta["dim"])


def report(catalog, built, path):
    """Markdown: for each sample plugin, the top matches of every model side by side.
    `built`: model key → (ids, matrix)."""
    by_id = {p["id"]: p for p in catalog}
    keys = list(built)
    lines = ["# Similar plugins: semantic models compared", "",
             f"{len(catalog)} plugins · built {datetime.date.today()} · top {REPORT_TOP} by cosine similarity", ""]
    for plugin_id in REPORT_IDS:
        if plugin_id not in by_id or any(plugin_id not in ids for ids, _ in built.values()):
            continue
        lines += [f"## {by_id[plugin_id]['name']}", "", f"> {by_id[plugin_id]['text']}", "",
                  "| # | " + " | ".join(keys) + " |", "|---|" + "---|" * len(keys)]
        columns = {}
        for key, (ids, matrix) in built.items():
            name = lambda row: by_id.get(ids[row], {"name": ids[row]})["name"]
            columns[key] = [f"{name(row)} ({score:.2f})" for row, score in neighbours(matrix, ids.index(plugin_id), REPORT_TOP)]
        for rank in range(min(len(c) for c in columns.values())):
            lines.append(f"| {rank + 1} | " + " | ".join(columns[key][rank].replace("|", "/") for key in keys) + " |")
        lines.append("")
    Path(path).write_text("\n".join(lines))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--model", action="append", choices=sorted(MODELS), help="build these (default: none with --report)")
    parser.add_argument("--report", help="compare every model built in --out")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    catalog = load_catalog()
    for key in args.model or ([] if args.report else [DEFAULT_MODEL]):
        build(catalog, key, args.out)
    if args.report:
        built = {key: load(args.out, key) for key in MODELS if load(args.out, key)}
        report(catalog, built, args.report)


if __name__ == "__main__":
    main()
