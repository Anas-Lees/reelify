# Build & install the Android app

After this, your phone runs Reelify standalone — your laptop is never in the loop.

You'll need:
- **GitHub account** (free)
- **Render account** (free, no credit card)
- ~15 minutes total

---

## Step 1 · Push this project to GitHub

1. Create a new GitHub repo (any name, public or private).
2. From this folder, push the code:

```bash
git init
git add .
git commit -m "Reelify"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

> Don't worry — `.gitignore` already excludes `.env`, `node_modules/`, `reelify.db`, and the heavy `android/` build folders. Your API key won't get pushed.

---

## Step 2 · Deploy the backend to Render (free)

The backend serves both the Express API and the web UI. The phone will load everything from there.

1. Sign up at [render.com](https://render.com) (GitHub login is fine).
2. Click **New → Blueprint**.
3. Connect your GitHub repo. Render reads the `render.yaml` we already added and proposes a "reelify" web service.
4. **Set the environment variable** when prompted:
   - `GEMINI_API_KEY` = your Gemini key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
5. Click **Apply**. First deploy takes ~3–5 min (Docker build).
6. When it's live, copy the public URL — looks like `https://reelify-xxxx.onrender.com`.
7. Open that URL in any browser to confirm the web UI loads. Try uploading a file. If reels generate, the backend is good.

> **Heads up — Render free tier sleeps after 15 min of no traffic.** First request after sleep takes ~30–60 seconds. After that it's fast. The data stays.

---

## Step 3 · Build the APK in the cloud (no Android Studio needed)

I added a GitHub Actions workflow at `.github/workflows/build-apk.yml`. It builds a real `.apk` on GitHub's runners.

1. In your GitHub repo, click **Actions** tab.
2. Pick **"Build Android APK"** in the left sidebar.
3. Click **Run workflow** (top right).
4. In the **Backend URL** field, paste your Render URL: `https://reelify-xxxx.onrender.com`
5. Click **Run workflow**.
6. Wait ~3–5 minutes for green checkmark.
7. Click into the run, scroll to **Artifacts** at the bottom, download `reelify-debug-apk.zip`.
8. Unzip it — inside is `app-debug.apk`.

---

## Step 4 · Install on your Galaxy S24

Easiest way: **email or Drive transfer**.

1. Email the `app-debug.apk` to yourself, or drop it into Google Drive / OneDrive.
2. On the S24, open the email/Drive and tap the APK.
3. Android will prompt: "Install unknown apps from this source?" → tap **Settings** → enable for that source → go back → **Install**.
4. Reelify icon appears on your home screen. Tap it.

> Samsung's "Auto Blocker" (Settings → Security and privacy) blocks sideloads by default on newer One UI builds. If install fails, **temporarily disable Auto Blocker**, install the APK, then re-enable. The app keeps working.

If you prefer USB:
- Enable **Developer options** on the S24 (tap Build number 7 times).
- Enable **USB debugging**.
- Plug into laptop, run `adb install app-debug.apk` (Android Platform Tools).

---

## Step 5 · iOS (later, when you have a Mac)

iOS build needs macOS + Xcode — Apple toolchain doesn't run on Windows or in GitHub-free runners (without paid macOS minutes).

When you have a Mac:

```bash
npm install
npx cap add ios
npx cap sync ios
npx cap open ios
```

Xcode opens. Plug in iPhone, sign with your Apple ID (free Personal team works for sideload — apps expire every 7 days). Hit **Run**.

For permanent iOS install (no 7-day expiry), you need a paid Apple Developer account ($99/yr). Or use [Codemagic](https://codemagic.io) free tier (500 build min/mo) to build IPAs in the cloud.

---

## How updates work

The APK is a thin shell that loads the deployed URL. **You never need to rebuild the APK to update the app.**

- Want to change a button? Edit `public/styles.css`, push to GitHub, Render auto-redeploys (~2 min). Open the app on the phone — the new look is there.
- Only rebuild the APK if you change the Capacitor config itself (e.g. a different backend URL).

---

## Troubleshooting

**"Server unavailable" or blank screen on first launch**
Render is waking from sleep. Wait 30–60s, pull-to-refresh.

**App works but uploads fail**
Check the Render logs (Render dashboard → service → Logs tab). Most common: `GEMINI_API_KEY` env var missing or quota exhausted.

**APK build fails in Actions**
Click into the failed run, expand the "Build debug APK" step. Most common: out-of-disk on the runner — re-running usually works.

**Library/saved chapters disappeared**
Render's free Docker container occasionally restarts and wipes ephemeral disk. To make data permanent: switch to Postgres (free 1GB on [neon.tech](https://neon.tech)) or pay $1/mo for a Render persistent disk. Tell me and I'll wire it up.
