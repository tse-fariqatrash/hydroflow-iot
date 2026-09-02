/* Tag Database — the engineering reference. Every point, its live value, its
   alarm limits and its Modbus address, exportable as CSV for the panel builder. */

import { h, icon, num, pill, formatTagValue, tagSeverity, seriesColor, setChildren } from '../ui.js';
import { store, val, quality } from '../api.js';
import { T, sectionTitle } from './_shared.js';

export default function tagsPage(root) {
  let q = '', area = '', onlyAlarming = false;
  const tableCard = h('div', { class: 'card pad0' });
  const summary = h('div', { class: 'grid g4' });

  const search = h('input', { type: 'text', placeholder: 'Search by tag, name, description or device…', style: { maxWidth: '340px' },
    oninput: (e) => { q = e.target.value.toLowerCase().trim(); paint(); } });
  const areaSel = h('select', { style: { maxWidth: '200px' }, onchange: (e) => { area = e.target.value; paint(); } },
    h('option', { value: '' }, 'All subsystems'),
    store.meta.areas.map((a) => h('option', { value: a.id }, `${a.no} — ${a.name}`)));
  const alarmChk = h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' } },
    h('input', { type: 'checkbox', onchange: (e) => { onlyAlarming = e.target.checked; paint(); } }), 'Out of limits only');

  root.append(
    summary,
    h('div', { style: { marginTop: '20px' } }, sectionTitle('Point list',
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
        search, areaSel, alarmChk,
        h('button', { class: 'btn sm', onclick: exportCsv }, icon('download', 13), 'Export CSV')))),
    h('div', { style: { marginTop: '10px' } }, tableCard));

  function rows() {
    return store.meta.tags.filter((t) => {
      if (area && t.area !== area) return false;
      if (onlyAlarming) { const s = tagSeverity(t, val(t.id), store.values); if (s === 'good' || s === 'offline') return false; }
      if (!q) return true;
      return [t.id, t.name, t.desc, t.device, t.unit].filter(Boolean).some((x) => String(x).toLowerCase().includes(q));
    });
  }

  function paintSummary() {
    const all = store.meta.tags;
    const byArea = {};
    for (const t of all) byArea[t.area] = (byArea[t.area] || 0) + 1;
    const alarming = all.filter((t) => { const s = tagSeverity(t, val(t.id), store.values); return s !== 'good' && s !== 'offline'; }).length;
    const offline = all.filter((t) => quality(t.id) === 0).length;
    setChildren(summary,
      h('div', { class: 'card stat' }, h('div', { class: 'label' }, icon('layers', 12), 'Total points'),
        h('div', { class: 'value' }, num(all.length, 0)),
        h('div', { class: 'meta' }, `across ${store.meta.areas.length} subsystems · USM estimate 42–55 sensors`)),
      h('div', { class: 'card stat' }, h('div', { class: 'label' }, icon('activity', 12), 'Analogue / digital'),
        h('div', { class: 'value', style: { fontSize: '24px' } },
          `${all.filter((t) => t.kind !== 'digital').length} / ${all.filter((t) => t.kind === 'digital').length}`),
        h('div', { class: 'meta' }, 'transmitters vs discrete status points')),
      h('div', { class: 'card stat' }, h('div', { class: 'label' }, icon('alert', 12), 'Out of limits'),
        h('div', { class: 'value', style: { color: alarming ? 'var(--warning)' : 'var(--text-primary)' } }, num(alarming, 0)),
        h('div', { class: 'meta' }, 'live value beyond an H/L limit')),
      h('div', { class: 'card stat' }, h('div', { class: 'label' }, icon('slash', 12), 'Offline'),
        h('div', { class: 'value' }, num(offline, 0)),
        h('div', { class: 'meta' }, 'RO skid instrumentation, awaiting tie-in')));
  }

  function paint() {
    paintSummary();
    const list = rows();
    if (!list.length) { tableCard.replaceChildren(h('div', { class: 'empty' }, icon('search', 34), h('div', {}, 'No points match'))); return; }
    tableCard.replaceChildren(h('div', { class: 'table-wrap', style: { maxHeight: '640px' } },
      h('table', { class: 'data' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Tag'), h('th', {}, 'Point'), h('th', {}, 'Subsystem'), h('th', { class: 'num' }, 'Live'),
          h('th', {}, 'Unit'), h('th', { class: 'num' }, 'LL'), h('th', { class: 'num' }, 'L'), h('th', { class: 'num' }, 'H'), h('th', { class: 'num' }, 'HH'),
          h('th', {}, 'Device'), h('th', {}, 'Modbus'), h('th', {}, 'Status'))),
        h('tbody', {}, list.map((t) => {
          const v = val(t.id), qy = quality(t.id);
          const sev = qy === 0 ? 'offline' : tagSeverity(t, v, store.values);
          const a = t.alarm || {};
          const mb = t.modbus ? `${t.modbus.fc === 2 ? 'DI' : 'IR'} ${t.modbus.reg} · ${t.modbus.type}${t.modbus.scale !== 1 ? ` ×${t.modbus.scale}` : ''}` : '—';
          return h('tr', {},
            h('td', {}, h('a', { href: `#trends?tags=${t.id}`, class: 'tag-chip', style: { textDecoration: 'none' } }, t.id)),
            h('td', {}, h('div', {}, t.name), t.desc ? h('div', { class: 'footnote', style: { fontSize: '10.5px' } }, t.desc) : null),
            h('td', { class: 'muted' }, store.meta.areaMap[t.area]?.short || t.area),
            h('td', { class: 'num', style: { fontWeight: 600, color: sev === 'good' || sev === 'offline' ? '' : `var(--${sev})` } },
              qy === 0 ? '—' : formatTagValue(t, v)),
            h('td', { class: 'muted' }, t.unit || '—'),
            h('td', { class: 'num muted' }, a.ll ?? '—'), h('td', { class: 'num muted' }, a.l ?? '—'),
            h('td', { class: 'num muted' }, a.h ?? '—'), h('td', { class: 'num muted' }, a.hh ?? '—'),
            h('td', { class: 'muted', style: { fontSize: '11px' } }, t.device || '—'),
            h('td', { class: 'muted mono', style: { fontSize: '11px', whiteSpace: 'nowrap' } },
              t.modbus ? `#${t.modbus.slave} ${mb}` : '—'),
            h('td', {}, qy === 0 ? pill('Offline', 'offline', 'slash')
              : sev === 'good' ? pill('Normal', 'good', 'check') : pill(sev === 'critical' ? 'Critical' : 'Warning', sev, 'alert')));
        })))));
  }

  function exportCsv() {
    const head = ['Tag', 'Name', 'Description', 'Subsystem', 'Area No', 'Unit', 'Kind', 'Min', 'Max', 'Precision',
      'LL', 'L', 'H', 'HH', 'Suppressed by', 'Device', 'Modbus slave', 'Function', 'Register', 'Data type', 'Scale', 'Live value'];
    const esc = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const lines = [head.join(',')];
    for (const t of rows()) {
      const a = t.alarm || {}, m = t.modbus || {};
      const sup = a.suppressWhen ? [].concat(a.suppressWhen).map((r) => `${r.tag}${r.equals !== undefined ? `=${r.equals}` : ''}`).join(' or ') : '';
      lines.push([t.id, t.name, t.desc, store.meta.areaMap[t.area]?.name, store.meta.areaMap[t.area]?.no, t.unit, t.kind,
        t.min, t.max, t.precision, a.ll, a.l, a.h, a.hh, sup, t.device, m.slave,
        m.fc === 2 ? 'FC02 Discrete Input' : m.fc === 4 ? 'FC04 Input Register' : m.fc, m.reg, m.type, m.scale, val(t.id)].map(esc).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `hydroflow-tag-list-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.appendChild(a); a.click(); a.remove();
  }

  paint();
  return { onTick: paint };
}
