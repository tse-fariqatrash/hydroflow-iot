/**
 * ALARM ENGINE
 * -----------------------------------------------------------------------------
 * Four-level analogue limit checking (LL / L / H / HH) plus discrete state
 * alarms, with the two things that separate a usable alarm system from a
 * nuisance generator:
 *
 *   · deadband  — a tag must fall back past the limit by `hysteresis` of span
 *                 before the alarm clears, so a value sitting on the limit does
 *                 not chatter.
 *   · on-delay  — the condition must persist for `onDelayMs` before it is
 *                 journalled, so a single noisy poll does not raise an alarm.
 *
 *   · suppression — an alarm can be shelved by plant state. A "discharge
 *                 pressure low" on a stopped pump is not a fault, it is the
 *                 definition of stopped; ISA-18.2 calls this state-based
 *                 alarming and it is the single biggest source of nuisance
 *                 alarms in small water plants. Declare it on the tag as
 *                 `alarm.suppressWhen = { tag: 'ZS-7006', equals: 0 }`.
 *
 * Alarms follow ISA-18.2 states: active → acked → cleared (an alarm may clear
 * before it is acknowledged; it stays in the journal either way).
 */

const SEV_RANK = { critical: 4, serious: 3, warning: 2, good: 1, info: 0 };

export class AlarmEngine {
  constructor(db, tags, { onDelayMs = 15000, hysteresis = 0.02 } = {}) {
    this.db = db;
    this.tags = tags;
    this.onDelayMs = onDelayMs;
    this.hysteresis = hysteresis;
    this.pending = new Map();   // key -> firstSeenTs
    this.active = new Map();    // key -> alarm row id
    this.#restore();
  }

  #restore() {
    const rows = this.db.prepare("SELECT id, tag, condition FROM alarms WHERE state IN ('active','acked')").all();
    for (const r of rows) this.active.set(`${r.tag}|${r.condition}`, r.id);
  }

  /** Evaluate one scan of tag values. Returns {raised:[], cleared:[]}. */
  evaluate(values, ts = Date.now()) {
    const raised = [], cleared = [];
    for (const tag of this.tags) {
      const v = values[tag.id];
      if (v === undefined || v === null || !Number.isFinite(v)) continue;
      const suppressed = this.#suppressed(tag, values);
      const hit = suppressed ? null
        : tag.kind === 'digital' ? this.#checkDigital(tag, v) : this.#checkAnalog(tag, v);

      // Clear any active condition on this tag that is no longer the current hit.
      for (const cond of ['LL', 'L', 'H', 'HH', 'STATE']) {
        const key = `${tag.id}|${cond}`;
        if (this.active.has(key) && (!hit || hit.condition !== cond) && (suppressed || this.#hasCleared(tag, v, cond))) {
          const id = this.active.get(key);
          this.db.prepare("UPDATE alarms SET cleared_at=?, state=CASE WHEN acked_at IS NULL THEN 'cleared' ELSE 'cleared' END WHERE id=?").run(ts, id);
          this.active.delete(key);
          this.pending.delete(key);
          cleared.push({ id, tag: tag.id, condition: cond });
        }
      }

      if (!hit) { this.pending.delete(`${tag.id}|pending`); continue; }
      const key = `${tag.id}|${hit.condition}`;
      if (this.active.has(key)) continue;
      const first = this.pending.get(key);
      if (first === undefined) { this.pending.set(key, ts); continue; }
      if (ts - first < this.onDelayMs) continue;

      const message = this.#message(tag, hit, v);
      const info = this.db.prepare(`INSERT INTO alarms
        (tag, area, severity, condition, message, value, limit_value, raised_at, state)
        VALUES (?,?,?,?,?,?,?,?,'active')`)
        .run(tag.id, tag.area, hit.severity, hit.condition, message, v, hit.limit ?? null, ts);
      this.active.set(key, info.lastInsertRowid);
      this.pending.delete(key);
      raised.push({ id: info.lastInsertRowid, tag: tag.id, area: tag.area, severity: hit.severity,
                    condition: hit.condition, message, value: v, limit: hit.limit ?? null, raised_at: ts, state: 'active' });
    }
    return { raised, cleared };
  }

  /** True when plant state says this alarm is not meaningful right now. */
  #suppressed(tag, values) {
    const rules = tag.alarm?.suppressWhen;
    if (!rules) return false;
    for (const r of Array.isArray(rules) ? rules : [rules]) {
      const ref = values[r.tag];
      if (ref === undefined || ref === null) continue;
      if (r.equals !== undefined && ref === r.equals) return true;
      if (r.below !== undefined && ref < r.below) return true;
      if (r.above !== undefined && ref > r.above) return true;
    }
    return false;
  }

  #checkAnalog(tag, v) {
    const a = tag.alarm || {};
    if (a.hh != null && v >= a.hh) return { condition: 'HH', severity: 'critical', limit: a.hh };
    if (a.h != null && v >= a.h)  return { condition: 'H',  severity: 'warning',  limit: a.h };
    if (a.ll != null && v <= a.ll) return { condition: 'LL', severity: 'critical', limit: a.ll };
    if (a.l != null && v <= a.l)  return { condition: 'L',  severity: 'warning',  limit: a.l };
    return null;
  }

  #checkDigital(tag, v) {
    const a = tag.alarm || {};
    if (a.digitalAlarmOn == null) return null;
    return v === a.digitalAlarmOn
      ? { condition: 'STATE', severity: a.severity || 'warning', limit: a.digitalAlarmOn }
      : null;
  }

  /** True when the value has retreated past the limit by the deadband. */
  #hasCleared(tag, v, cond) {
    const a = tag.alarm || {};
    const span = (tag.max - tag.min) || 1;
    const db = span * this.hysteresis;
    switch (cond) {
      case 'HH': return a.hh == null || v < a.hh - db;
      case 'H':  return a.h == null || v < a.h - db;
      case 'LL': return a.ll == null || v > a.ll + db;
      case 'L':  return a.l == null || v > a.l + db;
      case 'STATE': return a.digitalAlarmOn == null || v !== a.digitalAlarmOn;
      default: return true;
    }
  }

  #message(tag, hit, v) {
    const u = tag.unit ? ` ${tag.unit}` : '';
    if (hit.condition === 'STATE') {
      const st = tag.states ? tag.states[v] ?? v : v;
      return `${tag.name} — ${st}`;
    }
    const word = { HH: 'HIGH-HIGH', H: 'HIGH', L: 'LOW', LL: 'LOW-LOW' }[hit.condition];
    return `${tag.name} ${word}: ${v.toFixed(tag.precision)}${u} (limit ${hit.limit}${u})`;
  }

  ack(id, user, note) {
    const now = Date.now();
    this.db.prepare("UPDATE alarms SET acked_at=?, acked_by=?, note=?, state=CASE WHEN cleared_at IS NULL THEN 'acked' ELSE 'cleared' END WHERE id=? AND acked_at IS NULL")
      .run(now, user, note || null, id);
    return this.db.prepare('SELECT * FROM alarms WHERE id=?').get(id);
  }

  ackAll(user) {
    const rows = this.db.prepare("SELECT id FROM alarms WHERE state='active' AND acked_at IS NULL").all();
    for (const r of rows) this.ack(r.id, user, 'Bulk acknowledge');
    return rows.length;
  }

  list({ state = 'open', limit = 200, area = null } = {}) {
    let sql = 'SELECT * FROM alarms';
    const w = [], p = [];
    if (state === 'open') w.push("state IN ('active','acked')");
    else if (state !== 'all') { w.push('state = ?'); p.push(state); }
    if (area) { w.push('area = ?'); p.push(area); }
    if (w.length) sql += ' WHERE ' + w.join(' AND ');
    sql += ' ORDER BY raised_at DESC LIMIT ?'; p.push(limit);
    return this.db.prepare(sql).all(...p);
  }

  summary() {
    const rows = this.db.prepare("SELECT severity, COUNT(*) n FROM alarms WHERE state='active' GROUP BY severity").all();
    const out = { critical: 0, serious: 0, warning: 0, total: 0, unacked: 0 };
    for (const r of rows) { out[r.severity] = r.n; out.total += r.n; }
    out.unacked = this.db.prepare("SELECT COUNT(*) n FROM alarms WHERE state='active' AND acked_at IS NULL").get().n;
    out.worst = rows.length ? rows.map(r => r.severity).sort((a, b) => SEV_RANK[b] - SEV_RANK[a])[0] : null;
    return out;
  }
}

export { SEV_RANK };
