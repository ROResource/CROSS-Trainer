#!/usr/bin/env python3
"""
build_clues.py - turn a pa_clues.py JSONL library into the compact data file
the CROSS-Trainer site loads.

    python build_clues.py indo_cryptic.jsonl            # -> data/clues.json
    python build_clues.py a.jsonl b.jsonl -o data/clues.json

Each clue becomes a small array to keep the download light on mobile:
    [clue, enumeration, answer, date, number, direction]
A 95k-clue library comes out around 8 MB (vs ~20 MB as raw JSONL).
Records with a "warning" (grid/enumeration mismatch) are dropped.
"""
import argparse, json, sys

ap = argparse.ArgumentParser()
ap.add_argument("jsonl", nargs="+")
ap.add_argument("-o", "--out", default="data/clues.json")
a = ap.parse_args()

seen, rows = set(), []
for path in a.jsonl:
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            if r.get("warning") or not r.get("answer") or not r.get("enumeration"):
                continue
            key = (r["clue"], r["answer"])
            if key in seen:            # same clue reused on another day
                continue
            seen.add(key)
            rows.append([r["clue"], r["enumeration"], r["answer"], r["date"], r["number"], r["direction"]])

with open(a.out, "w", encoding="utf-8") as f:
    json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
print(f"{len(rows)} clues -> {a.out}", file=sys.stderr)
