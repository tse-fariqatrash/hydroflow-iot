/**
 * TIME-SERIES STORE & HISTORIAN
 * -----------------------------------------------------------------------------
 * SQLite in WAL mode. Chosen deliberately over a hosted TSDB: the plant sits
 * behind a 4G/5G link in Tanjung Manis and must keep historising when the link
 * drops. A single file is also trivial to back up to S3 and to move to the
 * dedicated server later.
 *
 *   samples       raw points at the persist interval (default 60 s) + deadband
 *   rollup_hour   1-hour min/max/avg/count per tag — survives raw retention
 *   daily         one row per local day: energy and water totals
 *   alarms        alarm journal (raise / ack / clear), never overwritten
 *   events        audit trail — logins, setpoint changes, acknowledgements
 *   users         local accounts with the USM role tiers
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS samples (
      tag TEXT NOT NULL, ts INTEGER NOT NULL, v REAL,
      q INTEGER NOT NULL DEFAULT 192,            -- OPC-UA style quality: 192 = Good
      PRIMARY KEY (tag, ts)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_samples_ts ON samples(ts);

    CREATE TABLE IF NOT EXISTS rollup_hour (
      tag TEXT NOT NULL, ts INTEGER NOT NULL,
      vmin REAL, vmax REAL, vavg REAL, n INTEGER,
      PRIMARY KEY (tag, ts)
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS daily (
      day TEXT PRIMARY KEY,
      pv_kwh REAL, load_kwh REAL, import_kwh REAL, export_kwh REAL,
      chg_kwh REAL, dsch_kwh REAL,
      water_produced_m3 REAL, water_delivered_m3 REAL,
      rain_mm REAL, peak_load_kw REAL, min_soc REAL,
      autonomy_pct REAL
    );

    CREATE TABLE IF NOT EXISTS alarms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag TEXT NOT NULL, area TEXT, severity TEXT NOT NULL,
      condition TEXT NOT NULL, message TEXT NOT NULL,
      value REAL, limit_value REAL,
      raised_at INTEGER NOT NULL, cleared_at INTEGER, acked_at INTEGER,
      acked_by TEXT, note TEXT,
      state TEXT NOT NULL DEFAULT 'active'      -- active | acked | cleared
    );
    CREATE INDEX IF NOT EXISTS idx_alarms_state ON alarms(state, raised_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alarms_raised ON alarms(raised_at DESC);

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL, type TEXT NOT NULL,
      actor TEXT, target TEXT, detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      email TEXT, role TEXT NOT NULL, pw_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL, last_login INTEGER, active INTEGER NOT NULL DEFAULT 1,
      -- Tokens issued before this instant are refused. Set on every password
      -- change, role change and deactivation, so those actually end sessions.
      pw_changed_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS device_state (
      id TEXT PRIMARY KEY, status TEXT, last_seen INTEGER, rx_count INTEGER DEFAULT 0, err_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
  `);
  migrate(db);
  return db;
}

/**
 * Additive migrations for databases created by an earlier version.
 * Each step is guarded so running it repeatedly is harmless — this executes on
 * every boot, including the one right after an upgrade.
 */
function migrate(db) {
  const cols = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

  if (!cols('users').includes('pw_changed_at')) {
    db.exec('ALTER TABLE users ADD COLUMN pw_changed_at INTEGER NOT NULL DEFAULT 0');
    console.log('[migrate] users.pw_changed_at added');
  }
}

export class Historian {
  constructor(db, { retentionDays = 30 } = {}) {
    this.db = db;
    this.retentionDays = retentionDays;
    this.insertSample = db.prepare('INSERT OR REPLACE INTO samples (tag, ts, v, q) VALUES (?, ?, ?, ?)');
    this.insertMany = db.transaction((rows) => { for (const r of rows) this.insertSample.run(r.tag, r.ts, r.v, r.q ?? 192); });
    this.upsertDaily = db.prepare(`
      INSERT INTO daily (day, pv_kwh, load_kwh, import_kwh, export_kwh, chg_kwh, dsch_kwh,
                         water_produced_m3, water_delivered_m3, rain_mm, peak_load_kw, min_soc, autonomy_pct)
      VALUES (@day,@pv,@load,@imp,@exp,@chg,@dsch,@prod,@deliv,@rain,@peak,@minsoc,@auto)
      ON CONFLICT(day) DO UPDATE SET
        pv_kwh=@pv, load_kwh=@load, import_kwh=@imp, export_kwh=@exp, chg_kwh=@chg, dsch_kwh=@dsch,
        water_produced_m3=@prod, water_delivered_m3=@deliv, rain_mm=@rain,
        peak_load_kw=max(peak_load_kw,@peak), min_soc=min(min_soc,@minsoc), autonomy_pct=@auto`);
  }

  write(rows) { if (rows.length) this.insertMany(rows); }

  /**
   * Series for one tag. Automatically switches to hourly rollups for long
   * windows so a 1-year trend costs the same as a 1-hour trend.
   */
  series(tag, from, to, maxPoints = 900) {
    const span = to - from;
    const useRollup = span > 3 * 86400000;
    if (useRollup) {
      const rows = this.db.prepare(
        'SELECT ts, vavg AS v, vmin, vmax FROM rollup_hour WHERE tag=? AND ts BETWEEN ? AND ? ORDER BY ts'
      ).all(tag, from, to);
      return this.#decimate(rows, maxPoints);
    }
    const rows = this.db.prepare(
      'SELECT ts, v FROM samples WHERE tag=? AND ts BETWEEN ? AND ? ORDER BY ts'
    ).all(tag, from, to);
    return this.#decimate(rows, maxPoints);
  }

  /** Largest-Triangle-Three-Buckets — keeps peaks that naive striding would drop. */
  #decimate(rows, threshold) {
    const n = rows.length;
    if (n <= threshold || threshold < 3) return rows;
    const out = [rows[0]];
    const every = (n - 2) / (threshold - 2);
    let a = 0;
    for (let i = 0; i < threshold - 2; i++) {
      const rangeStart = Math.floor((i + 1) * every) + 1;
      const rangeEnd = Math.min(Math.floor((i + 2) * every) + 1, n);
      let avgT = 0, avgV = 0, cnt = 0;
      for (let j = rangeStart; j < rangeEnd; j++) { avgT += rows[j].ts; avgV += rows[j].v ?? 0; cnt++; }
      if (cnt) { avgT /= cnt; avgV /= cnt; }
      const from = Math.floor(i * every) + 1;
      const to = Math.floor((i + 1) * every) + 1;
      let best = from, bestArea = -1;
      for (let j = from; j < Math.min(to, n); j++) {
        const area = Math.abs((rows[a].ts - avgT) * ((rows[j].v ?? 0) - (rows[a].v ?? 0))
                            - (rows[a].ts - rows[j].ts) * (avgV - (rows[a].v ?? 0)));
        if (area > bestArea) { bestArea = area; best = j; }
      }
      out.push(rows[best]); a = best;
    }
    out.push(rows[n - 1]);
    return out;
  }

  /** Roll raw samples into hourly buckets, then trim raw beyond retention. */
  compact(now = Date.now()) {
    const cutoff = now - 2 * 3600000;
    this.db.exec('BEGIN');
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO rollup_hour (tag, ts, vmin, vmax, vavg, n)
        SELECT tag, (ts / 3600000) * 3600000 AS h, MIN(v), MAX(v), AVG(v), COUNT(*)
        FROM samples WHERE ts < ? GROUP BY tag, h`).run(cutoff);
      this.db.prepare('DELETE FROM samples WHERE ts < ?').run(now - this.retentionDays * 86400000);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  stats() {
    const s = this.db.prepare('SELECT COUNT(*) c, MIN(ts) a, MAX(ts) b FROM samples').get();
    const r = this.db.prepare('SELECT COUNT(*) c FROM rollup_hour').get();
    return { samples: s.c, rollups: r.c, from: s.a, to: s.b };
  }
}

export function logEvent(db, type, { actor = 'system', target = null, detail = null } = {}) {
  db.prepare('INSERT INTO events (ts, type, actor, target, detail) VALUES (?,?,?,?,?)')
    .run(Date.now(), type, actor, target, detail ? String(detail) : null);
}
