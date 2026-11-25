"""Builds similar.json, the "Similar" lists Community Radar shows (runs in GitHub Actions).

Every listed plugin gets its closest plugins, best first. The score adds five 0–1 signals; the three
text ones are stretched to 0–1 over all other plugins (min–max, the plugin itself left out):

    2 × description   cosine of the "name: description" vectors (embeddings branch, granite-311m)
    1 × name          TF-IDF cosine of the names
    3 × overview      TF-IDF cosine of the AI overview: summary + problem + capabilities
    1 × category      same primary 1 · one's primary among the other's 0.6 · a shared "also" 0.3
    1 × tags          IDF-weighted Jaccard of the tags (index.json's, the closed vocabulary)

The weights won a blind test on 50 hand-graded plugins (nDCG@5 0.78 vs 0.56 for vectors alone);
gold.json holds those grades and is the quality gate: below MIN_NDCG nothing is written.

Usage:
    python build.py --profiles DIR --vectors DIR [--gold FILE]

    --profiles  the profiles branch (index.json, profiles/<id>.json); similar.json is written here
    --vectors   the embeddings branch (granite-311m.bin/.json, built daily); a plugin listed since has no vector
                yet: it scores 0 on the description and is left out of the description's min–max

Output, similar.json: {"built", "top", "ids": [...], "lists": [[index into ids, ...], ...]}
        similar.stamp.json: {"vectors"}, the vectors build it was scored on (--skip-if-current reads it)
Writes `changed=true|false` to $GITHUB_OUTPUT: true when the lists or the stamp differ from the files already there.
"""

import argparse
import json
import math
import os
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import LISTING_URL, fetch_json

VECTORS = "granite-311m"
STAMP = "similar.stamp.json"   # the vectors build the lists were scored on: a sidecar, so similar.json's ETag moves only with the lists
WEIGHTS = {"desc": 2, "name": 1, "overview": 3, "cat": 1, "tag": 1}
STRETCHED = {"desc", "name", "overview"}   # cosines bunch up per plugin; category and tags are 0–1 already
TOP = 50            # list length per plugin
GATE_K = 5          # the gate grades the top 5, as the details window shows them
MIN_NDCG = 0.74     # measured 0.78; a drop below this means the data or the code went wrong
BATCH = 256         # plugins scored at once (BATCH × catalog floats per signal in memory)
NAME_NOISE = {"obsidian", "plugin", "for", "the", "and"}


# ── Inputs ──────────────────────────────────────────────────────────────────
def load_catalog(profiles_dir):
    """Listed, not delisted plugins with a profile: (ids, listing by id, index entry by id)."""
    listing = {p["id"]: p for p in fetch_json(LISTING_URL)}
    index = json.loads((profiles_dir / "index.json").read_text(encoding="utf-8"))["plugins"]
    ids = sorted(k for k, p in index.items() if k in listing and not p.get("delisted"))
    return ids, listing, index


def detail(profiles_dir, plugin_id):
    """A plugin's detail profile; {} when it has none yet."""
    path = profiles_dir / "profiles" / f"{plugin_id}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def overview_text(plugin_id, listing, index, profiles_dir):
    """What the details window's Overview shows; the manifest description when there is no profile."""
    d = detail(profiles_dir, plugin_id)
    summary = index[plugin_id].get("summary") or listing[plugin_id].get("description", "")
    return " ".join([summary, d.get("problem") or "", *(d.get("capabilities") or [])])


def name_text(name):
    """A plugin name without the words every plugin shares."""
    return " ".join(w for w in re.findall(r"[a-z0-9]+", name.lower()) if w not in NAME_NOISE)


def load_vectors(vectors_dir, ids):
    """Unit "name: description" vectors in `ids` order; zero rows for plugins without one yet (listed since)."""
    meta = json.loads((vectors_dir / f"{VECTORS}.json").read_text(encoding="utf-8"))
    raw = np.fromfile(vectors_dir / f"{VECTORS}.bin", dtype=np.int8).reshape(-1, meta["dim"])
    row = {k: i for i, k in enumerate(meta["ids"])}
    out = np.zeros((len(ids), meta["dim"]), dtype=np.float32)
    for i, k in enumerate(ids):
        if k in row:
            out[i] = raw[row[k]]
    out /= np.linalg.norm(out, axis=1, keepdims=True) + 1e-9
    return out


# ── Signals ─────────────────────────────────────────────────────────────────
class Signals:
    """Everything the score needs, as matrices aligned with `ids`, so a batch scores at once."""

    def __init__(self, ids, listing, index, profiles_dir, vectors):
        self.n = len(ids)
        self.desc = vectors
        self.has_vector = np.linalg.norm(vectors, axis=1) > 0
        tfidf = {"sublinear_tf": True}
        self.overview = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), min_df=2, **tfidf).fit_transform(
            [overview_text(k, listing, index, profiles_dir) for k in ids])
        self.name = TfidfVectorizer(**tfidf).fit_transform([name_text(listing[k]["name"]) for k in ids])

        # categories: primary as a number, every category (primary + also) as a 0/1 matrix
        names = sorted({c for k in ids for c in [index[k]["primary"], *(index[k].get("also") or [])]})
        col = {c: i for i, c in enumerate(names)}
        self.primary = np.array([col[index[k]["primary"]] for k in ids])
        self.cats = np.zeros((self.n, len(names)), dtype=np.float32)
        for i, k in enumerate(ids):
            for c in [index[k]["primary"], *(index[k].get("also") or [])]:
                self.cats[i, col[c]] = 1

        # tags: 0/1 matrix and each tag's IDF (rarer tags count more)
        tags = sorted({t for k in ids for t in index[k].get("tags") or []})
        tcol = {t: i for i, t in enumerate(tags)}
        self.tags = np.zeros((self.n, len(tags)), dtype=np.float32)
        for i, k in enumerate(ids):
            for t in index[k].get("tags") or []:
                self.tags[i, tcol[t]] = 1
        self.idf = np.log(self.n / np.maximum(self.tags.sum(axis=0), 1)).astype(np.float32)
        self.tag_mass = self.tags @ self.idf   # each plugin's summed tag IDF

    def description(self, rows):
        """Cosines of the description vectors. Plugins without a vector are NaN, so the min–max ignores them (their
        zeros would set every plugin's floor and squeeze the real cosines together); a target without one gets 0s."""
        cos = self.desc[rows] @ self.desc.T
        cos[:, ~self.has_vector] = np.nan
        cos[~self.has_vector[rows]] = 0
        return cos

    def category(self, rows):
        """cat_sim of `rows` against all: same primary 1 · primary in the other's set 0.6 · any shared 0.3."""
        p = self.primary[rows][:, None]
        same = p == self.primary[None, :]
        mine_in_theirs = self.cats[:, self.primary[rows]].T > 0             # my primary among their categories
        theirs_in_mine = self.cats[rows][:, self.primary] > 0               # their primary among my categories
        shared = (self.cats[rows] @ self.cats.T) > 0
        return np.where(same, 1.0, np.where(mine_in_theirs | theirs_in_mine, 0.6, np.where(shared, 0.3, 0.0)))

    def tag(self, rows):
        """IDF-weighted Jaccard of `rows`' tags against all."""
        shared = (self.tags[rows] * self.idf) @ self.tags.T
        union = self.tag_mass[rows][:, None] + self.tag_mass[None, :] - shared
        return np.divide(shared, union, out=np.zeros_like(shared), where=union > 0)

    def scores(self, rows):
        """The weighted score of `rows` (a batch) against every plugin; a plugin's own column is −inf."""
        parts = {
            "desc": self.description(rows),
            "name": (self.name[rows] @ self.name.T).toarray(),
            "overview": (self.overview[rows] @ self.overview.T).toarray(),
            "cat": self.category(rows),
            "tag": self.tag(rows),
        }
        own = (np.arange(len(rows)), rows)
        total = np.zeros((len(rows), self.n))
        for key, weight in WEIGHTS.items():
            total += weight * (stretch(parts[key], own) if key in STRETCHED else parts[key])
        total[own] = -np.inf
        return total


def stretch(x, own):
    """Each row min–max to 0–1 over the other plugins (a plugin's own column can't set the max)."""
    x = x.astype(np.float64)
    x[own] = np.nan
    lo, hi = np.nanmin(x, axis=1, keepdims=True), np.nanmax(x, axis=1, keepdims=True)
    return np.nan_to_num((x - lo) / (hi - lo + 1e-12), nan=0.0)


def top_lists(signals, top=TOP):
    """Every plugin's `top` closest plugins as row numbers, best first."""
    lists = []
    for start in range(0, signals.n, BATCH):
        rows = np.arange(start, min(start + BATCH, signals.n))
        x = signals.scores(rows)
        part = np.argpartition(-x, top, axis=1)[:, :top]
        order = np.take_along_axis(x, part, axis=1).argsort(axis=1)[:, ::-1]   # best first
        lists += np.take_along_axis(part, order, axis=1).tolist()
    return lists


# ── Quality gate ────────────────────────────────────────────────────────────
def dcg(grades):
    """Discounted gain of a graded list (grade 2 → 3, 1 → 1, 0 → 0)."""
    return sum((2 ** g - 1) / math.log2(i + 2) for i, g in enumerate(grades))


def ndcg(ids, lists, gold):
    """Mean nDCG@GATE_K over the graded plugins still listed (ideal = each plugin's best known grades)."""
    pos = {k: i for i, k in enumerate(ids)}
    scores = []
    for k, grades in gold.items():
        if k in pos:
            shown = [grades.get(ids[j], 0) for j in lists[pos[k]][:GATE_K]]
            scores.append(dcg(shown) / (dcg(sorted(grades.values(), reverse=True)[:GATE_K]) or 1))
    return sum(scores) / len(scores)


def write_output(changed):
    """Tells the workflow whether to publish."""
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as out:
            out.write(f"changed={'true' if changed else 'false'}\n")


def vectors_built(vectors_dir: Path) -> str:
    """The description vectors' build stamp ("" when missing)."""
    meta = vectors_dir / f"{VECTORS}.json"
    return json.loads(meta.read_text(encoding="utf-8")).get("built", "") if meta.exists() else ""


def scored_on(profiles_dir: Path) -> str:
    """The vectors stamp the current similar.json was scored on ("" when unknown)."""
    stamp = profiles_dir / STAMP
    return json.loads(stamp.read_text(encoding="utf-8")).get("vectors", "") if stamp.exists() else ""


def is_up_to_date(profiles_dir: Path, vectors_dir: Path) -> bool:
    """True when similar.json exists and was scored on the current description vectors."""
    current = vectors_built(vectors_dir)
    return bool(current) and (profiles_dir / "similar.json").exists() and scored_on(profiles_dir) == current


def main():
    args = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    args.add_argument("--profiles", type=Path, required=True)
    args.add_argument("--vectors", type=Path, required=True)
    args.add_argument("--gold", type=Path, default=Path(__file__).with_name("gold.json"))
    args.add_argument("--skip-if-current", action="store_true",
                      help="skip scoring when profiles did not change and similar.json was scored on these vectors")
    opts = args.parse_args()

    if opts.skip_if_current and is_up_to_date(opts.profiles, opts.vectors):
        print("similar.json already up to date with profiles and vectors; skipped")
        write_output(False)
        return

    ids, listing, index = load_catalog(opts.profiles)
    signals = Signals(ids, listing, index, opts.profiles, load_vectors(opts.vectors, ids))
    lists = top_lists(signals)
    quality = ndcg(ids, lists, json.loads(opts.gold.read_text(encoding="utf-8")))
    print(f"{len(ids):,} plugins · top {TOP} · nDCG@{GATE_K} {quality:.3f} (gate {MIN_NDCG})")
    if quality < MIN_NDCG:
        print(f"::warning::Similar lists not published: nDCG@{GATE_K} {quality:.3f} < {MIN_NDCG}")
        write_output(False)
        sys.exit(0)   # the profiles still publish; the old similar.json stays

    path = opts.profiles / "similar.json"
    old = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    lists_changed = old.get("ids") != ids or old.get("lists") != lists
    if lists_changed:
        built = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        path.write_text(json.dumps({"built": built, "top": TOP, "ids": ids, "lists": lists}, separators=(",", ":")),
                        encoding="utf-8")
    vectors = vectors_built(opts.vectors)
    stamp_changed = scored_on(opts.profiles) != vectors
    if stamp_changed:   # publishes the stamp too (at most once per vectors build), so later runs can skip
        (opts.profiles / STAMP).write_text(json.dumps({"vectors": vectors}), encoding="utf-8")
    print(f"similar.json {'written' if lists_changed else 'unchanged'} · stamp {'updated' if stamp_changed else 'current'}")
    write_output(lists_changed or stamp_changed)

if __name__ == "__main__":
    main()
