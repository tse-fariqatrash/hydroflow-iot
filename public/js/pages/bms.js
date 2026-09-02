/* Battery / BMS — 16S LiFePO₄, 51.2 V 200 Ah (10.24 kWh).
   Cell-level view because pack-level numbers hide the failure that actually
   ends a lithium bank: one cell drifting away from the other fifteen. */

import { h, icon, num, pill, seriesColor, duration, setChildren } from '../ui.js';
import { store, val, ctx, buf } from '../api.js';
import { gauge, meter, sparkline, BarChart } from '../charts.js';
import { T, liveTile, historyCard, sectionTitle, readout, kv } from './_shared.js';

export default function bms(root) {
  const B = store.meta.design.battery;
  const cellIds = store.meta.cellTags;    // QT-8101 … QT-8116
  const tempIds = store.meta.tempTags;    // TT-8101 … TT-8104

  const tiles = h('div', { class: 'grid g4' });
  const packCard = h('div', { class: 'card' });
  const cellCard = h('div', { class: 'card' });
  const thermalCard = h('div', { class: 'card' });
  const healthCard = h('div', { class: 'card' });

  root.append(
    tiles,
    h('div', { class: 'grid g2', style: { marginTop: '14px' } }, packCard, thermalCard),
    h('div', { style: { marginTop: '20px' } }, sectionTitle('Cell balance — 16 series cells')),
    h('div', { style: { marginTop: '10px' } }, cellCard),
    h('div', { class: 'grid g2', style: { marginTop: '14px' } },
      historyCard({ title: 'State of charge', hint: 'coulomb counting with OCV re-calibration',
        series: [{ tag: 'QT-8004', label: 'SOC', slot: 6 }], unit: '%', height: 210, yMin: 0, yMax: 100,
        limits: [{ value: 22, label: 'Low alarm', kind: 'warning' }, { value: 15, label: 'Critical', kind: 'critical' }] }),
      historyCard({ title: 'Cell imbalance', hint: 'spread between the highest and lowest of 16 cells',
        series: [{ tag: 'QT-8007', label: 'Cell imbalance', slot: 5 }], unit: 'mV', height: 210,
        limits: [{ value: 50, label: 'Balance warning', kind: 'warning' }, { value: 120, label: 'Balance critical', kind: 'critical' }] })),
    h('div', { style: { marginTop: '20px' } }, sectionTitle('Health & duty')),
    h('div', { style: { marginTop: '10px' } }, healthCard));

  function paintTiles() {
    const soc = val('QT-8004') ?? 0, soh = val('QT-8005') ?? 0;
    const p = val('EM-8003') ?? 0, cyc = val('QT-8008') ?? 0;
    setChildren(tiles,
      liveTile({ label: 'State of charge', tagId: 'QT-8004', unit: '%', slot: 6, icon: 'battery', precision: 1,
        meta: `${num((soc / 100) * B.kWh, 2)} kWh stored · ${num(B.usableKWh, 1)} kWh usable`, limitHi: null }),
      liveTile({ label: 'Pack power', tagId: 'EM-8003', unit: 'kW', slot: 5, icon: 'zap', precision: 2,
        meta: p > 0.02 ? 'Charging' : p < -0.02 ? 'Discharging' : 'Idle / float' }),
      liveTile({ label: 'State of health', tagId: 'QT-8005', unit: '%', slot: 3, icon: 'activity', precision: 1,
        meta: `${num((soh / 100) * B.ah, 0)} Ah effective of ${B.ah} Ah nameplate` }),
      liveTile({ label: 'Equivalent full cycles', tagId: 'QT-8008', unit: 'cyc', slot: 1, icon: 'refresh', precision: 0,
        meta: `${num((cyc / B.designCycles) * 100, 1)} % of ${num(B.designCycles, 0)}-cycle design life` }));
  }

  function paintPack() {
    const soc = val('QT-8004') ?? 0;
    const p = val('EM-8003') ?? 0;
    const i = val('EM-8002') ?? 0;
    // Time to empty at the present discharge rate, or to full at the charge rate.
    let eta = null, etaLabel = '';
    if (p < -0.05) { eta = ((soc - 25) / 100) * B.kWh / -p * 3600e3; etaLabel = 'to 25 % reserve'; }
    else if (p > 0.05) { eta = ((96 - soc) / 100) * B.kWh / p * 3600e3; etaLabel = 'to 96 % full'; }
    setChildren(packCard,
      h('div', { class: 'card-head' }, h('h3', {}, 'Pack status'),
        h('span', { class: 'hint' }, `${B.chemistry} · ${B.cells}S · ${B.nominalV} V ${B.ah} Ah`),
        h('span', { class: 'spacer' }),
        pill(p > 0.02 ? 'Charging' : p < -0.02 ? 'Discharging' : 'Idle', p > 0.02 ? 'good' : p < -0.02 ? 'info' : 'offline', 'battery')),
      h('div', { style: { display: 'flex', gap: '18px', alignItems: 'center' } },
        gauge({ value: soc, unit: '% SOC', size: 152, color: soc < 22 ? 'var(--critical)' : soc < 40 ? 'var(--warning)' : 'var(--series-6)',
          sub: eta ? `${duration(Math.max(0, eta))} ${etaLabel}` : 'steady',
          bands: [{ from: 0, to: 15, color: 'var(--critical)' }, { from: 15, to: 22, color: 'var(--warning)' }, { from: 96, to: 100, color: 'var(--series-1)' }] }),
        h('div', { style: { flex: 1, minWidth: 0 } },
          kv([
            ['Pack voltage', `${num(val('EM-8001'), 2)} V`],
            ['Pack current', `${num(i, 2)} A`],
            ['Pack power', `${num(p, 2)} kW`],
            ['Average cell', `${num((val('EM-8001') ?? 0) / B.cells, 3)} V`],
            ['Cell imbalance', `${num(val('QT-8007'), 0)} mV`],
            ['Max cell temp', `${num(val('TT-8006'), 1)} °C`],
            ['Charge limit', `${B.maxChargeA} A (${num(B.maxChargeA * B.nominalV / 1000, 1)} kW)`],
            ['Discharge limit', `${B.maxDischargeA} A (${num(B.maxDischargeA * B.nominalV / 1000, 1)} kW)`],
          ]))));
  }

  function paintCells() {
    const vals = cellIds.map((id) => ({ id, v: val(id) ?? 0 }));
    const lo = Math.min(...vals.map((c) => c.v)), hi = Math.max(...vals.map((c) => c.v));
    const avg = vals.reduce((a, c) => a + c.v, 0) / vals.length;
    const spread = (hi - lo) * 1000;
    const t = T(cellIds[0]) || { alarm: {} };

    setChildren(cellCard,
      h('div', { class: 'card-head' },
        h('h3', {}, 'Cell voltages'),
        h('span', { class: 'hint' }, `min ${num(lo, 3)} V · avg ${num(avg, 3)} V · max ${num(hi, 3)} V`),
        h('span', { class: 'spacer' }),
        pill(`${num(spread, 0)} mV spread`, spread > 120 ? 'critical' : spread > 50 ? 'warning' : 'good', spread > 50 ? 'alert' : 'check')),
      h('div', { class: 'cellgrid' }, vals.map((c, i) => {
        const isHi = c.v >= hi - 0.0005 && spread > 4;
        const isLo = c.v <= lo + 0.0005 && spread > 4;
        // Bar is the cell's position within the pack's own min→max window, so a
        // 10 mV spread is as readable as a 100 mV one.
        const frac = hi > lo ? (c.v - lo) / (hi - lo) : 0.5;
        return h('div', { class: `cell ${isHi ? 'hi' : ''} ${isLo ? 'lo' : ''}`, title: `${c.id} — cell ${i + 1}` },
          h('div', { class: 'cid' }, `CELL ${String(i + 1).padStart(2, '0')}`),
          h('div', { class: 'cv' }, num(c.v, 3), h('span', { style: { fontSize: '9.5px', color: 'var(--text-muted)', marginLeft: '2px' } }, 'V')),
          h('div', { class: 'bar' }, h('i', { style: { width: `${Math.max(4, frac * 100)}%`,
            background: isHi ? 'var(--warning)' : isLo ? 'var(--series-1)' : 'var(--series-6)' } })));
      })),
      h('div', { class: 'footnote', style: { marginTop: '12px' } },
        `Bars show each cell's position within the pack's present ${num(spread, 0)} mV window, not its absolute voltage — the point is the spread, not the level. `,
        `Highest cell highlighted amber, lowest blue. Alarm limits: ${t.alarm?.l ?? '—'} V low, ${t.alarm?.h ?? '—'} V high. `,
        'The passive balancer only bleeds charge above 96 % SOC, which is why the spread widens through a discharge and closes at the top of a charge.'));
  }

  function paintThermal() {
    const temps = tempIds.map((id, i) => ({ id, i, v: val(id) ?? 0, name: T(id)?.name || id }));
    const maxT = Math.max(...temps.map((t) => t.v));
    const ambient = ctx().ambient ?? 28;
    const sev = maxT > 55 ? 'critical' : maxT > 45 ? 'warning' : 'good';
    setChildren(thermalCard,
      h('div', { class: 'card-head' }, h('h3', {}, 'Thermal map'), h('span', { class: 'hint' }, '4 NTC probes across the pack'),
        h('span', { class: 'spacer' }), pill(sev === 'good' ? 'Normal' : sev === 'warning' ? 'Elevated' : 'Over-temperature', sev, sev === 'good' ? 'check' : 'alert')),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '11px' } },
        temps.map((t) => h('div', {},
          h('div', { style: { display: 'flex', alignItems: 'baseline', fontSize: '12px', marginBottom: '4px' } },
            h('span', { class: 'dot', style: { background: t.v > 45 ? 'var(--warning)' : 'var(--series-1)', marginRight: '7px' } }),
            h('span', { style: { color: 'var(--text-secondary)' } }, `Probe ${t.i + 1}`),
            h('span', { style: { marginLeft: 'auto', fontFamily: 'var(--mono)', fontWeight: 600 } }, `${num(t.v, 1)} °C`)),
          // All four probes measure the same quantity, so they share one colour —
          // four hues here would imply four different things. 0–60 °C scale on
          // every bar so they are directly comparable against the 45 °C limit.
          meter({ pct: (t.v / 60) * 100, color: t.v > 45 ? 'var(--warning)' : 'var(--series-1)', height: 5 })))),
      h('div', { style: { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border)' } },
        kv([
          ['Ambient (est.)', `${num(ambient, 1)} °C`],
          ['Rise above ambient', `${num(maxT - ambient, 1)} K`],
          ['Warning limit', '45 °C'],
          ['Critical limit', '55 °C'],
          ['LiFePO₄ charge window', '0 – 45 °C'],
        ])),
      h('div', { class: 'footnote', style: { marginTop: '10px' } },
        'Scale is 0–60 °C on every probe so they can be compared directly. Tanjung Manis runs 26–33 °C ambient year round, so the pack has little thermal headroom — the enclosure ventilation is the item to check first if the rise above ambient climbs past ~12 K.'));
  }

  function paintHealth() {
    const cyc = val('QT-8008') ?? 0, soh = val('QT-8005') ?? 0;
    const c = ctx();
    const cycPerDay = 0.6;                                  // observed duty from the daily ledger
    const yearsLeft = soh > 80 ? ((soh - 80) / Math.max(0.001, (100 - soh))) * (cyc / Math.max(1, cycPerDay * 365)) : 0;
    setChildren(healthCard,
      h('div', { class: 'card-head' }, h('h3', {}, 'Health & duty'),
        h('span', { class: 'hint' }, 'capacity fade against the 6 000-cycle design life')),
      h('div', { class: 'grid g3' },
        h('div', {},
          h('div', { class: 'label', style: { fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600 } }, 'Design life used'),
          h('div', { class: 'hero', style: { fontSize: '30px', marginTop: '4px' } }, `${num((cyc / 6000) * 100, 1)}%`),
          h('div', { style: { marginTop: '10px' } }, meter({ pct: (cyc / 6000) * 100, color: 'var(--series-1)' })),
          h('div', { class: 'meta', style: { marginTop: '6px', fontSize: '11.5px', color: 'var(--text-muted)' } }, `${num(cyc, 0)} of 6 000 equivalent full cycles`)),
        h('div', {},
          h('div', { class: 'label', style: { fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600 } }, 'Capacity retained'),
          h('div', { class: 'hero', style: { fontSize: '30px', marginTop: '4px' } }, `${num(soh, 1)}%`),
          h('div', { style: { marginTop: '10px' } }, meter({ pct: soh, color: soh > 85 ? 'var(--good)' : soh > 75 ? 'var(--warning)' : 'var(--critical)' })),
          h('div', { class: 'meta', style: { marginTop: '6px', fontSize: '11.5px', color: 'var(--text-muted)' } }, 'End-of-life convention: 80 % of nameplate')),
        h('div', {},
          h('div', { class: 'label', style: { fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600 } }, 'Energy cycled today'),
          h('div', { class: 'hero', style: { fontSize: '30px', marginTop: '4px' } }, `${num((c.kwh?.chgToday ?? 0) + (c.kwh?.dschToday ?? 0), 1)}`,
            h('span', { style: { fontSize: '14px', color: 'var(--text-secondary)', marginLeft: '4px' } }, 'kWh')),
          h('div', { class: 'meta', style: { marginTop: '10px', fontSize: '11.5px', color: 'var(--text-muted)' } },
            `${num(c.kwh?.chgToday ?? 0, 1)} kWh in · ${num(c.kwh?.dschToday ?? 0, 1)} kWh out`),
          h('div', { class: 'meta', style: { fontSize: '11.5px', color: 'var(--text-muted)' } },
            `≈ ${num(((c.kwh?.dschToday ?? 0) / store.meta.design.battery.kWh), 2)} equivalent cycles today`))),
      h('div', { class: 'footnote', style: { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border)' } },
        'State of health here is modelled from cumulative throughput, not measured by a capacity test. A real SOH figure needs a full controlled discharge; schedule one annually and record it against this trend so the model can be corrected.'));
  }

  const paint = () => { paintTiles(); paintPack(); paintCells(); paintThermal(); paintHealth(); };
  paint();
  return { onTick: paint };
}
