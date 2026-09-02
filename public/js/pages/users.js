/* Users & Access — administrator-only account management.
   Deactivation rather than deletion, because the alarm and event journals
   reference these accounts by name and must keep resolving. */

import { h, icon, num, pill, fmtFull, ago, modal, toast, setChildren } from '../ui.js';
import { store, api } from '../api.js';
import { sectionTitle, kv } from './_shared.js';

/** What each role can actually do — stated honestly, including the gap. */
const ROLE_REALITY = {
  admin:      'Everything, plus creating and editing accounts.',
  engineer:   'View everything, acknowledge alarms, issue device commands.',
  operator:   'View everything, acknowledge alarms, issue device commands.',
  technician: 'View everything. Cannot acknowledge alarms or issue commands.',
  manager:    'View everything. Cannot acknowledge alarms or issue commands.',
  community:  'View everything. Cannot acknowledge alarms or issue commands. NOTE: not yet restricted to a limited dashboard — this account currently sees the full engineering interface.',
};

export default function usersPage(root) {
  const tableCard = h('div', { class: 'card pad0' });
  const summary = h('div', { class: 'grid g4' });
  let rows = [];

  const addBtn = h('button', { class: 'btn primary', onclick: onCreate }, icon('users', 14), 'Add user');

  root.append(
    summary,
    h('div', { style: { marginTop: '20px' } }, sectionTitle('Accounts', addBtn)),
    h('div', { style: { marginTop: '10px' } }, tableCard),
    h('div', { class: 'card', style: { marginTop: '20px' } },
      h('div', { class: 'card-head' }, h('h3', {}, 'What the roles actually permit')),
      h('div', { class: 'table-wrap', style: { maxHeight: 'none' } },
        h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Role'), h('th', {}, 'Intended scope'), h('th', {}, 'Enforced today'))),
          h('tbody', {}, Object.entries(store.meta.roles).map(([k, r]) => h('tr', {},
            h('td', {}, h('span', { class: 'tag-chip' }, k), ' ', r.label),
            h('td', { class: 'muted' }, r.scope),
            h('td', {}, k === 'community'
              ? h('span', { style: { color: 'var(--warning)' } }, ROLE_REALITY[k])
              : ROLE_REALITY[k])))))),
      h('div', { class: 'footnote', style: { marginTop: '12px' } },
        'Only two permissions are checked by the API: ', h('span', { class: 'mono' }, 'operate'),
        ' (acknowledge alarms, send commands) and ', h('span', { class: 'mono' }, 'admin'),
        ' (this page). Everything else is visible to any signed-in account.')));

  const roleOptions = () => Object.entries(store.meta.roles).map(([k, r]) => ({ value: k, label: `${k} — ${r.label}` }));

  async function load() {
    try { rows = await api('/users'); } catch (e) { toast(e.message, 'error'); return; }
    paint();
  }

  function paint() {
    const active = rows.filter((u) => u.active);
    const admins = active.filter((u) => u.role === 'admin');
    const neverIn = rows.filter((u) => !u.last_login);
    setChildren(summary,
      h('div', { class: 'card stat' },
        h('div', { class: 'label' }, icon('users', 12), 'Accounts'),
        h('div', { class: 'value' }, num(rows.length, 0)),
        h('div', { class: 'meta' }, `${active.length} active · ${rows.length - active.length} disabled`)),
      h('div', { class: 'card stat' },
        h('div', { class: 'label' }, icon('shield', 12), 'Administrators'),
        h('div', { class: 'value', style: { color: admins.length === 1 ? 'var(--warning)' : '' } }, num(admins.length, 0)),
        h('div', { class: 'meta' }, admins.length === 1 ? 'only one — add a second before you need it' : 'more than one, good')),
      h('div', { class: 'card stat' },
        h('div', { class: 'label' }, icon('clock', 12), 'Never signed in'),
        h('div', { class: 'value' }, num(neverIn.length, 0)),
        h('div', { class: 'meta' }, neverIn.length ? 'unused accounts are worth disabling' : 'every account has been used')),
      h('div', { class: 'card stat' },
        h('div', { class: 'label' }, icon('info', 12), 'Minimum password'),
        h('div', { class: 'value' }, '12'),
        h('div', { class: 'meta' }, 'characters, enforced server-side')));

    setChildren(tableCard, h('div', { class: 'table-wrap', style: { maxHeight: 'none' } },
      h('table', { class: 'data' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Username'), h('th', {}, 'Name'), h('th', {}, 'Email'), h('th', {}, 'Role'),
          h('th', {}, 'Status'), h('th', {}, 'Last sign-in'), h('th', {}, ''))),
        h('tbody', {}, rows.map((u) => {
          const isMe = u.username === store.user?.username;
          return h('tr', { class: u.active ? '' : 'row-inactive' },
            h('td', {}, h('span', { class: 'tag-chip' }, u.username), ' ',
              isMe ? h('span', { class: 'you-badge' }, 'you') : null),
            h('td', {}, u.name),
            h('td', { class: 'muted' }, u.email || '—'),
            h('td', {}, h('span', { title: ROLE_REALITY[u.role] }, u.label || u.role)),
            h('td', {}, u.active ? pill('Active', 'good', 'check') : pill('Disabled', 'offline', 'slash')),
            h('td', { class: 'muted' }, u.last_login ? ago(u.last_login) : 'never'),
            h('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
              h('button', { class: 'btn sm ghost', onclick: () => onEdit(u) }, 'Edit'),
              ' ',
              h('button', { class: 'btn sm ghost', onclick: () => onReset(u) }, 'Reset password'),
              ' ',
              u.active && !isMe
                ? h('button', { class: 'btn sm ghost', style: { color: 'var(--critical)' }, onclick: () => onDeactivate(u) }, 'Disable')
                : null));
        })))));
  }

  async function onCreate() {
    const r = await modal({
      title: 'Add user',
      subtitle: 'The username becomes the audit identity and cannot be changed later.',
      fields: [
        { key: 'username', label: 'Username', required: true, hint: '3–32 characters: lowercase letters, digits, dot, dash or underscore.' },
        { key: 'name', label: 'Full name', required: true },
        { key: 'email', label: 'Email', type: 'email' },
        { key: 'role', label: 'Role', type: 'select', value: 'operator', options: roleOptions() },
        { key: 'password', label: 'Initial password', type: 'password', required: true,
          hint: 'At least 12 characters. Give it to them over a channel that is not this dashboard.' },
      ],
      submitLabel: 'Create user',
      onSubmit: async (v) => api('/users', { method: 'POST', body: JSON.stringify(v) }),
    });
    if (r) { toast(`Created ${r.username}`, 'ok'); load(); }
  }

  async function onEdit(u) {
    const isMe = u.username === store.user?.username;
    const r = await modal({
      title: `Edit ${u.username}`,
      subtitle: isMe ? 'This is your own account — you cannot remove your own admin role.' : null,
      fields: [
        { key: 'name', label: 'Full name', value: u.name, required: true },
        { key: 'email', label: 'Email', type: 'email', value: u.email || '' },
        { key: 'role', label: 'Role', type: 'select', value: u.role, options: roleOptions() },
        { key: 'active', label: 'Account is active', type: 'checkbox', value: u.active },
      ],
      note: 'Changing the role or disabling the account signs that person out immediately.',
      onSubmit: async (v) => api(`/users/${u.id}`, { method: 'PATCH', body: JSON.stringify(v) }),
    });
    if (r) { toast(`Updated ${r.username}`, 'ok'); load(); }
  }

  async function onReset(u) {
    const r = await modal({
      title: `Reset password for ${u.username}`,
      subtitle: 'Their existing sessions end immediately.',
      fields: [{ key: 'password', label: 'New password', type: 'password', required: true,
        hint: 'At least 12 characters. Send it to them separately, and have them change it.' }],
      submitLabel: 'Set password',
      onSubmit: async (v) => api(`/users/${u.id}/password`, { method: 'POST', body: JSON.stringify(v) }),
    });
    if (r) { toast(`Password reset for ${r.username}`, 'ok'); load(); }
  }

  async function onDeactivate(u) {
    const r = await modal({
      title: `Disable ${u.username}?`,
      subtitle: 'The account is kept so the alarm and event history still resolves — it just cannot sign in.',
      fields: [],
      submitLabel: 'Disable account',
      danger: true,
      note: `${u.name} will be signed out immediately. You can re-enable the account later from Edit.`,
      onSubmit: async () => api(`/users/${u.id}`, { method: 'DELETE' }),
    });
    if (r) { toast(`Disabled ${r.username}`, 'ok'); load(); }
  }

  load();
  return {};
}
