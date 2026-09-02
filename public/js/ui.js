/** Tiny DOM + formatting layer. No framework: this dashboard must keep running
 *  on a 4G link and an old control-room PC, so there is nothing to download. */

export function h(tag, props = {}, ...children) {
  const isSvg = /^(svg|path|g|rect|circle|line|text|polyline|polygon|defs|linearGradient|stop|clipPath|ellipse|tspan|marker|use|title)$/.test(tag);
  const el = isSvg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (isSvg) el.setAttribute(k, v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(4)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const frag = (...c) => { const f = document.createDocumentFragment(); for (const x of c.flat(4)) if (x) f.appendChild(x); return f; };
export const $ = (sel, root = document) => root.querySelector(sel);
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

/**
 * replaceChildren() stringifies a null child into the literal text "null".
 * Every conditional node in this app goes through here instead.
 */
export const setChildren = (el, ...nodes) => {
  el.replaceChildren(...nodes.flat(4).filter((n) => n !== null && n !== undefined && n !== false));
  return el;
};

/* ── formatting ─────────────────────────────────────────────────────────── */
export const TZ = 'Asia/Kuala_Lumpur';
const dtf = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts });
export const fmtTime = (ts) => dtf({ hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(ts);
export const fmtHM = (ts) => dtf({ hour: '2-digit', minute: '2-digit', hour12: false }).format(ts);
export const fmtDate = (ts) => dtf({ day: '2-digit', month: 'short' }).format(ts);
export const fmtDateTime = (ts) => `${fmtDate(ts)} ${fmtHM(ts)}`;
export const fmtFull = (ts) => dtf({ day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(ts);
export const fmtDayName = (ts) => dtf({ weekday: 'short' }).format(ts);

export function num(v, p = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Number(v).toLocaleString('en-MY', { minimumFractionDigits: p, maximumFractionDigits: p });
}
export function ago(ts) {
  if (!ts) return 'never';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return `${s | 0}s ago`;
  if (s < 3600) return `${(s / 60) | 0}m ago`;
  if (s < 86400) return `${(s / 3600) | 0}h ago`;
  return `${(s / 86400) | 0}d ago`;
}
export function duration(ms) {
  const s = ms / 1000;
  if (s < 60) return `${s | 0}s`;
  if (s < 3600) return `${(s / 60) | 0}m ${((s % 60) | 0)}s`;
  if (s < 86400) return `${(s / 3600) | 0}h ${(((s % 3600) / 60) | 0)}m`;
  return `${(s / 86400) | 0}d ${(((s % 86400) / 3600) | 0)}h`;
}

/** Series colour by slot (1-based). Never generate a 9th. */
export const seriesColor = (i) => `var(--series-${((i - 1) % 8) + 1})`;
export const STATUS_COLOR = { good: 'var(--good)', warning: 'var(--warning)', serious: 'var(--serious)', critical: 'var(--critical)', offline: 'var(--offline)' };

/** Resolve a CSS custom property to a concrete colour (needed for canvas/gradients). */
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name.replace(/^var\(|\)$/g, '')).trim();
}

/* ── icons (Lucide-style, 24×24 stroke) ─────────────────────────────────── */
const P = {
  gauge: 'M12 14l4-4M3.34 19a10 10 0 1 1 17.32 0',
  sun: 'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  rain: 'M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 0 9H7M8 19v2M12 19v3M16 19v2',
  river: 'M2 6c2.5 2.5 5.5 2.5 8 0s5.5-2.5 8 0M2 12c2.5 2.5 5.5 2.5 8 0s5.5-2.5 8 0M2 18c2.5 2.5 5.5 2.5 8 0s5.5-2.5 8 0',
  filter: 'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
  ro: 'M4 6h16M4 12h16M4 18h16M8 3v18M16 3v18',
  tank: 'M5 8h14v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8zM5 8V5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M5 15h14',
  house: 'M3 10.5L12 3l9 7.5M5 9.5V21h14V9.5M9 21v-6h6v6',
  battery: 'M3 7h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM22 11v2M6 10v4M10 10v4',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  chart: 'M3 3v18h18M7 15l4-5 4 3 5-7',
  layers: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  cpu: 'M4 4h16v16H4zM9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  menu: 'M3 12h18M3 6h18M3 18h18',
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  check: 'M20 6L9 17l-5-5',
  alert: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  wifi: 'M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01',
  droplet: 'M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z',
  zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  map: 'M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4zM8 2v16M16 6v16',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  x: 'M18 6L6 18M6 6l12 12',
  wave: 'M2 12s2-4 5-4 3 4 5 4 3-4 5-4 5 4 5 4',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  power: 'M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  slash: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.93 4.93l14.14 14.14',
  thermometer: 'M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z',
};
export function icon(name, size = 16, cls = '') {
  const d = P[name] || P.info;
  return h('svg', { class: cls, width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    h('path', { d }));
}

/* ── shared components ──────────────────────────────────────────────────── */
export function pill(text, kind = '', ico = null) {
  return h('span', { class: `pill ${kind}` }, ico ? icon(ico, 11) : null, text);
}

export function statTile({ label, value, unit, meta, kind, sparkEl, labelIcon }) {
  return h('div', { class: 'card stat' },
    h('div', { class: 'label' }, labelIcon ? icon(labelIcon, 12) : null, label),
    h('div', { class: 'value' }, value, unit ? h('span', { class: 'unit' }, unit) : null),
    meta ? h('div', { class: 'meta' }, meta) : null,
    kind ? h('div', { style: { marginTop: '8px' } }, pill(kind.text, kind.kind, kind.icon)) : null,
    sparkEl ? h('div', { class: 'spark' }, sparkEl) : null);
}

export function emptyState(text, ico = 'info') {
  return h('div', { class: 'empty' }, icon(ico, 34), h('div', {}, text));
}

/**
 * Severity of a value against its tag's alarm limits.
 *
 * `liveValues` lets this honour the same ISA-18.2 state-based suppression the
 * server applies — otherwise the UI paints "discharge pressure low" red on a
 * pump that is simply stopped, and operators learn to ignore red.
 */
export function tagSeverity(tag, v, liveValues = null) {
  if (v === null || v === undefined) return 'offline';
  const a = tag.alarm || {};
  if (a.suppressWhen && liveValues) {
    for (const r of [].concat(a.suppressWhen)) {
      const raw = liveValues[r.tag];
      const ref = raw && typeof raw === 'object' ? raw.v : raw;
      if (ref === undefined || ref === null) continue;
      if (r.equals !== undefined && ref === r.equals) return 'good';
      if (r.below !== undefined && ref < r.below) return 'good';
      if (r.above !== undefined && ref > r.above) return 'good';
    }
  }
  if (tag.kind === 'digital') return a.digitalAlarmOn != null && v === a.digitalAlarmOn ? (a.severity || 'warning') : 'good';
  if ((a.hh != null && v >= a.hh) || (a.ll != null && v <= a.ll)) return 'critical';
  if ((a.h != null && v >= a.h) || (a.l != null && v <= a.l)) return 'warning';
  return 'good';
}

export function formatTagValue(tag, v) {
  if (v === null || v === undefined) return '—';
  if (tag.kind === 'digital') return tag.states ? (tag.states[Math.round(v)] ?? v) : String(v);
  return num(v, tag.precision ?? 1);
}

/**
 * A promise-returning modal. Resolves with the submitted values, or null if
 * dismissed. `fields` is [{ key, label, type, value, hint, options, required }].
 */
export function modal({ title, subtitle, fields = [], submitLabel = 'Save', danger = false, note = null, onSubmit }) {
  return new Promise((resolve) => {
    const err = h('div', { class: 'err', style: { display: 'none' } });
    const inputs = {};

    const body = h('div', { class: 'modal-body' },
      note ? h('div', { class: 'role-help' }, note) : null,
      fields.map((f) => {
        let input;
        if (f.type === 'select') {
          input = h('select', { id: `f-${f.key}` },
            (f.options || []).map((o) => h('option', { value: o.value, selected: o.value === f.value }, o.label)));
        } else if (f.type === 'checkbox') {
          input = h('input', { type: 'checkbox', id: `f-${f.key}`, checked: !!f.value, style: { width: 'auto' } });
        } else {
          input = h('input', { type: f.type || 'text', id: `f-${f.key}`, value: f.value ?? '',
            autocomplete: f.autocomplete || 'off', placeholder: f.placeholder || '' });
        }
        inputs[f.key] = input;
        if (f.type === 'checkbox') {
          return h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' } },
            input, f.label);
        }
        return h('div', { class: 'field', style: { margin: 0 } },
          h('label', { for: `f-${f.key}` }, f.label, f.required ? h('span', { style: { color: 'var(--critical)' } }, ' *') : null),
          input,
          f.hint ? h('div', { class: 'field-hint' }, f.hint) : null);
      }),
      err);

    const submit = h('button', { class: `btn ${danger ? '' : 'primary'}`, type: 'submit',
      style: danger ? { borderColor: 'var(--critical)', color: 'var(--critical)' } : {} }, submitLabel);
    const cancel = h('button', { class: 'btn ghost', type: 'button', onclick: () => close(null) }, 'Cancel');

    const form = h('form', { onsubmit: async (e) => {
      e.preventDefault();
      err.style.display = 'none';
      submit.disabled = true;
      const values = {};
      for (const [k, el] of Object.entries(inputs)) values[k] = el.type === 'checkbox' ? el.checked : el.value;
      try {
        const result = onSubmit ? await onSubmit(values) : values;
        close(result ?? values);
      } catch (ex) {
        clear(err).append(icon('alert', 14), ex.message || String(ex));
        err.style.display = 'flex';
        submit.disabled = false;
      }
    } },
      h('div', { class: 'modal-head' }, h('h3', {}, title), subtitle ? h('p', {}, subtitle) : null),
      body,
      h('div', { class: 'modal-foot' }, cancel, submit));

    const backdrop = h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(null); } },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, form));

    function close(v) { document.removeEventListener('keydown', esc); backdrop.remove(); resolve(v); }
    const esc = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', esc);
    document.body.appendChild(backdrop);
    queueMicrotask(() => { const first = Object.values(inputs)[0]; first?.focus?.(); });
  });
}

export function toast(message, kind = 'info') {
  let host = $('#toasts');
  if (!host) { host = h('div', { id: 'toasts', style: { position: 'fixed', bottom: '18px', right: '18px', zIndex: 200, display: 'flex', flexDirection: 'column', gap: '8px' } }); document.body.appendChild(host); }
  const el = h('div', { class: 'card', style: { padding: '10px 14px', boxShadow: 'var(--shadow)', display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px' } },
    icon(kind === 'error' ? 'alert' : kind === 'ok' ? 'check' : 'info', 15), message);
  if (kind === 'error') el.style.borderColor = 'var(--critical)';
  if (kind === 'ok') el.style.borderColor = 'var(--good)';
  host.appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 320); }, 3600);
}
