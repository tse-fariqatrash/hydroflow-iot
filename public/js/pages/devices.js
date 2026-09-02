/* Devices & Network — the physical layer from the USM topology: what is on
   each RS-485 segment, what the gateway is publishing, and which points are
   still coming from the simulator rather than from real hardware. */

import { h, icon, num, pill, ago, fmtFull, seriesColor, setChildren } from '../ui.js';
import { store, api, val, quality, ctx } from '../api.js';
import { meter } from '../charts.js';
import { T, sectionTitle, kv } from './_shared.js';

/** Blue ordinal ramp (steps 150–600) — validated monotone with visible ΔL gaps
 *  and a light end that clears 2:1 against both surfaces. */
const SEGMENT_RAMP = ['var(--ord-1)', 'var(--ord-2)', 'var(--ord-3)', 'var(--ord-4)', 'var(--ord-5)'];

export default function devices(root) {
  const summary = h('div', { class: 'grid g4' });
  const busCard = h('div', { class: 'card' });
  const tableCard = h('div', { class: 'card pad0' });
  const archCard = h('div', { class: 'card' });

  root.append(
    summary,
    h('div', { class: 'grid g2', style: { marginTop: '14px' } }, busCard, archCard),
    h('div', { style: { marginTop: '20px' } }, sectionTitle('Field devices')),
    h('div', { style: { marginTop: '10px' } }, tableCard));

  async function load() {
    let devs = [];
    try { devs = await api('/devices'); } catch { return; }
    const c = ctx();
    const live = Object.values(store.values || {});
    const fromDevice = live.filter((v) => v.src && v.src !== 'sim' && v.src !== 'offline').length;
    const simulated = live.filter((v) => v.src === 'sim').length;
    const offline = live.filter((v) => v.src === 'offline').length;

    setChildren(summary,
      h('div', { class: 'card stat' },
        h('div', { class: 'label' }, icon('cpu', 12), 'Field devices'),
        h('div', { class: 'value' }, num(devs.filter((d) => d.scope !== 'future').length, 0)),
        h('div', { class: 'meta' }, `${devs.filter((d) => d.scope === 'future').length} awaiting installation`)),
      h('div', { class: 'card stat' },
        h('div', { class: 'label' }, icon('layers', 12), 'Monitored points'),
        h('div', { class: 'value' }, num(live.length, 0)),
        h('div', { class: 'meta' }, `${store.meta.tags.filter((t) => !t.hidden).length} on the tag grid + ${store.meta.cellTags.length + store.meta.tempTags.length} BMS detail`)),
      h('div', { class: 'card stat' },
        h('div', { class: 'label' }, icon('wifi', 12), 'Live from hardware'),
        h('div', { class: 'value', style: { color: fromDevice ? 'var(--good)' : 'var(--text-primary)' } }, num(fromDevice, 0)),
        h('div', { class: 'meta' }, fromDevice ? 'points claimed by a real device' : 'no field device publishing yet'),
        h('div', { style: { marginTop: '10px' } }, meter({ pct: (fromDevice / Math.max(1, live.length)) * 100, color: 'var(--good)' }))),
      h('div', { class: 'card stat' },
        h('div', { class: 'label' }, icon('activity', 12), 'Simulated points'),
        h('div', { class: 'value' }, num(simulated, 0)),
        h('div', { class: 'meta' }, `${offline} offline (RO skid not installed)`),
        h('div', { style: { marginTop: '10px' } }, meter({ pct: (simulated / Math.max(1, live.length)) * 100, color: 'var(--series-4)' }))));

    // ── bus segments ──
    const buses = {};
    for (const d of devs) (buses[d.bus] ||= []).push(d);
    setChildren(busCard,
      h('div', { class: 'card-head' }, h('h3', {}, 'Network segments'),
        h('span', { class: 'hint' }, 'RS-485 field level → Ethernet backbone → 4G/5G uplink')),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        Object.entries(buses).map(([bus, list], i) => h('div', {},
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', fontSize: '12px', marginBottom: '6px' } },
            // Segments are an ordered set (#1…#4 then Ethernet), not five
            // unrelated categories, so they take an ordinal step of one hue
            // rather than five categorical hues.
            h('span', { class: 'dot', style: { background: SEGMENT_RAMP[i % SEGMENT_RAMP.length] } }),
            h('span', { style: { fontWeight: 600 } }, bus),
            h('span', { class: 'muted', style: { fontSize: '11px' } }, bus.startsWith('RS-485') ? 'Modbus RTU · 19 200 8N1' : 'Modbus TCP / MQTT'),
            h('span', { style: { marginLeft: 'auto', fontFamily: 'var(--mono)', fontWeight: 600 } }, `${list.length} node${list.length === 1 ? '' : 's'}`)),
          h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } },
            list.map((d) => h('span', {
              class: 'pill', title: `${d.name} — slave ${d.slave ?? 'n/a'}`,
              style: { fontSize: '10px', borderColor: d.scope === 'future' ? 'var(--offline)' : d.status === 'online' ? 'var(--good)' : 'var(--border-strong)',
                       color: d.scope === 'future' ? 'var(--offline)' : 'var(--text-secondary)' } },
              d.slave != null ? `#${d.slave}` : '—', ' ', d.name))))))
    );

    // ── architecture ──
    setChildren(archCard,
      h('div', { class: 'card-head' }, h('h3', {}, 'System architecture'), h('span', { class: 'hint' }, 'per the USM IoT network topology')),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px' } },
        [
          { layer: 'Field devices', detail: 'Sensors, transmitters, pump starters, VFDs', proto: 'RS-485 / Modbus RTU', slot: 1 },
          { layer: 'Local control', detail: 'Main PLC, I/O modules, 15" HMI panel', proto: 'Modbus TCP', slot: 2 },
          { layer: 'Edge gateway', detail: 'Protocol conversion, store-and-forward buffer', proto: 'MQTT / TLS', slot: 3 },
          { layer: 'Network', detail: 'Managed switch, firewall, dual-SIM 4G/5G router', proto: 'Ethernet TCP/IP', slot: 4 },
          { layer: 'This server', detail: 'Historian, alarm engine, EMS logic, web UI', proto: 'HTTPS / WSS', slot: 6 },
          { layer: 'Users', detail: 'Control room, web dashboard, mobile, alerts', proto: 'Browser / push', slot: 7 },
        ].map((l) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 10px', background: 'var(--surface-2)', borderRadius: 'var(--radius-s)', borderLeft: `3px solid ${seriesColor(l.slot)}` } },
          h('div', { style: { minWidth: 0, flex: 1 } },
            h('div', { style: { fontSize: '12px', fontWeight: 600 } }, l.layer),
            h('div', { style: { fontSize: '10.5px', color: 'var(--text-muted)' } }, l.detail)),
          h('span', { class: 'tag-chip', style: { fontSize: '10px' } }, l.proto)))),
      h('div', { class: 'footnote', style: { marginTop: '12px' } },
        'The edge gateway buffers locally when the cellular link drops and back-fills on reconnect, so a comms outage costs latency, not history. Publish to ',
        h('span', { class: 'mono' }, 'hydroflow/tanjungmanis/<device>/telemetry'), ' and the matching points switch from simulated to live automatically.'));

    // ── device table ──
    tableCard.replaceChildren(h('div', { class: 'table-wrap' },
      h('table', { class: 'data' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Device ID'), h('th', {}, 'Description'), h('th', {}, 'Model'), h('th', {}, 'Protocol'),
          h('th', { class: 'num' }, 'Slave'), h('th', {}, 'Segment'), h('th', { class: 'num' }, 'Points'),
          h('th', {}, 'Status'), h('th', {}, 'Last seen'))),
        h('tbody', {}, devs.map((d) => h('tr', {},
          h('td', {}, h('span', { class: 'tag-chip' }, d.id)),
          h('td', {}, d.name),
          h('td', { class: 'muted' }, d.model),
          h('td', { class: 'muted' }, d.proto),
          h('td', { class: 'num' }, d.slave ?? '—'),
          h('td', { class: 'muted' }, d.bus),
          h('td', { class: 'num' }, d.tagCount || '—'),
          h('td', {}, d.scope === 'future' ? pill('Not installed', 'offline', 'slash')
            : d.status === 'online' ? pill('Online', 'good', 'wifi')
            : d.status === 'simulated' ? pill('Simulated', 'info', 'activity')
            : pill('Offline', 'critical', 'slash')),
          h('td', { class: 'muted' }, d.lastSeen ? ago(d.lastSeen) : '—')))))));
  }

  load();
  const t = setInterval(load, 10000);
  return { destroy() { clearInterval(t); } };
}
