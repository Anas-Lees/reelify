# Reelify — Files → Scrolling Reels

Drop in a PDF, Word doc, slide deck, image or text file. The AI reads it, packs related ideas into reels, generates a cinematic background image for each one, and the browser plays it back as an Instagram-style vertical scroller with TTS voiceover and karaoke-style word highlighting.

## Quick start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Add your AI API key** *(from Google AI Studio — the underlying provider)*

   Get one from https://aistudio.google.com/apikey, then:
   ```bash
   cp .env.example .env
   ```
   and put your key in `.env`:
   ```
   GEMINI_API_KEY=...
   ```
   *(The variable is still called `GEMINI_API_KEY` because that's what the underlying SDK reads.)*

3. **Run**
   ```bash
   npm start
   ```
   Open http://localhost:3000

## How it works

| Stage | What happens | Where |
|---|---|---|
| 1. Upload | PDF / image goes straight to the AI File API. Office docs are text-extracted with `officeparser` first. | `server.js` → `/api/upload` |
| 2. Reel scripting | The AI text model returns structured JSON: title, narration, background prompt, accent color per reel. | `REEL_PROMPT` |
| 3. Image gen | The AI image model generates a vertical cinematic background per reel — lazy, on demand as you scroll. | `/api/image` |
| 4. Voice + karaoke | The AI voice model reads the narration; the client highlights words as the audio plays. | `public/app.js` |

## Supported file types

- **Native (sent to the AI as-is):** PDF, all common image formats
- **Text-extracted then sent:** DOCX, PPTX, XLSX, ODT, ODP, ODS, TXT, MD, CSV, JSON, HTML, XML, RTF

## Notes

- All generated images are stored locally under `generated-images/`.
- Uploaded files are deleted after analysis.
- For phone install + cloud deploy: see `BUILD.md`.
