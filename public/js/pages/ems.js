/* Energy Management — where the site's electricity comes from and where it goes.
   The number that matters is autonomy: the share of consumption carried by PV
   and battery rather than the utility. */

import { h, icon, num, pill, seriesColor, fmtDate, fmtDayName, setChildren } from '../ui.js';
import { store, val, ctx, api, history } from '../api.js';
import { TimeSeriesChart, BarChart, sparkline, gauge, meter, legend } from '../charts.js';
import { T, liveTile, historyCard, sectionTitle, readout, kv, ENERGY } from './_shared.js';

export default function ems(root) {
  const D = store.meta.design;
  const tiles = h('div', { class: 'grid g4' });
  const flowCard = h('div', { class: 'card' });
  const stringCard = h('div', { class: 'card' });
  const dailyCard = h('div', { class: 'card' });
  const tableCard = h('div', { class: 'card pad0' });

  root.append(
    tiles,
    h('div', { class: 'grid g2', style: { marginTop: '14px' } }, flowCard, stringCard),
    h('div', { style: { marginTop: '20px' } }, sectionTitle('Energy history')),
    h('div', { style: { marginTop: '10px' } }, dailyCard),
    h('div', { class: 'grid g2', style: { marginTop: '14px' } },
      historyCard({ title: 'PV AC output', hint: 'compare shape against the irradiance trace beside it',
        series: [{ tag: 'EM-1008', label: 'AC output (kW)', slot: 4, unit: 'kW' }], unit: 'kW', height: 210 }),
      historyCard({ title: 'Plane-of-array irradiance', hint: 'silicon sensor, 25° tilt',
        series: [{ tag: 'JT-1001', label: 'POA irradiance', slot: 2 }], unit: 'W/m²', height: 210 })),
    h('div', { class: 'grid g2', style: { marginTop: '14px' } },
      historyCard({ title: 'Battery power', hint: 'positive = charging, negative = discharging',
        series: [{ tag: 'EM-8003', label: 'Battery power', slot: ENERGY.battery }], unit: 'kW', height: 210, zeroLine: true }),
      historyCard({ title: 'Grid exchange', hint: 'positive = import, negative = export',
        series: [{ tag: 'EM-1010', label: 'Grid power', slot: ENERGY.grid }], unit: 'kW', height: 210, zeroLine: true })),
    h('div', { style: { marginTop: '20px' } }, sectionTitle('Daily energy ledger')),
    h('div', { style: { marginTop: '10px' } }, tableCard));

  /* ── tiles ─────────────────────────────────────────────────────────── */
  function paintTiles() {
    const c = ctx();
    const load = c.kwh?.loadToday ?? 0, imp = c.kwh?.importToday ?? 0, pv = c.kwh?.pvToday ?? 0, exp = c.kwh?.exportToday ?? 0;
    const autonomy = load > 0 ? Math.max(0, (1 - imp / load) * 100) : 100;
    const selfUse = pv > 0 ? Math.max(0, Math.min(100, (1 - exp / pv) * 100)) : 0;
    const yieldKWhKWp = pv / D.pv.kWp;
    setChildren(tiles,
      h('div', { class: 'card stat' },
        h('div', { class: 'label' }, icon('shield', 12), 'Energy autonomy today'),
        h('div', { class: 'value' }, num(autonomy, 0), h('span', { class: 'unit' }, '%')),
        h('div', { class: 'meta' }, `${num(load - imp, 1)} of ${num(load, 1)} kWh from PV + battery`),
        h('div', { style: { marginTop: '10px' } }, meter({ pct: autonomy, color: autonomy > 70 ? 'var(--good)' : autonomy > 40 ? 'var(--warning)' : 'var(--serious)' }))),
      h('div', { class: 'card stat' },
        h('div', { class: 'label' }, icon('sun', 12), 'PV self-consumption'),
        h('div', { class: 'value' }, num(selfUse, 0), h('span', { class: 'unit' }, '%')),
        h('div', { class: 'meta' }, `${num(exp, 1)} kWh exported of ${num(pv, 1)} kWh generated`),
        h('div', { style: { marginTop: '10px' } }, meter({ pct: selfUse, color: 'var(--series-4)' }))),
      liveTile({ label: 'Specific yield today', tagId: 'EM-1008', unit: 'kWh/kWp', slot: 4, icon: 'zap',
        transform: () => yieldKWhKWp, precision: 2, meta: `${num(D.pv.kWp, 1)} kWp · ${D.pv.moduleCount} × ${D.pv.moduleW} Wp` }),
      liveTile({ label: 'Inverter loading', tagId: 'EM-1008', unit: '%', slot: 1, icon: 'activity',
        transform: (v) => ((v ?? 0) / D.pv.inverterKW) * 100, precision: 0,
        meta: `${num(val('EM-1008') ?? 0, 2)} kW of ${num(D.pv.inverterKW, 1)} kW · heatsink ${num(val('TT-1009') ?? 0, 0)} °C` }));
  }

  /* ── live dispatch diagram ─────────────────────────────────────────── */
  function paintFlow() {
    const c = ctx();
    const pv = c.pvAC ?? 0, load = c.load ?? 0, batt = c.battKW ?? 0, grid = c.gridKW ?? 0;
    // Resolve the instantaneous dispatch into explicit source→sink links.
    const pvToLoad = Math.min(pv, load);
    const pvToBatt = Math.max(0, Math.min(pv - pvToLoad, Math.max(0, batt)));
    const pvToGrid = Math.max(0, pv - pvToLoad - pvToBatt);
    const battToLoad = Math.max(0, -batt);
    const gridToLoad = Math.max(0, grid);

    const W = 460, H = 250;
    // Links are coloured by their SOURCE, so a colour always means the same
    // thing on this figure; sinks are neutral because they are sums.
    const C = { pv: seriesColor(ENERGY.solar), batt: seriesColor(ENERGY.battery), grid: seriesColor(ENERGY.grid), sink: 'var(--text-muted)' };
    const nodes = {
      pv:   { x: 16,  y: 24,  w: 96, h: 54, label: 'Solar PV', v: pv, color: C.pv },
      batt: { x: 16,  y: 106, w: 96, h: 54, label: batt >= 0 ? 'Battery (chg)' : 'Battery (dis)', v: Math.abs(batt), color: C.batt },
      grid: { x: 16,  y: 188, w: 96, h: 54, label: grid >= 0 ? 'Grid import' : 'Grid export', v: Math.abs(grid), color: C.grid },
      load: { x: 328, y: 62,  w: 116, h: 62, label: 'Site load', v: load, color: C.sink },
      exp:  { x: 328, y: 168, w: 116, h: 54, label: 'Export / charge', v: pvToGrid + pvToBatt, color: C.sink },
    };
    const maxFlow = Math.max(0.35, pv, load, Math.abs(batt), Math.abs(grid));
    const links = [
      { from: 'pv', to: 'load', v: pvToLoad, color: C.pv },
      { from: 'pv', to: 'exp', v: pvToBatt + pvToGrid, color: C.pv },
      { from: 'batt', to: 'load', v: battToLoad, color: C.batt },
      { from: 'grid', to: 'load', v: gridToLoad, color: C.grid },
    ].filter((l) => l.v > 0.005);

    const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, style: { maxWidth: '100%' } });
    for (const l of links) {
      const a = nodes[l.from], b = nodes[l.to];
      const x0 = a.x + a.w, y0 = a.y + a.h / 2, x1 = b.x, y1 = b.y + b.h / 2;
      const sw = Math.max(2, (l.v / maxFlow) * 22);
      svg.appendChild(h('path', {
        d: `M${x0},${y0} C${x0 + 78},${y0} ${x1 - 78},${y1} ${x1},${y1}`,
        class: 'flow-link animated', stroke: l.color, 'stroke-width': sw }));
      svg.appendChild(h('text', { x: (x0 + x1) / 2, y: (y0 + y1) / 2 - sw / 2 - 5, 'text-anchor': 'middle',
        'font-size': 10, fill: 'var(--text-secondary)', 'font-family': 'var(--mono)' }, `${num(l.v, 2)} kW`));
    }
    for (const [k, n] of Object.entries(nodes)) {
      svg.appendChild(h('rect', { class: 'flow-node', x: n.x, y: n.y, width: n.w, height: n.h, rx: 8 }));
      svg.appendChild(h('rect', { x: n.x, y: n.y, width: 3.5, height: n.h, rx: 2, fill: n.color }));
      svg.appendChild(h('text', { x: n.x + 12, y: n.y + 21, 'font-size': 11, fill: 'var(--text-secondary)' }, n.label));
      svg.appendChild(h('text', { x: n.x + 12, y: n.y + 41, 'font-size': 15, 'font-weight': 600, fill: 'var(--text-primary)', 'font-family': 'var(--mono)' },
        `${num(n.v, 2)} kW`));
    }
    setChildren(flowCard,
      h('div', { class: 'card-head' }, h('h3', {}, 'Live dispatch'), h('span', { class: 'hint' }, 'instantaneous source → sink'),
        h('span', { class: 'spacer' }),
        pill(pv > load ? 'Surplus' : batt < -0.02 ? 'On battery' : grid > 0.02 ? 'On grid' : 'Balanced',
          pv > load ? 'good' : grid > 0.02 ? 'warning' : 'info', 'zap')),
      svg,
      h('div', { class: 'footnote', style: { marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border)' } },
        'Dispatch rule: PV serves load first, then charges the battery to 96 %, then exports. On deficit the battery discharges down to a 25 % reserve before the grid is called. Link width is proportional to power.'));
  }

  /* ── string balance ────────────────────────────────────────────────── */
  function paintStrings() {
    const rows = [
      // Slots 4 and 2 (yellow / orange) are the one pair in this palette that
      // fails the all-pairs colour-blindness floor, so string 2 takes slot 1.
      { name: 'String 1', v: val('JT-1003'), i: val('JT-1004'), slot: 4 },
      { name: 'String 2', v: val('JT-1005'), i: val('JT-1006'), slot: 1 },
    ].map((r) => ({ ...r, p: ((r.v ?? 0) * (r.i ?? 0)) / 1000 }));
    const maxP = Math.max(0.05, ...rows.map((r) => r.p));
    const imbalance = maxP > 0.1 ? Math.abs(rows[0].p - rows[1].p) / maxP * 100 : 0;

    setChildren(stringCard,
      h('div', { class: 'card-head' }, h('h3', {}, 'PV string monitoring'), h('span', { class: 'hint' }, '2 strings × 7 modules'),
        h('span', { class: 'spacer' }),
        pill(imbalance < 6 ? 'Strings balanced' : 'String imbalance', imbalance < 6 ? 'good' : 'warning', imbalance < 6 ? 'check' : 'alert')),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '13px' } },
        rows.map((r) => h('div', {},
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', fontSize: '12px', marginBottom: '5px' } },
            h('span', { class: 'dot', style: { background: seriesColor(r.slot) } }),
            h('span', { style: { fontWeight: 600 } }, r.name),
            h('span', { class: 'muted', style: { fontSize: '11.5px' } }, `${num(r.v, 1)} V · ${num(r.i, 2)} A`),
            h('span', { style: { marginLeft: 'auto', fontFamily: 'var(--mono)', fontWeight: 600 } }, `${num(r.p, 2)} kW`)),
          meter({ pct: (r.p / maxP) * 100, color: seriesColor(r.slot), height: 6 })))),
      h('div', { style: { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border)' } },
        kv([
          ['Array DC power', `${num(val('EM-1007') ?? 0, 2)} kW`],
          ['Inverter AC output', `${num(val('EM-1008') ?? 0, 2)} kW`],
          ['Conversion efficiency', `${num((val('EM-1007') ?? 0) > 0.05 ? ((val('EM-1008') ?? 0) / val('EM-1007')) * 100 : 0, 1)} %`],
          ['Module temperature', `${num(val('TT-1002') ?? 0, 1)} °C`],
          ['Temperature derate', `${num(D.pv.tempCoeffPct * ((val('TT-1002') ?? 25) - 25), 1)} %`],
          ['Inverter heatsink', `${num(val('TT-1009') ?? 0, 1)} °C`],
          ['Grid frequency', `${num(val('EM-1012') ?? 0, 2)} Hz`],
          ['AC bus voltage', `${num(val('EM-1013') ?? 0, 1)} V`],
        ])));
  }

  /* ── daily ledger ──────────────────────────────────────────────────── */
  let barChart = null;
  async function paintDaily() {
    let days = [];
    try { days = await api('/daily?days=14'); } catch { return; }
    if (!days.length) return;
    const cats = days.map((d) => fmtDayName(Date.parse(`${d.day}T04:00:00Z`)) + ' ' + d.day.slice(8));
    const series = [
      { key: 'solar', label: 'Self-supplied (PV + battery)', slot: ENERGY.solar, data: days.map((d) => Math.max(0, +(d.load_kwh - d.import_kwh).toFixed(2))), unit: 'kWh' },
      { key: 'grid', label: 'Grid import', slot: ENERGY.grid, data: days.map((d) => +d.import_kwh), unit: 'kWh' },
      { key: 'export', label: 'Exported surplus', slot: ENERGY.exported, data: days.map((d) => +d.export_kwh), unit: 'kWh' },
    ];
    const host = h('div', { style: { height: '250px' } });
    setChildren(dailyCard,
      h('div', { class: 'card-head' }, h('h3', {}, 'Daily electricity, last 14 days'),
        h('span', { class: 'hint' }, 'stacked kWh — how each day\'s consumption was covered'),
        h('span', { class: 'spacer' }), legend(series)),
      host);
    new BarChart(host, { categories: cats, series, stacked: true, height: 250, unit: 'kWh', valueFmt: (v) => num(v, 1) });

    tableCard.replaceChildren(h('div', { class: 'table-wrap' },
      h('table', { class: 'data' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Date'), h('th', { class: 'num' }, 'PV gen'), h('th', { class: 'num' }, 'Consumption'),
          h('th', { class: 'num' }, 'Grid import'), h('th', { class: 'num' }, 'Export'),
          h('th', { class: 'num' }, 'Batt charge'), h('th', { class: 'num' }, 'Batt discharge'),
          h('th', { class: 'num' }, 'Peak load'), h('th', { class: 'num' }, 'Min SOC'), h('th', { class: 'num' }, 'Autonomy'))),
        h('tbody', {}, [...days].reverse().map((d) => h('tr', {},
          h('td', { class: 'mono' }, d.day),
          h('td', { class: 'num' }, num(d.pv_kwh, 1)),
          h('td', { class: 'num' }, num(d.load_kwh, 1)),
          h('td', { class: 'num' }, num(d.import_kwh, 1)),
          h('td', { class: 'num' }, num(d.export_kwh, 1)),
          h('td', { class: 'num' }, num(d.chg_kwh, 1)),
          h('td', { class: 'num' }, num(d.dsch_kwh, 1)),
          h('td', { class: 'num' }, num(d.peak_load_kw, 2)),
          h('td', { class: 'num' }, num(d.min_soc, 0) + '%'),
          h('td', { class: 'num' },
            h('span', { style: { color: d.autonomy_pct > 70 ? 'var(--good)' : d.autonomy_pct > 40 ? 'var(--warning)' : 'var(--serious)', fontWeight: 600 } },
              num(d.autonomy_pct, 0) + '%'))))))));
  }

  paintTiles(); paintFlow(); paintStrings(); paintDaily();
  const t = setInterval(paintDaily, 120000);
  return { onTick() { paintTiles(); paintFlow(); paintStrings(); }, destroy() { clearInterval(t); } };
}
