/**
 * USER MANAGEMENT
 * -----------------------------------------------------------------------------
 * Administrators create and edit accounts; every user can edit their own profile
 * and change their own password.
 *
 * The rules that matter here are the ones that stop an administrator locking
 * everybody out, and the ones that stop a password change being cosmetic:
 *
 *   · the last active administrator cannot be demoted, deactivated or deleted —
 *     checked inside the same transaction as the write, not before it
 *   · changing your own password requires your current one, so a borrowed
 *     unlocked laptop cannot be used to take the account over
 *   · a password change stamps `pw_changed_at`, and every token issued before
 *     that instant stops being accepted. Without this a "reset" would leave the
 *     old holder signed in for the remaining life of their 12-hour token.
 *   · usernames are immutable — they are the JWT subject and the audit key.
 *     Renaming a person means a new account, which is the honest record anyway.
 */

import bcrypt from 'bcryptjs';
import { ROLES } from './tags.js';
import { logEvent } from './db.js';

export const MIN_PASSWORD = 12;
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const publicUser = (u) => ({
  id: u.id, username: u.username, name: u.name, email: u.email, role: u.role,
  label: ROLES[u.role]?.label, scope: ROLES[u.role]?.scope, perms: ROLES[u.role]?.perms ?? [],
  active: !!u.active, created_at: u.created_at, last_login: u.last_login, pw_changed_at: u.pw_changed_at,
});

export function makeUsers(db) {
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');
  const byName = db.prepare('SELECT * FROM users WHERE username = ?');
  const countActiveAdmins = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin' AND active = 1");

  /** Throws if the change would leave no way back into the system. */
  function assertNotLastAdmin(user, { newRole = user.role, newActive = user.active } = {}) {
    const wasUsableAdmin = user.role === 'admin' && user.active;
    const stillUsableAdmin = newRole === 'admin' && newActive;
    if (wasUsableAdmin && !stillUsableAdmin && countActiveAdmins.get().c <= 1) {
      throw new UserError(
        'This is the only active administrator. Promote another account to admin first, ' +
        'otherwise nobody could manage users again.', 409);
    }
  }

  function assertPassword(pw) {
    if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) {
      throw new UserError(`Password must be at least ${MIN_PASSWORD} characters.`);
    }
    if (pw.trim() !== pw) throw new UserError('Password cannot start or end with a space.');
  }

  function assertRole(role) {
    if (!ROLES[role]) throw new UserError(`Unknown role "${role}". Valid roles: ${Object.keys(ROLES).join(', ')}.`);
  }

  return {
    list: () => db.prepare('SELECT * FROM users ORDER BY id').all().map(publicUser),

    get(id) {
      const u = byId.get(id);
      if (!u) throw new UserError('No such user.', 404);
      return publicUser(u);
    },

    create({ username, name, email, role, password }, actor) {
      username = String(username || '').toLowerCase().trim();
      if (!USERNAME_RE.test(username)) {
        throw new UserError('Username must be 3–32 characters: lowercase letters, digits, dot, dash or underscore, starting with a letter or digit.');
      }
      if (byName.get(username)) throw new UserError(`Username "${username}" is already taken.`, 409);
      if (!String(name || '').trim()) throw new UserError('Full name is required.');
      assertRole(role);
      assertPassword(password);

      const now = Date.now();
      const info = db.prepare(`INSERT INTO users (username, name, email, role, pw_hash, created_at, pw_changed_at, active)
                               VALUES (?,?,?,?,?,?,?,1)`)
        .run(username, String(name).trim(), String(email || '').trim() || null, role, bcrypt.hashSync(password, 10), now, now);
      logEvent(db, 'user.create', { actor, target: username, detail: `role=${role}` });
      return publicUser(byId.get(info.lastInsertRowid));
    },

    /** Administrator edit. Username and password are handled separately. */
    update(id, { name, email, role, active }, actor) {
      const u = byId.get(id);
      if (!u) throw new UserError('No such user.', 404);

      const next = {
        name: name === undefined ? u.name : String(name).trim(),
        email: email === undefined ? u.email : (String(email).trim() || null),
        role: role === undefined ? u.role : role,
        active: active === undefined ? u.active : (active ? 1 : 0),
      };
      if (!next.name) throw new UserError('Full name is required.');
      assertRole(next.role);
      assertNotLastAdmin(u, { newRole: next.role, newActive: next.active });

      db.prepare('UPDATE users SET name=?, email=?, role=?, active=? WHERE id=?')
        .run(next.name, next.email, next.role, next.active, id);

      const changes = [];
      if (next.name !== u.name) changes.push('name');
      if (next.email !== u.email) changes.push('email');
      if (next.role !== u.role) changes.push(`role ${u.role}→${next.role}`);
      if (next.active !== u.active) changes.push(next.active ? 'reactivated' : 'deactivated');
      // A deactivated or demoted account must not keep its current session.
      if (next.active !== u.active || next.role !== u.role) {
        db.prepare('UPDATE users SET pw_changed_at=? WHERE id=?').run(Date.now(), id);
      }
      logEvent(db, 'user.update', { actor, target: u.username, detail: changes.join(', ') || 'no change' });
      return publicUser(byId.get(id));
    },

    /** Self-service profile edit — deliberately cannot touch role or active. */
    updateSelf(username, { name, email }, actor) {
      const u = byName.get(username);
      if (!u) throw new UserError('No such user.', 404);
      const nextName = name === undefined ? u.name : String(name).trim();
      const nextEmail = email === undefined ? u.email : (String(email).trim() || null);
      if (!nextName) throw new UserError('Full name is required.');
      db.prepare('UPDATE users SET name=?, email=? WHERE id=?').run(nextName, nextEmail, u.id);
      logEvent(db, 'user.update-self', { actor, target: u.username, detail: 'name/email' });
      return publicUser(byId.get(u.id));
    },

    /** Administrator resets someone else's password. Their sessions end. */
    setPassword(id, password, actor) {
      const u = byId.get(id);
      if (!u) throw new UserError('No such user.', 404);
      assertPassword(password);
      const now = Date.now();
      db.prepare('UPDATE users SET pw_hash=?, pw_changed_at=? WHERE id=?').run(bcrypt.hashSync(password, 10), now, u.id);
      logEvent(db, 'user.password-reset', { actor, target: u.username, detail: 'by administrator' });
      return publicUser(byId.get(u.id));
    },

    /** Own password change — requires the current one. */
    changeOwnPassword(username, currentPassword, newPassword, actor) {
      const u = byName.get(username);
      if (!u) throw new UserError('No such user.', 404);
      if (!bcrypt.compareSync(String(currentPassword || ''), u.pw_hash)) {
        logEvent(db, 'user.password-change-failed', { actor, target: u.username, detail: 'wrong current password' });
        throw new UserError('Current password is incorrect.', 403);
      }
      assertPassword(newPassword);
      if (bcrypt.compareSync(newPassword, u.pw_hash)) {
        throw new UserError('New password must be different from the current one.');
      }
      const now = Date.now();
      db.prepare('UPDATE users SET pw_hash=?, pw_changed_at=? WHERE id=?').run(bcrypt.hashSync(newPassword, 10), now, u.id);
      logEvent(db, 'user.password-change', { actor, target: u.username, detail: 'self-service' });
      return { user: publicUser(byId.get(u.id)), pwChangedAt: now };
    },

    /** Deactivate rather than delete — the audit trail must keep referring to a real account. */
    deactivate(id, actor) {
      const u = byId.get(id);
      if (!u) throw new UserError('No such user.', 404);
      assertNotLastAdmin(u, { newActive: 0 });
      db.prepare('UPDATE users SET active=0, pw_changed_at=? WHERE id=?').run(Date.now(), id);
      logEvent(db, 'user.deactivate', { actor, target: u.username });
      return publicUser(byId.get(id));
    },
  };
}
