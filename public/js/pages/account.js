/* My Account — self-service profile and password.
   Role and active status are deliberately not editable here; those are an
   administrator's decision, not the account holder's. */

import { h, icon, pill, fmtFull, ago, modal, toast, setChildren } from '../ui.js';
import { store, api, setToken } from '../api.js';
import { sectionTitle, kv } from './_shared.js';

export default function account(root) {
  const profileCard = h('div', { class: 'card' });
  const securityCard = h('div', { class: 'card' });
  const accessCard = h('div', { class: 'card' });

  root.append(
    h('div', { class: 'grid g2' }, profileCard, securityCard),
    h('div', { style: { marginTop: '20px' } }, sectionTitle('What this account can do')),
    h('div', { style: { marginTop: '10px' } }, accessCard));

  function paint() {
    const u = store.user || {};

    setChildren(profileCard,
      h('div', { class: 'card-head' }, h('h3', {}, 'Profile'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn sm', onclick: onEditProfile }, icon('settings', 13), 'Edit')),
      kv([
        ['Username', h('span', { class: 'mono' }, u.username || '—')],
        ['Full name', u.name || '—'],
        ['Email', u.email || h('span', { class: 'muted' }, 'not set')],
        ['Role', u.label || u.role || '—'],
        ['Access scope', u.scope || '—'],
      ]),
      h('div', { class: 'footnote', style: { marginTop: '12px' } },
        'Your username cannot be changed — it is the identity every alarm acknowledgement and command in the event log is recorded against. Your role can only be changed by an administrator.'));

    setChildren(securityCard,
      h('div', { class: 'card-head' }, h('h3', {}, 'Password'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn sm primary', onclick: onChangePassword }, icon('shield', 13), 'Change password')),
      h('div', { style: { fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.6 } },
        h('p', { style: { margin: '0 0 10px' } },
          'Changing your password signs out every other session for this account — another browser, a phone, the control-room display. This one stays signed in.'),
        h('p', { style: { margin: 0 } },
          'Minimum 12 characters. There is no password-reset email: if you lock yourself out, an administrator resets it for you.')),
      h('div', { style: { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border)' } },
        kv([
          ['Signed in as', h('span', { class: 'mono' }, u.username || '—')],
          ['Session expires', 'after 12 hours idle or on password change'],
        ])));

    const perms = u.perms || [];
    const capabilities = [
      { label: 'View live data, trends, alarms and reports', has: true, note: 'every signed-in account' },
      { label: 'Acknowledge alarms', has: perms.includes('operate') },
      { label: 'Issue device commands', has: perms.includes('operate') },
      { label: 'Create and edit user accounts', has: perms.includes('admin') },
    ];
    setChildren(accessCard,
      h('div', { class: 'card-head' }, h('h3', {}, u.label || u.role || 'Access'),
        h('span', { class: 'hint' }, u.scope || '')),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px' } },
        capabilities.map((c) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '9px', fontSize: '12.5px' } },
          h('span', { style: { color: c.has ? 'var(--good)' : 'var(--text-muted)', display: 'grid', placeItems: 'center' } },
            icon(c.has ? 'check' : 'x', 14)),
          h('span', { style: { color: c.has ? 'var(--text-primary)' : 'var(--text-muted)' } }, c.label),
          c.note ? h('span', { class: 'muted', style: { fontSize: '11px', marginLeft: 'auto' } }, c.note) : null))));
  }

  async function onEditProfile() {
    const u = store.user || {};
    const r = await modal({
      title: 'Edit your profile',
      fields: [
        { key: 'name', label: 'Full name', value: u.name || '', required: true },
        { key: 'email', label: 'Email', type: 'email', value: u.email || '',
          hint: 'Used to identify you in reports. No mail is sent from this system.' },
      ],
      onSubmit: async (v) => api('/me', { method: 'PATCH', body: JSON.stringify(v) }),
    });
    if (r) {
      Object.assign(store.user, { name: r.name, email: r.email });
      toast('Profile updated', 'ok');
      paint();
    }
  }

  async function onChangePassword() {
    const r = await modal({
      title: 'Change your password',
      subtitle: 'You will stay signed in here. Every other session for this account ends.',
      fields: [
        { key: 'current', label: 'Current password', type: 'password', required: true, autocomplete: 'current-password' },
        { key: 'password', label: 'New password', type: 'password', required: true, autocomplete: 'new-password',
          hint: 'At least 12 characters, and different from your current one.' },
        { key: 'confirm', label: 'Confirm new password', type: 'password', required: true, autocomplete: 'new-password' },
      ],
      submitLabel: 'Change password',
      onSubmit: async (v) => {
        if (v.password !== v.confirm) throw new Error('The two new passwords do not match.');
        const res = await api('/me/password', { method: 'POST', body: JSON.stringify({ current: v.current, password: v.password }) });
        // The server issues a fresh token so this session survives its own change.
        if (res.token) setToken(res.token);
        return res;
      },
    });
    if (r) toast('Password changed — other sessions signed out', 'ok');
  }

  paint();
  return { onTick: null };
}
