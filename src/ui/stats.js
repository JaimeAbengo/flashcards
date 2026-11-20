// Statistics tab.
import { S } from '../store.js';
import { State, streak, dayStartMs, nextDayMs } from '../sched.js';
import { cardTexts } from '../templates.js';
import { h, DAY, plural } from '../util.js';
import { openEditor } from './editor.js';
import { refreshAll } from './app.js';

export function renderStats() {
  const t = document.getElementById('tab-stats');
  const today = dayStartMs();
  const logs = S.revlog.filter(l => !l.imported || true);
  const todayLogs = logs.filter(l => l.id >= today);
  const mins = Math.round(todayLogs.reduce((a, l) => a + (l.ms || 0), 0) / 6e4);
  const month = logs.filter(l => l.id >= today - 30 * DAY && l.st === State.Review);
  const retention = month.length ? Math.round(month.filter(l => l.r > 1).length / month.length * 100) : null;

  const st = { nw: 0, learn: 0, young: 0, mature: 0, susp: 0 };
  for (const c of S.cards.values()) {
    if (c.susp) st.susp++; else if (c.s.state === State.New) st.nw++;
    else if (c.s.state === State.Review) (c.s.scheduled_days >= 21 ? st.mature++ : st.young++); else st.learn++;
  }
  const total = S.cards.size || 1;

  // reviews per day, last 30 days
  const perDay = Array.from({ length: 30 }, (_, i) => ({ start: today - (29 - i) * DAY, n: 0, ok: 0 }));
  for (const l of logs) { const i = 29 - Math.floor((today - dayStartMs(l.id)) / DAY); if (i >= 0 && i < 30) { perDay[i].n++; if (l.r > 1) perDay[i].ok++; } }
  // forecast, next 30 days
  const fc = Array.from({ length: 30 }, () => 0); const end = nextDayMs();
  for (const c of S.cards.values()) {
    if (c.susp || c.s.state === State.New) continue;
    const i = c.s.due < end ? 0 : Math.ceil((c.s.due - end) / DAY);
    if (i < 30) fc[i]++;
  }
  const hard = [...S.cards.values()].filter(c => c.s.lapses > 0 && !c.susp).sort((a, b) => b.s.lapses - a.s.lapses).slice(0, 8);
  const best = S.kv.matchBest || {};

  t.replaceChildren(
    h('div.page-head', h('h1', 'Stats')),
    h('div.stat-grid',
      h('div.stat', h('b', todayLogs.length), h('span', `reviewed today${mins ? ` · ${mins} min` : ''}`)),
      h('div.stat', h('b', '🔥 ' + streak()), h('span', 'day streak')),
      h('div.stat', h('b', retention == null ? '–' : retention + '%'), h('span', 'remembered (30 days)')),
      h('div.stat', h('b', S.cards.size.toLocaleString()), h('span', `cards in ${plural(S.decks.size, 'deck')}`))),
    h('h2.section', 'Reviews · last 30 days'),
    h('div.chart', bars(perDay.map(d => [d.ok, d.n - d.ok]), ['var(--accent)', 'var(--bad)']),
      h('div.legend', h('span', h('i', { style: { background: 'var(--accent)' } }), 'Remembered'), h('span', h('i', { style: { background: 'var(--bad)' } }), 'Forgot'), h('span', `${perDay.reduce((a, d) => a + d.n, 0).toLocaleString()} total`))),
    h('h2.section', 'Due · next 30 days'),
    h('div.chart', bars(fc.map(n => [n]), ['var(--due)']),
      h('div.legend', h('span', `${fc[0]} today`), h('span', `${fc.slice(0, 7).reduce((a, b) => a + b, 0)} this week`), h('span', `${fc.reduce((a, b) => a + b, 0)} this month`))),
    h('h2.section', 'Your cards'),
    h('div.chart',
      h('div.bar-split', [[st.nw, 'var(--new)'], [st.learn, 'var(--learn)'], [st.young, '#7fd1a0'], [st.mature, 'var(--due)'], [st.susp, 'var(--muted)']].map(([n, c]) => h('i', { style: { width: (n / total * 100) + '%', background: c } }))),
      h('div.legend', [['New', st.nw, 'var(--new)'], ['Learning', st.learn, 'var(--learn)'], ['Young', st.young, '#7fd1a0'], ['Mature', st.mature, 'var(--due)'], ['Suspended', st.susp, 'var(--muted)']].map(([l, n, c]) => h('span', h('i', { style: { background: c } }), `${l} ${n.toLocaleString()}`)))),
    hard.length ? [h('h2.section', 'Hardest cards'), h('div.group', hard.map(c => { const tx = cardTexts(c) || { q: '' }; return h('div.card-item', { on: { click: () => openEditor({ note: S.notes.get(c.noteId), onSave: refreshAll }) } }, h('div.grow', h('div.q', tx.q), h('div.a', tx.a)), h('div.meta', h('b', `${c.s.lapses}×`), 'forgotten')); }))] : null,
    Object.keys(best).length ? [h('h2.section', 'Match best times'), h('div.group', Object.entries(best).filter(([id]) => S.decks.has(+id)).map(([id, ms]) => h('div.row', h('div.grow', S.decks.get(+id).name.replace(/::/g, ' › ')), h('b', (ms / 1000).toFixed(1) + 's'))))] : null,
  );
}

function bars(series, colors) {
  const W = 300, H = 120, n = series.length, bw = W / n;
  const max = Math.max(1, ...series.map(s => s.reduce((a, b) => a + b, 0)));
  let svg = '';
  series.forEach((s, i) => {
    let y = H;
    s.forEach((v, k) => { if (!v) return; const hh = v / max * (H - 14); y -= hh; svg += `<rect x="${i * bw + 1}" y="${y}" width="${bw - 2}" height="${hh}" rx="1.5" fill="${colors[k]}"/>`; });
  });
  svg += `<text x="0" y="10" font-size="10" fill="currentColor" opacity=".5">${max}</text>`;
  const el = h('div'); el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${svg}</svg>`;
  return el;
}
