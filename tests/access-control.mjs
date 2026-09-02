/**
 * Access-control tests. These assert the guards, not the happy path — the
 * happy path failing is obvious, a guard failing silently is not.
 *
 *   node tests/access-control.mjs            (server must already be running)
 */
const BASE = process.env.BASE || 'http://localhost:3000';
const PW = process.env.DEFAULT_PASSWORD || 'hydroflow2026';

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  PASS  ${name}`); };
const bad = (name, detail) => { fail++; console.log(`  FAIL  ${name}\n        ${detail}`); };

async function call(path, { token, method = 'GET', body } = {}) {
  const r = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch { /* no body */ }
  return { status: r.status, json };
}
const login = async (u, p) => (await call('/auth/login', { method: 'POST', body: { username: u, password: p } })).json;

async function expect(name, fn, check) {
  try {
    const res = await fn();
    const problem = check(res);
    problem ? bad(name, problem) : ok(name);
    return res;
  } catch (e) { bad(name, e.message); return null; }
}

console.log('\nACCESS CONTROL\n');

const admin = await login('admin', PW);
if (!admin?.token) { console.log('  cannot sign in as admin — is the server running with a fresh database?'); process.exit(1); }
const A = admin.token;
const operator = await login('operator', PW);
const O = operator?.token;

/* ── role separation ─────────────────────────────────────────────────── */
await expect('admin can list users', () => call('/users', { token: A }),
  (r) => r.status === 200 && Array.isArray(r.json) ? null : `got ${r.status}`);

await expect('operator CANNOT list users', () => call('/users', { token: O }),
  (r) => r.status === 403 ? null : `expected 403, got ${r.status}`);

await expect('operator CANNOT create a user', () => call('/users', { token: O, method: 'POST',
  body: { username: 'sneaky', name: 'X', role: 'admin', password: 'aaaaaaaaaaaa' } }),
  (r) => r.status === 403 ? null : `expected 403, got ${r.status}`);

await expect('unauthenticated is refused', () => call('/users'),
  (r) => r.status === 401 ? null : `expected 401, got ${r.status}`);

/* ── creation & validation ───────────────────────────────────────────── */
const created = await expect('admin creates a user', () => call('/users', { token: A, method: 'POST',
  body: { username: 'testpic', name: 'Test PIC', email: 't@x.my', role: 'technician', password: 'a-good-long-pw' } }),
  (r) => r.status === 200 && r.json.username === 'testpic' ? null : `got ${r.status} ${JSON.stringify(r.json)}`);
const newId = created?.json?.id;

await expect('duplicate username refused', () => call('/users', { token: A, method: 'POST',
  body: { username: 'testpic', name: 'Dup', role: 'operator', password: 'a-good-long-pw' } }),
  (r) => r.status === 409 ? null : `expected 409, got ${r.status}`);

await expect('short password refused', () => call('/users', { token: A, method: 'POST',
  body: { username: 'shorty', name: 'S', role: 'operator', password: 'short' } }),
  (r) => r.status === 400 ? null : `expected 400, got ${r.status}`);

await expect('bad username refused', () => call('/users', { token: A, method: 'POST',
  body: { username: 'Has Spaces!', name: 'S', role: 'operator', password: 'a-good-long-pw' } }),
  (r) => r.status === 400 ? null : `expected 400, got ${r.status}`);

await expect('unknown role refused', () => call('/users', { token: A, method: 'POST',
  body: { username: 'weird', name: 'S', role: 'superuser', password: 'a-good-long-pw' } }),
  (r) => r.status === 400 ? null : `expected 400, got ${r.status}`);

await expect('new user can sign in', async () => ({ json: await login('testpic', 'a-good-long-pw') }),
  (r) => r.json?.token ? null : 'no token returned');

/* ── last-admin lockout guards ───────────────────────────────────────── */
const adminRow = (await call('/users', { token: A })).json.find((u) => u.username === 'admin');

await expect('last admin CANNOT be demoted', () => call(`/users/${adminRow.id}`, { token: A, method: 'PATCH', body: { role: 'operator' } }),
  (r) => r.status === 409 ? null : `expected 409, got ${r.status} ${JSON.stringify(r.json)}`);

await expect('last admin CANNOT be deactivated', () => call(`/users/${adminRow.id}`, { token: A, method: 'PATCH', body: { active: false } }),
  (r) => r.status === 409 ? null : `expected 409, got ${r.status}`);

await expect('admin CANNOT disable their own account', () => call(`/users/${adminRow.id}`, { token: A, method: 'DELETE' }),
  (r) => r.status === 409 ? null : `expected 409, got ${r.status}`);

// promote a second admin, then the guard should relax
await call(`/users/${newId}`, { token: A, method: 'PATCH', body: { role: 'admin' } });
await expect('with two admins, demotion is allowed', () => call(`/users/${adminRow.id}`, { token: A, method: 'PATCH', body: { role: 'admin' } }),
  (r) => r.status === 200 ? null : `got ${r.status}`);
await call(`/users/${newId}`, { token: A, method: 'PATCH', body: { role: 'technician' } });

/* ── self-service ────────────────────────────────────────────────────── */
await expect('wrong current password refused', () => call('/me/password', { token: O, method: 'POST',
  body: { current: 'definitely-wrong', password: 'a-brand-new-password' } }),
  (r) => r.status === 403 ? null : `expected 403, got ${r.status}`);

await expect('new password must differ', () => call('/me/password', { token: O, method: 'POST',
  body: { current: PW, password: PW } }),
  (r) => r.status === 400 ? null : `expected 400, got ${r.status}`);

await expect('operator can edit own name', () => call('/me', { token: O, method: 'PATCH', body: { name: 'Renamed Operator' } }),
  (r) => r.status === 200 && r.json.name === 'Renamed Operator' ? null : `got ${r.status}`);

// /me accepts the request but must ignore `role` entirely — verified below.
await call('/me', { token: O, method: 'PATCH', body: { role: 'admin' } });
{
  const after = (await call('/users', { token: A })).json.find((u) => u.username === 'operator');
  after.role === 'operator' ? ok('operator CANNOT self-promote via /me') : bad('operator CANNOT self-promote via /me', `role became ${after.role}`);
}

/* ── session invalidation ────────────────────────────────────────────── */
const opChange = await call('/me/password', { token: O, method: 'POST', body: { current: PW, password: 'operator-new-pass-1' } });
opChange.status === 200 && opChange.json.token ? ok('own password change returns a fresh token') : bad('own password change', `got ${opChange.status}`);

await new Promise((r) => setTimeout(r, 1100));   // JWT iat has 1-second resolution

await expect('OLD token is rejected after password change', () => call('/live', { token: O }),
  (r) => r.status === 401 ? null : `expected 401, got ${r.status}`);

await expect('NEW token still works', () => call('/live', { token: opChange.json.token }),
  (r) => r.status === 200 ? null : `expected 200, got ${r.status}`);

await expect('old password no longer signs in', async () => ({ json: await login('operator', PW) }),
  (r) => r.json?.error ? null : 'old password still works');

/* ── deactivation ends access ────────────────────────────────────────── */
const picLogin = await login('testpic', 'a-good-long-pw');
await call(`/users/${newId}`, { token: A, method: 'DELETE' });
await new Promise((r) => setTimeout(r, 1100));

await expect('deactivated user token is rejected', () => call('/live', { token: picLogin.token }),
  (r) => r.status === 401 ? null : `expected 401, got ${r.status}`);

await expect('deactivated user cannot sign in', async () => ({ json: await login('testpic', 'a-good-long-pw') }),
  (r) => r.json?.error ? null : 'deactivated user signed in');

/* ── audit trail ─────────────────────────────────────────────────────── */
const events = (await call('/events?limit=60', { token: A })).json;
const kinds = new Set(events.map((e) => e.type));
['user.create', 'user.update', 'user.password-change', 'user.deactivate'].every((k) => kinds.has(k))
  ? ok('every user action is journalled')
  : bad('audit trail', `missing: ${['user.create','user.update','user.password-change','user.deactivate'].filter((k) => !kinds.has(k)).join(', ')}`);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
