// Add / edit notes.
import { S, putMedia, mediaUrl, ensureDeck, setKV, deckName, notetypeByName } from '../store.js';
import { createNote, updateNote, deleteNotes } from '../notes.js';
import { ordsToGenerate, clozeNumbers, deferImgs } from '../templates.js';
import { h, header, pushScreen, popScreen, icon, toast, confirmBox, promptBox, esc, stripHtml } from '../util.js';

export function openEditor({ note, deckId, ntId, onSave } = {}) {
  const isNew = !note;
  let nt = S.notetypes.get(note ? note.ntId : ntId || S.kv.lastNt) || notetypeByName('Basic') || [...S.notetypes.values()][0];
  let deck = note ? (S.cards.get((S.cardsByNote.get(note.id) || [])[0])?.deckId ?? 1) : (deckId || S.kv.lastDeck || 1);
  if (!S.decks.has(deck)) deck = [...S.decks.keys()][0];
  let fieldEls = [], focused = null;

  const saveBtn = h('button.link-btn', { on: { click: save } }, isNew ? 'Add' : 'Save');
  const body = h('div.screen-body');
  const el = h('div.editor', header(isNew ? 'Add card' : 'Edit note', { right: [saveBtn] }), body);
  pushScreen(el);
  const imgInput = h('input', { type: 'file', accept: 'image/*', hidden: true, on: { change: addImage } });
  el.appendChild(imgInput);

  function deckSelect() {
    const sel = h('select.input', { on: { change: async e => { if (e.target.value === '__new') { const n = await promptBox('New deck name', '', { ok: 'Create' }); if (n) { deck = (await ensureDeck(n)).id; } render(); } else deck = +e.target.value; } } },
      [...S.decks.values()].sort((a, b) => a.name.localeCompare(b.name)).map(d => h('option', { value: d.id, selected: d.id === deck }, d.name.replace(/::/g, ' › '))),
      h('option', { value: '__new' }, '+ New deck…'));
    return sel;
  }
  function ntSelect() {
    return h('select.input', { on: { change: e => { const vals = fieldEls.map(f => f.innerHTML); nt = S.notetypes.get(+e.target.value); render(vals); } } },
      [...S.notetypes.values()].map(n => h('option', { value: n.id, selected: n.id === nt.id }, n.name)));
  }

  async function render(prevVals) {
    const vals = prevVals || (note ? note.fields : nt.fields.map(() => ''));
    const tagsVal = note ? (note.tags || []).join(' ') : (S.kv.lastTags || '');
    fieldEls = nt.fields.map((f, i) => {
      const d = h('div.field', { contentEditable: 'true', 'data-ph': f, on: { focus: () => { focused = d; }, input: updateInfo, paste: onPaste } });
      d.innerHTML = deferImgs(vals[i] ?? '');
      return d;
    });
    await Promise.all(fieldEls.map(showImages));
    const tb = h('div.toolbar',
      h('button', { on: { mousedown: e => e.preventDefault(), click: () => fmt('bold') }, html: '<b>B</b>' }),
      h('button', { on: { mousedown: e => e.preventDefault(), click: () => fmt('italic') }, html: '<i>I</i>' }),
      h('button', { on: { mousedown: e => e.preventDefault(), click: () => fmt('underline') }, html: '<u>U</u>' }),
      nt.kind === 'cloze' ? h('button', { on: { mousedown: e => e.preventDefault(), click: cloze } }, '[…] Cloze') : null,
      h('button', { 'aria-label': 'Add image', on: { mousedown: e => e.preventDefault(), click: () => imgInput.click() } }, icon('image', 18)),
      h('button', { on: { mousedown: e => e.preventDefault(), click: () => fmt('removeFormat') } }, 'Clear'));
    const tags = h('input.input#tags', { value: tagsVal, placeholder: 'Tags (separated by spaces)', autocapitalize: 'off', autocorrect: 'off' });
    body.replaceChildren(
      h('div.select-row', isNew ? h('div', h('div.field-label', 'Type'), ntSelect()) : null, h('div', h('div.field-label', isNew ? 'Deck' : 'Deck (moves all cards)'), deckSelect())),
      h('div', { style: { height: '10px' } }), tb,
      nt.fields.map((f, i) => [h('div.field-label', f), fieldEls[i]]),
      h('div.field-label', 'Tags'), tags,
      h('div.cards-info#cardsInfo'),
      !isNew ? h('button.btn.danger.wide', { style: { marginTop: '18px' }, on: { click: remove } }, icon('trash', 18), 'Delete note') : null,
    );
    updateInfo();
    if (isNew) setTimeout(() => fieldEls[0]?.focus(), 300);
  }

  // images: stored by name, shown via blob URLs while editing
  async function showImages(d) {
    for (const img of d.querySelectorAll('img[src], img[data-msrc]')) {
      const name = img.dataset.name || decodeSafe(img.getAttribute('data-msrc') || img.getAttribute('src'));
      img.removeAttribute('data-msrc');
      if (/^(blob:|data:|https?:)/.test(name)) continue;
      const u = await mediaUrl(name); img.dataset.name = name; if (u) img.src = u;
    }
  }
  const decodeSafe = s => { try { return decodeURIComponent(s); } catch { return s; } };
  function fieldHtml(d) {
    const c = document.createElement('template'); c.innerHTML = d.innerHTML; // inert: doesn't load images
    c.content.querySelectorAll('img[data-name]').forEach(img => { img.setAttribute('src', img.dataset.name); img.removeAttribute('data-name'); });
    return c.innerHTML.replace(/ data-msrc="[^"]*"/g, '').replace(/^(<br\s*\/?>|\s)+|(<br\s*\/?>|\s)+$/g, '');
  }
  function current() { return fieldEls.map(fieldHtml); }

  function updateInfo() {
    const info = el.querySelector('#cardsInfo'); if (!info) return;
    const tmp = { fields: current(), ntId: nt.id, tags: [] };
    if (nt.kind === 'cloze') {
      const nums = new Set(); for (const v of tmp.fields) for (const n of clozeNumbers(v)) nums.add(n);
      info.textContent = nums.size ? `Creates ${nums.size} card${nums.size > 1 ? 's' : ''} (one per cloze).` : 'Select text and tap […] Cloze to hide it.';
    } else {
      const ords = stripHtml(tmp.fields.join('')) || tmp.fields.join('').includes('<img') ? ordsToGenerate(tmp, nt) : [];
      info.textContent = ords.length ? `Creates ${ords.length} card${ords.length > 1 ? 's' : ''}: ${ords.map(o => nt.templates[o].name).join(', ')}` : '';
    }
  }

  function fmt(cmd) { document.execCommand(cmd, false, null); focused?.focus(); }
  function cloze() {
    const f = focused || fieldEls[0];
    let max = 0; for (const v of current()) for (const n of clozeNumbers(v)) max = Math.max(max, n);
    f.focus();
    const sel = window.getSelection();
    const text = sel && sel.rangeCount ? sel.toString() : '';
    document.execCommand('insertText', false, `{{c${max + 1}::${text || '…'}}}`);
    updateInfo();
  }
  function onPaste(e) {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  }
  async function addImage() {
    const file = imgInput.files[0]; imgInput.value = ''; if (!file) return;
    const blob = await shrinkImage(file);
    const name = `img-${Date.now()}.${blob.type === 'image/png' ? 'png' : 'jpg'}`;
    await putMedia(name, blob);
    const target = focused || fieldEls[fieldEls.length > 1 ? 1 : 0];
    target.focus();
    const u = await mediaUrl(name);
    document.execCommand('insertHTML', false, `<img src="${u}" data-name="${esc(name)}">`);
    if (!target.querySelector(`img[data-name="${CSS.escape(name)}"]`)) target.insertAdjacentHTML('beforeend', `<img src="${u}" data-name="${esc(name)}">`);
    updateInfo();
  }

  async function save() {
    const fields = current();
    const tags = (el.querySelector('#tags').value || '').trim().split(/\s+/).filter(Boolean);
    if (!stripHtml(fields[0]) && !fields[0].includes('<img')) { toast(`The ${nt.fields[0]} field is empty`); fieldEls[0].focus(); return; }
    if (nt.kind === 'cloze' && !fields.some(f => clozeNumbers(f).size)) { toast('Add at least one cloze: select text and tap […] Cloze'); return; }
    if (isNew) {
      const { cards } = await createNote(nt.id, deck, fields, tags);
      setKV('lastNt', nt.id); setKV('lastDeck', deck); setKV('lastTags', tags.join(' '));
      toast(`Added ${cards.length} card${cards.length > 1 ? 's' : ''} to ${deckName(deck).split('::').pop()}`);
      onSave && onSave();
      fieldEls.forEach(f => { f.innerHTML = ''; }); fieldEls[0].focus(); updateInfo();
    } else {
      const r = await updateNote(note, fields, tags, deck);
      if (r.removed) toast(`Saved. ${r.removed} empty card${r.removed > 1 ? 's' : ''} removed`);
      else if (r.added) toast(`Saved. ${r.added} new card${r.added > 1 ? 's' : ''}`);
      else toast('Saved');
      onSave && onSave(); popScreen(el);
    }
  }
  async function remove() {
    const n = (S.cardsByNote.get(note.id) || []).length;
    if (!(await confirmBox(`Delete this note and its ${n} card${n > 1 ? 's' : ''}? Review history for it is lost.`, { ok: 'Delete', danger: true }))) return;
    await deleteNotes([note.id]); toast('Note deleted'); onSave && onSave(); popScreen(el);
  }
  render();
}

async function shrinkImage(file, max = 1400) {
  try {
    const bmp = await createImageBitmap(file);
    if (bmp.width <= max && bmp.height <= max && file.size < 700e3) return file;
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
  } catch { return file; }
}
