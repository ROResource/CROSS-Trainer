# CROSS-Trainer

A small, mobile-first trainer for cryptic crossword clues. It presents a random clue from the library, draws the answer squares (split by word, with hyphens shown), and lets you type, check, get letter hints or reveal the solution.

Live: https://roresource.github.io/CROSS-Trainer/

## Controls

| Action | Touch | Keyboard |
| --- | --- | --- |
| Fill a square | tap, then type | type — moves on automatically |
| Check the answer | **Solve** | `Enter` |
| Next clue | **Next clue** | `Enter` again after solving/revealing |
| Reveal one letter | turn on **Hint mode**, tap a square | same |
| Reveal everything | **Show solution** | — |
| Move / clear | tap a square | `←` `→` `⌫` |

Correct answers turn the squares green and bump the solved count and streak. A wrong attempt shakes the card and flags the wrong letters. Showing the solution (or revealing every letter) resets the streak. Stats and theme choice are stored locally in the browser.

## Deck

The **Deck** bar above the clue chooses what is in play. Every toggle shows how many clues it holds.

- **Paper** — Irish Independent Two-in-One Cryptic, The Age cryptic, Irish Times Crosaire (multi-select, at least one).
- **Setter** — for The Age and The Times, tick individual setters (Crosaire clues before 2022 are unattributed).
- **Explanations** — for The Times: all clues, only those with a published explanation, or only those without. Explanations appear under the answer once you solve or reveal.

The deck choice is remembered in the browser. Only the files a deck needs are downloaded, and each is fetched once.

## Files

```
index.html          markup
style.css           newsprint / biro / highlighter design tokens, light + dark
app.js              manifest + lazy chunk loading, deck filters, grid builder, input handling, scoring
data/manifest.json  sources, setters and counts (what the toggles show)
data/chunks/*.json  the clues, one file per paper/setter (large ones split by year)
build_clues.py      JSONL -> manifest + chunks
```

Each clue row is a compact array:

```
[clue, enumeration, answer, date, number, direction, explanation?]
["Produce another printing of a book about children", "7", "REISSUE", "2026-09-08", "23", "across"]
```

## Updating the clue library

1. Collect clues into JSONL with the scrapers (`pa_clues.py` for the Indo; the Age and Crosaire scrapers emit the same schema plus `author` and `explanation`).
2. Rebuild the data files — the cleaning counts are printed:

   ```
   python build_clues.py --indo indo_cryptic.jsonl --age age_cryptic.jsonl --times crosaire.jsonl
   ```

   Cleaning: drops parser warnings, missing enumerations, non-alphabetic answers, enumeration/answer length mismatches, cross-reference clues ("See 9", "one-third of 14 across"), strips HTML tags, and dedupes within each paper on clue+answer ignoring case and punctuation (earliest kept).

3. Commit `data/` and push.

Current library: 387,639 clues — Irish Independent 79,110 (2013–), The Age 74,386 (2019–, 13 setters), Irish Times Crosaire 234,143 (1998–, 40,926 with explanations). About 37 MB on disk; the Indo alone is ~2.2 MB compressed.

## Running locally

Any static server works, e.g. `python -m http.server` in this folder, then open http://localhost:8000/.
