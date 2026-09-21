/* CROSS-Trainer — random cryptic clue practice
   data/clues.json rows: [clue, enumeration, answer, date, number, direction] */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = {
    card: $('card'), clue: $('clue-text'), grid: $('grid'), feedback: $('feedback'),
    date: $('meta-date'), pos: $('meta-pos'),
    solve: $('btn-solve'), reveal: $('btn-reveal'), next: $('btn-next'),
    hint: $('btn-hint'), hintLabel: $('hint-label'),
    solved: $('stat-solved'), streak: $('stat-streak'), footCount: $('foot-count'),
  };

  // ---------------------------------------------------------------- state
  let clues = [];
  let deck = [];            // shuffled indices, consumed from the end
  let current = null;       // {clue, enum, answer, date, number, direction}
  let cells = [];           // <input> elements in answer order
  let hintMode = false;
  let finished = false;     // solved or revealed
  let hintsUsed = 0;
  const stats = load('ct-stats', { solved: 0, streak: 0 });

  function load(key, fallback) {
    try { return Object.assign({}, fallback, JSON.parse(localStorage.getItem(key)) || {}); }
    catch { return { ...fallback }; }
  }
  function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sandboxed */ } }

  // ---------------------------------------------------------------- data
  async function boot() {
    try {
      const res = await fetch('data/clues.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      clues = await res.json();
    } catch (err) {
      el.clue.textContent = 'Could not load clues.json. Run build_clues.py and reload.';
      el.solve.disabled = el.reveal.disabled = el.next.disabled = true;
      return;
    }
    el.footCount.textContent = clues.length.toLocaleString();
    renderStats();
    nextClue();
  }

  function shuffle(n) {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function draw() {
    if (!deck.length) deck = shuffle(clues.length);
    const [clue, enumeration, answer, date, number, direction] = clues[deck.pop()];
    return { clue, enumeration, answer: answer.toUpperCase(), date, number, direction };
  }

  // ---------------------------------------------------------------- render
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
  }
  function fmtPos(number, direction) {
    const nums = number.split('/'), dirs = direction.split('-');
    return nums.map((n, i) => `${n} ${cap(dirs[i] || dirs[0])}`).join(' / ');
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function nextClue() {
    current = draw();
    finished = false; hintsUsed = 0;
    el.card.classList.remove('is-correct', 'is-wrong');
    setFeedback('');
    el.solve.disabled = el.reveal.disabled = false;

    el.clue.classList.add('is-fading');
    setTimeout(() => {
      el.date.textContent = fmtDate(current.date);
      el.pos.textContent = fmtPos(current.number, current.direction);
      el.clue.innerHTML = `${escapeHtml(current.clue)} <span class="enum">(${current.enumeration})</span>`;
      buildGrid(current.enumeration, current.answer.length);
      fitCells();
      el.clue.classList.remove('is-fading');
      focusCell(0);
    }, 120);
  }

  function buildGrid(enumeration, total) {
    el.grid.innerHTML = '';
    cells = [];
    let word = null, i = 0;
    const tokens = enumeration.match(/\d+|[,\-']/g) || [String(total)];
    for (const tok of tokens) {
      if (tok === ',') { word = null; continue; }
      if (!word) { word = document.createElement('span'); word.className = 'word'; el.grid.appendChild(word); }
      if (tok === '-' || tok === "'") {
        const sep = document.createElement('span'); sep.className = 'sep'; sep.textContent = tok === '-' ? '–' : '’';
        sep.setAttribute('aria-hidden', 'true'); word.appendChild(sep); continue;
      }
      for (let n = Number(tok); n > 0; n--) word.appendChild(makeCell(i++, total));
    }
    // enumeration/answer disagree (shouldn't happen after build_clues.py) — pad plainly
    while (i < total) {
      if (!word) { word = document.createElement('span'); word.className = 'word'; el.grid.appendChild(word); }
      word.appendChild(makeCell(i++, total));
    }
  }

  // Shrink squares so the longest word (incl. hyphen parts) fits the card width.
  // Below a readable minimum, wrap the word instead — in balanced rows, not with an orphan.
  function fitCells() {
    const avail = el.grid.clientWidth;
    if (!avail) return;
    const MAX = 44, MIN = 26, GAP = 2;
    const words = [...el.grid.querySelectorAll('.word')];
    const widthFor = (n, s) => n === 0 ? 0 : (avail - (n + s - 1) * GAP - 2) / (n + s * 0.4);

    // pass 1: keep every word on one row if squares stay readable
    let px = MAX;
    for (const w of words) px = Math.min(px, Math.floor(widthFor(w.querySelectorAll('.cell').length, w.querySelectorAll('.sep').length)));
    let breakHyphens = false;
    if (px < MIN) {
      // pass 2: size by hyphen parts instead, and break hyphenated words after the hyphen
      breakHyphens = true; px = MAX;
      for (const w of words) {
        if (w.querySelector('.sep')) {
          let run = 0;
          for (const c of w.children) { if (c.classList.contains('sep')) { px = Math.min(px, Math.floor(widthFor(run, 0))); run = 0; } else run++; }
          px = Math.min(px, Math.floor(widthFor(run, 0)));
        } else px = Math.min(px, Math.floor(widthFor(w.children.length, 0)));
      }
      px = Math.max(MIN, px);
    }
    el.grid.style.setProperty('--cell', px + 'px');

    for (const w of words) {
      w.querySelectorAll('.break').forEach((b) => b.remove());
      w.style.maxWidth = '';
      const n = w.querySelectorAll('.cell').length, seps = w.querySelectorAll('.sep');
      const needed = n * px + seps.length * 0.4 * px + (n + seps.length - 1) * GAP;
      if (needed <= avail) continue;
      if (seps.length && breakHyphens) {
        seps.forEach((sep) => { const b = document.createElement('span'); b.className = 'break'; sep.after(b); });
      } else {
        const rows = Math.ceil(needed / avail);            // plain word too long even at MIN: balanced rows
        w.style.maxWidth = (Math.ceil(n / rows) * (px + GAP)) + 'px';
      }
    }
  }
  addEventListener('resize', fitCells);

  function makeCell(index, total) {
    const c = document.createElement('input');
    c.className = 'cell'; c.type = 'text'; c.maxLength = 2; c.inputMode = 'text';
    c.autocomplete = 'off'; c.autocapitalize = 'characters'; c.spellcheck = false;
    c.setAttribute('autocorrect', 'off');
    c.setAttribute('aria-label', `Letter ${index + 1} of ${total}`);
    c.dataset.i = index;
    c.addEventListener('input', onInput);
    c.addEventListener('keydown', onKey);
    c.addEventListener('pointerdown', onPointer);
    c.addEventListener('focus', () => c.select());
    cells.push(c);
    return c;
  }

  // ---------------------------------------------------------------- input
  function onInput(e) {
    const c = e.target;
    if (c.readOnly) { c.value = c.dataset.letter || ''; return; }
    const ch = (e.data || c.value.slice(-1) || '').toUpperCase();
    if (/^[A-Z]$/.test(ch)) {
      c.value = ch; c.classList.remove('is-wrong'); pop(c);
      focusCell(nextEmpty(idx(c) + 1));
    } else {
      c.value = '';
    }
    clearVerdict();
  }

  function onKey(e) {
    const c = e.target, i = idx(c);
    switch (e.key) {
      case 'Backspace':
        e.preventDefault();
        if (c.readOnly) { focusCell(i - 1); break; }
        if (c.value) { c.value = ''; c.classList.remove('is-wrong'); }
        else { const p = prevEditable(i - 1); if (p >= 0) { cells[p].value = ''; cells[p].classList.remove('is-wrong'); focusCell(p); } }
        clearVerdict();
        break;
      case 'Delete': if (!c.readOnly) { e.preventDefault(); c.value = ''; clearVerdict(); } break;
      case 'ArrowLeft': e.preventDefault(); focusCell(i - 1); break;
      case 'ArrowRight': e.preventDefault(); focusCell(i + 1); break;
      case 'Home': e.preventDefault(); focusCell(0); break;
      case 'End': e.preventDefault(); focusCell(cells.length - 1); break;
      case 'Enter': e.preventDefault(); finished ? nextClue() : solve(); break;
      case ' ': e.preventDefault(); focusCell(i + 1); break;
      default:
        // a letter typed over an existing letter: let onInput replace it
        if (e.key.length === 1 && !/[a-zA-Z]/.test(e.key)) e.preventDefault();
    }
  }

  function onPointer(e) {
    if (hintMode && !finished) {
      e.preventDefault();
      revealCell(e.currentTarget);
    }
  }

  const idx = (c) => Number(c.dataset.i);
  function focusCell(i) {
    if (i < 0 || i >= cells.length) return;
    cells[i].focus({ preventScroll: true });
  }
  function nextEmpty(from) {
    for (let j = from; j < cells.length; j++) if (!cells[j].value && !cells[j].readOnly) return j;
    return Math.min(from, cells.length - 1);
  }
  function prevEditable(from) {
    for (let j = from; j >= 0; j--) if (!cells[j].readOnly) return j;
    return -1;
  }
  function pop(c) { c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); }

  // ---------------------------------------------------------------- actions
  function revealCell(c) {
    if (c.readOnly) return;
    const i = idx(c);
    c.value = current.answer[i]; c.dataset.letter = c.value;
    c.readOnly = true; c.classList.remove('is-wrong'); c.classList.add('is-hint'); pop(c);
    hintsUsed++;
    setFeedback(`${hintsUsed} letter${hintsUsed === 1 ? '' : 's'} revealed`);
    if (cells.every((x) => x.readOnly)) finish('revealed');
  }

  function solve() {
    if (finished) return;
    const guess = cells.map((c) => c.value.toUpperCase() || ' ').join('');
    const empty = cells.filter((c) => !c.value).length;
    if (empty === cells.length) { setFeedback('Type your answer into the squares first.'); focusCell(0); return; }

    if (guess === current.answer) { finish('solved'); return; }

    // wrong: shake, flag the wrong letters, say how close they got
    let right = 0;
    cells.forEach((c, i) => {
      if (!c.value) return;
      if (c.value.toUpperCase() === current.answer[i]) right++;
      else c.classList.add('is-wrong');
    });
    el.card.classList.remove('is-wrong'); void el.card.offsetWidth; el.card.classList.add('is-wrong');
    const msg = empty
      ? `Not quite — ${empty} square${empty === 1 ? '' : 's'} still empty.`
      : `Not quite — ${right} of ${cells.length} letters right. Keep going.`;
    setFeedback(msg, 'bad');
    const firstWrong = cells.findIndex((c) => c.classList.contains('is-wrong') || !c.value);
    focusCell(firstWrong);
  }

  function showSolution() {
    if (finished) return;
    finish('revealed');
  }

  function finish(how) {
    finished = true;
    el.solve.disabled = el.reveal.disabled = true;
    cells.forEach((c, i) => {
      c.value = current.answer[i]; c.readOnly = true; c.classList.remove('is-wrong');
      if (how === 'solved') c.classList.add(c.classList.contains('is-hint') ? 'is-hint' : 'is-right');
      else if (!c.classList.contains('is-hint')) c.classList.add('is-revealed');
    });
    const display = formatAnswer(current.answer, current.enumeration);
    if (how === 'solved') {
      el.card.classList.add('is-correct');
      stats.solved++; stats.streak++;
      const withHints = hintsUsed ? ` (with ${hintsUsed} hint${hintsUsed === 1 ? '' : 's'})` : '';
      setFeedback(`Correct — ${display}${withHints}`, 'ok');
    } else {
      stats.streak = 0;
      setFeedback(`The answer was ${display}.`);
    }
    save('ct-stats', stats); renderStats();
    el.next.focus({ preventScroll: true });
  }

  function formatAnswer(letters, enumeration) {
    let out = '', i = 0;
    for (const tok of enumeration.match(/\d+|[,\-']/g) || []) {
      if (/\d/.test(tok)) { out += letters.slice(i, i + Number(tok)); i += Number(tok); }
      else out += tok === ',' ? ' ' : tok;
    }
    return i === letters.length ? out : letters;
  }

  function clearVerdict() {
    if (el.feedback.classList.contains('bad')) setFeedback('');
  }
  function setFeedback(text, kind) {
    el.feedback.textContent = text;
    el.feedback.className = 'feedback' + (kind ? ' ' + kind : '');
  }
  function renderStats() {
    el.solved.textContent = stats.solved;
    el.streak.textContent = stats.streak;
  }
  function toggleHint() {
    hintMode = !hintMode;
    el.hint.setAttribute('aria-pressed', String(hintMode));
    el.hintLabel.textContent = `Hint mode: ${hintMode ? 'on' : 'off'}`;
    el.grid.classList.toggle('is-hinting', hintMode);
    $('tools-note').textContent = hintMode ? 'Tap any square to reveal its letter.' : 'Turn on, then tap a square to reveal its letter.';
  }
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  // ---------------------------------------------------------------- wire up
  el.solve.addEventListener('click', solve);
  el.reveal.addEventListener('click', showSolution);
  el.next.addEventListener('click', nextClue);
  el.hint.addEventListener('click', toggleHint);
  document.addEventListener('keydown', (e) => {
    if (e.target.classList.contains('cell')) return;
    if (e.key === 'Enter' && finished) { e.preventDefault(); nextClue(); }
  });

  // theme
  (function () {
    const t = document.querySelector('[data-theme-toggle]'), r = document.documentElement;
    const SUN = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
    const MOON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    let d = load('ct-theme', { v: matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light' }).v;
    const apply = () => {
      r.setAttribute('data-theme', d);
      t.setAttribute('aria-label', 'Switch to ' + (d === 'dark' ? 'light' : 'dark') + ' mode');
      t.innerHTML = d === 'dark' ? SUN : MOON;
    };
    apply();
    t.addEventListener('click', () => { d = d === 'dark' ? 'light' : 'dark'; save('ct-theme', { v: d }); apply(); });
  })();

  boot();
})();
