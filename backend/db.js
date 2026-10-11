// SQLite storage using Node's built-in node:sqlite (no native addons needed).
// DB file lives next to server.js.
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(path.join(__dirname, 'studio.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS creations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  duration_sec INTEGER,
  aspect TEXT,
  media_url TEXT,
  thumb_url TEXT,
  status TEXT NOT NULL DEFAULT 'done',
  cost_credits INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS recharges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount_pkr INTEGER NOT NULL,
  tx_ref TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

const stmts = {
  createUser: db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),
  getUserByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  addCredits: db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?'),
  createSession: db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)'),
  getSession: db.prepare('SELECT s.*, u.username, u.credits FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  addCreation: db.prepare(`INSERT INTO creations
    (user_id, kind, model, prompt, duration_sec, aspect, media_url, thumb_url, status, cost_credits)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  updateCreation: db.prepare('UPDATE creations SET status = ?, media_url = ?, thumb_url = ? WHERE id = ?'),
  markCreationFailed: db.prepare("UPDATE creations SET status = 'failed' WHERE id = ?"),
  listCreations: db.prepare('SELECT * FROM creations WHERE user_id = ? ORDER BY id DESC LIMIT 60'),
  countTodayVideos: db.prepare(`SELECT COUNT(*) AS c FROM creations
    WHERE user_id = ? AND kind = 'video' AND model = 'free-animated' AND status = 'done'
    AND date(created_at) = date('now')`),
  countTodayImages: db.prepare(`SELECT COUNT(*) AS c FROM creations
    WHERE user_id = ? AND kind = 'image' AND status = 'done'
    AND date(created_at) = date('now')`),
  createRecharge: db.prepare('INSERT INTO recharges (user_id, amount_pkr, tx_ref, note) VALUES (?, ?, ?, ?)'),
  listRecharges: db.prepare(`SELECT r.*, u.username FROM recharges r JOIN users u ON u.id = r.user_id
    ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.id DESC LIMIT 100`),
  listUserRecharges: db.prepare('SELECT * FROM recharges WHERE user_id = ? ORDER BY id DESC LIMIT 30'),
  getRecharge: db.prepare('SELECT * FROM recharges WHERE id = ?'),
  setRechargeStatus: db.prepare("UPDATE recharges SET status = ?, decided_at = datetime('now') WHERE id = ?"),
};

module.exports = { db, stmts };
