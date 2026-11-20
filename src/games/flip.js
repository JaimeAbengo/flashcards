// Flashcards: tap to flip, swipe right = know it, left = still learning.
import { h, shuffle, icon } from '../util.js';
import { itemsFor, missed, endScreen, swapped } from './index.js';
import { hydrate, deferImgs } from '../templates.js';
import { speak } from '../tts.js';

export function flip({ deckId, body, close, restart, conf }, subset) {
  let items = subset || shuffle(itemsFor(deckId));
  let i = 0; const know = [], learning = [];
  const countL = h('span.l'), countK = h('span.k'), pos = h('span');
  const wrap = h('div.flip-wrap');
  body.replaceChildren(h('div.flip-count', h('span', 'Still learning ', countL), pos, h('span', 'Know ', countK)), wrap,
    h('div.flip-buttons',
      h('button.btn.big', { style: { color: 'var(--hard)' }, on: { click: () => decide(false) } }, '✗ Still learning'),
      h('button.btn.big', { style: { color: 'var(--good)' }, on: { click: () => decide(true) } }, '✓ Know it')));
  const qLang = swapped() ? conf.ttsBack : conf.ttsFront, aLang = swapped() ? conf.ttsFront : conf.ttsBack;
  let card, busy = false;

  function show() {
    countL.textContent = learning.length; countK.textContent = know.length; pos.textContent = `${Math.min(i + 1, items.length)} / ${items.length}`;
    if (i >= items.length) return end();
    const it = items[i];
    const tts = (text, lang) => lang ? h('button.icon-btn.face-tts', { on: { click: e => { e.stopPropagation(); speak(text, lang); } } }, icon('speaker', 20)) : null;
    const front = h('div.face', { html: deferImgs(it.qHtml) }); front.appendChild(tts(it.q, qLang) || document.createTextNode(''));
    const back = h('div.face.back', { html: deferImgs(it.aHtml) }); back.appendChild(tts(it.a, aLang) || document.createTextNode(''));
    hydrate(front); hydrate(back);
    card = h('div.flip-card', h('div.swipe-hint.know', 'KNOW'), h('div.swipe-hint.learning', 'LEARNING'), front, back);
    wrap.replaceChildren(card);
    drag(card);
  }
  function drag(el) {
    let x0 = null, dx = 0, moved = false;
    el.addEventListener('pointerdown', e => { x0 = e.clientX; dx = 0; moved = false; el.setPointerCapture(e.pointerId); el.style.transition = 'none'; });
    el.addEventListener('pointermove', e => {
      if (x0 == null) return; dx = e.clientX - x0; if (Math.abs(dx) > 8) moved = true;
      const fl = el.classList.contains('flipped') ? ' rotateY(180deg)' : '';
      el.style.transform = `translateX(${dx}px) rotate(${dx / 20}deg)${fl}`;
      el.querySelector('.know').style.opacity = Math.max(0, dx / 100); el.querySelector('.learning').style.opacity = Math.max(0, -dx / 100);
    });
    const up = () => {
      if (x0 == null) return; x0 = null; el.style.transition = ''; el.style.transform = '';
      el.querySelector('.know').style.opacity = 0; el.querySelector('.learning').style.opacity = 0;
      if (Math.abs(dx) > 90) decide(dx > 0); else if (!moved) el.classList.toggle('flipped');
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
  function decide(k) {
    if (busy || i >= items.length) return; busy = true;
    const it = items[i];
    (k ? know : learning).push(it); if (!k) missed(it.id);
    card.classList.add(k ? 'fly-right' : 'fly-left');
    setTimeout(() => { busy = false; i++; show(); }, 260);
  }
  function end() {
    body.replaceChildren(endScreen({
      emoji: learning.length ? '💪' : '🎉', title: learning.length ? 'Round done!' : 'You know them all!',
      text: `Know: ${know.length} · Still learning: ${learning.length}`,
      actions: [
        learning.length && { label: `Keep reviewing ${learning.length}`, primary: true, click: () => flip({ deckId, body, close, restart, conf }, shuffle(learning)) },
        { label: 'Restart all cards', primary: !learning.length, click: restart },
        { label: 'Back to deck', click: close },
      ],
    }));
  }
  show();
}
