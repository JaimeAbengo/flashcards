// Match: tap matching pairs as fast as possible.
import { h, shuffle } from '../util.js';
import { S, setKV } from '../store.js';
import { itemsFor, missed, endScreen } from './index.js';

export function match({ deckId, body, close, restart }) {
  const items = shuffle(itemsFor(deckId, { short: true })).slice(0, 6);
  const timer = h('span', '0.0s'); const left = h('span.muted', { style: { fontSize: '15px' } });
  const grid = h('div.match-grid');
  const tiles = shuffle(items.flatMap(it => [{ it, text: it.q }, { it, text: it.a }]));
  let sel = null, matched = 0, penalty = 0, t0 = 0, raf, wrongIds = new Set();
  body.replaceChildren(h('div.match-top', timer, left), grid);
  const best = (S.kv.matchBest || {})[deckId];
  left.textContent = best ? `Best ${(best / 1000).toFixed(1)}s` : `${items.length} pairs`;
  grid.style.gridTemplateColumns = tiles.length <= 6 ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)';
  for (const t of tiles) {
    t.el = h('button.tile', { on: { click: () => tap(t) } }, t.text);
    grid.appendChild(t.el);
  }
  function tick() { timer.textContent = ((performance.now() - t0 + penalty) / 1000).toFixed(1) + 's'; raf = requestAnimationFrame(tick); }
  function tap(t) {
    if (!t0) { t0 = performance.now(); tick(); }
    if (t.done) return;
    if (!sel) { sel = t; t.el.classList.add('sel'); return; }
    if (sel === t) { t.el.classList.remove('sel'); sel = null; return; }
    if (sel.it === t.it || sel.it.a === t.it.a && sel.text !== t.text) {
      for (const x of [sel, t]) { x.done = true; x.el.classList.remove('sel'); x.el.classList.add('gone'); }
      sel = null; matched++;
      if (matched === items.length) finish();
    } else {
      penalty += 1000; wrongIds.add(sel.it.id); wrongIds.add(t.it.id);
      for (const x of [sel, t]) { x.el.classList.remove('sel'); x.el.classList.add('bad'); setTimeout(() => x.el.classList.remove('bad'), 400); }
      sel = null;
    }
  }
  function finish() {
    cancelAnimationFrame(raf);
    const ms = performance.now() - t0 + penalty;
    const all = { ...(S.kv.matchBest || {}) }; const prev = all[deckId];
    const record = !prev || ms < prev; if (record) { all[deckId] = Math.round(ms); setKV('matchBest', all); }
    if (wrongIds.size) missed([...wrongIds]);
    setTimeout(() => body.replaceChildren(endScreen({
      emoji: record ? '🏅' : '⏱️', title: `${(ms / 1000).toFixed(1)} seconds`,
      text: record ? (prev ? `New record! Previous best ${(prev / 1000).toFixed(1)}s` : 'Your first time. Now beat it!') : `Best: ${(prev / 1000).toFixed(1)}s${penalty ? ` · +${penalty / 1000}s penalty for wrong pairs` : ''}`,
      actions: [{ label: 'Play again', primary: true, click: restart }, { label: 'Back to deck', click: close }],
    })), 300);
  }
  return () => cancelAnimationFrame(raf);
}
