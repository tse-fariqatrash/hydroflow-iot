/** Pieces used by more than one page. */
import { h, icon, num, pill, seriesColor, tagSeverity, formatTagValue, fmtHM, ago } from '../ui.js';
import { store, val, quality, buf, ctx, history } from '../api.js';
import { TimeSeriesChart, sparkline, legend } from '../charts.js';

export const T = (id) => store.meta?.tagMap?.[id];

/**
 * Energy colour semantics — one meaning per hue, everywhere.
 *
 *   solar  → slot 4 (yellow)   battery → slot 3 (aqua)   grid → slot 7 (violet)
 *   load   → neutral ink, because it is the sum of the three, not a fourth source.
 *
 * This trio was chosen over the obvious blue/green/orange because it is the set
 * that clears the all-pairs colour-blindness floor in BOTH themes. Blue (slot 1)
 * and violet (slot 7) measure ΔE 9.8 against each other on the dark surface —
 * below the 15 floor — so they must never encode two sources on the same figure.
 */
export const ENERGY = { solar: 4, battery: 3, grid: 7, exported: 3 };

/** A single live readout: name, value, unit, severity dot. */
export function readout(tagId, { compact = false, showTag = true } = {}) {
  const t = T(tagId);
  if (!t) return h('div', {}, tagId);
  const v = val(tagId);
  const q = quality(tagId);
  const sev = q === 0 ? 'offline' : tagSeverity(t, v, store.values);
  const row = h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', padding: compact ? '3px 0' : '5px 0' } },
    h('span', { class: 'dot', style: { background: `var(--${sev === 'good' ? 'good' : sev})`, alignSelf: 'center' }, title: sev }),
    h('span', { style: { fontSize: compact ? '12px' : '12.5px', color: 'var(--text-secondary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t.name),
    showTag ? h('span', { class: 'tag-chip' }, t.id) : null,
    h('span', { class: 'mono', style: { fontWeight: 600, fontSize: '12.5px', minWidth: '58px', textAlign: 'right' } },
      q === 0 ? '—' : formatTagValue(t, v)),
    t.unit ? h('span', { style: { fontSize: '10.5px', color: 'var(--text-muted)', minWidth: '32px' } }, t.unit) : null);
  row.title = `${t.id} — ${t.desc || t.name}`;
  return row;
}

/** Live KPI tile with a rolling sparkline from the in-memory buffer. */
export function liveTile({ label, tagId, unit, precision, transform, slot = 1, meta, icon: ic, limitHi }) {
  const t = T(tagId);
  const raw = val(tagId);
  const v = transform ? transform(raw) : raw;
  const sev = t ? tagSeverity(t, raw, store.values) : 'good';
  const data = buf(tagId).map(([ts, x]) => [ts, transform ? transform(x) : x]);
  const el = h('div', { class: 'card stat' },
    h('div', { class: 'label' }, ic ? icon(ic, 12) : null, label),
    h('div', { class: 'value' }, v === null ? '—' : num(v, precision ?? t?.precision ?? 1),
      h('span', { class: 'unit' }, unit ?? t?.unit ?? '')),
    meta ? h('div', { class: 'meta' }, meta) : null,
    h('div', { class: 'spark' }, sparkline(data, { color: seriesColor(slot), limitHi: limitHi ?? null })));
  if (sev === 'critical' || sev === 'warning') {
    el.appendChild(h('div', { style: { position: 'absolute', top: '12px', right: '12px' } },
      pill(sev === 'critical' ? 'Critical' : 'Warning', sev, 'alert')));
  }
  return el;
}

/** Time-range selector shared by every historical view. */
export const RANGES = [
  { key: '1h', label: '1H', ms: 3600e3 },
  { key: '6h', label: '6H', ms: 6 * 3600e3 },
  { key: '24h', label: '24H', ms: 24 * 3600e3 },
  { key: '3d', label: '3D', ms: 3 * 86400e3 },
  { key: '7d', label: '7D', ms: 7 * 86400e3 },
  { key: '14d', label: '14D', ms: 14 * 86400e3 },
];
export function rangePicker(activeKey, onChange) {
  const el = h('div', { class: 'seg' }, RANGES.map((r) =>
    h('button', { class: r.key === activeKey ? 'active' : '', onclick: () => {
      for (const b of el.children) b.classList.remove('active');
      el.querySelector(`[data-k="${r.key}"]`)?.classList.add('active');
      onChange(r);
    }, dataset: { k: r.key } }, r.label)));
  return el;
}

/**
 * A historical chart card that owns its own fetch + range state.
 * `series` is [{ tag, label, slot, area, dashed }].
 */
export function historyCard({ title, hint, series, rangeKey = '24h', height = 240, stack = false, limits = [], unit = '', yMin, yMax, zeroLine = false }) {
  const chartHost = h('div', { class: 'chart', style: { height: `${height}px` } });
  const legendHost = h('div', { style: { marginTop: '10px' } });
  const hidden = new Set();
  let chart = null, range = RANGES.find((r) => r.key === rangeKey) || RANGES[2];

  const load = async () => {
    const to = Date.now(), from = to - range.ms;
    let res;
    try { res = await history(series.map((s) => s.tag), from, to, 700); }
    catch { chartHost.innerHTML = '<div class="empty">History unavailable</div>'; return; }
    const built = series.map((s, i) => ({
      key: s.tag, label: s.label, slot: s.slot ?? i + 1, unit: s.unit ?? unit,
      precision: T(s.tag)?.precision ?? 2, data: res.series[s.tag] || [], area: series.length === 1 || stack, dashed: s.dashed,
    }));
    const opts = { series: built, from, to, height, stack, limits, unit, yMin, yMax, hidden, zeroLine };
    if (chart) chart.update(opts); else chart = new TimeSeriesChart(chartHost, opts);
    if (series.length >= 2) {
      const toggle = (k) => {
        hidden.has(k) ? hidden.delete(k) : hidden.add(k);
        chart.update({ hidden });
        legendHost.replaceChildren(legend(built, { hidden, onToggle: toggle }));
      };
      legendHost.replaceChildren(legend(built, { hidden, onToggle: toggle }));
    }
  };

  const card = h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h3', {}, title), hint ? h('span', { class: 'hint' }, hint) : null,
      h('span', { class: 'spacer' }),
      rangePicker(range.key, (r) => { range = r; load(); })),
    chartHost, legendHost);
  load();
  card.reload = load;
  return card;
}

/** Health of one subsystem: worst severity across its tags. */
export function areaHealth(areaId) {
  const tags = (store.meta?.tags || []).filter((t) => t.area === areaId && !t.hidden);
  let worst = 'good', offline = 0, n = 0;
  const rank = { good: 0, warning: 1, serious: 2, critical: 3 };
  for (const t of tags) {
    const q = quality(t.id);
    if (q === 0) { offline++; continue; }
    n++;
    const s = tagSeverity(t, val(t.id), store.values);
    if (rank[s] > rank[worst]) worst = s;
  }
  return { severity: n === 0 ? 'offline' : worst, offline, online: n, total: tags.length };
}

export function sectionTitle(text, right) {
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', margin: '6px 2px 0' } },
    h('h2', { style: { fontSize: '12px', textTransform: 'uppercase', letterSpacing: '.09em', color: 'var(--text-muted)', margin: 0, fontWeight: 600 } }, text),
    h('div', { style: { flex: 1, height: '1px', background: 'var(--border)' } }),
    right || null);
}

export function kv(pairs) {
  return h('dl', { class: 'kv' }, pairs.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v ?? '—')]));
}
