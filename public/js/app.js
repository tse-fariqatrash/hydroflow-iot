/* ═══════════════════════════════════════════════════════════════════════════
   HYDROFLOW — application shell, router and live wiring
   Twilight Solar Energy (JS Holding Berhad) × Universiti Sains Malaysia
   ═══════════════════════════════════════════════════════════════════════════ */

import { h, clear, $, icon, fmtTime, fmtFull, num, pill, toast } from './ui.js';
import { store, api, login, setToken, connectLive, closeLive, subscribe, can } from './api.js';

import overview from './pages/overview.js';
import mimic from './pages/mimic.js';
import ems from './pages/ems.js';
import bms from './pages/bms.js';
import water from './pages/water.js';
import trends from './pages/trends.js';
import alarmsPage from './pages/alarms.js';
import devices from './pages/devices.js';
import reports from './pages/reports.js';
import tagsPage from './pages/tags.js';
import about from './pages/about.js';
import usersPage from './pages/users.js';
import account from './pages/account.js';

const ROUTES = {
  overview:  { title: 'Plant Overview',        icon: 'gauge',    page: overview,   group: 'Monitoring' },
  mimic:     { title: 'Process Mimic',         icon: 'map',      page: mimic,      group: 'Monitoring' },
  water:     { title: 'Water Treatment',       icon: 'droplet',  page: water,      group: 'Monitoring' },
  ems:       { title: 'Energy Management',     icon: 'zap',      page: ems,        group: 'Monitoring' },
  bms:       { title: 'Battery / BMS',         icon: 'battery',  page: bms,        group: 'Monitoring' },
  trends:    { title: 'Trends & Historian',    icon: 'chart',    page: trends,     group: 'Analysis' },
  alarms:    { title: 'Alarms & Events',       icon: 'bell',     page: alarmsPage, group: 'Analysis' },
  reports:   { title: 'Reports',               icon: 'file',     page: reports,    group: 'Analysis' },
  devices:   { title: 'Devices & Network',     icon: 'cpu',      page: devices,    group: 'System' },
  tags:      { title: 'Tag Database',          icon: 'layers',   page: tagsPage,   group: 'System' },
  users:     { title: 'Users & Access',        icon: 'users',    page: usersPage,  group: 'System', perm: 'admin' },
  account:   { title: 'My Account',            icon: 'settings', page: account,    group: 'System' },
  about:     { title: 'System Information',    icon: 'info',     page: about,      group: 'System' },
};

/** A route is reachable when the signed-in role holds its required permission. */
const canSee = (r) => !r.perm || (store.user?.perms || []).includes(r.perm);

const root = $('#root');
let current = null;      // { destroy?, onTick? }
let route = (location.hash.slice(1) || 'overview').split('?')[0];

/* ── theme ──────────────────────────────────────────────────────────────── */
const savedTheme = localStorage.getItem('hydroflow.theme') || 'dark';
document.documentElement.dataset.theme = savedTheme;
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('hydroflow.theme', next);
  render();
}

/* ── login ──────────────────────────────────────────────────────────────── */
function loginView() {
  const err = h('div', { class: 'login-err', style: { display: 'none' } });
  const u = h('input', { type: 'text', id: 'u', value: 'engineer', autocomplete: 'username', autofocus: true });
  const p = h('input', { type: 'password', id: 'p', value: 'hydroflow2026', autocomplete: 'current-password' });
  const btn = h('button', { class: 'btn primary', type: 'submit', style: { width: '100%', justifyContent: 'center', marginTop: '6px' } }, 'Sign in');

  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); btn.disabled = true; err.style.display = 'none';
    try { await login(u.value, p.value); await boot(); }
    catch (ex) { err.style.display = 'flex'; clear(err).append(icon('alert', 14), ex.message); btn.disabled = false; }
  } },
    h('div', { class: 'field' }, h('label', { for: 'u' }, 'Username'), u),
    h('div', { class: 'field' }, h('label', { for: 'p' }, 'Password'), p),
    btn, err);

  clear(root).appendChild(h('div', { class: 'login-wrap' },
    h('div', { class: 'login-card' },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '11px' } },
        h('div', { class: 'brand-mark', style: { width: '38px', height: '38px', flex: '0 0 38px' } }, icon('droplet', 21)),
        h('div', {},
          h('div', { style: { fontWeight: 700, fontSize: '15px', letterSpacing: '-.01em' } }, 'HYDROFLOW'),
          h('div', { style: { fontSize: '10.5px', color: 'var(--text-muted)', letterSpacing: '.06em' } }, 'TANJUNG MANIS · MUKAH'))),
      h('h2', {}, 'IoT Monitoring & EMS'),
      h('p', { class: 'sub' }, 'Integrated solar PV, water treatment and distribution control system'),
      form,
      h('div', { class: 'demo-users' },
        h('div', { style: { marginBottom: '7px' } }, h('b', {}, 'Access tiers'), ' — all use the same initial password'),
        ...[['admin', 'Full access, all systems'], ['engineer', 'Configure, monitor, control'], ['operator', 'Monitor & operate'],
            ['technician', 'Monitor & maintenance'], ['manager', 'Reports & dashboard'], ['community', 'Limited public view']]
          .map(([k, d]) => h('div', { class: 'row' }, h('code', {}, k), h('span', {}, d))),
        h('div', { style: { marginTop: '10px', paddingTop: '9px', borderTop: '1px solid var(--border)' } },
          'Change ', h('code', {}, 'DEFAULT_PASSWORD'), ' and ', h('code', {}, 'JWT_SECRET'), ' before exposing this server.')))));
}

/* ── shell ──────────────────────────────────────────────────────────────── */
function shell() {
  const groups = {};
  for (const [key, r] of Object.entries(ROUTES)) (groups[r.group] ||= []).push([key, r]);

  const navEl = h('nav', { class: 'nav' });
  for (const [g, items] of Object.entries(groups)) {
    const visible = items.filter(([, r]) => canSee(r));
    if (!visible.length) continue;
    navEl.appendChild(h('div', { class: 'nav-section-title' }, g));
    for (const [key, r] of visible) {
      const badge = key === 'alarms' ? h('span', { class: 'nav-badge', style: { display: 'none' } }) : null;
      navEl.appendChild(h('a', { class: `nav-item ${key === route ? 'active' : ''}`, href: `#${key}`, dataset: { route: key } },
        icon(r.icon, 17), h('span', { class: 'nav-label' }, r.title), badge));
    }
  }

  const clock = h('span', { class: 'sub mono' });
  const conn = h('span', { class: 'pill' });
  const bell = h('button', { class: 'icon-btn', title: 'Alarms', onclick: () => (location.hash = '#alarms') }, icon('bell', 17));
  const bellCount = h('span', {
    style: { position: 'absolute', top: '3px', right: '2px', minWidth: '15px', height: '15px', borderRadius: '9px',
             background: 'var(--critical)', color: '#fff', fontSize: '9.5px', fontWeight: 700, display: 'none',
             alignItems: 'center', justifyContent: 'center', padding: '0 3px', lineHeight: 1 } });
  bell.style.position = 'relative';
  bell.appendChild(bellCount);

  const title = h('h1', {}, ROUTES[route]?.title || 'Hydroflow');
  const content = h('div', { class: 'content' });

  const app = h('div', { id: 'app' },
    h('aside', { class: 'sidebar' },
      h('div', { class: 'brand' },
        h('div', { class: 'brand-mark' }, icon('droplet', 18)),
        h('div', { class: 'brand-text' }, h('b', {}, 'HYDROFLOW'), h('span', {}, 'Tanjung Manis'))),
      navEl,
      h('div', { style: { padding: '10px 12px', borderTop: '1px solid var(--border)', fontSize: '11px', color: 'var(--text-muted)' } },
        h('div', { class: 'nav-label' }, 'Twilight Solar Energy'),
        h('div', { class: 'nav-label', style: { fontSize: '10px' } }, 'design basis: USM · PPKEE'))),
    h('div', { class: 'main' },
      h('header', { class: 'topbar' },
        h('button', { class: 'icon-btn no-print', title: 'Toggle navigation', onclick: () => {
          app.classList.toggle(window.innerWidth <= 860 ? 'nav-open' : 'nav-collapsed'); } }, icon('menu', 17)),
        h('div', {}, title, h('div', { class: 'sub' }, 'SK Bayang Daro · Tanjung Manis, Bahagian Mukah, Sarawak')),
        h('div', { class: 'spacer' }),
        conn, clock, bell,
        h('button', { class: 'icon-btn no-print', title: 'Toggle light / dark', onclick: toggleTheme },
          icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 17)),
        h('button', { class: 'icon-btn no-print', title: `My account (${store.user?.name || ''})`,
          onclick: () => (location.hash = '#account') }, icon('users', 17)),
        h('button', { class: 'icon-btn no-print', title: `Sign out (${store.user?.name || ''})`,
          onclick: () => { closeLive(); setToken(null); store.user = null; loginView(); } }, icon('logout', 17))),
      content));

  clear(root).appendChild(app);

  const paintStatus = () => {
    clock.textContent = fmtTime(Date.now());
    const stale = Date.now() - store.lastTick > 15000;
    clear(conn);
    const ok = store.connected && !stale;
    conn.className = `pill ${ok ? 'good' : 'critical'}`;
    conn.append(icon(ok ? 'wifi' : 'slash', 11), ok ? 'Live' : store.connected ? 'Stale' : 'Reconnecting');
    const n = store.alarmSummary?.unacked || 0;
    bellCount.style.display = n ? 'flex' : 'none';
    bellCount.textContent = n > 99 ? '99+' : String(n);
    bellCount.style.background = store.alarmSummary?.critical ? 'var(--critical)' : 'var(--warning)';
    bellCount.style.color = store.alarmSummary?.critical ? '#fff' : '#221a00';
    const nb = navEl.querySelector('[data-route="alarms"] .nav-badge');
    if (nb) { nb.style.display = n ? '' : 'none'; nb.textContent = n; nb.className = `nav-badge ${store.alarmSummary?.critical ? '' : 'warn'}`; }
  };
  paintStatus();
  setInterval(paintStatus, 1000);
  return { content, title, navEl, paintStatus };
}

let ui = null;

function mount() {
  if (current?.destroy) { try { current.destroy(); } catch (e) { console.warn(e); } }
  current = null;
  let r = ROUTES[route] || ROUTES.overview;
  if (!canSee(r)) {
    // Hiding the nav link is presentation; this is the actual gate.
    clear(ui.content);
    ui.title.textContent = 'Not available';
    ui.content.appendChild(h('div', { class: 'card' },
      h('div', { class: 'empty' }, icon('slash', 30),
        h('div', {}, `The "${r.title}" page requires the "${r.perm}" permission.`),
        h('div', { style: { marginTop: '6px', fontSize: '12px' } }, `You are signed in as ${store.user?.username} (${store.user?.role}).`))));
    return;
  }
  ui.title.textContent = r.title;
  for (const a of ui.navEl.querySelectorAll('.nav-item')) a.classList.toggle('active', a.dataset.route === route);
  clear(ui.content);
  try {
    current = r.page(ui.content) || {};
  } catch (e) {
    console.error(e);
    ui.content.appendChild(h('div', { class: 'card' }, h('div', { class: 'empty' }, icon('alert', 30), h('div', {}, `This page failed to render: ${e.message}`))));
  }
  ui.content.scrollTo?.(0, 0);
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => {
  const next = (location.hash.slice(1) || 'overview').split('?')[0];
  if (next === route) return;
  route = next;
  document.querySelector('#app')?.classList.remove('nav-open');
  mount();
});

/* ── boot ───────────────────────────────────────────────────────────────── */
async function boot() {
  try {
    store.user = await api('/auth/me');
    const meta = await api('/meta');
    meta.tagMap = Object.fromEntries(meta.tags.map((t) => [t.id, t]));
    meta.areaMap = Object.fromEntries(meta.areas.map((a) => [a.id, a]));
    store.meta = meta;
  } catch (e) {
    loginView();
    return;
  }
  ui = shell();
  connectLive();
  mount();
}

subscribe((evt) => {
  if (evt.type === 'logout') { closeLive(); loginView(); return; }
  if (evt.type === 'tick' && current?.onTick) { try { current.onTick(); } catch (e) { console.warn(e); } }
  if (evt.type === 'alarm' && evt.raised?.length) {
    for (const a of evt.raised.slice(0, 3)) toast(a.message, a.severity === 'critical' ? 'error' : 'info');
    if (current?.onAlarm) current.onAlarm(evt);
  }
  if (evt.type === 'alarm-ack' && current?.onAlarm) current.onAlarm(evt);
});

if (store.token) boot(); else loginView();
