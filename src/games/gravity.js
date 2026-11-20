// Gravity: type the answer before the asteroid lands.
import { h, shuffle, checkAnswer } from '../util.js';
import { S, setKV } from '../store.js';
import { itemsFor, missed } from './index.js';

export function gravity({ deckId, body, el, close, restart }) {
  const items = itemsFor(deckId, { short: true });
  let queue = shuffle(items), score = 0, lives = 3, level = 1, cleared = 0, rock = null, y = 0, last = 0, raf, paused = true, current;
  const hud = h('div.g-hud'); const field = h('div.g-field', h('div.g-ground'));
  const input = h('input', { placeholder: 'Type the answer + return', autocapitalize: 'off', autocorrect: 'off', spellcheck: false, enterkeyhint: 'done', on: { keydown: e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } } } });
  body.style.padding = '0'; body.style.overflow = 'hidden';
  body.replaceChildren(hud, field, h('div.g-input', input));
  const high = () => (S.kv.gravityBest || {})[deckId] || 0;
  const drawHud = () => hud.replaceChildren(h('span', `Score ${score}`), h('span', `Level ${level}`), h('span.lives', '❤️'.repeat(lives) + '🖤'.repeat(3 - lives)));
  const fallMs = () => Math.max(4500, 14000 - (level - 1) * 1300);

  function overlay(...kids) { const o = h('div.g-overlay', ...kids); field.appendChild(o); return o; }
  function intro() {
    drawHud();
    const o = overlay(h('div', { style: { fontSize: '50px' } }, '☄️'), h('h2', 'Gravity'), h('p', { style: { opacity: .8, maxWidth: '300px' } }, 'Prompts fall from the sky. Type the answer before they hit the ground. Miss and you lose a life.'),
      high() ? h('p', { style: { opacity: .7 } }, `High score: ${high()}`) : null,
      h('button.btn.primary.big', { on: { click: () => { o.remove(); paused = false; spawn(); input.focus(); } } }, 'Start'));
  }
  function spawn() {
    if (!queue.length) queue = shuffle(items);
    current = queue.shift();
    rock = h('div.asteroid', current.q); y = -10; field.appendChild(rock);
    last = performance.now(); raf = requestAnimationFrame(step);
  }
  function step(t) {
    if (paused) return;
    const dt = t - last; last = t;
    const H = field.clientHeight - rock.offsetHeight - 6;
    y += dt / fallMs() * (H + 10);
    rock.style.top = y + 'px';
    if (y >= H) return crash();
    raf = requestAnimationFrame(step);
  }
  function submit() {
    if (paused || !current) return;
    const r = checkAnswer(input.value, current.a);
    if (r === 'correct' || r === 'accent' || r === 'close') {
      input.value = ''; cancelAnimationFrame(raf);
      score += 10 * level + Math.round((1 - y / field.clientHeight) * 10);
      cleared++; if (cleared % 5 === 0) level++;
      const r0 = rock; r0.classList.add('boom'); setTimeout(() => r0.remove(), 350);
      drawHud(); spawn();
    } else { input.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 250 }); input.select(); }
  }
  function crash() {
    paused = true; lives--; drawHud(); missed(current.id);
    rock.remove();
    const it = current;
    if (lives <= 0) return gameOver(it);
    // must type the right answer to continue (like Quizlet)
    const inp2 = h('input', { placeholder: 'Type it to continue', autocapitalize: 'off', autocorrect: 'off', style: { width: '100%', maxWidth: '320px', fontSize: '18px', padding: '12px', borderRadius: '12px', border: '2px solid #7581ff', background: '#15172b', color: '#fff' } });
    const o = overlay(h('h2', '💥 Missed!'), h('div', { style: { opacity: .8 } }, it.q), h('div.correct', it.a), inp2);
    input.blur(); setTimeout(() => inp2.focus(), 100);
    inp2.addEventListener('keydown', e => { if (e.key === 'Enter') { const r = checkAnswer(inp2.value, it.a); if (r !== 'wrong') { o.remove(); paused = false; input.value = ''; input.focus(); spawn(); } else inp2.select(); } });
  }
  function gameOver(it) {
    const best = high(); const rec = score > best;
    if (rec) setKV('gravityBest', { ...(S.kv.gravityBest || {}), [deckId]: score });
    overlay(h('div', { style: { fontSize: '50px' } }, rec ? '🏆' : '🌍'), h('h2', 'Game over'), h('p', `Last one: ${it.q} → `, h('b', it.a)),
      h('div', { style: { fontSize: '22px', fontWeight: 800 } }, `Score ${score}`), h('p', { style: { opacity: .75 } }, rec ? 'New high score!' : `High score: ${best}`),
      h('button.btn.primary.big', { on: { click: restart } }, 'Play again'), h('button.btn.big', { style: { background: 'rgba(255,255,255,.12)', color: '#fff' }, on: { click: close } }, 'Back to deck'));
    input.blur();
  }
  // keep the game above the keyboard on iPhone
  const vv = window.visualViewport;
  const fit = () => { if (vv) el.style.height = vv.height + 'px'; el.style.top = (vv ? vv.offsetTop : 0) + 'px'; };
  vv?.addEventListener('resize', fit); vv?.addEventListener('scroll', fit); fit();
  intro();
  return () => { paused = true; cancelAnimationFrame(raf); vv?.removeEventListener('resize', fit); vv?.removeEventListener('scroll', fit); };
}
