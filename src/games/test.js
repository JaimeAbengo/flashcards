// Test: a generated quiz mixing multiple choice, true/false and written questions.
import { h, shuffle, checkAnswer } from '../util.js';
import { itemsFor, distractors, missed, endScreen } from './index.js';
import { hydrate, deferImgs } from '../templates.js';
import { S, setKV } from '../store.js';

export function test({ deckId, body, close, restart }) {
  const pool = itemsFor(deckId);
  const cfg = { n: 10, mc: true, tf: true, wr: true, ...(S.kv.testCfg || {}) };
  const seg = (vals, key) => { const s = h('div.seg', vals.map(([v, l]) => h('button' + (cfg[key] === v ? '.on' : ''), { on: { click: () => { cfg[key] = v; [...s.children].forEach((b, k) => b.classList.toggle('on', vals[k][0] === v)); } } }, l))); return s; };
  const tog = key => h('input.toggle', { type: 'checkbox', checked: cfg[key], on: { change: e => { cfg[key] = e.target.checked; } } });
  body.replaceChildren(h('div.setup',
    h('div.prompt-card', h('div', { style: { fontSize: '40px' } }, '📋'), h('div', 'Set up your test'), h('div.muted.small', `${pool.length} cards available`)),
    h('h2.section', 'Questions'),
    h('div.group', h('div.row', seg([[5, '5'], [10, '10'], [20, '20'], [0, 'All']], 'n'))),
    h('h2.section', 'Question types'),
    h('div.group', h('div.row', h('label', 'Multiple choice'), tog('mc')), h('div.row', h('label', 'True / false'), tog('tf')), h('div.row', h('label', 'Written'), tog('wr'))),
    h('button.btn.primary.big.wide', { style: { marginTop: '18px' }, on: { click: start } }, 'Start test')));

  function start() {
    if (!cfg.mc && !cfg.tf && !cfg.wr) cfg.mc = true;
    setKV('testCfg', cfg);
    const chosen = shuffle(pool).slice(0, cfg.n || pool.length);
    const types = [cfg.mc && 'mc', cfg.tf && 'tf', cfg.wr && 'wr'].filter(Boolean);
    const qs = chosen.map((it, k) => {
      const type = types[k % types.length];
      if (type === 'mc') return { it, type, opts: shuffle([it.a, ...distractors(it, pool, 3)]) };
      if (type === 'tf') { const truth = Math.random() < 0.5; const shown = truth ? it.a : (distractors(it, pool, 1)[0] ?? it.a); return { it, type, shown, truth: shown === it.a }; }
      return { it, type };
    });
    const list = h('div');
    qs.forEach((q, k) => {
      const box = h('div.tq', h('div.num', `${k + 1} / ${qs.length} · ${{ mc: 'Multiple choice', tf: 'True or false', wr: 'Written' }[q.type]}`));
      const qt = h('div.qtext', { html: deferImgs(q.it.qHtml) }); hydrate(qt); box.appendChild(qt);
      if (q.type === 'mc') {
        const opts = h('div.options', { style: { marginTop: 0 } }, q.opts.map(o => h('button.option', { on: { click: e => { q.ans = o; [...opts.children].forEach(b => b.classList.toggle('chosen', b === e.currentTarget)); } } }, o)));
        box.appendChild(opts); q.el = opts;
      } else if (q.type === 'tf') {
        box.appendChild(h('div.muted', { style: { margin: '-4px 0 10px' } }, '→ ', h('b', { style: { color: 'var(--text)' } }, q.shown)));
        const tf = h('div.tf', ['True', 'False'].map(v => h('button.option', { on: { click: e => { q.ans = v === 'True'; [...tf.children].forEach(b => b.classList.toggle('chosen', b === e.currentTarget)); } } }, v)));
        box.appendChild(tf); q.el = tf;
      } else {
        const inp = h('input.answer-input', { placeholder: 'Your answer', autocapitalize: 'off', autocorrect: 'off', spellcheck: false, on: { input: e => { q.ans = e.target.value; } } });
        box.appendChild(inp); q.el = inp;
      }
      q.box = box; list.appendChild(box);
    });
    body.replaceChildren(list, h('button.btn.primary.big.wide', { on: { click: () => grade(qs) } }, 'Submit test'));
    body.scrollTop = 0;
  }

  function grade(qs) {
    let score = 0; const wrongIds = [];
    for (const q of qs) {
      let ok;
      if (q.type === 'mc') ok = q.ans === q.it.a;
      else if (q.type === 'tf') ok = q.ans === q.truth;
      else { const r = checkAnswer(q.ans || '', q.it.a); ok = r === 'correct' || r === 'accent'; }
      q.ok = ok; if (ok) score++; else wrongIds.push(q.it.id);
      q.box.classList.add('graded', ok ? 'ok' : 'no');
      q.box.querySelectorAll('button, input').forEach(b => { b.disabled = true; });
      if (q.type === 'mc') [...q.el.children].forEach(b => { if (b.textContent === q.it.a) b.classList.add('right'); else if (b.classList.contains('chosen')) b.classList.add('wrong'); });
      if (!ok) q.box.appendChild(h('div.feedback.bad', { style: { marginTop: '10px' } }, q.type === 'tf' ? `False → the answer is “${q.it.a}”` : 'Correct answer:', q.type === 'tf' && q.truth ? null : h('span.correct', q.it.a)));
    }
    if (wrongIds.length) missed(wrongIds);
    const pct = Math.round(score / qs.length * 100);
    body.prepend(h('div', endScreen({
      emoji: pct >= 90 ? '🏆' : pct >= 70 ? '👏' : '📚', title: `${pct}%`,
      text: `${score} of ${qs.length} correct${wrongIds.length ? '. Missed cards were added to today\'s reviews.' : ''}`,
      actions: [{ label: 'New test', primary: true, click: restart }, { label: 'Back to deck', click: close }],
    }), h('h2.section', 'Your answers')));
    body.scrollTop = 0;
    body.lastElementChild.remove(); // submit button
  }
}
