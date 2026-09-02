/* Plant Overview — the screen that stays on the control-room wall.
   One question per tile: is the community getting water, and is the plant
   paying for it with sunlight or with the grid? */

import { h, icon, num, pill, fmtHM, fmtFull, ago, seriesColor, tagSeverity, duration, setChildren } from '../ui.js';
import { store, val, quality, buf, ctx, api, history } from '../api.js';
import { sparkline, gauge, tankLevel, meter, TimeSeriesChart, legend } from '../charts.js';
import { T, liveTile, historyCard, areaHealth, sectionTitle, readout, kv, ENERGY } from './_shared.js';

export default function overview(root) {
  const D = store.meta.design;
  const tiles = h('div', { class: 'grid g4' });
  const balance = h('div', { class: 'card' });
  const waterCard = h('div', { class: 'card' });
  const areasGrid = h('div', { class: 'grid g4' });
  const alarmHost = h('div', { class: 'card pad0' });

  root.append(
    tiles,
    h('div', { class: 'grid g2', style: { marginTop: '14px' } }, balance, waterCard),
    h('div', { style: { marginTop: '20px' } }, sectionTitle('Subsystems')),
    h('div', { style: { marginTop: '10px' } }, areasGrid),
    h('div', { style: { marginTop: '20px' } }, sectionTitle('Last 24 hours')),
    h('div', { class: 'grid g2', style: { marginTop: '10px' } },
      historyCard({ title: 'Generation vs demand', hint: 'AC power at the inverter and the site meter',
        series: [{ tag: 'EM-1008', label: 'PV generation', slot: 4 }, { tag: 'EM-1011', label: 'Site load', slot: 1 }],
        unit: 'kW', height: 220 }),
      // The five clean-water tanks are interconnected and track within a few
      // percent of each other, so charting all five is five lines saying one
      // thing. Production vs delivery is the question the level actually answers.
      historyCard({ title: 'Water produced vs delivered', hint: 'inflow to clean storage against draw-off',
        series: [{ tag: 'FT-6009', label: 'Into storage', slot: 3 }, { tag: 'FT-7001', label: 'To users', slot: 1 }],
        unit: 'm³/h', height: 220 })),
    h('div', { style: { marginTop: '20px' } }, sectionTitle('Active alarms', h('a', { class: 'btn sm ghost', href: '#alarms' }, 'Alarm journal'))),
    h('div', { style: { marginTop: '10px' } }, alarmHost));

  /* ── tiles ─────────────────────────────────────────────────────────── */
  function paintTiles() {
    const c = ctx();
    const t = tiles;
    setChildren(t,
      liveTile({ label: 'Water delivered today', tagId: 'FT-7001', unit: 'm³', slot: 1, icon: 'droplet',
        transform: () => c.m3?.deliveredToday ?? 0, precision: 2,
        meta: `design basis ${D.site.designFlowM3d} m³/day · ${D.site.population} pax` }),
      liveTile({ label: 'Clean water storage', tagId: 'LT-6001', unit: '%', slot: 3, icon: 'tank',
        transform: () => c.cleanPct ?? 0, precision: 1,
        meta: `${num((c.cleanPct ?? 0) / 100 * D.tanks.cleanEach * D.tanks.cleanCount, 2)} m³ of ${num(D.tanks.cleanEach * D.tanks.cleanCount, 1)} m³` }),
      liveTile({ label: 'PV generated today', tagId: 'EM-1008', unit: 'kWh', slot: 4, icon: 'sun',
        transform: () => c.kwh?.pvToday ?? 0, precision: 1,
        meta: `${num(val('EM-1008') ?? 0, 2)} kW now · ${num(D.pv.kWp, 1)} kWp array` }),
      liveTile({ label: 'Battery state of charge', tagId: 'QT-8004', unit: '%', slot: ENERGY.battery, icon: 'battery',
        precision: 1, meta: `${num((val('QT-8004') ?? 0) / 100 * D.battery.kWh, 2)} kWh of ${num(D.battery.kWh, 2)} kWh usable` }));
  }

  /* ── live power balance ────────────────────────────────────────────── */
  function paintBalance() {
    const c = ctx();
    const pv = c.pvAC ?? 0, load = c.load ?? 0, batt = c.battKW ?? 0, grid = c.gridKW ?? 0;
    // Day-to-date autonomy, not the instantaneous value — this pill sits above a
    // block of daily totals, and a "100 %" that flips every time a pump starts
    // would contradict the "8.9 kWh imported" line directly below it.
    const loadKWh = c.kwh?.loadToday ?? 0, impKWh = c.kwh?.importToday ?? 0;
    const autonomy = loadKWh > 0 ? Math.max(0, Math.min(100, (1 - impKWh / loadKWh) * 100)) : 100;
    // Sources are coloured; the load is the sum of them, so it stays neutral.
    const rows = [
      { key: 'pv', label: 'Solar PV', v: pv, color: seriesColor(ENERGY.solar) },
      { key: 'batt', label: batt >= 0 ? 'Battery charging' : 'Battery discharging', v: Math.abs(batt), color: seriesColor(ENERGY.battery) },
      { key: 'grid', label: grid >= 0 ? 'Grid import' : 'Grid export', v: Math.abs(grid), color: seriesColor(ENERGY.grid) },
      { key: 'load', label: 'Site load (total)', v: load, color: 'var(--text-muted)' },
    ];
    const maxV = Math.max(1, ...rows.map((r) => r.v));

    setChildren(balance,
      h('div', { class: 'card-head' },
        h('h3', {}, 'Live power balance'),
        h('span', { class: 'hint' }, 'instantaneous AC'),
        h('span', { class: 'spacer' }),
        pill(`${num(autonomy, 0)}% self-supplied today`, autonomy > 70 ? 'good' : autonomy > 40 ? 'warning' : 'serious', 'sun')),
      h('div', { style: { display: 'flex', gap: '18px', alignItems: 'center' } },
        gauge({ value: val('QT-8004') ?? 0, unit: '% SOC', size: 132, color: seriesColor(ENERGY.battery),
          sub: `${num(D.battery.kWh, 1)} kWh LiFePO₄`,
          bands: [{ from: 0, to: 22, color: 'var(--critical)' }, { from: 22, to: 40, color: 'var(--warning)' }] }),
        h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '9px' } },
          rows.map((r) => h('div', {},
            h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', fontSize: '12px' } },
              h('span', { class: 'dot', style: { background: r.color } }),
              h('span', { style: { color: 'var(--text-secondary)' } }, r.label),
              h('span', { style: { marginLeft: 'auto', fontFamily: 'var(--mono)', fontWeight: 600 } }, `${num(r.v, 2)} kW`)),
            h('div', { style: { marginTop: '4px' } }, meter({ pct: (r.v / maxV) * 100, color: r.color, height: 5 })))))),
      h('div', { style: { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border)' } },
        kv([
          ['Generated today', `${num(c.kwh?.pvToday ?? 0, 1)} kWh`],
          ['Consumed today', `${num(c.kwh?.loadToday ?? 0, 1)} kWh`],
          ['Imported from grid', `${num(c.kwh?.importToday ?? 0, 1)} kWh`],
          ['Exported to grid', `${num(c.kwh?.exportToday ?? 0, 1)} kWh`],
          ['Plane-of-array irradiance', `${num(val('JT-1001') ?? 0, 0)} W/m²`],
          ['Module temperature', `${num(val('TT-1002') ?? 0, 1)} °C`],
        ])));
  }

  /* ── water balance ─────────────────────────────────────────────────── */
  function paintWater() {
    const c = ctx();
    const cap = D.tanks.cleanEach * D.tanks.cleanCount;
    // Days of cover = water in store ÷ the design daily demand. Using today's
    // partial delivery as the denominator produced absurd figures just after
    // midnight, so the stable design basis is used instead.
    const stored = ((c.cleanPct ?? 0) / 100) * cap;
    const daysCover = stored / Math.max(0.5, D.site.designFlowM3d);
    const sev = (p) => (p < 20 ? 'critical' : p < 35 ? 'warning' : 'good');
    setChildren(waterCard,
      h('div', { class: 'card-head' },
        h('h3', {}, 'Water balance'),
        h('span', { class: 'hint' }, 'river train + rainwater harvest'),
        h('span', { class: 'spacer' }),
        pill(c.run?.['P-3001'] || c.run?.['P-3002'] ? 'Abstracting' : 'Intake idle',
          c.run?.['P-3001'] || c.run?.['P-3002'] ? 'good' : 'offline', 'river')),
      h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'space-between', flexWrap: 'wrap' } },
        tankLevel({ pct: c.rainPct ?? 0, label: 'Rainwater', sublabel: 'harvest', capacity: `${num(D.tanks.rainTotal, 1)} m³`, color: 'var(--series-3)', severity: 'good', height: 96, width: 54 }),
        tankLevel({ pct: c.sedPct ?? 0, label: 'Sediment.', sublabel: '24 h settle', capacity: `${num(D.tanks.sedimentation, 1)} m³`, color: 'var(--series-2)', severity: 'good', height: 96, width: 54 }),
        tankLevel({ pct: c.interPct ?? 0, label: 'Intermed.', sublabel: 'buffer', capacity: `${num(D.tanks.intermediate, 1)} m³`, color: 'var(--series-4)', severity: 'good', height: 96, width: 54 }),
        tankLevel({ pct: c.cleanPct ?? 0, label: 'Clean', sublabel: '5 tanks', capacity: `${num(cap, 1)} m³`, color: 'var(--series-1)', severity: sev(c.cleanPct ?? 0), height: 96, width: 54 })),
      h('div', { style: { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border)' } },
        kv([
          ['Produced today', `${num(c.m3?.producedToday ?? 0, 2)} m³`],
          ['Delivered today', `${num(c.m3?.deliveredToday ?? 0, 2)} m³`],
          ['Current demand', `${num(c.demand ?? 0, 2)} m³/h`],
          ['Storage cover', `${num(daysCover, 2)} day at design demand`],
          ['Treated turbidity', `${num(val('AIT-4005') ?? 0, 2)} NTU`],
          ['River salinity', `${num(val('AIT-3004') ?? 0, 0)} ppm`],
        ])));
  }

  /* ── subsystem cards ───────────────────────────────────────────────── */
  const AREA_KPI = {
    pv:      [['EM-1008', 'Output'], ['JT-1001', 'Irradiance']],
    rain:    [['LT-2003', 'Tank level'], ['QT-2001', 'Rainfall']],
    intake:  [['LT-3001', 'River level'], ['AIT-3002', 'Turbidity']],
    filter:  [['FT-4003', 'Filtered flow'], ['DPT-4001', 'Sand ΔP']],
    ro:      [['AIT-5005', 'Permeate TDS'], ['FT-5003', 'Permeate flow']],
    storage: [['FT-6009', 'Inlet flow'], ['AIT-6007', 'Stored TDS']],
    dist:    [['FT-7001', 'Main flow'], ['PT-7002', 'Pipe pressure']],
    bms:     [['QT-8004', 'State of charge'], ['EM-8003', 'Power']],
  };
  function paintAreas() {
    setChildren(areasGrid, ...store.meta.areas.map((a) => {
      const hlt = areaHealth(a.id);
      const isFuture = a.id === 'ro';
      const card = h('a', { class: 'card', href: `#${a.id === 'bms' ? 'bms' : a.id === 'pv' ? 'ems' : a.id === 'dist' || a.id === 'storage' || a.id === 'filter' || a.id === 'intake' || a.id === 'rain' || a.id === 'ro' ? 'water' : 'overview'}`,
        style: { textDecoration: 'none', display: 'block' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '10px' } },
          h('span', { style: { width: '26px', height: '26px', borderRadius: '7px', display: 'grid', placeItems: 'center',
            background: `color-mix(in srgb, ${seriesColor(a.accent)} 18%, transparent)`, color: seriesColor(a.accent) } }, icon(a.icon, 15)),
          h('div', { style: { minWidth: 0 } },
            h('div', { style: { fontSize: '12.5px', fontWeight: 600 } }, a.short),
            h('div', { style: { fontSize: '10.5px', color: 'var(--text-muted)' } }, `Area ${a.no}`)),
          h('span', { style: { marginLeft: 'auto' } },
            isFuture ? pill('Not installed', 'offline', 'slash')
              : pill(hlt.severity === 'good' ? 'Normal' : hlt.severity === 'critical' ? 'Critical' : 'Warning',
                hlt.severity === 'good' ? 'good' : hlt.severity, hlt.severity === 'good' ? 'check' : 'alert'))),
        ...(AREA_KPI[a.id] || []).map(([tid, lbl]) => {
          const t = T(tid); const v = val(tid); const q = quality(tid);
          return h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '12px', padding: '2.5px 0' } },
            h('span', { style: { color: 'var(--text-muted)' } }, lbl),
            h('span', { class: 'mono', style: { fontWeight: 600 } },
              q === 0 ? h('span', { class: 'muted' }, 'offline') : `${num(v, t?.precision ?? 1)} ${t?.unit || ''}`));
        }),
        h('div', { style: { marginTop: '9px', fontSize: '10.5px', color: 'var(--text-muted)' } },
          isFuture ? 'Instrumentation wired, awaiting skid' : `${hlt.online}/${hlt.total} points reporting`));
      return card;
    }));
  }

  /* ── alarms ────────────────────────────────────────────────────────── */
  async function paintAlarms() {
    let list = [];
    try { list = await api('/alarms?state=open&limit=8'); } catch { /* noop */ }
    if (!list.length) {
      alarmHost.replaceChildren(h('div', { class: 'empty' }, icon('check', 34), h('div', {}, 'No active alarms — all monitored points within limits')));
      return;
    }
    alarmHost.replaceChildren(h('div', { class: 'table-wrap', style: { maxHeight: 'none' } },
      h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Severity'), h('th', {}, 'Raised'), h('th', {}, 'Tag'), h('th', {}, 'Message'), h('th', {}, 'Duration'), h('th', {}, 'State'))),
        h('tbody', {}, list.map((a) => h('tr', { class: `alarm-row ${a.severity}` },
          h('td', {}, pill(a.severity[0].toUpperCase() + a.severity.slice(1), a.severity, 'alert')),
          h('td', { class: 'mono', style: { whiteSpace: 'nowrap' } }, fmtFull(a.raised_at)),
          h('td', {}, h('span', { class: 'tag-chip' }, a.tag)),
          h('td', {}, a.message),
          h('td', { class: 'mono' }, duration(Date.now() - a.raised_at)),
          h('td', {}, a.acked_at ? pill('Acknowledged', 'info', 'check') : pill('Unacknowledged', 'warning', 'bell'))))))));
  }

  paintTiles(); paintBalance(); paintWater(); paintAreas(); paintAlarms();
  const alarmTimer = setInterval(paintAlarms, 20000);

  return {
    onTick() { paintTiles(); paintBalance(); paintWater(); paintAreas(); },
    onAlarm: paintAlarms,
    destroy() { clearInterval(alarmTimer); },
  };
}
