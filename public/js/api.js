/** REST client + live WebSocket store. Reconnects with backoff, because a
 *  4G/5G link in Tanjung Manis will drop and the wall display must recover
 *  on its own without anyone walking to the control room. */

const KEY = 'hydroflow.token';
export const store = {
  token: localStorage.getItem(KEY) || null,
  user: null,
  meta: null,
  values: {},          // tagId -> { v, q, src }
  context: {},
  alarmSummary: { total: 0, unacked: 0, critical: 0, warning: 0, serious: 0, worst: null },
  connected: false,
  lastTick: 0,
  /** rolling in-memory buffer for sparklines — 240 points ≈ 12 min at a 3 s scan */
  buffer: new Map(),
};

const subs = new Set();
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = (evt) => { for (const fn of subs) { try { fn(evt); } catch (e) { console.error(e); } } };

export function setToken(t) { store.token = t; t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); }

export async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(store.token ? { authorization: `Bearer ${store.token}` } : {}), ...opts.headers },
  });
  if (res.status === 401) { setToken(null); store.user = null; emit({ type: 'logout' }); throw new Error('Session expired — please sign in again'); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
  return res.json();
}

export const login = async (username, password) => {
  const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  setToken(r.token); store.user = r.user; return r.user;
};
export const history = (tags, from, to, points = 700) =>
  api(`/history?tag=${encodeURIComponent([].concat(tags).join(','))}&from=${Math.round(from)}&to=${Math.round(to)}&points=${points}`);

/* ── live socket ────────────────────────────────────────────────────────── */
let ws = null, retry = 0, timer = null;
const BUF_MAX = 240;

export function connectLive() {
  if (!store.token) return;
  clearTimeout(timer);
  try { ws?.close(); } catch { /* noop */ }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(store.token)}`);

  ws.onopen = () => { retry = 0; store.connected = true; emit({ type: 'conn', connected: true }); };
  ws.onclose = (e) => {
    store.connected = false; emit({ type: 'conn', connected: false });
    if (e.code === 4401) { setToken(null); emit({ type: 'logout' }); return; }
    const delay = Math.min(15000, 800 * 2 ** retry++);
    timer = setTimeout(connectLive, delay);
  };
  ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'tick' || msg.type === 'hello') {
      store.values = msg.values; store.context = msg.context;
      store.alarmSummary = msg.alarms; store.lastTick = msg.ts;
      for (const [tag, s] of Object.entries(msg.values)) {
        if (s.v === null) continue;
        let b = store.buffer.get(tag);
        if (!b) { b = []; store.buffer.set(tag, b); }
        b.push([msg.ts, s.v]);
        if (b.length > BUF_MAX) b.shift();
      }
      emit({ type: 'tick' });
    } else emit(msg);
  };
}

export function closeLive() { clearTimeout(timer); try { ws?.close(); } catch { /* noop */ } ws = null; }

/* ── convenience accessors ──────────────────────────────────────────────── */
export const val = (tagId) => store.values[tagId]?.v ?? null;
export const quality = (tagId) => store.values[tagId]?.q ?? 0;
export const buf = (tagId) => store.buffer.get(tagId) || [];
export const tag = (tagId) => store.meta?.tagMap?.[tagId];
export const ctx = () => store.context || {};
export const can = (perm) => store.user?.perms?.includes(perm);
