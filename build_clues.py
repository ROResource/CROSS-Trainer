#!/usr/bin/env python3
"""
build_clues.py - turn scraped JSONL clue libraries into the data files the
CROSS-Trainer site loads.

    python build_clues.py --indo indo_cryptic.jsonl --age age_cryptic.jsonl --times crosaire.jsonl

Writes
    data/manifest.json          sources, setters, counts (what the toggles show)
    data/chunks/<name>.json     the clues, one file per source/setter (big ones
                                split by year) so the site only downloads what
                                the current deck needs
Each clue is a compact array:
    [clue, enumeration, answer, date, number, direction, explanation?]
(the 7th element is present only when the record had an explanation)

Cleaning rules (counts are reported on stderr):
  * drop records carrying a parser "warning" (grid/enumeration mismatch)
  * drop records with no clue, no enumeration, or a non-alphabetic answer
  * drop records whose enumeration does not add up to the answer length
  * drop cross-reference clues that cannot stand alone ("See 9", "& 11Dn. ...",
    "one-third of 14 across")
  * strip HTML tags (<i>Titanic</i>) and unescape entities
  * dedupe within a source on (normalised clue, answer) - case, spacing and
    punctuation are ignored. The earliest appearance is kept.
"""
import argparse, html, json, os, re, sys
from collections import Counter, defaultdict

XREF = re.compile(r"(^\s*see\s+\d)|(^\s*&\s*\d)|(\b\d+\s*(across|down|ac|dn)\b)", re.I)
TAGS = re.compile(r"</?[a-zA-Z][^>]*>")
norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())
CHUNK_MAX = 40_000            # rows per file before splitting by year

SOURCES = {
    "indo":  {"name": "Irish Independent", "short": "The Indo",  "setters": False, "explanations": False},
    "age":   {"name": "The Age",           "short": "The Age",   "setters": True,  "explanations": False},
    "times": {"name": "Irish Times Crosaire", "short": "The Times", "setters": True, "explanations": True},
}

ap = argparse.ArgumentParser()
for s in SOURCES:
    ap.add_argument(f"--{s}", nargs="*", default=[], metavar="JSONL")
ap.add_argument("-o", "--out", default="data")
a = ap.parse_args()

def clean(path, drop):
    seen, rows = set(), []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                drop["unparseable line"] += 1; continue
            clue = html.unescape(TAGS.sub("", r.get("clue") or "")).strip()
            clue = re.sub(r"\s+", " ", clue)
            ans, en = (r.get("answer") or "").upper(), (r.get("enumeration") or "").strip()
            if r.get("warning"):                        drop["parser warning"] += 1; continue
            if not re.search(r"[A-Za-z]", clue):        drop["empty clue"] += 1; continue
            if not en:                                  drop["missing enumeration"] += 1; continue
            if not re.fullmatch(r"[A-Z]+", ans):        drop["non-alphabetic answer"] += 1; continue
            if sum(map(int, re.findall(r"\d+", en))) != len(ans):
                                                        drop["enumeration mismatch"] += 1; continue
            if XREF.search(clue):                       drop["cross-reference clue"] += 1; continue
            key = (norm(clue), ans)
            if key in seen:                             drop["duplicate"] += 1; continue
            seen.add(key)
            row = [clue, en, ans, r.get("date") or "", str(r.get("number") or ""), r.get("direction") or ""]
            expl = (r.get("explanation") or "").strip()
            if expl:
                row.append(re.sub(r"\s+", " ", html.unescape(TAGS.sub("", expl))))
            rows.append((r.get("author") or None, row))
    return rows

def split_years(rows):
    """Split a list of rows into runs of <= CHUNK_MAX, cutting at year boundaries."""
    rows.sort(key=lambda r: r[3])
    if len(rows) <= CHUNK_MAX:
        return [rows]
    by_year = defaultdict(list)
    for r in rows:
        by_year[r[3][:4]].append(r)
    out, cur = [], []
    for y in sorted(by_year):
        if cur and len(cur) + len(by_year[y]) > CHUNK_MAX:
            out.append(cur); cur = []
        cur.extend(by_year[y])
    if cur:
        out.append(cur)
    return out

os.makedirs(os.path.join(a.out, "chunks"), exist_ok=True)
for old in os.listdir(os.path.join(a.out, "chunks")):
    os.remove(os.path.join(a.out, "chunks", old))
manifest = {"sources": []}
grand = 0
for sid, meta in SOURCES.items():
    paths = getattr(a, sid)
    if not paths:
        continue
    drop = Counter()
    tagged = []
    for p in paths:
        tagged.extend(clean(p, drop))
    # dedupe across files of the same source too
    seen, by_author = set(), defaultdict(list)
    for author, row in tagged:
        k = (norm(row[0]), row[2])
        if k in seen:
            drop["duplicate"] += 1; continue
        seen.add(k)
        by_author[author if meta["setters"] else None].append(row)

    src = {"id": sid, "name": meta["name"], "short": meta["short"], "setters": meta["setters"],
           "explanations": meta["explanations"], "count": 0, "explained": 0, "chunks": []}
    for author in sorted(by_author, key=lambda x: (-len(by_author[x]), x or "")):
        rows = by_author[author]
        for part in split_years(rows):
            years = f"{part[0][3][:4]}-{part[-1][3][:4]}" if part[0][3][:4] != part[-1][3][:4] else part[0][3][:4]
            slug = re.sub(r"[^a-z0-9]+", "-", (author or "unattributed").lower()).strip("-")
            fname = f"{sid}-{slug}-{years}.json" if len(split_years(rows)) > 1 else f"{sid}-{slug}.json"
            with open(os.path.join(a.out, "chunks", fname), "w", encoding="utf-8") as f:
                json.dump(part, f, ensure_ascii=False, separators=(",", ":"))
            explained = sum(1 for r in part if len(r) > 6)
            src["chunks"].append({"file": f"chunks/{fname}", "author": author, "years": years,
                                  "count": len(part), "explained": explained,
                                  "bytes": os.path.getsize(os.path.join(a.out, "chunks", fname))})
            src["count"] += len(part); src["explained"] += explained
    manifest["sources"].append(src)
    grand += src["count"]
    print(f"{sid}: {src['count']} clues ({src['explained']} with explanations) in {len(src['chunks'])} files", file=sys.stderr)
    for k, v in drop.most_common():
        print(f"  dropped {v:>6}  {k}", file=sys.stderr)

manifest["total"] = grand
with open(os.path.join(a.out, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=1)
print(f"total {grand} clues -> {a.out}/manifest.json", file=sys.stderr)
