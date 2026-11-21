// App shell: tabs, theme, refresh, service worker.
import { load, S } from '../store.js';
import { h, icon, $, $$, toast } from '../util.js';
import { renderDecks } from './decks.js';
import { renderBrowse } from './browse.js';
import { renderStats } from './stats.js';
import { renderSettings } from './settings.js';

export const VERSION = '__VERSION__';
const TABS = [
  { id: 'decks', label: 'Decks', icon: 'decks', render: renderDecks },
  { id: 'browse', label: 'Browse', icon: 'browse', render: renderBrowse },
  { id: 'stats', label: 'Stats', icon: 'stats', render: renderStats },
  { id: 'settings', label: 'Settings', icon: 'settings', render: renderSettings },
];
let current = 'decks';

export function showTab(id) {
  current = id;
  for (const t of TABS) {
    $('#tab-' + t.id).classList.toggle('active', t.id === id);
    $(`#tabbar [data-tab="${t.id}"]`).classList.toggle('active', t.id === id);
  }
  TABS.find(t => t.id === id).render();
}
export function refreshAll() {
  TABS.find(t => t.id === current).render();
  for (const s of $$('.screen')) if (typeof s.refresh === 'function') s.refresh();
}

const mq = window.matchMedia('(prefers-color-scheme: dark)');
export function applyTheme() {
  const b = document.body;
  b.classList.remove('theme-auto', 'theme-light', 'theme-dark');
  b.classList.add('theme-' + (S.settings?.theme || 'auto'));
  b.classList.toggle('sys-dark', mq.matches);
  const dark = b.classList.contains('theme-dark') || (b.classList.contains('theme-auto') && mq.matches);
  document.querySelector('meta[name=theme-color]').content = dark ? '#121216' : '#f4f4f7';
}
mq.addEventListener?.('change', applyTheme);

// tell the service worker (via Cache Storage, which it can read even after restarting)
export async function syncOfflineFlag() {
  try {
    const c = await caches.open('flags');
    if (S.settings.offline) await c.put('offline', new Response('1')); else await c.delete('offline');
  } catch { }
}
// are all app files saved on the phone? (needed before going fully offline)
export async function appCached() {
  try {
    const keys = await caches.keys(); const shell = keys.find(k => k.startsWith('shell-'));
    if (!shell) return false;
    const c = await caches.open(shell);
    for (const f of ['index.html', 'app.js', 'style.css', 'vendor/sql-wasm.wasm']) if (!(await c.match(f))) return false;
    return true;
  } catch { return false; }
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    const prompt = w => { $('#updateBar').hidden = false; $('#updateBtn').onclick = () => w.postMessage('skipWaiting'); };
    if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w); }); });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
    setInterval(() => { if (!S.settings.offline) reg.update().catch(() => { }); }, 3600e3);
  } catch { }
}

// iOS bug workaround: after the on-screen keyboard closes, the page can stay scrolled/shifted by a few dozen pixels,
// and taps then land above or below what's drawn. Snap it back whenever the keyboard goes away.
function resetViewport() {
  if (window.scrollY || window.scrollX || document.documentElement.scrollTop || document.body.scrollTop) {
    window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0;
  }
}
document.addEventListener('focusout', () => { setTimeout(resetViewport, 60); setTimeout(resetViewport, 350); });
window.visualViewport?.addEventListener('resize', () => { if (window.visualViewport.height >= window.innerHeight - 2) resetViewport(); });
window.addEventListener('scroll', () => { if (!document.activeElement || !/INPUT|TEXTAREA/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) resetViewport(); }, { passive: true });

export async function boot() {
  window.addEventListener('error', e => { console.error(e.error || e.message); });
  window.addEventListener('unhandledrejection', e => { console.error(e.reason); toast('Something went wrong: ' + (e.reason?.message || e.reason)); });
  await load();
  applyTheme();
  syncOfflineFlag();
  $('#tabbar').replaceChildren(...TABS.map(t => h('button', { 'data-tab': t.id, on: { click: () => showTab(t.id) } }, icon(t.icon), t.label)));
  showTab('decks');
  // refresh counts when coming back to the app (e.g. the next morning)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { resetViewport(); refreshAll(); } });
  registerSW();
}
