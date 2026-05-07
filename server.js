import express from "express";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import officeParser from "officeparser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import * as db from "./db.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.GEMINI_API_KEY) {
  console.error("\nMissing GEMINI_API_KEY. Copy .env.example to .env and add your key from https://aistudio.google.com/apikey\n");
  process.exit(1);
}

// JWT secret resolution. Priority: env var → file on disk → freshly random.
// Persisting to a file means tokens survive container sleep/wake on Render's
// free tier (filesystem persists between sleeps, only resets on redeploy).
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  const SECRET_FILE = path.join(__dirname, ".jwt-secret");
  try {
    if (fs.existsSync(SECRET_FILE)) {
      JWT_SECRET = fs.readFileSync(SECRET_FILE, "utf-8").trim();
      console.log("[auth] loaded JWT secret from", SECRET_FILE);
    }
  } catch {}
  if (!JWT_SECRET) {
    JWT_SECRET = crypto.randomBytes(32).toString("hex");
    try {
      fs.writeFileSync(SECRET_FILE, JWT_SECRET, { mode: 0o600 });
      console.log("[auth] created new persistent JWT secret at", SECRET_FILE);
    } catch (e) {
      console.warn("[auth] couldn't persist JWT secret to disk:", e.message);
    }
  }
  console.warn("[auth] JWT_SECRET env var not set — set it in Render → service → Environment for the most reliable token continuity across redeploys.");
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const uploadsDir = path.join(__dirname, "uploads");
const imagesDir = path.join(__dirname, "generated-images");
const audioDir = path.join(__dirname, "generated-audio");
for (const d of [uploadsDir, imagesDir, audioDir]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const app = express();
app.use(express.json({ limit: "50mb" }));
// Defeat WebView caching of HTML/JS/CSS so deploys land on phones immediately
// (without users having to clear app data). Generated images/audio are content-
// addressed and safe to cache aggressively.
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res, filepath) {
    if (/\.(html|js|css|json)$/.test(filepath)) {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
    }
  },
}));
app.use("/images", express.static(imagesDir, {
  setHeaders(res) { res.setHeader("Cache-Control", "public, max-age=2592000, immutable"); },
}));
app.use("/audio", express.static(audioDir, {
  setHeaders(res) { res.setHeader("Cache-Control", "public, max-age=2592000, immutable"); },
}));

// Auth middleware MUST be registered BEFORE any protected route
// (Express runs middleware in registration order; if requireAuth-using routes
//  are added before app.use(authMiddleware), req.user is never set and every
//  protected request returns 401 — which was the actual cause of "create reel
//  goes back to login".)
function authMiddleware(req, _res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  req.user = null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = { id: payload.id, email: payload.email };
    } catch (e) {
      console.warn("[auth] token verify failed:", e.message);
    }
  }
  next();
}
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Sign in required" });
  next();
}
app.use(authMiddleware);

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 100 * 1024 * 1024 },
});

const TEXT_MODEL = "gemini-2.5-flash";
const IMAGE_MODEL = "gemini-2.5-flash-image";
const TTS_MODEL = "gemini-2.5-flash-preview-tts";
const TTS_VOICE = "Aoede"; // bright, breezy — good for short narrations

const VIBE_INSTR = {
  educational: "TONE: clear, informative, like a great teacher who keeps things genuinely interesting. Trustworthy and warm. No fluff.",
  fun: "TONE: playful, witty, packed with light humor and clever analogies. Make every reel entertaining — punchlines, surprise, fun comparisons.",
  dramatic: "TONE: cinematic, suspenseful, vivid. Build tension. Use powerful, evocative language like a documentary narrator. End with a hook.",
  chill: "TONE: calm, conversational, like a friend explaining something over coffee. No hype, no shouting. Warm, slow, soothing.",
  genz: "TONE: casual, current, Gen-Z friendly. Modern slang where it fits, pop-culture references, internet humor. Energetic but still informative — no cringe.",
};

const LENGTH_INSTR = {
  short: "LENGTH: aim for 3 to 5 reels. Tight, punchy — only the most essential info.",
  standard: "LENGTH: aim for 5 to 9 reels. Cover the content thoroughly without bloat.",
  long: "LENGTH: aim for 9 to 14 reels. Be exhaustive — extract every interesting detail.",
};

const QUIZ_INSTR = {
  easy: "QUIZ: easy difficulty — straightforward recall of facts that were explicitly stated.",
  medium: "QUIZ: medium difficulty — mix of factual recall and basic understanding/inference.",
  hard: "QUIZ: hard difficulty — test deeper understanding, connections between ideas, and nuanced inference. Make distractors plausible.",
};

const LANGUAGE_INSTR = {
  en: "LANGUAGE: write all titles, narration, quiz questions, options, and explanations in natural English.",
  es: "LANGUAGE: write all titles, narration, quiz questions, options, and explanations in natural Spanish (Español).",
  fr: "LANGUAGE: write all titles, narration, quiz questions, options, and explanations in natural French (Français).",
  de: "LANGUAGE: write all titles, narration, quiz questions, options, and explanations in natural German (Deutsch).",
  it: "LANGUAGE: write all titles, narration, quiz questions, options, and explanations in natural Italian (Italiano).",
  pt: "LANGUAGE: write all titles, narration, quiz questions, options, and explanations in natural Portuguese (Português).",
  ja: "LANGUAGE: write all titles, narration, quiz questions, options, and explanations in natural Japanese (日本語).",
  ko: "LANGUAGE: write all titles, narration, quiz questions, options, and explanations in natural Korean (한국어).",
  ar: "LANGUAGE: write all titles, narration, quiz questions, options, and explanations in natural Arabic (العربية).",
  hi: "LANGUAGE: write all titles, narration, quiz questions, options, and explanations in natural Hindi (हिन्दी).",
  zh: "LANGUAGE: write all titles, narration, quiz questions, options, and explanations in natural Mandarin Chinese (中文).",
};

const IMAGE_STYLE_INSTR = {
  photo: "Render in a photorealistic cinematic photography style — sharp focus, professional studio lighting, shallow depth of field, true-to-life colors.",
  "3d": "Render as a polished 3D render — clean geometry, soft global illumination, subtle reflections, modern Pixar-meets-editorial look.",
  watercolor: "Render in a beautiful watercolor painting style — visible paper texture, flowing pigment edges, soft luminous washes, hand-painted feel.",
  anime: "Render in a vibrant anime / manga illustration style — clean confident linework, expressive cel shading, vivid saturated colors.",
  neon: "Render in a synthwave neon aesthetic — glowing magenta and cyan rim lighting, deep dark background, retro-futuristic, atmospheric haze.",
  vintage: "Render as a vintage mid-century travel poster — limited bold color palette, subtle paper grain, simplified geometric shapes, nostalgic feel.",
  oil: "Render as a classical oil painting — visible brush strokes, rich layered pigments, dramatic chiaroscuro lighting, museum-quality.",
};

function sanitizeCustom(s, max = 240) {
  if (!s || typeof s !== "string") return "";
  return s.replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function buildReelPrompt(settings) {
  const vibeCustom = sanitizeCustom(settings.vibeCustom, 240);
  const vibe = (settings.vibe === "custom" && vibeCustom)
    ? `TONE / STYLE: ${vibeCustom}. Match this tone faithfully across every reel — vocabulary, rhythm, references, energy. Stay coherent and engaging while honoring this style.`
    : (VIBE_INSTR[settings.vibe] || VIBE_INSTR.educational);

  const len = LENGTH_INSTR[settings.length] || LENGTH_INSTR.standard;

  const quizCustom = sanitizeCustom(settings.quizDifficultyCustom, 240);
  const quiz = (settings.quizDifficulty === "custom" && quizCustom)
    ? `QUIZ: ${quizCustom}.`
    : (QUIZ_INSTR[settings.quizDifficulty] || QUIZ_INSTR.medium);

  const langCustom = sanitizeCustom(settings.languageCustom, 120);
  const lang = (settings.language === "custom" && langCustom)
    ? `LANGUAGE: write all titles, narration, quiz questions, options, and explanations in ${langCustom}. If that language/dialect isn't natively supported, do your best approximation and stay consistent.`
    : (LANGUAGE_INSTR[settings.language] || LANGUAGE_INSTR.en);

  const podcastInstr = settings.format === "podcast"
    ? `\n- FORMAT — PODCAST DIALOGUE: Write each reel's "narration" as a back-and-forth dialogue between TWO co-hosts. Tag every line strictly with [A]: or [B]: at the start (e.g. "[A]: Welcome back!\\n[B]: Today we're talking..."). Alternate hosts naturally — short conversational turns of 5-15 words each, with chemistry: react to each other, agree/push back, light banter. Together they cover the topic. Total length 50-110 words combined. No stage directions, no quote marks.`
    : "";

  return `You are an AI that turns documents into a series of short-form video reels (Instagram Reels / TikTok style) for learning and entertainment, plus a final quiz.

USER PREFERENCES — HONOR THESE:
- ${lang}
- ${vibe}
- ${len}
- ${quiz}${podcastInstr}

Carefully analyze the attached content and extract EVERY meaningful piece of information. Then organize it into reels.

GROUPING RULES:
- Pack RELATED facts/ideas into the SAME reel so it flows as one cohesive story.
- UNRELATED topics get their OWN reels.
- Cover ALL the information — be comprehensive. Do not skip details.
- Reel count target is set by the LENGTH preference above.

EACH REEL MUST HAVE:
1. "title": short, punchy hook (max 8 words). Engaging, not academic.
2. "narration": the script the TTS will read aloud. 40-90 words. Conversational, energetic, easy to listen to. Use short sentences. No markdown, no bullet points, no special characters that would sound weird in TTS. Just clean spoken text.
   IMPORTANT: if the input is rough notes / typos / fragmented copy-paste, FIX it as you write narration — proper grammar, accurate facts, clean structure.
3. "background_prompt": describe ONE clear visual scene that DIRECTLY illustrates this reel's topic so a viewer can SEE what's being explained — like the cover image of a magazine article. Format your prompt as: "[STYLE] of [SPECIFIC SUBJECT], [composition detail], [lighting], [mood/atmosphere]". The SUBJECT must be concrete and identifiable (e.g. "the human heart", "the Eiffel Tower at golden hour", "a glowing DNA double helix", "a Roman legionary in armor"), NOT abstract patterns or vibes. Position the subject DEAD CENTER of the frame, magazine-cover style, with clean uncluttered surroundings. Pick a polished aesthetic appropriate to the topic: cinematic photo, scientific illustration, watercolor, oil painting, 3D render, matte painting, or vintage poster. The image should TEACH the topic visually, not just decorate. Make every reel's background visually distinct from the others.
4. "accent_color": a single hex color (e.g. "#FF6B6B") that matches the mood of the reel for UI accents.
5. "voice": pick the voice that best matches this reel's tone, from EXACTLY one of: "Aoede" (breezy, upbeat), "Puck" (bright, playful), "Charon" (informative, deep), "Kore" (firm, clear), "Leda" (warm, youthful), "Fenrir" (energetic, intense). Vary voices across reels — don't pick the same one every time.

OPTIONAL — "card" field on a reel:
Some content is best shown VISUALLY rather than only spoken: math formulas, code snippets, important quotes, structured lists, key definitions. For those reels (and ONLY those — use sparingly, maybe 0-3 reels per document), include a "card" object so the viewer reads it on-screen while you narrate around it:
  "card": {
    "type": "code" | "math" | "quote" | "definition" | "list",
    "title": "Optional short label, max 6 words",
    "language": "python" | "javascript" | "go" | etc — only when type is "code",
    "content": "The actual text. Keep under 350 characters. Multi-line OK. For code, format it cleanly. For math, plain text or LaTeX-style notation. For lists, use - bullets, one per line."
  }
The narration STILL describes / explains the card content — voice + card together.

OPTIONAL — "checkpoint" field on a reel:
For 30-50% of reels (skip easy/intro reels), include a quick 1-question check to keep the viewer engaged:
  "checkpoint": {
    "question": "Short question testing the reel's main point",
    "options": ["...", "...", "..."],     // 3 options
    "correct_index": 0,
    "explanation": "One short sentence explaining why."
  }
These appear AFTER the reel as quick interludes.

QUIZ RULES:
- Generate 4-6 multiple-choice questions covering the most important info from the document.
- Each question has exactly 4 options.
- Mix of factual recall + understanding. Keep questions punchy.
- "correct_index" is the 0-based index of the correct option.
- "explanation": one short sentence explaining WHY the correct answer is right.

OUTPUT: Return ONLY valid JSON in exactly this shape (no markdown fences, no commentary):
{
  "title": "Overall short title for the document",
  "reels": [
    {
      "title": "...",
      "narration": "...",
      "background_prompt": "...",
      "accent_color": "#RRGGBB",
      "voice": "Aoede",
      "card": null,
      "checkpoint": null
    }
  ],
  "quiz": [
    { "question": "...", "options": ["...", "...", "...", "..."], "correct_index": 0, "explanation": "..." }
  ]
}`;
}

const TEXT_LIKE_EXTENSIONS = new Set([".txt", ".md", ".csv", ".json", ".html", ".htm", ".xml", ".rtf"]);
const OFFICE_EXTENSIONS = new Set([".docx", ".pptx", ".xlsx", ".odt", ".odp", ".ods"]);
const NATIVE_GEMINI_MIME_PREFIXES = ["image/", "application/pdf"];

function isNativelySupported(mime) {
  return NATIVE_GEMINI_MIME_PREFIXES.some((p) => mime.startsWith(p));
}

async function extractContentForAI(filePath, originalName, mimeType) {
  const ext = path.extname(originalName).toLowerCase();
  const size = fs.statSync(filePath).size;
  console.log(`[upload] "${originalName}" mime=${mimeType} ext=${ext} size=${size}`);

  // Native AI File API path (PDF, images)
  if (isNativelySupported(mimeType)) {
    const uploaded = await ai.files.upload({
      file: filePath,
      config: { mimeType, displayName: originalName },
    });
    let f = uploaded;
    while (f.state === "PROCESSING") {
      await new Promise((r) => setTimeout(r, 800));
      f = await ai.files.get({ name: uploaded.name });
    }
    if (f.state === "FAILED") throw new Error("AI failed to process file");
    console.log(`[upload] using AI File API ref ${f.uri}`);
    return { kind: "fileRef", uri: f.uri, mimeType: f.mimeType };
  }

  // Office docs (DOCX/PPTX/XLSX/ODT/ODP/ODS) — extract text via officeparser
  if (OFFICE_EXTENSIONS.has(ext)) {
    let extracted = "";
    try {
      extracted = await officeParser.parseOfficeAsync(filePath, {
        outputErrorToConsole: false,
        newlineDelimiter: "\n",
        ignoreNotes: false,
      });
    } catch (e) {
      console.error(`[upload] officeparser threw on ${ext}:`, e?.message || e);
      throw new Error(
        `Couldn't read the ${ext.replace('.', '').toUpperCase()} file (${e?.message || "parse error"}). ` +
        `Try saving it as PDF and re-uploading, or paste the text directly with the Paste text button.`
      );
    }
    const trimmed = (extracted || "").trim();
    console.log(`[upload] officeparser extracted ${trimmed.length} chars`);
    if (trimmed.length < 30) {
      throw new Error(
        `The ${ext.replace('.', '').toUpperCase()} file gave us almost no readable text. ` +
        `It might be image-only (scans need OCR), password-protected, or in an old format. ` +
        `Try exporting it as PDF and uploading that instead.`
      );
    }
    return { kind: "text", text: trimmed.slice(0, 200000) };
  }

  // Plain-text-ish files
  if (TEXT_LIKE_EXTENSIONS.has(ext) || mimeType.startsWith("text/")) {
    const text = fs.readFileSync(filePath, "utf-8");
    return { kind: "text", text: text.slice(0, 200000) };
  }

  // Last-ditch: try officeparser on unknown extensions
  try {
    const text = await officeParser.parseOfficeAsync(filePath);
    if (text && text.trim().length > 30) {
      return { kind: "text", text: text.slice(0, 200000) };
    }
  } catch (e) {
    console.warn(`[upload] last-ditch officeparser also failed:`, e?.message || e);
  }

  throw new Error(`Unsupported file type: ${mimeType || ext || "unknown"}. Try a PDF or paste the text directly.`);
}

app.post("/api/upload", requireAuth, upload.single("file"), async (req, res) => {
  const filePath = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const content = await extractContentForAI(filePath, req.file.originalname, req.file.mimetype);

    const settings = {
      vibe: req.body.vibe,
      length: req.body.length,
      quizDifficulty: req.body.quizDifficulty,
      language: req.body.language,
      vibeCustom: req.body.vibeCustom,
      quizDifficultyCustom: req.body.quizDifficultyCustom,
      languageCustom: req.body.languageCustom,
      format: req.body.format,
    };

    const userParts = [{ text: buildReelPrompt(settings) }];
    if (content.kind === "fileRef") {
      userParts.push({ fileData: { fileUri: content.uri, mimeType: content.mimeType } });
    } else {
      userParts.push({ text: `\n\nFILE CONTENT:\n${content.text}` });
    }

    const result = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: [{ role: "user", parts: userParts }],
      config: {
        responseMimeType: "application/json",
        temperature: 0.8,
      },
    });

    const raw = result.text;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("The AI did not return JSON");
      parsed = JSON.parse(m[0]);
    }

    if (!parsed.reels || !Array.isArray(parsed.reels) || parsed.reels.length === 0) {
      throw new Error("The AI returned no reels");
    }
    if (!Array.isArray(parsed.quiz)) parsed.quiz = [];

    // Optional persistence: if a subjectId was provided, save as a chapter
    let chapter = null;
    const subjectId = (req.body.subjectId || "").trim();
    if (subjectId) {
      const subj = db.getSubject(subjectId);
      if (subj) {
        const chapterTitle = (req.body.chapterTitle || "").trim() || parsed.title || req.file.originalname || "Chapter";
        try {
          chapter = db.createChapter({
            subjectId,
            title: chapterTitle,
            reels: parsed.reels,
            quiz: parsed.quiz,
            settings,
            fileName: req.file.originalname,
          });
        } catch (e) {
          console.warn("Failed to save chapter:", e.message);
        }
      }
    }

    res.json({ ...parsed, chapter });
  } catch (e) {
    console.error("Upload error:", e);
    res.status(500).json({ error: e.message || "Failed to generate reels" });
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlink(filePath, () => {});
    }
  }
});

// ----- Streaming upload (Server-Sent Events) -----
// Walks the AI's streaming JSON output, extracts complete reel objects from
// the partial response as soon as their closing `}` arrives, and emits each
// over SSE. The client renders reels as they appear instead of waiting for
// the whole response. Final quiz + chapter persistence happens at the end.
function findReelsArrayStart(buffer) {
  const m = buffer.match(/"reels"\s*:\s*\[/);
  return m ? m.index + m[0].length : -1;
}
function extractCompleteReels(buffer, fromIdx) {
  let i = fromIdx, depth = 0, inString = false, escape = false, reelStart = -1;
  let advancedTo = fromIdx;
  const reels = [];
  while (i < buffer.length) {
    const c = buffer[i];
    if (escape) { escape = false; i++; continue; }
    if (inString) {
      if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      i++; continue;
    }
    if (c === '"') { inString = true; i++; continue; }
    if (c === "{") {
      if (depth === 0) reelStart = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && reelStart >= 0) {
        try {
          reels.push(JSON.parse(buffer.substring(reelStart, i + 1)));
          advancedTo = i + 1;
        } catch { break; }
        reelStart = -1;
      }
    } else if (c === "]" && depth === 0) {
      advancedTo = i + 1;
      break;
    }
    i++;
  }
  return { reels, advancedTo };
}

app.post("/api/upload-stream", requireAuth, upload.single("file"), async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable proxy buffering
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const send = (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (typeof res.flush === "function") res.flush();
    } catch {}
  };

  const filePath = req.file?.path;
  let final = null;
  let emitted = 0;

  try {
    if (!req.file) { send("error", { error: "No file uploaded" }); return res.end(); }

    const settings = {
      vibe: req.body.vibe,
      length: req.body.length,
      quizDifficulty: req.body.quizDifficulty,
      language: req.body.language,
      vibeCustom: req.body.vibeCustom,
      quizDifficultyCustom: req.body.quizDifficultyCustom,
      languageCustom: req.body.languageCustom,
      format: req.body.format,
    };

    const content = await extractContentForAI(filePath, req.file.originalname, req.file.mimetype);
    const userParts = [{ text: buildReelPrompt(settings) }];
    if (content.kind === "fileRef") {
      userParts.push({ fileData: { fileUri: content.uri, mimeType: content.mimeType } });
    } else {
      userParts.push({ text: `\n\nFILE CONTENT:\n${content.text}` });
    }

    send("start", { ts: Date.now() });
    // Heartbeat so phone WebView keeps the connection alive while the AI thinks
    const heartbeat = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 15000);

    const stream = await ai.models.generateContentStream({
      model: TEXT_MODEL,
      contents: [{ role: "user", parts: userParts }],
      config: { responseMimeType: "application/json", temperature: 0.8 },
    });

    let buffer = "";
    let arrayStart = -1;
    let cursor = -1;

    for await (const chunk of stream) {
      buffer += chunk?.text || "";
      if (arrayStart < 0) {
        arrayStart = findReelsArrayStart(buffer);
        if (arrayStart < 0) continue;
        cursor = arrayStart;
      }
      const { reels, advancedTo } = extractCompleteReels(buffer, cursor);
      cursor = advancedTo;
      for (const reel of reels) {
        send("reel", { reel });
        emitted++;
      }
    }

    clearInterval(heartbeat);

    // Parse the full response for quiz + title (and any reels we might have missed)
    try { final = JSON.parse(buffer); }
    catch {
      const m = buffer.match(/\{[\s\S]*\}/);
      if (m) try { final = JSON.parse(m[0]); } catch {}
    }
    if (final && Array.isArray(final.reels)) {
      for (let i = emitted; i < final.reels.length; i++) {
        send("reel", { reel: final.reels[i] });
        emitted++;
      }
    }
    if (final?.quiz?.length) send("quiz", { quiz: final.quiz });
    if (final?.title) send("title", { title: final.title });

    // Persist as chapter if subject was selected
    const subjectId = (req.body.subjectId || "").trim();
    if (subjectId && final?.reels?.length) {
      const subj = db.getSubject(subjectId);
      if (subj && subj.userId === req.user.id) {
        try {
          const chapterTitle = (req.body.chapterTitle || "").trim() || final.title || req.file.originalname;
          const chapter = db.createChapter({
            subjectId,
            title: chapterTitle,
            reels: final.reels,
            quiz: final.quiz || [],
            settings,
            fileName: req.file.originalname,
          });
          send("chapter", { chapter });
        } catch (e) {
          console.warn("[stream] failed to save chapter:", e.message);
        }
      }
    }

    send("done", { reelCount: emitted });
    res.end();
  } catch (e) {
    console.error("upload-stream error:", e);
    send("error", { error: e.message || "Stream failed" });
    res.end();
  } finally {
    if (filePath && fs.existsSync(filePath)) fs.unlink(filePath, () => {});
  }
});

app.post("/api/image", requireAuth, async (req, res) => {
  try {
    const { prompt, imageStyle, imageStyleCustom } = req.body;
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });

    const customClean = sanitizeCustom(imageStyleCustom, 200);
    const styleInstr = (imageStyle === "custom" && customClean)
      ? `Render in this style: ${customClean}. Stay faithful to the style across all details — color palette, brushwork, composition feel.`
      : (IMAGE_STYLE_INSTR[imageStyle] || "");

    const fullPrompt = `${prompt}

${styleInstr}

STRICT COMPOSITION RULES:
- The MAIN SUBJECT must be DEAD CENTER of the frame, large and clearly visible — magazine cover style.
- Tight framing on the subject. Clean, simple, uncluttered background.
- The subject should be obviously identifiable so the viewer learns what the topic is just from looking.
- Vertical 9:16 portrait orientation.
- Beautiful, polished, premium aesthetic — vivid saturated colors, dramatic but flattering lighting, sharp focus on the subject, soft fall-off in the background.
- ABSOLUTELY no text, letters, numbers, captions, watermarks, or logos in the image.
- No collages, no split-screens, no multi-panel layouts.`;

    let result;
    try {
      result = await ai.models.generateContent({
        model: IMAGE_MODEL,
        contents: fullPrompt,
        config: {
          imageConfig: { aspectRatio: "9:16" },
        },
      });
    } catch (e) {
      // Fallback: some SDK versions don't accept imageConfig — retry without it
      if (/imageConfig|aspectRatio|Unknown/i.test(String(e))) {
        result = await ai.models.generateContent({
          model: IMAGE_MODEL,
          contents: fullPrompt,
        });
      } else {
        throw e;
      }
    }

    let imageBase64 = null;
    const parts = result?.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        imageBase64 = part.inlineData.data;
        break;
      }
    }

    if (!imageBase64) {
      return res.status(500).json({ error: "No image data returned by model" });
    }

    const filename = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
    const filepath = path.join(imagesDir, filename);
    fs.writeFileSync(filepath, Buffer.from(imageBase64, "base64"));

    res.json({ url: `/images/${filename}` });
  } catch (e) {
    console.error("Image error:", e);
    res.status(500).json({ error: e.message || "Image generation failed" });
  }
});

function pcmToWav(pcmBuf, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const dataSize = pcmBuf.length;
  const header = Buffer.alloc(44);
  let o = 0;
  header.write("RIFF", o); o += 4;
  header.writeUInt32LE(36 + dataSize, o); o += 4;
  header.write("WAVE", o); o += 4;
  header.write("fmt ", o); o += 4;
  header.writeUInt32LE(16, o); o += 4;
  header.writeUInt16LE(1, o); o += 2;
  header.writeUInt16LE(channels, o); o += 2;
  header.writeUInt32LE(sampleRate, o); o += 4;
  header.writeUInt32LE((sampleRate * channels * bitsPerSample) / 8, o); o += 4;
  header.writeUInt16LE((channels * bitsPerSample) / 8, o); o += 2;
  header.writeUInt16LE(bitsPerSample, o); o += 2;
  header.write("data", o); o += 4;
  header.writeUInt32LE(dataSize, o); o += 4;
  return Buffer.concat([header, pcmBuf]);
}

const ALLOWED_VOICES = new Set(["Aoede", "Puck", "Charon", "Kore", "Leda", "Fenrir", "Orus", "Zephyr"]);

// Generate TTS for one text + voice. Returns { pcm, sampleRate }.
async function ttsOneSegment(text, voice) {
  const styled = `Read the following aloud in an engaging, upbeat narrator voice. Do not add anything else.\n\n${text}`;
  const result = await ai.models.generateContent({
    model: TTS_MODEL,
    contents: [{ parts: [{ text: styled }] }],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
      },
    },
  });
  const audioPart = result?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!audioPart) throw new Error("No audio data in TTS response");
  const pcm = Buffer.from(audioPart.inlineData.data, "base64");
  const mime = audioPart.inlineData.mimeType || "audio/L16;rate=24000";
  const rateMatch = mime.match(/rate=(\d+)/i);
  return { pcm, sampleRate: rateMatch ? parseInt(rateMatch[1], 10) : 24000 };
}

// Parse a podcast script split into [A]: / [B]: turns.
// Returns array of { speaker: "A"|"B", text: "..." }.
function parsePodcastTurns(text) {
  const re = /\[([AB])\]\s*:?\s*([\s\S]*?)(?=(?:\[[AB]\]\s*:?)|$)/g;
  const turns = [];
  let m;
  while ((m = re.exec(text))) {
    const t = m[2].trim();
    if (t) turns.push({ speaker: m[1], text: t });
  }
  return turns;
}

app.post("/api/tts", requireAuth, async (req, res) => {
  try {
    const { text, format } = req.body;
    let voice = req.body.voice || TTS_VOICE;
    let voiceB = req.body.voiceB || "Charon";
    if (!ALLOWED_VOICES.has(voice)) voice = TTS_VOICE;
    if (!ALLOWED_VOICES.has(voiceB)) voiceB = "Charon";
    if (!text) return res.status(400).json({ error: "Missing text" });

    const isPodcast = format === "podcast";
    const cacheKey = `${text}|${voice}|${isPodcast ? `pod|${voiceB}` : "solo"}`;
    const hash = crypto.createHash("md5").update(cacheKey).digest("hex").slice(0, 16);
    const filename = `tts_${hash}.wav`;
    const filepath = path.join(audioDir, filename);

    if (fs.existsSync(filepath)) {
      return res.json({ url: `/audio/${filename}`, cached: true });
    }

    let pcmBuffer;
    let sampleRate = 24000;

    if (isPodcast) {
      // Try to parse turns. If the model didn't tag, fall back to alternating split by sentence.
      let turns = parsePodcastTurns(text);
      if (turns.length < 2) {
        const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
        turns = sentences.map((s, i) => ({ speaker: i % 2 === 0 ? "A" : "B", text: s.trim() }));
      }
      const pcmParts = [];
      for (const turn of turns) {
        const v = turn.speaker === "A" ? voice : voiceB;
        const { pcm, sampleRate: sr } = await ttsOneSegment(turn.text, v);
        sampleRate = sr;
        pcmParts.push(pcm);
        // 180ms silence between turns so the dialogue feels conversational
        const silenceBytes = Math.floor(sampleRate * 0.18) * 2;
        pcmParts.push(Buffer.alloc(silenceBytes));
      }
      pcmBuffer = Buffer.concat(pcmParts);
    } else {
      const seg = await ttsOneSegment(text, voice);
      pcmBuffer = seg.pcm;
      sampleRate = seg.sampleRate;
    }

    const wavBuffer = pcmToWav(pcmBuffer, sampleRate);
    fs.writeFileSync(filepath, wavBuffer);

    res.json({ url: `/audio/${filename}`, cached: false });
  } catch (e) {
    console.error("TTS error:", e);
    res.status(500).json({ error: e.message || "TTS failed" });
  }
});

app.post("/api/ask", requireAuth, async (req, res) => {
  try {
    const { question, context, language } = req.body || {};
    if (!question) return res.status(400).json({ error: "Missing question" });

    const langInstr = LANGUAGE_INSTR[language] ? `Respond in the same language as the context. ${LANGUAGE_INSTR[language]}` : "";

    const prompt = `You are a friendly, sharp AI tutor. The user is watching a learning reel. Answer their follow-up question concisely (60-100 words), conversationally, in plain prose. No markdown, no bullet points, no headings — this will be read aloud and shown as a caption.

${langInstr}

REEL CONTEXT (what the user just watched):
"""
${(context || "").slice(0, 4000)}
"""

USER QUESTION:
${String(question).slice(0, 800)}

Your answer:`;

    const result = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      config: { temperature: 0.7 },
    });

    res.json({ answer: result.text || "" });
  } catch (e) {
    console.error("Ask error:", e);
    res.status(500).json({ error: e.message || "Ask failed" });
  }
});

// ----- Auth helpers -----
// (authMiddleware itself is registered globally up near express.json — see top
// of file. It must run BEFORE any route that uses requireAuth.)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { email, password, displayName } = req.body || {};
    if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: "Invalid email" });
    if (!password || password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    if (db.getUserByEmail(email)) return res.status(409).json({ error: "An account already exists for that email" });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = db.createUser({ email, passwordHash, displayName });
    // First user on a fresh deploy claims any orphan subjects (single-user convenience)
    const claimed = db.claimOrphanSubjectsFor(user.id);
    if (claimed) console.log(`[auth] claimed ${claimed} orphan subjects for new user ${user.email}`);
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { id: user.id, email: user.email, displayName: user.displayName } });
  } catch (e) {
    console.error("signup error:", e);
    res.status(500).json({ error: "Signup failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const user = db.getUserByEmail(email);
    if (!user) return res.status(401).json({ error: "Wrong email or password" });
    const ok = await bcrypt.compare(password || "", user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Wrong email or password" });
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { id: user.id, email: user.email, displayName: user.displayName } });
  } catch (e) {
    console.error("login error:", e);
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  const user = db.getUser(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: { id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl || "" } });
});

// Update profile (display name only here; avatar uploaded separately)
app.patch("/api/auth/profile", requireAuth, (req, res) => {
  const { displayName } = req.body || {};
  if (displayName !== undefined && (typeof displayName !== "string" || displayName.length > 80)) {
    return res.status(400).json({ error: "Display name must be a string under 80 chars" });
  }
  const user = db.updateUserProfile(req.user.id, { displayName });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: { id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl || "" } });
});

// Upload avatar — accepts an image, saves to /generated-images/, stores URL on user
const avatarsDir = path.join(__dirname, "generated-images"); // reuse existing static-served dir
app.post("/api/auth/avatar", requireAuth, upload.single("avatar"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Missing avatar file" });
    if (!req.file.mimetype || !req.file.mimetype.startsWith("image/")) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "File must be an image" });
    }
    if (req.file.size > 5 * 1024 * 1024) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "Avatar must be under 5 MB" });
    }
    const ext = (req.file.mimetype.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "png";
    const filename = `avatar_${req.user.id}_${Date.now()}.${ext}`;
    const filepath = path.join(avatarsDir, filename);
    fs.renameSync(req.file.path, filepath);
    const url = `/images/${filename}`;
    const user = db.updateUserProfile(req.user.id, { avatarUrl: url });
    res.json({ user: { id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl } });
  } catch (e) {
    console.error("avatar upload error:", e);
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: "Avatar upload failed" });
  }
});

// ----- Subjects (scoped to user) -----
app.get("/api/subjects", requireAuth, (req, res) => {
  res.json({ subjects: db.listSubjects(req.user.id) });
});

app.post("/api/subjects", requireAuth, (req, res) => {
  const { title, description, color, emoji } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: "Missing title" });
  const subject = db.createSubject({ title, description, color, emoji, userId: req.user.id });
  res.json({ subject });
});

app.patch("/api/subjects/:id", requireAuth, (req, res) => {
  const cur = db.getSubject(req.params.id);
  if (!cur || cur.userId !== req.user.id) return res.status(404).json({ error: "Subject not found" });
  const subject = db.updateSubject(req.params.id, req.body || {});
  res.json({ subject });
});

app.delete("/api/subjects/:id", requireAuth, (req, res) => {
  const cur = db.getSubject(req.params.id);
  if (!cur || cur.userId !== req.user.id) return res.status(404).json({ error: "Subject not found" });
  db.deleteSubject(req.params.id);
  res.json({ ok: true });
});

// ----- Chapters -----
app.get("/api/subjects/:id/chapters", requireAuth, (req, res) => {
  const subj = db.getSubject(req.params.id);
  if (!subj || subj.userId !== req.user.id) return res.status(404).json({ error: "Subject not found" });
  res.json({ chapters: db.listChapters(req.params.id) });
});

app.get("/api/chapters/:id", requireAuth, (req, res) => {
  const chapter = db.getChapter(req.params.id);
  if (!chapter) return res.status(404).json({ error: "Chapter not found" });
  const subj = db.getSubject(chapter.subjectId);
  if (!subj || subj.userId !== req.user.id) return res.status(404).json({ error: "Chapter not found" });
  res.json({ chapter });
});

app.delete("/api/chapters/:id", requireAuth, (req, res) => {
  const chapter = db.getChapter(req.params.id);
  if (!chapter) return res.json({ ok: true });
  const subj = db.getSubject(chapter.subjectId);
  if (!subj || subj.userId !== req.user.id) return res.status(404).json({ error: "Chapter not found" });
  db.deleteChapter(req.params.id);
  res.json({ ok: true });
});

app.post("/api/chapters/:id/asset", requireAuth, (req, res) => {
  const { kind, reelIdx, url } = req.body || {};
  if (!kind || reelIdx === undefined || !url) return res.status(400).json({ error: "Missing fields" });
  const chapter = db.getChapter(req.params.id);
  if (!chapter) return res.status(404).json({ error: "Chapter not found" });
  const subj = db.getSubject(chapter.subjectId);
  if (!subj || subj.userId !== req.user.id) return res.status(404).json({ error: "Chapter not found" });
  const map = db.setChapterAsset(req.params.id, kind, reelIdx, url);
  if (!map) return res.status(404).json({ error: "Chapter not found" });
  res.json({ ok: true });
});

// ----- Saved reels (server-persistent) -----
app.get("/api/saved", requireAuth, (req, res) => {
  res.json({ saved: db.listSavedReels(req.user.id) });
});

app.post("/api/saved", requireAuth, (req, res) => {
  const { title, narration, backgroundPrompt, voice, accentColor, imageUrl, audioUrl, card } = req.body || {};
  if (!title || !narration) return res.status(400).json({ error: "title + narration required" });
  // Dedupe: if the same reel (title+narration) already saved, return existing.
  const existing = db.findSavedReel(req.user.id, title, narration);
  if (existing) return res.json({ saved: existing, dedup: true });
  const saved = db.createSavedReel({
    userId: req.user.id,
    title, narration, backgroundPrompt, voice, accentColor, imageUrl, audioUrl, card,
  });
  res.json({ saved });
});

app.delete("/api/saved/:id", requireAuth, (req, res) => {
  db.deleteSavedReel(req.params.id, req.user.id);
  res.json({ ok: true });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nReel app running at http://localhost:${PORT}\n`);
});
