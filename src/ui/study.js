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
  // phase: 'question' (Show answer visible), 'answer' (rating buttons visible) or 'idle'
  let card = null, phase = 'idle', started = 0, revealedAt = 0, reviewed = 0, seq = 0;
  const undos = [];

  const countsEl = h('div.study-counts');
  const undoBtn = h('button.icon-btn', { 'aria-label': 'Undo', on: { click: undo } }, icon('undo'));
  const menuBtn = h('button.icon-btn', { 'aria-label': 'More', on: { click: menu } }, icon('more'));
  const host = h('div.card-host', { on: { click: e => { if (phase === 'question' && !e.composedPath().some(el => el.tagName === 'INPUT' || el.tagName === 'BUTTON' || el.tagName === 'SUMMARY' || el.tagName === 'A')) reveal(); } } });
  const area = h('div.card-area', host);
  // The buttons are created once and reused, so a tap is never lost to a button being rebuilt.
  const showBtn = h('button.btn.primary.big.wide', { on: { click: reveal } }, 'Show answer');
  const LABELS = ['', 'Again', 'Hard', 'Good', 'Easy'];
  const rateBtns = [1, 2, 3, 4].map(r => h(`button.r${r}`, { on: { click: () => rate(r) } }, h('small'), h('span', LABELS[r])));
  const rateRow = h('div.rate', rateBtns);
  const bar = h('div.answer-bar');
  const el = h('div.study',
    header(countsEl, { right: [undoBtn, menuBtn], onBack: close }),
    area, bar);
  pushScreen(el, { onClose: () => { seq++; stopSound(); stopSpeaking(); document.removeEventListener('keydown', keys); onClose && onClose(); } });
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

  // draw a card side right away; `after` runs once its images are in (skipped if another card came first)
  function draw(html, css, ttsLang, after) {
    const my = ++seq;
    let m;
    try { m = mountCard(host, html, css, { onEnter: reveal, ttsLang, alive: () => my === seq }); }
    catch (e) { console.error(e); host.shadowRoot && (host.shadowRoot.innerHTML = '<div style="padding:24px;text-align:center">This card could not be displayed.</div>'); return null; }
    m.ready.then(() => { if (my === seq && after) after(m); });
    return m;
  }

  // show a card's question
  function showCard(c) {
    stopSound(); stopSpeaking();
    card = c; phase = 'question'; started = Date.now();
    if (!host.isConnected) area.replaceChildren(host);
    renderCounts();
    bar.replaceChildren(showBtn);
    const { q: qh, css } = renderQA(card);
    const m = draw(qh, css, conf.ttsFront, m => {
      if (m.sounds.length) autoplay(m.sounds);
      else if (conf.ttsAuto && conf.ttsFront) speak(stripHtml(qh), conf.ttsFront);
    });
    area.scrollTop = 0;
    if (m && m.input) setTimeout(() => { if (phase === 'question' && card === c) m.input.focus(); }, 250);
  }

  function showNext() {
    const nx = nextCard(q);
    if (!nx) return finished();
    if (nx.wait) return waiting(nx.wait);
    showCard(nx);
  }

  function reveal() {
    if (!card || phase !== 'question') return;
    phase = 'answer'; revealedAt = performance.now();
    stopSound();
    const typed = host.shadowRoot?.querySelector('.typeans-input')?.value;
    let p = null;
    try { p = preview(card); } catch (e) { console.error(e); }
    rateBtns.forEach((b, i) => { const sm = b.firstChild; sm.textContent = p && S.settings.showIntervals ? fmtInterval(p[i + 1]) : ''; sm.hidden = !sm.textContent; });
    bar.replaceChildren(rateRow);
    const qs = renderQA(card).q;
    const { a, css } = renderQA(card, { typed });
    draw(a, css, conf.ttsBack, m => {
      if (m.sounds.length) { const newOnes = m.sounds.filter(s => !qs.includes(s)); autoplay(newOnes); }
      else if (conf.ttsAuto && conf.ttsBack) speak(stripHtml(a.split(/<hr id=answer>/i).pop()), conf.ttsBack);
    });
  }

  function rate(r) {
    if (!card || phase !== 'answer') return;
    // a double-tap on "Show answer" shouldn't also grade the card
    if (performance.now() - revealedAt < 180) return;
    const c = card;
    let u;
    try { u = answer(c, r, Math.min(60000, Date.now() - started)); }
    catch (e) { console.error(e); toast("Couldn't grade this card: " + (e.message || e)); return; }
    u.saved.catch(e => { console.error(e); toast("Couldn't save your last answer. Is the phone's storage full?"); });
    undos.push(u); reviewed++;
    removeFromQueue(q, c);
    showNext();
  }

  function undo() {
    const u = undos.pop(); if (!u) return;
    undoAnswer(u).catch(e => { console.error(e); toast("Couldn't save the undo"); });
    reviewed--;
    // put the card back into the right queue and show it again
    for (const k of ['learn', 'review', 'fresh']) { const i = q[k].indexOf(u.card); if (i >= 0) q[k].splice(i, 1); }
    const st = u.card.s.state;
    (st === State.New ? q.fresh : st === State.Review ? q.review : q.learn).unshift(u.card);
    showCard(u.card);
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
      const shown = phase === 'answer';
      if (v === 'speak') { const { q: qh, a } = renderQA(c); speak(stripHtml(shown ? a.split(/<hr id=answer>/i).pop() : qh), shown ? conf.ttsBack : conf.ttsFront); }
      if (v === 'edit') openEditor({ note, onSave: () => { if (card === c && S.cards.has(c.id)) showCard(c); } });
      if (v === 'suspend') { c.susp = true; put('cards', c).catch(e => console.error(e)); removeFromQueue(q, c); const i = q.learn.indexOf(c); if (i >= 0) q.learn.splice(i, 1); toast('Card suspended'); showNext(); }
      if (v === 'delete') {
        if (!(await confirmBox('Delete this note and all its cards?', { ok: 'Delete', danger: true }))) return;
        const ids = S.cardsByNote.get(c.noteId) || [];
        await deleteNotes([c.noteId]);
        for (const k of ['learn', 'review', 'fresh']) q[k] = q[k].filter(x => !ids.includes(x.id));
        toast('Note deleted'); showNext();
      }
    }
  }

  function finished() {
    card = null; phase = 'idle'; seq++; renderCounts();
    area.replaceChildren(h('div.study-done',
      h('div.emoji', '🎉'), h('h2', 'Done for now!'),
      h('p.muted', reviewed ? `You studied ${plural(reviewed, 'card')} this session.` : 'Nothing is due in this deck right now.'),
      h('p.muted.small', 'Come back later, or practise with a game.')));
    bar.replaceChildren(h('button.btn.primary.big.wide', { on: { click: close } }, 'Back to deck'));
  }
  function waiting(t) {
    card = null; phase = 'idle'; seq++; renderCounts();
    const mins = Math.max(1, Math.round((t - Date.now()) / 6e4));
    area.replaceChildren(h('div.study-done', h('div.emoji', '⏳'), h('h2', 'Taking a short break'),
      h('p.muted', `Your next learning card is due in ${mins} minute${mins > 1 ? 's' : ''}.`)));
    bar.replaceChildren(h('div.btn-row', h('button.btn.big', { on: { click: close } }, 'Back'),
      h('button.btn.primary.big', { on: { click: () => { const c = q.learn.sort((a, b) => a.s.due - b.s.due)[0]; if (c) { c.s.due = Date.now(); } showNext(); } } }, 'Study it now')));
  }

  function keys(e) {
    if (!el.isConnected || document.querySelector('.modal-wrap') || e.target.tagName === 'INPUT' && e.key !== 'Enter') return;
    if (phase === 'question' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); reveal(); }
    else if (phase === 'answer' && ['1', '2', '3', '4'].includes(e.key)) rate(+e.key);
    else if (phase === 'answer' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); rate(3); }
    else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) undo();
  }

  showNext();
}
