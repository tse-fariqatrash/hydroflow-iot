/* Process Mimic — the plant as one picture.
   Every number on this screen is a live tag; every animated pipe means a pump
   is actually running. Clicking a vessel opens its point list. */

import { h, icon, num, pill, seriesColor, tagSeverity, formatTagValue, fmtHM, setChildren } from '../ui.js';
import { store, val, quality, ctx } from '../api.js';
import { T, readout, kv } from './_shared.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, props, ...kids) => h(tag, props, ...kids);

export default function mimic(root) {
  const D = store.meta.design;
  const wrap = h('div', { class: 'mimic-wrap' });
  const detail = h('div', { class: 'card', style: { marginTop: '14px' } });
  const legendBar = h('div', { class: 'card', style: { marginBottom: '14px', padding: '11px 16px' } });

  root.append(legendBar, wrap, detail);

  let selected = 'clean';

  /* ── drawing primitives ────────────────────────────────────────────── */
  const label = (x, y, text, anchor = 'middle') => s('text', { class: 'vessel-label', x, y, 'text-anchor': anchor }, text);

  /** A live numeric readout anchored at (x,y). */
  function readoutBlock(x, y, tagId, { anchor = 'start', showTag = true } = {}) {
    const t = T(tagId);
    if (!t) return s('g');
    const v = val(tagId), q = quality(tagId);
    const sev = q === 0 ? 'offline' : tagSeverity(t, v, store.values);
    const color = sev === 'good' ? 'var(--text-primary)' : `var(--${sev})`;
    const g = s('g', { transform: `translate(${x},${y})` });
    if (showTag) g.appendChild(s('text', { class: 'readout-tag', x: 0, y: -9, 'text-anchor': anchor }, t.id));
    const line = s('text', { class: 'readout', x: 0, y: 0, 'text-anchor': anchor, fill: color },
      q === 0 ? '—' : formatTagValue(t, v));
    line.appendChild(s('tspan', { class: 'readout-unit', dx: 3 }, t.unit || ''));
    g.appendChild(line);
    g.appendChild(s('title', {}, `${t.id} — ${t.name}`));
    return g;
  }

  /** Rounded vessel with a fill level driven by a percentage tag. */
  function tank(x, y, w, hh, pctTag, name, capacity, slot, key) {
    const pct = Math.max(0, Math.min(100, val(pctTag) ?? 0));
    const t = T(pctTag);
    const sev = t ? tagSeverity(t, val(pctTag), store.values) : 'good';
    const col = sev === 'critical' ? 'var(--critical)' : sev === 'warning' ? 'var(--warning)' : seriesColor(slot);
    const fh = (hh - 6) * (pct / 100);
    const g = s('g', { class: 'hotspot', onclick: () => select(key) });
    g.appendChild(s('rect', { class: 'vessel', x, y, width: w, height: hh, rx: 7 }));
    g.appendChild(s('rect', { x: x + 3, y: y + hh - 3 - fh, width: w - 6, height: fh, rx: 4, fill: col, opacity: .55 }));
    g.appendChild(s('line', { x1: x + 1.5, x2: x + w - 1.5, y1: y + hh - 3 - fh, y2: y + hh - 3 - fh, stroke: col, 'stroke-width': 2 }));
    g.appendChild(s('text', { x: x + w / 2, y: y + hh / 2 + 4, 'text-anchor': 'middle', class: 'readout', 'font-size': 13,
      style: 'paint-order:stroke;stroke:var(--surface-sunk);stroke-width:3px' }, `${num(pct, 0)}%`));
    g.appendChild(label(x + w / 2, y - 8, name));
    if (capacity) g.appendChild(s('text', { class: 'readout-tag', x: x + w / 2, y: y + hh + 12, 'text-anchor': 'middle' }, capacity));
    return g;
  }

  /** Pump symbol — circle + triangle, filled when running. */
  function pump(x, y, runTag, name, key) {
    const running = (val(runTag) ?? 0) > 0.5;
    const col = running ? 'var(--good)' : 'var(--offline)';
    const g = s('g', { class: 'hotspot', onclick: () => select(key || 'pumps') });
    g.appendChild(s('circle', { cx: x, cy: y, r: 15, fill: running ? 'color-mix(in srgb, var(--good) 20%, var(--surface-2))' : 'var(--surface-2)',
      stroke: col, 'stroke-width': 1.8, class: running ? 'pulsing' : '' }));
    g.appendChild(s('path', { d: `M${x - 5},${y - 6}L${x + 7},${y}L${x - 5},${y + 6}Z`, fill: col }));
    g.appendChild(label(x, y + 29, name));
    g.appendChild(s('title', {}, `${name} — ${running ? 'RUNNING' : 'STOPPED'}`));
    return g;
  }

  /** Static pipe plus an animated flow overlay when `flowing`. */
  function pipe(d, flowing, slot = 1, dashed = false) {
    const g = s('g');
    g.appendChild(s('path', { class: 'pipe', d, 'stroke-dasharray': dashed ? '6 6' : null, opacity: dashed ? .5 : 1 }));
    if (flowing) g.appendChild(s('path', { class: 'pipe-flow on', d, stroke: seriesColor(slot) }));
    return g;
  }

  function box(x, y, w, hh, title, key, { dashed = false, accent = 1 } = {}) {
    const g = s('g', { class: 'hotspot', onclick: () => select(key) });
    g.appendChild(s('rect', { class: 'vessel', x, y, width: w, height: hh, rx: 7,
      'stroke-dasharray': dashed ? '5 4' : null, opacity: dashed ? .6 : 1 }));
    g.appendChild(label(x + w / 2, y - 8, title));
    return g;
  }

  /* ── the diagram ───────────────────────────────────────────────────── */
  /* Layout is on a fixed 1220 × 780 grid with three horizontal bands.
     Y positions are declared per element rather than derived, so a label can
     never end up on top of a readout when a value changes width. */
  function draw() {
    const c = ctx();
    const W = 1220, H = 780;
    const svg = s('svg', { class: 'mimic', viewBox: `0 0 ${W} ${H}`, width: W, height: H });

    const runIntake = (val('ZS-3008') ?? 0) > .5 || (val('ZS-3009') ?? 0) > .5;
    const runFilt = (val('ZS-4009') ?? 0) > .5;
    const runRain = (val('ZS-2006') ?? 0) > .5;
    const polishing = (val('FT-6009') ?? 0) > 0.02;
    const distFlowing = (val('FT-7001') ?? 0) > 0.005;
    const pvOn = (val('EM-1008') ?? 0) > 0.05;

    const band = (y, text) => s('g', {},
      s('text', { x: 18, y, class: 'vessel-label', 'text-anchor': 'start', 'font-size': 10.5, fill: 'var(--text-muted)' }, text),
      s('line', { x1: 18, x2: W - 18, y1: y + 7, y2: y + 7, stroke: 'var(--grid)', 'stroke-width': 1 }));

    /* ══ BAND 1 — ELECTRICAL (y 20 … 230) ═════════════════════════════ */
    svg.appendChild(band(20, 'ELECTRICAL — 7 kWp PV · 8 kW HYBRID INVERTER · 10.24 kWh LiFePO₄'));

    // PV array
    const arr = s('g', { class: 'hotspot', onclick: () => select('pv') });
    for (let r = 0; r < 2; r++) for (let i = 0; i < 7; i++) {
      arr.appendChild(s('rect', { x: 42 + i * 17, y: 62 + r * 24, width: 14, height: 20, rx: 2,
        fill: pvOn ? 'color-mix(in srgb, var(--series-4) 55%, var(--surface-2))' : 'var(--surface-3)',
        stroke: 'var(--baseline)', 'stroke-width': .8 }));
    }
    arr.appendChild(label(102, 54, 'PV ARRAY 14 × 500 Wp'));
    arr.appendChild(s('text', { class: 'readout-tag', x: 102, y: 124, 'text-anchor': 'middle' }, '2 strings × 7 · tilt 25°'));
    svg.appendChild(arr);
    svg.appendChild(readoutBlock(102, 152, 'JT-1001', { anchor: 'middle' }));
    svg.appendChild(readoutBlock(102, 190, 'TT-1002', { anchor: 'middle' }));

    // Inverter
    svg.appendChild(pipe('M170,84 H236', pvOn, 4));
    svg.appendChild(box(238, 56, 96, 58, 'HYBRID INVERTER', 'pv'));
    svg.appendChild(readoutBlock(286, 88, 'EM-1008', { anchor: 'middle', showTag: false }));
    svg.appendChild(s('text', { class: 'readout-tag', x: 286, y: 106, 'text-anchor': 'middle' }, '8 kW · dual MPPT'));

    // Battery
    svg.appendChild(pipe('M286,114 V158', Math.abs(c.battKW ?? 0) > 0.02, 6));
    svg.appendChild(box(238, 160, 96, 52, 'BATTERY 51.2 V / 200 Ah', 'bms'));
    svg.appendChild(readoutBlock(286, 190, 'QT-8004', { anchor: 'middle', showTag: false }));

    // Main distribution board
    svg.appendChild(pipe('M336,84 H406', true, 1));
    svg.appendChild(box(408, 50, 108, 76, 'MAIN DISTRIBUTION BOARD', 'mdb'));
    svg.appendChild(readoutBlock(462, 84, 'EM-1011', { anchor: 'middle', showTag: false }));
    svg.appendChild(s('text', { class: 'readout-tag', x: 462, y: 102, 'text-anchor': 'middle' }, 'backup + normal loads'));
    svg.appendChild(s('text', { class: 'readout-tag', x: 462, y: 116, 'text-anchor': 'middle' }, `${num(val('EM-1013') ?? 0, 0)} V · ${num(val('EM-1012') ?? 0, 2)} Hz`));

    // Utility grid
    const importing = (c.gridKW ?? 0) > 0.02;
    svg.appendChild(pipe('M518,70 H602', Math.abs(c.gridKW ?? 0) > 0.02, 7));
    svg.appendChild(box(604, 46, 96, 48, 'UTILITY GRID', 'grid'));
    svg.appendChild(readoutBlock(652, 76, 'EM-1010', { anchor: 'middle', showTag: false }));
    svg.appendChild(s('text', { class: 'readout-tag', x: 652, y: 106, 'text-anchor': 'middle' },
      importing ? 'importing' : (c.gridKW ?? 0) < -0.02 ? 'exporting' : 'idle'));

    // School loads
    svg.appendChild(pipe('M518,104 V132 H602', true, 1));
    svg.appendChild(box(604, 118, 96, 46, 'SCHOOL LOADS', 'loads'));
    svg.appendChild(s('text', { class: 'readout', x: 652, y: 147, 'text-anchor': 'middle' },
      `${num(c.schoolKW ?? 0, 2)}`, s('tspan', { class: 'readout-unit', dx: 3 }, 'kW')));

    // Plant pump loads
    svg.appendChild(pipe('M462,126 V200 H556', (c.pumpKW ?? 0) > 0.05, 2));
    svg.appendChild(box(558, 178, 142, 46, 'PLANT PUMP LOADS', 'pumps'));
    svg.appendChild(s('text', { class: 'readout', x: 629, y: 207, 'text-anchor': 'middle' },
      `${num(c.pumpKW ?? 0, 2)}`, s('tspan', { class: 'readout-unit', dx: 3 }, 'kW')));

    // Today panel
    svg.appendChild(s('rect', { x: 748, y: 38, width: 454, height: 186, rx: 8, fill: 'var(--surface-1)', stroke: 'var(--border)' }));
    svg.appendChild(s('text', { x: 776, y: 60, class: 'vessel-label', 'text-anchor': 'start' }, 'TODAY — SINCE LOCAL MIDNIGHT'));
    // Plain label/value rows: eight different hues here would imply eight
    // series, and two of them would have to repeat a slot.
    const stats = [
      ['PV generated', `${num(c.kwh?.pvToday ?? 0, 1)} kWh`],
      ['Site consumption', `${num(c.kwh?.loadToday ?? 0, 1)} kWh`],
      ['Grid import', `${num(c.kwh?.importToday ?? 0, 1)} kWh`],
      ['Grid export', `${num(c.kwh?.exportToday ?? 0, 1)} kWh`],
      ['Battery charged', `${num(c.kwh?.chgToday ?? 0, 1)} kWh`],
      ['Battery discharged', `${num(c.kwh?.dschToday ?? 0, 1)} kWh`],
      ['Water produced', `${num(c.m3?.producedToday ?? 0, 2)} m³`],
      ['Water delivered', `${num(c.m3?.deliveredToday ?? 0, 2)} m³`],
    ];
    stats.forEach(([k, v], i) => {
      const cx = 776 + (i % 2) * 220, cy = 90 + Math.floor(i / 2) * 32;
      svg.appendChild(s('text', { x: cx, y: cy, class: 'readout-unit', 'font-size': 11, fill: 'var(--text-secondary)' }, k));
      svg.appendChild(s('text', { x: cx + 196, y: cy, class: 'readout', 'text-anchor': 'end' }, v));
      if (i < stats.length - 2) {
        svg.appendChild(s('line', { x1: cx, x2: cx + 196, y1: cy + 10, y2: cy + 10, stroke: 'var(--grid)', 'stroke-width': 1 }));
      }
    });

    /* ══ BAND 2 — TREATMENT TRAIN (y 250 … 470) ═══════════════════════ */
    svg.appendChild(band(250, 'RIVER WATER TREATMENT TRAIN — BELAWAI RIVER INTAKE TO CLEAN STORAGE'));
    const TOP = 300, BOT = 396;          // vessel top / bottom
    const MID = 344;                     // pipe centreline

    // River — the water surface rises and falls with the live tide reading
    const riverG = s('g', { class: 'hotspot', onclick: () => select('intake') });
    const tideFrac = Math.max(0, Math.min(1, ((val('LT-3001') ?? 2.5) - 0.35) / (5.4 - 0.35)));
    const surface = BOT - 12 - tideFrac * 74;
    riverG.appendChild(s('rect', { x: 30, y: 288, width: 118, height: BOT - 288, rx: 4, fill: 'var(--surface-sunk)', stroke: 'var(--baseline)', 'stroke-width': 1.2 }));
    riverG.appendChild(s('rect', { x: 31.5, y: surface, width: 115, height: BOT - surface - 1.5, rx: 3,
      fill: 'color-mix(in srgb, var(--series-1) 32%, var(--surface-2))' }));
    riverG.appendChild(s('line', { x1: 31.5, x2: 146.5, y1: surface, y2: surface, stroke: 'var(--series-1)', 'stroke-width': 2 }));
    for (let i = 0; i < 2; i++) {
      riverG.appendChild(s('path', { d: `M36,${surface + 12 + i * 13} q13,-4 26,0 t26,0 t26,0`, class: 'pipe-flow on',
        stroke: 'var(--series-1)', 'stroke-width': 1.4, 'stroke-dasharray': '5 7', opacity: .5, fill: 'none' }));
    }
    // jetty deck + legs
    riverG.appendChild(s('rect', { x: 58, y: 294, width: 62, height: 6, rx: 2, fill: 'var(--surface-3)', stroke: 'var(--baseline)', 'stroke-width': .9 }));
    riverG.appendChild(s('line', { x1: 66, x2: 66, y1: 300, y2: BOT - 2, stroke: 'var(--baseline)', 'stroke-width': 1.4 }));
    riverG.appendChild(s('line', { x1: 112, x2: 112, y1: 300, y2: BOT - 2, stroke: 'var(--baseline)', 'stroke-width': 1.4 }));
    riverG.appendChild(label(89, 284, 'BELAWAI RIVER · INTAKE JETTY'));
    riverG.appendChild(s('title', {}, 'Tidal river — flood ≈13:00, ebb ≈21:00. Jetty height varies 0.5–5 m with the tide.'));
    svg.appendChild(riverG);
    svg.appendChild(readoutBlock(89, 424, 'LT-3001', { anchor: 'middle' }));
    svg.appendChild(readoutBlock(89, 460, 'AIT-3004', { anchor: 'middle' }));

    svg.appendChild(pipe(`M148,${MID} H178`, runIntake, 1));
    svg.appendChild(pump(198, MID, 'ZS-3008', 'P-3001/2 · 3 HP', 'intake'));
    svg.appendChild(pipe(`M218,${MID} H252`, runIntake, 1));

    // Sedimentation
    svg.appendChild(tank(254, TOP, 76, BOT - TOP, 'LT-3010', 'SEDIMENTATION', '12.5 m³ · 24 h settle', 2, 'sed'));
    svg.appendChild(readoutBlock(292, 444, 'AIT-3002', { anchor: 'middle' }));

    svg.appendChild(pipe(`M330,${MID} H358`, runFilt, 2));
    svg.appendChild(pump(378, MID, 'ZS-4009', 'P-4001 · 1.5 HP', 'filter'));
    svg.appendChild(pipe(`M398,${MID} H428`, runFilt, 2));

    // Sand filtration ×3
    const sandG = s('g', { class: 'hotspot', onclick: () => select('filter') });
    for (let i = 0; i < 3; i++) {
      sandG.appendChild(s('rect', { class: 'vessel', x: 430 + i * 26, y: TOP + 6, width: 20, height: 74, rx: 9 }));
      sandG.appendChild(s('rect', { x: 433 + i * 26, y: TOP + 34, width: 14, height: 43, rx: 4,
        fill: 'color-mix(in srgb, var(--series-4) 45%, transparent)' }));
    }
    sandG.appendChild(label(469, TOP - 8, 'SAND FILTRATION ×3'));
    svg.appendChild(sandG);
    svg.appendChild(readoutBlock(469, 412, 'DPT-4001', { anchor: 'middle' }));
    svg.appendChild(s('text', { class: 'readout-tag', x: 469, y: 432, 'text-anchor': 'middle' },
      `media loading ${num((c.foulSand ?? 0) * 100, 0)}%`));

    svg.appendChild(pipe(`M508,${MID} H540`, runFilt, 2));
    // Intermediate storage
    svg.appendChild(tank(542, TOP, 74, BOT - TOP, 'LT-4007', 'INTERMEDIATE', '10 m³ buffer', 4, 'inter'));
    svg.appendChild(readoutBlock(579, 444, 'FT-4003', { anchor: 'middle' }));

    svg.appendChild(pipe(`M616,${MID} H648`, polishing, 3));
    // Multimedia filtration ×4
    const mmfG = s('g', { class: 'hotspot', onclick: () => select('filter') });
    for (let i = 0; i < 4; i++) {
      mmfG.appendChild(s('rect', { class: 'vessel', x: 650 + i * 25, y: TOP + 6, width: 19, height: 74, rx: 9 }));
      mmfG.appendChild(s('rect', { x: 653 + i * 25, y: TOP + 30, width: 13, height: 47, rx: 4,
        fill: 'color-mix(in srgb, var(--series-3) 45%, transparent)' }));
    }
    mmfG.appendChild(label(700, TOP - 8, 'MULTIMEDIA FILTRATION ×4'));
    svg.appendChild(mmfG);
    svg.appendChild(readoutBlock(700, 412, 'DPT-4002', { anchor: 'middle' }));
    svg.appendChild(readoutBlock(700, 448, 'AIT-4005', { anchor: 'middle' }));

    svg.appendChild(pipe(`M748,${MID} H788`, polishing, 3));
    // Clean water storage ×5
    for (let i = 0; i < 5; i++) {
      svg.appendChild(tank(790 + i * 52, TOP, 44, BOT - TOP, `LT-600${i + 1}`, `T${i + 1}`, null, 1, 'clean'));
    }
    svg.appendChild(label(918, TOP - 26, 'CLEAN WATER STORAGE — 5 × 600 GAL (11.4 m³)'));
    svg.appendChild(readoutBlock(848, 424, 'FT-6009', { anchor: 'middle' }));
    svg.appendChild(readoutBlock(992, 424, 'AIT-6007', { anchor: 'middle' }));

    /* ══ BAND 3 — RAIN / RO / DISTRIBUTION (y 490 … 770) ══════════════ */
    svg.appendChild(band(490, 'RAINWATER HARVESTING · DESALINATION (FUTURE SCOPE) · DISTRIBUTION'));

    // Roof catchment
    const rainOn = (val('QT-2001') ?? 0) > 0.1;
    const roofG = s('g', { class: 'hotspot', onclick: () => select('rain') });
    roofG.appendChild(s('path', { d: 'M36,594 L94,562 L152,594 Z', fill: 'var(--surface-3)', stroke: 'var(--baseline)', 'stroke-width': 1.4 }));
    roofG.appendChild(s('rect', { x: 36, y: 594, width: 116, height: 6, rx: 2, fill: 'var(--surface-2)', stroke: 'var(--baseline)', 'stroke-width': .9 }));
    if (rainOn) for (let i = 0; i < 6; i++) {
      roofG.appendChild(s('line', { x1: 44 + i * 19, x2: 40 + i * 19, y1: 526, y2: 542,
        stroke: 'var(--series-1)', 'stroke-width': 1.6, 'stroke-linecap': 'round', opacity: .75, class: 'pulsing' }));
    }
    roofG.appendChild(label(94, 554, '120 m² ROOF CATCHMENT'));
    svg.appendChild(roofG);
    svg.appendChild(readoutBlock(94, 630, 'QT-2001', { anchor: 'middle' }));
    svg.appendChild(readoutBlock(94, 666, 'FT-2002', { anchor: 'middle' }));

    svg.appendChild(pipe('M152,597 H188', rainOn, 3));
    svg.appendChild(tank(190, 556, 70, 82, 'LT-2003', 'RAIN TANKS', '5 × 600 gal · 11.4 m³', 3, 'rain'));
    svg.appendChild(pipe('M260,597 H292', runRain, 3));
    svg.appendChild(pump(312, 597, 'ZS-2006', 'P-2001 · 1 HP', 'rain'));
    // harvested water routes over the top of the band into clean storage
    svg.appendChild(pipe(`M332,597 H392 V524 H848 V${BOT + 4}`, runRain, 3));
    svg.appendChild(s('text', { class: 'readout-tag', x: 404, y: 518, 'text-anchor': 'start' }, 'harvested water joins clean storage'));

    // RO skid (future scope)
    const roG = s('g', { class: 'hotspot', onclick: () => select('ro'), opacity: .6 });
    roG.appendChild(s('rect', { class: 'vessel', x: 540, y: 560, width: 208, height: 76, rx: 7, 'stroke-dasharray': '5 4' }));
    for (let i = 0; i < 3; i++) roG.appendChild(s('rect', { x: 556, y: 572 + i * 20, width: 176, height: 12, rx: 6, fill: 'var(--surface-3)', stroke: 'var(--baseline)', 'stroke-width': .8 }));
    roG.appendChild(label(644, 552, 'DESALINATION / RO SKID'));
    svg.appendChild(roG);
    svg.appendChild(s('rect', { x: 540, y: 648, width: 208, height: 20, rx: 10,
      fill: 'color-mix(in srgb, var(--offline) 16%, transparent)', stroke: 'var(--offline)', 'stroke-width': 1, 'stroke-dasharray': '4 3' }));
    svg.appendChild(s('text', { x: 644, y: 662, 'text-anchor': 'middle', class: 'readout-unit', 'font-size': 9.5, fill: 'var(--text-muted)' },
      'OUT OF SCOPE — INSTRUMENTATION WIRED'));
    svg.appendChild(pipe('M748,597 H796', false, 5, true));

    // Booster + distribution
    svg.appendChild(pipe(`M918,${BOT + 4} V600 H948`, distFlowing, 1));
    svg.appendChild(pump(968, 600, 'ZS-7006', 'P-6001 · 2 HP', 'dist'));
    svg.appendChild(readoutBlock(968, 648, 'PT-7002', { anchor: 'middle' }));
    svg.appendChild(pipe('M988,600 H1016', distFlowing, 1));

    // School branch
    const homeG = s('g', { class: 'hotspot', onclick: () => select('dist') });
    homeG.appendChild(s('path', { d: 'M1056,552 l26,-20 l26,20 z', fill: 'var(--surface-3)', stroke: 'var(--baseline)', 'stroke-width': 1.2 }));
    homeG.appendChild(s('rect', { class: 'vessel', x: 1060, y: 552, width: 44, height: 32, rx: 2 }));
    homeG.appendChild(label(1082, 526, 'SK BAYANG DARO'));
    // Longhouse branch
    homeG.appendChild(s('path', { d: 'M1052,672 l30,-19 l30,19 z', fill: 'var(--surface-3)', stroke: 'var(--baseline)', 'stroke-width': 1.2 }));
    homeG.appendChild(s('rect', { class: 'vessel', x: 1056, y: 672, width: 52, height: 30, rx: 2 }));
    homeG.appendChild(label(1082, 726, '9 LONGHOUSES · 100 PAX'));
    svg.appendChild(homeG);
    svg.appendChild(pipe('M1016,600 V568 H1058', distFlowing, 1));
    svg.appendChild(pipe('M1016,600 V688 H1054', distFlowing, 2));
    svg.appendChild(readoutBlock(1150, 570, 'FT-7003', { anchor: 'middle' }));
    svg.appendChild(readoutBlock(1150, 690, 'FT-7004', { anchor: 'middle' }));

    // Leak banner
    const leak = (val('XS-7005') ?? 0) > .5;
    if (leak) {
      svg.appendChild(s('rect', { x: 940, y: 742, width: 250, height: 22, rx: 11,
        fill: 'color-mix(in srgb, var(--critical) 22%, transparent)', stroke: 'var(--critical)' }));
      svg.appendChild(s('text', { x: 1065, y: 757, 'text-anchor': 'middle', class: 'readout', fill: 'var(--critical)', 'font-size': 10.5 },
        'LEAK SUSPECTED ON DISTRIBUTION MAIN — XS-7005'));
    }

    wrap.replaceChildren(svg);
  }

  /* ── legend ────────────────────────────────────────────────────────── */
  setChildren(legendBar,
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '10px 22px', alignItems: 'center' } },
      h('span', { style: { fontSize: '11.5px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em' } }, 'Legend'),
      ...[['Flow active (animated)', 'var(--series-1)'], ['Pump running', 'var(--good)'], ['Pump stopped', 'var(--offline)'],
          ['Warning limit', 'var(--warning)'], ['Critical limit', 'var(--critical)'], ['Future scope (dashed)', 'var(--offline)']]
        .map(([t, col]) => h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: 'var(--text-secondary)' } },
          h('span', { class: 'dot', style: { background: col } }), t)),
      h('span', { class: 'spacer', style: { flex: 1 } }),
      h('span', { style: { fontSize: '11.5px', color: 'var(--text-muted)' } }, 'Click any vessel for its point list')));

  /* ── detail panel ──────────────────────────────────────────────────── */
  const GROUPS = {
    pv:     { title: 'Solar PV System', tags: ['JT-1001', 'TT-1002', 'JT-1003', 'JT-1004', 'JT-1005', 'JT-1006', 'EM-1007', 'EM-1008', 'TT-1009'] },
    bms:    { title: 'Battery / BMS', tags: ['EM-8001', 'EM-8002', 'EM-8003', 'QT-8004', 'QT-8005', 'TT-8006', 'QT-8007', 'QT-8008'] },
    mdb:    { title: 'Main Distribution Board', tags: ['EM-1011', 'EM-1013', 'EM-1012'] },
    grid:   { title: 'Utility Grid Connection', tags: ['EM-1010', 'EM-1012', 'EM-1013'] },
    loads:  { title: 'School Loads', tags: ['EM-1011'] },
    pumps:  { title: 'Pump Status', tags: ['ZS-3008', 'ZS-3009', 'ZS-4009', 'ZS-2006', 'ZS-7006', 'VT-3006'] },
    intake: { title: 'River Intake System', tags: ['LT-3001', 'AIT-3002', 'AIT-3003', 'AIT-3004', 'PT-3005', 'VT-3006', 'FT-3007', 'ZS-3008', 'ZS-3009'] },
    sed:    { title: 'Sedimentation Tank', tags: ['LT-3010', 'AIT-3002', 'FT-3007'] },
    filter: { title: 'Filtration System', tags: ['DPT-4001', 'DPT-4002', 'FT-4003', 'PT-4004', 'AIT-4005', 'AIT-4006', 'LT-4007', 'FT-4008', 'ZS-4009'] },
    inter:  { title: 'Intermediate Storage', tags: ['LT-4007', 'FT-4003'] },
    clean:  { title: 'Clean Water Storage', tags: ['LT-6001', 'LT-6002', 'LT-6003', 'LT-6004', 'LT-6005', 'FT-6006', 'FT-6009', 'AIT-6007', 'PT-6008'] },
    rain:   { title: 'Rain Harvesting System', tags: ['QT-2001', 'FT-2002', 'LT-2003', 'PT-2004', 'XS-2005', 'ZS-2006'] },
    ro:     { title: 'Desalination (RO) — future scope', tags: ['PT-5001', 'PT-5002', 'FT-5003', 'AIT-5004', 'AIT-5005', 'TT-5006', 'AIT-5007', 'FT-5008'] },
    dist:   { title: 'Distribution System', tags: ['FT-7001', 'PT-7002', 'FT-7003', 'FT-7004', 'XS-7005', 'ZS-7006'] },
  };
  function select(key) { selected = key; paintDetail(); }
  function paintDetail() {
    const g = GROUPS[selected] || GROUPS.clean;
    setChildren(detail,
      h('div', { class: 'card-head' },
        h('h3', {}, g.title),
        h('span', { class: 'hint' }, `${g.tags.length} points`),
        h('span', { class: 'spacer' }),
        selected === 'ro' ? pill('Skid excluded from contract — sensors wired to junction box', 'offline', 'info') : null),
      h('div', { class: 'grid g3' },
        [0, 1, 2].map((col) => h('div', {}, g.tags.filter((_, i) => i % 3 === col).map((t) => readout(t))))));
  }

  draw(); paintDetail();
  return { onTick() { draw(); paintDetail(); } };
}
