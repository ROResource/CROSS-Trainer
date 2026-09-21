#!/usr/bin/env python3
"""
build_clues.py - turn a pa_clues.py JSONL library into the compact data file
the CROSS-Trainer site loads.

    python build_clues.py indo_cryptic.jsonl            # -> data/clues.json
    python build_clues.py a.jsonl b.jsonl -o data/clues.json

Each clue becomes a small array to keep the download light on mobile:
    [clue, enumeration, answer, date, number, direction]

Cleaning rules (counts are reported on stderr):
  * drop records carrying a parser "warning" (grid/enumeration mismatch)
  * drop records with no enumeration or a non-alphabetic answer (grid glitches)
  * drop cross-reference clues that cannot stand alone ("See 9", "& 11Dn. ...",
    "... a 19 & 9 Across")
  * dedupe on (normalised clue, answer) - case, spacing and punctuation are
    ignored, so "Distinguished for being unskilled?" and the same clue without
    the question mark count as one. The earliest appearance is kept.
"""
import argparse, json, re, sys
from collections import Counter

XREF = re.compile(r"(^\s*see\s+\d)|(^\s*&\s*\d)|(\b\d+\s*(across|down|ac|dn)\b)", re.I)
norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())

ap = argparse.ArgumentParser()
ap.add_argument("jsonl", nargs="+")
ap.add_argument("-o", "--out", default="data/clues.json")
a = ap.parse_args()

seen, rows, drop = set(), [], Counter()
for path in a.jsonl:
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            clue, ans, en = (r.get("clue") or "").strip(), r.get("answer") or "", r.get("enumeration") or ""
            if r.get("warning"):                       drop["warning"] += 1; continue
            if not clue or not en:                     drop["missing enumeration"] += 1; continue
            if not re.fullmatch(r"[A-Z]+", ans):       drop["non-alphabetic answer"] += 1; continue
            if sum(map(int, re.findall(r"\d+", en))) != len(ans):
                                                       drop["enumeration mismatch"] += 1; continue
            if XREF.search(clue):                      drop["cross-reference clue"] += 1; continue
            key = (norm(clue), ans)
            if key in seen:                            drop["duplicate"] += 1; continue
            seen.add(key)
            rows.append([clue, en, ans, r["date"], r["number"], r["direction"]])

rows.sort(key=lambda x: (x[3], x[5], int(re.match(r"\d+", x[4]).group()) if re.match(r"\d+", x[4]) else 0))
with open(a.out, "w", encoding="utf-8") as f:
    json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
print(f"{len(rows)} clues -> {a.out}", file=sys.stderr)
for k, v in drop.most_common():
    print(f"  dropped {v:>6}  {k}", file=sys.stderr)
