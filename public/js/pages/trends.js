/* Trends & Historian — pick any points, any window, compare them.
   Deliberately capped at 6 series: past that a line chart stops being readable
   and the right move is a second chart, not a ninth colour. */

import { h, icon, num, pill, seriesColor, fmtFull, setChildren } from '../ui.js';
import { store, history, val } from '../api.js';
import { TimeSeriesChart, legend } from '../charts.js';
import { T, RANGES, rangePicker, sectionTitle } from './_shared.js';

const MAX_SERIES = 6;
const PRESETS = {
  'Energy balance':    ['EM-1008', 'EM-1011', 'EM-1010', 'EM-8003'],
  'Battery':           ['QT-8004', 'EM-8001', 'QT-8007'],
  'Water production':  ['FT-3007', 'FT-4003', 'FT-4008', 'FT-7001'],
  'Water quality':     ['AIT-3002', 'AIT-4005', 'AIT-6007', 'AIT-4006'],
  'Tank levels':       ['LT-3010', 'LT-4007', 'LT-6001', 'LT-2003'],
  'Tide & salinity':   ['LT-3001', 'AIT-3004'],
  'Filter condition':  ['DPT-4001', 'DPT-4002', 'PT-4004'],
  'Solar resource':    ['JT-1001', 'TT-1002', 'EM-1007'],
};

export default function trends(root) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  let selected = (params.get('tags') || 'EM-1008,EM-1011').split(',').filter(Boolean).slice(0, MAX_SERIES);
  let range = RANGES.find((r) => r.key === '24h');
  let showLimits = true;
  const hidden = new Set();
  let chart = null;

  const chartHost = h('div', { class: 'chart', style: { height: '380px' } });
  const legendHost = h('div', { style: { marginTop: '12px' } });
  const chipHost = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' } });
  const statsHost = h('div', { class: 'grid g4', style: { marginTop: '14px' } });
  const search = h('input', { type: 'text', placeholder: 'Search tags by name, ID or area…', style: { maxWidth: '320px' } });
  const picker = h('div', { class: 'table-wrap', style: { maxHeight: '340px' } });

  const rangeEl = rangePicker(range.key, (r) => { range = r; load(); });

  root.append(
    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', {}, 'Trend viewer'),
        h('span', { class: 'hint' }, `${selected.length} of ${MAX_SERIES} series`),
        h('span', { class: 'spacer' }),
        h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' } },
          h('input', { type: 'checkbox', checked: true, onchange: (e) => { showLimits = e.target.checked; load(); } }), 'Alarm limits'),
        rangeEl),
      chipHost, chartHost, legendHost),
    statsHost,
    h('div', { style: { marginTop: '20px' } }, sectionTitle('Presets')),
    h('div', { class: 'card', style: { marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '7px' } },
      Object.entries(PRESETS).map(([name, tags]) =>
        h('button', { class: 'btn sm', onclick: () => { selected = tags.slice(0, MAX_SERIES); hidden.clear(); load(); } },
          icon('chart', 13), name))),
    h('div', { style: { marginTop: '20px' } }, sectionTitle('Add a point')),
    h('div', { class: 'card pad0', style: { marginTop: '10px' } },
      h('div', { style: { padding: '12px 16px', borderBottom: '1px solid var(--border)' } }, search),
      picker));

  function paintChips() {
    setChildren(chipHost, ...selected.map((id, i) => {
      const t = T(id);
      return h('span', { class: 'pill', style: { borderColor: seriesColor(i + 1), paddingRight: '4px' } },
        h('span', { class: 'dot', style: { background: seriesColor(i + 1) } }),
        h('span', {}, t ? `${t.name}` : id),
        h('span', { class: 'mono', style: { opacity: .6, fontSize: '10px' } }, id),
        h('button', { class: 'icon-btn', style: { width: '18px', height: '18px' },
          onclick: () => { selected = selected.filter((s) => s !== id); load(); }, title: 'Remove' }, icon('x', 11)));
    }), selected.length === 0 ? h('span', { class: 'muted', style: { fontSize: '12px' } }, 'Pick a point below to begin') : null);
  }

  async function load() {
    paintChips();
    if (!selected.length) { chartHost.replaceChildren(h('div', { class: 'empty' }, 'No points selected')); legendHost.replaceChildren(); statsHost.replaceChildren(); return; }
    const to = Date.now(), from = to - range.ms;
    let res;
    try { res = await history(selected, from, to, 900); }
    catch (e) { chartHost.replaceChildren(h('div', { class: 'empty' }, e.message)); return; }

    // Multiple units on one axis is a lie, so normalise when they disagree.
    const units = [...new Set(selected.map((id) => T(id)?.unit || ''))];
    const mixed = units.length > 1;
    const built = selected.map((id, i) => {
      const t = T(id) || { name: id, unit: '', precision: 2 };
      let data = res.series[id] || [];
      if (mixed) {
        const vals = data.map((d) => d[1]).filter((v) => v !== null);
        const lo = Math.min(...vals), hi = Math.max(...vals);
        data = data.map(([ts, v]) => [ts, v === null ? null : hi > lo ? ((v - lo) / (hi - lo)) * 100 : 50]);
      }
      return { key: id, label: `${t.name}${mixed ? '' : ''}`, slot: i + 1, unit: mixed ? '%' : t.unit,
               precision: mixed ? 1 : t.precision ?? 2, data, raw: res.series[id] || [] };
    });

    const limits = [];
    if (showLimits && !mixed && selected.length === 1) {
      const t = T(selected[0]);
      for (const [k, lbl, kind] of [['hh', 'HH', 'critical'], ['h', 'H', 'warning'], ['l', 'L', 'warning'], ['ll', 'LL', 'critical']]) {
        if (t?.alarm?.[k] != null) limits.push({ value: t.alarm[k], label: lbl, kind });
      }
    }
    const opts = { series: built, from, to, height: 380, hidden, limits, unit: mixed ? '%' : units[0] };
    if (chart) chart.update(opts); else chart = new TimeSeriesChart(chartHost, opts);

    const toggle = (k) => { hidden.has(k) ? hidden.delete(k) : hidden.add(k); chart.update({ hidden }); setChildren(legendHost, legend(built, { hidden, onToggle: toggle }), note()); };
    const note = () => mixed
      ? h('div', { class: 'footnote', style: { marginTop: '8px' } },
          `Selected points use different units (${units.filter(Boolean).join(', ')}), so each series is normalised to its own 0–100 % range over this window. Shape is comparable; absolute values are not — the tooltip shows the normalised figure. For true values, chart one unit at a time.`)
      : null;
    setChildren(legendHost, legend(built, { hidden, onToggle: toggle }), note());

    // per-series statistics
    setChildren(statsHost, ...built.map((s, i) => {
      const vals = s.raw.map((d) => d[1]).filter((v) => v !== null && isFinite(v));
      const t = T(s.key) || {};
      if (!vals.length) return h('div', { class: 'card stat' }, h('div', { class: 'label' }, s.label), h('div', { class: 'value' }, '—'));
      const min = Math.min(...vals), max = Math.max(...vals), avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const last = vals[vals.length - 1];
      return h('div', { class: 'card stat' },
        h('div', { class: 'label' }, h('span', { class: 'dot', style: { background: seriesColor(i + 1) } }), s.label),
        h('div', { class: 'value', style: { fontSize: '24px' } }, num(last, t.precision ?? 2), h('span', { class: 'unit' }, t.unit || '')),
        h('div', { class: 'meta', style: { marginTop: '6px', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', fontFamily: 'var(--mono)', fontSize: '11px' } },
          h('span', { class: 'muted' }, 'min'), h('span', { style: { textAlign: 'right' } }, num(min, t.precision ?? 2)),
          h('span', { class: 'muted' }, 'avg'), h('span', { style: { textAlign: 'right' } }, num(avg, t.precision ?? 2)),
          h('span', { class: 'muted' }, 'max'), h('span', { style: { textAlign: 'right' } }, num(max, t.precision ?? 2)),
          h('span', { class: 'muted' }, 'n'), h('span', { style: { textAlign: 'right' } }, String(vals.length))));
    }));
  }

  function paintPicker() {
    const q = search.value.toLowerCase().trim();
    const rows = store.meta.tags.filter((t) => !t.hidden)
      .filter((t) => !q || t.id.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) ||
        (store.meta.areaMap[t.area]?.name || '').toLowerCase().includes(q));
    picker.replaceChildren(h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Tag'), h('th', {}, 'Point'), h('th', {}, 'Area'), h('th', { class: 'num' }, 'Live'), h('th', {}, ''))),
      h('tbody', {}, rows.map((t) => {
        const on = selected.includes(t.id);
        return h('tr', {},
          h('td', {}, h('span', { class: 'tag-chip' }, t.id)),
          h('td', {}, t.name),
          h('td', { class: 'muted' }, store.meta.areaMap[t.area]?.short || t.area),
          h('td', { class: 'num' }, val(t.id) === null ? '—' : `${num(val(t.id), t.precision ?? 1)} ${t.unit || ''}`),
          h('td', { style: { textAlign: 'right' } },
            h('button', { class: `btn sm ${on ? '' : 'ghost'}`, disabled: !on && selected.length >= MAX_SERIES,
              onclick: () => {
                if (on) selected = selected.filter((s) => s !== t.id);
                else if (selected.length < MAX_SERIES) selected = [...selected, t.id];
                load(); paintPicker();
              } }, on ? 'Remove' : 'Add')));
      }))));
  }

  search.addEventListener('input', paintPicker);
  load(); paintPicker();
  return {};
}
