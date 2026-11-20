// Learn: each card first as multiple choice, then typed. Rounds of 7, until everything is mastered.
import { h, shuffle, checkAnswer } from '../util.js';
import { itemsFor, distractors, missed, endScreen, progressBar } from './index.js';
import { hydrate, deferImgs } from '../templates.js';

export function learn({ deckId, body, close, restart }) {
  const all = shuffle(itemsFor(deckId)).slice(0, 40);
  const pool = itemsFor(deckId);
  const level = new Map(all.map(it => [it.id, 0])); // 0 = MC next, 1 = typed next, 2 = mastered
  const pb = progressBar(); const area = h('div');
  body.replaceChildren(pb, area);
  let round = [], idx = 0, roundNo = 0, roundCorrect = 0;

  const remaining = () => all.filter(it => level.get(it.id) < 2);
  const progress = () => pb.set([...level.values()].reduce((a, v) => a + v, 0) / (all.length * 2));

  function newRound() {
    const rem = remaining();
    if (!rem.length) return finish();
    round = rem.slice(0, 7); idx = 0; roundNo++; roundCorrect = 0;
    ask();
  }
  function ask() {
    progress();
    if (idx >= round.length) return roundEnd();
    const it = round[idx];
    const prompt = h('div.prompt-card', h('div.label', level.get(it.id) === 0 ? 'Choose the answer' : 'Type the answer'), h('div', { html: deferImgs(it.qHtml) }));
    hydrate(prompt);
    if (level.get(it.id) === 0) {
      const opts = shuffle([it.a, ...distractors(it, pool, 3)]);
      const box = h('div.options', opts.map(o => h('button.option', { on: { click: e => pick(e.currentTarget, o) } }, o)));
      area.replaceChildren(prompt, box);
      function pick(btn, o) {
        if (box.dataset.done) return; box.dataset.done = 1;
        const ok = o === it.a;
        [...box.children].forEach(b => { if (b.textContent === it.a) b.classList.add('right'); });
        if (!ok) btn.classList.add('wrong');
        result(ok, it);
      }
    } else {
      const input = h('input.answer-input', { placeholder: 'Type the answer', autocapitalize: 'off', autocorrect: 'off', spellcheck: false, on: { keydown: e => { if (e.key === 'Enter') submit(); } } });
      const dk = h('button.link', { style: { marginTop: '10px' }, on: { click: () => { input.value = ''; submit(true); } } }, "Don't know");
      area.replaceChildren(prompt, input, h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, dk, h('button.btn.primary', { style: { marginTop: '10px' }, on: { click: () => submit() } }, 'Check')));
      setTimeout(() => input.focus(), 200);
      function submit(gaveUp) {
        if (input.disabled) return; input.disabled = true;
        const r = gaveUp ? 'wrong' : checkAnswer(input.value, it.a);
        if (r === 'close') return closeCall(input.value);
        result(r === 'correct' || r === 'accent', it, r === 'accent' ? 'Watch the accents!' : null);
      }
      function closeCall(v) {
        const fb = h('div.feedback.close', `Almost! You wrote “${v}”`, h('span.correct', 'Correct answer: ' + it.a));
        area.appendChild(fb);
        area.appendChild(h('div.btn-row', { style: { marginTop: '10px' } }, h('button.btn', { on: { click: () => result(false, it, null, true) } }, 'Count as wrong'), h('button.btn.primary', { on: { click: () => result(true, it, null, true) } }, 'I was right')));
      }
    }
  }
  function result(ok, it, note, skipFeedback) {
    if (ok) { level.set(it.id, level.get(it.id) + 1); roundCorrect++; }
    else { level.set(it.id, 0); missed(it.id); }
    progress();
    const next = () => { idx++; ask(); };
    if (ok && !note) { area.appendChild(h('div.feedback.good', ['Nice!', 'Great job!', 'Correct!', 'You got it!'][Math.floor(Math.random() * 4)])); setTimeout(next, 750); return; }
    if (!skipFeedback || !ok) area.appendChild(h('div.feedback' + (ok ? '.good' : '.bad'), ok ? note : 'Not quite. Study this one!', !ok ? h('span.correct', 'Correct answer: ' + it.a) : null));
    area.appendChild(h('button.btn.primary.wide', { style: { marginTop: '12px' }, on: { click: next } }, 'Continue'));
  }
  function roundEnd() {
    const mastered = all.length - remaining().length;
    area.replaceChildren(endScreen({ emoji: '⭐', title: `Round ${roundNo} done`, text: `${roundCorrect}/${round.length} correct · ${mastered}/${all.length} mastered`, actions: [{ label: 'Next round', primary: true, click: newRound }, { label: 'Back to deck', click: close }] }));
  }
  function finish() {
    pb.set(1);
    area.replaceChildren(endScreen({ emoji: '🏆', title: 'You learned them all!', text: `${all.length} cards mastered.`, actions: [{ label: 'Learn again', primary: true, click: restart }, { label: 'Back to deck', click: close }] }));
  }
  newRound();
}
