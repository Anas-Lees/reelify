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

  CREATE INDEX IF NOT EXISTS idx_chapters_subject ON chapters(subjectId);
`);

// ----- Subjects -----
export function listSubjects() {
  return db.prepare(`
    SELECT s.*, COUNT(c.id) as chapterCount
    FROM subjects s
    LEFT JOIN chapters c ON c.subjectId = s.id
    GROUP BY s.id
    ORDER BY s.createdAt DESC
  `).all();
}

export function createSubject({ title, description, color, emoji }) {
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`INSERT INTO subjects (id, title, description, color, emoji, createdAt) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, String(title || "Untitled").slice(0, 80), String(description || "").slice(0, 280), color || "#6b8cff", emoji || "📚", now);
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
