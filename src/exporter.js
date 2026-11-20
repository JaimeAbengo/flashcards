// Export decks as Anki .apkg files (classic format every Anki version can import) and full app backups.
import { zipSync, strToU8 } from 'fflate';
import { S, subtree, getMedia, deckName } from './store.js';
import { State } from './sched.js';
import { stripHtml, DAY } from './util.js';

let SQL;
async function sql() {
  if (SQL) return SQL;
  const init = (await import('sql.js/dist/sql-wasm-browser.js')).default;
  SQL = await init({ locateFile: () => new URL('vendor/sql-wasm.wasm', location.href).href });
  return SQL;
}

const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn); CREATE INDEX ix_cards_usn on cards (usn); CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid); CREATE INDEX ix_cards_sched on cards (did, queue, due); CREATE INDEX ix_revlog_cid on revlog (cid); CREATE INDEX ix_notes_csum on notes (csum);`;

async function sha1Int(text) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text)));
  return ((h[0] << 24) >>> 0) + (h[1] << 16) + (h[2] << 8) + h[3];
}

export async function exportApkg(deckId, { withProgress = true } = {}) {
  const SQLm = await sql();
  const db = new SQLm.Database();
  db.exec(SCHEMA);
  const ids = deckId ? subtree(deckId) : new Set(S.decks.keys());
  const cards = [...S.cards.values()].filter(c => ids.has(c.deckId));
  const notes = [...new Set(cards.map(c => c.noteId))].map(id => S.notes.get(id)).filter(Boolean);
  const nts = [...new Set(notes.map(n => n.ntId))].map(id => S.notetypes.get(id));
  const now = Date.now(), nowS = Math.floor(now / 1000);
  const crt = Math.floor(new Date(new Date().setHours(4, 0, 0, 0) - (new Date().getHours() < 4 ? DAY : 0)) / 1000);
  const today = Math.floor((nowS - crt) / 86400);

  const ankiDeckId = id => (id === 1 ? 1 : id);
  const decksJson = {};
  const deckList = [...ids].map(id => S.decks.get(id)).filter(Boolean);
  if (!deckList.some(d => d.id === 1)) deckList.push({ id: 1, name: 'Default' });
  for (const d of deckList) {
    decksJson[ankiDeckId(d.id)] = { id: ankiDeckId(d.id), name: d.name, mod: nowS, usn: -1, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0], collapsed: false, browserCollapsed: false, desc: '', dyn: 0, conf: 1, extendNew: 0, extendRev: 0 };
  }
  const modelsJson = {};
  const ntAnkiId = new Map();
  for (const nt of nts) {
    const mid = nt.ankiId || nt.id;
    ntAnkiId.set(nt.id, mid);
    modelsJson[mid] = {
      id: mid, name: nt.name, type: nt.kind === 'cloze' ? 1 : 0, mod: nowS, usn: -1, sortf: 0, did: null, tags: [], vers: [],
      flds: nt.fields.map((f, i) => ({ name: f, ord: i, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] })),
      tmpls: nt.templates.map((t, i) => ({ name: t.name, ord: i, qfmt: t.qfmt, afmt: t.afmt, did: null, bqfmt: '', bafmt: '' })),
      css: nt.css, latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n', latexPost: '\\end{document}', latexsvg: false,
      req: nt.templates.map((t, i) => [i, 'any', [0]]),
    };
  }
  const dconf = { 1: { id: 1, name: 'Default', mod: 0, usn: 0, maxTaken: 60, autoplay: true, timer: 0, replayq: true, dyn: false, new: { delays: [1, 10], ints: [1, 4, 0], initialFactor: 2500, order: 1, perDay: 20 }, rev: { perDay: 200, ease4: 1.3, ivlFct: 1, maxIvl: 36500, hardFactor: 1.2 }, lapse: { delays: [10], mult: 0, minInt: 1, leechFails: 8, leechAction: 1 } } };
  const conf = { activeDecks: [1], curDeck: 1, newSpread: 0, collapseTime: 1200, timeLim: 0, estTimes: true, dueCounts: true, curModel: null, nextPos: 1, sortType: 'noteFld', sortBackwards: false, addToCur: true };
  db.run('INSERT INTO col VALUES (1,?,?,?,11,0,0,0,?,?,?,?,?)', [crt, now, now, JSON.stringify(conf), JSON.stringify(modelsJson), JSON.stringify(decksJson), JSON.stringify(dconf), '{}']);

  const ins = db.prepare('INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const mediaUsed = new Set();
  for (const n of notes) {
    const sfld = stripHtml(n.fields[0] || '');
    for (const f of n.fields) {
      for (const m of String(f).matchAll(/<img[^>]+src=["']?([^"' >]+)/gi)) mediaUsed.add(decodeURIComponentSafe(m[1]));
      for (const m of String(f).matchAll(/\[sound:([^\]]+)\]/g)) mediaUsed.add(m[1]);
    }
    ins.run([n.id, n.guid || String(n.id), ntAnkiId.get(n.ntId), Math.floor((n.mod || now) / 1000), -1, n.tags?.length ? ` ${n.tags.join(' ')} ` : '', n.fields.join('\x1f'), sfld, await sha1Int(sfld), 0, '']);
  }
  ins.free();
  for (const nt of nts) for (const m of String(nt.css || '').matchAll(/url\(\s*["']?([^"')]+)/g)) mediaUsed.add(m[1]);

  const insC = db.prepare('INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  let pos = 1;
  for (const c of cards.sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))) {
    const s = c.s; let type = 0, queue = 0, due = pos++, ivl = 0, data = '{}';
    if (withProgress && s.state !== State.New) {
      type = 2; queue = 2;
      ivl = Math.max(1, Math.round(s.scheduled_days || (s.due - (s.last_review || now)) / DAY));
      due = Math.max(today, Math.floor((s.due / 1000 - crt) / 86400));
      data = JSON.stringify({ s: +s.stability.toFixed(4), d: +s.difficulty.toFixed(4) });
    }
    if (c.susp) queue = -1;
    insC.run([c.id, c.noteId, ankiDeckId(c.deckId), c.ord, Math.floor((c.mod || now) / 1000), -1, type, queue, due, ivl, type ? 2500 : 0, withProgress ? s.reps : 0, withProgress ? s.lapses : 0, 0, 0, 0, 0, data]);
  }
  insC.free();
  const dbBytes = db.export(); db.close();

  const files = { 'collection.anki2': dbBytes };
  const mediaMap = {}; let i = 0;
  for (const name of mediaUsed) {
    if (!S.mediaNames.has(name)) continue;
    const blob = await getMedia(name); if (!blob) continue;
    files[String(i)] = new Uint8Array(await blob.arrayBuffer()); mediaMap[i] = name; i++;
  }
  files.media = strToU8(JSON.stringify(mediaMap));
  const zipped = zipSync(files, { level: 6 });
  const fname = (deckId ? deckName(deckId).replace(/::/g, ' - ') : 'All decks').replace(/[^\p{L}\p{N} _-]/gu, '') + '.apkg';
  return { blob: new Blob([zipped], { type: 'application/octet-stream' }), name: fname, cards: cards.length, notes: notes.length, media: i };
}
function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

export async function exportBackup() {
  const data = {
    app: 'flashcards', v: 1, created: new Date().toISOString(),
    summary: { notes: S.notes.size, cards: S.cards.size, media: S.mediaNames.size, decks: [...S.decks.values()].map(d => d.name) },
    decks: [...S.decks.values()], notetypes: [...S.notetypes.values()], notes: [...S.notes.values()], cards: [...S.cards.values()], revlog: S.revlog, kv: S.kv,
  };
  const files = { 'backup.json': strToU8(JSON.stringify(data)) };
  for (const name of S.mediaNames) {
    const b = await getMedia(name); if (b) files['media/' + encodeURIComponent(name)] = [new Uint8Array(await b.arrayBuffer()), { level: 0 }];
  }
  const zipped = zipSync(files, { level: 6 });
  return { blob: new Blob([zipped], { type: 'application/zip' }), name: `flashcards-backup-${new Date().toISOString().slice(0, 10)}.zip` };
}
