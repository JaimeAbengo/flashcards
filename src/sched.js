// FSRS scheduling, daily limits, queues.
import { fsrs, createEmptyCard, Rating, generatorParameters, State } from 'ts-fsrs';
import { S, put, del, subtree, deckConf, setKV } from './store.js';
import { DAY, newId } from './util.js';

export { Rating, State };
let F, Fret;
function engine() {
  if (!F || Fret !== S.settings.retention) {
    Fret = S.settings.retention;
    F = fsrs(generatorParameters({ enable_fuzz: true, request_retention: S.settings.retention, maximum_interval: 36500 }));
  }
  return F;
}

// stored card state uses ms timestamps; ts-fsrs uses Dates
export const emptyState = () => toStore(createEmptyCard(new Date()));
function toStore(c) { return { ...c, due: +c.due, last_review: c.last_review ? +c.last_review : null }; }
function toFsrs(s) { return { ...s, due: new Date(s.due), last_review: s.last_review ? new Date(s.last_review) : undefined }; }

// "today" rolls over at settings.dayStart (default 4am), like Anki
export function dayStartMs(t = Date.now()) {
  const d = new Date(t - S.settings.dayStart * 3600e3); d.setHours(0, 0, 0, 0);
  return d.getTime() + S.settings.dayStart * 3600e3;
}
export const nextDayMs = (t = Date.now()) => dayStartMs(t) + DAY;
export const dayKey = (t = Date.now()) => { const d = new Date(dayStartMs(t)); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

export function preview(card, now = new Date()) {
  const r = engine().repeat(toFsrs(card.s), now);
  return { 1: +r[Rating.Again].card.due - +now, 2: +r[Rating.Hard].card.due - +now, 3: +r[Rating.Good].card.due - +now, 4: +r[Rating.Easy].card.due - +now };
}

// Grades a card. The new schedule takes effect immediately (in memory); saving to the phone's
// database happens in the background (`saved`), so the screen never waits on storage.
export function answer(card, rating, ms = 0) {
  const now = new Date();
  const before = { ...card.s };
  const { card: next } = engine().next(toFsrs(card.s), now, rating);
  card.s = toStore(next); card.mod = Date.now();
  const log = { id: newId(), cid: card.id, r: rating, st: before.state, ivl: Math.round((card.s.due - +now) / 6e4), ms };
  const saved = Promise.all([put('cards', card), put('revlog', log)]);
  unboost(card.id);
  return { card, before, log, saved };
}
export function undoAnswer(u) {
  u.card.s = u.before;
  const i = S.revlog.findIndex(x => x.id === u.log.id); if (i >= 0) S.revlog.splice(i, 1);
  // wait for the original save first, so the undo can't be overwritten by it
  return (async () => { await u.saved.catch(() => { }); await put('cards', u.card); await del('revlog', u.log.id); })();
}
export async function resetCard(card) { card.s = emptyState(); card.pos = Date.now(); await put('cards', card); }
export async function setDueNow(card) { card.s = { ...card.s, due: Date.now() }; await put('cards', card); }

// ── games pull missed cards into today's reviews ──
function boostSet() { const b = S.kv.boost; return b && b.day === dayKey() ? new Set(b.ids) : new Set(); }
export function boost(ids) {
  const set = boostSet(); for (const id of ids) set.add(id);
  return setKV('boost', { day: dayKey(), ids: [...set] });
}
function unboost(id) { const set = boostSet(); if (set.delete(id)) setKV('boost', { day: dayKey(), ids: [...set] }); }

// ── today's counts & queues ──
function doneToday(deckIds) {
  const start = dayStartMs(); let nw = 0, rev = 0;
  for (let i = S.revlog.length - 1; i >= 0; i--) {
    const l = S.revlog[i]; if (l.id < start) break;
    const c = S.cards.get(l.cid); if (!c || !deckIds.has(c.deckId)) continue;
    if (l.st === State.New) nw++; else if (l.st === State.Review) rev++;
  }
  return { nw, rev };
}

export function deckCards(deckId) {
  const ids = subtree(deckId); const out = [];
  for (const c of S.cards.values()) if (ids.has(c.deckId)) out.push(c);
  return { ids, cards: out };
}

export function buildQueue(deckId) {
  const now = Date.now(), end = nextDayMs(now);
  const { ids, cards } = deckCards(deckId);
  const conf = deckConf(deckId);
  const done = doneToday(ids);
  const boosted = boostSet();
  const learn = [], review = [], fresh = [];
  for (const c of cards) {
    if (c.susp) continue;
    const st = c.s.state;
    if (st === State.New) fresh.push(c);
    else if (st === State.Learning || st === State.Relearning) learn.push(c);
    else if (c.s.due < end || boosted.has(c.id)) review.push(c);
  }
  fresh.sort((a, b) => (boosted.has(b.id) - boosted.has(a.id)) || (a.pos ?? a.id) - (b.pos ?? b.id));
  review.sort((a, b) => a.s.due - b.s.due);
  learn.sort((a, b) => a.s.due - b.s.due);
  const newLeft = Math.max(0, conf.newPerDay - done.nw);
  const revLeft = Math.max(0, conf.revPerDay - done.rev);
  const nBoosted = fresh.filter(c => boosted.has(c.id)).length; // cards missed in games are always included
  return { learn, review: review.slice(0, revLeft), fresh: fresh.slice(0, Math.max(newLeft, nBoosted)), totalNew: fresh.length };
}

export function counts(deckId) {
  const q = buildQueue(deckId), now = Date.now(), end = nextDayMs(now);
  return { nw: q.fresh.length, learn: q.learn.filter(c => c.s.due < end).length, due: q.review.length };
}

// pick the next card for a session. Learning cards due now come first, then reviews and new cards interleaved.
export function nextCard(q, { exclude } = {}) {
  const now = Date.now();
  const ok = c => c && c.id !== exclude;
  const lrn = q.learn.filter(ok).sort((a, b) => a.s.due - b.s.due);
  if (lrn[0] && lrn[0].s.due <= now) return lrn[0];
  const rev = q.review.find(ok), nw = q.fresh.find(ok);
  if (rev && nw) return (q._n = (q._n || 0) + 1) % 4 === 0 ? nw : rev;
  if (rev || nw) return rev || nw;
  // nothing else left: show learning cards early if due within 20 minutes (Anki's "learn ahead")
  if (lrn[0] && lrn[0].s.due <= now + 20 * 6e4) return lrn[0];
  if (lrn[0] && lrn.length && !rev && !nw) return { wait: lrn[0].s.due };
  return null;
}
export function removeFromQueue(q, card) {
  for (const k of ['learn', 'review', 'fresh']) { const i = q[k].indexOf(card); if (i >= 0) q[k].splice(i, 1); }
  if (card.s.state === State.Learning || card.s.state === State.Relearning) { if (card.s.due < nextDayMs()) q.learn.push(card); }
}

// study streak (consecutive days with at least one review)
export function streak() {
  const days = new Set(S.revlog.map(l => dayKey(l.id)));
  let n = 0, t = Date.now();
  if (!days.has(dayKey(t))) t -= DAY;
  while (days.has(dayKey(t))) { n++; t -= DAY; }
  return n;
}

// card state label for browse
export function stateLabel(c) {
  if (c.susp) return 'Suspended';
  const st = c.s.state;
  if (st === State.New) return 'New';
  if (st === State.Learning || st === State.Relearning) return 'Learning';
  const d = Math.round((c.s.due - Date.now()) / DAY);
  return d <= 0 ? 'Due' : `Due in ${d}d`;
}

// Convert an Anki card's scheduling into an FSRS state.
export function fromAnki(card, crtSec) {
  const s = emptyState();
  const type = card.type, now = Date.now();
  let data = {}; try { data = JSON.parse(card.data || '{}'); } catch { }
  if (type === 0) return s;
  if (type === 2 || type === 3) {
    const ivl = Math.max(1, card.ivl);
    const due = type === 2 ? (crtSec * 1000 + card.due * DAY) : now;
    return {
      ...s, state: type === 2 ? State.Review : State.Relearning,
      due: type === 2 ? due : now,
      stability: data.s || ivl, difficulty: data.d || Math.min(10, Math.max(1, 5 + (2500 - (card.factor || 2500)) / 200)),
      scheduled_days: ivl, elapsed_days: 0, reps: card.reps || 1, lapses: card.lapses || 0,
      learning_steps: 0, last_review: (type === 2 ? due : now) - ivl * DAY,
    };
  }
  // learning
  return { ...s, state: State.Learning, due: Math.min(now, card.due > 1e9 ? card.due * 1000 : now), reps: card.reps || 1, lapses: card.lapses || 0, stability: data.s || 0.5, difficulty: data.d || 5, last_review: now - 6e4 };
}
