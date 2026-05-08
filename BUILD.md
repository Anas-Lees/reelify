# Reelify — Phone build & deploy

After setup, the app runs entirely in the cloud. Your phone talks to Render-hosted backend, your data lives in Neon Postgres, and your account survives every redeploy.

**Hosting research outcome (May 2026):** Stay on Render for compute. Netlify can't run a persistent Express server. Fly.io and Koyeb killed their free tiers in 2024–2025. **Database** moved off Render's ephemeral disk to **Neon** (free 0.5 GB Postgres, persistent forever) so your account doesn't get wiped on every redeploy.

---

## Current state

✅ Repo: **https://github.com/Anas-Lees/reelify**
✅ Code uses Postgres now — every account / subject / chapter / saved reel persists across redeploys
✅ `Dockerfile`, `render.yaml`, `capacitor.config.json`, full `android/` project all committed

---

## What's left — 4 things you do (~10 min total)

### 1. Grant `workflow` scope to gh CLI (only if you haven't already)

Only needed once, only if you want me to push the GitHub Actions APK build workflow from this session:

```bash
gh auth refresh -h github.com -s workflow
```

### 2. Sign up Neon and create a Postgres database (free)

1. Go to **https://neon.tech** and sign up (GitHub login works).
2. Create a new project → name it anything (e.g. `reelify`).
3. On the dashboard, copy the **connection string** — looks like:
   ```
   postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
4. That's your `DATABASE_URL`. Hold on to it for step 3.

(Free tier: 0.5 GB storage, paused after 5 min idle, instantly resumes on next query. Plenty for a personal Reelify install.)

### 3. Deploy backend to Render

**One-click Blueprint URL:**

👉 **https://render.com/deploy?repo=https://github.com/Anas-Lees/reelify**

Click that, sign in with GitHub. Render reads `render.yaml` and asks for the env vars:

- **`GEMINI_API_KEY`** — your AI Studio key from https://aistudio.google.com/apikey
- **`GOOGLE_CLOUD_API_KEY`** — *optional, basically free.* If you enable the **Cloud Text-to-Speech API** in your existing Google project (https://console.cloud.google.com/apis/library/texttospeech.googleapis.com), create a Cloud API key, and paste it here, the server uses it as the **first TTS fallback** when Gemini's preview model is rate-limited. Free tier: ~1 million chars/month. Cost beyond that: $4/M (Standard) or $16/M (Wavenet) — a 30-reel deck is well under a cent. Same Google billing as your Gemini key.
- **`OPENAI_API_KEY`** — *optional last-resort fallback.* Get one from https://platform.openai.com/api-keys. Used only if BOTH Gemini and Google Cloud TTS are unavailable. Cost: ~$0.015 per 1k chars (a 30-reel deck ≈ 4¢).
- **`DATABASE_URL`** — the Neon connection string from step 2
- **`JWT_SECRET`** — Render will offer to **auto-generate** a strong random one. Accept it. Reused on every redeploy so your sessions stay valid.

> **TTS fallback chain**: Gemini → Google Cloud TTS → OpenAI → device voice. Each provider has a 60-second cooldown if it returns a quota error, so subsequent calls skip straight to the next provider until the cooldown expires. Set as many keys as you want — the chain skips any that aren't configured.

Click **Apply**. First build takes ~3-5 min (Docker).

When live, copy the public URL (looks like `https://reelify-xxxx.onrender.com`).

> **Heads up — Render free tier sleeps after 15 min of no traffic.** First request after sleep takes ~30-60 seconds. After that it's fast. **Your data lives in Neon, not on Render's disk, so redeploys don't lose anything.**

### 4. Build the APK (optional — only if reinstalling)

You only need to rebuild the APK if `capacitor.config.json` changed (e.g. backend URL).

In your GitHub repo → **Actions** tab → **"Build Android APK"** → **Run workflow** → paste your Render URL into the **Backend URL** input → wait ~3-5 min → download `reelify-debug-apk.zip` from Artifacts.

Email yourself the APK or drop it in Drive, install on the S24 (allow unknown sources from that source).

---

## How updates work now

- Edit any code → push to GitHub → Render auto-redeploys (~2 min) → next time you open the app on your phone, the new version is there. **No need to re-sign-up.**
- Your Postgres data (account, subjects, chapters, saved reels, profile) stays put across every redeploy.
- The APK is a thin shell pointed at the Render URL; only rebuild it if `capacitor.config.json` changes.

---

## iOS (later, when you have a Mac)

```bash
git clone https://github.com/Anas-Lees/reelify.git
cd reelify
npm install
npx cap add ios
npx cap sync ios
npx cap open ios
```

Xcode → plug in iPhone → sign with Apple ID → Run. Free Personal team works for 7-day sideload; paid Apple Developer for permanent install.

---

## Migration notes

If you signed up *before* this Postgres push, your previous account is gone (it lived in the ephemeral SQLite). Sign up fresh once after the Neon switch and your account from then on persists forever.

---

## Troubleshooting

**`/api/health` returns OK but `/api/auth/me` returns 401**
Your token was signed before `JWT_SECRET` got pinned. Sign in again — once with a stable secret, every future redeploy keeps you logged in.

**Server boots with "DATABASE_URL is not set"**
Set it in Render → service → Environment → `DATABASE_URL` → paste your Neon connection string → Apply.

**Library / saved reels show empty after a deploy**
That should not happen anymore. If it does, hit `/api/version` and confirm `persistence: postgres` is in the response.

**Generated images / audio are missing for a saved reel**
Those still live on Render's ephemeral disk. They'll regenerate the next time you open that reel. To make them persistent too, the next step is moving them to Cloudflare R2 (free 10 GB) — happy to add that as a follow-up.
