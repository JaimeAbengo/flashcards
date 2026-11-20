// Browse/search cards, edit, bulk actions.
import { S, put, putMany, subtree, ensureDeck, deckTreeOrder } from '../store.js';
import { stateLabel, State, emptyState } from '../sched.js';
import { cardTexts } from '../templates.js';
import { deleteNotes } from '../notes.js';
import { h, header, pushScreen, icon, toast, confirmBox, modal, plural, stripHtml } from '../util.js';
import { openEditor } from './editor.js';
import { refreshAll } from './app.js';

const textCache = new Map(); // noteId -> {mod, text}
function noteText(n) {
  const c = textCache.get(n.id);
  if (c && c.mod === n.mod) return c.text;
  const text = (n.fields.map(stripHtml).join(' ') + ' ' + (n.tags || []).join(' ')).toLowerCase();
  textCache.set(n.id, { mod: n.mod, text }); return text;
}
const qaCache = new Map();
function qa(card) {
  const n = S.notes.get(card.noteId); const key = card.id;
  const c = qaCache.get(key); if (c && c.mod === n?.mod) return c;
  const t = cardTexts(card) || { q: '', a: '' };
  const v = { mod: n?.mod, q: t.q, a: t.a }; qaCache.set(key, v); return v;
}

export function renderBrowse() { browseView(document.getElementById('tab-browse'), {}); }
export function openBrowseFor(deckId, onClose) {
  const body = h('div.screen-body');
  const el = h('div', header('Browse'), body);
  pushScreen(el, { onClose });
  browseView(body, { deckId, inScreen: true });
}

function browseView(root, { deckId, inScreen }) {
  const st = root._browse ||= { q: '', deck: deckId ?? 'all', state: 'all', limit: 100, selecting: false, sel: new Set() };
  if (deckId) st.deck = deckId;

  const listEl = h('div.group');
  const countEl = h('div.muted.small', { style: { margin: '0 4px 8px' } });
  const bulk = h('div.bulk-bar');
  const search = h('input', { type: 'search', placeholder: 'Search cards and tags', value: st.q, autocapitalize: 'off', autocorrect: 'off', on: { input: e => { st.q = e.target.value; st.limit = 100; draw(); } } });
  const deckSel = h('select', { on: { change: e => { st.deck = e.target.value === 'all' ? 'all' : +e.target.value; st.limit = 100; draw(); } } },
    h('option', { value: 'all' }, 'All decks'),
    deckTreeOrder().map(([d]) => h('option', { value: d.id, selected: d.id === st.deck }, d.name.replace(/::/g, ' › '))));
  const stateSel = h('select', { on: { change: e => { st.state = e.target.value; st.limit = 100; draw(); } } },
    [['all', 'Any state'], ['new', 'New'], ['learning', 'Learning'], ['due', 'Due today'], ['review', 'Review'], ['suspended', 'Suspended'], ['hard', 'Hardest (lapses)']].map(([v, l]) => h('option', { value: v, selected: v === st.state }, l)));
  const selBtn = h('button.link', { on: { click: () => { st.selecting = !st.selecting; st.sel.clear(); draw(); } } });

  root.replaceChildren(
    inScreen ? null : h('div.page-head', h('h1', 'Browse'), h('div.head-actions', h('button.icon-btn.filled', { 'aria-label': 'Add card', on: { click: () => openEditor({ onSave: () => { draw(); refreshAll(); } }) } }, icon('plus')))),
    h('div.search', icon('search', 18), search),
    h('div.chips', deckSel, stateSel),
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, countEl, selBtn),
    listEl, bulk);

  function filtered() {
    const decks = st.deck === 'all' ? null : subtree(st.deck);
    const q = st.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const now = Date.now(), end = now + 864e5;
    let out = [];
    for (const c of S.cards.values()) {
      if (decks && !decks.has(c.deckId)) continue;
      const s = c.s.state;
      if (st.state === 'new' && (s !== State.New || c.susp)) continue;
      if (st.state === 'learning' && (s !== State.Learning && s !== State.Relearning || c.susp)) continue;
      if (st.state === 'review' && (s !== State.Review || c.susp)) continue;
      if (st.state === 'due' && (s === State.New || c.s.due > end || c.susp)) continue;
      if (st.state === 'suspended' && !c.susp) continue;
      if (st.state === 'hard' && !c.s.lapses) continue;
      if (q.length) { const n = S.notes.get(c.noteId); if (!n) continue; const t = noteText(n); if (!q.every(w => t.includes(w))) continue; }
      out.push(c);
    }
    if (st.state === 'hard') out.sort((a, b) => b.s.lapses - a.s.lapses);
    else out.sort((a, b) => (S.notes.get(b.noteId)?.created || 0) - (S.notes.get(a.noteId)?.created || 0) || a.ord - b.ord);
    return out;
  }

  function draw() {
    const cards = filtered();
    countEl.textContent = plural(cards.length, 'card');
    selBtn.textContent = st.selecting ? 'Done' : 'Select';
    const shown = cards.slice(0, st.limit);
    listEl.replaceChildren(...shown.map(c => {
      const t = qa(c);
      const d = S.decks.get(c.deckId);
      const cb = st.selecting ? h('input', { type: 'checkbox', checked: st.sel.has(c.id), on: { click: e => e.stopPropagation(), change: e => { e.target.checked ? st.sel.add(c.id) : st.sel.delete(c.id); drawBulk(); } } }) : null;
      return h('div.card-item', { on: { click: () => { if (st.selecting) { st.sel.has(c.id) ? st.sel.delete(c.id) : st.sel.add(c.id); draw(); } else openEditor({ note: S.notes.get(c.noteId), onSave: () => { draw(); refreshAll(); } }); } } },
        cb,
        h('div.grow', h('div.q', t.q || '(empty)'), h('div.a', t.a)),
        h('div.meta', h('b', (d?.name || '').split('::').pop()), stateLabel(c)));
    }));
    if (!cards.length) listEl.replaceChildren(h('div.empty', S.cards.size ? 'No cards match.' : 'No cards yet.'));
    if (cards.length > st.limit) listEl.appendChild(h('button.btn.wide', { style: { borderRadius: 0 }, on: { click: () => { st.limit += 200; draw(); } } }, `Show more (${(cards.length - st.limit).toLocaleString()} left)`));
    drawBulk(cards);
  }
  function drawBulk(cards) {
    if (!st.selecting) { bulk.replaceChildren(); return; }
    const n = st.sel.size;
    bulk.replaceChildren(
      h('button.btn', { on: { click: () => { const all = cards || filtered(); if (st.sel.size === all.length) st.sel.clear(); else all.forEach(c => st.sel.add(c.id)); draw(); } } }, 'All'),
      h('button.btn', { disabled: !n, on: { click: move } }, 'Move'),
      h('button.btn', { disabled: !n, on: { click: suspend } }, 'Suspend'),
      h('button.btn', { disabled: !n, on: { click: reset } }, 'Reset'),
      h('button.btn.danger', { disabled: !n, on: { click: remove } }, `Delete${n ? ' ' + n : ''}`));
  }
  const selected = () => [...st.sel].map(id => S.cards.get(id)).filter(Boolean);
  async function move() {
    const sel = h('select.input', deckTreeOrder().map(([d]) => h('option', { value: d.id }, d.name.replace(/::/g, ' › '))));
    const r = await modal({ title: `Move ${plural(st.sel.size, 'card')} to`, body: sel, actions: [{ label: 'Cancel', value: null }, { label: 'Move', value: 'ok', primary: true }] });
    if (r !== 'ok') return;
    const cs = selected(); cs.forEach(c => { c.deckId = +sel.value; }); await putMany('cards', cs);
    toast(`Moved ${plural(cs.length, 'card')}`); st.sel.clear(); draw(); refreshAll();
  }
  async function suspend() {
    const cs = selected(); const to = !cs.every(c => c.susp);
    cs.forEach(c => { c.susp = to; }); await putMany('cards', cs);
    toast(`${to ? 'Suspended' : 'Unsuspended'} ${plural(cs.length, 'card')}`); st.sel.clear(); draw(); refreshAll();
  }
  async function reset() {
    if (!(await confirmBox(`Reset ${plural(st.sel.size, 'card')} to new? Their progress is forgotten.`, { ok: 'Reset', danger: true }))) return;
    const cs = selected(); cs.forEach(c => { c.s = emptyState(); c.pos = Date.now(); }); await putMany('cards', cs);
    toast('Reset'); st.sel.clear(); draw(); refreshAll();
  }
  async function remove() {
    const notes = new Set(selected().map(c => c.noteId));
    if (!(await confirmBox(`Delete ${plural(notes.size, 'note')} and all their cards?`, { ok: 'Delete', danger: true }))) return;
    await deleteNotes([...notes]); toast(`Deleted ${plural(notes.size, 'note')}`); st.sel.clear(); draw(); refreshAll();
  }
  draw();
}
