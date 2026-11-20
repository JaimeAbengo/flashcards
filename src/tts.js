// Text-to-speech using the phone's built-in voices.
import { S } from './store.js';
import { toast } from './util.js';

let voices = [];
const loadVoices = () => { try { voices = speechSynthesis.getVoices(); } catch { voices = []; } };
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.addEventListener?.('voiceschanged', loadVoices); }

export const ttsAvailable = () => 'speechSynthesis' in window;

export function languages() {
  loadVoices();
  const names = new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' });
  const seen = new Map();
  for (const v of voices) {
    const code = v.lang.replace('_', '-');
    if (!seen.has(code)) { let label = code; try { label = names.of(code); } catch { } seen.set(code, label); }
  }
  if (!seen.size) for (const c of ['en-US', 'en-GB', 'es-ES', 'es-MX', 'fr-FR', 'de-DE', 'it-IT', 'pt-BR', 'pt-PT', 'ja-JP', 'zh-CN', 'ko-KR', 'ru-RU', 'nl-NL', 'ar-SA']) { try { seen.set(c, names.of(c)); } catch { seen.set(c, c); } }
  return [...seen].map(([code, label]) => ({ code, label })).sort((a, b) => a.label.localeCompare(b.label));
}

export function speak(text, lang) {
  if (!ttsAvailable() || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  // some browsers have online voices; in offline mode only use voices that run on the device
  const pool = S.settings.offline ? voices.filter(v => v.localService) : voices;
  if (S.settings.offline && voices.length && !pool.length) { toast('No on-device voice available in offline mode'); return; }
  const l = (lang || navigator.language || 'en').toLowerCase();
  const v = pool.find(v => v.lang.toLowerCase().replace('_', '-') === l && v.localService) || pool.find(v => v.lang.toLowerCase().replace('_', '-') === l) || pool.find(v => v.lang.toLowerCase().startsWith(l.split('-')[0]));
  if (lang) u.lang = lang;
  if (v) u.voice = v;
  else if (S.settings.offline && voices.length) { toast('No on-device voice for this language'); return; }
  u.rate = S.settings.ttsRate || 1;
  speechSynthesis.speak(u);
}
export const stopSpeaking = () => { try { speechSynthesis.cancel(); } catch { } };
