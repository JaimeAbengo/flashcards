// Spaced-repetition review session.
import { S, deckConf } from '../store.js';
import { buildQueue, nextCard, answer, undoAnswer, preview, removeFromQueue, Rating, State, nextDayMs } from '../sched.js';
import { renderQA, stopSound } from '../templates.js';
import { mountCard, autoplay } from '../cardview.js';
import { speak, stopSpeaking } from '../tts.js';
import { h, header, pushScreen, popScreen, icon, fmtInterval, menuSheet, confirmBox, toast, stripHtml, plural } from '../util.js';
import { openEditor } from './editor.js';
import { deleteNotes } from '../notes.js';
import { put } from '../store.js';

export function openStudy(deckId, { onClose } = {}) {
  const q = buildQueue(deckId);
  const conf = deckConf(deckId);
  let card = null, shown = false, started = 0, mounted = null, reviewed = 0;
  const undos = [];

  const countsEl = h('div.study-counts');
  const undoBtn = h('button.icon-btn', { 'aria-label': 'Undo', on: { click: undo } }, icon('undo'));
  const menuBtn = h('button.icon-btn', { 'aria-label': 'More', on: { click: menu } }, icon('more'));
  const host = h('div.card-host', { on: { click: e => { if (!shown && card && !e.composedPath().some(el => el.tagName === 'INPUT' || el.tagName === 'BUTTON' || el.tagName === 'SUMMARY')) reveal(); } } });
  const area = h('div.card-area', host);
  const bar = h('div.answer-bar');
  const el = h('div.study',
    header(countsEl, { right: [undoBtn, menuBtn], onBack: close }),
    area, bar);
  pushScreen(el, { onClose: () => { stopSound(); stopSpeaking(); document.removeEventListener('keydown', keys); onClose && onClose(); } });
  document.addEventListener('keydown', keys);
  function close() { popScreen(el); }

  function renderCounts() {
    const end = nextDayMs();
    const n = q.fresh.length, l = q.learn.filter(c => c.s.due < end).length, d = q.review.length;
    const st = card?.s.state;
    const cls = k => (card && ((k === 'n' && st === State.New) || (k === 'l' && (st === State.Learning || st === State.Relearning)) || (k === 'd' && st === State.Review)) ? '.cur' : '');
    countsEl.replaceChildren(
      h('span.n' + cls('n'), { style: { color: 'var(--new)' } }, n),
      h('span.l' + cls('l'), { style: { color: 'var(--learn)' } }, l),
      h('span.d' + cls('d'), { style: { color: 'var(--due)' } }, d));
    undoBtn.hidden = !undos.length;
    menuBtn.hidden = !card;
  }

  async function showNext() {
    stopSound(); stopSpeaking();
    const nx = nextCard(q, { exclude: undefined });
    if (!nx) return finished();
    if (nx.wait) return waiting(nx.wait);
    card = nx; shown = false; started = Date.now();
    renderCounts();
    const { q: qh, css } = renderQA(card);
    mounted = await mountCard(host, qh, css, { onEnter: reveal, ttsLang: conf.ttsFront });
    area.scrollTop = 0;
    bar.replaceChildren(h('button.btn.primary.big.wide', { on: { click: reveal } }, 'Show answer'));
    if (mounted.sounds.length) autoplay(mounted.sounds);
    else if (conf.ttsAuto && conf.ttsFront) speak(stripHtml(qh), conf.ttsFront);
    if (mounted.input) setTimeout(() => mounted.input.focus(), 250);
  }

  async function reveal() {
    if (!card || shown) return;
    shown = true;
    const typed = mounted?.input?.value;
    const { a, css } = renderQA(card, { typed });
    mounted = await mountCard(host, a, css, { ttsLang: conf.ttsBack });
    const p = preview(card);
    const lbl = ['', 'Again', 'Hard', 'Good', 'Easy'];
    bar.replaceChildren(h('div.rate', [1, 2, 3, 4].map(r => h(`button.r${r}`, { on: { click: () => rate(r) } },
      S.settings.showIntervals ? h('small', fmtInterval(p[r])) : null, lbl[r]))));
    if (mounted.sounds.length) { const qs = renderQA(card).q; const newOnes = mounted.sounds.filter(s => !qs.includes(s)); autoplay(newOnes.length ? newOnes : []); }
    else if (conf.ttsAuto && conf.ttsBack) { const t = stripHtml(a.split(/<hr id=answer>/i).pop()); speak(t, conf.ttsBack); }
  }

  async function rate(r) {
    if (!card || !shown) return;
    const c = card; card = null;
    const u = await answer(c, r, Math.min(60000, Date.now() - started));
    undos.push(u); reviewed++;
    removeFromQueue(q, c);
    showNext();
  }

  async function undo() {
    const u = undos.pop(); if (!u) return;
    await undoAnswer(u); reviewed--;
    // put the card back into the right queue
    for (const k of ['learn', 'review', 'fresh']) { const i = q[k].indexOf(u.card); if (i >= 0) q[k].splice(i, 1); }
    const st = u.card.s.state;
    (st === State.New ? q.fresh : st === State.Review ? q.review : q.learn).unshift(u.card);
    card = null;
    const show = u.card;
    // show the undone card immediately
    stopSound();
    if (!host.isConnected) area.replaceChildren(host);
    card = show; shown = false; started = Date.now(); renderCounts();
    const { q: qh, css } = renderQA(card);
    mounted = await mountCard(host, qh, css, { onEnter: reveal, ttsLang: conf.ttsFront });
    bar.replaceChildren(h('button.btn.primary.big.wide', { on: { click: reveal } }, 'Show answer'));
    toast('Undone');
  }

  async function menu() {
    if (!card) return;
    const c = card;
    const note = S.notes.get(c.noteId);
    const v = await menuSheet('This card', [
      (conf.ttsFront || conf.ttsBack) && { label: 'Read aloud', value: 'speak', icon: 'speaker' },
      { label: 'Edit note', value: 'edit', icon: 'edit' },
      { label: 'Suspend card', value: 'suspend', icon: 'x' },
      { label: 'Delete note', value: 'delete', icon: 'trash', danger: true },
    ]);
    if (v) act(v);
    async function act(v) {
      if (v === 'speak') { const { q: qh, a } = renderQA(c); speak(stripHtml(shown ? a.split(/<hr id=answer>/i).pop() : qh), shown ? conf.ttsBack : conf.ttsFront); }
      if (v === 'edit') openEditor({ note, onSave: async () => { if (card === c) { shown = false; const { q: qh, css } = renderQA(c); mounted = await mountCard(host, qh, css, { onEnter: reveal }); bar.replaceChildren(h('button.btn.primary.big.wide', { on: { click: reveal } }, 'Show answer')); } } });
      if (v === 'suspend') { c.susp = true; await put('cards', c); removeFromQueue(q, c); for (const k of ['learn']) { const i = q[k].indexOf(c); if (i >= 0) q[k].splice(i, 1); } toast('Card suspended'); card = null; showNext(); }
      if (v === 'delete') {
        if (!(await confirmBox('Delete this note and all its cards?', { ok: 'Delete', danger: true }))) return;
        const ids = S.cardsByNote.get(c.noteId) || [];
        await deleteNotes([c.noteId]);
        for (const k of ['learn', 'review', 'fresh']) q[k] = q[k].filter(x => !ids.includes(x.id));
        toast('Note deleted'); card = null; showNext();
      }
    }
  }

  function finished() {
    card = null; renderCounts();
    area.replaceChildren(h('div.study-done',
      h('div.emoji', '🎉'), h('h2', 'Done for now!'),
      h('p.muted', reviewed ? `You studied ${plural(reviewed, 'card')} this session.` : 'Nothing is due in this deck right now.'),
      h('p.muted.small', 'Come back later, or practise with a game.')));
    bar.replaceChildren(h('button.btn.primary.big.wide', { on: { click: close } }, 'Back to deck'));
  }
  function waiting(t) {
    card = null; renderCounts();
    const mins = Math.max(1, Math.round((t - Date.now()) / 6e4));
    area.replaceChildren(h('div.study-done', h('div.emoji', '⏳'), h('h2', 'Taking a short break'),
      h('p.muted', `Your next learning card is due in ${mins} minute${mins > 1 ? 's' : ''}.`)));
    bar.replaceChildren(h('div.btn-row', h('button.btn.big', { on: { click: close } }, 'Back'),
      h('button.btn.primary.big', { on: { click: () => { const c = q.learn.sort((a, b) => a.s.due - b.s.due)[0]; if (c) { c.s.due = Date.now(); } area.replaceChildren(host); showNext(); } } }, 'Study it now')));
  }

  function keys(e) {
    if (!el.isConnected || document.querySelector('.modal-wrap') || e.target.tagName === 'INPUT' && e.key !== 'Enter') return;
    if (!shown && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); reveal(); }
    else if (shown && ['1', '2', '3', '4'].includes(e.key)) rate(+e.key);
    else if (shown && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); rate(3); }
    else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) undo();
  }

  showNext();
}
