// Shared game helpers + registry.
import { S, subtree, setKV, deckConf } from '../store.js';
import { cardTexts } from '../templates.js';
import { boost } from '../sched.js';
import { h, header, pushScreen, popScreen, icon, shuffle, toast } from '../util.js';
import { flip } from './flip.js';
import { learn } from './learn.js';
import { match } from './match.js';
import { write } from './write.js';
import { test } from './test.js';
import { gravity } from './gravity.js';

export const GAMES = [
  { id: 'flip', name: 'Flip', icon: 'flip', desc: 'Swipe cards', min: 1, run: flip },
  { id: 'learn', name: 'Learn', icon: 'learn', desc: 'Guided', min: 4, run: learn },
  { id: 'match', name: 'Match', icon: 'match', desc: 'Beat the clock', min: 3, run: match },
  { id: 'write', name: 'Write', icon: 'write', desc: 'Type answers', min: 1, run: write },
  { id: 'test', name: 'Test', icon: 'test', desc: 'Quick quiz', min: 4, run: test },
  { id: 'gravity', name: 'Gravity', icon: 'gravity', desc: 'Arcade', min: 3, run: gravity },
];

// Question/answer pairs from a deck. Reversed duplicates are merged.
export function gameItems(deckId, { short = false } = {}) {
  const ids = subtree(deckId); const seen = new Set(); const out = [];
  for (const c of S.cards.values()) {
    if (!ids.has(c.deckId) || c.susp) continue;
    const t = cardTexts(c); if (!t || !t.q || !t.a) continue;
    if (t.a.length > 200) continue;
    if (short && (t.a.length > 60 || t.q.length > 110)) continue;
    const key = [t.q, t.a].sort().join('\u0000'); if (seen.has(key)) continue; seen.add(key);
    out.push({ id: c.id, q: t.q, a: t.a, qHtml: t.qHtml, aHtml: t.aHtml, hasImg: /<img/i.test(t.qHtml) });
  }
  return out;
}
export const swapped = () => !!S.kv.gameSwap;
export function itemsFor(deckId, opts) {
  const items = gameItems(deckId, opts);
  return swapped() ? items.map(i => ({ ...i, q: i.a, a: i.q, qHtml: escHtml(i.a), aHtml: i.qHtml, hasImg: false })) : items;
}
const escHtml = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function distractors(item, pool, n = 3) {
  const others = shuffle(pool.filter(p => p.a.trim().toLowerCase() !== item.a.trim().toLowerCase()).map(p => p.a));
  const uniq = [...new Set(others)];
  // prefer answers of similar length so the right one doesn't stand out
  uniq.sort((x, y) => Math.abs(x.length - item.a.length) - Math.abs(y.length - item.a.length));
  return shuffle(uniq.slice(0, Math.max(n * 3, n)).slice(0, n * 2)).slice(0, n);
}
export const missed = ids => boost(Array.isArray(ids) ? ids : [ids]);

export function openGame(id, deckId, { onClose } = {}) {
  const g = GAMES.find(x => x.id === id);
  const body = h('div.game-body');
  const swapBtn = h('button.icon-btn', { 'aria-label': 'Swap question and answer', title: 'Swap sides', on: { click: () => { setKV('gameSwap', !swapped()); toast(swapped() ? 'Answer with the front' : 'Answer with the back'); restart(); } } }, '⇄');
  const el = h('div.game' + (id === 'gravity' ? '.gravity' : ''), header(g.name, { right: [swapBtn] }), body);
  let cleanup = null;
  pushScreen(el, { onClose: () => { cleanup && cleanup(); onClose && onClose(); } });
  function restart() { cleanup && cleanup(); cleanup = null; body.replaceChildren(); const r = g.run({ deckId, body, el, close: () => popScreen(el), restart, conf: deckConf(deckId) }); if (typeof r === 'function') cleanup = r; }
  restart();
}

export function progressBar() { const i = h('i', { style: { width: '0%' } }); const el = h('div.gprogress', i); el.set = f => { i.style.width = Math.round(f * 100) + '%'; }; return el; }

export function endScreen({ emoji, title, text, actions }) {
  return h('div.game-end', h('div.emoji', emoji), h('h2', title), text ? h('p.muted', text) : null,
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', maxWidth: '340px' } },
      actions.filter(Boolean).map(a => h('button.btn.big' + (a.primary ? '.primary' : ''), { on: { click: a.click } }, a.label))));
}
