// Renders card HTML in an isolated shadow root so deck styles can't break the app.
import { cssWithMedia, hydrate, soundify, playSound, soundsIn, deferImgs } from './templates.js';
import { speak } from './tts.js';
import { S } from './store.js';
import { toast } from './util.js';

export const isDark = () => document.body.classList.contains('theme-dark') || (document.body.classList.contains('theme-auto') && document.body.classList.contains('sys-dark'));

const BASE = `
:host { display: block; }
.card { min-height: 100%; box-sizing: border-box; padding: 22px 18px 28px; overflow-wrap: anywhere; font-size: 20px; line-height: 1.45; }
img { max-width: 100%; height: auto; }
hr#answer, hr { border: 0; border-top: 1px solid rgba(128,128,128,.35); margin: 18px 0; }
.snd-btn, .tts-btn { font: inherit; font-size: 15px; border: 0; border-radius: 999px; width: 40px; height: 40px; margin: 4px; cursor: pointer;
  background: rgba(88,101,242,.14); color: #5865f2; vertical-align: middle; }
.cloze { font-weight: bold; color: blue; }
details.hint { display: inline-block; margin: 6px 0; } details.hint summary { color: #5865f2; cursor: pointer; font-size: 15px; }
.typeans-input { font: inherit; font-size: 18px; width: 100%; max-width: 420px; box-sizing: border-box; padding: 11px 13px; margin-top: 14px; border-radius: 12px; border: 2px solid rgba(128,128,128,.4); outline: none; background: transparent; color: inherit; }
.typeans-input:focus { border-color: #5865f2; }
.typeans-result { font-family: ui-monospace, Menlo, monospace; font-size: 18px; margin: 12px 0; }
.ta-good { background: #c9f2d6; color: #0b5d2a; } .ta-bad { background: #ffd0c9; color: #8e1d0d; text-decoration: line-through; } .ta-miss { background: #e3e3e8; color: #555; }
.ta-exp { color: inherit; } .ta-arrow { opacity: .5; }
.missing-media { display: none; }
.remote-img { font-size: 13px; opacity: .6; }
.unknown-field { color: #e5533d; font-size: 14px; }
`;
const DARK = `
.card { color: #ececf1 !important; background-color: #1c1c22 !important; }
.cloze { color: #8fb4ff; }
.ta-good { background: #174d2c; color: #b6f0c9; } .ta-bad { background: #5a1d14; color: #ffc5bb; } .ta-miss { background: #33333d; color: #ccc; }
`;

export async function mountCard(host, html, css, { onEnter, ttsLang } = {}) {
  const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
  const dark = isDark();
  const clean = deferImgs(String(html).replace(/<script[\s\S]*?<\/script>/gi, ''));
  root.innerHTML = `<style>${BASE}${await cssWithMedia(css || '')}${dark ? DARK : ''}</style><div class="card${dark ? ' nightMode night_mode' : ''}">${soundify(clean)}</div>`;
  await hydrate(root);
  root.querySelectorAll('.snd-btn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); playSound(b.dataset.snd); }));
  root.querySelectorAll('a[href]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    if (S.settings.offline) return toast('Offline mode is on: links are blocked');
    if (/^https?:/i.test(a.href)) window.open(a.href, '_blank', 'noopener');
  }));
  root.querySelectorAll('.tts-btn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); speak(b.dataset.text, b.dataset.lang || ttsLang); }));
  let input = null;
  const slot = root.querySelector('.typeans-slot');
  if (slot) {
    input = document.createElement('input');
    Object.assign(input, { className: 'typeans-input', placeholder: 'Type the answer', autocomplete: 'off', spellcheck: false });
    input.setAttribute('autocapitalize', 'off'); input.setAttribute('autocorrect', 'off');
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); onEnter && onEnter(); } });
    slot.replaceWith(input);
  }
  return { root, input, sounds: soundsIn(soundify(clean)) };
}
export function autoplay(sounds) { if (sounds[0]) playSound(sounds[0]); }
