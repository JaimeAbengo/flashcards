// Settings tab.
import { S, saveSettings, wipeAll, load } from '../store.js';
import { exportBackup, exportApkg } from '../exporter.js';
import { h, toast, confirmBox, downloadFile, plural } from '../util.js';
import { startImport } from './decks.js';
import { applyTheme, refreshAll, VERSION } from './app.js';

export async function renderSettings() {
  const t = document.getElementById('tab-settings');
  const s = S.settings;
  const sel = (key, opts, cb) => h('select', { on: { change: e => { s[key] = isNaN(+e.target.value) ? e.target.value : +e.target.value; saveSettings(); cb && cb(); } } },
    opts.map(([v, l]) => h('option', { value: v, selected: s[key] === v }, l)));
  const tog = (key, cb) => h('input.toggle', { type: 'checkbox', checked: !!s[key], on: { change: e => { s[key] = e.target.checked; saveSettings(); cb && cb(); } } });
  const num = (key) => h('input.input', { type: 'number', inputmode: 'numeric', value: s[key], min: 0, style: { width: '90px', textAlign: 'right' }, on: { change: e => { s[key] = Math.max(0, +e.target.value || 0); saveSettings(); refreshAll(); } } });
  const storage = h('span.muted');

  t.replaceChildren(
    h('div.page-head', h('h1', 'Settings')),
    h('h2.section', 'Studying'),
    h('div.group',
      h('div.row', h('div.grow', h('div', 'Target memory'), h('small', 'Chance of remembering a card when it comes back. 90% is recommended; higher means more reviews.')),
        sel('retention', [[0.8, '80%'], [0.85, '85%'], [0.9, '90% ★'], [0.93, '93%'], [0.95, '95%']])),
      h('div.row', h('div.grow', 'New cards per day'), num('newPerDay')),
      h('div.row', h('div.grow', 'Maximum reviews per day'), num('revPerDay')),
      h('div.row', h('div.grow', h('div', 'Next day starts at'), h('small', 'Late-night sessions count for the day before')),
        sel('dayStart', [[0, 'Midnight'], [2, '2 am'], [3, '3 am'], [4, '4 am'], [5, '5 am'], [6, '6 am']], refreshAll)),
      h('div.row', h('div.grow', 'Show next interval on buttons'), tog('showIntervals')),
      h('div.row', h('div.grow', 'Read aloud speed'), sel('ttsRate', [[0.7, 'Slow'], [0.85, 'Relaxed'], [1, 'Normal'], [1.2, 'Fast']]))),
    h('p.muted.small', { style: { margin: '8px 4px' } }, 'Daily limits here are defaults. Each deck can override them in its options.'),
    h('h2.section', 'Appearance'),
    h('div.group', h('div.row', h('div.grow', 'Theme'), sel('theme', [['auto', 'Match phone'], ['light', 'Light'], ['dark', 'Dark']], applyTheme))),
    h('h2.section', 'Your data'),
    h('div.group',
      h('div.row.col',
        h('div.small.muted', 'Everything is stored only on this phone. Make a backup now and then: deleting the app from your home screen deletes its data.'),
        h('div.btn-row', h('button.btn', { on: { click: backup } }, 'Back up everything'), h('button.btn', { on: { click: () => startImport() } }, 'Restore / import'))),
      h('div.row', h('div.grow', h('div', 'Export all decks to Anki'), h('small', '.apkg file with your progress')), h('button.btn.small', { on: { click: exportAll } }, 'Export')),
      h('div.row', h('div.grow', 'Storage used'), storage),
      h('div.row', h('button.btn.danger.wide', { on: { click: reset } }, 'Delete everything'))),
    h('p.credit', 'Made by ', h('b', 'Jaime Abengoechea')),
    h('p.about', 'Scheduling by FSRS (open-spaced-repetition). Imports Anki .apkg and Quizlet/text exports.', h('br'), `Version ${VERSION}`),
  );
  try { const e = await navigator.storage.estimate(); storage.textContent = `${(e.usage / 1e6).toFixed(1)} MB · ${plural(S.cards.size, 'card')}, ${plural(S.mediaNames.size, 'media file')}`; } catch { storage.textContent = plural(S.cards.size, 'card'); }
}

async function backup() {
  toast('Preparing backup…');
  const r = await exportBackup();
  await downloadFile(r.blob, r.name);
}
async function exportAll() {
  toast('Preparing file…');
  const r = await exportApkg(null, { withProgress: true });
  await downloadFile(r.blob, r.name);
}
async function reset() {
  if (!(await confirmBox('Delete all decks, cards, images and history from this phone? Make a backup first if you might want them back.', { ok: 'Delete everything', danger: true }))) return;
  if (!(await confirmBox('Are you sure? This cannot be undone.', { ok: 'Yes, delete', danger: true }))) return;
  await wipeAll(); await load(); refreshAll(); toast('Everything deleted');
}
