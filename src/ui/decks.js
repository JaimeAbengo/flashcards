// Decks tab, deck page, deck options, import flow.
import { S, put, putMany, del, subtree, deckConf, setKV, ensureDeck, deckByName, notetypeByName, deckChildren, saveSettings } from '../store.js';
import { counts, deckCards, streak, State, dayStartMs } from '../sched.js';
import { parseFile, commit } from '../importer.js';
import { exportApkg } from '../exporter.js';
import { deleteDeck, createNote } from '../notes.js';
import { languages, ttsAvailable } from '../tts.js';
import { h, header, pushScreen, popScreen, icon, toast, modal, confirmBox, promptBox, menuSheet, plural, downloadFile, DAY } from '../util.js';
import { openStudy } from './study.js';
import { openEditor } from './editor.js';
import { openGame, GAMES, gameItems } from '../games/index.js';
import { refreshAll } from './app.js';

const tab = () => document.getElementById('tab-decks');

export function renderDecks() {
  const t = tab(); const scroll = t.scrollTop;
  const hasCards = S.cards.size > 0;
  const top = topLevel();
  let due = 0; const cs = new Map();
  for (const d of S.decks.values()) cs.set(d.id, counts(d.id));
  for (const d of top) { const c = cs.get(d.id); due += c.nw + c.learn + c.due; }
  const studiedToday = S.revlog.filter(l => l.id >= dayStartMs()).length;

  t.replaceChildren(
    h('div.page-head', h('h1', 'Decks'), h('div.head-actions',
      h('button.icon-btn', { 'aria-label': 'Import', on: { click: () => startImport() } }, icon('import')),
      h('button.icon-btn.filled', { 'aria-label': 'Add', on: { click: addMenu } }, icon('plus')))),
    hasCards ? h('div.today',
      h('div', h('b', due), h('span', 'cards to study today')),
      h('div', h('b', studiedToday), h('span', 'studied today')),
      h('div', h('b', '🔥 ' + streak()), h('span', 'day streak'))) : null,
    hasCards ? h('div.group.deck-list', top.map(d => deckRows(d, 0, cs))) : emptyState(),
    hasCards ? h('p.muted.small.center', { style: { marginTop: '12px' } }, 'Press and hold a deck to move it') : null,
  );
  t.scrollTop = scroll;
  const list = t.querySelector('.deck-list'); if (list) enableReorder(list);
}

// ── press-and-hold to reorder decks among their siblings ──
let suppressClick = false;
function enableReorder(list) {
  let press = null, drag = null;
  const rowsOf = () => [...list.querySelectorAll('.deck-row')];
  // a deck's "block" = its row plus the rows of its visible subdecks
  const block = row => { const rows = rowsOf(); const i = rows.indexOf(row); const d = +row.dataset.depth; const out = [row]; for (let k = i + 1; k < rows.length && +rows[k].dataset.depth > d; k++) out.push(rows[k]); return out; };
  const cancelPress = () => { if (press) { clearTimeout(press.timer); press = null; } };
  list.addEventListener('contextmenu', e => { if (e.target.closest('.deck-row')) e.preventDefault(); });
  list.addEventListener('pointerdown', e => {
    const row = e.target.closest('.deck-row'); if (!row || e.target.closest('.deck-toggle') || e.button > 0) return;
    press = { row, x: e.clientX, y: e.clientY, id: e.pointerId, timer: setTimeout(() => begin(e.pointerId), 420) };
  });
  function begin(pointerId) {
    const row = press.row; const y0 = press.y; press = null;
    const siblings = rowsOf().filter(r => r.dataset.parent === row.dataset.parent && r.dataset.depth === row.dataset.depth);
    if (siblings.length < 2) { toast('Nothing to reorder here'); return; }
    try { row.setPointerCapture(pointerId); } catch { }
    const mine = block(row);
    mine.forEach(r => r.classList.add('dragging'));
    const line = h('div.drop-line'); list.appendChild(line);
    drag = { row, y0, mine, siblings, line, target: siblings.indexOf(row) };
    suppressClick = true;
  }
  list.addEventListener('pointermove', e => {
    if (press) { if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) cancelPress(); return; }
    if (!drag) return;
    const dy = e.clientY - drag.y0;
    drag.mine.forEach(r => { r.style.transform = `translateY(${dy}px)`; });
    // where would it go? compare with the middle of each other sibling's block
    const others = drag.siblings.filter(s => s !== drag.row);
    const lr = list.getBoundingClientRect();
    let idx = others.length, lineY;
    for (let k = 0; k < others.length; k++) {
      const b = block(others[k]); const top = b[0].getBoundingClientRect().top, bottom = b[b.length - 1].getBoundingClientRect().bottom;
      if (e.clientY < (top + bottom) / 2) { idx = k; lineY = top; break; }
      lineY = bottom;
    }
    drag.target = idx;
    drag.line.style.top = (lineY - lr.top - 1) + 'px';
  });
  const end = async () => {
    cancelPress();
    if (!drag) { setTimeout(() => { suppressClick = false; }, 0); return; }
    const { row, siblings, target } = drag; drag = null;
    const ids = siblings.filter(s => s !== row).map(s => +s.dataset.id);
    ids.splice(target, 0, +row.dataset.id);
    const switched = S.settings.deckSort !== 'custom';
    // keep the current order for all siblings (including hidden ones), then apply the move
    const decks = ids.map((id, i) => Object.assign(S.decks.get(id), { order: i }));
    await putMany('decks', decks);
    if (switched) { S.settings.deckSort = 'custom'; await saveSettings(); }
    setTimeout(() => { suppressClick = false; }, 0);
    renderDecks();
    if (switched) toast('Deck order set to Custom. Change it in Settings');
  };
  list.addEventListener('pointerup', end); list.addEventListener('pointercancel', end);
}
// stop the page from scrolling while a deck is being dragged
document.addEventListener('touchmove', e => { if (document.querySelector('.deck-row.dragging')) e.preventDefault(); }, { passive: false });

function topLevel() {
  const all = [...S.decks.values()];
  const tops = deckChildren(null);
  // hide an empty Default deck when there are others
  return tops.filter(d => !(d.id === 1 && tops.length > 1 && !deckCards(1).cards.length));
}
const children = d => deckChildren(d);

function deckRows(d, depth, cs) {
  const kids = children(d);
  const collapsed = (S.kv.collapsed || []).includes(d.id);
  const c = cs.get(d.id);
  const num = (v, k) => h('span.' + (v ? k : 'z'), v);
  const parent = d.name.includes('::') ? d.name.slice(0, d.name.lastIndexOf('::')) : '';
  const row = h('div.deck-row', { 'data-id': d.id, 'data-depth': depth, 'data-parent': parent, style: { paddingLeft: 14 + depth * 18 + 'px' }, on: { click: () => { if (!suppressClick) openDeck(d.id); } } },
    kids.length ? h('button.deck-toggle' + (collapsed ? '.closed' : ''), { on: { click: e => { e.stopPropagation(); toggle(d.id); } } }, icon('down', 18)) : null,
    h('div.deck-name', d.name.split('::').pop()),
    h('div.counts', num(c.nw, 'n'), num(c.learn, 'l'), num(c.due, 'd')));
  return [row, collapsed ? [] : kids.map(k => deckRows(k, depth + 1, cs))];
}
function toggle(id) {
  const set = new Set(S.kv.collapsed || []); set.has(id) ? set.delete(id) : set.add(id);
  setKV('collapsed', [...set]); renderDecks();
}

function emptyState() {
  return h('div.empty', h('div.empty-art', '🗂️'), h('h3', 'No cards yet'),
    h('p', 'Import a deck from Anki (.apkg) or a Quizlet/text export, or make your own cards.'),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '320px', margin: '16px auto 0' } },
      h('button.btn.primary.big', { on: { click: () => startImport() } }, icon('import'), 'Import a deck'),
      h('button.btn.big', { on: { click: () => openEditor({ onSave: refreshAll }) } }, icon('plus'), 'Create a card'),
      h('button.btn.big', { on: { click: sampleDeck } }, '✨ Try a sample deck')));
}

async function addMenu() {
  const v = await menuSheet('Add', [
    { label: 'Add a card', value: 'card', icon: 'plus' },
    { label: 'Create a deck', value: 'deck', icon: 'folder' },
    { label: 'Import a file', value: 'import', icon: 'import' },
  ]);
  if (v === 'card') openEditor({ onSave: refreshAll });
  if (v === 'deck') { const n = await promptBox('Deck name', '', { ok: 'Create', placeholder: 'e.g. Spanish::Verbs' }); if (n) { await ensureDeck(n); refreshAll(); toast('Deck created'); } }
  if (v === 'import') startImport();
}

// ───────────────────────── deck page ─────────────────────────
export function openDeck(deckId) {
  setKV('lastDeck', deckId);
  const body = h('div.screen-body');
  const title = h('span');
  const el = h('div', header(title, { right: [h('button.icon-btn', { 'aria-label': 'Deck menu', on: { click: deckMenu } }, icon('more'))] }), body);
  pushScreen(el, { onClose: refreshAll });

  function render() {
    const d = S.decks.get(deckId); if (!d) return popScreen(el);
    title.textContent = d.name.split('::').pop();
    const c = counts(deckId);
    const { cards } = deckCards(deckId);
    const st = { total: cards.length, nw: 0, learn: 0, young: 0, mature: 0, susp: 0 };
    for (const x of cards) {
      if (x.susp) st.susp++;
      else if (x.s.state === State.New) st.nw++;
      else if (x.s.state === State.Review) (x.s.scheduled_days >= 21 ? st.mature++ : st.young++);
      else st.learn++;
    }
    const total = c.nw + c.learn + c.due;
    const items = gameItems(deckId);
    const kids = children(d);
    body.replaceChildren(
      d.name.includes('::') ? h('p.muted.small', { style: { textAlign: 'center', margin: '0 0 8px' } }, d.name.split('::').slice(0, -1).join(' › ')) : null,
      h('div.deck-hero',
        h('div.big-counts',
          h('div', h('b', { style: { color: 'var(--new)' } }, c.nw), h('span', 'New')),
          h('div', h('b', { style: { color: 'var(--learn)' } }, c.learn), h('span', 'Learning')),
          h('div', h('b', { style: { color: 'var(--due)' } }, c.due), h('span', 'To review'))),
        total ? h('button.btn.primary.big.wide', { on: { click: () => openStudy(deckId, { onClose: render }) } }, icon('study'), 'Study now')
          : h('div', h('div.done-msg', cards.length ? '✅ All done for today! Practise with a game below.' : 'This deck is empty.'),
            cards.length ? null : h('button.btn.primary.wide', { on: { click: () => openEditor({ deckId, onSave: render }) } }, icon('plus'), 'Add cards'))),
      h('h2.section', 'Practise'),
      h('div.games', GAMES.map(g => h('button.game-tile', { disabled: items.length < g.min, style: items.length < g.min ? { opacity: .45 } : null, on: { click: () => items.length < g.min ? toast(`${g.name} needs at least ${g.min} cards with short answers`) : openGame(g.id, deckId, { onClose: render }) } },
        icon(g.icon), g.name, h('small', g.desc)))),
      h('h2.section', 'Cards'),
      h('div.mini-stats',
        h('div', h('b', st.total), h('span', 'Total')), h('div', h('b', st.nw), h('span', 'New')), h('div', h('b', st.learn), h('span', 'Learning')),
        h('div', h('b', st.young), h('span', 'Young')), h('div', h('b', st.mature), h('span', 'Mature (21d+)')), h('div', h('b', st.susp), h('span', 'Suspended'))),
      h('div.btn-row', { style: { marginTop: '12px' } },
        h('button.btn', { on: { click: () => openEditor({ deckId, onSave: render }) } }, icon('plus', 18), 'Add cards'),
        h('button.btn', { on: { click: () => { import('./browse.js').then(m => m.openBrowseFor(deckId, render)); } } }, icon('browse', 18), 'Browse')),
      kids.length ? [h('h2.section', 'Subdecks'), h('div.group', kids.map(k => { const kc = counts(k.id); return h('div.deck-row', { on: { click: () => openDeck(k.id) } }, h('div.deck-name', k.name.split('::').pop()), h('div.counts', h('span.' + (kc.nw ? 'n' : 'z'), kc.nw), h('span.' + (kc.learn ? 'l' : 'z'), kc.learn), h('span.' + (kc.due ? 'd' : 'z'), kc.due))); }))] : null,
    );
  }

  async function deckMenu() {
    const v = await menuSheet(S.decks.get(deckId).name.replace(/::/g, ' › '), [
      { label: 'Options (daily limits, read aloud)', value: 'opts', icon: 'settings' },
      { label: 'Rename', value: 'rename', icon: 'edit' },
      { label: 'Export as Anki deck (.apkg)', value: 'export', icon: 'import' },
      { label: 'Delete deck', value: 'delete', icon: 'trash', danger: true },
    ]);
    if (v === 'opts') { await deckOptions(deckId); render(); }
    if (v === 'rename') {
      const d = S.decks.get(deckId);
      const n = await promptBox('Rename deck', d.name, { ok: 'Rename' });
      if (n && n !== d.name) {
        if (deckByName(n) && deckByName(n).id !== d.id) return toast('A deck with that name already exists');
        const old = d.name;
        for (const x of [...S.decks.values()]) if (x.name === old || x.name.startsWith(old + '::')) { x.name = n + x.name.slice(old.length); await put('decks', x); }
        const parent = n.split('::').slice(0, -1).join('::'); if (parent) await ensureDeck(parent);
        render();
      }
    }
    if (v === 'export') {
      const choice = await modal({ title: 'Export to Anki', body: h('p', 'Creates an .apkg file you can open in Anki on any device. Include your study progress?'), actions: [{ label: 'Cards only', value: 'plain' }, { label: 'With progress', value: 'prog', primary: true }] });
      if (!choice) return;
      toast('Preparing file…');
      const r = await exportApkg(deckId, { withProgress: choice === 'prog' });
      await downloadFile(r.blob, r.name);
    }
    if (v === 'delete') {
      const ids = subtree(deckId); const n = deckCards(deckId).cards.length;
      if (!(await confirmBox(`Delete “${S.decks.get(deckId).name}”${ids.size > 1 ? ' and its subdecks' : ''} with ${plural(n, 'card')}? This can't be undone.`, { ok: 'Delete', danger: true }))) return;
      await deleteDeck(deckId, ids);
      toast('Deck deleted'); popScreen(el);
    }
  }
  el.refresh = render;
  render();
}

async function deckOptions(deckId) {
  const d = S.decks.get(deckId), c = deckConf(deckId);
  const num = (v) => h('input.input', { type: 'number', inputmode: 'numeric', min: 0, max: 9999, value: v, style: { width: '96px', textAlign: 'right' } });
  const nw = num(c.newPerDay), rv = num(c.revPerDay);
  const langs = ttsAvailable() ? languages() : [];
  const langSel = v => h('select', h('option', { value: '' }, 'Off'), langs.map(l => h('option', { value: l.code, selected: l.code === v }, l.label)));
  const tf = langSel(c.ttsFront), tb = langSel(c.ttsBack);
  const auto = h('input.toggle', { type: 'checkbox', checked: !!d.ttsAuto });
  const r = await modal({
    title: 'Deck options',
    body: h('div',
      h('div.row', h('div.grow', 'New cards per day'), nw),
      h('div.row', h('div.grow', 'Maximum reviews per day'), rv),
      langs.length ? [
        h('div.row', h('div.grow', 'Read front aloud in'), tf),
        h('div.row', h('div.grow', 'Read back aloud in'), tb),
        h('div.row', h('div.grow', 'Read aloud automatically'), auto)] : h('p.small', 'Read aloud isn\'t available in this browser.'),
      h('p.small.muted', 'Applies to this deck and its subdecks when you study it.')),
    actions: [{ label: 'Cancel', value: null }, { label: 'Save', value: 'ok', primary: true }],
  });
  if (r !== 'ok') return;
  Object.assign(d, { newPerDay: Math.max(0, +nw.value || 0), revPerDay: Math.max(0, +rv.value || 0), ttsFront: tf.value || '', ttsBack: tb.value || '', ttsAuto: auto.checked });
  await put('decks', d);
  toast('Saved');
}

// ───────────────────────── import ─────────────────────────
function progressBox(title) {
  const bar = h('i'); const msg = h('div.muted.small', { style: { marginTop: '8px' } }, 'Working…');
  const wrap = h('div.modal-wrap', h('div.modal-backdrop'), h('div.modal', h('div.modal-title', title), h('div.progress', bar), msg));
  document.body.appendChild(wrap);
  return { set(p, m) { if (p != null) bar.style.width = Math.round(p * 100) + '%'; if (m) msg.textContent = m; }, close() { wrap.remove(); } };
}

export function startImport() {
  const input = h('input', { type: 'file', hidden: true });
  input.addEventListener('change', () => { const f = input.files[0]; input.remove(); if (f) importFile(f); });
  document.body.appendChild(input); input.click();
}

export async function importFile(file) {
  const pb = progressBox(`Opening ${file.name}`);
  let pkg;
  try { pkg = await parseFile(file, m => pb.set(null, m)); }
  catch (e) { pb.close(); console.error(e); return modal({ title: "Couldn't import", body: h('p', e.message || String(e)), actions: [{ label: 'OK', value: 1, primary: true }] }); }
  pb.close();
  const s = pkg.summary;
  const keep = h('input.toggle', { type: 'checkbox', checked: true });
  const rev = h('input.toggle', { type: 'checkbox' });
  const deckIn = h('input.input', { value: pkg.deck || '', style: { maxWidth: '60%' } });
  const body = pkg.kind === 'backup'
    ? h('div', h('p', `This is a full backup from this app (${plural(s.cards, 'card')}, ${plural(s.media, 'media file')}).`), h('p', { style: { color: 'var(--bad)', fontWeight: 600 } }, 'Restoring replaces everything currently in the app.'))
    : h('div',
      h('div.row', h('div.grow', 'Decks'), h('div.muted', { style: { textAlign: 'right', maxWidth: '65%' } }, s.decks.slice(0, 6).map(x => x.replace(/::/g, ' › ')).join(', ') + (s.decks.length > 6 ? ` +${s.decks.length - 6}` : ''))),
      h('div.row', h('div.grow', 'Notes / cards'), h('b', `${s.notes.toLocaleString()} / ${s.cards.toLocaleString()}`)),
      s.media ? h('div.row', h('div.grow', 'Images & audio'), h('b', s.media.toLocaleString())) : null,
      pkg.kind === 'anki' && s.studied ? h('div.row', h('div.grow', h('div', 'Keep my Anki progress'), h('small', `${plural(s.studied, 'card')} already studied. Off = start fresh.`)), keep) : null,
      pkg.kind === 'text' ? [h('div.row', h('div.grow', 'Deck name'), deckIn), h('div.row', h('div.grow', h('div', 'Also make reversed cards'), h('small', 'Back → front as well')), rev)] : null);
  const go = await modal({ title: pkg.kind === 'backup' ? 'Restore backup?' : `Import “${pkg.name}”`, body, actions: [{ label: 'Cancel', value: null }, { label: pkg.kind === 'backup' ? 'Restore' : 'Import', value: 'go', primary: pkg.kind !== 'backup', danger: pkg.kind === 'backup' }] });
  if (go !== 'go') return;
  const p2 = progressBox('Importing…');
  try {
    const r = await commit(pkg, { keepProgress: keep.checked, reversed: rev.checked, deckName: deckIn.value.trim() || pkg.deck }, (p, m) => p2.set(p, m));
    p2.close();
    refreshAll();
    if (r.restored) toast(`Restored ${plural(r.cards, 'card')}`);
    else {
      toast(`Imported ${plural(r.cards, 'card')}${r.updated ? ` (${r.updated} notes updated)` : ''}${r.media ? `, ${r.media} media files` : ''}`, 3500);
      try { await navigator.storage?.persist?.(); } catch { }
      if (r.deckId && S.decks.has(r.deckId)) openDeck(topOf(r.deckId));
    }
  } catch (e) { p2.close(); console.error(e); modal({ title: 'Import failed', body: h('p', e.message || String(e)), actions: [{ label: 'OK', value: 1, primary: true }] }); }
}
function topOf(id) { const d = S.decks.get(id); const top = deckByName(d.name.split('::')[0]); return top ? top.id : id; }

// ───────────────────────── sample deck ─────────────────────────
async function sampleDeck() {
  const deck = await ensureDeck('Sample::Spanish basics');
  const rev = notetypeByName('Basic (and reversed card)'); const cl = notetypeByName('Cloze');
  const words = [['hola', 'hello'], ['gracias', 'thank you'], ['por favor', 'please'], ['el agua', 'the water'], ['la casa', 'the house'], ['el perro', 'the dog'], ['el gato', 'the cat'], ['comer', 'to eat'], ['beber', 'to drink'], ['hablar', 'to speak'], ['grande', 'big'], ['pequeño', 'small'], ['rojo', 'red'], ['azul', 'blue'], ['mañana', 'tomorrow'], ['hoy', 'today']];
  for (const [a, b] of words) await createNote(rev.id, deck.id, [a, b], ['sample']);
  const geo = await ensureDeck('Sample::Geography');
  const basic = notetypeByName('Basic');
  for (const [a, b] of [['Capital of France', 'Paris'], ['Capital of Japan', 'Tokyo'], ['Capital of Canada', 'Ottawa'], ['Capital of Australia', 'Canberra'], ['Capital of Brazil', 'Brasília'], ['Capital of Egypt', 'Cairo'], ['Capital of Spain', 'Madrid'], ['Capital of Kenya', 'Nairobi']]) await createNote(basic.id, geo.id, [a, b], ['sample']);
  await createNote(cl.id, geo.id, ['The {{c1::Nile}} is the longest river in {{c2::Africa}}.', ''], ['sample']);
  await createNote(cl.id, geo.id, ['{{c1::Mount Everest}} is {{c2::8,849}} metres tall.', ''], ['sample']);
  const d = S.decks.get(deck.id); Object.assign(d, { ttsFront: 'es-ES', ttsBack: 'en-US' }); await put('decks', d);
  refreshAll(); toast('Sample decks added'); openDeck(topOf(deck.id));
}
