// Postgres-backed persistence (Neon, Supabase, Render Postgres, anywhere with a
// DATABASE_URL). Survives redeploys, runs in the cloud, free tier on Neon.
//
// Schema uses snake_case column names (idiomatic Postgres). The JS layer maps
// rows to camelCase JS objects so the rest of the app doesn't have to change.

import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.DATABASE_URL) {
  console.error(`
[db] FATAL: DATABASE_URL is not set.
Reelify now persists everything to Postgres (so accounts + subjects + saved
reels survive every redeploy). Set DATABASE_URL on Render → service →
Environment. Free Postgres options:

  • Neon       https://neon.tech (free 0.5 GB forever, recommended)
  • Supabase   https://supabase.com (free 500 MB)
  • Render     PostgreSQL (free 90 days then paid)

Connection string format:
  postgresql://USER:PASS@HOST/DBNAME?sslmode=require
`);
  process.exit(1);
}

// Neon + most managed Postgres services require SSL. We accept any cert here
// (the connection string already authenticates via TLS).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5, // small pool — Render free tier has limited connections
});

// ----- Schema (idempotent; runs at startup) -----
export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      avatar_url TEXT DEFAULT '',
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      color TEXT DEFAULT '#6b8cff',
      emoji TEXT DEFAULT '📚',
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_subjects_user ON subjects(user_id);

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      reels_json TEXT NOT NULL DEFAULT '[]',
      quiz_json TEXT NOT NULL DEFAULT '[]',
      settings_json TEXT NOT NULL DEFAULT '{}',
      file_name TEXT DEFAULT '',
      image_map TEXT NOT NULL DEFAULT '{}',
      audio_map TEXT NOT NULL DEFAULT '{}',
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chapters_subject ON chapters(subject_id);

    CREATE TABLE IF NOT EXISTS saved_reels (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      narration TEXT NOT NULL,
      background_prompt TEXT DEFAULT '',
      voice TEXT DEFAULT '',
      accent_color TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      audio_url TEXT DEFAULT '',
      card_json TEXT DEFAULT '',
      saved_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_reels(user_id);

    -- Persistent asset bytes — survive ephemeral disk wipes on Render. Added
    -- as separate ALTERs so the migration is idempotent on existing DBs.
    ALTER TABLE saved_reels ADD COLUMN IF NOT EXISTS image_data BYTEA;
    ALTER TABLE saved_reels ADD COLUMN IF NOT EXISTS image_mime TEXT DEFAULT '';
    ALTER TABLE saved_reels ADD COLUMN IF NOT EXISTS audio_data BYTEA;
    ALTER TABLE saved_reels ADD COLUMN IF NOT EXISTS audio_mime TEXT DEFAULT '';
  `);
  console.log("[db] schema OK");
}

// ----- Row → JS shape mappers -----
function userFromRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    email: r.email,
    passwordHash: r.password_hash,
    displayName: r.display_name || "",
    avatarUrl: r.avatar_url || "",
    createdAt: Number(r.created_at),
  };
}
function subjectFromRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id || null,
    title: r.title,
    description: r.description || "",
    color: r.color || "#6b8cff",
    emoji: r.emoji || "📚",
    createdAt: Number(r.created_at),
    chapterCount: r.chapter_count !== undefined ? Number(r.chapter_count) : undefined,
  };
}
function chapterFromRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    subjectId: r.subject_id,
    title: r.title,
    reels: safeParse(r.reels_json, []),
    quiz: safeParse(r.quiz_json, []),
    settings: safeParse(r.settings_json, {}),
    fileName: r.file_name || "",
    imageMap: safeParse(r.image_map, {}),
    audioMap: safeParse(r.audio_map, {}),
    createdAt: Number(r.created_at),
  };
}
function savedReelFromRow(r) {
  if (!r) return null;
  // If asset bytes are stored in the DB, expose them via stable
  // /api/saved/:id/image|audio routes that ALWAYS work, regardless of
  // whether the original /images/... or /audio/... files still exist on
  // the ephemeral disk. Falls back to the historical url otherwise.
  const hasImageData = r.image_data != null;
  const hasAudioData = r.audio_data != null;
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    narration: r.narration,
    backgroundPrompt: r.background_prompt || "",
    voice: r.voice || "",
    accentColor: r.accent_color || "",
    imageUrl: hasImageData ? `/api/saved/${r.id}/image` : (r.image_url || ""),
    audioUrl: hasAudioData ? `/api/saved/${r.id}/audio` : (r.audio_url || ""),
    cardJson: r.card_json || "",
    savedAt: Number(r.saved_at),
    hasImageData,
    hasAudioData,
  };
}
function safeParse(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }

// ============================================================================
//  Users
// ============================================================================
export async function getUserByEmail(email) {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE email = $1 LIMIT 1`,
    [String(email || "").toLowerCase()]
  );
  return userFromRow(rows[0]);
}
export async function getUser(id) {
  const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
  return userFromRow(rows[0]);
}
export async function createUser({ email, passwordHash, displayName }) {
  const id = crypto.randomUUID();
  const now = Date.now();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [id, String(email).toLowerCase(), passwordHash, String(displayName || "").slice(0, 80), now]
  );
  return getUser(id);
}
export async function updateUserProfile(id, { displayName, avatarUrl }) {
  const cur = await getUser(id);
  if (!cur) return null;
  const next = {
    displayName: displayName !== undefined ? String(displayName).slice(0, 80) : cur.displayName,
    avatarUrl:   avatarUrl   !== undefined ? String(avatarUrl).slice(0, 500) : cur.avatarUrl,
  };
  await pool.query(
    `UPDATE users SET display_name = $1, avatar_url = $2 WHERE id = $3`,
    [next.displayName, next.avatarUrl, id]
  );
  return getUser(id);
}
export async function claimOrphanSubjectsFor(userId) {
  const { rowCount } = await pool.query(
    `UPDATE subjects SET user_id = $1 WHERE user_id IS NULL OR user_id = ''`,
    [userId]
  );
  return rowCount || 0;
}

// ============================================================================
//  Saved reels
// ============================================================================
export async function listSavedReels(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM saved_reels WHERE user_id = $1 ORDER BY saved_at DESC LIMIT 200`,
    [userId]
  );
  return rows.map(savedReelFromRow);
}
export async function findSavedReel(userId, title, narration) {
  const { rows } = await pool.query(
    `SELECT * FROM saved_reels WHERE user_id = $1 AND title = $2 AND narration = $3 LIMIT 1`,
    [userId, title, narration]
  );
  return savedReelFromRow(rows[0]);
}
export async function createSavedReel({
  userId, title, narration, backgroundPrompt, voice, accentColor, imageUrl, audioUrl, card,
  imageData, imageMime, audioData, audioMime,
}) {
  const id = crypto.randomUUID();
  const now = Date.now();
  await pool.query(
    `INSERT INTO saved_reels
       (id, user_id, title, narration, background_prompt, voice, accent_color,
        image_url, audio_url, card_json, saved_at,
        image_data, image_mime, audio_data, audio_mime)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      id, userId,
      String(title || "Untitled").slice(0, 200),
      String(narration || "").slice(0, 4000),
      String(backgroundPrompt || "").slice(0, 1000),
      String(voice || "").slice(0, 40),
      String(accentColor || "").slice(0, 16),
      String(imageUrl || "").slice(0, 500),
      String(audioUrl || "").slice(0, 500),
      card ? JSON.stringify(card).slice(0, 4000) : "",
      now,
      imageData || null,
      String(imageMime || "").slice(0, 80),
      audioData || null,
      String(audioMime || "").slice(0, 80),
    ]
  );
  const { rows } = await pool.query(`SELECT * FROM saved_reels WHERE id = $1`, [id]);
  return savedReelFromRow(rows[0]);
}

// Returns { data: Buffer, mime: string } | null
// Lookup by ID alone — the saved-reel UUID is the access token here, since
// <img> and <audio> tags can't send Authorization headers. UUIDs are 128-bit
// random, so they're effectively unguessable.
export async function getSavedReelAsset(id, kind) {
  const col = kind === "audio" ? "audio_data" : "image_data";
  const mimeCol = kind === "audio" ? "audio_mime" : "image_mime";
  const fallbackMime = kind === "audio" ? "audio/wav" : "image/png";
  const { rows } = await pool.query(
    `SELECT ${col} AS data, ${mimeCol} AS mime
       FROM saved_reels WHERE id = $1 LIMIT 1`,
    [id]
  );
  if (!rows[0] || !rows[0].data) return null;
  return { data: rows[0].data, mime: rows[0].mime || fallbackMime };
}
export async function deleteSavedReel(id, userId) {
  const { rowCount } = await pool.query(
    `DELETE FROM saved_reels WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return rowCount || 0;
}

// ============================================================================
//  Subjects
// ============================================================================
export async function listSubjects(userId) {
  if (userId) {
    const { rows } = await pool.query(
      `SELECT s.*, COUNT(c.id) AS chapter_count
       FROM subjects s
       LEFT JOIN chapters c ON c.subject_id = s.id
       WHERE s.user_id = $1
       GROUP BY s.id
       ORDER BY s.created_at DESC`,
      [userId]
    );
    return rows.map(subjectFromRow);
  }
  const { rows } = await pool.query(`
    SELECT s.*, COUNT(c.id) AS chapter_count
    FROM subjects s
    LEFT JOIN chapters c ON c.subject_id = s.id
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `);
  return rows.map(subjectFromRow);
}
export async function createSubject({ title, description, color, emoji, userId }) {
  const id = crypto.randomUUID();
  const now = Date.now();
  await pool.query(
    `INSERT INTO subjects (id, user_id, title, description, color, emoji, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id, userId || null,
      String(title || "Untitled").slice(0, 80),
      String(description || "").slice(0, 280),
      color || "#6b8cff",
      emoji || "📚",
      now,
    ]
  );
  return getSubject(id);
}
export async function getSubject(id) {
  const { rows } = await pool.query(`SELECT * FROM subjects WHERE id = $1`, [id]);
  return subjectFromRow(rows[0]);
}
export async function updateSubject(id, patch) {
  const cur = await getSubject(id);
  if (!cur) return null;
  const next = {
    title:       patch.title       !== undefined ? String(patch.title).slice(0, 80)        : cur.title,
    description: patch.description !== undefined ? String(patch.description).slice(0, 280) : cur.description,
    color:       patch.color       || cur.color,
    emoji:       patch.emoji       || cur.emoji,
  };
  await pool.query(
    `UPDATE subjects SET title = $1, description = $2, color = $3, emoji = $4 WHERE id = $5`,
    [next.title, next.description, next.color, next.emoji, id]
  );
  return getSubject(id);
}
export async function deleteSubject(id) {
  await pool.query(`DELETE FROM subjects WHERE id = $1`, [id]);
}

// ============================================================================
//  Chapters
// ============================================================================
export async function listChapters(subjectId) {
  const { rows } = await pool.query(
    `SELECT * FROM chapters WHERE subject_id = $1 ORDER BY created_at ASC`,
    [subjectId]
  );
  return rows.map(chapterFromRow);
}
export async function getChapter(id) {
  const { rows } = await pool.query(`SELECT * FROM chapters WHERE id = $1`, [id]);
  return chapterFromRow(rows[0]);
}
export async function createChapter({ subjectId, title, reels, quiz, settings, fileName }) {
  const subj = await getSubject(subjectId);
  if (!subj) throw new Error("Subject not found");
  const id = crypto.randomUUID();
  const now = Date.now();
  await pool.query(
    `INSERT INTO chapters (id, subject_id, title, reels_json, quiz_json, settings_json, file_name, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id, subjectId,
      String(title || "Untitled").slice(0, 120),
      JSON.stringify(reels || []),
      JSON.stringify(quiz || []),
      JSON.stringify(settings || {}),
      String(fileName || "").slice(0, 200),
      now,
    ]
  );
  return getChapter(id);
}
export async function deleteChapter(id) {
  await pool.query(`DELETE FROM chapters WHERE id = $1`, [id]);
}
export async function setChapterAsset(id, kind, reelIdx, url) {
  const cur = await getChapter(id);
  if (!cur) return null;
  const isAudio = kind === "audio";
  const map = isAudio ? cur.audioMap : cur.imageMap;
  map[String(reelIdx)] = url;
  const col = isAudio ? "audio_map" : "image_map";
  await pool.query(`UPDATE chapters SET ${col} = $1 WHERE id = $2`, [JSON.stringify(map), id]);
  return map;
}

export default pool;
