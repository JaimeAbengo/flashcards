// Small DOM + text helpers shared across the app.
// replaceChildren/append/prepend: skip null/false and flatten arrays (keeps conditional UI code simple)
for (const m of ['replaceChildren', 'append', 'prepend']) {
  const orig = Element.prototype[m];
  Element.prototype[m] = function (...k) { return orig.apply(this, k.flat(Infinity).filter(x => x != null && x !== false)); };
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const DAY = 864e5;

// h('div.cls#id', {attrs, on: {click}}, ...children)
export function h(tag, props, ...kids) {
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) { kids.unshift(props); props = {}; }
  const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const parser = new DOMParser();
// HTML -> plain text (drops sounds, keeps line structure as spaces)
export function stripHtml(html) {
  if (!html) return '';
  const s = String(html)
    .replace(/\[sound:[^\]]*\]/g, ' ')
    .replace(/<(br|\/div|\/p|\/li|hr)[^>]*>/gi, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  const doc = parser.parseFromString(s, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}
export const deaccent = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
export function normAnswer(s) {
  return String(s).normalize('NFC').toLowerCase().replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();
}
export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
// 'correct' | 'accent' | 'close' | 'wrong'
export function checkAnswer(input, answer) {
  const a = normAnswer(input); if (!a) return 'wrong';
  const alts = [answer, ...String(answer).split(/\s*[,;/]\s*|\s+or\s+/i)].map(normAnswer).filter(Boolean);
  if (alts.includes(a)) return 'correct';
  const da = deaccent(a);
  if (alts.some(x => deaccent(x) === da)) return 'accent';
  if (alts.some(x => { const d = levenshtein(da, deaccent(x)); return d <= Math.max(1, Math.floor(x.length / 8)) && x.length > 2; })) return 'close';
  return 'wrong';
}

export const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const uid = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);
let lastId = 0;
export const newId = () => { let id = Date.now(); if (id <= lastId) id = lastId + 1; lastId = id; return id; };

export function fmtInterval(ms) {
  const m = ms / 6e4;
  if (m < 1) return '<1m';
  if (m < 60) return Math.round(m) + 'm';
  const hr = m / 60; if (hr < 24) return Math.round(hr) + 'h';
  const d = hr / 24; if (d < 30) return Math.round(d) + 'd';
  if (d < 365) return (d / 30).toFixed(d < 300 ? 1 : 0).replace(/\.0$/, '') + 'mo';
  return (d / 365).toFixed(1).replace(/\.0$/, '') + 'y';
}
export const plural = (n, w, p = w + 's') => `${n.toLocaleString()} ${n === 1 ? w : p}`;

// ── toast / modals ──
export function toast(msg, ms = 2600) {
  let t = $('#toast');
  if (!t) { t = h('div#toast.toast'); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.classList.remove('show'); }, ms);
}

export function modal({ title, body, actions = [], cls = '' }) {
  return new Promise(resolve => {
    const close = v => { wrap.classList.add('closing'); setTimeout(() => wrap.remove(), 160); resolve(v); };
    const wrap = h('div.modal-wrap' + (cls ? '.' + cls : ''),
      h('div.modal-backdrop', { on: { click: () => close(null) } }),
      h('div.modal',
        title && h('div.modal-title', title),
        body && h('div.modal-body', typeof body === 'function' ? body(close) : body),
        actions.length && h('div.modal-actions', actions.map(a => h('button.btn' + (a.primary ? '.primary' : '') + (a.danger ? '.danger' : ''), { on: { click: () => close(a.value) } }, a.label)))));
    document.body.appendChild(wrap);
    const first = wrap.querySelector('input,select,textarea'); if (first) setTimeout(() => first.focus(), 50);
    wrap.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const p = actions.find(a => a.primary); if (p) close(p.value); } });
  });
}
// action sheet: items [{label, value, icon, danger}] -> value
export const menuSheet = (title, items) => modal({
  title, body: close => h('div.menu-list', items.filter(Boolean).map(it => h('button' + (it.danger ? '.danger' : ''), { on: { click: () => close(it.value) } }, it.icon ? icon(it.icon) : null, it.label))),
});
export const confirmBox = (msg, { ok = 'OK', danger = false, title = '' } = {}) =>
  modal({ title, body: h('p', msg), actions: [{ label: 'Cancel', value: false }, { label: ok, value: true, primary: !danger, danger }] });
export async function promptBox(title, value = '', { ok = 'Save', placeholder = '' } = {}) {
  const input = h('input.input', { value, placeholder, autocapitalize: 'sentences' });
  const r = await modal({ title, body: input, actions: [{ label: 'Cancel', value: null }, { label: ok, value: 'ok', primary: true }] });
  return r === 'ok' ? input.value.trim() : null;
}

// screen stack: full-page overlays above the tab views
const stack = [];
export function pushScreen(el, { onClose } = {}) {
  el.classList.add('screen');
  document.getElementById('app').appendChild(el);
  stack.push({ el, onClose });
  requestAnimationFrame(() => el.classList.add('in'));
  return () => popScreen(el);
}
export function popScreen(el) {
  const i = el ? stack.findIndex(s => s.el === el) : stack.length - 1;
  if (i < 0) return;
  const [s] = stack.splice(i, 1);
  s.el.classList.remove('in'); s.el.classList.add('out');
  setTimeout(() => s.el.remove(), 220);
  s.onClose && s.onClose();
}
export const topScreen = () => stack[stack.length - 1]?.el;
export function popAll() { while (stack.length) popScreen(); }

export function header(title, { back = true, right = [], onBack } = {}) {
  return h('header.bar',
    back ? h('button.icon-btn.back', { 'aria-label': 'Back', on: { click: () => (onBack ? onBack() : popScreen()) } }, icon('back')) : h('span.icon-spacer'),
    h('div.bar-title', title),
    h('div.bar-right', right));
}

const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
  speaker: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>', import: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>', check: '<path d="M4 12l5 5L20 6"/>',
  decks: '<rect x="4" y="7" width="13" height="13" rx="2"/><path d="M8 4h10a2 2 0 0 1 2 2v10"/>', browse: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  stats: '<path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8"/>', settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  flip: '<rect x="3" y="6" width="13" height="14" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v11"/>', learn: '<path d="M3 9l9-5 9 5-9 5z"/><path d="M7 11v5c3 2 7 2 10 0v-5"/>',
  match: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  write: '<path d="M4 20h16"/><path d="M6 16l9-9 3 3-9 9H6z"/>', test: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  gravity: '<circle cx="12" cy="9" r="5"/><path d="M8 19l-2 2M12 18v3M16 19l2 2"/>', image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
  study: '<path d="M7 4l12 8-12 8z"/>', folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>', down: '<path d="M6 9l6 6 6-6"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
};
export function icon(name, size = 22) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = ICONS[name] || ''; s.classList.add('ico');
  return s;
}

export function downloadFile(blob, name) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file] }).catch(() => { });
  const a = h('a', { href: URL.createObjectURL(file), download: name }); document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
