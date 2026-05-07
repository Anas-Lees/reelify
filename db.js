import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, "reelify.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    displayName TEXT DEFAULT '',
    createdAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subjects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    color TEXT DEFAULT '#6b8cff',
    emoji TEXT DEFAULT '📚',
    createdAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chapters (
    id TEXT PRIMARY KEY,
    subjectId TEXT NOT NULL,
    title TEXT NOT NULL,
    reelsJson TEXT NOT NULL DEFAULT '[]',
    quizJson TEXT NOT NULL DEFAULT '[]',
    settingsJson TEXT NOT NULL DEFAULT '{}',
    fileName TEXT DEFAULT '',
    imageMap TEXT NOT NULL DEFAULT '{}',
    audioMap TEXT NOT NULL DEFAULT '{}',
    createdAt INTEGER NOT NULL,
    FOREIGN KEY(subjectId) REFERENCES subjects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS saved_reels (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    title TEXT NOT NULL,
    narration TEXT NOT NULL,
    backgroundPrompt TEXT DEFAULT '',
    voice TEXT DEFAULT '',
    accentColor TEXT DEFAULT '',
    imageUrl TEXT DEFAULT '',
    audioUrl TEXT DEFAULT '',
    cardJson TEXT DEFAULT '',
    savedAt INTEGER NOT NULL,
    FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_chapters_subject ON chapters(subjectId);
  CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_reels(userId);
`);

// Idempotent migrations
try { db.exec(`ALTER TABLE subjects ADD COLUMN userId TEXT`); } catch {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_subjects_user ON subjects(userId)`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN avatarUrl TEXT DEFAULT ''`); } catch {}

// ----- Users -----
export function getUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(String(email || "").toLowerCase());
}
export function getUser(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}
export function createUser({ email, passwordHash, displayName }) {
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`INSERT INTO users (id, email, passwordHash, displayName, createdAt) VALUES (?, ?, ?, ?, ?)`)
    .run(id, String(email).toLowerCase(), passwordHash, String(displayName || "").slice(0, 80), now);
  return getUser(id);
}

export function updateUserProfile(id, { displayName, avatarUrl }) {
  const cur = getUser(id);
  if (!cur) return null;
  const next = {
    displayName: displayName !== undefined ? String(displayName).slice(0, 80) : cur.displayName,
    avatarUrl:   avatarUrl   !== undefined ? String(avatarUrl).slice(0, 500)  : (cur.avatarUrl || ""),
  };
  db.prepare(`UPDATE users SET displayName = ?, avatarUrl = ? WHERE id = ?`)
    .run(next.displayName, next.avatarUrl, id);
  return getUser(id);
}

// First signup claims any orphan subjects (single-user-on-fresh-deploy convenience).
export function claimOrphanSubjectsFor(userId) {
  return db.prepare(`UPDATE subjects SET userId = ? WHERE userId IS NULL OR userId = ''`).run(userId).changes;
}

// ----- Saved reels -----
export function listSavedReels(userId) {
  return db.prepare(`SELECT * FROM saved_reels WHERE userId = ? ORDER BY savedAt DESC LIMIT 200`).all(userId);
}
export function findSavedReel(userId, title, narration) {
  return db.prepare(`SELECT * FROM saved_reels WHERE userId = ? AND title = ? AND narration = ? LIMIT 1`).get(userId, title, narration);
}
export function createSavedReel({ userId, title, narration, backgroundPrompt, voice, accentColor, imageUrl, audioUrl, card }) {
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`INSERT INTO saved_reels (id, userId, title, narration, backgroundPrompt, voice, accentColor, imageUrl, audioUrl, cardJson, savedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      id, userId,
      String(title || "Untitled").slice(0, 200),
      String(narration || "").slice(0, 4000),
      String(backgroundPrompt || "").slice(0, 1000),
      String(voice || "").slice(0, 40),
      String(accentColor || "").slice(0, 16),
      String(imageUrl || "").slice(0, 500),
      String(audioUrl || "").slice(0, 500),
      card ? JSON.stringify(card).slice(0, 4000) : "",
      now
    );
  return db.prepare(`SELECT * FROM saved_reels WHERE id = ?`).get(id);
}
export function deleteSavedReel(id, userId) {
  return db.prepare(`DELETE FROM saved_reels WHERE id = ? AND userId = ?`).run(id, userId).changes;
}

// ----- Subjects -----
export function listSubjects(userId) {
  if (userId) {
    return db.prepare(`
      SELECT s.*, COUNT(c.id) as chapterCount
      FROM subjects s
      LEFT JOIN chapters c ON c.subjectId = s.id
      WHERE s.userId = ?
      GROUP BY s.id
      ORDER BY s.createdAt DESC
    `).all(userId);
  }
  return db.prepare(`
    SELECT s.*, COUNT(c.id) as chapterCount
    FROM subjects s
    LEFT JOIN chapters c ON c.subjectId = s.id
    GROUP BY s.id
    ORDER BY s.createdAt DESC
  `).all();
}

export function createSubject({ title, description, color, emoji, userId }) {
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`INSERT INTO subjects (id, title, description, color, emoji, createdAt, userId) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, String(title || "Untitled").slice(0, 80), String(description || "").slice(0, 280), color || "#6b8cff", emoji || "📚", now, userId || null);
  return getSubject(id);
}

export function getSubject(id) {
  return db.prepare("SELECT * FROM subjects WHERE id = ?").get(id);
}

export function updateSubject(id, patch) {
  const cur = getSubject(id);
  if (!cur) return null;
  const next = {
    title: patch.title !== undefined ? String(patch.title).slice(0, 80) : cur.title,
    description: patch.description !== undefined ? String(patch.description).slice(0, 280) : cur.description,
    color: patch.color || cur.color,
    emoji: patch.emoji || cur.emoji,
  };
  db.prepare(`UPDATE subjects SET title = ?, description = ?, color = ?, emoji = ? WHERE id = ?`)
    .run(next.title, next.description, next.color, next.emoji, id);
  return getSubject(id);
}

export function deleteSubject(id) {
  db.prepare("DELETE FROM subjects WHERE id = ?").run(id);
}

// ----- Chapters -----
function rowToChapter(row) {
  if (!row) return null;
  return {
    id: row.id,
    subjectId: row.subjectId,
    title: row.title,
    reels: safeParse(row.reelsJson, []),
    quiz: safeParse(row.quizJson, []),
    settings: safeParse(row.settingsJson, {}),
    imageMap: safeParse(row.imageMap, {}),
    audioMap: safeParse(row.audioMap, {}),
    fileName: row.fileName || "",
    createdAt: row.createdAt,
  };
}
function safeParse(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }

export function listChapters(subjectId) {
  const rows = db.prepare(`SELECT * FROM chapters WHERE subjectId = ? ORDER BY createdAt ASC`).all(subjectId);
  return rows.map(rowToChapter);
}

export function getChapter(id) {
  return rowToChapter(db.prepare("SELECT * FROM chapters WHERE id = ?").get(id));
}

export function createChapter({ subjectId, title, reels, quiz, settings, fileName }) {
  if (!getSubject(subjectId)) throw new Error("Subject not found");
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`INSERT INTO chapters (id, subjectId, title, reelsJson, quizJson, settingsJson, fileName, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      id, subjectId,
      String(title || "Untitled").slice(0, 120),
      JSON.stringify(reels || []),
      JSON.stringify(quiz || []),
      JSON.stringify(settings || {}),
      String(fileName || "").slice(0, 200),
      now
    );
  return getChapter(id);
}

export function deleteChapter(id) {
  db.prepare("DELETE FROM chapters WHERE id = ?").run(id);
}

export function setChapterAsset(id, kind, reelIdx, url) {
  const cur = getChapter(id);
  if (!cur) return null;
  const field = kind === "audio" ? "audioMap" : "imageMap";
  const map = kind === "audio" ? cur.audioMap : cur.imageMap;
  map[String(reelIdx)] = url;
  db.prepare(`UPDATE chapters SET ${field} = ? WHERE id = ?`).run(JSON.stringify(map), id);
  return map;
}

export default db;
