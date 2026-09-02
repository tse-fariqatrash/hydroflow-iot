/* Reports — the daily operations sheet the plant operator signs, and the
   monthly roll-up the supervisor forwards. Printable as-is (Ctrl-P). */

import { h, icon, num, pill, fmtFull, fmtDate, duration, setChildren } from '../ui.js';
import { store, api } from '../api.js';
import { BarChart, legend, meter } from '../charts.js';
import { sectionTitle, kv, T } from './_shared.js';

export default function reports(root) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(Date.now());
  let date = today;

  const dateInput = h('input', { type: 'date', value: date, max: today, style: { maxWidth: '170px' }, onchange: (e) => { date = e.target.value; load(); } });
  const sheet = h('div', { class: 'card' });
  const monthCard = h('div', { class: 'card' });
  const waterCard = h('div', { class: 'card' });

  root.append(
    h('div', { class: 'card no-print', style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } },
      h('div', {}, h('div', { style: { fontSize: '12px', fontWeight: 600 } }, 'Daily operations report'),
        h('div', { class: 'footnote' }, 'Generated from the historian — energy and water totals are integrated, not averaged.')),
      h('span', { style: { flex: 1 } }),
      dateInput,
      h('button', { class: 'btn', onclick: () => window.print() }, icon('download', 14), 'Print / save as PDF')),
    h('div', { style: { marginTop: '14px' } }, sheet),
    h('div', { style: { marginTop: '20px' } }, sectionTitle('Rolling 14 days')),
    h('div', { class: 'grid g2', style: { marginTop: '10px' } }, monthCard, waterCard));

  async function load() {
    let rpt, days = [];
    try { rpt = await api(`/report/daily?date=${date}`); days = await api('/daily?days=14'); } catch { return; }
    const t = rpt.totals;
    const alarms = rpt.alarms || [];
    const bySev = alarms.reduce((a, x) => { a[x.severity] = (a[x.severity] || 0) + 1; return a; }, {});
    const autonomy = t?.autonomy_pct ?? 0;
    const D = store.meta.design;

    setChildren(sheet,
      h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '14px', paddingBottom: '14px', borderBottom: '1px solid var(--border)', marginBottom: '16px' } },
        h('div', { class: 'brand-mark', style: { width: '38px', height: '38px', flex: '0 0 38px' } }, icon('droplet', 21)),
        h('div', { style: { flex: 1 } },
          h('div', { style: { fontSize: '15px', fontWeight: 700, letterSpacing: '-.01em' } }, 'HYDROFLOW TANJUNG MANIS — DAILY OPERATIONS REPORT'),
          h('div', { class: 'footnote' }, 'SK Bayang Daro, Tanjung Manis, Bahagian Mukah, Sarawak · Twilight Solar Energy (JS Holding Berhad) · design basis USM PPKEE')),
        h('div', { style: { textAlign: 'right' } },
          h('div', { style: { fontSize: '19px', fontWeight: 600, fontFamily: 'var(--mono)' } }, date),
          h('div', { class: 'footnote' }, `issued ${fmtFull(Date.now())}`))),

      !t ? h('div', { class: 'empty' }, icon('file', 34), h('div', {}, `No historian data for ${date}`)) :
      h('div', {},
        h('div', { class: 'grid g4', style: { marginBottom: '18px' } },
          [['Water delivered', `${num(t.water_delivered_m3, 2)} m³`, `design basis ${D.site.designFlowM3d} m³/day`],
           ['Water produced', `${num(t.water_produced_m3, 2)} m³`, 'treated into clean storage'],
           ['PV generated', `${num(t.pv_kwh, 1)} kWh`, `${num(t.pv_kwh / D.pv.kWp, 2)} kWh/kWp specific yield`],
           ['Energy autonomy', `${num(autonomy, 0)} %`, `${num(t.import_kwh, 1)} kWh imported`]]
            .map(([k, v, m]) => h('div', { style: { padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 'var(--radius-s)' } },
              h('div', { style: { fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-muted)', fontWeight: 600 } }, k),
              h('div', { style: { fontSize: '23px', fontWeight: 600, marginTop: '3px', letterSpacing: '-.02em' } }, v),
              h('div', { class: 'footnote' }, m)))),

        h('div', { class: 'grid g2' },
          h('div', {},
            h('div', { style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '9px' } }, 'Electrical summary'),
            kv([
              ['PV generation', `${num(t.pv_kwh, 2)} kWh`],
              ['Site consumption', `${num(t.load_kwh, 2)} kWh`],
              ['Grid import', `${num(t.import_kwh, 2)} kWh`],
              ['Grid export', `${num(t.export_kwh, 2)} kWh`],
              ['Battery charged', `${num(t.chg_kwh, 2)} kWh`],
              ['Battery discharged', `${num(t.dsch_kwh, 2)} kWh`],
              ['Peak site load', `${num(t.peak_load_kw, 2)} kW`],
              ['Minimum state of charge', `${num(t.min_soc, 1)} %`],
              ['Energy autonomy', `${num(autonomy, 1)} %`],
            ])),
          h('div', {},
            h('div', { style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '9px' } }, 'Water & alarms'),
            kv([
              ['Treated water produced', `${num(t.water_produced_m3, 2)} m³`],
              ['Water delivered to users', `${num(t.water_delivered_m3, 2)} m³`],
              ['Per-capita delivery', `${num((t.water_delivered_m3 * 1000) / D.site.population, 1)} L/person`],
              ['Rainfall recorded', `${num(t.rain_mm, 1)} mm`],
              ['Alarms raised', `${alarms.length}`],
              ['— critical', `${bySev.critical || 0}`],
              ['— warning', `${bySev.warning || 0}`],
              ['— serious', `${bySev.serious || 0}`],
              ['Longest alarm', alarms.length ? duration(Math.max(...alarms.map((a) => (a.cleared_at || Date.now()) - a.raised_at))) : '—'],
            ]))),

        alarms.length ? h('div', { style: { marginTop: '20px' } },
          h('div', { style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '9px' } }, `Alarms raised on ${date}`),
          h('div', { style: { border: '1px solid var(--border)', borderRadius: 'var(--radius-s)', overflow: 'hidden' } },
            h('table', { class: 'data' },
              h('thead', {}, h('tr', {}, h('th', {}, 'Time'), h('th', {}, 'Severity'), h('th', {}, 'Tag'), h('th', {}, 'Message'), h('th', {}, 'Duration'))),
              h('tbody', {}, alarms.slice(0, 40).map((a) => h('tr', { class: `alarm-row ${a.severity}` },
                h('td', { class: 'mono' }, fmtFull(a.raised_at).slice(-8)),
                h('td', {}, pill(a.severity, a.severity)),
                h('td', {}, h('span', { class: 'tag-chip' }, a.tag)),
                h('td', {}, a.message),
                h('td', { class: 'mono' }, duration((a.cleared_at || Date.now()) - a.raised_at))))))),
          alarms.length > 40 ? h('div', { class: 'footnote', style: { marginTop: '6px' } }, `${alarms.length - 40} further alarms not shown.`) : null) : null,

        h('div', { style: { marginTop: '24px', paddingTop: '14px', borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' } },
          ...['Plant Operator', 'Manager / Supervisor'].map((r) => h('div', {},
            h('div', { style: { height: '38px', borderBottom: '1px solid var(--baseline)' } }),
            h('div', { class: 'footnote', style: { marginTop: '5px' } }, `${r} — name, signature, date`)))),
        h('div', { class: 'footnote', style: { marginTop: '14px' } },
          'Figures are integrated from historian samples using the trapezoid rule; gaps longer than one hour are not bridged, so a comms outage under-reports rather than interpolating. This report is a record of monitored values, not a certificate of water potability.')));

    // rolling charts
    const cats = days.map((d) => d.day.slice(5));
    const eHost = h('div', { style: { height: '210px' } });
    const es = [
      { key: 'pv', label: 'PV generated', slot: 4, data: days.map((d) => +d.pv_kwh), unit: 'kWh' },
      { key: 'imp', label: 'Grid import', slot: 7, data: days.map((d) => +d.import_kwh), unit: 'kWh' },
    ];
    setChildren(monthCard,
      h('div', { class: 'card-head' }, h('h3', {}, 'Electricity, 14 days'), h('span', { class: 'spacer' }), legend(es, { line: false })), eHost);
    new BarChart(eHost, { categories: cats, series: es, height: 210, unit: 'kWh' });

    const wHost = h('div', { style: { height: '210px' } });
    const ws = [
      { key: 'prod', label: 'Produced', slot: 3, data: days.map((d) => +d.water_produced_m3), unit: 'm³' },
      { key: 'deliv', label: 'Delivered', slot: 1, data: days.map((d) => +d.water_delivered_m3), unit: 'm³' },
    ];
    setChildren(waterCard,
      h('div', { class: 'card-head' }, h('h3', {}, 'Water, 14 days'), h('span', { class: 'hint' }, `design ${store.meta.design.site.designFlowM3d} m³/day`),
        h('span', { class: 'spacer' }), legend(ws, { line: false })), wHost);
    new BarChart(wHost, { categories: cats, series: ws, height: 210, unit: 'm³', valueFmt: (v) => num(v, 2) });
  }

  load();
  return {};
}
