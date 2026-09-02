/**
 * Set a user's password.
 *
 *   docker compose exec hydroflow node scripts/set-password.mjs <username> '<new password>'
 *   docker compose exec hydroflow node scripts/set-password.mjs --list
 *
 * There is deliberately no self-service password change or reset in the web UI.
 * This plant has six named operators, not a user base: an administrator sets
 * credentials, and every change is written to the event log. A password-reset
 * flow would be more attack surface than it is worth here.
 */
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'node:path';

const DB_FILE = process.env.DB_FILE || path.join(process.cwd(), 'data', 'hydroflow.db');
const [, , username, password] = process.argv;
const db = new Database(DB_FILE);

if (username === '--list' || !username) {
  const rows = db.prepare('SELECT username, name, role, last_login, active FROM users ORDER BY id').all();
  console.log('\n  Accounts in', DB_FILE, '\n');
  for (const r of rows) {
    console.log(`  ${r.username.padEnd(12)} ${String(r.role).padEnd(12)} ` +
      `${r.active ? 'active  ' : 'disabled'} ` +
      `last login: ${r.last_login ? new Date(r.last_login).toISOString().replace('T', ' ').slice(0, 16) : 'never'}`);
  }
  console.log('\n  Usage: node scripts/set-password.mjs <username> \'<new password>\'\n');
  process.exit(0);
}

if (!password) {
  console.error('Error: no password given.\n  node scripts/set-password.mjs <username> \'<new password>\'');
  process.exit(1);
}
if (password.length < 12) {
  console.error(`Error: password is ${password.length} characters. Use at least 12 —\n` +
    '  this dashboard is reachable from the internet.');
  process.exit(1);
}

const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
if (!user) {
  console.error(`Error: no such user "${username}". Run with --list to see accounts.`);
  process.exit(1);
}

db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), user.id);
db.prepare('INSERT INTO events (ts, type, actor, target, detail) VALUES (?,?,?,?,?)')
  .run(Date.now(), 'auth.password-set', 'cli', username, 'Password changed via set-password.mjs');

console.log(`Password updated for "${username}". Existing sessions stay valid until their token expires (TOKEN_TTL).`);
