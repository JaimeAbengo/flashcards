// In-memory collection, persisted to IndexedDB (write-through).
import { newId } from './util.js';

const STORES = ['kv', 'decks', 'notetypes', 'notes', 'cards', 'revlog', 'media'];
let dbp;
function open() {
  return dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('flashcards', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('kv');
      for (const s of ['decks', 'notetypes', 'notes', 'cards', 'revlog']) d.createObjectStore(s, { keyPath: 'id' });
      d.createObjectStore('media', { keyPath: 'name' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(stores, mode, fn) {
  return open().then(d => new Promise((res, rej) => {
    const t = d.transaction(stores, mode);
    let out; const r = fn(t); if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('aborted'));
  }));
}

export const S = {
  decks: new Map(), notetypes: new Map(), notes: new Map(), cards: new Map(), revlog: [],
  cardsByNote: new Map(), mediaNames: new Set(), settings: null, kv: {},
};

export const DEFAULT_SETTINGS = { retention: 0.9, dayStart: 4, newPerDay: 20, revPerDay: 200, theme: 'auto', ttsRate: 1, showIntervals: true, offline: false, deckSort: 'added' };

export async function load() {
  const d = await open();
  const all = s => new Promise((res, rej) => { const r = d.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const keys = s => new Promise((res, rej) => { const r = d.transaction(s).objectStore(s).getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const [decks, nts, notes, cards, revlog, mediaNames, kvKeys, kvVals] = await Promise.all(
    [all('decks'), all('notetypes'), all('notes'), all('cards'), all('revlog'), keys('media'), keys('kv'), all('kv')]);
  S.decks = new Map(decks.map(x => [x.id, x]));
  S.notetypes = new Map(nts.map(x => [x.id, x]));
  S.notes = new Map(notes.map(x => [x.id, x]));
  S.cards = new Map(cards.map(x => [x.id, x]));
  S.revlog = revlog.sort((a, b) => a.id - b.id);
  S.mediaNames = new Set(mediaNames);
  S.kv = Object.fromEntries(kvKeys.map((k, i) => [k, kvVals[i]]));
  S.settings = { ...DEFAULT_SETTINGS, ...(S.kv.settings || {}) };
  S.cardsByNote = new Map();
  for (const c of S.cards.values()) indexCard(c);
  if (!S.notetypes.size) for (const nt of defaultNotetypes()) await put('notetypes', nt);
  if (!S.decks.size) await put('decks', { id: 1, name: 'Default', created: Date.now() });
}
function indexCard(c) { let l = S.cardsByNote.get(c.noteId); if (!l) S.cardsByNote.set(c.noteId, l = []); if (!l.includes(c.id)) l.push(c.id); }

const MAPS = { decks: 'decks', notetypes: 'notetypes', notes: 'notes', cards: 'cards' };
export function put(store, obj) {
  if (MAPS[store]) S[MAPS[store]].set(obj.id, obj);
  if (store === 'cards') indexCard(obj);
  if (store === 'revlog') S.revlog.push(obj);
  return tx(store, 'readwrite', t => t.objectStore(store).put(obj));
}
export async function putMany(store, arr, chunk = 2000) {
  for (const o of arr) {
    if (MAPS[store]) S[MAPS[store]].set(o.id, o);
    if (store === 'cards') indexCard(o);
    if (store === 'revlog') S.revlog.push(o);
  }
  for (let i = 0; i < arr.length; i += chunk) {
    const part = arr.slice(i, i + chunk);
    await tx(store, 'readwrite', t => { const s = t.objectStore(store); for (const o of part) s.put(o); });
  }
}
export function del(store, id) {
  if (MAPS[store]) S[MAPS[store]].delete(id);
  if (store === 'cards') {
    const c = S.cards.get(id);
    for (const [nid, l] of S.cardsByNote) { const i = l.indexOf(id); if (i >= 0) { l.splice(i, 1); if (!l.length) S.cardsByNote.delete(nid); break; } }
  }
  return tx(store, 'readwrite', t => t.objectStore(store).delete(id));
}
export async function delMany(store, ids) {
  for (const id of ids) {
    if (MAPS[store]) S[MAPS[store]].delete(id);
  }
  if (store === 'cards') { const set = new Set(ids); for (const [nid, l] of S.cardsByNote) { const k = l.filter(x => !set.has(x)); if (k.length) S.cardsByNote.set(nid, k); else S.cardsByNote.delete(nid); } }
  for (let i = 0; i < ids.length; i += 2000) {
    const part = ids.slice(i, i + 2000);
    await tx(store, 'readwrite', t => { const s = t.objectStore(store); for (const id of part) s.delete(id); });
  }
}
export function setKV(k, v) { S.kv[k] = v; return tx('kv', 'readwrite', t => t.objectStore('kv').put(v, k)); }
export function saveSettings() { return setKV('settings', S.settings); }

// ── media ──
export async function putMedia(name, blob) {
  S.mediaNames.add(name);
  await tx('media', 'readwrite', t => t.objectStore('media').put({ name, blob }));
}
export async function putMediaMany(items) {
  for (let i = 0; i < items.length; i += 50) {
    const part = items.slice(i, i + 50);
    await tx('media', 'readwrite', t => { const s = t.objectStore('media'); for (const m of part) s.put(m); });
    for (const m of part) S.mediaNames.add(m.name);
  }
}
export function getMedia(name) { return tx('media', 'readonly', t => t.objectStore('media').get(name)).then(r => r && r.blob); }
export async function delMedia(name) { S.mediaNames.delete(name); await tx('media', 'readwrite', t => t.objectStore('media').delete(name)); }
const urlCache = new Map();
export async function mediaUrl(name) {
  if (urlCache.has(name)) return urlCache.get(name);
  if (!S.mediaNames.has(name)) return null;
  const blob = await getMedia(name); if (!blob) return null;
  const u = URL.createObjectURL(blob); urlCache.set(name, u); return u;
}
export async function wipeAll() {
  await tx(STORES, 'readwrite', t => { for (const s of STORES) t.objectStore(s).clear(); });
}

// ── decks ──
// ── deck ordering ──
// "natural" compare: 1, 2, 10 instead of 1, 10, 2
export const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;
const leaf = d => d.name.split('::').pop();
export function sortSiblings(list) {
  const mode = S.settings.deckSort || 'added';
  const added = (a, b) => (a.created || a.id) - (b.created || b.id) || a.id - b.id;
  if (mode === 'name') return list.sort((a, b) => natural(leaf(a), leaf(b)));
  if (mode === 'custom') return list.sort((a, b) => (a.order ?? 1e15) - (b.order ?? 1e15) || added(a, b));
  return list.sort(added);
}
// direct children of a deck (or top-level decks when parent is null), in display order
export function deckChildren(parent) {
  const pre = parent ? parent.name + '::' : '';
  return sortSiblings([...S.decks.values()].filter(x => x.name.startsWith(pre) && x.name.length > pre.length && !x.name.slice(pre.length).includes('::')));
}
// every deck in tree order (for pickers)
export function deckTreeOrder() {
  const out = []; const walk = (p, depth) => { for (const d of deckChildren(p)) { out.push([d, depth]); walk(d, depth + 1); } };
  walk(null, 0); return out;
}

export const deckName = id => S.decks.get(id)?.name ?? 'Default';
export function deckByName(name) { for (const d of S.decks.values()) if (d.name.toLowerCase() === name.toLowerCase()) return d; return null; }
export async function ensureDeck(name) {
  name = name.split('::').map(s => s.trim()).filter(Boolean).join('::') || 'Default';
  const parts = name.split('::'); let found;
  for (let i = 1; i <= parts.length; i++) {
    const n = parts.slice(0, i).join('::');
    found = deckByName(n);
    if (!found) { found = { id: newId(), name: n, created: Date.now() }; await put('decks', found); }
  }
  return found;
}
export function subtree(id) {
  const d = S.decks.get(id); if (!d) return new Set();
  const pre = d.name.toLowerCase() + '::';
  const ids = new Set([id]);
  for (const x of S.decks.values()) if (x.name.toLowerCase().startsWith(pre)) ids.add(x.id);
  return ids;
}
export const cardsInDeck = id => { const t = subtree(id); return [...S.cards.values()].filter(c => t.has(c.deckId)); };
export function deckConf(id) {
  const d = S.decks.get(id) || {};
  return { newPerDay: d.newPerDay ?? S.settings.newPerDay, revPerDay: d.revPerDay ?? S.settings.revPerDay, ttsFront: d.ttsFront || '', ttsBack: d.ttsBack || '' };
}

// ── default note types (same templates as Anki's built-ins) ──
const CSS = `.card {\n  font-family: arial;\n  font-size: 20px;\n  text-align: center;\n  color: black;\n  background-color: white;\n}\n`;
const CLOZE_CSS = CSS + `.cloze {\n  font-weight: bold;\n  color: blue;\n}\n.nightMode .cloze {\n  color: lightblue;\n}\n`;
const ANS = '{{FrontSide}}\n\n<hr id=answer>\n\n';
export function defaultNotetypes() {
  const t = Date.now();
  return [
    { id: t + 1, name: 'Basic', kind: 'normal', fields: ['Front', 'Back'], css: CSS, templates: [{ name: 'Card 1', qfmt: '{{Front}}', afmt: ANS + '{{Back}}' }] },
    { id: t + 2, name: 'Basic (and reversed card)', kind: 'normal', fields: ['Front', 'Back'], css: CSS, templates: [{ name: 'Card 1', qfmt: '{{Front}}', afmt: ANS + '{{Back}}' }, { name: 'Card 2', qfmt: '{{Back}}', afmt: ANS + '{{Front}}' }] },
    { id: t + 3, name: 'Basic (type in the answer)', kind: 'normal', fields: ['Front', 'Back'], css: CSS, templates: [{ name: 'Card 1', qfmt: '{{Front}}\n\n{{type:Back}}', afmt: '{{Front}}\n\n<hr id=answer>\n\n{{type:Back}}' }] },
    { id: t + 4, name: 'Cloze', kind: 'cloze', fields: ['Text', 'Back Extra'], css: CLOZE_CSS, templates: [{ name: 'Cloze', qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>\n{{Back Extra}}' }] },
  ];
}
export const notetypeByName = name => [...S.notetypes.values()].find(n => n.name === name);
