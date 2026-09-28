/* CROSS-Trainer — random cryptic clue practice
   data/manifest.json lists sources/setters and their chunk files;
   each chunk row is [clue, enumeration, answer, date, number, direction, explanation?] */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = {
    card: $('card'), clue: $('clue-text'), grid: $('grid'), feedback: $('feedback'),
    source: $('meta-source'), authorWrap: $('meta-author-wrap'), author: $('meta-author'),
    date: $('meta-date'), pos: $('meta-pos'),
    explain: $('explain'), explainText: $('explain-text'),
    solve: $('btn-solve'), reveal: $('btn-reveal'), next: $('btn-next'),
    hint: $('btn-hint'), hintLabel: $('hint-label'),
    solved: $('stat-solved'), streak: $('stat-streak'), footCount: $('foot-count'),
    deckToggle: $('deck-toggle'), deckPanel: $('deck-panel'), deckDesc: $('deck-desc'), deckCount: $('deck-count'),
    deckTotal: $('deck-total'), deckDone: $('deck-done'),
    srcChips: $('src-chips'), ageChips: $('age-chips'), timesChips: $('times-chips'), explChips: $('expl-chips'),
  };

  // ---------------------------------------------------------------- state
  let manifest = null;
  const chunkCache = new Map();   // file -> rows (or a pending Promise)
  let pool = [];                  // [chunkRef, rowIndex] pairs for the active deck
  let deck = [];                  // shuffled indices into pool, consumed from the end
  let deckVersion = 0;            // bumps on every filter change so stale loads are ignored
  let current = null;             // {clue, enumeration, answer, date, number, direction, explanation, source, author}
  let cells = [];
  let hintMode = false;
  let finished = false;
  let hintsUsed = 0;
  const stats = load('ct-stats', { solved: 0, streak: 0 });
  // filter: which papers, which setters per paper, and (Times) explanations all|with|without
  const filter = load('ct-deck', { sources: ['indo'], authors: {}, expl: 'all' });

  function load(key, fallback) {
    try { return Object.assign({}, fallback, JSON.parse(localStorage.getItem(key)) || {}); }
    catch { return { ...fallback }; }
  }
  function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sandboxed */ } }
  const fmtN = (n) => n.toLocaleString('en-IE');
  const authorName = (a) => a || 'Unattributed';

  // ---------------------------------------------------------------- data
  async function boot() {
    try {
      const res = await fetch('data/manifest.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      manifest = await res.json();
    } catch (err) {
      el.clue.textContent = 'Could not load the clue library. Run build_clues.py and reload.';
      el.solve.disabled = el.reveal.disabled = el.next.disabled = true;
      return;
    }
    // default: every setter of every paper is in, unless the user saved a choice
    for (const s of manifest.sources) {
      if (s.setters && !Array.isArray(filter.authors[s.id])) filter.authors[s.id] = uniqueAuthors(s);
    }
    filter.sources = filter.sources.filter((id) => manifest.sources.some((s) => s.id === id));
    if (!filter.sources.length) filter.sources = ['indo'];
    el.footCount.textContent = fmtN(manifest.total);
    renderStats();
    renderDeckControls();
    rebuildDeck();
  }

  const srcById = (id) => manifest.sources.find((s) => s.id === id);
  const uniqueAuthors = (s) => [...new Set(s.chunks.map((c) => c.author))];

  // chunks the current filter needs
  function activeChunks() {
    const out = [];
    for (const id of filter.sources) {
      const s = srcById(id);
      if (!s) continue;
      for (const c of s.chunks) {
        if (s.setters && !filter.authors[id].includes(c.author)) continue;
        if (s.explanations && filter.expl === 'with' && c.explained === 0) continue;
        if (s.explanations && filter.expl === 'without' && c.explained === c.count) continue;
        out.push({ src: s, chunk: c });
      }
    }
    return out;
  }
  // how many clues a chunk contributes under the explanation filter
  function chunkCount(src, c) {
    if (!src.explanations || filter.expl === 'all') return c.count;
    return filter.expl === 'with' ? c.explained : c.count - c.explained;
  }
  function deckSize() { return activeChunks().reduce((n, { src, chunk }) => n + chunkCount(src, chunk), 0); }

  function fetchChunk(file) {
    if (!chunkCache.has(file)) {
      chunkCache.set(file, fetch('data/' + file).then((r) => { if (!r.ok) throw new Error(file); return r.json(); })
        .then((rows) => { chunkCache.set(file, rows); return rows; })
        .catch((e) => { chunkCache.delete(file); throw e; }));
    }
    return Promise.resolve(chunkCache.get(file));
  }

  async function rebuildDeck() {
    const version = ++deckVersion;
    const active = activeChunks();
    const total = deckSize();
    renderDeckSummary(total);
    if (!active.length || !total) {
      pool = []; deck = [];
      showEmpty('Nothing in the deck — pick at least one paper or setter.');
      return;
    }
    const toLoad = active.filter(({ chunk }) => !Array.isArray(chunkCache.get(chunk.file)));
    if (toLoad.length) {
      const mb = toLoad.reduce((n, { chunk }) => n + chunk.bytes, 0) / 1e6;
      showLoading(`Loading ${fmtN(total)} clues${mb > 1 ? ` (${mb.toFixed(1)} MB, one-off)` : ''}…`);
      markLoadingChips(toLoad, true);
    }
    try {
      const loaded = await Promise.all(active.map(({ src, chunk }) => fetchChunk(chunk.file).then((rows) => ({ src, chunk, rows }))));
      if (version !== deckVersion) return;   // filter changed meanwhile
      pool = [];
      for (const { src, chunk, rows } of loaded) {
        const ref = { src, chunk, rows };
        for (let i = 0; i < rows.length; i++) {
          if (src.explanations && filter.expl !== 'all') {
            const has = rows[i].length > 6;
            if ((filter.expl === 'with') !== has) continue;
          }
          pool.push([ref, i]);
        }
      }
      deck = [];
      markLoadingChips(toLoad, false);
      nextClue();
    } catch (e) {
      if (version !== deckVersion) return;
      markLoadingChips(toLoad, false);
      showEmpty('Could not download part of the library. Check your connection and try again.');
    }
  }

  function shuffle(n) {
    const a = new Uint32Array(n);
    for (let i = 0; i < n; i++) a[i] = i;
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return Array.from(a);
  }

  function draw() {
    if (!pool.length) return null;
    if (!deck.length) deck = shuffle(pool.length);
    const [ref, i] = pool[deck.pop()];
    const [clue, enumeration, answer, date, number, direction, explanation] = ref.rows[i];
    return { clue, enumeration, answer: answer.toUpperCase(), date, number, direction, explanation: explanation || '',
             source: ref.src, author: ref.chunk.author };
  }

  // ---------------------------------------------------------------- deck controls
  function chip(label, count, pressed, onClick) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.setAttribute('aria-pressed', String(pressed));
    b.innerHTML = `<span>${escapeHtml(label)}</span> <span class="count">${fmtN(count)}</span>`;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderDeckControls() {
    // papers
    el.srcChips.innerHTML = '';
    for (const s of manifest.sources) {
      el.srcChips.appendChild(chip(s.short, s.count, filter.sources.includes(s.id), () => {
        const on = filter.sources.includes(s.id);
        if (on && filter.sources.length === 1) { nudge(el.srcChips); return; }     // keep at least one paper
        filter.sources = on ? filter.sources.filter((x) => x !== s.id) : [...filter.sources, s.id];
        changed();
      }));
    }
    // setters
    for (const s of manifest.sources) {
      if (!s.setters) continue;
      const box = $(`${s.id}-chips`), group = $(`group-${s.id}`);
      if (!box) continue;
      group.hidden = !filter.sources.includes(s.id);
      box.innerHTML = '';
      const totals = {};
      for (const c of s.chunks) totals[c.author] = (totals[c.author] || 0) + chunkCount(s, c);
      for (const a of uniqueAuthors(s)) {
        box.appendChild(chip(authorName(a), totals[a], filter.authors[s.id].includes(a), () => {
          const list = filter.authors[s.id];
          filter.authors[s.id] = list.includes(a) ? list.filter((x) => x !== a) : [...list, a];
          changed();
        }));
      }
    }
    // explanations (Times)
    const times = manifest.sources.find((s) => s.explanations);
    const explGroup = $('group-expl');
    if (times && explGroup) {
      explGroup.hidden = !filter.sources.includes(times.id);
      const inScope = times.chunks.filter((c) => filter.authors[times.id].includes(c.author));
      const all = inScope.reduce((n, c) => n + c.count, 0), with_ = inScope.reduce((n, c) => n + c.explained, 0);
      el.explChips.innerHTML = '';
      [['all', 'All', all], ['with', 'With explanation', with_], ['without', 'Without', all - with_]].forEach(([v, label, n]) => {
        el.explChips.appendChild(chip(label, n, filter.expl === v, () => { filter.expl = v; changed(); }));
      });
    }
    renderDeckSummary(deckSize());
  }

  function renderDeckSummary(total) {
    const parts = filter.sources.map((id) => {
      const s = srcById(id);
      if (!s) return '';
      if (!s.setters) return s.short;
      const all = uniqueAuthors(s), picked = filter.authors[id];
      const who = picked.length === all.length ? '' : picked.length === 0 ? ' (nobody)' : ` (${picked.map(authorName).join(', ')})`;
      const ex = s.explanations && filter.expl !== 'all' ? (filter.expl === 'with' ? ', explained' : ', unexplained') : '';
      return s.short + who + ex;
    }).filter(Boolean);
    const everything = filter.sources.length === manifest.sources.length && parts.every((p, i) => p === srcById(filter.sources[i]).short);
    el.deckDesc.textContent = everything ? 'All papers, all setters' : (parts.join(' · ') || 'Nothing selected');
    el.deckCount.textContent = fmtN(total);
    el.deckTotal.innerHTML = `<b>${fmtN(total)}</b> clue${total === 1 ? '' : 's'} in this deck`;
  }

  function markLoadingChips(list, on) {
    const ids = new Set(list.map(({ src }) => src.id));
    for (const b of el.srcChips.children) {
      const s = manifest.sources.find((x) => x.short === b.firstChild.textContent);
      if (s) b.classList.toggle('is-loading', on && ids.has(s.id));
    }
  }
  function nudge(node) { node.classList.remove('nudge'); void node.offsetWidth; node.classList.add('nudge'); }

  function changed() {
    save('ct-deck', filter);
    renderDeckControls();
    rebuildDeck();
  }

  function setDeckOpen(open) {
    el.deckPanel.hidden = !open;
    el.deckToggle.setAttribute('aria-expanded', String(open));
  }
  el.deckToggle.addEventListener('click', () => setDeckOpen(el.deckPanel.hidden));
  el.deckDone.addEventListener('click', () => { setDeckOpen(false); focusCell(0); });
  document.querySelectorAll('[data-all],[data-none]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.all || b.dataset.none;
    filter.authors[id] = b.dataset.all ? uniqueAuthors(srcById(id)) : [];
    changed();
  }));

  // ---------------------------------------------------------------- render
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
  }
  function fmtPos(number, direction) {
    const nums = number.split('/'), dirs = direction.split('-');
    return nums.map((n, i) => `${n} ${cap(dirs[i] || dirs[0])}`).join(' / ');
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function showLoading(msg) {
    finished = true; current = null;
    el.card.classList.remove('is-correct', 'is-wrong');
    el.clue.className = 'clue is-loading'; el.clue.textContent = msg;
    el.grid.innerHTML = ''; cells = [];
    for (let i = 0; i < 7; i++) { const g = document.createElement('input'); g.className = 'cell ghost'; g.disabled = true; el.grid.appendChild(g); }
    el.grid.style.removeProperty('--cell');
    setFeedback(''); el.explain.hidden = true;
    el.solve.disabled = el.reveal.disabled = el.next.disabled = true;
  }
  function showEmpty(msg) {
    showLoading(msg);
    el.grid.innerHTML = '';
    setDeckOpen(true);
  }

  function nextClue() {
    const next = draw();
    if (!next) { showEmpty('Nothing in the deck — pick at least one paper or setter.'); return; }
    current = next;
    finished = false; hintsUsed = 0;
    el.card.classList.remove('is-correct', 'is-wrong');
    setFeedback(''); el.explain.hidden = true;
    el.solve.disabled = el.reveal.disabled = el.next.disabled = false;

    el.clue.className = 'clue is-fading';
    setTimeout(() => {
      el.source.textContent = current.source.name;
      el.authorWrap.hidden = !current.source.setters;
      el.author.textContent = current.source.setters ? authorName(current.author) : '';
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
    if (current.explanation) { el.explainText.textContent = current.explanation; el.explain.hidden = false; }
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
    if (e.target.classList.contains('cell') || e.target.closest('.deck')) return;
    if (e.key === 'Enter' && finished && current) { e.preventDefault(); nextClue(); }
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
