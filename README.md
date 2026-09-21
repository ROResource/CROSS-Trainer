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

## Files

```
index.html       markup
style.css        newsprint / biro / highlighter design tokens, light + dark
app.js           clue deck, grid builder, input handling, scoring
data/clues.json  the clue library (compact arrays, see below)
build_clues.py   JSONL → clues.json converter
```

`data/clues.json` is a JSON array of rows:

```
[clue, enumeration, answer, date, number, direction]
["Produce another printing of a book about children", "7", "REISSUE", "2026-09-08", "23", "across"]
```

## Updating the clue library

1. Collect clues with `pa_clues.py` (kept alongside this project) into a JSONL file, e.g.

   ```
   python pa_clues.py --pid 38 --cs 26 --start 2013-10-28 --end 2026-09-21 -o indo_cryptic.jsonl
   ```

2. Convert it for the site (dedupes on clue+answer, drops records that carried a parser warning):

   ```
   python build_clues.py indo_cryptic.jsonl
   ```

3. Commit `data/clues.json` and push. The full Irish Independent archive (~95k clues) comes to roughly 8 MB, which is still a one-off download that the browser caches.

## Running locally

Any static server works, e.g. `python -m http.server` in this folder, then open http://localhost:8000/.
