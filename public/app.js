// ==============================
// Reelify — frontend logic
// ==============================
const $ = (sel) => document.querySelector(sel);
const screens = {
  upload: $("#upload-screen"),
  loading: $("#loading-screen"),
  error: $("#error-screen"),
  reels: $("#reels-screen"),
};
function showScreen(name) {
  for (const k of Object.keys(screens)) screens[k].classList.toggle("active", k === name);
}

const fileInput = $("#fileInput");
const dropZone = $("#dropZone");
const dzText = $("#dzText");
const generateBtn = $("#generateBtn");
const errorText = $("#errorText");
const retryBtn = $("#retryBtn");
const reelsContainer = $("#reelsContainer");
const closeReelsBtn = $("#closeReelsBtn");
const firstHint = $("#firstHint");
const loadingTitle = $("#loadingTitle");
const loadingSub = $("#loadingSub");

let selectedFile = null;
let currentDoc = null;
let currentReels = [];
let currentQuiz = [];
let currentReelEl = null;
let currentAudio = null;
let imageCache = new Map();
let imageInflight = new Map();
let audioCache = new Map();
let audioInflight = new Map();
let activeRafId = null;

// ----- Settings & persistent UI state -----
const DEFAULT_SETTINGS = {
  vibe: "educational",
  imageStyle: "photo",
  length: "standard",
  pace: "normal",
  quizDifficulty: "medium",
  language: "en",
  voiceOverride: "auto",
  theme: "pink",
  autoAdvance: "on",
  // App-wide UI settings
  appTheme: "dark",     // dark | light | auto (only applies when uiTheme = default)
  uiTheme: "default",   // default | editorial | glass | riso | pastel
  appLang: "en",        // UI language
  // Subject the user picked on the upload screen (if any) for chapter saving
  subject: "",
  // Custom free-text overrides — used only when the corresponding chip is set to "custom"
  vibeCustom: "",
  imageStyleCustom: "",
  quizDifficultyCustom: "",
  languageCustom: "",
};
let settings = { ...DEFAULT_SETTINGS };
try {
  const saved = JSON.parse(localStorage.getItem("reelify-settings") || "{}");
  settings = { ...DEFAULT_SETTINGS, ...saved };
} catch {}
function saveSettings() {
  try { localStorage.setItem("reelify-settings", JSON.stringify(settings)); } catch {}
}

// ----- Theme accents -----
const THEMES = {
  pink:   { a1: "#ff3b6b", a2: "#6b8cff" },
  blue:   { a1: "#4dabf7", a2: "#845ef7" },
  green:  { a1: "#51cf66", a2: "#fcc419" },
  purple: { a1: "#cc5de8", a2: "#ff6b6b" },
  orange: { a1: "#ff8c42", a2: "#ff3b6b" },
};
function applyTheme(t) {
  const c = THEMES[t] || THEMES.pink;
  document.body.style.setProperty("--accent", c.a1);
  document.body.style.setProperty("--accent-2", c.a2);
}
applyTheme(settings.theme);

// ----- App theme (dark / light / auto) -----
function applyAppTheme(t) {
  const mode = t === "auto"
    ? (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : t;
  document.body.dataset.appTheme = mode || "dark";
}
applyAppTheme(settings.appTheme);
window.matchMedia?.("(prefers-color-scheme: light)").addEventListener?.("change", () => {
  if (settings.appTheme === "auto") applyAppTheme("auto");
});

// ----- UI theme (visual style: default / editorial / glass / riso / pastel) -----
function applyUiTheme(t) {
  document.body.dataset.uiTheme = t || "default";
}
applyUiTheme(settings.uiTheme);

// ----- I18N (UI strings) -----
const I18N = {
  en: {
    library: "Library", settings: "Settings",
    hero_title: "Drop a file. Get reels.",
    hero_sub: "PDF, Word, PowerPoint, images, text — Gemini reads it, packs it into bite-size scrolling reels with AI visuals, voiceover and synced captions.",
    save_to: "Save to subject", dont_save: "🗑 Don't save", new_subject: "+ New subject",
    new_subject_short: "New subject",
    new_subject_placeholder: 'Subject name (e.g. "Biology")',
    chapter_title_placeholder: 'Chapter title (e.g. "Chapter 1: Cells") — optional',
    saved: "Saved", stats_reels: "reels watched", stats_perfect: "perfect",
    generate: "Generate Reels", tip_main: "Tip: tap to pause · double-tap to ❤ · scroll for next",
    saved_reels: "Saved reels", saved_empty: "Tap ★ on any reel to save it here.",
    library_empty: 'No subjects yet. Click "+ New subject" to start a library.',
    app_theme: "App theme", app_lang: "App language",
    settings_note: "App language only changes the interface — narration language is set per upload.",
  },
  es: {
    library: "Biblioteca", settings: "Ajustes",
    hero_title: "Suelta un archivo. Obtén reels.",
    hero_sub: "PDF, Word, PowerPoint, imágenes, texto — Gemini lo lee y lo convierte en reels con visuales IA, voz y subtítulos sincronizados.",
    save_to: "Guardar en tema", dont_save: "🗑 No guardar", new_subject: "+ Nuevo tema",
    new_subject_short: "Nuevo tema",
    new_subject_placeholder: 'Nombre del tema (ej. "Biología")',
    chapter_title_placeholder: 'Título del capítulo (ej. "Capítulo 1: Células") — opcional',
    saved: "Guardados", stats_reels: "reels vistos", stats_perfect: "perfectos",
    generate: "Generar Reels", tip_main: "Toca para pausar · doble toque para ❤ · desliza al siguiente",
    saved_reels: "Reels guardados", saved_empty: "Toca ★ en cualquier reel para guardarlo aquí.",
    library_empty: 'Aún no hay temas. Toca "+ Nuevo tema" para empezar tu biblioteca.',
    app_theme: "Tema de la app", app_lang: "Idioma de la app",
    settings_note: "El idioma solo cambia la interfaz — el idioma de la narración se elige al subir el archivo.",
  },
  fr: {
    library: "Bibliothèque", settings: "Paramètres",
    hero_title: "Glissez un fichier. Obtenez des reels.",
    hero_sub: "PDF, Word, PowerPoint, images, texte — Gemini lit, regroupe et crée des reels avec visuels IA, voix off et sous-titres synchronisés.",
    save_to: "Enregistrer dans un sujet", dont_save: "🗑 Ne pas enregistrer", new_subject: "+ Nouveau sujet",
    new_subject_short: "Nouveau sujet",
    new_subject_placeholder: 'Nom du sujet (ex. "Biologie")',
    chapter_title_placeholder: 'Titre du chapitre (ex. "Chapitre 1: Cellules") — optionnel',
    saved: "Enregistrés", stats_reels: "reels vus", stats_perfect: "parfaits",
    generate: "Générer les reels", tip_main: "Touchez pour pause · double-touche pour ❤ · défilez pour le suivant",
    saved_reels: "Reels enregistrés", saved_empty: "Touchez ★ sur un reel pour l'enregistrer ici.",
    library_empty: 'Aucun sujet pour l\'instant. Cliquez "+ Nouveau sujet" pour commencer.',
    app_theme: "Thème de l'app", app_lang: "Langue de l'app",
    settings_note: "La langue ne change que l'interface — la langue de la narration se choisit à l'envoi.",
  },
  de: {
    library: "Bibliothek", settings: "Einstellungen",
    hero_title: "Datei ablegen. Reels erhalten.",
    hero_sub: "PDF, Word, PowerPoint, Bilder, Text — Gemini liest, gruppiert und macht Reels mit KI-Bildern, Voiceover und synchronen Untertiteln.",
    save_to: "In Thema speichern", dont_save: "🗑 Nicht speichern", new_subject: "+ Neues Thema",
    new_subject_short: "Neues Thema",
    new_subject_placeholder: 'Themenname (z.B. "Biologie")',
    chapter_title_placeholder: 'Kapiteltitel (z.B. "Kapitel 1: Zellen") — optional',
    saved: "Gespeichert", stats_reels: "Reels gesehen", stats_perfect: "perfekt",
    generate: "Reels erstellen", tip_main: "Tippen zum Pausieren · Doppeltippen für ❤ · scrollen für das nächste",
    saved_reels: "Gespeicherte Reels", saved_empty: "Tippe ★ auf ein Reel, um es hier zu speichern.",
    library_empty: 'Noch keine Themen. Klicke "+ Neues Thema" um zu starten.',
    app_theme: "App-Thema", app_lang: "App-Sprache",
    settings_note: "Die App-Sprache ändert nur die Oberfläche — die Erzählsprache wird beim Hochladen gewählt.",
  },
  pt: {
    library: "Biblioteca", settings: "Definições",
    hero_title: "Solte um ficheiro. Receba reels.",
    hero_sub: "PDF, Word, PowerPoint, imagens, texto — o Gemini lê e cria reels com visuais IA, narração e legendas sincronizadas.",
    save_to: "Guardar em tema", dont_save: "🗑 Não guardar", new_subject: "+ Novo tema",
    new_subject_short: "Novo tema",
    new_subject_placeholder: 'Nome do tema (ex. "Biologia")',
    chapter_title_placeholder: 'Título do capítulo (ex. "Capítulo 1: Células") — opcional',
    saved: "Guardados", stats_reels: "reels vistos", stats_perfect: "perfeitos",
    generate: "Gerar Reels", tip_main: "Toque para pausar · duplo toque para ❤ · deslize para o próximo",
    saved_reels: "Reels guardados", saved_empty: "Toque ★ num reel para guardar aqui.",
    library_empty: 'Ainda sem temas. Toque "+ Novo tema" para começar.',
    app_theme: "Tema da app", app_lang: "Idioma da app",
    settings_note: "O idioma só muda a interface — o idioma da narração é definido por upload.",
  },
  ja: {
    library: "ライブラリ", settings: "設定",
    hero_title: "ファイルを投下。リールを獲得。",
    hero_sub: "PDF、Word、PowerPoint、画像、テキスト — Gemini が読み込み、AI ビジュアルとナレーション付きの縦リールに変換します。",
    save_to: "テーマに保存", dont_save: "🗑 保存しない", new_subject: "+ 新規テーマ",
    new_subject_short: "新規テーマ",
    new_subject_placeholder: 'テーマ名（例: 「生物学」）',
    chapter_title_placeholder: '章タイトル（任意・例: 「第1章: 細胞」）',
    saved: "保存済み", stats_reels: "視聴したリール", stats_perfect: "全問正解",
    generate: "リールを生成", tip_main: "タップで一時停止 · ダブルタップで ❤ · スクロールで次へ",
    saved_reels: "保存したリール", saved_empty: "★ をタップしてここに保存。",
    library_empty: 'テーマがまだありません。「+ 新規テーマ」で始めましょう。',
    app_theme: "アプリのテーマ", app_lang: "アプリの言語",
    settings_note: "アプリの言語はUIのみ — ナレーション言語はアップロード時に選択。",
  },
  ar: {
    library: "المكتبة", settings: "الإعدادات",
    hero_title: "أَفلِت ملفًا. احصل على ريلز.",
    hero_sub: "PDF، Word، PowerPoint، صور، نصوص — Gemini يقرأ ويحوّل المحتوى إلى ريلز عمودية مع مرئيات وتعليق صوتي وترجمة متزامنة.",
    save_to: "حفظ في موضوع", dont_save: "🗑 عدم الحفظ", new_subject: "+ موضوع جديد",
    new_subject_short: "موضوع جديد",
    new_subject_placeholder: 'اسم الموضوع (مثلاً "الأحياء")',
    chapter_title_placeholder: 'عنوان الفصل (اختياري، مثلاً "الفصل 1: الخلايا")',
    saved: "محفوظ", stats_reels: "ريلز تمت مشاهدتها", stats_perfect: "إجابات مثالية",
    generate: "إنشاء الريلز", tip_main: "انقر للإيقاف · انقر مرتين لـ ❤ · مرّر للتالي",
    saved_reels: "الريلز المحفوظة", saved_empty: "انقر ★ على أي ريل لحفظه هنا.",
    library_empty: 'لا توجد مواضيع بعد. انقر "+ موضوع جديد" للبدء.',
    app_theme: "ثيم التطبيق", app_lang: "لغة التطبيق",
    settings_note: "لغة التطبيق تغيّر الواجهة فقط — لغة الراوي تُختار عند الرفع.",
  },
};

function applyAppLang(lang) {
  const dict = I18N[lang] || I18N.en;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    const txt = dict[key] || I18N.en[key];
    if (txt != null) el.textContent = txt;
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.dataset.i18nPlaceholder;
    const txt = dict[key] || I18N.en[key];
    if (txt != null) el.placeholder = txt;
  });
  document.documentElement.lang = lang;
  document.documentElement.dir = (lang === "ar") ? "rtl" : "ltr";
}
applyAppLang(settings.appLang);

// ----- Caption size -----
const CAPTION_SIZES = ["small", "medium", "large"];
let captionSize = (() => {
  try { return localStorage.getItem("reelify-cs") || "medium"; } catch { return "medium"; }
})();
function applyCaptionSize() {
  document.body.dataset.captionSize = captionSize;
}
applyCaptionSize();

// ----- Stats -----
let stats = (() => {
  try { return JSON.parse(localStorage.getItem("reelify-stats") || "{}"); } catch { return {}; }
})();
stats.reelsWatched = stats.reelsWatched || 0;
stats.perfectQuizzes = stats.perfectQuizzes || 0;
function persistStats() { try { localStorage.setItem("reelify-stats", JSON.stringify(stats)); } catch {} }
function refreshStatsBadge() {
  const r = document.getElementById("statsReels");
  const p = document.getElementById("statsPerfect");
  if (r) r.textContent = String(stats.reelsWatched);
  if (p) p.textContent = String(stats.perfectQuizzes);
  const sc = document.getElementById("savedCount");
  if (sc) sc.textContent = String(savedReelsAll().length);
}

// ----- Saved reels (full payload, replayable later) -----
function savedReelsAll() {
  try { return JSON.parse(localStorage.getItem("reelify-saved-v2") || "[]"); } catch { return []; }
}
function persistSavedAll(arr) { try { localStorage.setItem("reelify-saved-v2", JSON.stringify(arr)); } catch {} }
function isReelSaved(reel) { return savedReelsAll().some((r) => r.title === reel.title && r.narration === reel.narration); }
function toggleReelSaved(reel, extra = {}) {
  let arr = savedReelsAll();
  const exists = arr.findIndex((r) => r.title === reel.title && r.narration === reel.narration);
  if (exists >= 0) {
    arr.splice(exists, 1);
  } else {
    arr.unshift({
      title: reel.title,
      narration: reel.narration,
      background_prompt: reel.background_prompt,
      accent_color: reel.accent_color,
      voice: reel.voice,
      ...extra,
      savedAt: Date.now(),
    });
    arr = arr.slice(0, 50);
  }
  persistSavedAll(arr);
  return exists < 0; // true if newly saved
}

const SPEEDS = [0.75, 1, 1.25, 1.5];
const PACE_TO_SPEED_IDX = { chill: 0, normal: 1, fast: 2 };
let speedIdx = PACE_TO_SPEED_IDX[settings.pace] ?? 1;
let isMuted = false;
let reelLikes = {}; // idx -> count

function formatCount(n) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + "K";
  return (n / 1_000_000).toFixed(1) + "M";
}

// ----- Customization chips + custom-text inputs -----
function customInputFor(name) {
  return document.querySelector(`.cu-custom-input[data-name="${name}"]`);
}

function applySettingsToUI() {
  document.querySelectorAll(".cu-chips").forEach((group) => {
    const name = group.dataset.name;
    const val = settings[name];
    group.querySelectorAll(".cu-chip").forEach((c) => {
      c.classList.toggle("active", c.dataset.val === val);
    });
    // Show/hide its custom input + sync the value
    const input = customInputFor(name);
    if (input) {
      input.classList.toggle("hidden", val !== "custom");
      const stored = settings[name + "Custom"] || "";
      if (input.value !== stored) input.value = stored;
    }
  });
}

document.querySelectorAll(".cu-chips").forEach((group) => {
  group.addEventListener("click", (e) => {
    const chip = e.target.closest(".cu-chip");
    if (!chip) return;
    const name = group.dataset.name;
    const val = chip.dataset.val;
    settings[name] = val;
    if (name === "pace") speedIdx = PACE_TO_SPEED_IDX[val] ?? 1;
    if (name === "theme") applyTheme(val);
    if (name === "appTheme") applyAppTheme(val);
    if (name === "uiTheme") applyUiTheme(val);
    if (name === "appLang") applyAppLang(val);
    saveSettings();
    applySettingsToUI();
    updateSpeedButton();
    sfx("boop"); haptic(8);
    if (val === "custom") {
      const input = customInputFor(name);
      if (input) setTimeout(() => input.focus(), 30);
    }
  });
});

// Persist text as the user types
document.querySelectorAll(".cu-custom-input").forEach((input) => {
  input.addEventListener("input", () => {
    const name = input.dataset.name;
    settings[name + "Custom"] = input.value;
    saveSettings();
  });
});

applySettingsToUI();
refreshStatsBadge();

// ----- File pick -----
fileInput.addEventListener("change", (e) => onFile(e.target.files?.[0]));
dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("drag"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag");
  onFile(e.dataTransfer.files?.[0]);
});

function onFile(file) {
  if (!file) return;
  selectedFile = file;
  dzText.textContent = file.name.length > 36 ? file.name.slice(0, 33) + "…" : file.name;
  dropZone.classList.add("has-file");
  generateBtn.disabled = false;
  sfx("ding"); haptic(12); setMascotState("happy");
}

generateBtn.addEventListener("click", () => generate());
retryBtn.addEventListener("click", () => showScreen("upload"));
closeReelsBtn.addEventListener("click", closeReels);

// ----- Generate -----
async function generate() {
  if (!selectedFile) return;
  setMascotState("thinking", 0); // stays thinking while we work
  showScreen("loading");
  loadingTitle.textContent = "Reading your file…";
  loadingSub.textContent = "Gemini is finding the gold inside.";

  const phrases = [
    ["Reading your file…", "Gemini is finding the gold inside."],
    ["Grouping the ideas…", "Packing related bits into the same reel."],
    ["Writing the scripts…", "Punchy hooks, easy listening."],
    ["Casting voices…", "Each reel gets its own narrator."],
    ["Almost there…", "Cooking up the reel structure."],
  ];
  let i = 0;
  const loadingInterval = setInterval(() => {
    i = (i + 1) % phrases.length;
    loadingTitle.textContent = phrases[i][0];
    loadingSub.textContent = phrases[i][1];
  }, 2400);

  try {
    // Resolve subject: handle "+ New subject" inline-create here
    let subjectId = settings.subject || "";
    if (subjectId === "__new") {
      const name = (newSubjectInput?.value || "").trim();
      if (!name) {
        clearInterval(loadingInterval);
        showScreen("upload");
        showToast("Type a subject name first");
        return;
      }
      try {
        const subj = await createSubject({ title: name, emoji: "📚", color: "#6b8cff" });
        subjectId = subj.id;
        settings.subject = subj.id;
        saveSettings();
        await refreshSubjectChips();
      } catch (e) {
        clearInterval(loadingInterval);
        showScreen("upload");
        showToast(e.message || "Could not create subject");
        return;
      }
    }
    const chapterTitle = (chapterTitleInput?.value || "").trim();

    const fd = new FormData();
    fd.append("file", selectedFile);
    fd.append("vibe", settings.vibe);
    fd.append("length", settings.length);
    fd.append("quizDifficulty", settings.quizDifficulty);
    fd.append("language", settings.language);
    fd.append("vibeCustom", settings.vibeCustom || "");
    fd.append("quizDifficultyCustom", settings.quizDifficultyCustom || "");
    fd.append("languageCustom", settings.languageCustom || "");
    if (subjectId) fd.append("subjectId", subjectId);
    if (chapterTitle) fd.append("chapterTitle", chapterTitle);

    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const data = await res.json();
    clearInterval(loadingInterval);

    if (!res.ok) throw new Error(data.error || "Upload failed");
    if (!data.reels?.length) throw new Error("No reels were generated");

    currentDoc = data;
    currentReels = data.reels;
    currentQuiz = data.quiz || [];
    currentChapterId = data.chapter?.id || null;
    imageCache.clear(); imageInflight.clear();
    audioCache.clear(); audioInflight.clear();
    if (chapterTitleInput) chapterTitleInput.value = "";

    renderAll();
    showScreen("reels");
    sfx("fanfare"); haptic([15, 30, 15]);
    setMascotState("idle", 0);

    ensureImage(0); ensureAudio(0);
    if (currentReels.length > 1) { ensureImage(1); ensureAudio(1); }

    requestAnimationFrame(() => {
      const first = reelsContainer.firstElementChild;
      if (first) {
        first.scrollIntoView({ behavior: "instant", block: "start" });
        activateReel(first, 0);
      }
    });

    firstHint.classList.add("show");
    setTimeout(() => firstHint.classList.remove("show"), 2800);
  } catch (e) {
    clearInterval(loadingInterval);
    errorText.textContent = e.message || "Unknown error";
    showScreen("error");
  }
}

function closeReels() {
  stopAudio();
  reelsContainer.innerHTML = "";
  currentReels = [];
  currentQuiz = [];
  currentReelEl = null;
  showScreen("upload");
}

// ----- Render -----
function renderAll() {
  reelsContainer.innerHTML = "";
  const totalSlides = currentReels.length + (currentQuiz.length ? 1 : 0);

  currentReels.forEach((reel, idx) => {
    reelsContainer.appendChild(buildReel(reel, idx, totalSlides));
  });

  if (currentQuiz.length) {
    reelsContainer.appendChild(buildQuizReel(currentReels.length, totalSlides));
  }

  observeReels();
}

function buildReel(reel, idx, total) {
  const reelEl = document.createElement("div");
  reelEl.className = "reel";
  reelEl.dataset.idx = String(idx);
  reelEl.dataset.kind = "narration";
  reelEl.style.setProperty("--accent-glow", hexToGlow(reel.accent_color));
  reelEl.style.setProperty("--accent-color", reel.accent_color || "#ff3b6b");

  const bg = document.createElement("div");
  bg.className = "reel-bg placeholder";
  bg.style.background = `linear-gradient(135deg, ${reel.accent_color || "#ff3b6b"} 0%, #1a1a3a 100%)`;

  const overlay = document.createElement("div");
  overlay.className = "reel-overlay";

  const top = document.createElement("div");
  top.className = "reel-top";
  const progress = document.createElement("div");
  progress.className = "reel-progress";
  for (let p = 0; p < total; p++) {
    const seg = document.createElement("div");
    seg.className = "seg" + (p < idx ? " done" : "");
    const fill = document.createElement("span");
    fill.className = "fill";
    seg.appendChild(fill);
    progress.appendChild(seg);
  }
  const meta = document.createElement("div");
  meta.className = "reel-meta";
  const voice = reel.voice || "Aoede";
  meta.innerHTML =
    `<span class="rm-left"><span class="voice-badge">🎙 ${escapeHtml(voice)}</span></span>` +
    `<span class="rm-right">${idx + 1} / ${total}</span>`;
  top.append(progress, meta);

  const content = document.createElement("div");
  content.className = "reel-content";

  const titleWrap = document.createElement("div");
  titleWrap.className = "reel-title-wrap";
  const titleEl = document.createElement("h2");
  titleEl.className = "reel-title";
  titleEl.textContent = reel.title || "";
  titleWrap.appendChild(titleEl);

  const captionStage = document.createElement("div");
  captionStage.className = "reel-caption-stage";
  captionStage.innerHTML = renderChunkedCaption(reel.narration || "");

  content.append(titleWrap, captionStage);

  const playIcon = document.createElement("div");
  playIcon.className = "play-icon";

  const audioLoading = document.createElement("div");
  audioLoading.className = "audio-loading";
  audioLoading.innerHTML = `<div class="al-bars"><span></span><span></span><span></span></div><span class="al-text">Loading voiceover…</span>`;

  reelEl.append(bg, overlay, top, content, playIcon, audioLoading);

  attachTapHandlers(reelEl);

  return reelEl;
}

function buildQuizReel(idx, total) {
  const reelEl = document.createElement("div");
  reelEl.className = "reel quiz-reel";
  reelEl.dataset.idx = String(idx);
  reelEl.dataset.kind = "quiz";
  reelEl.style.setProperty("--accent-glow", "rgba(107, 140, 255, 0.65)");

  const bg = document.createElement("div");
  bg.className = "reel-bg quiz-bg";

  const overlay = document.createElement("div");
  overlay.className = "reel-overlay";

  const top = document.createElement("div");
  top.className = "reel-top";
  const progress = document.createElement("div");
  progress.className = "reel-progress";
  for (let p = 0; p < total; p++) {
    const seg = document.createElement("div");
    seg.className = "seg" + (p < idx ? " done" : "");
    const fill = document.createElement("span");
    fill.className = "fill";
    if (p < idx) fill.style.width = "100%";
    seg.appendChild(fill);
    progress.appendChild(seg);
  }
  const meta = document.createElement("div");
  meta.className = "reel-meta";
  meta.innerHTML = `<span>Quiz time</span><span>Reelify</span>`;
  top.append(progress, meta);

  const quizWrap = document.createElement("div");
  quizWrap.className = "quiz-wrap";
  quizWrap.innerHTML = `
    <div class="quiz-stage">
      <div class="quiz-header">
        <h2 class="quiz-title">Quick Quiz</h2>
        <p class="quiz-sub">Test what you just learned</p>
      </div>
      <div class="quiz-card">
        <div class="quiz-meta-row">
          <div class="quiz-meta"><span class="qm-step">1</span> / <span class="qm-total">${currentQuiz.length}</span></div>
          <div class="streak-pill hidden"><span class="sp-flame">🔥</span><span class="sp-num">2</span></div>
        </div>
        <h3 class="quiz-question"></h3>
        <div class="quiz-options"></div>
        <div class="quiz-feedback hidden"></div>
        <button class="quiz-next hidden">Next →</button>
      </div>
    </div>
    <div class="quiz-score hidden">
      <div class="score-emoji">🎉</div>
      <h2 class="score-num"></h2>
      <p class="score-msg"></p>
      <div class="score-actions">
        <button class="quiz-retry">Try again</button>
        <button class="quiz-restart">Upload new file</button>
      </div>
    </div>
  `;

  reelEl.append(bg, overlay, top, quizWrap);
  return reelEl;
}

// ----- Caption chunking (3-4 words at a time, breaks on punctuation) -----
function buildChunks(text, maxPerChunk = 4) {
  const words = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) {
    words.push({ text: m[0] });
  }
  if (!words.length) return [];

  const chunks = [];
  let cur = [];
  const lastIdx = words.length - 1;
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i]);
    const last = words[i].text;
    const lastChar = last[last.length - 1];
    const strong = ".!?".includes(lastChar);
    const weak = ",;:".includes(lastChar);
    const remaining = lastIdx - i;
    const isFinal = i === lastIdx;

    // Avoid stranding 1 word at the end
    if (remaining === 1 && cur.length < maxPerChunk) continue;

    if (isFinal ||
        (strong && cur.length >= 2) ||
        (weak && cur.length >= 3) ||
        cur.length >= maxPerChunk) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) {
    if (cur.length === 1 && chunks.length) chunks[chunks.length - 1].push(cur[0]);
    else chunks.push(cur);
  }
  return chunks;
}

function renderChunkedCaption(text) {
  const chunks = buildChunks(text);
  return chunks
    .map((ch, ci) => {
      const inner = ch
        .map((w) => `<span class="word">${escapeHtml(w.text)}</span>`)
        .join(" ");
      return `<div class="caption-chunk" data-idx="${ci}">${inner}</div>`;
    })
    .join("");
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function hexToGlow(hex) {
  if (!hex) return "rgba(255, 59, 107, 0.6)";
  const m = /^#?([a-fA-F0-9]{6})$/.exec(hex);
  if (!m) return "rgba(255, 59, 107, 0.6)";
  const v = m[1];
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.7)`;
}

// ----- Visibility / playback -----
function observeReels() {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.intersectionRatio >= 0.7) {
          const idx = Number(entry.target.dataset.idx);
          activateReel(entry.target, idx);
        }
      }
    },
    { threshold: [0, 0.5, 0.7, 0.9, 1], root: reelsContainer }
  );
  reelsContainer.querySelectorAll(".reel").forEach((r) => io.observe(r));
}

async function activateReel(reelEl, idx) {
  if (currentReelEl === reelEl) return;
  stopAudio();
  if (currentReelEl) currentReelEl.classList.remove("active", "paused");
  currentReelEl = reelEl;
  reelEl.classList.add("active");

  refreshActionsForReel(reelEl);

  if (reelEl.dataset.kind === "narration" && !reelEl.dataset.counted) {
    reelEl.dataset.counted = "1";
    stats.reelsWatched++;
    persistStats();
    refreshStatsBadge();
  }

  // Update progress bars
  document.querySelectorAll(".reel").forEach((el) => {
    el.querySelectorAll(".seg").forEach((seg, segIdx) => {
      seg.classList.toggle("done", segIdx < idx);
      const fill = seg.querySelector(".fill");
      if (segIdx < idx) fill.style.width = "100%";
      else if (segIdx > idx) fill.style.width = "0%";
      else fill.style.width = "0%";
    });
  });

  if (reelEl.dataset.kind === "quiz") {
    activateQuiz(reelEl);
    return;
  }

  ensureImage(idx).then((url) => {
    if (!url || currentReelEl !== reelEl) return;
    const bg = reelEl.querySelector(".reel-bg");
    // Pre-load so the swap is clean and the pop-in animates from a real image
    const pre = new Image();
    pre.onload = () => {
      if (!reelEl.isConnected) return;
      bg.style.backgroundImage = `url("${url}")`;
      bg.classList.remove("placeholder");
      bg.classList.remove("img-loaded");
      void bg.offsetWidth;
      bg.classList.add("img-loaded");
    };
    pre.onerror = () => console.warn("image preload failed", url);
    pre.src = url;
  });

  if (idx + 1 < currentReels.length) { ensureImage(idx + 1); ensureAudio(idx + 1); }
  if (idx - 1 >= 0) ensureImage(idx - 1);

  speakReel(reelEl, idx);
}

// ----- Tap handlers (single tap = zone action, double = heart) -----
function attachTapHandlers(reelEl) {
  let lastTap = 0;
  let tapTimer = null;

  reelEl.addEventListener("click", (e) => {
    if (reelEl.dataset.kind !== "narration") return;
    if (e.target.closest("[data-no-tap]")) return;
    const now = Date.now();
    if (now - lastTap < 300) {
      if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; }
      lastTap = 0;
      const rect = reelEl.getBoundingClientRect();
      spawnHearts(reelEl, e.clientX - rect.left, e.clientY - rect.top);
      return;
    }
    lastTap = now;
    const rect = reelEl.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;

    tapTimer = setTimeout(() => {
      tapTimer = null;
      // Top 12% reserved for the progress bar; ignore tap-zone there
      if (relY < 0.12) return;

      if (relX < 0.30) {
        // Left zone — previous reel
        flashTapZone(reelEl, "left");
        const prev = reelEl.previousElementSibling;
        if (prev) prev.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (relX > 0.70) {
        // Right zone — next reel
        flashTapZone(reelEl, "right");
        const next = reelEl.nextElementSibling;
        if (next) next.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        togglePlay(reelEl);
      }
    }, 240);
  });
}

function flashTapZone(reelEl, side) {
  const f = document.createElement("div");
  f.className = `tap-flash ${side}`;
  reelEl.appendChild(f);
  setTimeout(() => f.remove(), 400);
}

function spawnHearts(reelEl, x, y) {
  // Big heart pop at tap point
  const big = document.createElement("div");
  big.className = "tap-heart big";
  big.textContent = "❤";
  big.style.left = x + "px";
  big.style.top = y + "px";
  reelEl.appendChild(big);
  setTimeout(() => big.remove(), 1100);

  // Small drifting hearts
  const emojis = ["❤", "💖", "💕", "💘", "💝", "✨"];
  for (let i = 0; i < 6; i++) {
    setTimeout(() => {
      const h = document.createElement("div");
      h.className = "tap-heart small";
      h.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      h.style.left = (x + (Math.random() - 0.5) * 60) + "px";
      h.style.top = y + "px";
      h.style.setProperty("--drift-x", ((Math.random() - 0.5) * 140) + "px");
      h.style.setProperty("--drift-y", (-160 - Math.random() * 120) + "px");
      h.style.setProperty("--rot", ((Math.random() - 0.5) * 60) + "deg");
      reelEl.appendChild(h);
      setTimeout(() => h.remove(), 1500);
    }, i * 70);
  }
}

function togglePlay(reelEl) {
  if (currentReelEl !== reelEl) return;
  if (reelEl.dataset.kind === "quiz") return;
  if (!currentAudio) return;
  if (currentAudio.paused) {
    currentAudio.play().catch(() => {});
    reelEl.classList.remove("paused");
  } else {
    currentAudio.pause();
    reelEl.classList.add("paused");
  }
}

function stopAudio() {
  if (currentAudio) {
    try { currentAudio.pause(); currentAudio.src = ""; } catch {}
    currentAudio = null;
  }
  if (activeRafId) { cancelAnimationFrame(activeRafId); activeRafId = null; }
}

async function speakReel(reelEl, idx) {
  const reel = currentReels[idx];
  if (!reel) return;

  const stage = reelEl.querySelector(".reel-caption-stage");
  const chunkEls = Array.from(stage.querySelectorAll(".caption-chunk"));
  const allWordEls = Array.from(stage.querySelectorAll(".word"));
  // Reset
  chunkEls.forEach((c) => c.classList.remove("active", "exiting"));
  allWordEls.forEach((w) => w.classList.remove("active", "spoken"));

  reelEl.classList.add("loading-audio");
  let audioUrl;
  try {
    audioUrl = await ensureAudio(idx);
  } catch (e) {
    console.warn("TTS failed, using browser fallback", e);
    reelEl.classList.remove("loading-audio");
    return browserSpeakReel(reelEl, idx, chunkEls);
  }
  reelEl.classList.remove("loading-audio");
  if (currentReelEl !== reelEl) return;

  const audio = new Audio(audioUrl);
  audio.preload = "auto";
  audio.playbackRate = SPEEDS[speedIdx];
  audio.muted = isMuted;
  currentAudio = audio;

  // Build chunk timing once metadata loads
  let chunkData = null;
  function buildTiming() {
    const duration = audio.duration || estimateDuration(reel.narration);
    const totalChars = allWordEls.reduce((s, el) => s + Math.max(1, el.textContent.length), 0) || 1;
    let cum = 0;
    const wordTimes = allWordEls.map((el) => {
      const start = (cum / totalChars) * duration;
      cum += Math.max(1, el.textContent.length);
      const end = (cum / totalChars) * duration;
      return { el, start, end };
    });
    let wIdx = 0;
    chunkData = chunkEls.map((chEl) => {
      const innerWords = chEl.querySelectorAll(".word");
      const start = wordTimes[wIdx]?.start ?? 0;
      const sliceEnd = wIdx + innerWords.length;
      const end = wordTimes[sliceEnd - 1]?.end ?? duration;
      const slice = wordTimes.slice(wIdx, sliceEnd);
      wIdx = sliceEnd;
      return { el: chEl, start, end, words: slice };
    });
  }
  if (audio.readyState >= 1) buildTiming();
  else audio.addEventListener("loadedmetadata", buildTiming, { once: true });

  let lastChunkIdx = -1;
  let lastWordIdx = -1;
  const segFill = reelEl.querySelectorAll(".reel-progress .seg")[idx]?.querySelector(".fill");

  function tick() {
    if (currentAudio !== audio) return;
    const t = audio.currentTime;
    const dur = audio.duration || estimateDuration(reel.narration);

    if (chunkData) {
      // Find active chunk
      let activeChunk = chunkData.findIndex((c) => t >= c.start && t < c.end);
      if (activeChunk === -1) {
        if (chunkData.length && t >= chunkData[chunkData.length - 1].end) activeChunk = chunkData.length - 1;
        else if (t < (chunkData[0]?.start ?? 0)) activeChunk = 0;
      }
      if (activeChunk !== lastChunkIdx) {
        chunkData.forEach((c, i) => {
          c.el.classList.toggle("active", i === activeChunk);
          c.el.classList.toggle("exiting", i < activeChunk);
        });
        // Reset word states inside the new active chunk
        if (activeChunk >= 0) {
          chunkData[activeChunk].words.forEach(({ el }) => {
            el.classList.remove("active", "spoken");
          });
        }
        lastChunkIdx = activeChunk;
        lastWordIdx = -1;
      }
      // Find active word inside chunk
      if (activeChunk >= 0) {
        const ch = chunkData[activeChunk];
        let wIdx = ch.words.findIndex((w) => t < w.end);
        if (wIdx === -1) wIdx = ch.words.length - 1;
        if (wIdx !== lastWordIdx) {
          ch.words.forEach(({ el }, i) => {
            el.classList.toggle("active", i === wIdx);
            el.classList.toggle("spoken", i < wIdx);
          });
          lastWordIdx = wIdx;
        }
      }
    }

    if (segFill && dur > 0) segFill.style.width = Math.min(100, (t / dur) * 100) + "%";
    activeRafId = requestAnimationFrame(tick);
  }

  audio.addEventListener("ended", () => {
    if (chunkData) {
      chunkData.forEach((c) => c.el.classList.add("exiting"));
      chunkData[chunkData.length - 1]?.el.classList.add("active");
      chunkData[chunkData.length - 1]?.words.forEach(({ el }) => {
        el.classList.remove("active");
        el.classList.add("spoken");
      });
    }
    if (segFill) segFill.style.width = "100%";
    if (activeRafId) { cancelAnimationFrame(activeRafId); activeRafId = null; }
    setTimeout(() => {
      if (currentReelEl === reelEl && settings.autoAdvance !== "off") {
        const next = reelEl.nextElementSibling;
        if (next) next.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 700);
  });

  audio.addEventListener("pause", () => {
    if (currentReelEl === reelEl && !audio.ended) reelEl.classList.add("paused");
  });
  audio.addEventListener("play", () => {
    reelEl.classList.remove("paused");
    if (!activeRafId) tick();
  });

  try {
    await audio.play();
  } catch {
    reelEl.classList.add("paused");
  }
}

function estimateDuration(text) {
  const words = text.trim().split(/\s+/).length;
  return Math.max(6, words / 2.6);
}

function browserSpeakReel(reelEl, idx, chunkEls) {
  if (!("speechSynthesis" in window)) return;
  const reel = currentReels[idx];
  const allWordEls = Array.from(reelEl.querySelectorAll(".word"));
  // Build simple chunk start chars for the fallback
  const chunkStartCharIdx = [];
  let charPos = 0;
  chunkEls.forEach((chEl) => {
    chunkStartCharIdx.push(charPos);
    chEl.querySelectorAll(".word").forEach((w) => { charPos += w.textContent.length + 1; });
  });

  const utt = new SpeechSynthesisUtterance(reel.narration);
  utt.rate = 1.05;
  let lastChunk = -1;
  let lastWord = -1;
  utt.onboundary = (e) => {
    if (e.name && e.name !== "word") return;
    const ci = e.charIndex ?? 0;
    // Find chunk
    let cIdx = chunkStartCharIdx.findIndex((s, i) => {
      const next = chunkStartCharIdx[i + 1] ?? Infinity;
      return ci >= s && ci < next;
    });
    if (cIdx === -1) cIdx = chunkEls.length - 1;
    if (cIdx !== lastChunk) {
      chunkEls.forEach((c, i) => {
        c.classList.toggle("active", i === cIdx);
        c.classList.toggle("exiting", i < cIdx);
      });
      lastChunk = cIdx;
      lastWord = -1;
    }
    // Find word inside chunk by char position
    const wEls = Array.from(chunkEls[cIdx].querySelectorAll(".word"));
    let runningChar = chunkStartCharIdx[cIdx];
    let wi = -1;
    for (let i = 0; i < wEls.length; i++) {
      const wlen = wEls[i].textContent.length + 1;
      if (ci < runningChar + wlen) { wi = i; break; }
      runningChar += wlen;
    }
    if (wi === -1) wi = wEls.length - 1;
    if (wi !== lastWord) {
      wEls.forEach((el, i) => {
        el.classList.toggle("active", i === wi);
        el.classList.toggle("spoken", i < wi);
      });
      lastWord = wi;
    }
  };
  utt.onend = () => {
    chunkEls.forEach((c) => c.classList.add("exiting"));
    setTimeout(() => {
      if (currentReelEl === reelEl && settings.autoAdvance !== "off") {
        const next = reelEl.nextElementSibling;
        if (next) next.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 700);
  };
  setTimeout(() => window.speechSynthesis.speak(utt), 60);
}

// ----- Image generation -----
function ensureImage(idx) {
  if (imageCache.has(idx)) return Promise.resolve(imageCache.get(idx));
  if (imageInflight.has(idx)) return imageInflight.get(idx);
  const reel = currentReels[idx];
  if (!reel) return Promise.resolve(null);

  const p = fetch("/api/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: reel.background_prompt,
      imageStyle: settings.imageStyle,
      imageStyleCustom: settings.imageStyleCustom || "",
    }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (!data.url) throw new Error(data.error || "no image");
      imageCache.set(idx, data.url);
      imageInflight.delete(idx);
      if (currentChapterId) postChapterAsset(currentChapterId, "image", idx, data.url);
      return data.url;
    })
    .catch((e) => {
      console.warn("image gen failed", e);
      imageInflight.delete(idx);
      return null;
    });

  imageInflight.set(idx, p);
  return p;
}

// ----- Audio generation (with per-reel voice) -----
function ensureAudio(idx) {
  if (audioCache.has(idx)) return Promise.resolve(audioCache.get(idx));
  if (audioInflight.has(idx)) return audioInflight.get(idx);
  const reel = currentReels[idx];
  if (!reel) return Promise.reject(new Error("no reel"));

  const voice = (settings.voiceOverride && settings.voiceOverride !== "auto") ? settings.voiceOverride : reel.voice;

  const p = fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: reel.narration, voice }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (!data.url) throw new Error(data.error || "no audio");
      audioCache.set(idx, data.url);
      audioInflight.delete(idx);
      if (currentChapterId) postChapterAsset(currentChapterId, "audio", idx, data.url);
      return data.url;
    })
    .catch((e) => {
      audioInflight.delete(idx);
      throw e;
    });

  audioInflight.set(idx, p);
  return p;
}

// ----- Quiz -----
let quizState = null;

function activateQuiz(reelEl) {
  const stage = reelEl.querySelector(".quiz-stage");
  const score = reelEl.querySelector(".quiz-score");
  stage.classList.remove("hidden");
  score.classList.add("hidden");

  quizState = {
    reelEl,
    step: 0,
    correctCount: 0,
    streak: 0,
    answered: false,
  };

  if (!reelEl.dataset.wired) {
    reelEl.dataset.wired = "1";
    reelEl.querySelector(".quiz-retry").addEventListener("click", () => activateQuiz(reelEl));
    reelEl.querySelector(".quiz-restart").addEventListener("click", () => closeReels());
    reelEl.querySelector(".quiz-next").addEventListener("click", () => nextQuestion());
  }
  // Hide streak pill
  reelEl.querySelector(".streak-pill")?.classList.add("hidden");

  showQuestion();
}

function showQuestion() {
  const { reelEl, step } = quizState;
  const q = currentQuiz[step];
  if (!q) return showScore();

  reelEl.querySelector(".qm-step").textContent = String(step + 1);
  reelEl.querySelector(".qm-total").textContent = String(currentQuiz.length);
  reelEl.querySelector(".quiz-question").textContent = q.question;

  const optsEl = reelEl.querySelector(".quiz-options");
  optsEl.innerHTML = "";
  const labels = ["A", "B", "C", "D", "E", "F"];
  q.options.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = "quiz-option";
    btn.innerHTML = `<span class="qo-label">${labels[i] || ""}</span><span class="qo-text">${escapeHtml(opt)}</span>`;
    btn.addEventListener("click", () => answer(i));
    optsEl.appendChild(btn);
  });

  reelEl.querySelector(".quiz-feedback").classList.add("hidden");
  reelEl.querySelector(".quiz-next").classList.add("hidden");
  quizState.answered = false;
}

function answer(choice) {
  if (quizState.answered) return;
  quizState.answered = true;
  const { reelEl, step } = quizState;
  const q = currentQuiz[step];
  const correct = q.correct_index;

  const optBtns = reelEl.querySelectorAll(".quiz-option");
  optBtns.forEach((b, i) => {
    b.disabled = true;
    if (i === correct) b.classList.add("correct");
    if (i === choice && choice !== correct) b.classList.add("incorrect");
  });

  if (choice === correct) {
    quizState.correctCount++;
    quizState.streak++;
    if (quizState.streak >= 2) showStreak(reelEl, quizState.streak);
    spawnSparkles(reelEl);
    sfx("chime"); haptic([10, 50, 10]); setMascotState("happy", 1500);
  } else {
    quizState.streak = 0;
    reelEl.querySelector(".streak-pill")?.classList.add("hidden");
    shake(reelEl.querySelector(".quiz-card"));
    sfx("buzzer"); haptic(80); setMascotState("sad", 1500);
  }

  const fb = reelEl.querySelector(".quiz-feedback");
  fb.classList.remove("hidden");
  fb.classList.toggle("ok", choice === correct);
  fb.classList.toggle("bad", choice !== correct);
  fb.innerHTML = (choice === correct ? "✓ Correct. " : "✗ Not quite. ") + escapeHtml(q.explanation || "");

  reelEl.querySelector(".quiz-next").classList.remove("hidden");
}

function showStreak(reelEl, n) {
  const pill = reelEl.querySelector(".streak-pill");
  if (!pill) return;
  pill.querySelector(".sp-num").textContent = String(n);
  pill.classList.remove("hidden");
  pill.classList.remove("pop");
  void pill.offsetWidth; // restart anim
  pill.classList.add("pop");
}

function shake(el) {
  if (!el) return;
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
}

function spawnSparkles(reelEl) {
  const card = reelEl.querySelector(".quiz-card");
  if (!card) return;
  const rect = card.getBoundingClientRect();
  const reelRect = reelEl.getBoundingClientRect();
  const cx = rect.left - reelRect.left + rect.width / 2;
  const cy = rect.top - reelRect.top + 30;
  const emojis = ["✨", "⭐", "💫"];
  for (let i = 0; i < 8; i++) {
    const s = document.createElement("div");
    s.className = "sparkle";
    s.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    s.style.left = cx + "px";
    s.style.top = cy + "px";
    s.style.setProperty("--dx", ((Math.random() - 0.5) * 220) + "px");
    s.style.setProperty("--dy", (-60 - Math.random() * 140) + "px");
    s.style.setProperty("--dur", (0.9 + Math.random() * 0.6) + "s");
    reelEl.appendChild(s);
    setTimeout(() => s.remove(), 1500);
  }
}

function nextQuestion() {
  quizState.step++;
  if (quizState.step >= currentQuiz.length) showScore();
  else showQuestion();
}

function showScore() {
  const { reelEl, correctCount } = quizState;
  reelEl.querySelector(".quiz-stage").classList.add("hidden");
  const score = reelEl.querySelector(".quiz-score");
  score.classList.remove("hidden");

  const total = currentQuiz.length;
  const ratio = correctCount / total;
  let msg = "Solid effort. Re-watch the reels and try again.";
  let emoji = "💪";
  if (ratio === 1) { msg = "Perfect score! You absorbed it all."; emoji = "🏆"; }
  else if (ratio >= 0.7) { msg = "Great work — you really listened."; emoji = "🎉"; }
  else if (ratio >= 0.4) { msg = "Not bad. A second pass will lock it in."; emoji = "👍"; }

  reelEl.querySelector(".score-emoji").textContent = emoji;
  reelEl.querySelector(".score-num").textContent = `${correctCount} / ${total}`;
  reelEl.querySelector(".score-msg").textContent = msg;

  if (ratio === 1) {
    confettiBurst(reelEl);
    stats.perfectQuizzes++;
    persistStats();
    refreshStatsBadge();
    sfx("fanfare"); haptic([20, 40, 20, 40, 60]); setMascotState("celebrate", 2500);
  } else if (ratio >= 0.7) {
    sfx("ding"); haptic([15, 30, 15]); setMascotState("happy", 1800);
  } else {
    sfx("ding"); haptic(20);
  }
}

function confettiBurst(reelEl) {
  const emojis = ["🎉", "🎊", "✨", "⭐", "🏆", "💫", "🌟", "🎈"];
  const container = document.createElement("div");
  container.className = "confetti-container";
  reelEl.appendChild(container);

  for (let i = 0; i < 70; i++) {
    const c = document.createElement("div");
    c.className = "confetti";
    c.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    c.style.left = Math.random() * 100 + "%";
    c.style.animationDelay = Math.random() * 0.6 + "s";
    c.style.animationDuration = (2 + Math.random() * 2.5) + "s";
    c.style.fontSize = (14 + Math.random() * 26) + "px";
    container.appendChild(c);
  }
  setTimeout(() => container.remove(), 6000);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden && currentAudio && !currentAudio.paused) {
    currentAudio.pause();
    if (currentReelEl) currentReelEl.classList.add("paused");
  }
});

// =============================================================
//  Right-side action sidebar (like, save, speed, replay, mute)
// =============================================================
const actionsEl = document.getElementById("reelActions");
const likeBtn = actionsEl.querySelector('[data-action="like"]');
const saveBtn = actionsEl.querySelector('[data-action="save"]');
const speedBtn = actionsEl.querySelector('[data-action="speed"]');
const replayBtn = actionsEl.querySelector('[data-action="replay"]');
const muteBtn = actionsEl.querySelector('[data-action="mute"]');

actionsEl.addEventListener("click", (e) => e.stopPropagation());

likeBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!currentReelEl || currentReelEl.dataset.kind === "quiz") return;
  const idx = Number(currentReelEl.dataset.idx);
  reelLikes[idx] = (reelLikes[idx] || 0) + 1;
  likeBtn.querySelector(".ra-count").textContent = formatCount(reelLikes[idx]);
  likeBtn.classList.add("liked");
  likeBtn.classList.remove("popping");
  void likeBtn.offsetWidth;
  likeBtn.classList.add("popping");
  const r = likeBtn.getBoundingClientRect();
  const reelR = currentReelEl.getBoundingClientRect();
  spawnHearts(currentReelEl, r.left - reelR.left + r.width / 2, r.top - reelR.top + r.height / 2);
  sfx("heart"); haptic([10, 30, 10]);
});

// Save button click is wired below in the "Saved reels v2" section

speedBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  speedIdx = (speedIdx + 1) % SPEEDS.length;
  if (currentAudio) currentAudio.playbackRate = SPEEDS[speedIdx];
  updateSpeedButton();
});

function updateSpeedButton() {
  if (!speedBtn) return;
  const v = SPEEDS[speedIdx];
  const label = (v === 1 ? "1×" : v + "×");
  speedBtn.querySelector(".ra-speed-icon").textContent = label;
}
updateSpeedButton();

replayBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!currentAudio) return;
  currentAudio.currentTime = 0;
  // Reset chunk states
  if (currentReelEl) {
    currentReelEl.querySelectorAll(".caption-chunk").forEach((c) => c.classList.remove("active", "exiting"));
    currentReelEl.querySelectorAll(".word").forEach((w) => w.classList.remove("active", "spoken"));
  }
  currentAudio.play().catch(() => {});
  replayBtn.classList.remove("spinning");
  void replayBtn.offsetWidth;
  replayBtn.classList.add("spinning");
});

muteBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  isMuted = !isMuted;
  if (currentAudio) currentAudio.muted = isMuted;
  muteBtn.classList.toggle("muted", isMuted);
  const on = muteBtn.querySelector(".ra-svg-on");
  const off = muteBtn.querySelector(".ra-svg-off");
  if (on)  on.style.display  = isMuted ? "none" : "";
  if (off) off.style.display = isMuted ? ""    : "none";
  sfx("boop"); haptic(8);
});

// Caption size cycle
const csBtn = actionsEl.querySelector('[data-action="captionSize"]');
function updateCsBtn() {
  if (!csBtn) return;
  const map = { small: "Aa", medium: "Aa", large: "Aa" };
  const sizeMap = { small: "12px", medium: "14px", large: "17px" };
  csBtn.querySelector(".ra-cs-icon").textContent = map[captionSize];
  csBtn.querySelector(".ra-cs-icon").style.fontSize = sizeMap[captionSize];
}
updateCsBtn();
csBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  const i = CAPTION_SIZES.indexOf(captionSize);
  captionSize = CAPTION_SIZES[(i + 1) % CAPTION_SIZES.length];
  try { localStorage.setItem("reelify-cs", captionSize); } catch {}
  applyCaptionSize();
  updateCsBtn();
});

// Share narration (Web Share API + clipboard fallback)
const shareBtn = actionsEl.querySelector('[data-action="share"]');
shareBtn?.addEventListener("click", async (e) => {
  e.stopPropagation();
  if (!currentReelEl || currentReelEl.dataset.kind === "quiz") return;
  const idx = Number(currentReelEl.dataset.idx);
  const reel = currentReels[idx];
  if (!reel) return;
  const text = `${reel.title}\n\n${reel.narration}\n\n— made with Reelify`;
  try {
    if (navigator.share) {
      await navigator.share({ title: reel.title, text });
      showToast("Shared");
    } else {
      await navigator.clipboard.writeText(text);
      showToast("Copied to clipboard");
    }
  } catch {
    try { await navigator.clipboard.writeText(text); showToast("Copied"); } catch { showToast("Couldn't share"); }
  }
});

// Reactions picker
const reactBtn = actionsEl.querySelector('[data-action="react"]');
const reactionsPicker = document.getElementById("reactionsPicker");
reactBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!currentReelEl || currentReelEl.dataset.kind === "quiz") return;
  const open = !reactionsPicker.classList.contains("hidden");
  if (open) reactionsPicker.classList.add("hidden");
  else {
    // Position picker next to react button
    const r = reactBtn.getBoundingClientRect();
    reactionsPicker.style.top = (r.top + r.height / 2) + "px";
    reactionsPicker.style.right = (window.innerWidth - r.left + 8) + "px";
    reactionsPicker.classList.remove("hidden");
  }
});
reactionsPicker?.addEventListener("click", (e) => {
  e.stopPropagation();
  const btn = e.target.closest(".rp-emoji");
  if (!btn || !currentReelEl) return;
  spawnEmojiBurst(currentReelEl, btn.dataset.emoji);
  reactionsPicker.classList.add("hidden");
});
document.addEventListener("click", () => {
  if (reactionsPicker && !reactionsPicker.classList.contains("hidden")) {
    reactionsPicker.classList.add("hidden");
  }
});

function spawnEmojiBurst(reelEl, emoji) {
  // Burst from bottom-center upward, like TikTok reaction
  const cx = reelEl.clientWidth / 2;
  const cy = reelEl.clientHeight - 120;
  for (let i = 0; i < 9; i++) {
    setTimeout(() => {
      const e = document.createElement("div");
      e.className = "tap-heart small reaction";
      e.textContent = emoji;
      e.style.left = (cx + (Math.random() - 0.5) * 200) + "px";
      e.style.top = cy + "px";
      e.style.setProperty("--drift-x", ((Math.random() - 0.5) * 240) + "px");
      e.style.setProperty("--drift-y", (-260 - Math.random() * 200) + "px");
      e.style.setProperty("--rot", ((Math.random() - 0.5) * 90) + "deg");
      e.style.fontSize = (24 + Math.random() * 20) + "px";
      reelEl.appendChild(e);
      setTimeout(() => e.remove(), 1700);
    }, i * 60);
  }
}

// Ask AI
const askBtn = actionsEl.querySelector('[data-action="ask"]');
const askModal = document.getElementById("askModal");
const askInput = document.getElementById("askInput");
const askSubmit = document.getElementById("askSubmit");
const askAnswer = document.getElementById("askAnswer");
const askContextEl = document.getElementById("askContext");

askBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!currentReelEl || currentReelEl.dataset.kind === "quiz") return;
  const idx = Number(currentReelEl.dataset.idx);
  const reel = currentReels[idx];
  if (!reel) return;
  askContextEl.textContent = `About: ${reel.title}`;
  askInput.value = "";
  askAnswer.classList.add("hidden");
  askAnswer.textContent = "";
  openModal(askModal);
  if (currentAudio && !currentAudio.paused) { currentAudio.pause(); currentReelEl.classList.add("paused"); }
  setTimeout(() => askInput.focus(), 80);
});

askSubmit?.addEventListener("click", async () => {
  const q = askInput.value.trim();
  if (!q || !currentReelEl) return;
  const idx = Number(currentReelEl.dataset.idx);
  const reel = currentReels[idx];
  askSubmit.disabled = true;
  askSubmit.textContent = "Thinking…";
  askAnswer.classList.remove("hidden");
  askAnswer.textContent = "…";
  try {
    const r = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: q,
        context: `Title: ${reel.title}\n\nNarration: ${reel.narration}`,
        language: settings.language,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Ask failed");
    askAnswer.textContent = data.answer || "(no answer)";
  } catch (err) {
    askAnswer.textContent = "Sorry — couldn't get an answer. " + (err.message || "");
  } finally {
    askSubmit.disabled = false;
    askSubmit.textContent = "Ask";
  }
});
askInput?.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" && !e.shiftKey) || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
    e.preventDefault();
    askSubmit.click();
  }
});

// Modal close handlers
function openModal(m) { m.classList.remove("hidden"); }
function closeModal(m) { m.classList.add("hidden"); }
document.querySelectorAll(".modal").forEach((m) => {
  m.querySelectorAll("[data-close]").forEach((el) => {
    el.addEventListener("click", () => closeModal(m));
  });
});

// Saved gallery
const savedBtn = document.getElementById("savedBtn");
const savedModal = document.getElementById("savedModal");
const savedList = document.getElementById("savedList");
const savedEmpty = document.getElementById("savedEmpty");

savedBtn?.addEventListener("click", () => {
  renderSavedGallery();
  openModal(savedModal);
});

function renderSavedGallery() {
  const arr = savedReelsAll();
  savedList.innerHTML = "";
  if (!arr.length) { savedEmpty.classList.remove("hidden"); return; }
  savedEmpty.classList.add("hidden");
  arr.forEach((r) => {
    const card = document.createElement("div");
    card.className = "saved-item";
    card.style.background = `linear-gradient(135deg, ${r.accent_color || "#ff3b6b"} 0%, #1a1a3a 100%)`;
    card.innerHTML = `
      <div class="si-title">${escapeHtml(r.title || "Untitled")}</div>
      <div class="si-narr">${escapeHtml((r.narration || "").slice(0, 130))}${(r.narration || "").length > 130 ? "…" : ""}</div>
      <div class="si-meta">
        <span class="si-voice">🎙 ${escapeHtml(r.voice || "Aoede")}</span>
        <button class="si-remove" data-action="remove">Remove</button>
      </div>
    `;
    card.querySelector(".si-remove").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleReelSaved(r);
      renderSavedGallery();
      refreshStatsBadge();
    });
    card.addEventListener("click", () => {
      // Play this saved reel as a single-reel session
      currentDoc = { reels: [r], quiz: [] };
      currentReels = [r];
      currentQuiz = [];
      imageCache.clear(); imageInflight.clear();
      audioCache.clear(); audioInflight.clear();
      renderAll();
      closeModal(savedModal);
      showScreen("reels");
      ensureImage(0); ensureAudio(0);
      requestAnimationFrame(() => {
        const first = reelsContainer.firstElementChild;
        if (first) {
          first.scrollIntoView({ behavior: "instant", block: "start" });
          activateReel(first, 0);
        }
      });
    });
    savedList.appendChild(card);
  });
}

// Save button click handler (full-payload saved storage)
saveBtn.onclick = (e) => {
  e.stopPropagation();
  if (!currentReelEl || currentReelEl.dataset.kind === "quiz") return;
  const idx = Number(currentReelEl.dataset.idx);
  const reel = currentReels[idx];
  if (!reel) return;
  const nowSaved = toggleReelSaved(reel, { imageUrl: imageCache.get(idx) });
  saveBtn.classList.toggle("saved", nowSaved);
  saveBtn.classList.remove("popping");
  void saveBtn.offsetWidth;
  saveBtn.classList.add("popping");
  refreshStatsBadge();
  showToast(nowSaved ? "Saved ★" : "Removed");
  sfx(nowSaved ? "ding" : "boop"); haptic(10);
};

// =============================================================
//  Sound effects (Web Audio synth — no assets) + haptics + mascot
// =============================================================
let audioCtx = null;
function getAudioCtx() {
  if (audioCtx) return audioCtx;
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return null;
  audioCtx = new C();
  return audioCtx;
}
let sfxOn = (() => {
  try { const v = localStorage.getItem("reelify-sfx"); return v == null ? true : v === "1"; } catch { return true; }
})();
function setSfxOn(v) { sfxOn = !!v; try { localStorage.setItem("reelify-sfx", v ? "1" : "0"); } catch {} }

// Auto-resume audio context after first user gesture (browsers require this)
window.addEventListener("pointerdown", () => {
  const c = getAudioCtx();
  if (c?.state === "suspended") c.resume().catch(() => {});
}, { once: true, passive: true });

function tone({ freq = 440, type = "sine", dur = 0.18, vol = 0.12, attack = 0.005, release = 0.08, freqEnd = null, delay = 0 }) {
  if (!sfxOn) return;
  const ctx = getAudioCtx(); if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur + release);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + release + 0.05);
}
function noiseBurst({ dur = 0.08, vol = 0.06, hp = 1500, lp = 6000 } = {}) {
  if (!sfxOn) return;
  const ctx = getAudioCtx(); if (!ctx) return;
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const g = ctx.createGain(); g.gain.value = vol;
  const f1 = ctx.createBiquadFilter(); f1.type = "highpass"; f1.frequency.value = hp;
  const f2 = ctx.createBiquadFilter(); f2.type = "lowpass"; f2.frequency.value = lp;
  src.connect(f1).connect(f2).connect(g).connect(ctx.destination);
  src.start();
  src.stop(ctx.currentTime + dur + 0.05);
}

// Theme-specific sound profiles
const SFX = {
  default: {
    boop:    () => tone({ freq: 380, freqEnd: 280, dur: 0.07, vol: 0.07, type: "sine" }),
    ding:    () => { tone({ freq: 660, freqEnd: 880, dur: 0.12, vol: 0.10, type: "triangle" }); tone({ freq: 880, dur: 0.18, vol: 0.06, type: "triangle", delay: 0.05 }); },
    chime:   () => { [880, 1175, 1568].forEach((f, i) => tone({ freq: f, dur: 0.16, vol: 0.10, type: "triangle", delay: i * 0.06 })); },
    buzzer:  () => tone({ freq: 220, freqEnd: 110, dur: 0.28, vol: 0.08, type: "square" }),
    heart:   () => { tone({ freq: 600, freqEnd: 900, dur: 0.10, vol: 0.10, type: "sine" }); tone({ freq: 900, freqEnd: 1320, dur: 0.10, vol: 0.08, type: "sine", delay: 0.07 }); },
    fanfare: () => { [523, 659, 784, 1046, 1318].forEach((f, i) => tone({ freq: f, dur: 0.18, vol: 0.10, type: "triangle", delay: i * 0.08 })); },
  },
  editorial: {
    boop:    () => tone({ freq: 440, freqEnd: 330, dur: 0.10, vol: 0.06, type: "sine" }),
    ding:    () => { tone({ freq: 523, dur: 0.5, vol: 0.10, type: "triangle", release: 0.5 }); tone({ freq: 784, dur: 0.6, vol: 0.06, type: "triangle", delay: 0.05, release: 0.6 }); },
    chime:   () => { tone({ freq: 523, dur: 0.5, vol: 0.10, type: "triangle", release: 0.5 }); tone({ freq: 784, dur: 0.6, vol: 0.07, type: "triangle", delay: 0.08, release: 0.6 }); },
    buzzer:  () => tone({ freq: 196, freqEnd: 130, dur: 0.40, vol: 0.07, type: "sine" }),
    heart:   () => { tone({ freq: 523, freqEnd: 698, dur: 0.20, vol: 0.07, type: "sine", release: 0.3 }); },
    fanfare: () => { [392, 523, 659, 784].forEach((f, i) => tone({ freq: f, dur: 0.28, vol: 0.10, type: "triangle", delay: i * 0.10, release: 0.3 })); },
  },
  glass: {
    boop:    () => { tone({ freq: 1320, dur: 0.05, vol: 0.05, type: "sine" }); tone({ freq: 1980, dur: 0.06, vol: 0.04, type: "sine", delay: 0.02 }); },
    ding:    () => { [1320, 1760, 2349].forEach((f, i) => tone({ freq: f, dur: 0.30, vol: 0.06, type: "sine", delay: i * 0.04, release: 0.3 })); },
    chime:   () => { [1568, 2093, 2637].forEach((f, i) => tone({ freq: f, dur: 0.35, vol: 0.07, type: "sine", delay: i * 0.05, release: 0.4 })); },
    buzzer:  () => tone({ freq: 110, freqEnd: 55,  dur: 0.30, vol: 0.06, type: "triangle" }),
    heart:   () => { tone({ freq: 1175, freqEnd: 1568, dur: 0.10, vol: 0.06, type: "sine" }); tone({ freq: 1760, freqEnd: 2349, dur: 0.10, vol: 0.05, type: "sine", delay: 0.07 }); },
    fanfare: () => { [880, 1175, 1568, 2093, 2637].forEach((f, i) => tone({ freq: f, dur: 0.22, vol: 0.06, type: "sine", delay: i * 0.07, release: 0.3 })); },
  },
  riso: {
    boop:    () => { tone({ freq: 110, freqEnd: 60, dur: 0.04, vol: 0.10, type: "square" }); noiseBurst({ dur: 0.04, vol: 0.04 }); },
    ding:    () => { tone({ freq: 80, freqEnd: 50, dur: 0.06, vol: 0.16, type: "sine" }); noiseBurst({ dur: 0.05, vol: 0.06 }); },
    chime:   () => { tone({ freq: 200, freqEnd: 280, dur: 0.10, vol: 0.10, type: "triangle" }); tone({ freq: 280, freqEnd: 360, dur: 0.10, vol: 0.08, type: "triangle", delay: 0.06 }); },
    buzzer:  () => { tone({ freq: 80, freqEnd: 40, dur: 0.20, vol: 0.10, type: "sawtooth" }); },
    heart:   () => { tone({ freq: 200, freqEnd: 300, dur: 0.06, vol: 0.10, type: "square" }); tone({ freq: 280, freqEnd: 380, dur: 0.06, vol: 0.08, type: "square", delay: 0.05 }); },
    fanfare: () => { [196, 247, 294, 392].forEach((f, i) => tone({ freq: f, dur: 0.20, vol: 0.10, type: "triangle", delay: i * 0.08 })); noiseBurst({ dur: 0.10, vol: 0.05, hp: 800 }); },
  },
  pastel: {
    boop:    () => { tone({ freq: 880, freqEnd: 1175, dur: 0.08, vol: 0.08, type: "sine" }); },
    ding:    () => { tone({ freq: 880, dur: 0.15, vol: 0.10, type: "sine" }); tone({ freq: 1175, dur: 0.18, vol: 0.08, type: "sine", delay: 0.08 }); tone({ freq: 1568, dur: 0.20, vol: 0.06, type: "sine", delay: 0.16 }); },
    chime:   () => { tone({ freq: 1046, dur: 0.20, vol: 0.10, type: "sine" }); tone({ freq: 1318, dur: 0.20, vol: 0.08, type: "sine", delay: 0.10 }); tone({ freq: 1568, dur: 0.25, vol: 0.06, type: "sine", delay: 0.20 }); },
    buzzer:  () => { tone({ freq: 392, freqEnd: 261, dur: 0.20, vol: 0.06, type: "sine" }); },
    heart:   () => { tone({ freq: 880, freqEnd: 1568, dur: 0.10, vol: 0.10, type: "sine" }); tone({ freq: 1568, freqEnd: 2349, dur: 0.10, vol: 0.07, type: "sine", delay: 0.07 }); },
    fanfare: () => { [659, 784, 1046, 1318, 1568, 2093].forEach((f, i) => tone({ freq: f, dur: 0.18, vol: 0.09, type: "sine", delay: i * 0.07 })); },
  },
};
function sfx(action) {
  const t = settings.uiTheme || "default";
  const pack = SFX[t] || SFX.default;
  (pack[action] || SFX.default[action])?.();
}

// Haptics
function haptic(p) {
  try { navigator.vibrate?.(p); } catch {}
}

// =============================================================
//  Mascot state controller (only renders in pastel theme but
//  state changes regardless so it's ready when switched on)
// =============================================================
const mascotEl = document.getElementById("mascot");
let mascotResetTimer = null;
function setMascotState(state, autoReset = 1500) {
  if (!mascotEl) return;
  mascotEl.dataset.state = state;
  if (mascotResetTimer) { clearTimeout(mascotResetTimer); mascotResetTimer = null; }
  if (autoReset && state !== "idle") {
    mascotResetTimer = setTimeout(() => { mascotEl.dataset.state = "idle"; }, autoReset);
  }
}
setMascotState("idle", 0);

// Toast
const toastEl = document.getElementById("toast");
let toastTimer = null;
function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 1700);
}

// =============================================================
//  Subjects + Library + Settings (server-persistent)
// =============================================================
let currentChapterId = null; // set when playing a saved chapter, so asset URLs persist

async function fetchSubjects() {
  try {
    const r = await fetch("/api/subjects");
    const data = await r.json();
    return data.subjects || [];
  } catch { return []; }
}

async function createSubject({ title, emoji, color }) {
  const r = await fetch("/api/subjects", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, emoji, color }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Could not create subject");
  return data.subject;
}

async function fetchChapters(subjectId) {
  try {
    const r = await fetch(`/api/subjects/${encodeURIComponent(subjectId)}/chapters`);
    const data = await r.json();
    return data.chapters || [];
  } catch { return []; }
}

async function fetchChapter(chapterId) {
  const r = await fetch(`/api/chapters/${encodeURIComponent(chapterId)}`);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Chapter not found");
  return data.chapter;
}

async function deleteSubject(id) {
  await fetch(`/api/subjects/${encodeURIComponent(id)}`, { method: "DELETE" });
}
async function deleteChapter(id) {
  await fetch(`/api/chapters/${encodeURIComponent(id)}`, { method: "DELETE" });
}

async function postChapterAsset(chapterId, kind, reelIdx, url) {
  if (!chapterId) return;
  try {
    await fetch(`/api/chapters/${encodeURIComponent(chapterId)}/asset`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, reelIdx, url }),
    });
  } catch {}
}

// ----- Subject picker on the upload screen -----
const subjectChipsEl = document.getElementById("subjectChips");
const newSubjectInput = document.getElementById("newSubjectInput");
const chapterTitleInput = document.getElementById("chapterTitleInput");

async function refreshSubjectChips() {
  if (!subjectChipsEl) return;
  const subjects = await fetchSubjects();
  // Keep the first two static chips (Don't save, + New)
  subjectChipsEl.querySelectorAll(".cu-chip[data-server='1']").forEach((c) => c.remove());
  // Insert subject chips before the "+ New" chip
  const newBtn = subjectChipsEl.querySelector(".cu-new-subject");
  subjects.forEach((s) => {
    const btn = document.createElement("button");
    btn.className = "cu-chip";
    btn.dataset.val = s.id;
    btn.dataset.server = "1";
    btn.textContent = `${s.emoji || "📚"} ${s.title}`;
    subjectChipsEl.insertBefore(btn, newBtn);
  });
  applySubjectChipState();
}

function applySubjectChipState() {
  if (!subjectChipsEl) return;
  const val = settings.subject || "";
  subjectChipsEl.querySelectorAll(".cu-chip").forEach((c) => {
    c.classList.toggle("active", c.dataset.val === val);
  });
  // Show the new-subject input when "+ New subject" is the active selection
  if (newSubjectInput) {
    const showNew = val === "__new";
    newSubjectInput.classList.toggle("hidden", !showNew);
    if (showNew) setTimeout(() => newSubjectInput.focus(), 30);
  }
  // Show chapter-title input when a real subject is selected
  if (chapterTitleInput) {
    const showCh = !!val && val !== "__new";
    chapterTitleInput.classList.toggle("hidden", !showCh);
  }
}

subjectChipsEl?.addEventListener("click", (e) => {
  const chip = e.target.closest(".cu-chip");
  if (!chip) return;
  settings.subject = chip.dataset.val || "";
  saveSettings();
  applySubjectChipState();
});

refreshSubjectChips();

// ----- Library button + modal -----
const libraryBtn = document.getElementById("libraryBtn");
const libraryModal = document.getElementById("libraryModal");
const libraryList = document.getElementById("libraryList");
const libraryEmpty = document.getElementById("libraryEmpty");
const newSubjectBtn = document.getElementById("newSubjectBtn");
const newSubjectForm = document.getElementById("newSubjectForm");
const nsTitle = document.getElementById("nsTitle");
const nsEmoji = document.getElementById("nsEmoji");
const nsColor = document.getElementById("nsColor");
const nsCreate = document.getElementById("nsCreate");
const nsCancel = document.getElementById("nsCancel");

libraryBtn?.addEventListener("click", () => {
  renderLibrary();
  openModal(libraryModal);
});

newSubjectBtn?.addEventListener("click", () => {
  newSubjectForm.classList.remove("hidden");
  nsTitle.value = "";
  nsEmoji.value = "📚";
  setTimeout(() => nsTitle.focus(), 30);
});
nsCancel?.addEventListener("click", () => newSubjectForm.classList.add("hidden"));
nsCreate?.addEventListener("click", async () => {
  const title = nsTitle.value.trim();
  if (!title) return showToast("Subject name required");
  try {
    nsCreate.disabled = true;
    await createSubject({ title, emoji: (nsEmoji.value || "📚").slice(0, 3), color: nsColor.value });
    newSubjectForm.classList.add("hidden");
    await renderLibrary();
    refreshSubjectChips();
  } catch (e) { showToast(e.message || "Failed"); }
  finally { nsCreate.disabled = false; }
});

async function renderLibrary() {
  if (!libraryList) return;
  libraryList.innerHTML = "";
  const subjects = await fetchSubjects();
  if (!subjects.length) {
    libraryEmpty.classList.remove("hidden");
    return;
  }
  libraryEmpty.classList.add("hidden");
  for (const s of subjects) {
    const card = document.createElement("div");
    card.className = "subject-card";
    card.style.borderLeft = `4px solid ${s.color || "#6b8cff"}`;
    card.innerHTML = `
      <div class="sc-head">
        <div class="sc-title"><span class="sc-emoji">${escapeHtml(s.emoji || "📚")}</span> ${escapeHtml(s.title)}</div>
        <div class="sc-meta">
          <span>${s.chapterCount} chapter${s.chapterCount === 1 ? "" : "s"}</span>
          <button class="sc-add" title="Add chapter">＋</button>
          <button class="sc-del" title="Delete">×</button>
        </div>
      </div>
      <div class="sc-chapters"></div>
    `;
    const chaptersEl = card.querySelector(".sc-chapters");

    card.querySelector(".sc-del").addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (!confirm(`Delete "${s.title}" and all its chapters?`)) return;
      await deleteSubject(s.id);
      renderLibrary();
      refreshSubjectChips();
    });
    card.querySelector(".sc-add").addEventListener("click", (ev) => {
      ev.stopPropagation();
      settings.subject = s.id;
      saveSettings();
      applySubjectChipState();
      closeModal(libraryModal);
      showToast(`Upload your next chapter for ${s.title}`);
      document.getElementById("dropZone")?.click();
    });

    const chapters = await fetchChapters(s.id);
    if (!chapters.length) {
      const empty = document.createElement("div");
      empty.className = "sc-empty";
      empty.textContent = "No chapters yet. Click + to add one.";
      chaptersEl.appendChild(empty);
    } else {
      chapters.forEach((ch, i) => {
        const row = document.createElement("div");
        row.className = "ch-row";
        const d = new Date(ch.createdAt);
        row.innerHTML = `
          <div class="ch-num">${i + 1}</div>
          <div class="ch-body">
            <div class="ch-title">${escapeHtml(ch.title)}</div>
            <div class="ch-meta">${ch.reels.length} reels · ${ch.quiz.length} quiz Qs · ${d.toLocaleDateString()}</div>
          </div>
          <button class="ch-del" title="Delete chapter">×</button>
        `;
        row.addEventListener("click", () => playChapter(ch));
        row.querySelector(".ch-del").addEventListener("click", async (ev) => {
          ev.stopPropagation();
          if (!confirm(`Delete "${ch.title}"?`)) return;
          await deleteChapter(ch.id);
          renderLibrary();
        });
        chaptersEl.appendChild(row);
      });
    }
    libraryList.appendChild(card);
  }
}

function playChapter(chapter) {
  closeModal(libraryModal);
  currentDoc = chapter;
  currentReels = chapter.reels;
  currentQuiz = chapter.quiz || [];
  imageCache.clear(); imageInflight.clear();
  audioCache.clear(); audioInflight.clear();
  // Pre-populate caches from saved asset maps so we don't regenerate
  Object.entries(chapter.imageMap || {}).forEach(([k, v]) => imageCache.set(Number(k), v));
  Object.entries(chapter.audioMap || {}).forEach(([k, v]) => audioCache.set(Number(k), v));
  currentChapterId = chapter.id;

  renderAll();
  showScreen("reels");
  ensureImage(0); ensureAudio(0);
  if (currentReels.length > 1) { ensureImage(1); ensureAudio(1); }
  requestAnimationFrame(() => {
    const first = reelsContainer.firstElementChild;
    if (first) {
      first.scrollIntoView({ behavior: "instant", block: "start" });
      activateReel(first, 0);
    }
  });
}

// ----- Settings button + modal -----
document.getElementById("settingsBtn")?.addEventListener("click", () => {
  openModal(document.getElementById("settingsModal"));
});

function refreshActionsForReel(reelEl) {
  const isQuiz = reelEl.dataset.kind === "quiz";
  actionsEl.classList.toggle("hidden", isQuiz);
  if (isQuiz) return;

  const idx = Number(reelEl.dataset.idx);
  const reel = currentReels[idx];

  // Like count
  likeBtn.querySelector(".ra-count").textContent = formatCount(reelLikes[idx] || 0);
  likeBtn.classList.toggle("liked", (reelLikes[idx] || 0) > 0);

  // Saved state
  saveBtn.classList.toggle("saved", !!(reel && isReelSaved(reel)));
}
