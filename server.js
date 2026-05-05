import express from "express";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import officeParser from "officeparser";
import * as db from "./db.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.GEMINI_API_KEY) {
  console.error("\nMissing GEMINI_API_KEY. Copy .env.example to .env and add your key from https://aistudio.google.com/apikey\n");
  process.exit(1);
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
app.use(express.static(path.join(__dirname, "public")));
app.use("/images", express.static(imagesDir));
app.use("/audio", express.static(audioDir));

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

  return `You are an AI that turns documents into a series of short-form video reels (Instagram Reels / TikTok style) for learning and entertainment, plus a final quiz.

USER PREFERENCES — HONOR THESE:
- ${lang}
- ${vibe}
- ${len}
- ${quiz}

Carefully analyze the attached content and extract EVERY meaningful piece of information. Then organize it into reels.

GROUPING RULES:
- Pack RELATED facts/ideas into the SAME reel so it flows as one cohesive story.
- UNRELATED topics get their OWN reels.
- Cover ALL the information — be comprehensive. Do not skip details.
- Reel count target is set by the LENGTH preference above.

EACH REEL MUST HAVE:
1. "title": short, punchy hook (max 8 words). Engaging, not academic.
2. "narration": the script the TTS will read aloud. 40-90 words. Conversational, energetic, easy to listen to. Use short sentences. No markdown, no bullet points, no special characters that would sound weird in TTS. Just clean spoken text.
3. "background_prompt": describe ONE clear visual scene that DIRECTLY illustrates this reel's topic so a viewer can SEE what's being explained — like the cover image of a magazine article. Format your prompt as: "[STYLE] of [SPECIFIC SUBJECT], [composition detail], [lighting], [mood/atmosphere]". The SUBJECT must be concrete and identifiable (e.g. "the human heart", "the Eiffel Tower at golden hour", "a glowing DNA double helix", "a Roman legionary in armor"), NOT abstract patterns or vibes. Position the subject DEAD CENTER of the frame, magazine-cover style, with clean uncluttered surroundings. Pick a polished aesthetic appropriate to the topic: cinematic photo, scientific illustration, watercolor, oil painting, 3D render, matte painting, or vintage poster. The image should TEACH the topic visually, not just decorate. Make every reel's background visually distinct from the others.
4. "accent_color": a single hex color (e.g. "#FF6B6B") that matches the mood of the reel for UI accents.
5. "voice": pick the voice that best matches this reel's tone, from EXACTLY one of: "Aoede" (breezy, upbeat), "Puck" (bright, playful), "Charon" (informative, deep), "Kore" (firm, clear), "Leda" (warm, youthful), "Fenrir" (energetic, intense). Vary voices across reels — don't pick the same one every time.

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
    { "title": "...", "narration": "...", "background_prompt": "...", "accent_color": "#RRGGBB", "voice": "Aoede" }
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

async function extractContentForGemini(filePath, originalName, mimeType) {
  const ext = path.extname(originalName).toLowerCase();

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
    if (f.state === "FAILED") throw new Error("Gemini failed to process file");
    return { kind: "fileRef", uri: f.uri, mimeType: f.mimeType };
  }

  if (OFFICE_EXTENSIONS.has(ext)) {
    const text = await officeParser.parseOfficeAsync(filePath);
    return { kind: "text", text: text.slice(0, 200000) };
  }

  if (TEXT_LIKE_EXTENSIONS.has(ext) || mimeType.startsWith("text/")) {
    const text = fs.readFileSync(filePath, "utf-8");
    return { kind: "text", text: text.slice(0, 200000) };
  }

  try {
    const text = await officeParser.parseOfficeAsync(filePath);
    if (text && text.trim().length > 0) {
      return { kind: "text", text: text.slice(0, 200000) };
    }
  } catch {}

  throw new Error(`Unsupported file type: ${mimeType || ext}`);
}

app.post("/api/upload", upload.single("file"), async (req, res) => {
  const filePath = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const content = await extractContentForGemini(filePath, req.file.originalname, req.file.mimetype);

    const settings = {
      vibe: req.body.vibe,
      length: req.body.length,
      quizDifficulty: req.body.quizDifficulty,
      language: req.body.language,
      vibeCustom: req.body.vibeCustom,
      quizDifficultyCustom: req.body.quizDifficultyCustom,
      languageCustom: req.body.languageCustom,
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
      if (!m) throw new Error("Gemini did not return JSON");
      parsed = JSON.parse(m[0]);
    }

    if (!parsed.reels || !Array.isArray(parsed.reels) || parsed.reels.length === 0) {
      throw new Error("Gemini returned no reels");
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

app.post("/api/image", async (req, res) => {
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

app.post("/api/tts", async (req, res) => {
  try {
    const { text } = req.body;
    let voice = req.body.voice || TTS_VOICE;
    if (!ALLOWED_VOICES.has(voice)) voice = TTS_VOICE;
    if (!text) return res.status(400).json({ error: "Missing text" });

    const hash = crypto.createHash("md5").update(text + "|" + voice).digest("hex").slice(0, 16);
    const filename = `tts_${hash}.wav`;
    const filepath = path.join(audioDir, filename);

    if (fs.existsSync(filepath)) {
      return res.json({ url: `/audio/${filename}`, cached: true });
    }

    // Prefix with a styling instruction so the TTS model treats the input
    // as a transcript to read aloud (avoids "tried to generate text" errors on short inputs).
    const styled = `Read the following aloud in an engaging, upbeat narrator voice. Do not add anything else.\n\n${text}`;

    const result = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [{ parts: [{ text: styled }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    });

    const audioPart = result?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!audioPart) throw new Error("No audio data in TTS response");

    const pcmBuffer = Buffer.from(audioPart.inlineData.data, "base64");
    const mime = audioPart.inlineData.mimeType || "audio/L16;rate=24000";
    const rateMatch = mime.match(/rate=(\d+)/i);
    const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;

    const wavBuffer = pcmToWav(pcmBuffer, sampleRate);
    fs.writeFileSync(filepath, wavBuffer);

    res.json({ url: `/audio/${filename}`, cached: false });
  } catch (e) {
    console.error("TTS error:", e);
    res.status(500).json({ error: e.message || "TTS failed" });
  }
});

app.post("/api/ask", async (req, res) => {
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

// ----- Subjects -----
app.get("/api/subjects", (_req, res) => {
  res.json({ subjects: db.listSubjects() });
});

app.post("/api/subjects", (req, res) => {
  const { title, description, color, emoji } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: "Missing title" });
  const subject = db.createSubject({ title, description, color, emoji });
  res.json({ subject });
});

app.patch("/api/subjects/:id", (req, res) => {
  const subject = db.updateSubject(req.params.id, req.body || {});
  if (!subject) return res.status(404).json({ error: "Subject not found" });
  res.json({ subject });
});

app.delete("/api/subjects/:id", (req, res) => {
  db.deleteSubject(req.params.id);
  res.json({ ok: true });
});

// ----- Chapters -----
app.get("/api/subjects/:id/chapters", (req, res) => {
  res.json({ chapters: db.listChapters(req.params.id) });
});

app.get("/api/chapters/:id", (req, res) => {
  const chapter = db.getChapter(req.params.id);
  if (!chapter) return res.status(404).json({ error: "Chapter not found" });
  res.json({ chapter });
});

app.delete("/api/chapters/:id", (req, res) => {
  db.deleteChapter(req.params.id);
  res.json({ ok: true });
});

// Cache image/audio URL per reel, so saved chapters don't have to regenerate them
app.post("/api/chapters/:id/asset", (req, res) => {
  const { kind, reelIdx, url } = req.body || {};
  if (!kind || reelIdx === undefined || !url) return res.status(400).json({ error: "Missing fields" });
  const map = db.setChapterAsset(req.params.id, kind, reelIdx, url);
  if (!map) return res.status(404).json({ error: "Chapter not found" });
  res.json({ ok: true });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nReel app running at http://localhost:${PORT}\n`);
});
