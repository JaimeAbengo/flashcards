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

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    const prompt = w => { $('#updateBar').hidden = false; $('#updateBtn').onclick = () => w.postMessage('skipWaiting'); };
    if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w); }); });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
    setInterval(() => reg.update().catch(() => { }), 3600e3);
  } catch { }
}

export async function boot() {
  window.addEventListener('error', e => { console.error(e.error || e.message); });
  window.addEventListener('unhandledrejection', e => { console.error(e.reason); toast('Something went wrong: ' + (e.reason?.message || e.reason)); });
  await load();
  applyTheme();
  $('#tabbar').replaceChildren(...TABS.map(t => h('button', { 'data-tab': t.id, on: { click: () => showTab(t.id) } }, icon(t.icon), t.label)));
  showTab('decks');
  // refresh counts when coming back to the app (e.g. the next morning)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshAll(); });
  registerSW();
}
