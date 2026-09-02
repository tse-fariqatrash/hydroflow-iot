/* Water Treatment — the process train, the quality it achieves, and the two
   things that actually constrain it here: filter fouling and the tide. */

import { h, icon, num, pill, seriesColor, tagSeverity, fmtFull, duration, ago, setChildren } from '../ui.js';
import { store, val, quality, ctx } from '../api.js';
import { meter, tankLevel, gauge } from '../charts.js';
import { T, liveTile, historyCard, sectionTitle, readout, kv } from './_shared.js';

export default function water(root) {
  const D = store.meta.design;
  const tiles = h('div', { class: 'grid g4' });
  const trainCard = h('div', { class: 'card' });
  const qualityCard = h('div', { class: 'card' });
  const filterCard = h('div', { class: 'card' });
  const tanksCard = h('div', { class: 'card' });
  const distCard = h('div', { class: 'card' });
  const roCard = h('div', { class: 'card' });

  root.append(
    tiles,
    h('div', { style: { marginTop: '20px' } }, sectionTitle('Treatment train')),
    h('div', { style: { marginTop: '10px' } }, trainCard),
    h('div', { class: 'grid g2', style: { marginTop: '14px' } }, qualityCard, filterCard),
    h('div', { style: { marginTop: '20px' } }, sectionTitle('Storage & distribution')),
    h('div', { style: { marginTop: '10px' } }, tanksCard),
    h('div', { class: 'grid g2', style: { marginTop: '14px' } },
      historyCard({ title: 'River level & intake window', hint: 'flood ≈13:00, ebb ≈21:00 — suction is lost below 0.9 m',
        series: [{ tag: 'LT-3001', label: 'River level', slot: 1 }], unit: 'm', height: 210,
        limits: [{ value: 1.0, label: 'Low limit', kind: 'warning' }, { value: 4.6, label: 'Flood risk', kind: 'warning' }] }),
      historyCard({ title: 'Salinity intrusion', hint: 'TDS rises on the flood tide — intake inhibits above 9 000 ppm',
        series: [{ tag: 'AIT-3004', label: 'Raw water TDS', slot: 2 }], unit: 'ppm', height: 210,
        limits: [{ value: 5000, label: 'High', kind: 'warning' }, { value: 10000, label: 'Critical', kind: 'critical' }] })),
    h('div', { class: 'grid g2', style: { marginTop: '14px' } },
      historyCard({ title: 'Turbidity through the train', hint: 'raw vs treated — design target 1–5 NTU out',
        series: [{ tag: 'AIT-3002', label: 'Raw (river)', slot: 2 }, { tag: 'AIT-4005', label: 'Treated', slot: 3 }],
        unit: 'NTU', height: 210 }),
      historyCard({ title: 'Filter differential pressure', hint: 'backwash triggers at 1.00 / 1.20 bar',
        series: [{ tag: 'DPT-4001', label: 'Sand filter ΔP', slot: 4 }, { tag: 'DPT-4002', label: 'Multimedia ΔP', slot: 3 }],
        unit: 'bar', height: 210, limits: [{ value: 1.0, label: 'Backwash', kind: 'warning' }] })),
    h('div', { class: 'grid g2', style: { marginTop: '14px' } }, distCard, roCard));

  function paintTiles() {
    const c = ctx();
    setChildren(tiles,
      liveTile({ label: 'Produced today', tagId: 'FT-6009', unit: 'm³', slot: 3, icon: 'droplet', precision: 2,
        transform: () => c.m3?.producedToday ?? 0, meta: `target ${D.site.designFlowM3d} m³/day · now ${num(val('FT-6009') ?? 0, 2)} m³/h` }),
      liveTile({ label: 'Delivered today', tagId: 'FT-7001', unit: 'm³', slot: 1, icon: 'house', precision: 2,
        transform: () => c.m3?.deliveredToday ?? 0, meta: `${num(D.site.demandLpd, 0)} L/person/day design basis` }),
      liveTile({ label: 'Treated turbidity', tagId: 'AIT-4005', unit: 'NTU', slot: 3, icon: 'eye', precision: 2,
        limitHi: 5, meta: 'design target 1–5 NTU · MOH potable ≤ 5 NTU' }),
      liveTile({ label: 'Residual chlorine', tagId: 'AIT-4006', unit: 'mg/L', slot: 4, icon: 'shield', precision: 2,
        meta: 'MOH drinking water 0.2 – 5.0 mg/L' }));
  }

  /* ── the train as a cascade ────────────────────────────────────────── */
  function paintTrain() {
    const c = ctx();
    const st = c.stages || {};
    const stages = [
      { name: 'Belawai River', spec: 'raw abstraction', ntu: st.rawNTU, target: null, flow: c.flows?.rawFlow, slot: 2, tag: 'AIT-3002' },
      { name: 'Sedimentation', spec: '12.5 m³ · 24 h settling', ntu: st.sedNTU, target: [40, 60], flow: c.flows?.rawFlow, slot: 2, tag: 'LT-3010' },
      { name: 'Sand filtration', spec: '3 units · 3–4 m³/h', ntu: st.sandNTU, target: [10, 20], flow: c.flows?.filtFlow, slot: 4, tag: 'DPT-4001' },
      { name: 'Intermediate storage', spec: '10 m³ buffer', ntu: st.sandNTU, target: [10, 20], flow: c.flows?.filtFlow, slot: 4, tag: 'LT-4007' },
      { name: 'Multimedia filtration', spec: '4 units · 3 m³/h', ntu: st.mmfNTU, target: [1, 5], flow: c.flows?.polishFlow, slot: 3, tag: 'DPT-4002' },
      { name: 'Clean storage', spec: '5 × 600 gal · 11.4 m³', ntu: st.mmfNTU, target: [1, 5], flow: c.flows?.toClean, slot: 1, tag: 'AIT-6007' },
    ];
    const maxNTU = Math.max(1, ...stages.map((s) => s.ntu || 0));
    setChildren(trainCard,
      h('div', { class: 'card-head' },
        h('h3', {}, 'Turbidity reduction through the process'),
        h('span', { class: 'hint' }, 'measured value against the design target for each stage'),
        h('span', { class: 'spacer' }),
        pill(`${num(c.flows?.toClean ?? 0, 2)} m³/h into storage`, (c.flows?.toClean ?? 0) > 0.02 ? 'good' : 'offline', 'droplet')),
      h('div', { style: { display: 'grid', gridTemplateColumns: `repeat(${stages.length}, minmax(0,1fr))`, gap: '2px' } },
        stages.map((s, i) => {
          const inSpec = !s.target || (s.ntu <= s.target[1]);
          return h('div', { style: { padding: '0 8px', borderLeft: i ? '1px solid var(--border)' : 'none' } },
            h('div', { style: { fontSize: '11.5px', fontWeight: 600, marginBottom: '2px' } }, s.name),
            h('div', { style: { fontSize: '10.5px', color: 'var(--text-muted)', marginBottom: '10px', minHeight: '26px' } }, s.spec),
            h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '4px' } },
              h('span', { class: 'mono', style: { fontSize: '19px', fontWeight: 600, color: inSpec ? 'var(--text-primary)' : 'var(--warning)' } }, num(s.ntu ?? 0, s.ntu < 10 ? 2 : 0)),
              h('span', { style: { fontSize: '10.5px', color: 'var(--text-muted)' } }, 'NTU')),
            h('div', { style: { marginTop: '7px' } },
              meter({ pct: ((s.ntu || 0) / maxNTU) * 100, color: inSpec ? seriesColor(s.slot) : 'var(--warning)', height: 5 })),
            h('div', { style: { fontSize: '10px', color: 'var(--text-muted)', marginTop: '5px' } },
              s.target ? `target ${s.target[0]}–${s.target[1]} NTU` : 'unconditioned'),
            h('div', { style: { fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginTop: '2px' } },
              s.flow !== undefined ? `${num(s.flow ?? 0, 2)} m³/h` : ''),
            h('div', { style: { marginTop: '6px' } }, inSpec ? pill('In spec', 'good', 'check') : pill('Above target', 'warning', 'alert')));
        })),
      h('div', { class: 'footnote', style: { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border)' } },
        'Stage targets are taken from the USM design deck (raw > 100 NTU → 40–60 → 10–20 → 1–5 NTU). ',
        'A stage reading above target usually means the media upstream is due for backwash, not that the stage itself has failed — check the differential pressures before intervening.'));
  }

  /* ── potable quality vs MOH limits ─────────────────────────────────── */
  function paintQuality() {
    const params = [
      { tag: 'AIT-3003', label: 'pH', std: '6.5 – 9.0', lo: 6.5, hi: 9.0, scale: [4, 11] },
      { tag: 'AIT-4005', label: 'Turbidity', std: '≤ 5 NTU', lo: 0, hi: 5, scale: [0, 12] },
      { tag: 'AIT-6007', label: 'Total dissolved solids', std: '≤ 1 000 ppm', lo: 0, hi: 1000, scale: [0, 1400] },
      { tag: 'AIT-4006', label: 'Residual chlorine', std: '0.2 – 5.0 mg/L', lo: 0.2, hi: 5.0, scale: [0, 5.5] },
    ];
    setChildren(qualityCard,
      h('div', { class: 'card-head' }, h('h3', {}, 'Potable water quality'),
        h('span', { class: 'hint' }, 'against Malaysian MOH drinking water standards')),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '15px' } },
        params.map((p) => {
          const t = T(p.tag), v = val(p.tag) ?? 0;
          const ok = v >= p.lo && v <= p.hi;
          const frac = (x) => Math.max(0, Math.min(100, ((x - p.scale[0]) / (p.scale[1] - p.scale[0])) * 100));
          return h('div', {},
            h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', fontSize: '12px', marginBottom: '6px' } },
              h('span', { style: { fontWeight: 600 } }, p.label),
              h('span', { class: 'tag-chip' }, p.tag),
              h('span', { style: { marginLeft: 'auto', fontFamily: 'var(--mono)', fontWeight: 600, color: ok ? 'var(--text-primary)' : 'var(--warning)' } },
                `${num(v, t?.precision ?? 2)} ${t?.unit || ''}`)),
            // acceptable band drawn behind the value marker
            h('div', { style: { position: 'relative', height: '9px', background: 'var(--surface-3)', borderRadius: '5px', overflow: 'hidden' } },
              h('div', { style: { position: 'absolute', left: `${frac(p.lo)}%`, width: `${frac(p.hi) - frac(p.lo)}%`, top: 0, bottom: 0,
                background: 'color-mix(in srgb, var(--good) 30%, transparent)' } }),
              h('div', { style: { position: 'absolute', left: `calc(${frac(v)}% - 1.5px)`, width: '3px', top: '-2px', bottom: '-2px',
                background: ok ? 'var(--good)' : 'var(--warning)', borderRadius: '2px' } })),
            h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' } },
              h('span', {}, `standard ${p.std}`),
              h('span', {}, ok ? 'compliant' : 'outside standard')));
        })),
      h('div', { class: 'footnote', style: { marginTop: '14px' } },
        'Shaded band is the acceptable range; the vertical marker is the live reading. These are process indicators, not a substitute for periodic laboratory testing — bacteriological compliance in particular cannot be inferred from any sensor on this plant.'));
  }

  /* ── filter condition ──────────────────────────────────────────────── */
  function paintFilter() {
    const c = ctx();
    const items = [
      { name: 'Sand filtration ×3', foul: c.foulSand ?? 0, dp: val('DPT-4001') ?? 0, trigger: 1.00, last: c.lastBackwashSand, slot: 4 },
      { name: 'Multimedia filtration ×4', foul: c.foulMMF ?? 0, dp: val('DPT-4002') ?? 0, trigger: 1.20, last: c.lastBackwashMMF, slot: 3 },
    ];
    setChildren(filterCard,
      h('div', { class: 'card-head' }, h('h3', {}, 'Filter condition'), h('span', { class: 'hint' }, 'media loading and backwash history')),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '17px' } },
        items.map((f) => h('div', {},
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', fontSize: '12px', marginBottom: '6px' } },
            h('span', { class: 'dot', style: { background: seriesColor(f.slot) } }),
            h('span', { style: { fontWeight: 600 } }, f.name),
            h('span', { style: { marginLeft: 'auto', fontFamily: 'var(--mono)', fontWeight: 600 } }, `${num(f.dp, 2)} bar ΔP`)),
          meter({ pct: (f.dp / f.trigger) * 100, color: f.dp > f.trigger * 0.85 ? 'var(--warning)' : seriesColor(f.slot), height: 6 }),
          h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '5px' } },
            h('span', {}, `media loading ${num(f.foul * 100, 0)} %`),
            h('span', {}, f.last ? `last backwash ${ago(f.last)}` : 'no backwash this session'),
            h('span', {}, `trigger ${num(f.trigger, 2)} bar`))))),
      h('div', { style: { marginTop: '16px', paddingTop: '13px', borderTop: '1px solid var(--border)' } },
        kv([
          ['Filter feed pressure', `${num(val('PT-4004'), 2)} bar`],
          ['Filtered flow (sand stage)', `${num(val('FT-4003'), 2)} m³/h`],
          ['Polished flow (multimedia)', `${num(val('FT-4008'), 2)} m³/h`],
          ['Feed pump', (val('ZS-4009') ?? 0) > 0.5 ? 'Running' : 'Stopped'],
          ['Intermediate storage', `${num(val('LT-4007'), 1)} %`],
        ])),
      h('div', { class: 'footnote', style: { marginTop: '10px' } },
        'Backwash is automatic on differential pressure. If ΔP climbs back to the trigger within a few hours of a wash, the media is due for replacement rather than another wash.'));
  }

  /* ── tanks ─────────────────────────────────────────────────────────── */
  function paintTanks() {
    const c = ctx();
    const tanks = [
      { pct: c.rainPct ?? 0, label: 'Rainwater', sub: 'harvest', cap: `${num(D.tanks.rainTotal, 1)} m³`, slot: 3 },
      { pct: c.sedPct ?? 0, label: 'Sedimentation', sub: '24 h settle', cap: `${num(D.tanks.sedimentation, 1)} m³`, slot: 2 },
      { pct: c.interPct ?? 0, label: 'Intermediate', sub: 'buffer', cap: `${num(D.tanks.intermediate, 1)} m³`, slot: 4 },
      ...[1, 2, 3, 4, 5].map((i) => ({ pct: val(`LT-600${i}`) ?? 0, label: `Clean T${i}`, sub: '600 gal', cap: `${num(D.tanks.cleanEach, 2)} m³`, slot: 1, tag: `LT-600${i}` })),
    ];
    setChildren(tanksCard,
      h('div', { class: 'card-head' }, h('h3', {}, 'Tank levels'),
        h('span', { class: 'hint' }, `${num((c.cleanPct ?? 0) / 100 * D.tanks.cleanEach * D.tanks.cleanCount, 2)} m³ of treated water in store`),
        h('span', { class: 'spacer' }),
        pill(c.topUp === false ? 'Storage satisfied — production paused' : 'Topping up storage', c.topUp === false ? 'info' : 'good', 'droplet')),
      h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'space-between' } },
        tanks.map((t) => {
          const tg = t.tag ? T(t.tag) : null;
          const sev = tg ? tagSeverity(tg, t.pct, store.values) : t.pct < 20 ? 'warning' : 'good';
          return tankLevel({ pct: t.pct, label: t.label, sublabel: t.sub, capacity: t.cap, color: seriesColor(t.slot), severity: sev, height: 112, width: 66 });
        })));
  }

  function paintDist() {
    const school = val('FT-7003') ?? 0, longhouse = val('FT-7004') ?? 0;
    const total = school + longhouse;
    const leak = (val('XS-7005') ?? 0) > 0.5;
    setChildren(distCard,
      h('div', { class: 'card-head' }, h('h3', {}, 'Distribution'), h('span', { class: 'hint' }, 'smart meters at each branch'),
        h('span', { class: 'spacer' }),
        leak ? pill('Leak suspected', 'critical', 'alert') : pill('Network normal', 'good', 'check')),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '13px' } },
        [{ n: 'SK Bayang Daro', d: '66 students · 42 boarders · 20 staff', v: school, slot: 1 },
         { n: '9 Longhouses', d: '≈ 100 residents', v: longhouse, slot: 2 }].map((b) =>
          h('div', {},
            h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', fontSize: '12px', marginBottom: '5px' } },
              h('span', { class: 'dot', style: { background: seriesColor(b.slot) } }),
              h('span', { style: { fontWeight: 600 } }, b.n),
              h('span', { class: 'muted', style: { fontSize: '10.5px' } }, b.d),
              h('span', { style: { marginLeft: 'auto', fontFamily: 'var(--mono)', fontWeight: 600 } }, `${num(b.v, 2)} m³/h`)),
            meter({ pct: total > 0 ? (b.v / total) * 100 : 0, color: seriesColor(b.slot), height: 6 })))),
      h('div', { style: { marginTop: '15px', paddingTop: '12px', borderTop: '1px solid var(--border)' } },
        kv([
          ['Main flow', `${num(val('FT-7001'), 2)} m³/h`],
          ['Pipe pressure', `${num(val('PT-7002'), 2)} bar`],
          ['Booster pump', (val('ZS-7006') ?? 0) > 0.5 ? 'Running' : 'Gravity feed'],
          ['Storage header pressure', `${num(val('PT-6008'), 2)} bar`],
          ['Leak detection', leak ? 'LEAK SUSPECTED' : 'Normal'],
        ])));
  }

  function paintRO() {
    const tags = ['PT-5001', 'PT-5002', 'FT-5003', 'AIT-5004', 'AIT-5005', 'TT-5006', 'AIT-5007', 'FT-5008'];
    setChildren(roCard,
      h('div', { class: 'card-head' }, h('h3', {}, 'Desalination (RO) — future scope'),
        h('span', { class: 'spacer' }), pill('Skid not installed', 'offline', 'slash')),
      h('div', { class: 'footnote', style: { marginBottom: '12px' } },
        'The membrane skid is excluded from the current contract (struck from Bills 3c and 4 of the BQ). Its instrumentation ',
        h('b', {}, 'is'), ' installed and wired to a junction box at the skid boundary, costed under Bill 6(f), so the plant is ready for tie-in without re-entering the panel. These points read ',
        h('span', { class: 'mono' }, 'offline'), ' until the skid is commissioned.'),
      h('div', { class: 'grid g2' },
        [0, 1].map((col) => h('div', {}, tags.filter((_, i) => i % 2 === col).map((t) => readout(t))))));
  }

  const paint = () => { paintTiles(); paintTrain(); paintQuality(); paintFilter(); paintTanks(); paintDist(); paintRO(); };
  paint();
  return { onTick: paint };
}
