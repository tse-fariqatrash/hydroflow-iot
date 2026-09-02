/* ═══════════════════════════════════════════════════════════════════════════
   CHARTS — bespoke SVG, zero dependencies
   ---------------------------------------------------------------------------
   Written by hand rather than pulled from a CDN for three reasons: the plant
   is on a metered 4G link, the control-room browser must work with no internet
   at all, and the house rules below are easier to guarantee than to police.

   House rules (data-viz method):
     · one y-axis, ever — two measures of different scale get two charts
     · categorical colour follows the entity, assigned in fixed slot order
     · thin marks (2 px lines), recessive grid, 4 px rounded bar ends
     · 2 px surface-coloured gap between stacked segments and adjacent bars
     · crosshair + tooltip on every time series; per-mark tooltip on bars
     · legend whenever there are ≥ 2 series; direct labels when ≤ 4
   ═══════════════════════════════════════════════════════════════════════════ */

import { h, fmtHM, fmtDate, fmtFull, num, seriesColor } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const px = (n) => `${Math.round(n * 100) / 100}`;

/* ── scales & ticks ─────────────────────────────────────────────────────── */
function niceTicks(min, max, count = 5) {
  if (!isFinite(min) || !isFinite(max)) return { ticks: [0, 1], min: 0, max: 1 };
  if (min === max) { min -= 0.5; max += 0.5; }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { ticks, min: lo, max: hi, step };
}

function timeTicks(from, to, target = 6) {
  const span = to - from;
  const steps = [60e3, 300e3, 900e3, 1800e3, 3600e3, 3 * 3600e3, 6 * 3600e3, 12 * 3600e3, 86400e3, 2 * 86400e3, 7 * 86400e3];
  const step = steps.find((s) => span / s <= target * 1.6) ?? steps[steps.length - 1];
  const out = [];
  const tzOff = 8 * 3600e3;               // Asia/Kuala_Lumpur — align ticks to local time
  let t = Math.ceil((from + tzOff) / step) * step - tzOff;
  while (t <= to) { out.push(t); t += step; }
  return { ticks: out, daily: step >= 86400e3 };
}

/* ── base ───────────────────────────────────────────────────────────────── */
class Chart {
  constructor(host, opts) {
    this.host = host;
    this.opts = opts;
    this.host.classList.add('chart');
    this.tip = h('div', { class: 'tooltip' });
    this.host.appendChild(this.tip);
    this.ro = new ResizeObserver(() => this.render());
    this.ro.observe(this.host);
    this.render();
  }
  update(opts) { Object.assign(this.opts, opts); this.render(); }
  destroy() { this.ro.disconnect(); this.host.innerHTML = ''; }
  get width() { return Math.max(220, this.host.clientWidth || 640); }
  showTip(x, y, nodes) {
    this.tip.innerHTML = '';
    for (const n of nodes) this.tip.appendChild(n);
    this.tip.classList.add('on');
    const w = this.tip.offsetWidth, hh = this.tip.offsetHeight;
    const hostW = this.host.clientWidth;
    this.tip.style.left = `${Math.min(Math.max(4, x + 14), hostW - w - 4)}px`;
    this.tip.style.top = `${Math.max(2, y - hh - 10)}px`;
  }
  hideTip() { this.tip.classList.remove('on'); }
}

/* ═══ LINE / AREA TIME SERIES ═══════════════════════════════════════════════
   series: [{ key, label, data:[[ts,v]…], slot, unit, precision, area, dashed }]
   limits: [{ value, label, kind }]  — alarm limits drawn as dashed rules      */
export class TimeSeriesChart extends Chart {
  render() {
    const { series = [], height = 240, from, to, unit = '', yMin, yMax, limits = [], hidden = new Set(), stack = false, zeroLine = false } = this.opts;
    const W = this.width, H = height;
    const m = { t: 12, r: 14, b: 24, l: 48 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const vis = series.filter((s) => !hidden.has(s.key));

    const t0 = from ?? Math.min(...vis.flatMap((s) => s.data.map((d) => d[0])).concat(Date.now()));
    const t1 = to ?? Date.now();

    let lo = Infinity, hi = -Infinity;
    if (stack) {
      const byTs = new Map();
      for (const s of vis) for (const [t, v] of s.data) byTs.set(t, (byTs.get(t) || 0) + (v ?? 0));
      for (const v of byTs.values()) { if (v < lo) lo = v; if (v > hi) hi = v; }
      lo = Math.min(lo, 0);
    } else {
      for (const s of vis) for (const [, v] of s.data) { if (v === null) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    for (const L of limits) { if (L.value < lo) lo = L.value; if (L.value > hi) hi = L.value; }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (yMin !== undefined) lo = yMin;
    if (yMax !== undefined) hi = yMax;
    // Pad the range for breathing room, but never below zero for a quantity
    // that cannot be negative — an axis running to −5 000 ppm of dissolved
    // solids is not a scale, it is a mistake.
    const pad = (hi - lo) * 0.08 || 0.5;
    let axisLo = yMin !== undefined ? yMin : lo - pad;
    if (yMin === undefined && lo >= 0) axisLo = Math.max(0, axisLo);
    const yt = niceTicks(axisLo, yMax !== undefined ? yMax : hi + pad, 4);

    const X = (t) => m.l + ((t - t0) / Math.max(1, t1 - t0)) * iw;
    const Y = (v) => m.t + ih - ((v - yt.min) / Math.max(1e-9, yt.max - yt.min)) * ih;

    const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' });
    const defs = h('defs');
    svg.appendChild(defs);

    // gridlines + y labels
    for (const v of yt.ticks) {
      const y = Y(v);
      if (y < m.t - 1 || y > m.t + ih + 1) continue;
      svg.appendChild(h('line', { class: 'gridline', x1: m.l, x2: m.l + iw, y1: px(y), y2: px(y) }));
      svg.appendChild(h('text', { class: 'axis-text', x: m.l - 8, y: px(y + 3.5), 'text-anchor': 'end' },
        Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(+v.toFixed(yt.step < 1 ? 2 : yt.step < 10 ? 1 : 0))));
    }
    if (zeroLine && yt.min < 0 && yt.max > 0) {
      svg.appendChild(h('line', { class: 'axis-line', x1: m.l, x2: m.l + iw, y1: px(Y(0)), y2: px(Y(0)) }));
    }
    // x axis
    const tt = timeTicks(t0, t1);
    svg.appendChild(h('line', { class: 'axis-line', x1: m.l, x2: m.l + iw, y1: px(m.t + ih), y2: px(m.t + ih) }));
    for (const t of tt.ticks) {
      const x = X(t);
      if (x < m.l - 1 || x > m.l + iw + 1) continue;
      svg.appendChild(h('text', { class: 'axis-text', x: px(x), y: H - 7, 'text-anchor': 'middle' }, tt.daily ? fmtDate(t) : fmtHM(t)));
    }

    // limit lines
    for (const L of limits) {
      const y = Y(L.value);
      if (y < m.t || y > m.t + ih) continue;
      svg.appendChild(h('line', { class: 'limit-line', x1: m.l, x2: m.l + iw, y1: px(y), y2: px(y), stroke: `var(--${L.kind || 'warning'})`, opacity: .8 }));
      svg.appendChild(h('text', { class: 'axis-text', x: m.l + iw - 2, y: px(y - 4), 'text-anchor': 'end', fill: `var(--${L.kind || 'warning'})`, 'font-weight': 600 }, L.label));
    }

    // paths — for a stacked chart every series is resolved to an explicit
    // upper/lower pair first, so the fill geometry cannot drift out of step
    // with the line geometry.
    const stackBase = new Map();     // key -> Map(ts -> lower value)
    const stackTop = new Map();      // key -> Map(ts -> upper value)
    if (stack) {
      const acc = new Map();
      for (const s of vis) {
        const lower = new Map(), upper = new Map();
        for (const [t, v] of s.data) {
          const b = acc.get(t) || 0;
          const u = b + (v ?? 0);
          lower.set(t, b); upper.set(t, u); acc.set(t, u);
        }
        stackBase.set(s.key, lower); stackTop.set(s.key, upper);
      }
    }

    // Draw the topmost band first so lower bands paint over its edge, giving
    // the 2 px surface gap between segments without a manual offset.
    for (const s of (stack ? [...vis].reverse() : vis)) {
      const color = s.color || seriesColor(s.slot ?? (series.indexOf(s) + 1));
      const upper = stack ? stackTop.get(s.key) : null;
      const lower = stack ? stackBase.get(s.key) : null;

      // split into contiguous segments so a comms gap is a gap, not a straight line
      const segs = [];
      let cur = [];
      for (const [t, v] of s.data) {
        if (v === null || v === undefined) { if (cur.length) { segs.push(cur); cur = []; } continue; }
        cur.push({ t, x: X(t), yTop: Y(stack ? upper.get(t) : v), yBot: stack ? Y(lower.get(t)) : m.t + ih });
      }
      if (cur.length) segs.push(cur);

      if (s.area || stack) {
        let fill = color, opacity = stack ? 0.8 : 1;
        if (!stack) {
          const gid = `g-${s.key.replace(/[^a-z0-9]/gi, '')}-${Math.random().toString(36).slice(2, 6)}`;
          defs.appendChild(h('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 },
            h('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': .28 }),
            h('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': .02 })));
          fill = `url(#${gid})`;
        }
        for (const seg of segs) {
          if (seg.length < 2) continue;
          const top = seg.map((p) => `${px(p.x)},${px(p.yTop)}`).join('L');
          const bot = [...seg].reverse().map((p) => `${px(p.x)},${px(p.yBot)}`).join('L');
          svg.appendChild(h('path', { d: `M${top}L${bot}Z`, fill, opacity,
            stroke: stack ? 'var(--surface-1)' : 'none', 'stroke-width': stack ? 2 : 0, 'stroke-linejoin': 'round' }));
        }
      }
      for (const seg of segs) {
        if (seg.length < 2) continue;
        svg.appendChild(h('path', {
          class: 'series-line', d: `M${seg.map((p) => `${px(p.x)},${px(p.yTop)}`).join('L')}`,
          stroke: color, 'stroke-dasharray': s.dashed ? '5 4' : null,
        }));
      }
      // direct end-of-line marker — only when few enough series to stay legible
      if (!stack && vis.length <= 4 && segs.length) {
        const last = segs[segs.length - 1].at(-1);
        if (last && last.x > m.l + 30) {
          svg.appendChild(h('circle', { cx: px(last.x), cy: px(last.yTop), r: 3.2, fill: color, stroke: 'var(--surface-1)', 'stroke-width': 2 }));
        }
      }
    }

    // crosshair + hover
    const cross = h('line', { class: 'crosshair', y1: m.t, y2: m.t + ih, x1: 0, x2: 0, style: { display: 'none' } });
    svg.appendChild(cross);
    const dots = h('g');
    svg.appendChild(dots);
    const hit = h('rect', { class: 'hit', x: m.l, y: m.t, width: iw, height: ih });
    svg.appendChild(hit);

    const allTs = [...new Set(vis.flatMap((s) => s.data.map((d) => d[0])))].sort((a, b) => a - b);
    hit.addEventListener('pointermove', (ev) => {
      const r = svg.getBoundingClientRect();
      const sx = (ev.clientX - r.left) * (W / r.width);
      const t = t0 + ((sx - m.l) / iw) * (t1 - t0);
      let best = allTs[0], bd = Infinity;
      for (const ts of allTs) { const d = Math.abs(ts - t); if (d < bd) { bd = d; best = ts; } }
      if (best === undefined) return;
      const cx = X(best);
      cross.style.display = ''; cross.setAttribute('x1', px(cx)); cross.setAttribute('x2', px(cx));
      dots.innerHTML = '';
      const rows = [h('div', { class: 'tt-time' }, fmtFull(best))];
      let acc = 0;
      for (const s of vis) {
        const point = s.data.find((d) => d[0] === best);
        if (!point || point[1] === null) continue;
        const color = s.color || seriesColor(s.slot ?? (series.indexOf(s) + 1));
        const yv = stack ? (acc += point[1]) : point[1];   // same order as the stack build above
        dots.appendChild(h('circle', { cx: px(cx), cy: px(Y(yv)), r: 4, fill: color, stroke: 'var(--surface-1)', 'stroke-width': 2 }));
        rows.push(h('div', { class: 'tt-row' },
          h('span', { class: 'sw', style: { background: color } }),
          h('span', { class: 'nm' }, s.label),
          h('span', { class: 'vl' }, `${num(point[1], s.precision ?? 2)} ${s.unit ?? unit}`)));
      }
      const rr = this.host.getBoundingClientRect();
      this.showTip(ev.clientX - rr.left, ev.clientY - rr.top, rows);
    });
    hit.addEventListener('pointerleave', () => { cross.style.display = 'none'; dots.innerHTML = ''; this.hideTip(); });

    const old = this.host.querySelector('svg');
    if (old) old.replaceWith(svg); else this.host.insertBefore(svg, this.tip);
  }
}

/* ═══ BARS (grouped or stacked, vertical) ═══════════════════════════════════ */
export class BarChart extends Chart {
  render() {
    const { categories = [], series = [], height = 230, stacked = false, unit = '', hidden = new Set(), valueFmt = (v) => num(v, 1) } = this.opts;
    const W = this.width, H = height;
    const m = { t: 12, r: 12, b: 26, l: 46 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const vis = series.filter((s) => !hidden.has(s.key));

    let hi = 0, lo = 0;
    if (stacked) {
      categories.forEach((_, i) => {
        let pos = 0, neg = 0;
        for (const s of vis) { const v = s.data[i] ?? 0; if (v >= 0) pos += v; else neg += v; }
        hi = Math.max(hi, pos); lo = Math.min(lo, neg);
      });
    } else {
      for (const s of vis) for (const v of s.data) { hi = Math.max(hi, v ?? 0); lo = Math.min(lo, v ?? 0); }
    }
    const yt = niceTicks(lo, hi * 1.08 || 1, 4);
    const Y = (v) => m.t + ih - ((v - yt.min) / Math.max(1e-9, yt.max - yt.min)) * ih;

    const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' });
    for (const v of yt.ticks) {
      const y = Y(v);
      svg.appendChild(h('line', { class: 'gridline', x1: m.l, x2: m.l + iw, y1: px(y), y2: px(y) }));
      svg.appendChild(h('text', { class: 'axis-text', x: m.l - 8, y: px(y + 3.5), 'text-anchor': 'end' },
        Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(+v.toFixed(yt.step < 1 ? 1 : 0))));
    }
    svg.appendChild(h('line', { class: 'axis-line', x1: m.l, x2: m.l + iw, y1: px(Y(0)), y2: px(Y(0)) }));

    const slotW = iw / Math.max(1, categories.length);
    const GAP = 2;                                    // surface gap between adjacent/stacked marks
    const bandW = Math.min(46, slotW * 0.66);
    const barW = stacked ? bandW : Math.max(3, (bandW - GAP * (vis.length - 1)) / Math.max(1, vis.length));

    categories.forEach((cat, i) => {
      const cx = m.l + slotW * i + slotW / 2;
      let posAcc = 0, negAcc = 0;
      vis.forEach((s, j) => {
        const v = s.data[i];
        if (v === null || v === undefined) return;
        const color = s.color || seriesColor(s.slot ?? (series.indexOf(s) + 1));
        const x = stacked ? cx - bandW / 2 : cx - bandW / 2 + j * (barW + GAP);
        let y, hgt;
        if (stacked) {
          const base = v >= 0 ? posAcc : negAcc;
          const top = base + v;
          if (v >= 0) posAcc = top; else negAcc = top;
          y = Math.min(Y(base), Y(top)); hgt = Math.abs(Y(top) - Y(base));
          if (hgt > GAP) { y += (v >= 0 ? 0 : GAP); hgt -= GAP; }   // 2px surface gap between segments
        } else {
          y = Math.min(Y(0), Y(v)); hgt = Math.abs(Y(v) - Y(0));
        }
        if (hgt < 0.6) return;
        const r = Math.min(4, barW / 2, hgt / 2);      // 4px rounded data-end, square at the baseline
        const rect = h('path', {
          d: v >= 0
            ? `M${px(x)},${px(y + hgt)}V${px(y + r)}A${r},${r} 0 0 1 ${px(x + r)},${px(y)}H${px(x + barW - r)}A${r},${r} 0 0 1 ${px(x + barW)},${px(y + r)}V${px(y + hgt)}Z`
            : `M${px(x)},${px(y)}V${px(y + hgt - r)}A${r},${r} 0 0 0 ${px(x + r)},${px(y + hgt)}H${px(x + barW - r)}A${r},${r} 0 0 0 ${px(x + barW)},${px(y + hgt - r)}V${px(y)}Z`,
          fill: color, opacity: .92, style: { cursor: 'pointer' },
        });
        rect.addEventListener('pointerenter', (ev) => {
          rect.setAttribute('opacity', 1);
          const rr = this.host.getBoundingClientRect();
          this.showTip(ev.clientX - rr.left, ev.clientY - rr.top, [
            h('div', { class: 'tt-time' }, cat),
            ...vis.map((ss) => h('div', { class: 'tt-row' },
              h('span', { class: 'sw', style: { background: ss.color || seriesColor(ss.slot ?? (series.indexOf(ss) + 1)) } }),
              h('span', { class: 'nm' }, ss.label),
              h('span', { class: 'vl' }, `${valueFmt(ss.data[i] ?? 0)} ${ss.unit ?? unit}`))),
          ]);
        });
        rect.addEventListener('pointerleave', () => { rect.setAttribute('opacity', .92); this.hideTip(); });
        svg.appendChild(rect);
      });
      if (categories.length <= 32) {
        svg.appendChild(h('text', { class: 'axis-text', x: px(cx), y: H - 8, 'text-anchor': 'middle' },
          categories.length > 16 && i % 2 ? '' : cat));
      }
    });

    const old = this.host.querySelector('svg');
    if (old) old.replaceWith(svg); else this.host.insertBefore(svg, this.tip);
  }
}

/* ═══ SPARKLINE ════════════════════════════════════════════════════════════ */
export function sparkline(data, { color = 'var(--series-1)', height = 34, area = true, limitHi = null } = {}) {
  const host = h('div', { style: { width: '100%', height: `${height}px` } });
  const draw = () => {
    const W = host.clientWidth || 160, H = height;
    const vals = data.map((d) => (Array.isArray(d) ? d[1] : d)).filter((v) => v !== null);
    if (!vals.length) { host.innerHTML = ''; return; }
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo === hi) { lo -= 0.5; hi += 0.5; }
    const X = (i) => (i / Math.max(1, data.length - 1)) * (W - 2) + 1;
    const Y = (v) => H - 3 - ((v - lo) / (hi - lo)) * (H - 6);
    const pts = data.map((d, i) => [X(i), Y(Array.isArray(d) ? d[1] : d)]).filter((p) => isFinite(p[1]));
    if (pts.length < 2) { host.innerHTML = ''; return; }
    const line = `M${pts.map((p) => `${px(p[0])},${px(p[1])}`).join('L')}`;
    const gid = `sp-${Math.random().toString(36).slice(2, 8)}`;
    const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' },
      area ? h('defs', {}, h('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 },
        h('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': .30 }),
        h('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }))) : null,
      area ? h('path', { d: `${line}L${px(pts[pts.length - 1][0])},${H}L${px(pts[0][0])},${H}Z`, fill: `url(#${gid})` }) : null,
      limitHi !== null && limitHi >= lo && limitHi <= hi
        ? h('line', { x1: 0, x2: W, y1: px(Y(limitHi)), y2: px(Y(limitHi)), stroke: 'var(--warning)', 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: .7 }) : null,
      h('path', { d: line, fill: 'none', stroke: color, 'stroke-width': 1.8, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
      h('circle', { cx: px(pts[pts.length - 1][0]), cy: px(pts[pts.length - 1][1]), r: 2.4, fill: color }));
    host.innerHTML = ''; host.appendChild(svg);
  };
  new ResizeObserver(draw).observe(host);
  queueMicrotask(draw);
  return host;
}

/* ═══ RADIAL GAUGE ═════════════════════════════════════════════════════════ */
export function gauge({ value, min = 0, max = 100, unit = '%', label = '', color = 'var(--series-1)', size = 160, bands = [], sub = '' }) {
  const R = size / 2 - 13, C = size / 2;
  const A0 = -215, A1 = 35;                          // open-bottom arc
  const pol = (a, r = R) => [C + r * Math.cos(a * Math.PI / 180), C + r * Math.sin(a * Math.PI / 180)];
  const arc = (a0, a1, r = R) => {
    const [x0, y0] = pol(a0, r), [x1, y1] = pol(a1, r);
    return `M${px(x0)},${px(y0)}A${r},${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} 1 ${px(x1)},${px(y1)}`;
  };
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const va = A0 + (A1 - A0) * frac;
  const svg = h('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, style: { maxWidth: '100%' } },
    h('path', { d: arc(A0, A1), stroke: 'var(--surface-3)', 'stroke-width': 9, fill: 'none', 'stroke-linecap': 'round' }),
    ...bands.map((b) => h('path', {
      d: arc(A0 + (A1 - A0) * ((b.from - min) / (max - min)), A0 + (A1 - A0) * ((b.to - min) / (max - min)), R + 9),
      stroke: b.color, 'stroke-width': 3, fill: 'none', opacity: .8, 'stroke-linecap': 'butt' })),
    h('path', { d: arc(A0, va), stroke: color, 'stroke-width': 9, fill: 'none', 'stroke-linecap': 'round' }),
    h('text', { x: C, y: C + 4, 'text-anchor': 'middle', fill: 'var(--text-primary)', 'font-size': size * 0.21, 'font-weight': 600, style: { fontVariantNumeric: 'tabular-nums' } }, num(value, value >= 100 ? 0 : 1)),
    h('text', { x: C, y: C + 22, 'text-anchor': 'middle', fill: 'var(--text-muted)', 'font-size': 11 }, unit),
    sub ? h('text', { x: C, y: size - 4, 'text-anchor': 'middle', fill: 'var(--text-secondary)', 'font-size': 10.5 }, sub) : null);
  return label ? h('div', { style: { textAlign: 'center' } }, svg, h('div', { class: 'meta', style: { fontSize: '11.5px', color: 'var(--text-muted)' } }, label)) : svg;
}

/* ═══ TANK LEVEL ═══════════════════════════════════════════════════════════ */
export function tankLevel({ pct, label, sublabel, capacity, height = 110, width = 62, color = 'var(--series-1)', severity = 'good' }) {
  const w = width, hh = height, wall = 1.5;
  const fillH = Math.max(0, Math.min(1, pct / 100)) * (hh - 14);
  const col = severity === 'critical' ? 'var(--critical)' : severity === 'warning' ? 'var(--warning)' : color;
  const gid = `tk-${Math.random().toString(36).slice(2, 8)}`;
  const svg = h('svg', { viewBox: `0 0 ${w} ${hh}`, width: w, height: hh },
    h('defs', {}, h('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 },
      h('stop', { offset: '0%', 'stop-color': col, 'stop-opacity': .85 }),
      h('stop', { offset: '100%', 'stop-color': col, 'stop-opacity': .5 }))),
    h('rect', { x: wall, y: 7, width: w - wall * 2, height: hh - 14, rx: 6, fill: 'var(--surface-sunk)', stroke: 'var(--baseline)', 'stroke-width': wall }),
    h('rect', { x: wall + 1.5, y: 7 + (hh - 14) - fillH, width: w - wall * 2 - 3, height: fillH, rx: 4.5, fill: `url(#${gid})` }),
    h('line', { x1: wall, x2: w - wall, y1: 7 + (hh - 14) - fillH, y2: 7 + (hh - 14) - fillH, stroke: col, 'stroke-width': 2 }),
    h('text', { x: w / 2, y: hh / 2 + 4, 'text-anchor': 'middle', fill: 'var(--text-primary)', 'font-size': 14, 'font-weight': 700, style: { fontVariantNumeric: 'tabular-nums', paintOrder: 'stroke', stroke: 'var(--surface-1)', strokeWidth: '3px' } }, `${num(pct, 0)}%`));
  return h('div', { style: { textAlign: 'center', minWidth: `${w}px` } }, svg,
    h('div', { style: { fontSize: '11px', fontWeight: 600, marginTop: '2px' } }, label),
    sublabel ? h('div', { style: { fontSize: '10px', color: 'var(--text-muted)' } }, sublabel) : null,
    capacity ? h('div', { style: { fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--mono)' } }, capacity) : null);
}

/* ═══ HORIZONTAL METER (process stage / fouling / share) ═══════════════════ */
export function meter({ pct, color = 'var(--series-1)', height = 6, track = 'var(--surface-3)' }) {
  return h('div', { style: { height: `${height}px`, background: track, borderRadius: '4px', overflow: 'hidden' } },
    h('div', { style: { width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', background: color, borderRadius: '4px', transition: 'width .4s ease' } }));
}

/* ═══ LEGEND ═══════════════════════════════════════════════════════════════
   Always rendered for ≥ 2 series — identity must never be colour-alone.      */
export function legend(series, { hidden = new Set(), onToggle = null, line = true } = {}) {
  return h('div', { class: 'legend' }, series.map((s, i) => {
    const color = s.color || seriesColor(s.slot ?? (i + 1));
    const el = h('span', { class: `item ${hidden.has(s.key) ? 'off' : ''}`, role: onToggle ? 'button' : null, tabindex: onToggle ? 0 : null },
      h('span', { class: `swatch ${line ? 'line' : ''}`, style: { background: color } }), s.label);
    if (onToggle) {
      el.addEventListener('click', () => onToggle(s.key));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(s.key); } });
    }
    return el;
  }));
}

export { niceTicks };
