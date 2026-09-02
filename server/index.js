/**
 * HYDROFLOW TANJUNG MANIS — IoT MONITORING & ENERGY MANAGEMENT SERVER
 * -----------------------------------------------------------------------------
 * Twilight Solar Energy (JS Holding Berhad) · design basis: USM School of
 * Electrical & Electronic Engineering, Feb 2025.
 *
 *   HTTP  :3000   dashboard + REST API + WebSocket
 *   MQTT  :1883   field ingest from the Edge IoT Gateway
 */

import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALL_TAGS, TAGS, TAG_MAP, AREAS, DEVICES, DESIGN, ROLES, CELL_TAGS, TEMP_TAGS } from './tags.js';
import { openDb, Historian, logEvent } from './db.js';
import { AlarmEngine } from './alarms.js';
import { makeAuth, seedUsers, requirePerm } from './auth.js';
import { makeUsers, UserError, MIN_PASSWORD } from './users.js';
import { PlantModel } from './sim.js';
import { startMqtt } from './mqtt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CFG = {
  port: +(process.env.PORT || 3000),
  mqttPort: +(process.env.MQTT_PORT || 1883),
  dbFile: process.env.DB_FILE || path.join(__dirname, '..', 'data', 'hydroflow.db'),
  secret: process.env.JWT_SECRET || 'change-me-in-production-hydroflow',
  simulator: (process.env.SIMULATOR ?? 'on') !== 'off',
  scanMs: +(process.env.SCAN_INTERVAL_MS || 3000),
  persistMs: +(process.env.PERSIST_INTERVAL_MS || 60000),
  retentionDays: +(process.env.RETENTION_DAYS || 30),
  seedDays: +(process.env.SEED_DAYS || 14),
  mqttUser: process.env.MQTT_USERNAME || null,
  mqttPass: process.env.MQTT_PASSWORD || null,
};

/* ── boot ─────────────────────────────────────────────────────────────────── */
const db = openDb(CFG.dbFile);
const hist = new Historian(db, { retentionDays: CFG.retentionDays });
const alarms = new AlarmEngine(db, ALL_TAGS.filter((t) => t.sim?.model !== 'offline'));
const auth = makeAuth(db, CFG.secret);
seedUsers(db);
const users = makeUsers(db);

const model = new PlantModel();
/** Live value cache: tagId -> { v, ts, q, src } (q: 192 Good, 68 Uncertain, 0 Bad/offline) */
const live = new Map();
/** Tags that a real field device has claimed — simulator stops writing these. */
const claimed = new Map();   // tagId -> { device, ts }
let context = {};
let lastPersist = 0;
const persistBuffer = [];

const deviceState = new Map(DEVICES.map((d) => [d.id, { status: d.scope === 'future' ? 'not-installed' : 'simulated', lastSeen: null, rx: 0 }]));

/* ── history seeding ──────────────────────────────────────────────────────── */
function seedHistory() {
  const existing = db.prepare('SELECT COUNT(*) c FROM samples').get().c;
  if (existing > 5000) { console.log(`[seed] historian already holds ${existing.toLocaleString()} samples — skipping`); return; }
  console.log(`[seed] generating ${CFG.seedDays} days of plant history…`);
  const now = Date.now();
  const seedModel = new PlantModel();
  // Coarse far back, fine near the present — so long trends are cheap and
  // recent trends are smooth.
  const segments = [
    { fromDaysAgo: CFG.seedDays, toDaysAgo: 3, stepS: 900 },   // 15 min
    { fromDaysAgo: 3, toDaysAgo: 0.25, stepS: 120 },           // 2 min
    { fromDaysAgo: 0.25, toDaysAgo: 0, stepS: 30 },            // 30 s
  ];
  // warm the model up so tanks/battery are not at their initial values
  let t = now - CFG.seedDays * 86400000 - 2 * 86400000;
  for (let i = 0; i < 2 * 24 * 30; i++) { seedModel.step(t, 120); t += 120000; }

  const rows = [];
  let written = 0;
  for (const seg of segments) {
    let ts = now - seg.fromDaysAgo * 86400000;
    const end = now - seg.toDaysAgo * 86400000;
    while (ts < end) {
      const out = seedModel.step(ts, seg.stepS);
      for (const [tag, v] of Object.entries(out)) {
        if (Number.isFinite(v)) rows.push({ tag, ts, v: +v.toFixed(4), q: 192 });
      }
      // Replay the alarm engine over the seeded history so the journal, the
      // acknowledgement workflow and the alarm-rate report all have something
      // real to work with on first boot.
      alarms.evaluate(out, ts);
      if (rows.length > 40000) { hist.write(rows.splice(0)); written += 40000; }
      ts += seg.stepS * 1000;
    }
  }
  hist.write(rows); written += rows.length;
  const nAl = db.prepare('SELECT COUNT(*) c FROM alarms').get().c;
  console.log(`[seed] wrote ${written.toLocaleString()} samples and ${nAl} alarm records — compacting rollups…`);
  hist.compact(now);
  rebuildDaily();
  console.log('[seed] done');
}

/**
 * Recompute the daily energy / water table from the historian.
 *
 * Integrates each series with the trapezoid rule rather than AVG × 24 — the
 * seeded history is deliberately non-uniform (30 s near the present, 15 min far
 * back) and a plain average would weight a sparse night the same as a dense
 * morning peak. Gaps longer than an hour are not bridged, so a comms outage
 * under-reports rather than inventing energy that was never measured.
 */
const DAILY_TAGS = ['EM-1008', 'EM-1011', 'EM-1010', 'EM-8003', 'QT-8004', 'FT-6009', 'FT-7001', 'QT-2001'];

function integrateByDay(tag) {
  const tz = DESIGN.site.tzOffset * 3600000;
  const rows = db.prepare('SELECT ts, v FROM samples WHERE tag=? AND v IS NOT NULL ORDER BY ts').all(tag);
  const acc = new Map();   // day -> { pos, neg, max, min, n }
  const dayOf = (ts) => new Date(ts + tz).toISOString().slice(0, 10);
  for (let i = 1; i < rows.length; i++) {
    const dt = (rows[i].ts - rows[i - 1].ts) / 3600000;      // hours
    if (dt <= 0 || dt > 1) continue;                          // do not bridge outages
    const mid = (rows[i].v + rows[i - 1].v) / 2;
    const d = dayOf(rows[i].ts);
    if (!acc.has(d)) acc.set(d, { pos: 0, neg: 0, max: -Infinity, min: Infinity, n: 0 });
    const a = acc.get(d);
    if (mid > 0) a.pos += mid * dt; else a.neg += -mid * dt;
    if (rows[i].v > a.max) a.max = rows[i].v;
    if (rows[i].v < a.min) a.min = rows[i].v;
    a.n++;
  }
  return acc;
}

function rebuildDaily() {
  const byTag = Object.fromEntries(DAILY_TAGS.map((t) => [t, integrateByDay(t)]));
  const days = new Set(Object.values(byTag).flatMap((m) => [...m.keys()]));
  const get = (tag, day) => byTag[tag]?.get(day) || { pos: 0, neg: 0, max: 0, min: 100, n: 0 };
  for (const day of days) {
    const load = get('EM-1011', day).pos;
    const imp = get('EM-1010', day).pos;
    hist.upsertDaily.run({
      day,
      pv: +get('EM-1008', day).pos.toFixed(2),
      load: +load.toFixed(2),
      imp: +imp.toFixed(2),
      exp: +get('EM-1010', day).neg.toFixed(2),
      chg: +get('EM-8003', day).pos.toFixed(2),
      dsch: +get('EM-8003', day).neg.toFixed(2),
      prod: +get('FT-6009', day).pos.toFixed(2),
      deliv: +get('FT-7001', day).pos.toFixed(2),
      rain: +get('QT-2001', day).pos.toFixed(1),
      peak: +Math.max(0, get('EM-1011', day).max).toFixed(2),
      minsoc: +Math.min(100, get('QT-8004', day).min).toFixed(1),
      // Share of the site's electricity that came from PV + battery rather than the grid.
      auto: +(load > 0 ? Math.min(100, Math.max(0, (1 - imp / load) * 100)) : 100).toFixed(1),
    });
  }
}

/**
 * Restore the model's day-to-date counters from the historian.
 *
 * Without this, restarting the server at 15:00 would report "0.0 kWh generated
 * today" — the counters would restart from the boot instant rather than from
 * local midnight. Integrating the stored samples for the current local day
 * makes a restart invisible on the dashboard.
 */
function restoreTodayCounters() {
  const tz = DESIGN.site.tzOffset * 3600000;
  const now = Date.now();
  const midnight = Math.floor((now + tz) / 86400000) * 86400000 - tz;
  const integrate = (tag, sign = 1) => {
    const rows = db.prepare('SELECT ts, v FROM samples WHERE tag=? AND ts BETWEEN ? AND ? AND v IS NOT NULL ORDER BY ts').all(tag, midnight, now);
    let acc = 0;
    for (let i = 1; i < rows.length; i++) {
      const dt = (rows[i].ts - rows[i - 1].ts) / 3600000;
      if (dt <= 0 || dt > 1) continue;
      const mid = ((rows[i].v + rows[i - 1].v) / 2) * sign;
      if (mid > 0) acc += mid * dt;
    }
    return +acc.toFixed(4);
  };
  model.s.kwh = {
    pvToday: integrate('EM-1008'), loadToday: integrate('EM-1011'),
    importToday: integrate('EM-1010'), exportToday: integrate('EM-1010', -1),
    chgToday: integrate('EM-8003'), dschToday: integrate('EM-8003', -1),
  };
  model.s.m3 = { producedToday: integrate('FT-6009'), deliveredToday: integrate('FT-7001') };
  model.s.lastDay = Math.floor((now + tz) / 86400000);
  console.log(`[restore] day-to-date: ${model.s.kwh.pvToday.toFixed(1)} kWh PV, ` +
              `${model.s.m3.deliveredToday.toFixed(2)} m³ delivered since local midnight`);
}

/* ── scan loop ────────────────────────────────────────────────────────────── */
function scan() {
  const now = Date.now();
  if (CFG.simulator) {
    const out = model.step(now, CFG.scanMs / 1000);
    context = model.context;
    for (const [tag, v] of Object.entries(out)) {
      if (claimed.has(tag)) continue;              // a real device owns this point
      live.set(tag, { v, ts: now, q: 192, src: 'sim' });
    }
  }
  // RO instrumentation is wired but the skid is not installed — report explicitly.
  for (const t of ALL_TAGS) if (t.sim?.model === 'offline' && !claimed.has(t.id)) {
    live.set(t.id, { v: null, ts: now, q: 0, src: 'offline' });
  }
  // Expire tags whose device went quiet for > 90 s.
  for (const [tag, c] of claimed) if (now - c.ts > 90000) claimed.delete(tag);

  const values = Object.fromEntries([...live].filter(([, s]) => s.v !== null).map(([k, s]) => [k, s.v]));
  const { raised, cleared } = alarms.evaluate(values, now);

  if (now - lastPersist >= CFG.persistMs) {
    lastPersist = now;
    const rows = [];
    for (const [tag, s] of live) if (s.v !== null && Number.isFinite(s.v)) rows.push({ tag, ts: now, v: +s.v.toFixed(4), q: s.q });
    hist.write(rows);
  }

  broadcast({ type: 'tick', ts: now, values: snapshot(), context: publicContext(), alarms: alarms.summary() });
  if (raised.length) broadcast({ type: 'alarm', raised, cleared });
  else if (cleared.length) broadcast({ type: 'alarm', raised: [], cleared });
}

function snapshot() {
  const o = {};
  for (const [tag, s] of live) o[tag] = { v: s.v === null ? null : +s.v.toFixed(4), q: s.q, src: s.src };
  return o;
}

function publicContext() {
  const c = context;
  if (!c || !c.kwh) return {};
  return {
    pvAC: +(c.pvAC ?? 0).toFixed(3), load: +(c.load ?? 0).toFixed(3),
    battKW: +(c.battKW ?? 0).toFixed(3), gridKW: +(c.gridKW ?? 0).toFixed(3),
    pumpKW: +(c.pumpKW ?? 0).toFixed(3), schoolKW: +(c.schoolKW ?? 0).toFixed(3),
    soc: +(c.soc ?? 0).toFixed(1),
    kwh: Object.fromEntries(Object.entries(c.kwh).map(([k, v]) => [k, +v.toFixed(3)])),
    m3: Object.fromEntries(Object.entries(c.m3).map(([k, v]) => [k, +v.toFixed(3)])),
    flows: Object.fromEntries(Object.entries(c.flows || {}).map(([k, v]) => [k, +v.toFixed(3)])),
    stages: Object.fromEntries(Object.entries(c.stages || {}).map(([k, v]) => [k, +v.toFixed(2)])),
    run: c.run, pumpHours: Object.fromEntries(Object.entries(c.pumpHours || {}).map(([k, v]) => [k, +v.toFixed(1)])),
    foulSand: +(c.foulSand ?? 0).toFixed(3), foulMMF: +(c.foulMMF ?? 0).toFixed(3),
    lastBackwashSand: c.lastBackwashSand, lastBackwashMMF: c.lastBackwashMMF,
    cleanPct: +(c.cleanPct ?? 0).toFixed(1), rainPct: +(c.rainPct ?? 0).toFixed(1),
    sedPct: +(c.sedPct ?? 0).toFixed(1), interPct: +(c.interPct ?? 0).toFixed(1),
    tide: +(c.tide ?? 0).toFixed(2), rain: +(c.rain ?? 0).toFixed(1),
    cloud: +(c.cloud ?? 0).toFixed(3), ambient: +(c.ambient ?? 0).toFixed(1),
    poa: +(c.poa ?? 0).toFixed(0), demand: +(c.demand ?? 0).toFixed(3),
    simulator: CFG.simulator, claimed: claimed.size,
  };
}

/* ── HTTP / API ───────────────────────────────────────────────────────────── */
const app = express();
app.use(compression());
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', etag: true }));

const view = requirePerm(auth, null);
const operate = requirePerm(auth, 'operate');
const admin = requirePerm(auth, 'admin');

app.get('/api/health', (_req, res) => res.json({
  ok: true, uptime: process.uptime(), simulator: CFG.simulator,
  tags: ALL_TAGS.length, claimedByDevices: claimed.size,
  historian: hist.stats(), version: '1.0.0',
}));

app.post('/api/auth/login', (req, res) => {
  const r = auth.login(req.body?.username, req.body?.password, req.ip);
  if (!r) return res.status(401).json({ error: 'Invalid username or password' });
  res.json(r);
});
/**
 * The JWT carries only what authorisation needs (sub, role, perms) — profile
 * fields like email are read from the row so the account page shows what is
 * actually stored rather than what happened to be in the token.
 */
app.get('/api/auth/me', view, (req, res) => {
  const row = db.prepare('SELECT id, username, name, email, role, created_at, last_login FROM users WHERE username = ?')
    .get(req.user.sub) || {};
  res.json({ ...req.user, ...row, username: req.user.sub, ...ROLES[req.user.role] });
});

app.get('/api/meta', view, (_req, res) => res.json({
  site: DESIGN.site, design: DESIGN, areas: AREAS, roles: ROLES,
  tags: ALL_TAGS.map(({ sim, ...t }) => t),
  cellTags: CELL_TAGS.map((t) => t.id), tempTags: TEMP_TAGS.map((t) => t.id),
  devices: DEVICES, scanMs: CFG.scanMs,
}));

app.get('/api/live', view, (_req, res) => res.json({ ts: Date.now(), values: snapshot(), context: publicContext(), alarms: alarms.summary() }));

app.get('/api/history', view, (req, res) => {
  const tags = String(req.query.tag || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!tags.length) return res.status(400).json({ error: 'tag parameter required' });
  const to = +req.query.to || Date.now();
  const from = +req.query.from || to - 6 * 3600000;
  const points = Math.min(+req.query.points || 700, 4000);
  const out = {};
  for (const t of tags.slice(0, 12)) {
    if (!TAG_MAP[t]) continue;
    out[t] = hist.series(t, from, to, points).map((r) => [r.ts, r.v == null ? null : +r.v.toFixed(4)]);
  }
  res.json({ from, to, series: out });
});

app.get('/api/alarms', view, (req, res) => res.json(alarms.list({
  state: req.query.state || 'open', area: req.query.area || null, limit: Math.min(+req.query.limit || 200, 1000),
})));
app.get('/api/alarms/summary', view, (_req, res) => res.json(alarms.summary()));
app.post('/api/alarms/:id/ack', operate, (req, res) => {
  const row = alarms.ack(+req.params.id, req.user.sub, req.body?.note);
  logEvent(db, 'alarm.ack', { actor: req.user.sub, target: `alarm:${req.params.id}`, detail: req.body?.note });
  broadcast({ type: 'alarm-ack', id: +req.params.id, by: req.user.sub });
  res.json(row);
});
app.post('/api/alarms/ack-all', operate, (req, res) => {
  const n = alarms.ackAll(req.user.sub);
  logEvent(db, 'alarm.ack-all', { actor: req.user.sub, detail: `${n} alarms` });
  broadcast({ type: 'alarm-ack', all: true, by: req.user.sub });
  res.json({ acknowledged: n });
});

app.get('/api/events', view, (req, res) => res.json(
  db.prepare('SELECT * FROM events ORDER BY ts DESC LIMIT ?').all(Math.min(+req.query.limit || 100, 500))));

app.get('/api/daily', view, (req, res) => res.json(
  db.prepare('SELECT * FROM daily ORDER BY day DESC LIMIT ?').all(Math.min(+req.query.days || 30, 400)).reverse()));

app.get('/api/devices', view, (_req, res) => res.json(DEVICES.map((d) => {
  const st = deviceState.get(d.id) || {};
  const tagCount = ALL_TAGS.filter((t) => t.device === d.id).length;
  return { ...d, ...st, tagCount };
})));

app.get('/api/report/daily', view, (req, res) => {
  const day = req.query.date || new Date(Date.now() + DESIGN.site.tzOffset * 3600000).toISOString().slice(0, 10);
  const row = db.prepare('SELECT * FROM daily WHERE day=?').get(day);
  const start = Date.parse(`${day}T00:00:00Z`) - DESIGN.site.tzOffset * 3600000;
  const end = start + 86400000;
  const al = db.prepare('SELECT * FROM alarms WHERE raised_at BETWEEN ? AND ? ORDER BY raised_at').all(start, end);
  res.json({ day, totals: row || null, alarms: al, generated: Date.now() });
});

app.post('/api/command', operate, (req, res) => {
  const { device, action, value } = req.body || {};
  if (!DEVICES.some((d) => d.id === device)) return res.status(400).json({ error: 'Unknown device' });
  logEvent(db, 'command.issue', { actor: req.user.sub, target: device, detail: `${action}=${value}` });
  mqtt?.publishCommand(device, { action, value, by: req.user.sub, ts: Date.now() });
  broadcast({ type: 'command', device, action, value, by: req.user.sub });
  res.json({ ok: true, dispatched: device, action, value });
});

/* ── users & profile ──────────────────────────────────────────────────────
 * Administrators manage accounts; everyone manages their own profile.
 * Errors carry a UserError status so the client can show the real reason
 * (e.g. "only active administrator") rather than a generic 400.            */
const userRoute = (handler) => (req, res) => {
  try { res.json(handler(req)); }
  catch (e) {
    if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
    console.error('[users]', e);
    res.status(500).json({ error: 'Internal error' });
  }
};

app.get('/api/users', admin, userRoute(() => users.list()));

app.post('/api/users', admin, userRoute((req) => users.create(req.body || {}, req.user.sub)));

app.patch('/api/users/:id', admin, userRoute((req) =>
  users.update(+req.params.id, req.body || {}, req.user.sub)));

app.post('/api/users/:id/password', admin, userRoute((req) =>
  users.setPassword(+req.params.id, req.body?.password, req.user.sub)));

app.delete('/api/users/:id', admin, userRoute((req) => {
  // Deactivate, never delete: the alarm and event journals reference this
  // account by name and must keep resolving.
  if (String(req.user.sub) === String(users.get(+req.params.id).username)) {
    throw new UserError('You cannot deactivate your own account. Ask another administrator.', 409);
  }
  return users.deactivate(+req.params.id, req.user.sub);
}));

/** Own profile — name and email only. Role and active status are not self-service. */
app.patch('/api/me', view, userRoute((req) =>
  users.updateSelf(req.user.sub, req.body || {}, req.user.sub)));

/**
 * Own password. Returns a fresh token so the caller stays signed in — every
 * other session for this account is invalidated by the pw_changed_at stamp.
 */
app.post('/api/me/password', view, (req, res) => {
  try {
    const { current, password } = req.body || {};
    const { user } = users.changeOwnPassword(req.user.sub, current, password, req.user.sub);
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(req.user.sub);
    res.json({ ok: true, user, token: auth.sign(row) });
  } catch (e) {
    if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
    console.error('[users]', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/roles', view, (_req, res) => res.json({ roles: ROLES, minPassword: MIN_PASSWORD }));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

/* ── WebSocket ────────────────────────────────────────────────────────────── */
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const claims = auth.verify(url.searchParams.get('token'));
  if (!claims) { ws.close(4401, 'Unauthorized'); return; }
  ws.user = claims;
  ws.isAlive = true;
  clients.add(ws);
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
  ws.send(JSON.stringify({ type: 'hello', user: claims.sub, role: claims.role,
    ts: Date.now(), values: snapshot(), context: publicContext(), alarms: alarms.summary() }));
});

setInterval(() => {
  for (const ws of clients) {
    if (!ws.isAlive) { ws.terminate(); clients.delete(ws); continue; }
    ws.isAlive = false; try { ws.ping(); } catch { /* noop */ }
  }
}, 30000);

function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const ws of clients) { if (ws.readyState === 1) { try { ws.send(s); } catch { /* noop */ } } }
}

/* ── MQTT ─────────────────────────────────────────────────────────────────── */
let mqtt = null;
try {
  mqtt = startMqtt({
    port: CFG.mqttPort, username: CFG.mqttUser, password: CFG.mqttPass,
    onTelemetry(deviceId, tags, ts) {
      const st = deviceState.get(deviceId) || { rx: 0 };
      st.status = 'online'; st.lastSeen = Date.now(); st.rx = (st.rx || 0) + 1;
      deviceState.set(deviceId, st);
      for (const [tag, v] of Object.entries(tags)) {
        if (!TAG_MAP[tag]) continue;
        const num = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
        if (!Number.isFinite(num)) continue;
        claimed.set(tag, { device: deviceId, ts: Date.now() });
        live.set(tag, { v: num, ts, q: 192, src: deviceId });
      }
    },
    onStatus(deviceId, status) {
      const st = deviceState.get(deviceId) || {};
      st.status = status === 'online' ? 'online' : 'offline';
      st.lastSeen = Date.now();
      deviceState.set(deviceId, st);
      logEvent(db, 'device.status', { actor: 'gateway', target: deviceId, detail: status });
      broadcast({ type: 'device', id: deviceId, status: st.status });
    },
  });
} catch (e) { console.warn(`[mqtt] disabled: ${e.message}`); }

/* ── start ────────────────────────────────────────────────────────────────── */
seedHistory();
restoreTodayCounters();
setInterval(scan, CFG.scanMs);
setInterval(() => { try { hist.compact(); rebuildDaily(); } catch (e) { console.warn('[compact]', e.message); } }, 3600000);
scan();

server.listen(CFG.port, () => {
  console.log(`\n  HYDROFLOW TANJUNG MANIS — IoT Monitoring & EMS`);
  console.log(`  ────────────────────────────────────────────────`);
  console.log(`  Dashboard  http://localhost:${CFG.port}`);
  console.log(`  MQTT       mqtt://localhost:${CFG.mqttPort}`);
  console.log(`  Simulator  ${CFG.simulator ? 'ON (field devices override per-tag)' : 'OFF'}`);
  console.log(`  Tags       ${ALL_TAGS.length} points across ${AREAS.length} areas\n`);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  console.log('\n[shutdown] closing…');
  try { mqtt?.close(); } catch {}
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000);
});
