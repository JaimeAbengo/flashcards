// Text-to-speech using the phone's built-in voices.
import { S } from './store.js';

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
  if (lang) {
    u.lang = lang;
    const l = lang.toLowerCase();
    const v = voices.find(v => v.lang.toLowerCase().replace('_', '-') === l && v.localService) || voices.find(v => v.lang.toLowerCase().replace('_', '-') === l) || voices.find(v => v.lang.toLowerCase().startsWith(l.split('-')[0]));
    if (v) u.voice = v;
  }
  u.rate = S.settings.ttsRate || 1;
  speechSynthesis.speak(u);
}
export const stopSpeaking = () => { try { speechSynthesis.cancel(); } catch { } };
