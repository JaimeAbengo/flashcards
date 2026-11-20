// Write: type every answer, retry the ones you missed.
import { h, shuffle, checkAnswer } from '../util.js';
import { itemsFor, missed, endScreen, progressBar } from './index.js';
import { hydrate, deferImgs } from '../templates.js';

export function write({ deckId, body, close, restart }, subset) {
  const items = subset || shuffle(itemsFor(deckId)).slice(0, 20);
  let i = 0, right = 0; const wrong = [];
  const pb = progressBar(); const area = h('div');
  body.replaceChildren(pb, area);
  function ask() {
    pb.set(i / items.length);
    if (i >= items.length) return end();
    const it = items[i];
    const prompt = h('div.prompt-card', h('div.label', `${i + 1} of ${items.length}`), h('div', { html: deferImgs(it.qHtml) }));
    hydrate(prompt);
    const input = h('input.answer-input', { placeholder: 'Type the answer', autocapitalize: 'off', autocorrect: 'off', spellcheck: false, on: { keydown: e => { if (e.key === 'Enter') { e.preventDefault(); input.disabled ? next() : check(); } } } });
    const btn = h('button.btn.primary.wide', { style: { marginTop: '12px' }, on: { click: () => (input.disabled ? next() : check()) } }, 'Check');
    const fb = h('div');
    area.replaceChildren(prompt, input, fb, btn);
    setTimeout(() => input.focus(), 200);
    function check() {
      input.disabled = true;
      const r = checkAnswer(input.value, it.a);
      if (r === 'correct' || r === 'accent') { right++; fb.replaceChildren(h('div.feedback.good', r === 'accent' ? 'Correct, but watch the accents!' : 'Correct!', r === 'accent' ? h('span.correct', it.a) : null)); btn.textContent = 'Next'; if (r === 'correct') setTimeout(() => { if (area.contains(btn)) next(); }, 700); return; }
      const override = h('button.link', { style: { marginTop: '8px', display: 'block' }, on: { click: () => { wrong.pop(); right++; fb.replaceChildren(h('div.feedback.good', 'Counted as correct')); } } }, 'I was right, count it');
      wrong.push(it); missed(it.id);
      fb.replaceChildren(h('div.feedback' + (r === 'close' ? '.close' : '.bad'), r === 'close' ? 'Almost!' : input.value ? 'Incorrect' : 'Skipped', h('span.correct', 'Correct answer: ' + it.a)), input.value ? override : null);
      btn.textContent = 'Next';
    }
    function next() { i++; ask(); }
  }
  function end() {
    pb.set(1);
    body.replaceChildren(endScreen({
      emoji: wrong.length ? '📝' : '🎯', title: `${right} / ${items.length} correct`,
      text: wrong.length ? `${wrong.length} to practise again.` : 'Perfect round!',
      actions: [wrong.length && { label: `Retry ${wrong.length} missed`, primary: true, click: () => write({ deckId, body, close, restart }, shuffle(wrong)) },
        { label: 'New round', primary: !wrong.length, click: restart }, { label: 'Back to deck', click: close }],
    }));
  }
  ask();
}
