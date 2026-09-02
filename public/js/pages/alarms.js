/* Alarms & Events — the journal, the acknowledgement workflow, and the two
   diagnostics that tell you whether the alarm system itself is healthy:
   which points generate the most alarms, and the rate over time. */

import { h, icon, num, pill, fmtFull, duration, ago, seriesColor, setChildren } from '../ui.js';
import { store, api, can } from '../api.js';
import { BarChart, meter } from '../charts.js';
import { T, sectionTitle } from './_shared.js';

export default function alarms(root) {
  let state = 'open', areaFilter = '', rows = [], events = [];
  const summary = h('div', { class: 'grid g4' });
  const tableCard = h('div', { class: 'card pad0' });
  const chattyCard = h('div', { class: 'card' });
  const eventCard = h('div', { class: 'card pad0' });

  const stateSeg = h('div', { class: 'seg' },
    [['open', 'Open'], ['active', 'Active'], ['cleared', 'Cleared'], ['all', 'All']].map(([k, l]) =>
      h('button', { class: k === 'open' ? 'active' : '', dataset: { k }, onclick: (e) => {
        state = k; for (const b of stateSeg.children) b.classList.remove('active'); e.target.classList.add('active'); load();
      } }, l)));

  const areaSel = h('select', { style: { maxWidth: '210px' }, onchange: (e) => { areaFilter = e.target.value; load(); } },
    h('option', { value: '' }, 'All subsystems'),
    store.meta.areas.map((a) => h('option', { value: a.id }, a.name)));

  const ackAllBtn = h('button', { class: 'btn', disabled: !can('operate'),
    title: can('operate') ? 'Acknowledge every active alarm' : 'Your role cannot acknowledge alarms',
    onclick: async () => { await api('/alarms/ack-all', { method: 'POST' }); load(); } }, icon('check', 14), 'Acknowledge all');

  root.append(
    summary,
    h('div', { style: { marginTop: '20px' } }, sectionTitle('Alarm journal',
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, areaSel, stateSeg, ackAllBtn))),
    h('div', { style: { marginTop: '10px' } }, tableCard),
    h('div', { class: 'grid g2', style: { marginTop: '20px' } },
      chattyCard,
      h('div', {}, sectionTitle('System event log'), h('div', { style: { marginTop: '10px' } }, eventCard))));

  function paintSummary() {
    const s = store.alarmSummary || {};
    const open = rows.filter((r) => r.state === 'active' || r.state === 'acked');
    const oldest = open.length ? Math.min(...open.map((r) => r.raised_at)) : null;
    setChildren(summary,
      h('div', { class: 'card stat' },
        h('div', { class: 'label' }, icon('alert', 12), 'Active alarms'),
        h('div', { class: 'value', style: { color: s.total ? (s.critical ? 'var(--critical)' : 'var(--warning)') : 'var(--text-primary)' } }, num(s.total ?? 0, 0)),
        h('div', { class: 'meta' }, `${num(s.unacked ?? 0, 0)} awaiting acknowledgement`)),
      h('div', { class: 'card stat' },
        h('div', { class: 'label' }, icon('alert', 12), 'Critical'),
        h('div', { class: 'value', style: { color: s.critical ? 'var(--critical)' : 'var(--text-primary)' } }, num(s.critical ?? 0, 0)),
        h('div', { class: 'meta' }, 'HH / LL limit or leak detected')),
      h('div', { class: 'card stat' },
        h('div', { class: 'label' }, icon('bell', 12), 'Warning'),
        h('div', { class: 'value', style: { color: s.warning ? 'var(--warning)' : 'var(--text-primary)' } }, num(s.warning ?? 0, 0)),
        h('div', { class: 'meta' }, 'H / L limit exceeded')),
      h('div', { class: 'card stat' },
        h('div', { class: 'label' }, icon('clock', 12), 'Oldest open alarm'),
        h('div', { class: 'value', style: { fontSize: '24px' } }, oldest ? duration(Date.now() - oldest) : '—'),
        h('div', { class: 'meta' }, oldest ? fmtFull(oldest) : 'nothing outstanding')));
  }

  function paintTable() {
    if (!rows.length) {
      setChildren(tableCard, h('div', { class: 'empty' }, icon('check', 34),
        h('div', {}, state === 'open'
          ? 'No alarms are currently open — every monitored point is within its limits.'
          : 'No alarms match this filter.'),
        state === 'open'
          ? h('button', { class: 'btn sm ghost', style: { marginTop: '12px' }, onclick: () => {
              state = 'all';
              for (const b of stateSeg.children) b.classList.toggle('active', b.dataset.k === 'all');
              load();
            } }, 'View the full journal')
          : null));
      return;
    }
    tableCard.replaceChildren(h('div', { class: 'table-wrap' },
      h('table', { class: 'data' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Severity'), h('th', {}, 'Raised'), h('th', {}, 'Tag'), h('th', {}, 'Message'),
          h('th', {}, 'Duration'), h('th', {}, 'State'), h('th', {}, 'Acknowledged by'), h('th', {}, ''))),
        h('tbody', {}, rows.map((a) => {
          const open = a.state === 'active' || a.state === 'acked';
          return h('tr', { class: `alarm-row ${a.severity} ${a.cleared_at ? 'cleared' : ''}` },
            h('td', {}, pill(a.severity[0].toUpperCase() + a.severity.slice(1), a.severity, 'alert')),
            h('td', { class: 'mono', style: { whiteSpace: 'nowrap' } }, fmtFull(a.raised_at)),
            h('td', {}, h('a', { href: `#trends?tags=${a.tag}`, class: 'tag-chip', style: { textDecoration: 'none' }, title: T(a.tag)?.name }, a.tag)),
            h('td', {}, a.message),
            h('td', { class: 'mono', style: { whiteSpace: 'nowrap' } }, duration((a.cleared_at || Date.now()) - a.raised_at)),
            h('td', {}, a.cleared_at ? pill('Cleared', 'good', 'check') : a.acked_at ? pill('Acknowledged', 'info', 'check') : pill('Unacknowledged', 'warning', 'bell')),
            h('td', { class: 'muted' }, a.acked_by || '—'),
            h('td', { style: { textAlign: 'right' } },
              !a.acked_at && open && can('operate')
                ? h('button', { class: 'btn sm', onclick: async () => { await api(`/alarms/${a.id}/ack`, { method: 'POST', body: JSON.stringify({ note: 'Acknowledged from alarm journal' }) }); load(); } }, 'Ack')
                : null));
        })))));
  }

  async function paintChatty() {
    let all = [];
    try { all = await api('/alarms?state=all&limit=1000'); } catch { return; }
    const counts = new Map();
    for (const a of all) counts.set(a.tag, (counts.get(a.tag) || 0) + 1);
    const top = [...counts].sort((x, y) => y[1] - x[1]).slice(0, 8);
    const max = top.length ? top[0][1] : 1;
    const total = all.length;
    // 24-hour histogram of the alarm rate
    const now = Date.now();
    const buckets = Array.from({ length: 14 }, (_, i) => ({ day: new Date(now - (13 - i) * 86400e3), n: 0 }));
    for (const a of all) {
      const idx = 13 - Math.floor((now - a.raised_at) / 86400e3);
      if (idx >= 0 && idx < 14) buckets[idx].n++;
    }
    const host = h('div', { style: { height: '160px' } });
    setChildren(chattyCard,
      h('div', { class: 'card-head' }, h('h3', {}, 'Alarm load'),
        h('span', { class: 'hint' }, `${total} records in the journal`),
        h('span', { class: 'spacer' }),
        pill(`${num(total / 14, 1)}/day average`, total / 14 > 20 ? 'warning' : 'good', 'activity')),
      host,
      h('div', { style: { marginTop: '16px' } },
        h('div', { style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '9px' } }, 'Most frequent points'),
        top.map(([tag, n], i) => h('div', { style: { marginBottom: '8px' } },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', fontSize: '12px', marginBottom: '4px' } },
            h('span', { class: 'tag-chip' }, tag),
            h('span', { class: 'muted', style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, T(tag)?.name || ''),
            h('span', { class: 'mono', style: { fontWeight: 600 } }, n)),
          meter({ pct: (n / max) * 100, color: seriesColor((i % 8) + 1), height: 4 })))),
      h('div', { class: 'footnote', style: { marginTop: '12px' } },
        'A point that dominates this list is usually a limit set too tight, not a plant that is failing. Alarms on pump-dependent points (discharge pressure, vibration) are suppressed while the pump is stopped — ISA-18.2 state-based alarming — so what remains here should be real process deviation.'));
    new BarChart(host, {
      categories: buckets.map((b) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short' }).format(b.day)),
      series: [{ key: 'n', label: 'Alarms raised', slot: 8, data: buckets.map((b) => b.n), unit: '' }],
      height: 160, valueFmt: (v) => num(v, 0),
    });
  }

  async function paintEvents() {
    try { events = await api('/events?limit=60'); } catch { return; }
    eventCard.replaceChildren(h('div', { class: 'table-wrap', style: { maxHeight: '430px' } },
      h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Time'), h('th', {}, 'Event'), h('th', {}, 'Actor'), h('th', {}, 'Detail'))),
        h('tbody', {}, events.map((e) => h('tr', {},
          h('td', { class: 'mono', style: { whiteSpace: 'nowrap' } }, fmtFull(e.ts)),
          h('td', {}, h('span', { class: 'tag-chip' }, e.type)),
          h('td', {}, e.actor || '—'),
          h('td', { class: 'muted' }, [e.target, e.detail].filter(Boolean).join(' · ') || '—')))))));
  }

  async function load() {
    try { rows = await api(`/alarms?state=${state}&limit=300${areaFilter ? `&area=${areaFilter}` : ''}`); }
    catch { rows = []; }
    paintSummary(); paintTable();
  }

  load(); paintChatty(); paintEvents();
  const t = setInterval(() => { load(); }, 15000);
  return { onAlarm: () => { load(); paintChatty(); paintEvents(); }, onTick: paintSummary, destroy() { clearInterval(t); } };
}
