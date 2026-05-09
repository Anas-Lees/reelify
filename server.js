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
import JSZip from "jszip";
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

// Preserve the original extension on disk — officeparser's content-sniffing
// is solid, but on some environments newer versions fall back to extension
// checks for PPTX/DOCX/XLSX. Keeping the extension avoids false negatives.
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => {
      const orig = file.originalname || "";
      const ext = path.extname(orig).toLowerCase();
      const stem = crypto.randomBytes(8).toString("hex");
      cb(null, `${Date.now()}_${stem}${ext}`);
    },
  }),
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

// Last-ditch text extractor for OOXML (.docx / .pptx / .xlsx). Walks the ZIP
// archive ourselves and pulls all <w:t> / <a:t> / <t> text runs from the
// relevant XML files. Used when officeparser fails or returns empty.
async function rawXmlTextExtract(filePath, ext) {
  const buf = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buf);
  const targets = [];
  if (ext === ".docx") {
    targets.push("word/document.xml");
    // Headers/footers + endnotes are often informative too
    Object.keys(zip.files).forEach((k) => {
      if (/^word\/(header|footer|footnotes|endnotes)\d*\.xml$/.test(k)) targets.push(k);
    });
  } else if (ext === ".pptx") {
    Object.keys(zip.files).forEach((k) => {
      if (/^ppt\/slides\/slide\d+\.xml$/.test(k)) targets.push(k);
      if (/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(k)) targets.push(k);
    });
    // Sort slides numerically
    targets.sort((a, b) => {
      const na = parseInt((a.match(/(\d+)\.xml$/) || [])[1] || "0", 10);
      const nb = parseInt((b.match(/(\d+)\.xml$/) || [])[1] || "0", 10);
      return na - nb;
    });
  } else if (ext === ".xlsx") {
    targets.push("xl/sharedStrings.xml");
    Object.keys(zip.files).forEach((k) => {
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(k)) targets.push(k);
    });
  } else {
    return "";
  }

  const chunks = [];
  for (const name of targets) {
    const file = zip.file(name);
    if (!file) continue;
    const xml = await file.async("string");
    // Pull text runs: <w:t ...>X</w:t> (DOCX), <a:t ...>X</a:t> (PPTX),
    // <t ...>X</t> (XLSX shared strings). Plain text inside the tags only.
    const runRe = /<(?:w:t|a:t|t)\b[^>]*>([\s\S]*?)<\/(?:w:t|a:t|t)>/g;
    let m;
    let block = [];
    while ((m = runRe.exec(xml))) {
      const text = m[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
      if (text) block.push(text);
    }
    if (block.length) {
      chunks.push(block.join(" "));
      // Slide breaks for PPTX so the AI can see the structure
      if (ext === ".pptx") chunks.push("");
    }
  }
  return chunks.join("\n").trim();
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

  // Office docs (DOCX/PPTX/XLSX/ODT/ODP/ODS).
  if (OFFICE_EXTENSIONS.has(ext)) {
    // OOXML files are just ZIP archives — read them ourselves via JSZip
    // FIRST. This avoids officeparser's dependency on file extensions and
    // the various edge cases it has with image-heavy decks etc. We only fall
    // back to officeparser for the formats JSZip doesn't natively handle (.odt,
    // .odp, .ods).
    if (ext === ".docx" || ext === ".pptx" || ext === ".xlsx") {
      try {
        const raw = await rawXmlTextExtract(filePath, ext);
        const trimmed = (raw || "").trim();
        console.log(`[upload] OOXML JSZip extractor produced ${trimmed.length} chars`);
        if (trimmed.length >= 30) {
          return { kind: "text", text: trimmed.slice(0, 200000) };
        }
        // Fall through to officeparser — maybe text is in places we didn't scan
        console.log(`[upload] JSZip extraction was empty, trying officeparser as backup`);
      } catch (e) {
        console.warn(`[upload] JSZip extraction failed: ${e.message}`);
      }
    }

    // Officeparser path — needs a file with the proper extension on disk.
    let workingPath = filePath;
    if (!workingPath.toLowerCase().endsWith(ext)) {
      const newPath = workingPath + ext;
      try {
        fs.renameSync(workingPath, newPath);
        workingPath = newPath;
        console.log(`[upload] renamed temp file with proper ext → ${path.basename(newPath)}`);
      } catch (e) {
        // Try copyFile as fallback if rename fails (cross-device etc.)
        try {
          fs.copyFileSync(workingPath, newPath);
          workingPath = newPath;
          console.log(`[upload] copied temp file with proper ext → ${path.basename(newPath)}`);
        } catch (e2) {
          console.warn(`[upload] couldn't rename or copy temp file with ext: ${e2.message}`);
        }
      }
    }

    let extracted = "";
    let parseError = null;
    try {
      extracted = await officeParser.parseOfficeAsync(workingPath, {
        outputErrorToConsole: false,
        newlineDelimiter: "\n",
        ignoreNotes: false,
      });
    } catch (e) {
      parseError = e;
      console.error(`[upload] officeparser threw on ${ext}:`, e?.message || e);
    }

    if (parseError) {
      throw new Error(
        `Couldn't read the ${ext.replace('.', '').toUpperCase()} file (${parseError?.message || "parse error"}). ` +
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
      const subj = await db.getSubject(subjectId);
      if (subj) {
        const chapterTitle = (req.body.chapterTitle || "").trim() || parsed.title || req.file.originalname || "Chapter";
        try {
          chapter = await db.createChapter({
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
      const subj = await db.getSubject(subjectId);
      if (subj && subj.userId === req.user.id) {
        try {
          const chapterTitle = (req.body.chapterTitle || "").trim() || final.title || req.file.originalname;
          const chapter = await db.createChapter({
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
    const buf = Buffer.from(imageBase64, "base64");
    fs.writeFileSync(filepath, buf);

    // Cheap PNG dimension probe — width is bytes 16-19, height bytes 20-23
    // of an 8-byte PNG signature + IHDR chunk. Only logs once per request.
    let dims = "unknown";
    try {
      if (buf.length > 24 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
        const w = buf.readUInt32BE(16);
        const h = buf.readUInt32BE(20);
        const ratio = (w / h).toFixed(3);
        dims = `${w}x${h} (ratio ${ratio}, target 0.5625)`;
        if (Math.abs(w / h - 9 / 16) > 0.05) {
          console.warn(`[image] WARNING — non-phone-ratio image returned: ${dims}`);
        } else {
          console.log(`[image] ${dims}`);
        }
      }
    } catch (_) { /* ignore */ }

    res.json({ url: `/images/${filename}`, dims });
  } catch (e) {
    console.error("Image error:", e?.message || e);
    const msg = String(e?.message || "");
    if (/429|quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(msg)) {
      return res.status(503).json({ error: "Image quota exceeded — try again in a minute", quota: true });
    }
    res.status(500).json({ error: "Image generation failed" });
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

// Generate TTS for one text + voice via Gemini. Returns { pcm, sampleRate }.
async function ttsGemini(text, voice) {
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

// Google Cloud Text-to-Speech as the FIRST fallback. Same Google billing
// account as the user's Gemini key, but a separate API with proper paid
// rate limits (1M chars/month free Standard, 1M Wavenet, 1M Neural2).
// Set GOOGLE_CLOUD_API_KEY in Render env (the AI Studio key may also work
// if Cloud TTS API is enabled on the same project + the key isn't
// restricted). Returns { pcm, sampleRate } so the caller wraps with WAV.
const GCP_VOICE_MAP = {
  Aoede:  "en-US-Neural2-F", // warm female
  Puck:   "en-US-Neural2-J", // playful male
  Charon: "en-US-Neural2-D", // deep male
  Kore:   "en-US-Neural2-A", // neutral female
  Leda:   "en-US-Neural2-G", // bright female
  Fenrir: "en-US-Neural2-I", // clear male
  Orus:   "en-US-Neural2-D", // deep male
  Zephyr: "en-US-Neural2-C", // neutral female
};
async function ttsGoogleCloud(text, voice) {
  const apiKey = process.env.GOOGLE_CLOUD_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const e = new Error("GOOGLE_CLOUD_API_KEY not set");
    e.code = "no-gcp-key"; throw e;
  }
  const gcpVoice = GCP_VOICE_MAP[voice] || "en-US-Neural2-F";
  const r = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text: text.slice(0, 5000) }, // Cloud TTS hard cap is 5000 bytes
        voice: { languageCode: "en-US", name: gcpVoice },
        audioConfig: {
          audioEncoding: "LINEAR16",
          sampleRateHertz: 24000,
          speakingRate: 1.0,
          pitch: 0.0,
        },
      }),
    }
  );
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    const err = new Error(`Google Cloud TTS HTTP ${r.status}: ${body.slice(0, 200)}`);
    err.status = r.status; throw err;
  }
  const data = await r.json();
  if (!data.audioContent) throw new Error("Google Cloud TTS returned no audioContent");
  return { pcm: Buffer.from(data.audioContent, "base64"), sampleRate: 24000 };
}

// OpenAI TTS as the SECOND fallback when both Gemini and Google Cloud TTS
// are unavailable. Set OPENAI_API_KEY in Render env vars to enable.
// Returns a fully-formed WAV Buffer (not raw PCM) — OpenAI returns a
// complete audio container.
const OPENAI_VOICE_MAP = {
  Aoede:  "nova",
  Puck:   "fable",
  Charon: "onyx",
  Kore:   "alloy",
  Leda:   "shimmer",
  Fenrir: "echo",
  Orus:   "onyx",
  Zephyr: "alloy",
};
async function ttsOpenAI(text, voice) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const e = new Error("OPENAI_API_KEY not set");
    e.code = "no-openai-key"; throw e;
  }
  const oaiVoice = OPENAI_VOICE_MAP[voice] || "nova";
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "tts-1",
      voice: oaiVoice,
      input: text.slice(0, 4096),
      response_format: "wav",
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`OpenAI TTS HTTP ${r.status}: ${body.slice(0, 200)}`);
  }
  const buf = Buffer.from(await r.arrayBuffer());
  return { wav: buf };
}

// Solo-mode TTS chain. Try in priority order:
//   1. Gemini 2.5 Flash TTS (free quota, preview model)
//   2. Google Cloud TTS (same Google billing, 1M chars/mo free)
//   3. OpenAI tts-1 (paid, generous limits)
// Each provider's quota error advances to the next; any non-quota error
// from the chosen provider propagates so legitimate failures aren't
// swallowed. Returns either { pcm, sampleRate } (Gemini/GCP) or { wav }
// (OpenAI). Caller wraps PCM with a WAV header.
const _ttsProviderSkipUntil = { gemini: 0, gcp: 0 }; // ms timestamps
function _isQuotaErr(msg) {
  return /429|quota|rate.?limit|RESOURCE_EXHAUSTED|TooManyRequests|exceed/i.test(String(msg));
}
async function ttsOneSegment(text, voice) {
  const now = Date.now();
  // 1. Gemini
  if (now >= _ttsProviderSkipUntil.gemini) {
    try {
      return await ttsGemini(text, voice);
    } catch (e) {
      const msg = String(e?.message || e);
      if (_isQuotaErr(msg)) {
        _ttsProviderSkipUntil.gemini = now + 60_000; // 60s cooldown
        console.log("[tts] Gemini quota — trying Google Cloud TTS");
      } else if (e.code !== "no-gcp-key" && e.code !== "no-openai-key") {
        // Non-quota Gemini failure — try the next provider just in case.
        console.warn("[tts] Gemini failed (" + msg.slice(0, 100) + "), trying GCP");
      }
    }
  }
  // 2. Google Cloud TTS
  if (now >= _ttsProviderSkipUntil.gcp) {
    try {
      return await ttsGoogleCloud(text, voice);
    } catch (e) {
      const msg = String(e?.message || e);
      if (e.code === "no-gcp-key") {
        // not configured — silently move on
      } else if (_isQuotaErr(msg)) {
        _ttsProviderSkipUntil.gcp = now + 60_000;
        console.log("[tts] Google Cloud TTS quota — trying OpenAI");
      } else {
        // GCP returned an error but isn't a quota issue (probably the
        // API isn't enabled on the project, or the key is restricted).
        // Mark cool-down so we don't keep paying the round-trip and try OpenAI.
        _ttsProviderSkipUntil.gcp = now + 5 * 60_000;
        console.warn("[tts] Google Cloud TTS failed (" + msg.slice(0, 120) + "), trying OpenAI");
      }
    }
  }
  // 3. OpenAI
  return await ttsOpenAI(text, voice);
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

    let wavBuffer;

    if (isPodcast) {
      // Try to parse turns. If the model didn't tag, fall back to alternating split by sentence.
      let turns = parsePodcastTurns(text);
      if (turns.length < 2) {
        const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
        turns = sentences.map((s, i) => ({ speaker: i % 2 === 0 ? "A" : "B", text: s.trim() }));
      }
      // Podcast mode requires raw PCM splicing (so we can insert silence
      // between turns), so the OpenAI fallback path can't serve podcast
      // mode. We always use Gemini directly here. If Gemini quota is
      // exhausted, the caller gets a 503 and falls back to device voice.
      const pcmParts = [];
      let sampleRate = 24000;
      for (const turn of turns) {
        const v = turn.speaker === "A" ? voice : voiceB;
        const { pcm, sampleRate: sr } = await ttsGemini(turn.text, v);
        sampleRate = sr;
        pcmParts.push(pcm);
        const silenceBytes = Math.floor(sampleRate * 0.18) * 2;
        pcmParts.push(Buffer.alloc(silenceBytes));
      }
      wavBuffer = pcmToWav(Buffer.concat(pcmParts), sampleRate);
    } else {
      // Solo mode supports the full Gemini -> OpenAI fallback chain.
      const seg = await ttsOneSegment(text, voice);
      if (seg.wav) {
        // OpenAI path — already a complete WAV file
        wavBuffer = seg.wav;
      } else {
        // Gemini path — wrap PCM with a WAV header
        wavBuffer = pcmToWav(seg.pcm, seg.sampleRate);
      }
    }

    fs.writeFileSync(filepath, wavBuffer);

    res.json({ url: `/audio/${filename}`, cached: false });
  } catch (e) {
    console.error("TTS error:", e?.message || e);
    const msg = String(e?.message || "");
    if (/429|quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(msg)) {
      return res.status(503).json({ error: "Voice quota exceeded", quota: true });
    }
    res.status(500).json({ error: "Voice generation failed" });
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
    console.error("Ask error:", e?.message || e);
    const msg = String(e?.message || "");
    if (/429|quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(msg)) {
      return res.status(503).json({ error: "AI quota exceeded — try again in a minute", quota: true });
    }
    res.status(500).json({ error: "Couldn't answer right now" });
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
    if (await db.getUserByEmail(email)) return res.status(409).json({ error: "An account already exists for that email" });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await db.createUser({ email, passwordHash, displayName });
    // First user on a fresh deploy claims any orphan subjects (single-user convenience)
    const claimed = await db.claimOrphanSubjectsFor(user.id);
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
    const user = await db.getUserByEmail(email);
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

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const user = await db.getUser(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: { id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl || "" } });
});

// Update profile (display name only here; avatar uploaded separately)
app.patch("/api/auth/profile", requireAuth, async (req, res) => {
  const { displayName } = req.body || {};
  if (displayName !== undefined && (typeof displayName !== "string" || displayName.length > 80)) {
    return res.status(400).json({ error: "Display name must be a string under 80 chars" });
  }
  const user = await db.updateUserProfile(req.user.id, { displayName });
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
    const user = await db.updateUserProfile(req.user.id, { avatarUrl: url });
    res.json({ user: { id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl } });
  } catch (e) {
    console.error("avatar upload error:", e);
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: "Avatar upload failed" });
  }
});

// ----- Subjects (scoped to user) -----
app.get("/api/subjects", requireAuth, async (req, res) => {
  res.json({ subjects: await db.listSubjects(req.user.id) });
});

app.post("/api/subjects", requireAuth, async (req, res) => {
  const { title, description, color, emoji } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: "Missing title" });
  const subject = await db.createSubject({ title, description, color, emoji, userId: req.user.id });
  res.json({ subject });
});

app.patch("/api/subjects/:id", requireAuth, async (req, res) => {
  const cur = await db.getSubject(req.params.id);
  if (!cur || cur.userId !== req.user.id) return res.status(404).json({ error: "Subject not found" });
  const subject = await db.updateSubject(req.params.id, req.body || {});
  res.json({ subject });
});

app.delete("/api/subjects/:id", requireAuth, async (req, res) => {
  const cur = await db.getSubject(req.params.id);
  if (!cur || cur.userId !== req.user.id) return res.status(404).json({ error: "Subject not found" });
  await db.deleteSubject(req.params.id);
  res.json({ ok: true });
});

// ----- Chapters -----
app.get("/api/subjects/:id/chapters", requireAuth, async (req, res) => {
  const subj = await db.getSubject(req.params.id);
  if (!subj || subj.userId !== req.user.id) return res.status(404).json({ error: "Subject not found" });
  res.json({ chapters: await db.listChapters(req.params.id) });
});

app.get("/api/chapters/:id", requireAuth, async (req, res) => {
  const chapter = await db.getChapter(req.params.id);
  if (!chapter) return res.status(404).json({ error: "Chapter not found" });
  const subj = await db.getSubject(chapter.subjectId);
  if (!subj || subj.userId !== req.user.id) return res.status(404).json({ error: "Chapter not found" });
  res.json({ chapter });
});

app.delete("/api/chapters/:id", requireAuth, async (req, res) => {
  const chapter = await db.getChapter(req.params.id);
  if (!chapter) return res.json({ ok: true });
  const subj = await db.getSubject(chapter.subjectId);
  if (!subj || subj.userId !== req.user.id) return res.status(404).json({ error: "Chapter not found" });
  await db.deleteChapter(req.params.id);
  res.json({ ok: true });
});

app.post("/api/chapters/:id/asset", requireAuth, async (req, res) => {
  const { kind, reelIdx, url } = req.body || {};
  if (!kind || reelIdx === undefined || !url) return res.status(400).json({ error: "Missing fields" });
  const chapter = await db.getChapter(req.params.id);
  if (!chapter) return res.status(404).json({ error: "Chapter not found" });
  const subj = await db.getSubject(chapter.subjectId);
  if (!subj || subj.userId !== req.user.id) return res.status(404).json({ error: "Chapter not found" });
  // Read the bytes off disk (if the URL points at a local generated file)
  // so the chapter survives a Render redeploy that wipes /images and /audio.
  const asset = loadLocalAsset(url, kind);
  const map = await db.setChapterAsset(
    req.params.id, kind, reelIdx, url,
    asset?.data || null, asset?.mime || ""
  );
  if (!map) return res.status(404).json({ error: "Chapter not found" });
  res.json({ ok: true, persisted: !!asset });
});

// Stable, DB-backed serve endpoint for chapter assets. Public by chapter
// UUID — same threat model as /api/saved/:id/{image,audio}.
app.get("/api/chapters/:id/asset/:kind/:idx", async (req, res) => {
  const { id, kind, idx } = req.params;
  if (kind !== "image" && kind !== "audio") return res.status(400).json({ error: "bad kind" });
  const a = await db.getChapterAsset(id, kind, idx);
  if (!a) return res.status(404).json({ error: "no asset" });
  res.set("Content-Type", a.mime);
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.send(a.data);
});

// ----- Saved reels (server-persistent) -----
app.get("/api/saved", requireAuth, async (req, res) => {
  res.json({ saved: await db.listSavedReels(req.user.id) });
});

// Helper: turn a local /images/X or /audio/X URL into the bytes on disk.
// Returns { data: Buffer, mime } or null. Anything that points outside the
// generated dirs is ignored — we never want to read arbitrary paths.
function loadLocalAsset(url, kind) {
  if (!url || typeof url !== "string") return null;
  const prefix = kind === "audio" ? "/audio/" : "/images/";
  if (!url.startsWith(prefix)) return null;
  const filename = url.slice(prefix.length);
  // strip any query / fragment
  const clean = filename.split(/[?#]/)[0];
  // basic safety: no traversal, must be a simple filename
  if (!clean || clean.includes("/") || clean.includes("\\") || clean.includes("..")) return null;
  const dir = kind === "audio" ? audioDir : imagesDir;
  const fp = path.join(dir, clean);
  if (!fp.startsWith(dir)) return null;
  if (!fs.existsSync(fp)) return null;
  try {
    const data = fs.readFileSync(fp);
    let mime;
    if (kind === "audio") {
      mime = clean.endsWith(".mp3") ? "audio/mpeg" : "audio/wav";
    } else {
      mime = clean.endsWith(".jpg") || clean.endsWith(".jpeg") ? "image/jpeg"
           : clean.endsWith(".webp") ? "image/webp"
           : "image/png";
    }
    return { data, mime };
  } catch (err) {
    console.warn("[saved] could not read local asset", url, err?.message);
    return null;
  }
}

app.post("/api/saved", requireAuth, async (req, res) => {
  const { title, narration, backgroundPrompt, voice, accentColor, imageUrl, audioUrl, card } = req.body || {};
  if (!title || !narration) return res.status(400).json({ error: "title + narration required" });
  // Dedupe: if the same reel (title+narration) already saved, return existing.
  const existing = await db.findSavedReel(req.user.id, title, narration);
  if (existing) return res.json({ saved: existing, dedup: true });

  // Read the actual bytes off disk so the reel survives a redeploy that
  // wipes the ephemeral /generated-images and /generated-audio dirs.
  const img = loadLocalAsset(imageUrl, "image");
  const aud = loadLocalAsset(audioUrl, "audio");

  const saved = await db.createSavedReel({
    userId: req.user.id,
    title, narration, backgroundPrompt, voice, accentColor, imageUrl, audioUrl, card,
    imageData: img?.data || null,
    imageMime: img?.mime || "",
    audioData: aud?.data || null,
    audioMime: aud?.mime || "",
  });
  res.json({ saved });
});

app.delete("/api/saved/:id", requireAuth, async (req, res) => {
  await db.deleteSavedReel(req.params.id, req.user.id);
  res.json({ ok: true });
});

// Serve persisted asset bytes for a saved reel. Stable forever — these don't
// touch the ephemeral disk. Cached aggressively (immutable per saved-reel id).
// Public by UUID: <img>/<audio> tags can't send Authorization headers, and the
// saved-reel UUID (128-bit random) is unguessable.
app.get("/api/saved/:id/image", async (req, res) => {
  const asset = await db.getSavedReelAsset(req.params.id, "image");
  if (!asset) return res.status(404).json({ error: "no image" });
  res.set("Content-Type", asset.mime);
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.send(asset.data);
});
app.get("/api/saved/:id/audio", async (req, res) => {
  const asset = await db.getSavedReelAsset(req.params.id, "audio");
  if (!asset) return res.status(404).json({ error: "no audio" });
  res.set("Content-Type", asset.mime);
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.send(asset.data);
});

// Build identifier — captured at process startup so /api/version reflects the
// actually-running deploy, not whatever the latest file says.
const BUILD_INFO = {
  bootedAt: new Date().toISOString(),
  ooxmlExtractor: "jszip-primary",
  persistence: "postgres",
  savedAssetSelfHeal: "20260507e",
  savedAssetsPersisted: true,
  reelLoadingGate: false, // removed in 20260508a — reel UI is now non-blocking
  fastReelLoad: "20260509b",
  ttsPrefetchSerial: true,
  ttsClientRateLimit: "8 RPM, 60s quota cooldown",
  deviceVoiceWarmedUp: true,
  chapterAssetsPersisted: true,
  ttsChain: [
    "gemini-2.5-flash-preview-tts",
    (process.env.GOOGLE_CLOUD_API_KEY || process.env.GEMINI_API_KEY) ? "google-cloud-tts (Neural2)" : null,
    process.env.OPENAI_API_KEY ? "openai tts-1" : null,
    "device voice (browser fallback)",
  ].filter(Boolean),
  imageDimsLogged: true,
  prefetchWorkers: "4 image + 2 audio",
  audioUnlockNonMuted: false, // reverted — muted unlock matches the working OLD pattern
  tapToResumeOnAutoplayBlock: true,
  captionLineHeight: 1.42,
  persistentReelAudio: false, // reverted to per-reel new Audio
  speakReelTriggerFix: "ensureAudio.finally + 3.5s timeout",
};
try {
  // Try to capture the deployed Git SHA if Render exposes it
  BUILD_INFO.commit = process.env.RENDER_GIT_COMMIT || process.env.COMMIT_SHA || "unknown";
} catch {}

app.get("/api/health", (_req, res) => res.json({ ok: true, ...BUILD_INFO }));
app.get("/api/version", (_req, res) => res.json(BUILD_INFO));

const PORT = process.env.PORT || 3000;
(async () => {
  try {
    await db.initSchema();
  } catch (e) {
    console.error("[db] schema init failed:", e.message || e);
    console.error("Check that DATABASE_URL is reachable and your Postgres is up.");
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`\nReel app running at http://localhost:${PORT}\n`);
  });
})();
