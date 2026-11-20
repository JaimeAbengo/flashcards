// Anki-compatible card template rendering.
import { S, mediaUrl, deckName } from './store.js';
import { esc, stripHtml } from './util.js';

export const fieldMap = (note, nt) => Object.fromEntries(nt.fields.map((f, i) => [f, note.fields[i] ?? '']));
export const isEmptyField = v => !String(v ?? '').replace(/<br\s*\/?>|<\/?div>|<\/?p>|&nbsp;|\s/gi, '');

const CLOZE_RE = /\{\{c(\d+)::((?:(?!\}\}|::|\{\{c\d+::)[\s\S])*)(?:::((?:(?!\}\})[\s\S])*))?\}\}/g;

// replace innermost clozes repeatedly so nested clozes work
function mapCloze(text, fn) {
  let prev, out = String(text);
  do { prev = out; out = out.replace(CLOZE_RE, (m, n, body, hint) => fn(+n, body, hint)); } while (out !== prev);
  return out;
}
export function clozeNumbers(text) {
  const nums = new Set(); let m; const re = /\{\{c(\d+)::/g;
  while ((m = re.exec(String(text)))) nums.add(+m[1]);
  return nums;
}
export function renderCloze(text, n, side) {
  return mapCloze(text, (k, body, hint) => {
    if (k !== n) return `<span class="cloze-inactive">${body}</span>`;
    if (side === 'q') return `<span class="cloze" data-cloze="${esc(body)}">[${hint ? esc(hint) : '...'}]</span>`;
    return `<span class="cloze">${body}</span>`;
  });
}
export function clozeAnswers(text, n) {
  const out = []; mapCloze(text, (k, body) => { if (k === n) out.push(body); return body; }); return out;
}
function clozeText(text, n) { // plain text with blanks, for games
  return stripHtml(mapCloze(text, (k, body, hint) => (k === n ? (hint ? `____ (${hint})` : '____') : body)));
}

function clozeFieldsOf(nt) {
  const names = new Set(); let m; const re = /\{\{(?:[^}]*:)?cloze:([^}]+)\}\}/g;
  for (const t of nt.templates) { re.lastIndex = 0; while ((m = re.exec(t.qfmt))) names.add(m[1].trim()); }
  return names.size ? [...names] : [nt.fields[0]];
}
export function clozeOrdsForNote(note, nt) {
  const fm = fieldMap(note, nt); const nums = new Set();
  for (const f of clozeFieldsOf(nt)) for (const n of clozeNumbers(fm[f])) nums.add(n);
  return [...nums].sort((a, b) => a - b).map(n => n - 1);
}

// which template ords should exist for this note
export function ordsToGenerate(note, nt) {
  if (nt.kind === 'cloze') { const o = clozeOrdsForNote(note, nt); return o.length ? o : [0]; }
  const empty = { ...note, fields: nt.fields.map(() => '') };
  const out = [];
  nt.templates.forEach((t, i) => {
    const sig = n => { const html = renderTemplate(t.qfmt, ctxFor(n, nt, i, 'q')); return stripHtml(html) + '|' + (html.match(/<img/gi) || []).length; };
    if (sig(note) !== sig(empty) && !isEmptyField(renderTemplate(t.qfmt, ctxFor(note, nt, i, 'q')).replace(/<[^>]+>/g, m => (/^<img/i.test(m) ? 'x' : '')))) out.push(i);
  });
  return out.length ? out : [0];
}

function ctxFor(note, nt, ord, side, extra = {}) {
  return { fields: fieldMap(note, nt), nt, ord, side, tags: note.tags || [], deck: '', ...extra };
}

function sectionTruthy(name, ctx) {
  if (name in ctx.fields) return !isEmptyField(ctx.fields[name]);
  const m = name.match(/^c(\d+)$/); if (m) return ctx.ord === +m[1] - 1;
  return false;
}

const SECT_RE = /\{\{([#^])\s*([^}]+?)\s*\}\}((?:(?!\{\{[#^])[\s\S])*?)\{\{\/\s*\2\s*\}\}/;
export function renderTemplate(fmt, ctx) {
  let s = String(fmt || ''), guard = 0;
  while (SECT_RE.test(s) && guard++ < 200) {
    s = s.replace(SECT_RE, (m, kind, name, body) => (sectionTruthy(name, ctx) === (kind === '#') ? body : ''));
  }
  return s.replace(/\{\{([^#^/}][^}]*)\}\}/g, (m, tag) => replaceTag(tag.trim(), ctx));
}

function replaceTag(tag, ctx) {
  switch (tag) {
    case 'FrontSide': return ctx.front ?? '';
    case 'Tags': return esc((ctx.tags || []).join(' '));
    case 'Deck': return esc(ctx.deck || '');
    case 'Subdeck': return esc((ctx.deck || '').split('::').pop());
    case 'Card': return esc(ctx.nt.templates[ctx.ord]?.name || ctx.nt.templates[0]?.name || '');
    case 'Type': return esc(ctx.nt.name);
    case 'CardFlag': return '';
  }
  const parts = tag.split(':');
  const field = parts.pop().trim();
  const filters = parts.map(p => p.trim());
  if (!(field in ctx.fields)) return filters.length || /^c\d+$/.test(field) ? '' : `<span class="unknown-field">{unknown field ${esc(field)}}</span>`;
  let v = ctx.fields[field];
  // filters apply right-to-left
  for (let i = filters.length - 1; i >= 0; i--) v = applyFilter(filters[i], v, ctx, field, filters.slice(0, i));
  return v;
}

function applyFilter(f, v, ctx, field, outer) {
  const name = f.split(' ')[0];
  switch (name) {
    case 'cloze': return renderCloze(v, ctx.ord + 1, ctx.side);
    case 'cloze-only': return esc(clozeAnswers(v, ctx.ord + 1).map(stripHtml).join(', '));
    case 'text': return esc(stripHtml(v));
    case 'hint': return isEmptyField(v) ? '' : `<details class="hint"><summary>Show ${esc(field)}</summary>${v}</details>`;
    case 'furigana': return String(v).replace(/ ?([^ >]+?)\[(.+?)\]/g, '<ruby><rb>$1</rb><rt>$2</rt></ruby>');
    case 'kana': return String(v).replace(/ ?([^ >]+?)\[(.+?)\]/g, '$2');
    case 'kanji': return String(v).replace(/ ?([^ >]+?)\[(.+?)\]/g, '$1');
    case 'tts': {
      const lang = (f.split(' ')[1] || '').replace('_', '-');
      return `<button class="tts-btn" data-lang="${esc(lang)}" data-text="${esc(stripHtml(v))}" aria-label="Speak">🔊</button>`;
    }
    case 'type': {
      const isCloze = outer.includes('cloze') || ctx.nt.kind === 'cloze' && f === 'type' && /\{\{c\d+::/.test(v);
      const expected = isCloze ? clozeAnswers(v, ctx.ord + 1).map(stripHtml).join(', ') : stripHtml(v);
      if (ctx.side === 'q') return `<div class="typeans-slot" data-expected="${esc(expected)}"></div>`;
      return typeComparison(ctx.typed, expected);
    }
    default: return v;
  }
}

export function typeComparison(typed, expected) {
  typed = (typed ?? '').trim();
  if (!typed) return `<div class="typeans-result"><span class="ta-exp">${esc(expected)}</span></div>`;
  if (typed === expected) return `<div class="typeans-result"><span class="ta-good">${esc(typed)}</span></div>`;
  // character diff (LCS) like Anki
  const a = [...typed], b = [...expected];
  const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let i = 0, j = 0, top = '', bot = '';
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { top += `<span class="ta-good">${esc(a[i])}</span>`; bot += `<span class="ta-good">${esc(b[j])}</span>`; i++; j++; }
    else if (j < b.length && (i >= a.length || L[i][j + 1] >= L[i + 1][j])) { bot += `<span class="ta-miss">${esc(b[j])}</span>`; j++; }
    else { top += `<span class="ta-bad">${esc(a[i])}</span>`; i++; }
  }
  return `<div class="typeans-result">${top}<br><span class="ta-arrow">↓</span><br>${bot}</div>`;
}

// Full card HTML for each side.
export function renderQA(card, { typed } = {}) {
  const note = S.notes.get(card.noteId); const nt = note && S.notetypes.get(note.ntId);
  if (!note || !nt) return { q: '<i>missing note</i>', a: '', css: '' };
  const tmpl = nt.kind === 'cloze' ? nt.templates[0] : (nt.templates[card.ord] || nt.templates[0]);
  const base = ctxFor(note, nt, card.ord, 'q', { deck: deckName(card.deckId) });
  const q = renderTemplate(tmpl.qfmt, base);
  const frontForAnswer = q.replace(/<div class="typeans-slot"[^>]*><\/div>/g, '');
  const a = renderTemplate(tmpl.afmt, { ...base, side: 'a', front: frontForAnswer, typed });
  return { q, a, css: nt.css || '' };
}

// Plain text question/answer for games.
export function cardTexts(card) {
  const note = S.notes.get(card.noteId); const nt = note && S.notetypes.get(note.ntId);
  if (!note || !nt) return null;
  if (nt.kind === 'cloze') {
    const fm = fieldMap(note, nt);
    const field = clozeFieldsOf(nt).find(f => clozeNumbers(fm[f]).has(card.ord + 1)) || nt.fields[0];
    const n = card.ord + 1;
    const q = clozeText(fm[field], n); const a = clozeAnswers(fm[field], n).map(stripHtml).join(', ');
    return { q, a, qHtml: esc(q), aHtml: esc(a) };
  }
  const tmpl = nt.templates[card.ord] || nt.templates[0];
  const ctx = ctxFor(note, nt, card.ord, 'q', { deck: deckName(card.deckId) });
  const qHtml = renderTemplate(tmpl.qfmt, ctx).replace(/<div class="typeans-slot"[^>]*><\/div>/g, '');
  let aHtml = renderTemplate(tmpl.afmt, { ...ctx, side: 'a', front: '', typed: '' })
    .replace(/<div class="typeans-result">[\s\S]*?<\/div>/g, '').replace(/^\s*(<br\s*\/?>|\s)*<hr[^>]*>/i, '');
  // a type-in template has the answer only inside the typeans; recover it from the q-side expected value
  let q = stripHtml(qHtml), a = stripHtml(aHtml);
  const tm = renderTemplate(tmpl.qfmt, ctx).match(/data-expected="([^"]*)"/);
  if (tm) { const d = new DOMParser().parseFromString(tm[1], 'text/html').body.textContent; if (!a || a === q) { a = d; aHtml = esc(d); } }
  if (q && a.startsWith(q) && a.length > q.length) a = a.slice(q.length).trim();
  return { q, a, qHtml, aHtml };
}

// ── media hydration (images, sounds, fonts) inside a rendered root ──
export function soundify(html) {
  return String(html).replace(/\[sound:([^\]]+)\]/g, (m, f) => `<button class="snd-btn" data-snd="${esc(f)}" aria-label="Play audio">▶</button>`);
}
// keep the browser from requesting media by file name before we swap in the stored copy
export const deferImgs = html => String(html).replace(/<img([^>]*?)\ssrc=(["']?)(?!(?:data:|blob:|https?:))([^"' >]+)\2/gi, '<img$1 data-msrc="$3"');
export async function hydrate(root) {
  await Promise.all([...root.querySelectorAll('img[src], img[data-msrc]')].map(async img => {
    const src = img.getAttribute('data-msrc') || img.getAttribute('src');
    if (/^(data:|blob:|https?:)/i.test(src)) { if (/^https?:/i.test(src)) img.replaceWith(Object.assign(document.createElement('span'), { className: 'remote-img', textContent: '🖼 online image' })); return; }
    let name = src; try { name = decodeURIComponent(src); } catch { }
    const u = await mediaUrl(name) || await mediaUrl(src);
    if (u) img.src = u; else img.classList.add('missing-media');
  }));
}
export async function cssWithMedia(css) {
  const names = [...String(css).matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map(m => m[1]);
  let out = css;
  for (const n of names) { if (/^(data:|https?:|blob:)/.test(n)) continue; const u = await mediaUrl(n); if (u) out = out.split(n).join(u); }
  return out.replace(/@import[^;]+;/g, '');
}
let audio;
export async function playSound(name) {
  const u = await mediaUrl(name); if (!u) return;
  if (audio) { audio.pause(); }
  audio = new Audio(u); audio.play().catch(() => { });
}
export function stopSound() { if (audio) audio.pause(); }
// sounds referenced in an html string, in order
export const soundsIn = html => [...String(html).matchAll(/data-snd="([^"]+)"/g)].map(m => new DOMParser().parseFromString(m[1], 'text/html').body.textContent);
