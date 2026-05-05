# Reelify — Phone build & deploy

After this, your phone runs Reelify standalone. Your laptop is never in the loop again.

**Hosting research outcome (May 2026):** I checked Netlify, Fly.io, Koyeb, Railway, Northflank. Verdict: **Render is still the only "real" free tier left** that runs a persistent Express+SQLite server. Netlify is serverless-only (60s function cap, no state) — fundamentally can't run our backend. Fly.io and Koyeb killed their free tiers in 2024–2025. We're staying on Render.

---

## Current state

✅ Repo created: **https://github.com/Anas-Lees/reelify**
✅ All code pushed (minus the workflow file — that one needs an extra GitHub permission, see below)
✅ `Dockerfile`, `render.yaml`, `capacitor.config.json`, full `android/` project all committed

---

## What's left — 3 things you do, ~10 minutes total

### 1. Grant `workflow` scope to gh CLI (30 sec)

GitHub blocks pushing files to `.github/workflows/*` unless your CLI token has the `workflow` scope. Run this **once** in any terminal:

```bash
gh auth refresh -h github.com -s workflow
```

It opens your browser, you click "Authorize," done. Tell me when it's done and I'll push the workflow file from this session.

> Alternative if you want to skip the CLI step: open https://github.com/Anas-Lees/reelify in the browser, click **Add file → Create new file**, name it `.github/workflows/build-apk.yml` and paste the contents of the local `.github/workflows/build-apk.yml` file. Same result.

### 2. Deploy the backend to Render

**One-click deploy URL** (uses the `render.yaml` Blueprint):

👉 **https://render.com/deploy?repo=https://github.com/Anas-Lees/reelify**

Click that, sign in with GitHub, then:
- Render reads `render.yaml`, proposes a "reelify" web service.
- It'll ask for the `GEMINI_API_KEY` env var — paste your key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
- Click **Apply**. First build takes ~3-5 minutes (Docker).
- When green, copy the public URL (looks like `https://reelify-xxxx.onrender.com`).
- **Send me that URL** and I'll do the rest.

### 3. (After you tell me the URL) — I trigger the APK build

Once you give me the Render URL, I'll:
- Trigger the GitHub Actions workflow with `gh workflow run` and your URL.
- Wait for the build (~3-5 min).
- Download the APK with `gh run download`.
- Place it at `E:\webappgrad\reelify-debug-apk.zip` so you can pull it off this machine, or ZIP it and tell you exactly where.

You then sideload it on your S24:
- Email yourself `app-debug.apk` or drop in Drive.
- Tap to install. Allow unknown sources for the source app when prompted.
- Samsung Auto Blocker may intercept — temporarily disable in Settings → Security and privacy → Auto Blocker, install, then re-enable.

---

## iOS (later, when you have a Mac)

iOS build needs macOS + Xcode — Apple-only. When you have a Mac:

```bash
git clone https://github.com/Anas-Lees/reelify.git
cd reelify
npm install
npx cap add ios
npx cap sync ios
npx cap open ios
```

Xcode opens. Plug in iPhone, sign with your Apple ID (free Personal team works for sideload — apps expire every 7 days), hit **Run**.

For permanent iOS install (no 7-day expiry), paid Apple Developer ($99/yr) or [Codemagic](https://codemagic.io) free cloud builds (500 min/mo).

---

## How updates work

The APK is a thin shell that loads from your Render URL. **You never need to rebuild the APK to update the app.**

- Edit `public/styles.css`, `public/app.js`, `server.js` → push to GitHub → Render auto-deploys → next time you open the app on your phone, it's the new version.
- Only rebuild the APK if you change `capacitor.config.json` itself.

---

## If your library/saved data disappears

Render free containers occasionally restart and wipe their internal disk (sleep ≠ wipe; but redeploys and rare resets do wipe). To make data permanent:
- **Easy:** add Postgres on [neon.tech](https://neon.tech) free tier (1GB), I'll migrate the SQLite layer.
- **Easier-but-paid:** $1/mo Render persistent disk.

Tell me which when you want it and I'll wire it.
