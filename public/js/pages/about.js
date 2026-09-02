/* System Information — what this is, who it is for, and what it does not do. */

import { h, icon, num, pill, fmtFull, duration, setChildren } from '../ui.js';
import { store, api, val } from '../api.js';
import { sectionTitle, kv } from './_shared.js';

export default function about(root) {
  const D = store.meta.design;
  const healthCard = h('div', { class: 'card' });
  const usersCard = h('div', { class: 'card pad0' });

  root.append(
    h('div', { class: 'grid g2' },
      h('div', { class: 'card' },
        h('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '14px' } },
          h('div', { class: 'brand-mark', style: { width: '40px', height: '40px', flex: '0 0 40px' } }, icon('droplet', 22)),
          h('div', {},
            h('div', { style: { fontSize: '16px', fontWeight: 700, letterSpacing: '-.015em' } }, 'Hydroflow Tanjung Manis'),
            h('div', { class: 'footnote' }, 'IoT Monitoring & Energy Management System · v1.0.0'))),
        h('p', { style: { fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 14px' } },
          'A single operator interface for the integrated solar PV, river water treatment, rainwater harvesting and distribution plant at SK Bayang Daro. It implements the IoT network topology set out in the USM design study: field instrumentation on RS-485/Modbus RTU, an edge gateway publishing over MQTT, a local historian and alarm engine, and role-based web access for the six personnel tiers.'),
        kv([
          ['Delivered by', 'Twilight Solar Energy Sdn Bhd'],
          ['Group', 'JS Holding Berhad'],
          ['Design basis', 'USM School of Electrical & Electronic Engineering'],
          ['Design study', 'Projek Pam Air Hydroflow, Feb 2025'],
          ['Site', 'SK Bayang Daro, Tanjung Manis, Bahagian Mukah'],
          ['Coordinates', `${num(D.site.lat, 4)} °N, ${num(D.site.lon, 4)} °E`],
          ['Served population', `${D.site.population} persons (school + 9 longhouses)`],
          ['Project due date', '14 November 2027'],
        ])),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', {}, 'Design parameters')),
        h('div', { class: 'grid g2' },
          h('div', {},
            h('div', { style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '8px' } }, 'Electrical'),
            kv([
              ['PV array', `${num(D.pv.kWp, 1)} kWp`],
              ['Modules', `${D.pv.moduleCount} × ${D.pv.moduleW} Wp`],
              ['Configuration', `${D.pv.strings} strings × ${D.pv.modulesPerString}`],
              ['Tilt / azimuth', `${D.pv.tilt}° / ${D.pv.azimuth}° (south)`],
              ['Inverter', `${num(D.pv.inverterKW, 1)} kW hybrid`],
              ['Battery', `${D.battery.nominalV} V ${D.battery.ah} Ah`],
              ['Usable energy', `${num(D.battery.kWh, 2)} kWh ${D.battery.chemistry}`],
            ])),
          h('div', {},
            h('div', { style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '8px' } }, 'Process'),
            kv([
              ['Design production', `${D.site.designFlowM3d} m³/day`],
              ['Demand basis', `${D.site.demandLpd} L/person/day`],
              ['Operating hours', `${D.site.operatingHours} h/day`],
              ['Sedimentation', `${num(D.tanks.sedimentation, 1)} m³`],
              ['Intermediate', `${num(D.tanks.intermediate, 1)} m³`],
              ['Clean storage', `${D.tanks.cleanCount} × ${num(D.tanks.cleanEach, 2)} m³`],
              ['Rain storage', `${num(D.tanks.rainTotal, 2)} m³`],
            ])))) ),
    h('div', { style: { marginTop: '20px' } }, sectionTitle('Server health')),
    h('div', { style: { marginTop: '10px' } }, healthCard),
    h('div', { style: { marginTop: '20px' } }, sectionTitle('Access tiers')),
    h('div', { style: { marginTop: '10px' } }, usersCard),
    h('div', { class: 'card', style: { marginTop: '20px' } },
      h('div', { class: 'card-head' }, h('h3', {}, 'Scope and limitations'), h('span', { class: 'spacer' }), pill('Read this', 'info', 'info')),
      h('ul', { style: { margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.75 } },
        h('li', {}, h('b', {}, 'The desalination (RO) skid is outside the current contract.'), ' Its instrumentation is installed and wired to a junction box at the skid boundary — those points appear here and read ', h('span', { class: 'mono' }, 'offline'), ' until the skid is commissioned.'),
        h('li', {}, h('b', {}, 'Water quality readings are process indicators, not certification.'), ' Bacteriological and chemical compliance require periodic laboratory testing; no sensor on this plant can substitute for it.'),
        h('li', {}, h('b', {}, 'State of health is modelled, not measured.'), ' Battery SOH here is derived from cumulative throughput. Schedule an annual controlled capacity discharge and correct the model against it.'),
        h('li', {}, h('b', {}, 'Until field devices publish, values come from the built-in plant simulator.'), ' Any point published over MQTT is switched to live data automatically and permanently, subsystem by subsystem — there is no flag day.'),
        h('li', {}, h('b', {}, 'Change the credentials before this server is reachable from the internet.'), ' Set ', h('span', { class: 'mono' }, 'JWT_SECRET'), ' and ', h('span', { class: 'mono' }, 'DEFAULT_PASSWORD'), ', put TLS in front of it, and restrict the MQTT port to the gateway.'))));

  async function loadHealth() {
    let hres;
    try { hres = await api('/health'); } catch { return; }
    const hst = hres.historian || {};
    setChildren(healthCard,
      h('div', { class: 'card-head' }, h('h3', {}, 'Runtime'), h('span', { class: 'spacer' }),
        pill(hres.simulator ? 'Simulator active' : 'Live telemetry only', hres.simulator ? 'info' : 'good', 'activity')),
      h('div', { class: 'grid g3' },
        kv([
          ['Version', hres.version],
          ['Uptime', duration(hres.uptime * 1000)],
          ['Monitored points', num(hres.tags, 0)],
          ['Points claimed by hardware', num(hres.claimedByDevices, 0)],
        ]),
        kv([
          ['Raw samples stored', num(hst.samples ?? 0, 0)],
          ['Hourly rollups', num(hst.rollups ?? 0, 0)],
          ['History from', hst.from ? fmtFull(hst.from) : '—'],
          ['History to', hst.to ? fmtFull(hst.to) : '—'],
        ]),
        kv([
          ['Signed in as', `${store.user?.name} (${store.user?.username})`],
          ['Role', store.user?.label || store.user?.role],
          ['Permissions', (store.user?.perms || []).join(', ')],
          ['Access scope', store.user?.scope || '—'],
        ])));
  }

  usersCard.replaceChildren(h('div', { class: 'table-wrap', style: { maxHeight: 'none' } },
    h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Role'), h('th', {}, 'Access level'), h('th', {}, 'Permissions'), h('th', {}, 'Typical holder'))),
      h('tbody', {}, Object.entries(store.meta.roles).map(([k, r]) => h('tr', {},
        h('td', {}, h('span', { class: 'tag-chip' }, k), ' ', r.label),
        h('td', {}, r.scope),
        h('td', { class: 'muted' }, r.perms.join(', ')),
        h('td', { class: 'muted' }, ({
          admin: 'Twilight Solar Energy — system integrator',
          engineer: 'Twilight Solar / USM commissioning engineer',
          operator: 'School caretaker trained as plant operator',
          technician: 'Contracted maintenance technician',
          manager: 'JS Holding / JKR supervisor',
          community: 'Village committee, school office',
        })[k] || '—')))))));

  loadHealth();
  const t = setInterval(loadHealth, 30000);
  return { destroy() { clearInterval(t); } };
}
