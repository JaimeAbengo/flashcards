// Creating, editing and deleting notes (a note generates one or more cards).
import { S, put, putMany, del, delMany } from './store.js';
import { ordsToGenerate } from './templates.js';
import { emptyState } from './sched.js';
import { newId, stripHtml } from './util.js';

export const guid = () => Math.random().toString(36).slice(2, 12);

export async function createNote(ntId, deckId, fields, tags = []) {
  const note = { id: newId(), guid: guid(), ntId, fields, tags, created: Date.now(), mod: Date.now() };
  const nt = S.notetypes.get(ntId);
  await put('notes', note);
  const cards = ordsToGenerate(note, nt).map((ord, i) => ({ id: newId(), noteId: note.id, deckId, ord, s: emptyState(), pos: Date.now() + i, created: Date.now(), mod: Date.now() }));
  await putMany('cards', cards);
  return { note, cards };
}

export async function updateNote(note, fields, tags, deckId) {
  note.fields = fields; note.tags = tags; note.mod = Date.now();
  await put('notes', note);
  const nt = S.notetypes.get(note.ntId);
  const want = new Set(ordsToGenerate(note, nt));
  const existing = (S.cardsByNote.get(note.id) || []).map(id => S.cards.get(id)).filter(Boolean);
  const have = new Set(existing.map(c => c.ord));
  const deck = deckId ?? existing[0]?.deckId ?? 1;
  const add = [...want].filter(o => !have.has(o)).map((ord, i) => ({ id: newId(), noteId: note.id, deckId: deck, ord, s: emptyState(), pos: Date.now() + i, created: Date.now(), mod: Date.now() }));
  if (add.length) await putMany('cards', add);
  const remove = existing.filter(c => !want.has(c.ord)).map(c => c.id);
  if (remove.length) await delMany('cards', remove);
  if (deckId != null) for (const c of existing) if (c.deckId !== deckId && want.has(c.ord)) { c.deckId = deckId; await put('cards', c); }
  return { added: add.length, removed: remove.length };
}

export async function deleteNotes(noteIds) {
  const cardIds = [];
  for (const nid of noteIds) cardIds.push(...(S.cardsByNote.get(nid) || []));
  await delMany('cards', cardIds);
  await delMany('notes', [...noteIds]);
  return cardIds.length;
}

export async function deleteDeck(deckId, subtreeIds) {
  const cards = [...S.cards.values()].filter(c => subtreeIds.has(c.deckId));
  const notes = new Set(cards.map(c => c.noteId));
  // only delete notes whose cards are all inside this deck
  const fully = [...notes].filter(nid => (S.cardsByNote.get(nid) || []).every(cid => subtreeIds.has(S.cards.get(cid)?.deckId)));
  const partialCards = cards.filter(c => !fully.includes(c.noteId)).map(c => c.id);
  await deleteNotes(fully);
  if (partialCards.length) await delMany('cards', partialCards);
  for (const id of subtreeIds) if (id !== 1) await del('decks', id);
  return cards.length;
}

export const sortField = note => stripHtml(note.fields[0] || '');
