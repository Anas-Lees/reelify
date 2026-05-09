// ==============================
// Reelify — frontend logic
// ==============================
const $ = (sel) => document.querySelector(sel);
const screens = {
  login: $("#login-screen"),
  upload: $("#upload-screen"),
  loading: $("#loading-screen"),
  error: $("#error-screen"),
  reels: $("#reels-screen"),
  library: $("#library-screen"),
};
function showScreen(name) {
  for (const k of Object.keys(screens)) screens[k].classList.toggle("active", k === name);
  // Bottom nav is only visible on the main app screens (not login/loading/reels/error)
  const showNav = (name === "upload" || name === "library");
  const nav = document.getElementById("bottomNav");
  if (nav) {
    nav.classList.toggle("hidden", !showNav);
    nav.querySelectorAll(".bn-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.target === name);
    });
  }
  // body class — older WebViews don't support CSS :has(), so we drive the
  // 'content has bottom nav above it' layout with a class instead.
  document.body.classList.toggle("nav-visible", showNav);
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

// ----- Auth state -----
let authToken = null;
let authUser = null;
try {
  const raw = localStorage.getItem("reelify-auth");
  if (raw) {
    const parsed = JSON.parse(raw);
    authToken = parsed.token || null;
    authUser  = parsed.user  || null;
  }
} catch {}
function persistAuth() {
  try {
    if (authToken) localStorage.setItem("reelify-auth", JSON.stringify({ token: authToken, user: authUser }));
    else           localStorage.removeItem("reelify-auth");
  } catch {}
}
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  // JSON stringify plain objects automatically
  if (options.body && !(options.body instanceof FormData) && typeof options.body !== "string" && typeof options.body !== "object") {
    // string or FormData — leave as-is
  } else if (options.body && typeof options.body === "object" && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401 && authToken) {
    // Token expired — kick to login
    authToken = null; authUser = null; persistAuth();
    showScreen("login");
  }
  return res;
}
let currentReels = [];
let currentQuiz = [];
let currentReelEl = null;
let currentAudio = null;
let imageCache = new Map();
let imageInflight = new Map();
let audioCache = new Map();
let audioInflight = new Map();
let activeRafId = null;
// Hoisted up here to avoid TDZ — these are read by code further up the file
// (ensureImage, observeReels) before their original initialization sites.
let currentChapterId = null;
let reelsObserver = null;

// ----- Settings & persistent UI state -----
const DEFAULT_SETTINGS = {
  vibe: "educational",
  imageStyle: "photo",
  length: "standard",
  pace: "normal",
  quizDifficulty: "medium",
  language: "en",
  voiceOverride: "auto",
  voiceB: "auto",       // second voice for podcast mode
  format: "solo",       // solo | podcast
  autoAdvance: "on",
  // App-wide UI settings
  appTheme: "dark",     // dark | light | auto (only applies when uiTheme = default)
  uiTheme: "default",   // default | editorial | glass | riso | pastel
  appLang: "en",        // UI language: en | ar
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

// ----- I18N (UI strings — EN + AR only) -----
const I18N = {
  en: {
    // Top bar / shell
    library: "Library", settings: "Settings", create: "Create", cancel: "Cancel", remove: "Remove",
    // Upload screen hero
    hero_title: "Drop a file. Get reels.",
    hero_sub: "PDF, Word, PowerPoint, images, text — the AI reads it and packs it into bite-size scrolling reels with AI visuals, voiceover and synced captions.",
    drop_text: "Tap or drop a file here",
    drop_size: "Up to 100 MB",
    generate: "Generate Reels",
    tip_main: "Tap to pause · double-tap to ❤ · scroll for next",
    tip_reels: "Tap edges to skip · double-tap to ❤ · scroll for next",
    // Customize panel labels
    label_vibe: "Vibe", label_look: "Look", label_length: "Length", label_pace: "Pace",
    label_quiz: "Quiz", label_language: "Narration language", label_voice: "Voice",
    label_auto_advance: "Auto-play next", label_save_to: "Save to subject",
    label_app_style: "App style", label_app_theme: "App theme", label_app_lang: "App language",
    // Vibe + custom
    vibe_educational: "⚡ Educational", vibe_fun: "🎉 Fun", vibe_dramatic: "🎭 Dramatic",
    vibe_chill: "🧘 Chill", vibe_genz: "🤓 Gen-Z", chip_custom: "✏ Custom",
    vibe_custom_ph: "e.g. Attack on Titan style — dramatic anime monologues",
    // Look
    look_photo: "📷 Photo", look_3d: "✨ 3D", look_watercolor: "🎨 Watercolor",
    look_anime: "🌸 Anime", look_neon: "🌃 Neon", look_vintage: "📜 Vintage", look_oil: "🖼 Oil",
    look_custom_ph: "e.g. Studio Ghibli style, hand-painted, soft warm light",
    // Length / Pace / Quiz
    length_short: "📌 Quick", length_standard: "📚 Standard", length_long: "🎬 Deep dive",
    pace_chill: "🐢 Chill", pace_normal: "🚶 Normal", pace_fast: "🏃 Fast",
    quiz_easy: "🌱 Easy", quiz_medium: "🌿 Medium", quiz_hard: "🌳 Hard",
    quiz_custom_ph: "e.g. Trick questions, focus on dates",
    lang_custom_ph: "e.g. Pirate English, Old English, Shakespearean",
    // Voice + auto-advance
    voice_auto: "🤖 AI picks",
    autoadvance_on: "▶ On", autoadvance_off: "⏸ Off",
    // App style
    style_default: "🌑 Default", style_editorial: "📰 Editorial",
    style_glass: "💎 Liquid Glass", style_riso: "📜 Risograph", style_pastel: "🌸 Soft Pastel",
    // App theme
    apptheme_dark: "🌙 Dark", apptheme_light: "☀ Light", apptheme_auto: "🎚 Auto",
    // Subject picker
    subj_dont_save: "🗑 Don't save", subj_new: "+ New subject",
    new_subject_short: "New subject",
    new_subject_placeholder: "Subject name (e.g. Biology)",
    chapter_title_placeholder: "Chapter title — optional",
    // Stats
    saved: "Saved", stats_reels: "reels watched", stats_perfect: "perfect",
    // Settings note
    settings_note: "App language only changes the interface — narration language is set per upload.",
    // Library
    library_empty: 'No subjects yet. Tap "+ New subject" to start a library.',
    chapters: "chapters", chapter: "chapter",
    no_chapters: "No chapters yet. Tap + to add one.",
    delete_subject_confirm: 'Delete "{title}" and all its chapters?',
    delete_chapter_confirm: 'Delete "{title}"?',
    upload_for_subject: "Upload your next chapter for {title}",
    // Saved gallery
    saved_reels: "Saved reels",
    saved_empty: "Tap ★ on any reel to save it here.",
    // Quiz
    quiz_title_card: "Quick Quiz", quiz_subtitle: "Test what you just learned",
    quiz_correct: "✓ Correct.", quiz_incorrect: "✗ Not quite.",
    quiz_next: "Next →", quiz_retry: "Try again", quiz_restart: "Upload new file",
    quiz_time: "Quiz time",
    score_perfect: "Perfect score! You absorbed it all.",
    score_great: "Great work — you really listened.",
    score_decent: "Not bad. A second pass will lock it in.",
    score_keep_going: "Solid effort. Re-watch the reels and try again.",
    streak_in_a_row: "in a row",
    // Ask AI
    ask_title: "Ask anything", ask_about: "About: {title}",
    ask_placeholder: "What do you want to know?",
    ask_button: "Ask", ask_thinking: "Thinking…",
    ask_no_answer: "(no answer)", ask_failed: "Sorry — couldn't get an answer.",
    // Loading
    loading_reading: "Reading your file…",
    loading_reading_sub: "The AI is finding the gold inside.",
    loading_grouping: "Grouping the ideas…",
    loading_grouping_sub: "Packing related bits into the same reel.",
    loading_writing: "Writing the scripts…",
    loading_writing_sub: "Punchy hooks, easy listening.",
    loading_voices: "Casting voices…",
    loading_voices_sub: "Each reel gets its own narrator.",
    loading_almost: "Almost there…",
    loading_almost_sub: "Cooking up the reel structure.",
    // Toasts
    toast_shared: "Shared",
    toast_copied: "Copied to clipboard",
    toast_share_failed: "Couldn't share",
    toast_copied_short: "Copied",
    toast_saved: "Saved ★",
    toast_removed: "Removed",
    toast_subject_required: "Subject name required",
    toast_subject_create_failed: "Could not create subject",
    // Errors
    err_title: "Something went wrong",
    err_unknown: "Unknown error",
    err_no_reels: "No reels were generated",
    err_upload_failed: "Upload failed",
    err_type_first: "Type a subject name first",
    // Format / podcast / surprise
    label_format: "Format",
    format_solo: "🎤 Solo",
    format_podcast: "🎙 Podcast (2 voices)",
    voice_a_suffix: " A",
    surprise_toast: "🎲 Random preset rolled",
    tap_to_start: "Tap to start",
    // Paste text
    nav_home: "Home",
    profile_name_ph: "Display name",
    profile_saved: "Profile saved",
    profile_avatar_too_big: "Image must be under 5 MB",
    profile_avatar_only_images: "Pick an image file",
    paste_text: "Or paste text instead",
    paste_text_title: "Paste your text",
    paste_text_sub: "Notes, an article, anything. The AI cleans it up and turns it into reels.",
    paste_placeholder: "Paste anything here — notes, an article, even rough thoughts. The AI fixes typos and structures it.",
    paste_submit: "Generate from text",
    paste_too_short: "Add a bit more text first",
    // Checkpoint
    checkpoint_label: "Quick check",
    // Auth
    auth_title: "Welcome to Edu Shorts",
    auth_sub: "Sign in to keep your library and saved reels synced across devices.",
    auth_email: "Email",
    auth_password: "Password (6+ chars)",
    auth_name: "Display name (optional)",
    auth_sign_in: "Sign in",
    auth_create: "Create account",
    auth_create_instead: "Create an account instead",
    auth_back_to_signin: "Already have an account? Sign in",
    auth_signing_in: "Signing in…",
    auth_creating: "Creating account…",
    // Library tabs
    tab_subjects: "Subjects",
    tab_saved: "Saved reels",
  },

  ar: {
    library: "المكتبة", settings: "الإعدادات", create: "إنشاء", cancel: "إلغاء", remove: "إزالة",

    hero_title: "أَفلِت ملفًا. واستلم ريلز.",
    hero_sub: "PDF أو Word أو PowerPoint أو صور أو نصوص — يقرأها الذكاء الاصطناعي ويحوّلها إلى ريلز عمودية بصور ذكية وتعليق صوتي ونصوص متزامنة.",
    drop_text: "انقر أو أَفلِت ملفًا هنا",
    drop_size: "حتى 100 ميجابايت",
    generate: "إنشاء الريلز",
    tip_main: "انقر للإيقاف · انقر مرتين لـ ❤ · مرّر للتالي",
    tip_reels: "انقر الحواف للتخطي · انقر مرتين لـ ❤ · مرّر للتالي",

    label_vibe: "الطابع", label_look: "المظهر", label_length: "الطول", label_pace: "السرعة",
    label_quiz: "الاختبار", label_language: "لغة الراوي", label_voice: "الصوت",
    label_auto_advance: "تشغيل تلقائي للتالي", label_save_to: "حفظ في موضوع",
    label_app_style: "نمط التطبيق", label_app_theme: "ثيم التطبيق", label_app_lang: "لغة التطبيق",

    vibe_educational: "⚡ تعليمي", vibe_fun: "🎉 ممتع", vibe_dramatic: "🎭 درامي",
    vibe_chill: "🧘 هادئ", vibe_genz: "🤓 جيل زد", chip_custom: "✏ مخصص",
    vibe_custom_ph: "مثلاً: بأسلوب Attack on Titan — مونولوجات أنيمي درامية",

    look_photo: "📷 صورة واقعية", look_3d: "✨ ثلاثي الأبعاد", look_watercolor: "🎨 ألوان مائية",
    look_anime: "🌸 أنمي", look_neon: "🌃 نيون", look_vintage: "📜 كلاسيكي", look_oil: "🖼 زيتي",
    look_custom_ph: "مثلاً: بأسلوب استوديو غيبلي — مرسوم يدويًا، إضاءة دافئة",

    length_short: "📌 سريع", length_standard: "📚 معتاد", length_long: "🎬 شامل",
    pace_chill: "🐢 بطيء", pace_normal: "🚶 عادي", pace_fast: "🏃 سريع",
    quiz_easy: "🌱 سهل", quiz_medium: "🌿 متوسط", quiz_hard: "🌳 صعب",
    quiz_custom_ph: "مثلاً: أسئلة خادعة، تركيز على التواريخ",
    lang_custom_ph: "مثلاً: لهجة قديمة، إنجليزية شكسبيرية",

    voice_auto: "🤖 يختار الذكاء",
    autoadvance_on: "▶ تشغيل", autoadvance_off: "⏸ إيقاف",

    style_default: "🌑 افتراضي", style_editorial: "📰 مجلة",
    style_glass: "💎 زجاج سائل", style_riso: "📜 طباعة ريسو", style_pastel: "🌸 باستيل ناعم",

    apptheme_dark: "🌙 داكن", apptheme_light: "☀ فاتح", apptheme_auto: "🎚 تلقائي",

    subj_dont_save: "🗑 لا تحفظ", subj_new: "+ موضوع جديد",
    new_subject_short: "موضوع جديد",
    new_subject_placeholder: "اسم الموضوع (مثلاً «الأحياء»)",
    chapter_title_placeholder: "عنوان الفصل — اختياري",

    saved: "محفوظ", stats_reels: "ريلز شُوهدت", stats_perfect: "إجابات كاملة",

    settings_note: "لغة التطبيق تغيّر الواجهة فقط — لغة الراوي تُختار عند الرفع.",

    library_empty: "لا توجد مواضيع بعد. انقر «+ موضوع جديد» للبدء.",
    chapters: "فصول", chapter: "فصل",
    no_chapters: "لا توجد فصول بعد. انقر + لإضافة واحد.",
    delete_subject_confirm: "حذف «{title}» وجميع فصوله؟",
    delete_chapter_confirm: "حذف «{title}»؟",
    upload_for_subject: "ارفع فصلك التالي إلى {title}",

    saved_reels: "الريلز المحفوظة",
    saved_empty: "انقر ★ على أي ريل لحفظه هنا.",

    quiz_title_card: "اختبار سريع", quiz_subtitle: "اختبر ما تعلمته للتو",
    quiz_correct: "✓ صحيح.", quiz_incorrect: "✗ ليس تماماً.",
    quiz_next: "التالي ←", quiz_retry: "حاول مجدداً", quiz_restart: "ارفع ملفاً جديداً",
    quiz_time: "وقت الاختبار",
    score_perfect: "علامة كاملة! استوعبت كل شيء.",
    score_great: "عمل رائع — أنصت جيدًا.",
    score_decent: "ليس سيئاً. مرور ثانٍ يرسّخها.",
    score_keep_going: "محاولة جيدة. أعد مشاهدة الريلز وحاول مجدداً.",
    streak_in_a_row: "متتالية",

    ask_title: "اسأل أي شيء", ask_about: "بشأن: {title}",
    ask_placeholder: "ماذا تريد أن تعرف؟",
    ask_button: "اسأل", ask_thinking: "أفكر…",
    ask_no_answer: "(لا يوجد جواب)", ask_failed: "آسف — لم أحصل على جواب.",

    loading_reading: "أقرأ ملفك…",
    loading_reading_sub: "الذكاء الاصطناعي يبحث عن الذهب بالداخل.",
    loading_grouping: "أجمع الأفكار…",
    loading_grouping_sub: "أحزم القطع المرتبطة في ريل واحد.",
    loading_writing: "أكتب النصوص…",
    loading_writing_sub: "افتتاحيات قوية، استماع مريح.",
    loading_voices: "أختار الأصوات…",
    loading_voices_sub: "كل ريل يحصل على راوٍ خاص.",
    loading_almost: "اقتربنا…",
    loading_almost_sub: "أُعدّ بنية الريلز.",

    toast_shared: "تمت المشاركة",
    toast_copied: "نُسخ إلى الحافظة",
    toast_share_failed: "تعذّرت المشاركة",
    toast_copied_short: "نُسخ",
    toast_saved: "محفوظ ★",
    toast_removed: "أُزيل",
    toast_subject_required: "اسم الموضوع مطلوب",
    toast_subject_create_failed: "تعذّر إنشاء الموضوع",

    err_title: "حدث خطأ ما",
    err_unknown: "خطأ غير معروف",
    err_no_reels: "لم يتم إنشاء ريلز",
    err_upload_failed: "فشل الرفع",
    err_type_first: "اكتب اسم الموضوع أولاً",
    // Format / podcast / surprise
    label_format: "الصيغة",
    format_solo: "🎤 صوت واحد",
    format_podcast: "🎙 بودكاست (صوتان)",
    voice_a_suffix: " أ",
    surprise_toast: "🎲 إعدادات عشوائية",
    tap_to_start: "انقر للبدء",
    nav_home: "الرئيسية",
    profile_name_ph: "الاسم الظاهر",
    profile_saved: "تم حفظ الملف الشخصي",
    profile_avatar_too_big: "يجب أن تكون الصورة أقل من 5 ميجابايت",
    profile_avatar_only_images: "اختر ملف صورة",
    paste_text: "أو ألصق نصاً بدلاً من ذلك",
    paste_text_title: "ألصق نصك",
    paste_text_sub: "ملاحظات، مقال، أي شيء. الذكاء يصححه ويحوّله إلى ريلز.",
    paste_placeholder: "ألصق أي شيء هنا — ملاحظات، مقال، حتى أفكار غير منظمة. الذكاء يصلح الأخطاء وينظمها.",
    paste_submit: "أنشئ من النص",
    paste_too_short: "أضف مزيداً من النص أولاً",
    checkpoint_label: "تحقّق سريع",
    auth_title: "مرحباً بك في Edu Shorts",
    auth_sub: "سجّل دخول لحفظ مكتبتك وريلزاتك ومزامنتها عبر الأجهزة.",
    auth_email: "البريد الإلكتروني",
    auth_password: "كلمة المرور (٦ أحرف على الأقل)",
    auth_name: "الاسم الظاهر (اختياري)",
    auth_sign_in: "تسجيل الدخول",
    auth_create: "إنشاء حساب",
    auth_create_instead: "إنشاء حساب بدلاً من ذلك",
    auth_back_to_signin: "لديك حساب؟ سجّل دخول",
    auth_signing_in: "جارٍ تسجيل الدخول…",
    auth_creating: "جارٍ إنشاء الحساب…",
    tab_subjects: "المواضيع",
    tab_saved: "الريلز المحفوظة",
  },
};

function t(key, vars) {
  const dict = I18N[settings.appLang] || I18N.en;
  let s = dict[key] ?? I18N.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), v);
    }
  }
  return s;
}

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
  // Re-translate any dynamically-created labels (play-icon-label, etc.)
  document.querySelectorAll(".play-icon-label").forEach((el) => {
    el.textContent = t("tap_to_start");
  });
  document.documentElement.lang = lang;
  document.documentElement.dir = (lang === "ar") ? "rtl" : "ltr";
  document.body.dataset.appLang = lang;
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
let reelLikes = {}; // slot idx -> boolean (liked or not)

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

function applyFormat(f) {
  document.body.dataset.format = f || "solo";
}
applyFormat(settings.format);

document.querySelectorAll(".cu-chips").forEach((group) => {
  group.addEventListener("click", (e) => {
    const chip = e.target.closest(".cu-chip");
    if (!chip) return;
    const name = group.dataset.name;
    const val = chip.dataset.val;
    settings[name] = val;
    if (name === "pace") speedIdx = PACE_TO_SPEED_IDX[val] ?? 1;
    if (name === "appTheme") applyAppTheme(val);
    if (name === "uiTheme") applyUiTheme(val);
    if (name === "appLang") applyAppLang(val);
    if (name === "format") applyFormat(val);
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

generateBtn.addEventListener("click", () => { unlockAudio(); generate(); });
retryBtn.addEventListener("click", () => showScreen("upload"));
closeReelsBtn.addEventListener("click", closeReels);

// ----- Generate -----
async function generate() {
  if (!selectedFile) return;
  setMascotState("thinking", 0); // stays thinking while we work
  showScreen("loading");
  loadingTitle.textContent = t("loading_reading");
  loadingSub.textContent = t("loading_reading_sub");

  const phraseKeys = [
    ["loading_reading", "loading_reading_sub"],
    ["loading_grouping", "loading_grouping_sub"],
    ["loading_writing", "loading_writing_sub"],
    ["loading_voices", "loading_voices_sub"],
    ["loading_almost", "loading_almost_sub"],
  ];
  let i = 0;
  const loadingInterval = setInterval(() => {
    i = (i + 1) % phraseKeys.length;
    loadingTitle.textContent = t(phraseKeys[i][0]);
    loadingSub.textContent  = t(phraseKeys[i][1]);
  }, 2400);

  // Try streaming first — first reel plays while the rest are still being
  // generated. Fall back to /api/upload if anything goes sideways.
  try {
    await generateStreaming(loadingInterval);
    return;
  } catch (streamErr) {
    console.warn("Streaming failed, falling back to /api/upload:", streamErr);
    // continue into the non-streaming code below
  }

  try {
    // Resolve subject: handle "+ New subject" inline-create here
    let subjectId = settings.subject || "";
    if (subjectId === "__new") {
      const name = (newSubjectInput?.value || "").trim();
      if (!name) {
        clearInterval(loadingInterval);
        showScreen("upload");
        showToast(t("err_type_first"));
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
        showToast(e.message || t("toast_subject_create_failed"));
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
    fd.append("format", settings.format || "solo");
    if (subjectId) fd.append("subjectId", subjectId);
    if (chapterTitle) fd.append("chapterTitle", chapterTitle);

    const res = await api("/api/upload", { method: "POST", body: fd });
    const data = await res.json();
    clearInterval(loadingInterval);

    if (!res.ok) throw new Error(data.error || t("err_upload_failed"));
    if (!data.reels?.length) throw new Error(t("err_no_reels"));

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
    // Pre-warm every reel's assets in the background (2 concurrent workers) so
    // the user never waits when scrolling — even on a 30-reel doc.
    if (typeof backgroundFillAllAssets === "function") setTimeout(backgroundFillAllAssets, 600);

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
    setMascotState("sad", 1500);
    // 401: api() already redirected to login — don't show the error screen on top.
    const msg = e?.message || "";
    if (msg === "auth_required" || /HTTP 401|Sign in required/i.test(msg) || /401/.test(msg)) {
      // Stay on login screen; api() handled it.
      return;
    }
    errorText.textContent = msg || t("err_unknown");
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

  // Build slide sequence: each reel + its optional checkpoint inserted right after,
  // and the final aggregate quiz at the end.
  const sequence = [];
  currentReels.forEach((reel, idx) => {
    sequence.push({ kind: "reel", reelIdx: idx });
    if (reel.checkpoint && reel.checkpoint.question && Array.isArray(reel.checkpoint.options)) {
      sequence.push({ kind: "checkpoint", reelIdx: idx });
    }
  });
  if (currentQuiz.length) sequence.push({ kind: "quiz" });
  const total = sequence.length;

  sequence.forEach((slot, slotIdx) => {
    if (slot.kind === "reel") {
      const el = buildReel(currentReels[slot.reelIdx], slotIdx, total);
      el.dataset.reelIdx = String(slot.reelIdx); // slot != internal when checkpoints are present
      reelsContainer.appendChild(el);
    } else if (slot.kind === "checkpoint") {
      reelsContainer.appendChild(buildCheckpointReel(currentReels[slot.reelIdx].checkpoint, slotIdx, total));
    } else if (slot.kind === "quiz") {
      reelsContainer.appendChild(buildQuizReel(slotIdx, total));
    }
  });

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
  // Pretty animated loader — aurora blobs + a small "generating" pill.
  // Lives inside the bg so it disappears the moment we apply the real
  // image (we stamp `bg.style.background = "none"` and add `.img-loaded`).
  bg.innerHTML = `
    <div class="bg-aurora bg-aurora-1"></div>
    <div class="bg-aurora bg-aurora-2"></div>
    <div class="bg-aurora bg-aurora-3"></div>
    <div class="bg-shimmer"></div>
    <div class="bg-pill" aria-hidden="true">
      <span class="bg-pill-dot"></span>
      <span class="bg-pill-dot"></span>
      <span class="bg-pill-dot"></span>
      <span class="bg-pill-text">Painting</span>
    </div>
  `;

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
    `<span class="rm-right">${idx + 1} <span class="rm-sep">/</span> ${total}</span>`;
  top.append(progress, meta);

  const content = document.createElement("div");
  content.className = "reel-content";

  const titleWrap = document.createElement("div");
  titleWrap.className = "reel-title-wrap";
  const titleEl = document.createElement("h2");
  titleEl.className = "reel-title";
  titleEl.textContent = reel.title || "";
  titleWrap.appendChild(titleEl);

  // Optional card (math / code / quote / definition / list)
  // Long-press to drag, × to dismiss.
  let cardEl = null;
  if (reel.card && reel.card.type && reel.card.content) {
    reelEl.classList.add("has-card");
    cardEl = document.createElement("div");
    cardEl.className = `reel-card reel-card-${reel.card.type}`;
    cardEl.dataset.noTap = "1"; // don't trigger reel tap zones when interacting with the card

    const closeBtn = document.createElement("button");
    closeBtn.className = "reel-card-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      cardEl.classList.add("dismissed");
      setTimeout(() => cardEl.remove(), 240);
      sfx("boop"); haptic(8);
    });
    cardEl.appendChild(closeBtn);

    if (reel.card.title) {
      const cardTitle = document.createElement("div");
      cardTitle.className = "reel-card-title";
      cardTitle.textContent = reel.card.title;
      cardEl.appendChild(cardTitle);
    }
    if (reel.card.type === "code" && reel.card.language) {
      const lang = document.createElement("div");
      lang.className = "reel-card-lang";
      lang.textContent = reel.card.language;
      cardEl.appendChild(lang);
    }
    const cardBody = document.createElement("pre");
    cardBody.className = "reel-card-body";
    cardBody.textContent = String(reel.card.content).slice(0, 600);
    cardEl.appendChild(cardBody);

    makeCardDraggable(cardEl);
  }

  const captionStage = document.createElement("div");
  captionStage.className = "reel-caption-stage";
  captionStage.dataset.noTap = "1"; // long-press → drag, never the reel tap zone
  captionStage.innerHTML = renderChunkedCaption(reel.narration || "");

  // Captions are long-press draggable too — same gesture as the note
  // card. Lets the user park the caption wherever they want on screen.
  makeDraggable(captionStage, { longPressMs: 260 });

  if (cardEl) content.append(titleWrap, cardEl, captionStage);
  else        content.append(titleWrap, captionStage);

  const playIcon = document.createElement("div");
  playIcon.className = "play-icon";
  const playLabel = document.createElement("span");
  playLabel.className = "play-icon-label";
  playLabel.textContent = t("tap_to_start");
  playIcon.appendChild(playLabel);

  const audioLoading = document.createElement("div");
  audioLoading.className = "audio-loading";
  audioLoading.innerHTML = `<div class="al-bars"><span></span><span></span><span></span></div><span class="al-text">Loading voiceover…</span>`;

  // No gate — the reel becomes interactive immediately. Image fades in when
  // ready, audio starts when ready, with a tiny corner badge while voice
  // loads (`.audio-loading`). Instagram-style: never block the surface.
  reelEl.append(bg, overlay, top, content, playIcon, audioLoading);

  attachTapHandlers(reelEl);

  return reelEl;
}

function buildCheckpointReel(checkpoint, idx, total) {
  const reelEl = document.createElement("div");
  reelEl.className = "reel checkpoint-reel";
  reelEl.dataset.idx = String(idx);
  reelEl.dataset.kind = "checkpoint";
  reelEl.style.setProperty("--accent-glow", "rgba(255, 200, 100, 0.7)");

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
  meta.innerHTML = `<span>${escapeHtml(t("checkpoint_label"))}</span><span>Edu Shorts</span>`;
  top.append(progress, meta);

  const wrap = document.createElement("div");
  wrap.className = "checkpoint-wrap";
  const labels = ["A", "B", "C", "D", "E"];
  const optsHtml = checkpoint.options
    .map((opt, i) => `
      <button class="quiz-option cp-option" data-i="${i}">
        <span class="qo-label">${labels[i] || ""}</span>
        <span class="qo-text">${escapeHtml(opt)}</span>
      </button>`)
    .join("");

  wrap.innerHTML = `
    <div class="checkpoint-card">
      <div class="cp-tag">⚡ ${escapeHtml(t("checkpoint_label"))}</div>
      <h3 class="quiz-question">${escapeHtml(checkpoint.question)}</h3>
      <div class="quiz-options cp-options">${optsHtml}</div>
      <div class="quiz-feedback hidden cp-feedback"></div>
      <button class="quiz-next cp-next hidden">${escapeHtml(t("quiz_next"))}</button>
    </div>
  `;

  reelEl.append(bg, overlay, top, wrap);

  let answered = false;
  wrap.querySelector(".cp-options").addEventListener("click", (e) => {
    if (answered) return;
    const btn = e.target.closest(".cp-option");
    if (!btn) return;
    answered = true;
    const choice = Number(btn.dataset.i);
    const correct = checkpoint.correct_index;
    wrap.querySelectorAll(".cp-option").forEach((b, i) => {
      b.disabled = true;
      if (i === correct) b.classList.add("correct");
      if (i === choice && choice !== correct) b.classList.add("incorrect");
    });
    const fb = wrap.querySelector(".cp-feedback");
    fb.classList.remove("hidden");
    fb.classList.toggle("ok",  choice === correct);
    fb.classList.toggle("bad", choice !== correct);
    fb.innerHTML = (choice === correct ? t("quiz_correct") + " " : t("quiz_incorrect") + " ") + escapeHtml(checkpoint.explanation || "");
    wrap.querySelector(".cp-next").classList.remove("hidden");
    if (choice === correct) {
      sfx("chime"); haptic([10, 50, 10]); setMascotState("happy", 1500);
      spawnSparkles(reelEl);
    } else {
      sfx("buzzer"); haptic(80); setMascotState("sad", 1500);
    }
  });
  wrap.querySelector(".cp-next").addEventListener("click", () => {
    const next = reelEl.nextElementSibling;
    if (next) next.scrollIntoView({ behavior: "smooth", block: "start" });
  });

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
  meta.innerHTML = `<span>${escapeHtml(t("quiz_time"))}</span><span>Edu Shorts</span>`;
  top.append(progress, meta);

  const quizWrap = document.createElement("div");
  quizWrap.className = "quiz-wrap";
  quizWrap.innerHTML = `
    <div class="quiz-stage">
      <div class="quiz-header">
        <h2 class="quiz-title">${escapeHtml(t("quiz_title_card"))}</h2>
        <p class="quiz-sub">${escapeHtml(t("quiz_subtitle"))}</p>
      </div>
      <div class="quiz-card">
        <div class="quiz-meta-row">
          <div class="quiz-meta"><span class="qm-step">1</span> / <span class="qm-total">${currentQuiz.length}</span></div>
          <div class="streak-pill hidden"><span class="sp-flame">🔥</span><span class="sp-num">2</span></div>
        </div>
        <h3 class="quiz-question"></h3>
        <div class="quiz-options"></div>
        <div class="quiz-feedback hidden"></div>
        <button class="quiz-next hidden">${escapeHtml(t("quiz_next"))}</button>
      </div>
    </div>
    <div class="quiz-score hidden">
      <div class="score-emoji">🎉</div>
      <h2 class="score-num"></h2>
      <p class="score-msg"></p>
      <div class="score-actions">
        <button class="quiz-retry">${escapeHtml(t("quiz_retry"))}</button>
        <button class="quiz-restart">${escapeHtml(t("quiz_restart"))}</button>
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

function stripPodcastTags(text) {
  return (text || "").replace(/\[[AB]\]\s*:?\s*/g, "").replace(/\s+/g, " ").trim();
}

function renderChunkedCaption(text) {
  const cleaned = stripPodcastTags(text);
  const chunks = buildChunks(cleaned);
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

// Long-press to drag a reel card. After ~250ms hold the card enters drag mode
// and follows the finger; release stops dragging and the card stays where you
// dropped it for the rest of the session.
// Generic long-press-to-drag helper. Used by reel cards AND by the
// caption stage. Pointer-up/move are listened on the *document* (not
// the element) so the drag continues even when the finger moves off
// the element — fixes "the note only moves a little".
function makeDraggable(el, opts = {}) {
  const longPressMs = opts.longPressMs ?? 220;
  const ignoreSelector = opts.ignoreSelector || null;
  let pressTimer = null;
  let dragMode = false;
  let startX = 0, startY = 0;
  let baseX = 0, baseY = 0;
  let activePointerId = null;

  function readTranslate() {
    const m = (el.style.transform || "").match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    return { x: m ? parseFloat(m[1]) : 0, y: m ? parseFloat(m[2]) : 0 };
  }
  function setTranslate(x, y) {
    el.style.transform = `translate(${x}px, ${y}px)`;
  }
  function bindMoveUp() {
    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }
  function unbindMoveUp() {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);
  }
  // Cache the original touchAction so we can restore it after drag.
  const originalTouchAction = el.style.touchAction || "";
  function onDown(e) {
    if (ignoreSelector && e.target.closest && e.target.closest(ignoreSelector)) return;
    activePointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    const t = readTranslate();
    baseX = t.x; baseY = t.y;
    pressTimer = setTimeout(() => {
      pressTimer = null;
      dragMode = true;
      // Critical for Android: tell the browser this element will NOT
      // scroll on touch. Without this, Chromium WebView's compositor
      // takes over the touch as a pan and our pointermove events get
      // cancelled mid-drag — that was "drag stops after a few px".
      el.style.touchAction = "none";
      el.classList.add("dragging");
      try { el.setPointerCapture?.(activePointerId); } catch (_) {}
      try { navigator.vibrate?.(18); } catch (_) {}
    }, longPressMs);
    bindMoveUp();
  }
  function onMove(e) {
    if (!dragMode) {
      // If the user moves significantly before long-press fires, treat it
      // as a normal swipe — cancel the drag attempt entirely so the reel
      // can scroll/swipe past it.
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.hypot(dx, dy) > 12) {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
        unbindMoveUp();
      }
      return;
    }
    // Active drag — block the browser's default pan and translate the el.
    if (e.cancelable) e.preventDefault();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    setTranslate(baseX + dx, baseY + dy);
  }
  function onUp() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    if (dragMode) {
      dragMode = false;
      el.classList.remove("dragging");
      el.style.touchAction = originalTouchAction;
      try { el.releasePointerCapture?.(activePointerId); } catch (_) {}
    }
    activePointerId = null;
    unbindMoveUp();
  }
  // touch-action: manipulation lets normal taps + the surrounding reel
  // swipe-scroll work. We only flip to "none" once long-press fires.
  if (!el.style.touchAction) el.style.touchAction = "manipulation";
  el.addEventListener("pointerdown", onDown);
}

function makeCardDraggable(cardEl) {
  makeDraggable(cardEl, { longPressMs: 220, ignoreSelector: ".reel-card-close" });
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
  // Streaming path defines ensureReelsObserver — reuse it if available so we
  // don't spawn a fresh observer per render. Fallback to a one-shot observer.
  if (typeof ensureReelsObserver === "function") {
    ensureReelsObserver();
    reelsContainer.querySelectorAll(".reel").forEach((r) => reelsObserver.observe(r));
    return;
  }
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

  // Update progress bars (slot-based)
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
  if (reelEl.dataset.kind === "checkpoint") {
    // Checkpoint interludes are silent — no TTS, no image, just the question card
    return;
  }

  // For asset prefetch + speakReel we need the REEL INTERNAL index (the
  // position inside currentReels), which differs from the slot index when
  // checkpoints are interleaved.
  const reelIdx = Number(reelEl.dataset.reelIdx ?? idx);

  // Used downstream where we still need the slot idx for progress bars
  const slotIdx = idx;

  // ----- Non-blocking activation (Instagram style) -----
  // The reel UI is interactive immediately. Image fades in once it loads.
  // speakReel manages its own audio loading and falls back to the device
  // voice after 3.5 s if the AI voice isn't ready yet.

  // Image: paint the moment we have a URL. If a URL is already cached and
  // applied, this is a no-op (dataset.imgPainted is set after first paint).
  paintReelImage(reelEl, reelIdx);

  // Audio: trigger speakReel ONCE — either when ensureAudio resolves (so
  // audioCache is populated and speakReel takes the synchronous path
  // straight to audio.play()), or after a 3.5s safety timeout that lets
  // speakReel's internal fallback bridge to the device voice if AI TTS
  // is taking too long. This is the OLD-but-working pattern: keeping
  // audio.play() close in time to the audio fetch resolution preserves
  // Chromium WebView's autoplay-grace window granted by the Generate
  // button click.
  let speakStarted = false;
  function startSpeak(why) {
    if (speakStarted) return;
    if (currentReelEl !== reelEl) return; // user already scrolled away
    speakStarted = true;
    audioDbg("startSpeak idx=" + reelIdx + " via=" + why);
    speakReel(reelEl, reelIdx);
  }
  ensureAudio(reelIdx).finally(() => startSpeak("ensureAudio.finally"));
  setTimeout(() => startSpeak("3.5s timeout"), 3500);

  // Forward prefetch: image is cheap (kick off 3 ahead), audio is rate-
  // limited so we only nudge the next ONE — the background worker pool
  // serializes the rest. Running 4 TTS requests in parallel was burning
  // through the Gemini TTS 10/min quota and starving the very first reel.
  for (let i = reelIdx + 1; i <= reelIdx + 3; i++) {
    if (i < currentReels.length) ensureImage(i);
  }
  if (reelIdx + 1 < currentReels.length) ensureAudio(reelIdx + 1);
  if (reelIdx - 1 >= 0) ensureImage(reelIdx - 1);
}

// Paint a reel's background image when the URL is ready. Skips work if the
// reel was already painted with the same URL (so re-activation is instant).
function paintReelImage(reelEl, reelIdx) {
  const bg = reelEl.querySelector(".reel-bg");
  if (!bg) return;

  // Apply a URL straight to the bg element. Browser begins fetching as
  // soon as we set background-image, so no hidden <img> probe is needed
  // to "wait" before painting — the browser handles paint-on-arrive.
  function apply(url) {
    if (!url || !reelEl.isConnected) return;
    if (reelEl.dataset.imgPainted === url) return; // already showing this URL
    reelEl.dataset.imgPainted = url;
    bg.style.background = "none";
    bg.style.backgroundImage = `url("${url}")`;
    bg.style.backgroundSize = "cover";
    bg.style.backgroundPosition = "center center";
    bg.style.backgroundRepeat = "no-repeat";
    bg.classList.remove("placeholder");
    bg.classList.remove("img-loaded");
    void bg.offsetWidth;
    bg.classList.add("img-loaded");
  }

  // Fast path — cached URL paints synchronously, no spinner, no flicker.
  if (imageCache.has(reelIdx)) {
    apply(imageCache.get(reelIdx));
    return;
  }

  // Slow path — kick off generation if not already in flight; paint when
  // the URL is back. We DO NOT check currentReelEl !== reelEl here:
  // even if the user has scrolled away, painting the bg now means when
  // they scroll back the image is already there. We also DO NOT wait
  // for a hidden <img> preload — that was making the first reel feel
  // slow. The browser starts fetching the moment we set background-image.
  ensureImage(reelIdx).then((url) => {
    if (!url) return;
    apply(url);

    // Background 404 self-heal — runs in parallel with the browser's
    // own paint. If the URL 404s (saved-reel bytes wiped after redeploy),
    // we drop the cache and regenerate once. The placeholder is shown
    // again briefly while the fresh URL loads.
    const probe = new Image();
    probe.onerror = () => {
      if (reelEl.dataset.imgRetried === "1") return;
      reelEl.dataset.imgRetried = "1";
      imageCache.delete(reelIdx);
      imageInflight.delete(reelIdx);
      delete reelEl.dataset.imgPainted;
      bg.classList.add("placeholder");
      ensureImage(reelIdx).then((freshUrl) => {
        if (freshUrl && reelEl.isConnected) apply(freshUrl);
      });
    };
    probe.src = url;
  });
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
    reelEl.classList.remove("needs-tap");
  } else {
    currentAudio.pause();
    reelEl.classList.add("paused");
  }
}

// AbortController used to remove every event listener attached to the
// current Audio in one shot when we move to a different reel. Without
// this, listeners on the previous audio (ended, pause, play, error)
// keep firing callbacks against the now-active reel — that was the
// "voice breaks after scrolling" bug.
let _audioAbort = null;
function stopAudio() {
  if (_audioAbort) {
    try { _audioAbort.abort(); } catch {}
    _audioAbort = null;
  }
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

  audioDbg("speakReel " + idx + " start, cached=" + audioCache.has(idx));

  reelEl.classList.add("loading-audio");
  // Wait at most ~3.5s for the AI voice. If it's not ready by then, start with
  // the device voice immediately — the user shouldn't sit in silence while
  // Gemini takes 5–10s per call. Background generation keeps running, so the
  // NEXT reel is almost always ready with the AI voice.
  let audioUrl = null;
  if (audioCache.has(idx)) {
    audioUrl = audioCache.get(idx);
  } else {
    const fetchPromise = ensureAudio(idx); // kicks off generation if not already
    audioUrl = await Promise.race([
      fetchPromise,
      new Promise((r) => setTimeout(() => r(null), 3500)),
    ]);
  }
  reelEl.classList.remove("loading-audio");
  if (currentReelEl !== reelEl) { audioDbg("speakReel " + idx + " bail (reel changed)"); return; }
  if (!audioUrl) {
    audioDbg("speakReel " + idx + " no URL, device voice");
    return browserSpeakReel(reelEl, idx, chunkEls);
  }
  audioDbg("speakReel " + idx + " got URL, starting Audio");

  // Create a fresh Audio per reel. This is the OLD-and-working pattern:
  // when speakReel is invoked from the .finally() of ensureAudio (or a
  // short setTimeout fallback), `new Audio(url).play()` benefits from
  // Chromium WebView's autoplay-grace window because the network
  // completion is recent and the page has already had a real user gesture
  // (the Generate button click).
  const audio = new Audio(audioUrl);
  // AbortController for THIS audio's listeners. stopAudio() aborts it
  // before the next speakReel() runs, so old reels can't fire stale
  // callbacks against the active reel after a scroll.
  if (_audioAbort) { try { _audioAbort.abort(); } catch {} }
  _audioAbort = new AbortController();
  const _abortSignal = _audioAbort.signal;
  audio.preload = "auto";
  audio.playbackRate = SPEEDS[speedIdx];
  audio.muted = isMuted;
  audio.volume = 1;
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
  else audio.addEventListener("loadedmetadata", buildTiming, { once: true, signal: _abortSignal });

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
    // Guard: if we're not the active audio anymore (user scrolled away),
    // do nothing — the previous reel's "ended" must not autoadvance the
    // current one.
    if (currentAudio !== audio) return;
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
      if (currentAudio === audio && currentReelEl === reelEl && settings.autoAdvance !== "off") {
        const next = reelEl.nextElementSibling;
        if (next) next.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 700);
  }, { signal: _abortSignal });

  audio.addEventListener("pause", () => {
    if (currentAudio !== audio) return;
    if (currentReelEl === reelEl && !audio.ended) reelEl.classList.add("paused");
  }, { signal: _abortSignal });
  audio.addEventListener("play", () => {
    if (currentAudio !== audio) return;
    if (currentReelEl !== reelEl) return;
    reelEl.classList.remove("paused");
    reelEl.classList.remove("needs-tap");
    if (!activeRafId) tick();
  }, { signal: _abortSignal });

  // If the audio file 404s, the codec isn't supported, or anything else makes
  // the <audio> element fail, silently switch to the device voice.
  let fellBack = false;
  function fallbackToBrowserVoice(why) {
    if (fellBack) return;
    fellBack = true;
    if (currentAudio === audio) currentAudio = null;
    if (activeRafId) { cancelAnimationFrame(activeRafId); activeRafId = null; }
    try { audio.pause(); } catch {}
    audioCache.delete(idx);
    audioInflight.delete(idx);
    if (currentReelEl === reelEl) {
      console.warn("[audio] falling back to device voice:", why);
      browserSpeakReel(reelEl, idx, chunkEls);
    }
  }
  audio.addEventListener("error", () => {
    if (currentAudio !== audio) return;
    fallbackToBrowserVoice("error event");
  }, { signal: _abortSignal });
  audio.addEventListener("stalled", () => {
    if (currentAudio !== audio) return;
    // Give the network a few seconds before giving up
    setTimeout(() => {
      if (!fellBack && audio.readyState < 2 && currentAudio === audio && currentReelEl === reelEl) {
        fallbackToBrowserVoice("stalled");
      }
    }, 8000);
  }, { signal: _abortSignal });

  try {
    await audio.play();
    audioDbg("audio.play() OK reel " + idx + " muted=" + audio.muted + " vol=" + audio.volume);
  } catch (err) {
    // Mobile autoplay was blocked. Show the play-icon affordance, AND
    // queue the playback so the very next tap anywhere on the screen
    // starts it — much friendlier than forcing the user to find the icon.
    reelEl.classList.add("paused");
    reelEl.classList.add("needs-tap");
    queuePlayOnNextTap(audio, reelEl);
    audioDbg("audio.play() BLOCKED reel " + idx + ": " + (err?.name || "") + " " + (err?.message || err));
    console.warn("[audio] autoplay blocked — will retry on next tap:", err?.message || err);
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
  utt.volume = 1.0;
  utt.pitch = 1.0;
  // Pick a matching system voice if one is available, else let the engine
  // default kick in. Without an explicit lang the Android WebView often
  // picks a non-existent default and stays silent.
  try {
    const langCode = (navigator.language || "en-US").slice(0, 5);
    utt.lang = langCode;
    const allVoices = window.speechSynthesis.getVoices() || [];
    if (allVoices.length) {
      const match = allVoices.find((v) => v.lang && v.lang.toLowerCase().startsWith(langCode.toLowerCase().slice(0, 2)));
      if (match) utt.voice = match;
    }
  } catch (_) {}
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
    audioDbg("device voice ended idx=" + idx);
    chunkEls.forEach((c) => c.classList.add("exiting"));
    setTimeout(() => {
      if (currentReelEl === reelEl && settings.autoAdvance !== "off") {
        const next = reelEl.nextElementSibling;
        if (next) next.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 700);
  };
  utt.onstart = () => audioDbg("device voice STARTED idx=" + idx + " voice=" + (utt.voice?.name || "default") + " lang=" + utt.lang);
  utt.onerror = (e) => audioDbg("device voice ERROR idx=" + idx + " " + (e?.error || ""));
  // Cancel anything currently queued so we don't get a phantom backlog,
  // then speak. The 60ms delay lets WebView settle.
  try { window.speechSynthesis.cancel(); } catch (_) {}
  audioDbg("device voice queue idx=" + idx);
  setTimeout(() => {
    try { window.speechSynthesis.speak(utt); }
    catch (e) { audioDbg("speechSynthesis.speak threw: " + (e?.message || e)); }
  }, 60);
}

// Warm up the voices list once at app start. On Android WebView,
// `getVoices()` is async-populated — calling it early ensures the list
// is non-empty by the time we need it for fallback narration.
(function warmSpeechVoices() {
  if (!("speechSynthesis" in window)) return;
  try { window.speechSynthesis.getVoices(); } catch (_) {}
  if (typeof window.speechSynthesis.onvoiceschanged !== "undefined") {
    window.speechSynthesis.onvoiceschanged = () => {
      try {
        const n = (window.speechSynthesis.getVoices() || []).length;
        if (typeof audioDbg === "function") audioDbg("voices loaded: " + n);
      } catch (_) {}
    };
  }
})();

// ----- Image generation -----
function ensureImage(idx) {
  if (imageCache.has(idx)) return Promise.resolve(imageCache.get(idx));
  if (imageInflight.has(idx)) return imageInflight.get(idx);
  const reel = currentReels[idx];
  if (!reel) return Promise.resolve(null);

  const p = api("/api/image", {
    method: "POST",
    body: {
      prompt: reel.background_prompt,
      imageStyle: settings.imageStyle,
      imageStyleCustom: settings.imageStyleCustom || "",
    },
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

// ----- TTS rate limiter -----
// Gemini Flash TTS free tier is 10 req/min. We throttle to 8/min on the
// client to leave headroom and to keep the FIRST reel's slot at the
// front of the queue. A sliding-window of recent timestamps is used.
// On a 503 quota response, we record the time and back off all callers
// for 60s — during which they immediately resolve null so speakReel can
// jump to the device-voice fallback without a useless retry.
const TTS_BUDGET_PER_MIN = 8;
const _ttsCalls = []; // unix ms of recent successful starts
let _ttsQuotaBlockUntil = 0;

async function ttsThrottleAcquire() {
  while (true) {
    const now = Date.now();
    if (now < _ttsQuotaBlockUntil) {
      // We've been told quota is exhausted — caller should bail to device voice
      return false;
    }
    // prune anything older than 60s
    while (_ttsCalls.length && now - _ttsCalls[0] > 60_000) _ttsCalls.shift();
    if (_ttsCalls.length < TTS_BUDGET_PER_MIN) {
      _ttsCalls.push(now);
      return true;
    }
    // wait until the oldest call falls out of the window
    const wait = 60_000 - (now - _ttsCalls[0]) + 50;
    audioDbg("tts throttle wait " + wait + "ms");
    await new Promise((r) => setTimeout(r, wait));
  }
}

// ----- Audio generation (with per-reel voice) -----
// Resolves to a URL on success, or null on failure (quota, network, etc.).
// Never rejects — that way fire-and-forget prefetch can't produce unhandled
// rejections that bubble up to the global error overlay.
function ensureAudio(idx) {
  if (audioCache.has(idx)) return Promise.resolve(audioCache.get(idx));
  if (audioInflight.has(idx)) return audioInflight.get(idx);
  const reel = currentReels[idx];
  if (!reel) return Promise.resolve(null);

  // The model occasionally generates a reel object with no narration (or
  // a tiny whitespace-only string). The server's /api/tts rejects empty
  // text with HTTP 400 — calling it would just waste a request slot.
  // Resolve null instantly; speakReel falls through to whatever caption
  // chunks exist (or stays silent gracefully).
  const narrationText = (reel.narration || "").trim();
  if (!narrationText) {
    audioDbg("ensureAudio idx=" + idx + " SKIP (empty narration)");
    return Promise.resolve(null);
  }

  const voice = (settings.voiceOverride && settings.voiceOverride !== "auto") ? settings.voiceOverride : reel.voice;
  const voiceB = (settings.voiceB && settings.voiceB !== "auto") ? settings.voiceB : (reel.voiceB || "Charon");
  const format = settings.format || "solo";

  const p = (async () => {
    const ok = await ttsThrottleAcquire();
    if (!ok) {
      audioDbg("ensureAudio idx=" + idx + " SKIP (quota cooldown)");
      audioInflight.delete(idx);
      return null;
    }
    audioDbg("ensureAudio idx=" + idx + " POST /api/tts");
    return api("/api/tts", {
      method: "POST",
      body: { text: narrationText, voice, voiceB, format },
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          const err = new Error("HTTP " + r.status + " " + (data.error || ""));
          err.status = r.status; err.body = data;
          throw err;
        }
        return data;
      })
      .then((data) => {
        if (!data.url) throw new Error(data.error || "no audio");
        audioCache.set(idx, data.url);
        audioInflight.delete(idx);
        if (currentChapterId) postChapterAsset(currentChapterId, "audio", idx, data.url);
        audioDbg("ensureAudio idx=" + idx + " OK url=" + data.url.slice(0, 40));
        return data.url;
      })
      .catch((e) => {
        audioInflight.delete(idx);
        const msg = String(e?.message || e);
        const status = e?.status || "?";
        audioDbg("ensureAudio idx=" + idx + " FAIL " + status + " " + msg.slice(0, 80));
        if (/429|quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(msg) || status === 503) {
          // Block all further TTS callers for 60s — saves them the round-trip
          _ttsQuotaBlockUntil = Date.now() + 60_000;
          audioDbg("tts quota block for 60s");
          console.warn("[tts] quota — falling back to device voice", msg.slice(0, 120));
        } else {
          console.warn("[tts] failed", msg.slice(0, 200));
        }
        return null; // never throw — keeps fire-and-forget callers safe
      });
  })();

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
  fb.innerHTML = (choice === correct ? t("quiz_correct") + " " : t("quiz_incorrect") + " ") + escapeHtml(q.explanation || "");

  reelEl.querySelector(".quiz-next").classList.remove("hidden");
}

function showStreak(reelEl, n) {
  const pill = reelEl.querySelector(".streak-pill");
  if (!pill) return;
  pill.querySelector(".sp-num").textContent = `${n} ${t("streak_in_a_row")}`;
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
  let msg = t("score_keep_going");
  let emoji = "💪";
  if (ratio === 1) { msg = t("score_perfect"); emoji = "🏆"; }
  else if (ratio >= 0.7) { msg = t("score_great"); emoji = "🎉"; }
  else if (ratio >= 0.4) { msg = t("score_decent"); emoji = "👍"; }

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
//  AUTH (login / signup / logout)
// =============================================================
const authForm = document.getElementById("authForm");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const authName = document.getElementById("authName");
const authError = document.getElementById("authError");
const authSignInBtn = document.getElementById("authSignIn");
const authSignUpToggle = document.getElementById("authSignUp");
let authMode = "signin"; // 'signin' | 'signup'

function setAuthMode(mode) {
  authMode = mode;
  if (authMode === "signup") {
    authSignInBtn.textContent = t("auth_create");
    authSignUpToggle.textContent = t("auth_back_to_signin");
    document.body.classList.add("auth-signup");
  } else {
    authSignInBtn.textContent = t("auth_sign_in");
    authSignUpToggle.textContent = t("auth_create_instead");
    document.body.classList.remove("auth-signup");
  }
  authError.textContent = "";
}
authSignUpToggle?.addEventListener("click", () => setAuthMode(authMode === "signin" ? "signup" : "signin"));

authForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.textContent = "";
  const email = authEmail.value.trim();
  const password = authPassword.value;
  const displayName = authName.value.trim();
  if (!email || !password) return;
  authSignInBtn.disabled = true;
  authSignInBtn.textContent = t(authMode === "signup" ? "auth_creating" : "auth_signing_in");
  try {
    const res = await fetch(`/api/auth/${authMode === "signup" ? "signup" : "login"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, displayName }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Auth failed");
    authToken = data.token;
    authUser = data.user;
    persistAuth();
    sfx("ding"); haptic([10, 50, 10]); setMascotState("happy", 1500);
    showScreen("upload");
    refreshSubjectChips();
  } catch (err) {
    authError.textContent = err.message || "Sign in failed";
    sfx("buzzer"); haptic(80);
  } finally {
    authSignInBtn.disabled = false;
    setAuthMode(authMode); // resets button label
  }
});

document.getElementById("logoutBtn")?.addEventListener("click", () => {
  if (!confirm("Sign out?")) return;
  authToken = null; authUser = null; persistAuth();
  imageCache.clear(); audioCache.clear();
  showScreen("login");
});

// =============================================================
//  LIBRARY full-screen page
// =============================================================
const libraryBack = document.getElementById("libraryBack");
const libraryList2 = document.getElementById("libraryList2");
const libraryEmpty2 = document.getElementById("libraryEmpty2");
const savedList2 = document.getElementById("savedList2");
const savedEmpty2 = document.getElementById("savedEmpty2");
const newSubjectBtn2 = document.getElementById("newSubjectBtn2");
const newSubjectForm2 = document.getElementById("newSubjectForm2");
const nsTitle2 = document.getElementById("nsTitle2");
const nsEmoji2 = document.getElementById("nsEmoji2");
const nsColor2 = document.getElementById("nsColor2");
const nsCreate2 = document.getElementById("nsCreate2");
const nsCancel2 = document.getElementById("nsCancel2");

libraryBack?.addEventListener("click", () => showScreen("upload"));

// =============================================================
//  Profile (display name + avatar)
// =============================================================
const profileCardEl = document.getElementById("profileCard");
const avatarBtn = document.getElementById("avatarBtn");
const avatarImg = document.getElementById("avatarImg");
const avatarInput = document.getElementById("avatarInput");
const profileNameInput = document.getElementById("profileName");
const profileEmailEl = document.getElementById("profileEmail");
const profileSaveBtn = document.getElementById("profileSaveBtn");

function avatarInitial() {
  const name = (authUser?.displayName || authUser?.email || "?").trim();
  return name.charAt(0).toUpperCase();
}
function renderProfile() {
  if (!authUser) return;
  if (profileEmailEl) profileEmailEl.textContent = authUser.email || "";
  if (profileNameInput) profileNameInput.value = authUser.displayName || "";
  if (avatarImg) {
    avatarImg.style.backgroundImage = "";
    avatarImg.textContent = "";
    if (authUser.avatarUrl) {
      avatarImg.style.backgroundImage = `url("${authUser.avatarUrl}")`;
    } else {
      avatarImg.textContent = avatarInitial();
    }
  }
  if (profileSaveBtn) profileSaveBtn.hidden = true;
}

avatarBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  avatarInput?.click();
});
avatarInput?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) { showToast(t("profile_avatar_only_images")); return; }
  if (file.size > 5 * 1024 * 1024) { showToast(t("profile_avatar_too_big")); return; }
  const fd = new FormData();
  fd.append("avatar", file);
  try {
    const res = await api("/api/auth/avatar", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
    authUser = data.user;
    persistAuth();
    renderProfile();
    showToast(t("profile_saved"));
    sfx("ding"); haptic(10);
  } catch (err) {
    showToast(err.message || "Avatar upload failed");
  } finally {
    avatarInput.value = ""; // allow same file picked again
  }
});

profileNameInput?.addEventListener("input", () => {
  if (!profileSaveBtn) return;
  const cur = (authUser?.displayName || "");
  profileSaveBtn.hidden = profileNameInput.value.trim() === cur.trim();
});
profileNameInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); profileSaveBtn?.click(); }
});
profileSaveBtn?.addEventListener("click", async () => {
  const newName = profileNameInput.value.trim();
  try {
    profileSaveBtn.disabled = true;
    const res = await api("/api/auth/profile", { method: "PATCH", body: { displayName: newName } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Save failed");
    authUser = data.user;
    persistAuth();
    renderProfile();
    showToast(t("profile_saved"));
    sfx("ding"); haptic(10);
  } catch (err) {
    showToast(err.message || "Save failed");
  } finally {
    profileSaveBtn.disabled = false;
  }
});

document.querySelectorAll(".lib-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    document.querySelectorAll(".lib-tab").forEach((t2) => t2.classList.toggle("active", t2 === tab));
    document.querySelectorAll("[data-tab-panel]").forEach((p) => {
      p.classList.toggle("hidden", p.dataset.tabPanel !== target);
    });
    if (target === "saved") refreshSavedListView();
    sfx("boop"); haptic(6);
  });
});

newSubjectBtn2?.addEventListener("click", () => {
  newSubjectForm2.classList.remove("hidden");
  nsTitle2.value = "";
  nsEmoji2.value = "📚";
  setTimeout(() => nsTitle2.focus(), 30);
});
nsCancel2?.addEventListener("click", () => newSubjectForm2.classList.add("hidden"));
nsCreate2?.addEventListener("click", async () => {
  const title = nsTitle2.value.trim();
  if (!title) return showToast(t("toast_subject_required"));
  try {
    nsCreate2.disabled = true;
    await createSubject({ title, emoji: (nsEmoji2.value || "📚").slice(0, 3), color: nsColor2.value });
    newSubjectForm2.classList.add("hidden");
    await renderLibraryPage();
    refreshSubjectChips();
  } catch (e) { showToast(e.message || t("toast_subject_create_failed")); }
  finally { nsCreate2.disabled = false; }
});

async function renderLibraryPage() {
  if (!libraryList2) return;
  libraryList2.innerHTML = "";
  const subjects = await fetchSubjects();
  if (!subjects.length) {
    libraryEmpty2.classList.remove("hidden");
    return;
  }
  libraryEmpty2.classList.add("hidden");
  for (const s of subjects) {
    const card = document.createElement("div");
    card.className = "subject-card";
    card.style.borderLeft = `4px solid ${s.color || "#6b8cff"}`;
    const countLabel = s.chapterCount === 1 ? t("chapter") : t("chapters");
    card.innerHTML = `
      <div class="sc-head">
        <div class="sc-title"><span class="sc-emoji">${escapeHtml(s.emoji || "📚")}</span> ${escapeHtml(s.title)}</div>
        <div class="sc-meta">
          <span>${s.chapterCount} ${countLabel}</span>
          <button class="sc-add" aria-label="Add chapter">＋</button>
          <button class="sc-del" aria-label="Delete">×</button>
        </div>
      </div>
      <div class="sc-chapters"></div>
    `;
    const chaptersEl = card.querySelector(".sc-chapters");
    card.querySelector(".sc-del").addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (!confirm(t("delete_subject_confirm", { title: s.title }))) return;
      await deleteSubject(s.id);
      renderLibraryPage();
      refreshSubjectChips();
    });
    card.querySelector(".sc-add").addEventListener("click", (ev) => {
      ev.stopPropagation();
      settings.subject = s.id;
      saveSettings();
      applySubjectChipState();
      showScreen("upload");
      showToast(t("upload_for_subject", { title: s.title }));
      document.getElementById("dropZone")?.click();
    });
    const chapters = await fetchChapters(s.id);
    if (!chapters.length) {
      const empty = document.createElement("div");
      empty.className = "sc-empty";
      empty.textContent = t("no_chapters");
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
          <button class="ch-del" aria-label="Delete chapter">×</button>
        `;
        row.addEventListener("click", () => playChapter(ch));
        row.querySelector(".ch-del").addEventListener("click", async (ev) => {
          ev.stopPropagation();
          if (!confirm(t("delete_chapter_confirm", { title: ch.title }))) return;
          await deleteChapter(ch.id);
          renderLibraryPage();
        });
        chaptersEl.appendChild(row);
      });
    }
    libraryList2.appendChild(card);
  }
}

async function refreshSavedListView() {
  if (!savedList2) return;
  savedList2.innerHTML = "";
  const arr = await fetchSavedReels();
  if (!arr.length) { savedEmpty2.classList.remove("hidden"); return; }
  savedEmpty2.classList.add("hidden");
  arr.forEach((r) => {
    const card = document.createElement("div");
    card.className = "saved-item";
    card.style.background = `linear-gradient(135deg, ${r.accentColor || "#ff3b6b"} 0%, #1a1a3a 100%)`;
    card.innerHTML = `
      <div class="si-title">${escapeHtml(r.title || "Untitled")}</div>
      <div class="si-narr">${escapeHtml(stripPodcastTags(r.narration || "").slice(0, 130))}${(r.narration || "").length > 130 ? "…" : ""}</div>
      <div class="si-meta">
        <span class="si-voice">🎙 ${escapeHtml(r.voice || "Aoede")}</span>
        <button class="si-remove">${escapeHtml(t("remove"))}</button>
      </div>
    `;
    card.querySelector(".si-remove").addEventListener("click", async (e) => {
      e.stopPropagation();
      await deleteSavedReel(r.id);
      refreshSavedListView();
      refreshStatsBadge();
    });
    card.addEventListener("click", async () => {
      // Replay this saved reel as a one-reel session.
      const reel = {
        title: r.title,
        narration: r.narration,
        background_prompt: r.backgroundPrompt,
        voice: r.voice,
        accent_color: r.accentColor,
        card: r.cardJson ? safeParse(r.cardJson) : null,
      };
      currentDoc = { reels: [reel], quiz: [] };
      currentReels = [reel];
      currentQuiz = [];
      imageCache.clear(); imageInflight.clear();
      audioCache.clear(); audioInflight.clear();

      // Pre-populate the asset caches from the saved record. URLs on the
      // /api/saved/<id>/{image,audio} pattern are DB-backed (bytes stored
      // in Postgres) — trust them outright, no HEAD-check needed. Legacy
      // /images/... or /audio/... URLs are on the ephemeral disk and may
      // have been wiped by a redeploy, so HEAD-check those before using.
      audioDbg("saved reel click id=" + r.id + " audioUrl=" + (r.audioUrl || "(empty)") + " hasAudioData=" + r.hasAudioData);
      const isStable = (u) => typeof u === "string" && u.startsWith("/api/saved/");
      const checks = await Promise.all([
        isStable(r.imageUrl) ? Promise.resolve(true) : isUrlReachable(r.imageUrl),
        isStable(r.audioUrl) ? Promise.resolve(true) : isUrlReachable(r.audioUrl),
      ]);
      const [imgOk, audOk] = checks;
      if (imgOk && r.imageUrl) imageCache.set(0, r.imageUrl);
      if (audOk && r.audioUrl) audioCache.set(0, r.audioUrl);
      audioDbg("saved reel cache hydrated: image=" + (imgOk ? "yes" : "no") + " audio=" + (audOk ? "yes" : "no"));

      currentChapterId = null;
      renderAll();
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
    savedList2.appendChild(card);
  });
}
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// HEAD-check a URL — used to verify saved-reel asset URLs still exist before
// we use them as a cache pre-population. Render's free tier wipes
// /generated-images + /generated-audio on every redeploy, so URLs that worked
// yesterday may now 404 today.
async function isUrlReachable(url) {
  if (!url) return false;
  try {
    const r = await fetch(url, { method: "HEAD", cache: "no-store" });
    return r.ok;
  } catch { return false; }
}

// =============================================================
//  Server-side saved reels (replaces localStorage)
// =============================================================
async function fetchSavedReels() {
  try {
    const r = await api("/api/saved");
    const data = await r.json();
    return data.saved || [];
  } catch { return []; }
}
async function postSavedReel(payload) {
  const r = await api("/api/saved", { method: "POST", body: payload });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "save failed");
  return data.saved;
}
async function deleteSavedReel(id) {
  await api(`/api/saved/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// (saveBtn click handler is wired further down, where saveBtn itself is declared)

// Cache of saved reel titles (populated from /api/saved) — used by
// refreshActionsForReel to mark the save button as already-saved without
// re-querying the server every time.
let savedTitlesCache = new Set();
async function refreshSavedTitlesCache() {
  try {
    const arr = await fetchSavedReels();
    savedTitlesCache = new Set(arr.map((r) => `${r.title}::${r.narration}`));
  } catch {}
}

// (savedBtn + libraryBtn click handlers are wired further down, where
//  those elements are actually declared — keeps us out of the temporal
//  dead zone.)

// =============================================================
//  Background fill — pre-warm all reels' assets after upload so the
//  user almost never waits.
// =============================================================
// Single shared pool — re-entrant, so we can call this at any point and it
// keeps draining the queue from wherever it left off. ensureImage/ensureAudio
// are already idempotent and de-duplicate via inflight maps.
let _bgFillRunning = false;
async function backgroundFillAllAssets() {
  if (_bgFillRunning) return; // already filling
  if (!currentReels.length) return;
  _bgFillRunning = true;
  try {
    const total = () => currentReels.length;
    let imgNext = 0, audioNext = 0;
    const imageWorker = async () => {
      while (imgNext < total()) {
        const my = imgNext++;
        try { await ensureImage(my); } catch {}
      }
    };
    const audioWorker = async () => {
      while (audioNext < total()) {
        const my = audioNext++;
        try { await ensureAudio(my); } catch {}
      }
    };
    // 4 image workers (image gen quota is generous) + just 1 audio worker.
    // Gemini Flash TTS free tier is ~10 req/min. Two in parallel was
    // bursting through the budget the moment a session started, causing
    // the FIRST reel's audio to also 429 — voice never plays. Serial TTS
    // keeps the first reel's slot at the front of the line.
    await Promise.all([
      imageWorker(), imageWorker(), imageWorker(), imageWorker(),
      audioWorker(),
    ]);
  } finally {
    _bgFillRunning = false;
  }
}

// =============================================================
//  Streaming upload (Server-Sent Events) — first reel plays while
//  the rest are still being generated.
// =============================================================
function parseSSEEvent(text) {
  if (!text || !text.trim()) return null;
  let event = "message";
  let dataStr = "";
  for (const line of text.split("\n")) {
    if (line.startsWith(":")) continue; // SSE comment / heartbeat
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
  }
  if (!dataStr) return null;
  try { return { event, data: JSON.parse(dataStr) }; } catch { return null; }
}

// (reelsObserver is declared at the top of the file with the other shared state)
function ensureReelsObserver() {
  if (reelsObserver) return reelsObserver;
  reelsObserver = new IntersectionObserver(
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
  return reelsObserver;
}
function observeNewReel(el) { ensureReelsObserver().observe(el); }

function updateProgressSegmentsAndCounts() {
  const total = reelsContainer.children.length;
  Array.from(reelsContainer.children).forEach((reelEl, slotIdx) => {
    const progress = reelEl.querySelector(".reel-progress");
    if (progress) {
      while (progress.children.length < total) {
        const seg = document.createElement("div");
        seg.className = "seg";
        const fill = document.createElement("span");
        fill.className = "fill";
        seg.appendChild(fill);
        progress.appendChild(seg);
      }
      Array.from(progress.children).forEach((seg, i) => {
        seg.classList.toggle("done", i < slotIdx);
      });
    }
    const right = reelEl.querySelector(".reel-meta .rm-right");
    if (right) right.innerHTML = `${slotIdx + 1} <span class="rm-sep">/</span> ${total}`;
    reelEl.dataset.idx = String(slotIdx);
  });
}

let firstReelShown = false;

function appendStreamingReel(reel) {
  const reelInternalIdx = currentReels.length;
  currentReels.push(reel);
  const slotIdx = reelsContainer.children.length;
  const reelEl = buildReel(reel, slotIdx, slotIdx + 1);
  reelEl.dataset.reelIdx = String(reelInternalIdx);
  reelsContainer.appendChild(reelEl);
  observeNewReel(reelEl);
  updateProgressSegmentsAndCounts();

  // Pre-warm assets immediately
  ensureImage(reelInternalIdx);
  ensureAudio(reelInternalIdx);

  if (!firstReelShown && slotIdx === 0) {
    firstReelShown = true;
    showScreen("reels");
    sfx("fanfare"); haptic([15, 30, 15]);
    setMascotState("idle", 0);
    requestAnimationFrame(() => {
      reelEl.scrollIntoView({ behavior: "instant", block: "start" });
      activateReel(reelEl, 0);
    });
    // Kick the prefetch worker pool the moment we have something to show.
    // It's re-entrant, so we can also call it again at end-of-stream and
    // it'll just resume draining whatever's left.
    setTimeout(backgroundFillAllAssets, 50);
  }
}

function appendStreamingQuiz() {
  if (!currentQuiz.length) return;
  const slotIdx = reelsContainer.children.length;
  const quizEl = buildQuizReel(slotIdx, slotIdx + 1);
  reelsContainer.appendChild(quizEl);
  observeNewReel(quizEl);
  updateProgressSegmentsAndCounts();
}

async function generateStreaming(loadingInterval) {
  // Resolve subject (same as non-streaming path)
  let subjectId = settings.subject || "";
  if (subjectId === "__new") {
    const name = (newSubjectInput?.value || "").trim();
    if (!name) {
      clearInterval(loadingInterval);
      showScreen("upload");
      showToast(t("err_type_first"));
      throw new Error("subject required");
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
      showToast(e.message || t("toast_subject_create_failed"));
      throw e;
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
  fd.append("format", settings.format || "solo");
  if (subjectId) fd.append("subjectId", subjectId);
  if (chapterTitle) fd.append("chapterTitle", chapterTitle);

  // Reset state
  currentReels = [];
  currentQuiz = [];
  currentChapterId = null;
  imageCache.clear(); imageInflight.clear();
  audioCache.clear(); audioInflight.clear();
  reelsContainer.innerHTML = "";
  firstReelShown = false;

  const response = await api("/api/upload-stream", { method: "POST", body: fd });
  if (response.status === 401) {
    throw new Error("auth_required");
  }
  if (!response.ok || !response.body) {
    throw new Error(`Stream init failed (HTTP ${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let sawAnyReel = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const events = buf.split("\n\n");
    buf = events.pop() || "";
    for (const evtText of events) {
      const evt = parseSSEEvent(evtText);
      if (!evt) continue;
      const { event, data } = evt;
      if (event === "start") {
        // ready
      } else if (event === "reel" && data.reel) {
        appendStreamingReel(data.reel);
        sawAnyReel = true;
      } else if (event === "quiz") {
        currentQuiz = data.quiz || [];
        appendStreamingQuiz();
      } else if (event === "title") {
        currentDoc = currentDoc || {};
        currentDoc.title = data.title;
      } else if (event === "chapter") {
        currentChapterId = data.chapter?.id || null;
      } else if (event === "error") {
        clearInterval(loadingInterval);
        if (!sawAnyReel) {
          // No reels arrived — abort streaming so we fall back
          throw new Error(data.error || "stream error");
        } else {
          showToast(data.error || "Stream error");
        }
      } else if (event === "done") {
        // finished
      }
    }
  }
  // Flush any tail
  if (buf.trim()) {
    const evt = parseSSEEvent(buf);
    if (evt && evt.event === "reel" && evt.data.reel) appendStreamingReel(evt.data.reel);
  }

  clearInterval(loadingInterval);

  if (!sawAnyReel) {
    throw new Error("Stream ended with zero reels");
  }
  if (chapterTitleInput) chapterTitleInput.value = "";

  // Re-enter the prefetch pool to drain anything still missing now that we
  // know the full reel count. The pool is re-entrant and self-deduplicates.
  if (typeof backgroundFillAllAssets === "function") backgroundFillAllAssets();
}

// =============================================================
//  Bottom navigation (Instagram-style)
// =============================================================
document.querySelectorAll("#bottomNav .bn-tab").forEach((tab) => {
  tab.addEventListener("click", (e) => {
    e.stopPropagation();
    const target = tab.dataset.target;
    sfx("boop"); haptic(6);
    if (target === "upload") {
      showScreen("upload");
    } else if (target === "library") {
      // Reuse the existing libraryBtn handler so library renders consistently
      libraryBtn?.click();
    } else if (target === "settings") {
      const m = document.getElementById("settingsModal");
      if (m) openModal(m);
    }
  });
});

// =============================================================
//  Auth gate on first load
// =============================================================
(async function bootstrap() {
  if (!authToken) {
    showScreen("login");
    setAuthMode("signin");
    return;
  }
  // Validate token by fetching /me
  try {
    const r = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${authToken}` } });
    if (!r.ok) throw new Error("invalid");
    const data = await r.json();
    authUser = data.user;
    persistAuth();
    showScreen("upload");
    refreshSubjectChips();
    refreshSavedTitlesCache();
  } catch {
    authToken = null; authUser = null; persistAuth();
    showScreen("login");
    setAuthMode("signin");
  }
})();

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

// Like is a binary toggle now — liked or not. No counter.
likeBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!currentReelEl || currentReelEl.dataset.kind !== "narration") return;
  const idx = Number(currentReelEl.dataset.idx);
  const liked = !reelLikes[idx];
  reelLikes[idx] = liked;
  likeBtn.classList.toggle("liked", liked);
  likeBtn.classList.remove("popping");
  void likeBtn.offsetWidth;
  if (liked) {
    likeBtn.classList.add("popping");
    const r = likeBtn.getBoundingClientRect();
    const reelR = currentReelEl.getBoundingClientRect();
    spawnHearts(currentReelEl, r.left - reelR.left + r.width / 2, r.top - reelR.top + r.height / 2);
    sfx("heart"); haptic([10, 30, 10]);
  } else {
    sfx("boop"); haptic(8);
  }
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
  try { localStorage.setItem("reelify-cs", captionSize); } catch (_) {}
  applyCaptionSize();
  updateCsBtn();
  showToast("Captions: " + captionSize);
  sfx("boop"); haptic(8);
});

// Share narration (Web Share API + clipboard fallback)
const shareBtn = actionsEl.querySelector('[data-action="share"]');
shareBtn?.addEventListener("click", async (e) => {
  e.stopPropagation();
  if (!currentReelEl || currentReelEl.dataset.kind === "quiz") return;
  const idx = Number(currentReelEl.dataset.idx);
  const reel = currentReels[idx];
  if (!reel) return;
  const text = `${reel.title}\n\n${reel.narration}\n\n— made with Edu Shorts`;
  try {
    if (navigator.share) {
      await navigator.share({ title: reel.title, text });
      showToast(t("toast_shared"));
    } else {
      await navigator.clipboard.writeText(text);
      showToast(t("toast_copied"));
    }
  } catch {
    try { await navigator.clipboard.writeText(text); showToast(t("toast_copied_short")); }
    catch { showToast(t("toast_share_failed")); }
  }
});

// (Reactions emoji picker was removed — like is the single binary action.)

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
  askContextEl.textContent = t("ask_about", { title: reel.title });
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
  const originalLabel = askSubmit.textContent;
  askSubmit.textContent = t("ask_thinking");
  askAnswer.classList.remove("hidden");
  askAnswer.textContent = "…";
  try {
    const r = await api("/api/ask", {
      method: "POST",
      body: {
        question: q,
        context: `Title: ${reel.title}\n\nNarration: ${reel.narration}`,
        language: settings.language,
      },
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || t("ask_failed"));
    askAnswer.textContent = data.answer || t("ask_no_answer");
  } catch (err) {
    askAnswer.textContent = t("ask_failed") + " " + (err.message || "");
  } finally {
    askSubmit.disabled = false;
    askSubmit.textContent = t("ask_button");
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
  // Take the user to the full Library page on the Saved tab (server-backed)
  showScreen("library");
  document.querySelector('.lib-tab[data-tab="saved"]')?.click();
  renderProfile();
  refreshSavedListView();
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

// Save button click handler — server-backed (replaces the old localStorage path)
saveBtn.onclick = async (e) => {
  e.stopPropagation();
  if (!currentReelEl || currentReelEl.dataset.kind !== "narration") return;
  // Use the REEL internal index, not the slot index, so checkpoints between
  // reels don't make us save the wrong reel.
  const reelIdx = Number(currentReelEl.dataset.reelIdx ?? currentReelEl.dataset.idx);
  const reel = currentReels[reelIdx];
  if (!reel) return;
  try {
    if (saveBtn.classList.contains("saved")) {
      // Already saved — find and delete on the server
      const arr = await fetchSavedReels();
      const existing = arr.find((s) => s.title === reel.title && s.narration === reel.narration);
      if (existing) await deleteSavedReel(existing.id);
      saveBtn.classList.remove("saved");
      savedTitlesCache.delete(`${reel.title}::${reel.narration}`);
      showToast(t("toast_removed"));
      sfx("boop"); haptic(8);
    } else {
      await postSavedReel({
        title: reel.title,
        narration: reel.narration,
        backgroundPrompt: reel.background_prompt,
        voice: reel.voice,
        accentColor: reel.accent_color,
        imageUrl: imageCache.get(reelIdx) || "",
        audioUrl: audioCache.get(reelIdx) || "",
        card: reel.card || null,
      });
      saveBtn.classList.add("saved");
      savedTitlesCache.add(`${reel.title}::${reel.narration}`);
      saveBtn.classList.remove("popping");
      void saveBtn.offsetWidth;
      saveBtn.classList.add("popping");
      showToast(t("toast_saved"));
      sfx("ding"); haptic(10);
    }
    refreshStatsBadge();
  } catch (err) {
    showToast(err.message || "Couldn't save");
  }
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

// Unlock audio (both Web Audio + HTMLAudioElement) on the first user gesture.
// Mobile browsers block audio.play() unless we've already played *something*
// in a user-gesture chain. Trick: play 50ms of silent base64 WAV during the
// first tap so subsequent .play() calls are allowed.
// =============================================================
//  Audio unlock — keep the page in "user has interacted" state
// =============================================================
// Chromium WebView (and iOS Safari) allow non-muted audio.play() once
// the page has been interacted with. The Generate-button click counts
// as that interaction. We also play a tiny muted WAV on the first user
// gesture as a belt-and-braces unlock for older WebView versions.

let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  if (typeof audioDbg === "function") audioDbg("unlockAudio fired");
  const c = getAudioCtx();
  if (c?.state === "suspended") c.resume().catch(() => {});
  try {
    // Muted play during the user gesture grants the page-level
    // "user has interacted with audio" flag on Chromium.
    const silent = new Audio(
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA="
    );
    silent.muted = true;
    silent.volume = 0;
    const p = silent.play();
    if (p && p.then) p.then(() => {
      silent.pause();
      if (typeof audioDbg === "function") audioDbg("unlock silent play OK");
    }).catch((e) => {
      if (typeof audioDbg === "function") audioDbg("unlock silent play FAIL: " + (e?.name || e));
    });
  } catch (e) {
    if (typeof audioDbg === "function") audioDbg("unlock threw: " + (e?.message || e));
  }
}

// Pending playback that was blocked by an autoplay policy. We attach a
// global one-time pointerdown listener that retries the play on the very
// next tap anywhere on the page — so the user never has to hunt for a
// specific button.
let _pendingPlay = null;
function queuePlayOnNextTap(audio, reelEl) {
  _pendingPlay = { audio, reelEl };
  const handler = () => {
    const job = _pendingPlay;
    _pendingPlay = null;
    if (!job) return;
    if (currentReelEl !== job.reelEl) return;
    job.audio.play().then(() => {
      job.reelEl.classList.remove("paused");
      job.reelEl.classList.remove("needs-tap");
    }).catch(() => {});
  };
  document.addEventListener("pointerdown", handler, { once: true, passive: true });
  document.addEventListener("touchstart",  handler, { once: true, passive: true });
}
window.addEventListener("pointerdown", unlockAudio, { once: true, passive: true });
window.addEventListener("touchstart",  unlockAudio, { once: true, passive: true });
window.addEventListener("click",       unlockAudio, { once: true, passive: true });

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

// Audio diagnostic overlay - tap the small green dot in bottom-right to
// toggle on/off. Shows the last several audio events so we can see why
// voice isn't playing without needing remote-debug devtools.
let _audioDbgEl = null;
const _audioDbgLines = [];
const _audioDbgEnabled = (() => {
  try {
    if (location.search.indexOf("audiodbg=1") >= 0) return true;
    if (localStorage.getItem("edu-audio-dbg") === "1") return true;
  } catch (_) {}
  return false;
})();
function audioDbg(line) {
  console.log("[audiodbg]", line);
  if (!_audioDbgEnabled) return;
  if (!_audioDbgEl) {
    _audioDbgEl = document.createElement("div");
    _audioDbgEl.id = "audioDbg";
    _audioDbgEl.style.cssText = "position:fixed;left:6px;right:6px;bottom:64px;z-index:99999;max-height:30vh;overflow:auto;padding:8px 10px;border-radius:10px;background:rgba(0,0,0,0.78);color:#a7f3d0;font-family:monospace;font-size:11px;line-height:1.35;pointer-events:none;white-space:pre-wrap;word-break:break-word";
    document.body.appendChild(_audioDbgEl);
  }
  const ts = new Date().toISOString().slice(11, 23);
  _audioDbgLines.push(ts + "  " + line);
  if (_audioDbgLines.length > 12) _audioDbgLines.shift();
  _audioDbgEl.textContent = _audioDbgLines.join("\n");
}
window.addEventListener("DOMContentLoaded", () => {
  const dot = document.createElement("div");
  dot.style.cssText = "position:fixed;right:8px;bottom:8px;width:14px;height:14px;border-radius:50%;background:#0f766e;z-index:99999;opacity:0.5";
  dot.title = "audio dbg";
  dot.addEventListener("click", () => {
    try {
      const v = localStorage.getItem("edu-audio-dbg") === "1" ? "0" : "1";
      localStorage.setItem("edu-audio-dbg", v);
      location.reload();
    } catch (_) {}
  });
  document.body.appendChild(dot);
});

// =============================================================
//  Subjects + Library + Settings (server-persistent)
// =============================================================
// (currentChapterId is declared at the top of the file with the other shared state)

// All subject/chapter calls go through api() so the Authorization header is
// attached (otherwise the server replies 401 "Sign in required").
async function fetchSubjects() {
  try {
    const r = await api("/api/subjects");
    const data = await r.json();
    return data.subjects || [];
  } catch { return []; }
}

async function createSubject({ title, emoji, color }) {
  const r = await api("/api/subjects", { method: "POST", body: { title, emoji, color } });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Could not create subject");
  return data.subject;
}

async function fetchChapters(subjectId) {
  try {
    const r = await api(`/api/subjects/${encodeURIComponent(subjectId)}/chapters`);
    const data = await r.json();
    return data.chapters || [];
  } catch { return []; }
}

async function fetchChapter(chapterId) {
  const r = await api(`/api/chapters/${encodeURIComponent(chapterId)}`);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Chapter not found");
  return data.chapter;
}

async function deleteSubject(id) {
  await api(`/api/subjects/${encodeURIComponent(id)}`, { method: "DELETE" });
}
async function deleteChapter(id) {
  await api(`/api/chapters/${encodeURIComponent(id)}`, { method: "DELETE" });
}

async function postChapterAsset(chapterId, kind, reelIdx, url) {
  if (!chapterId) return;
  try {
    await api(`/api/chapters/${encodeURIComponent(chapterId)}/asset`, {
      method: "POST", body: { kind, reelIdx, url },
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
  // Take the user to the full Library page (server-backed) instead of the modal
  showScreen("library");
  document.querySelector('.lib-tab[data-tab="subjects"]')?.click();
  renderLibraryPage();
  refreshSavedTitlesCache();
  renderProfile();
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
  if (!title) return showToast(t("toast_subject_required"));
  try {
    nsCreate.disabled = true;
    await createSubject({ title, emoji: (nsEmoji.value || "📚").slice(0, 3), color: nsColor.value });
    newSubjectForm.classList.add("hidden");
    await renderLibrary();
    refreshSubjectChips();
  } catch (e) { showToast(e.message || t("toast_subject_create_failed")); }
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
    const countLabel = s.chapterCount === 1 ? t("chapter") : t("chapters");
    card.innerHTML = `
      <div class="sc-head">
        <div class="sc-title"><span class="sc-emoji">${escapeHtml(s.emoji || "📚")}</span> ${escapeHtml(s.title)}</div>
        <div class="sc-meta">
          <span>${s.chapterCount} ${countLabel}</span>
          <button class="sc-add" aria-label="Add chapter">＋</button>
          <button class="sc-del" aria-label="Delete">×</button>
        </div>
      </div>
      <div class="sc-chapters"></div>
    `;
    const chaptersEl = card.querySelector(".sc-chapters");

    card.querySelector(".sc-del").addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (!confirm(t("delete_subject_confirm", { title: s.title }))) return;
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
      showToast(t("upload_for_subject", { title: s.title }));
      document.getElementById("dropZone")?.click();
    });

    const chapters = await fetchChapters(s.id);
    if (!chapters.length) {
      const empty = document.createElement("div");
      empty.className = "sc-empty";
      empty.textContent = t("no_chapters");
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
          if (!confirm(t("delete_chapter_confirm", { title: ch.title }))) return;
          await deleteChapter(ch.id);
          renderLibrary();
        });
        chaptersEl.appendChild(row);
      });
    }
    libraryList.appendChild(card);
  }
}

async function playChapter(chapter) {
  closeModal(libraryModal);
  currentDoc = chapter;
  currentReels = chapter.reels;
  currentQuiz = chapter.quiz || [];
  imageCache.clear(); imageInflight.clear();
  audioCache.clear(); audioInflight.clear();

  // Pre-populate caches from saved asset maps. Stable /api/saved/* URLs
  // (DB-backed) we trust; legacy /images/... or /audio/... URLs we
  // HEAD-check first because Render's ephemeral disk wipes them on
  // redeploy. Skipping a stale URL means ensureImage/ensureAudio will
  // regenerate from the prompt instead of hitting a 404.
  const isStable = (u) => typeof u === "string" && u.startsWith("/api/saved/");
  const imgEntries = Object.entries(chapter.imageMap || {});
  const audEntries = Object.entries(chapter.audioMap || {});
  const checks = await Promise.all([
    ...imgEntries.map(([_, u]) => isStable(u) ? Promise.resolve(true) : isUrlReachable(u)),
    ...audEntries.map(([_, u]) => isStable(u) ? Promise.resolve(true) : isUrlReachable(u)),
  ]);
  imgEntries.forEach(([k, v], i) => { if (checks[i] && v) imageCache.set(Number(k), v); });
  audEntries.forEach(([k, v], i) => {
    const j = imgEntries.length + i;
    if (checks[j] && v) audioCache.set(Number(k), v);
  });
  if (typeof audioDbg === "function") {
    audioDbg("playChapter " + chapter.id + " imgs=" + imageCache.size + "/" + imgEntries.length + " auds=" + audioCache.size + "/" + audEntries.length);
  }
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

// ----- Paste text: alternative to file upload -----
document.getElementById("pasteTextBtn")?.addEventListener("click", () => {
  unlockAudio();
  openModal(document.getElementById("pasteModal"));
  setTimeout(() => document.getElementById("pasteInput")?.focus(), 80);
});
document.getElementById("pasteSubmit")?.addEventListener("click", () => {
  const ta = document.getElementById("pasteInput");
  const text = (ta?.value || "").trim();
  if (text.length < 30) { showToast(t("paste_too_short")); return; }
  // Wrap as a text/plain blob so the existing /api/upload pipeline accepts it.
  const blob = new Blob([text], { type: "text/plain" });
  selectedFile = new File([blob], "pasted-text.txt", { type: "text/plain" });
  dzText.textContent = t("paste_text_title");
  dropZone.classList.add("has-file");
  generateBtn.disabled = false;
  closeModal(document.getElementById("pasteModal"));
  generate();
});

// ----- Surprise Me: roll a random preset (vibe/look/length/pace/format/voices) -----
document.getElementById("surpriseBtn")?.addEventListener("click", () => {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const VOICES = ["Aoede", "Puck", "Charon", "Kore", "Leda", "Fenrir"];
  settings.vibe = pick(["educational", "fun", "dramatic", "chill", "genz"]);
  settings.imageStyle = pick(["photo", "3d", "watercolor", "anime", "neon", "vintage", "oil"]);
  settings.length = pick(["short", "standard", "long"]);
  settings.pace = pick(["chill", "normal", "fast"]);
  settings.quizDifficulty = pick(["easy", "medium", "hard"]);
  settings.format = Math.random() < 0.4 ? "podcast" : "solo";
  settings.voiceOverride = pick(["auto", ...VOICES]);
  if (settings.format === "podcast") {
    const others = VOICES.filter((v) => v !== settings.voiceOverride);
    settings.voiceB = pick(["auto", ...others]);
  }
  speedIdx = PACE_TO_SPEED_IDX[settings.pace] ?? 1;
  applyFormat(settings.format);
  saveSettings();
  applySettingsToUI();
  updateSpeedButton();
  sfx("ding"); haptic([20, 30, 20]);
  setMascotState("happy", 1500);
  showToast(t("surprise_toast"));
});

function refreshActionsForReel(reelEl) {
  const kind = reelEl.dataset.kind;
  const hideActions = kind === "quiz" || kind === "checkpoint";
  actionsEl.classList.toggle("hidden", hideActions);
  if (hideActions) return;

  // Slot index for like state; reel internal index for currentReels lookup.
  const slotIdx = Number(reelEl.dataset.idx);
  const reelIdx = Number(reelEl.dataset.reelIdx ?? slotIdx);
  const reel = currentReels[reelIdx];

  // Like is binary now — just reflect liked / not liked.
  likeBtn.classList.toggle("liked", !!reelLikes[slotIdx]);

  // Saved state — uses the server-side cache populated by refreshSavedTitlesCache()
  if (reel) {
    const key = `${reel.title}::${reel.narration}`;
    saveBtn.classList.toggle("saved", typeof savedTitlesCache !== "undefined" && savedTitlesCache.has(key));
  } else {
    saveBtn.classList.remove("saved");
  }
}
