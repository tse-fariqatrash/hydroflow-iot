/**
 * AUTHENTICATION & ROLE-BASED ACCESS CONTROL
 * -----------------------------------------------------------------------------
 * Implements the six access tiers defined in the USM topology (section C of the
 * "PIC Personnel & User Access Level" table). JWT bearer tokens; passwords are
 * bcrypt-hashed. There is no password recovery by design — an administrator
 * resets it, which is the correct posture for a plant with six named operators.
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { ROLES } from './tags.js';
import { logEvent } from './db.js';

export function seedUsers(db) {
  const n = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (n > 0) return;
  const now = Date.now();
  const seed = [
    ['admin',      'System Administrator',  'admin',      'admin@twilightsolar.my'],
    ['engineer',   'IoT / SCADA Engineer',  'engineer',   'scada@twilightsolar.my'],
    ['operator',   'Plant Operator',        'operator',   'operator@hydroflow.my'],
    ['technician', 'Maintenance Technician','technician', 'maintenance@hydroflow.my'],
    ['manager',    'Manager / Supervisor',  'manager',    'manager@jsholding.my'],
    ['community',  'Community Viewer',      'community',  null],
  ];
  const ins = db.prepare('INSERT INTO users (username,name,email,role,pw_hash,created_at,pw_changed_at) VALUES (?,?,?,?,?,?,?)');
  const pw = process.env.DEFAULT_PASSWORD || 'hydroflow2026';
  const hash = bcrypt.hashSync(pw, 10);
  for (const [u, n2, r, e] of seed) ins.run(u, n2, e, r, hash, now, now);
  logEvent(db, 'system.seed', { detail: `Seeded ${seed.length} accounts` });
}

export function makeAuth(db, secret) {
  /**
   * Cut-off for a user's tokens, in whole seconds.
   *
   * JWT `iat` only has one-second resolution, so a token minted in the same
   * second as a password change is indistinguishable from one minted just
   * before it. Pushing the cut-off to the NEXT second makes the boundary
   * unambiguous: everything issued up to and including the second of the
   * change is dead, everything issued from the following second lives.
   */
  const cutoff = (u) => Math.floor((u.pw_changed_at ?? 0) / 1000) + 1;

  /**
   * `iat` is forced to at least the cut-off, so a token issued immediately
   * after a password change is valid rather than being killed by the change
   * that prompted it.
   */
  const sign = (u) => jwt.sign(
    { sub: u.username, name: u.name, role: u.role, perms: ROLES[u.role]?.perms ?? ['view-limited'],
      iat: Math.max(Math.floor(Date.now() / 1000), cutoff(u)) },
    secret, { expiresIn: process.env.TOKEN_TTL || '12h' });

  const findByName = db.prepare('SELECT id, username, role, active, pw_changed_at FROM users WHERE username = ?');

  return {
    sign,
    db,
    /**
     * Is this token still good? A valid signature is not enough — the account
     * may have been deactivated, demoted, or had its password reset since the
     * token was minted. `iat` is in seconds; `pw_changed_at` in milliseconds.
     */
    stillValid(claims) {
      if (!claims?.sub) return false;
      const u = findByName.get(claims.sub);
      if (!u || !u.active) return false;
      if (u.role !== claims.role) return false;                    // role changed under them
      if ((claims.iat ?? 0) < cutoff(u)) return false;              // see cutoff() above
      return true;
    },
    login(username, password, ip) {
      const u = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(username || '').toLowerCase().trim());
      if (!u || !bcrypt.compareSync(String(password || ''), u.pw_hash)) {
        logEvent(db, 'auth.fail', { actor: username || 'unknown', detail: ip });
        return null;
      }
      db.prepare('UPDATE users SET last_login=? WHERE id=?').run(Date.now(), u.id);
      logEvent(db, 'auth.login', { actor: u.username, detail: ip });
      return { token: sign(u), user: { username: u.username, name: u.name, role: u.role, email: u.email, ...ROLES[u.role] } };
    },
    verify(token) { try { return jwt.verify(token, secret); } catch { return null; } },
  };
}

/** Express middleware factory. `required` is a permission string. */
export function requirePerm(auth, required) {
  return (req, res, next) => {
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : req.query.token;
    const claims = token && auth.verify(token);
    if (!claims) return res.status(401).json({ error: 'Authentication required' });
    if (!auth.stillValid(claims)) {
      return res.status(401).json({ error: 'Session is no longer valid — please sign in again.' });
    }
    req.user = claims;
    if (required && !claims.perms?.includes(required)) {
      return res.status(403).json({ error: `Requires "${required}" permission — your role is ${claims.role}` });
    }
    next();
  };
}
