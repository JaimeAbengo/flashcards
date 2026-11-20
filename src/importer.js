// Import Anki packages (.apkg/.colpkg, old and new formats), text/CSV (Anki/Quizlet exports) and app backups.
import { unzipSync, strFromU8 } from 'fflate';
import { decompress as zstd } from 'fzstd';
import { S, put, putMany, putMediaMany, ensureDeck, notetypeByName, setKV, wipeAll, load } from './store.js';
import { fromAnki, emptyState } from './sched.js';
import { ordsToGenerate } from './templates.js';
import { guid } from './notes.js';
import { newId } from './util.js';

let SQL;
async function sql() {
  if (SQL) return SQL;
  const init = (await import('sql.js/dist/sql-wasm-browser.js')).default;
  SQL = await init({ locateFile: () => new URL('vendor/sql-wasm.wasm', location.href).href });
  return SQL;
}

const isZstd = u => u && u.length > 4 && u[0] === 0x28 && u[1] === 0xb5 && u[2] === 0x2f && u[3] === 0xfd;
const unz = u => (isZstd(u) ? zstd(u) : u);

// minimal protobuf reader: returns {fieldNo: [values]} (varints as numbers, length-delimited as Uint8Array)
function pb(buf) {
  const out = {}; let i = 0;
  const varint = () => { let r = 0, s = 0, b; do { b = buf[i++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return r; };
  while (i < buf.length) {
    const key = varint(), f = Math.floor(key / 8), t = key & 7; let v;
    if (t === 0) v = varint(); else if (t === 2) { const n = varint(); v = buf.subarray(i, i + n); i += n; }
    else if (t === 1) { v = buf.subarray(i, i + 8); i += 8; } else if (t === 5) { v = buf.subarray(i, i + 4); i += 4; } else break;
    (out[f] ||= []).push(v);
  }
  return out;
}
const td = new TextDecoder();
const pbStr = (m, f) => (m[f] ? td.decode(m[f][0]) : '');

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', mp4: 'video/mp4', webm: 'video/webm', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', css: 'text/css' };
export const mimeOf = name => MIME[(name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

// ───────────────────────── parse ─────────────────────────
// returns a "package" description, imported later by commit()
export async function parseFile(file, onStep = () => { }) {
  const name = file.name || 'import';
  const buf = new Uint8Array(await file.arrayBuffer());
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  if (!isZip) return parseText(td.decode(buf), name);
  onStep('Unzipping…');
  const zip = unzipSync(buf);
  if (zip['backup.json']) return { kind: 'backup', name, zip, summary: JSON.parse(strFromU8(zip['backup.json'])).summary };
  const colFile = zip['collection.anki21b'] ? 'collection.anki21b' : zip['collection.anki21'] ? 'collection.anki21' : 'collection.anki2';
  if (!zip[colFile]) throw new Error("This file doesn't look like an Anki deck.");
  onStep('Reading cards…');
  const SQLm = await sql();
  const db = new SQLm.Database(unz(zip[colFile]));
  // New-format collections use a custom "unicase" text collation that sql.js doesn't have. Swap it for NOCASE.
  try {
    const n = db.exec("SELECT count(*) FROM sqlite_master WHERE sql LIKE '%unicase%'")[0].values[0][0];
    if (n) {
      db.exec("PRAGMA writable_schema=ON; UPDATE sqlite_master SET sql=replace(sql,'COLLATE unicase','COLLATE NOCASE') WHERE sql LIKE '%unicase%'; PRAGMA writable_schema=OFF;");
      const fixed = db.export(); db.close();
      return parseAnkiDb(new SQLm.Database(fixed), zip, name);
    }
  } catch (e) { console.warn(e); }
  return parseAnkiDb(db, zip, name);
}

const rows = (db, q) => { const r = db.exec(q)[0]; return r ? r.values.map(v => Object.fromEntries(r.columns.map((c, i) => [c, v[i]]))) : []; };
const hasTable = (db, t) => rows(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='${t}'`).length > 0;

function parseAnkiDb(db, zip, name) {
  const col = rows(db, 'SELECT crt, models, decks FROM col')[0];
  let notetypes = [], decks = {};
  if (hasTable(db, 'notetypes') && rows(db, 'SELECT count(*) n FROM notetypes')[0].n > 0) {
    // new schema (v18): note types/templates/decks in their own tables, configs are protobuf
    const fields = rows(db, 'SELECT ntid, ord, name FROM fields ORDER BY ntid, ord');
    const tmpls = rows(db, 'SELECT ntid, ord, name, config FROM templates ORDER BY ntid, ord');
    for (const nt of rows(db, 'SELECT id, name, config FROM notetypes')) {
      const cfg = pb(nt.config);
      notetypes.push({
        ankiId: nt.id, name: nt.name, kind: (cfg[1]?.[0] === 1) ? 'cloze' : 'normal', css: pbStr(cfg, 3),
        fields: fields.filter(f => f.ntid === nt.id).map(f => f.name),
        templates: tmpls.filter(t => t.ntid === nt.id).map(t => { const c = pb(t.config); return { name: t.name, qfmt: pbStr(c, 1), afmt: pbStr(c, 2) }; }),
      });
    }
    for (const d of rows(db, 'SELECT id, name FROM decks')) decks[d.id] = d.name.split('\x1f').join('::');
  } else {
    const models = JSON.parse(col.models || '{}');
    for (const m of Object.values(models)) {
      notetypes.push({
        ankiId: +m.id, name: m.name, kind: m.type === 1 ? 'cloze' : 'normal', css: m.css || '',
        fields: [...m.flds].sort((a, b) => a.ord - b.ord).map(f => f.name),
        templates: [...m.tmpls].sort((a, b) => a.ord - b.ord).map(t => ({ name: t.name, qfmt: t.qfmt, afmt: t.afmt })),
      });
    }
    for (const d of Object.values(JSON.parse(col.decks || '{}'))) decks[d.id] = d.name;
  }
  const notes = rows(db, 'SELECT id, guid, mid, tags, flds FROM notes');
  const cards = rows(db, 'SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, data FROM cards');
  let revlog = [];
  try { revlog = rows(db, 'SELECT id, cid, ease, type, ivl, time FROM revlog'); } catch { }
  db.close();

  // media map: legacy = JSON {"0": "name"}, new = zstd'd protobuf list
  let media = {};
  if (zip.media) {
    const raw = unz(zip.media);
    try { media = JSON.parse(td.decode(raw)); }
    catch { const entries = pb(raw)[1] || []; entries.forEach((e, i) => { media[String(i)] = pbStr(pb(e), 1); }); }
  }
  const usedDecks = new Set(cards.map(c => c.did));
  const studied = cards.filter(c => c.type !== 0).length;
  return {
    kind: 'anki', name, crt: col.crt, notetypes, decks, notes, cards, revlog, media, zip,
    summary: {
      notes: notes.length, cards: cards.length, media: Object.keys(media).length, studied,
      decks: [...usedDecks].map(id => decks[id] || 'Default').filter((v, i, a) => a.indexOf(v) === i).sort(),
    },
  };
}

function parseText(text, name) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  let sep = null, html = true, deckCol = null, tagsCol = null;
  const data = [];
  for (const l of lines) {
    if (l.startsWith('#')) {
      const m = l.match(/^#(\w[\w ]*):(.*)$/);
      if (m) {
        const k = m[1].trim().toLowerCase(), v = m[2].trim();
        if (k === 'separator') sep = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', space: ' ', colon: ':' }[v.toLowerCase()] || v;
        if (k === 'html') html = v === 'true';
        if (k === 'deck column') deckCol = +v - 1;
        if (k === 'tags column') tagsCol = +v - 1;
      }
      continue;
    }
    if (l.trim()) data.push(l);
  }
  if (!sep) { const s = data.slice(0, 20).join('\n'); sep = s.includes('\t') ? '\t' : s.includes(';') && !s.includes(',') ? ';' : s.includes(',') ? ',' : ' - '; }
  const split = l => {
    if (sep === ' - ') { const i = l.indexOf(' - '); return i < 0 ? [l] : [l.slice(0, i), l.slice(i + 3)]; }
    const out = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"' && !cur) q = true; else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur); return out;
  };
  const toHtml = s => (html ? s : s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>'));
  const rowsOut = data.map(split).filter(r => r.length >= 2 && (r[0].trim() || r[1].trim())).map(r => ({
    front: toHtml(r[0].trim()), back: toHtml(r[1].trim()), deck: deckCol != null ? r[deckCol] : null,
    tags: tagsCol != null ? (r[tagsCol] || '').split(/\s+/).filter(Boolean) : [],
  }));
  if (!rowsOut.length) throw new Error("Couldn't find any cards in that file. Each line should have a front and back separated by a tab or comma.");
  const deck = name.replace(/\.(txt|csv|tsv)$/i, '');
  return { kind: 'text', name, rows: rowsOut, deck, summary: { notes: rowsOut.length, cards: rowsOut.length, media: 0, studied: 0, decks: [...new Set(rowsOut.map(r => r.deck || deck))] } };
}

// ───────────────────────── commit ─────────────────────────
export async function commit(pkg, { keepProgress = true, reversed = false, deckName } = {}, onProgress = () => { }) {
  if (pkg.kind === 'text') return commitText(pkg, { reversed, deckName });
  if (pkg.kind === 'backup') return restoreBackup(pkg, onProgress);

  // note types: reuse an identical one if we already have it
  const ntMap = new Map();
  for (const nt of pkg.notetypes) {
    const same = [...S.notetypes.values()].find(x => x.ankiId === nt.ankiId || (x.name === nt.name && JSON.stringify(x.fields) === JSON.stringify(nt.fields) && JSON.stringify(x.templates) === JSON.stringify(nt.templates) && x.css === nt.css));
    if (same) { ntMap.set(nt.ankiId, same); continue; }
    let nm = nt.name; let k = 2; while (notetypeByName(nm)) nm = `${nt.name} (${k++})`;
    const obj = { id: newId(), ankiId: nt.ankiId, name: nm, kind: nt.kind, fields: nt.fields, templates: nt.templates, css: nt.css };
    await put('notetypes', obj); ntMap.set(nt.ankiId, obj);
  }
  // decks
  const deckMap = new Map();
  for (const did of new Set(pkg.cards.map(c => c.did))) deckMap.set(did, (await ensureDeck(pkg.decks[did] || 'Default')).id);
  onProgress(0.1, 'Adding notes…');

  // notes (update existing ones with the same guid instead of duplicating)
  const byGuid = new Map([...S.notes.values()].filter(n => n.guid).map(n => [n.guid, n]));
  const noteMap = new Map(); const notesOut = []; let updated = 0;
  for (const n of pkg.notes) {
    const nt = ntMap.get(n.mid); if (!nt) continue;
    const fields = String(n.flds).split('\x1f');
    while (fields.length < nt.fields.length) fields.push('');
    const tags = String(n.tags || '').trim().split(/\s+/).filter(Boolean);
    const ex = byGuid.get(n.guid);
    if (ex && ex.ntId === nt.id) { ex.fields = fields; ex.tags = tags; ex.mod = Date.now(); notesOut.push(ex); noteMap.set(n.id, ex); updated++; continue; }
    const note = { id: newId(), guid: n.guid || guid(), ntId: nt.id, fields: fields.slice(0, nt.fields.length), tags, created: Date.now(), mod: Date.now() };
    notesOut.push(note); noteMap.set(n.id, note);
  }
  await putMany('notes', notesOut);
  onProgress(0.3, 'Adding cards…');

  const cardsOut = []; const cardIdMap = new Map();
  for (const c of pkg.cards) {
    const note = noteMap.get(c.nid); if (!note) continue;
    const existing = (S.cardsByNote.get(note.id) || []).map(id => S.cards.get(id)).find(x => x && x.ord === c.ord);
    if (existing) { cardIdMap.set(c.id, existing.id); continue; } // keep our progress on re-import
    const card = {
      id: newId(), noteId: note.id, deckId: deckMap.get(c.did), ord: c.ord,
      s: keepProgress ? fromAnki(c, pkg.crt) : emptyState(),
      susp: keepProgress && c.queue === -1, pos: c.type === 0 ? c.due : 0, created: Date.now(), mod: Date.now(),
    };
    cardsOut.push(card); cardIdMap.set(c.id, card.id);
  }
  await putMany('cards', cardsOut);

  if (keepProgress && pkg.revlog.length) {
    // Anki revlog types: 0 learn, 1 review, 2 relearn, 3 filtered, 4 manual (not a real answer -> skipped)
    const st = { 0: 1, 1: 2, 2: 3, 3: 2 };
    const known = new Set(S.revlog.map(x => x.id));
    const firstSeen = new Set();
    const logs = pkg.revlog.filter(r => cardIdMap.has(r.cid) && !known.has(r.id) && r.ease > 0 && r.type in st).sort((a, b) => a.id - b.id)
      .map(r => { const first = r.type === 0 && !firstSeen.has(r.cid); firstSeen.add(r.cid);
        return { id: r.id, cid: cardIdMap.get(r.cid), r: Math.min(4, Math.max(1, r.ease)), st: first ? 0 : st[r.type], ivl: r.ivl > 0 ? r.ivl * 1440 : Math.round(-r.ivl / 60), ms: r.time, imported: true }; });
    await putMany('revlog', logs); S.revlog.sort((a, b) => a.id - b.id);
  }

  // media
  const names = Object.entries(pkg.media);
  for (let i = 0; i < names.length; i += 40) {
    const items = [];
    for (const [num, fname] of names.slice(i, i + 40)) {
      const data = pkg.zip[num]; if (!data || !fname) continue;
      items.push({ name: fname, blob: new Blob([unz(data)], { type: mimeOf(fname) }) });
    }
    await putMediaMany(items);
    onProgress(0.5 + 0.5 * (i + 40) / names.length, `Saving images and audio… ${Math.min(i + 40, names.length)}/${names.length}`);
  }
  return { notes: notesOut.length - updated, updated, cards: cardsOut.length, media: names.length, deckId: deckMap.values().next().value };
}

async function commitText(pkg, { reversed, deckName }) {
  const nt = notetypeByName(reversed ? 'Basic (and reversed card)' : 'Basic') || [...S.notetypes.values()][0];
  const deckIds = new Map();
  const notes = [], cards = [];
  for (const [i, r] of pkg.rows.entries()) {
    const dn = r.deck || deckName || pkg.deck;
    if (!deckIds.has(dn)) deckIds.set(dn, (await ensureDeck(dn)).id);
    const note = { id: newId(), guid: guid(), ntId: nt.id, fields: [r.front, r.back], tags: r.tags, created: Date.now(), mod: Date.now() };
    notes.push(note);
    for (const ord of ordsToGenerate(note, nt)) cards.push({ id: newId(), noteId: note.id, deckId: deckIds.get(dn), ord, s: emptyState(), pos: i, created: Date.now(), mod: Date.now() });
  }
  await putMany('notes', notes); await putMany('cards', cards);
  return { notes: notes.length, updated: 0, cards: cards.length, media: 0, deckId: deckIds.values().next().value };
}

// ───────────────────────── app backups ─────────────────────────
async function restoreBackup(pkg, onProgress) {
  const data = JSON.parse(strFromU8(pkg.zip['backup.json']));
  await wipeAll();
  onProgress(0.1, 'Restoring…');
  for (const k of ['decks', 'notetypes', 'notes', 'cards', 'revlog']) await putMany(k, data[k] || []);
  for (const [k, v] of Object.entries(data.kv || {})) await setKV(k, v);
  const files = Object.keys(pkg.zip).filter(f => f.startsWith('media/') && f.length > 6);
  for (let i = 0; i < files.length; i += 40) {
    await putMediaMany(files.slice(i, i + 40).map(f => { const n = decodeURIComponent(f.slice(6)); return { name: n, blob: new Blob([pkg.zip[f]], { type: mimeOf(n) }) }; }));
    onProgress(0.2 + 0.8 * i / files.length, 'Restoring media…');
  }
  await load();
  return { restored: true, notes: (data.notes || []).length, cards: (data.cards || []).length, media: files.length };
}
