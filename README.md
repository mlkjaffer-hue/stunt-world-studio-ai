---
title: Stunt World Studio AI
emoji: 🎬
colorFrom: purple
colorTo: pink
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: AI image and video generation studio — free tier plus paid tiers
---

# 🎬 Stunt World Studio AI

A complete AI image & video generation studio website — **free tier + paid tier**, one deploy, no build step.

**What visitors can do**
- 🖼 **AI Image Generator** — free (Pollinations), 9:16 / 16:9 / 1:1
- 🎥 **Text-to-Video** — describe a scene, get a video
- 🖼→🎥 **Image-to-Video** — upload a start frame, add a motion prompt
- 💰 **Pricing** — transparent per-second rates
- 👛 **Wallet** — credits, free quota, bank-transfer recharge
- 📁 **My Creations** — history of everything generated

**Free vs paid**

| | FREE | PAID |
|---|---|---|
| Images | ✅ (20/day) | — |
| Video ≤ 15s | ✅ 3/day — *AI Animated Stills* engine (cinematic slow zoom over an AI-generated still, built with ffmpeg — genuinely free, no API key) | — |
| Video 30s → 10min | — | ✅ Seedance 2.5 · Kling 3.0 · Veo 3.1 Fast, billed per second from credits |

Long videos are generated as clips (Kling 10s, Veo 8s, Seedance 30s per clip) and **auto-stitched with ffmpeg**. Credits are deducted before generation and **refunded if the provider fails**.

> Note: as of Oct 2026, Pollinations' free anonymous tier covers **images only** — every video model there needs an API key. That's why the free video tier uses the built-in animated-stills engine instead. It produces real cinematic mp4s at zero cost.

---

## Run locally

```bash
cd backend
npm install
npm start
# open http://localhost:3000
```

Requirements: **Node 18+** and **ffmpeg** (`ffmpeg -version` to check).
The server creates `studio.db` (SQLite) next to `server.js` on first run.

Copy `.env.example` → `.env` at the project root and fill in keys when you have them:
```
FAL_KEY=            # Kling 3.0 via fal.ai
GEMINI_API_KEY=     # Veo 3.1 Fast via Google Gemini API
OPENROUTER_KEY=     # Seedance 2.5 via OpenRouter
ADMIN_TOKEN=...     # long random string — required for recharge approvals
PUBLIC_BASE_URL=    # your public URL after deploy (for paid image-to-video)
PORT=3000
```

---

## Deploy free (Render — one deploy, free subdomain)

The backend serves the frontend, so **one Web Service** is enough.

1. Push this folder to a GitHub repo (do **not** commit `.env` — it's gitignored).
2. In [Render](https://render.com) → **New → Web Service** → connect the repo.
   - **Root Directory:** leave as repo root, but set:
   - **Build Command:** `cd backend && npm install`
   - **Start Command:** `cd backend && npm start`
   - Plan: **Free**
3. After deploy you get a free subdomain like `stunt-world-studio-ai.onrender.com`. 🎉
4. In the service's **Environment** tab, add:
   - `ADMIN_TOKEN` = a long random string (generate one — keep it secret)
   - `PUBLIC_BASE_URL` = `https://stunt-world-studio-ai.onrender.com` (your actual URL)
   - Paid keys later (see below)
5. Free-plan note: Render spins down idle services; the first request after idle takes ~30s to wake. SQLite lives on the instance disk — on the free tier it resets if the service is recreated; for serious use add a persistent disk (paid) or accept the reset.

## Adding paid API keys later (no code change)

Just add these in the Render dashboard → Environment, then **Manual Deploy → Redeploy**:
- `FAL_KEY` — from [fal.ai](https://fal.ai) dashboard → enables **Kling 3.0** (~$0.084/s cost)
- `GEMINI_API_KEY` — from [Google AI Studio](https://aistudio.google.com) → enables **Veo 3.1 Fast** (~$0.10/s cost)
- `OPENROUTER_KEY` — from [OpenRouter](https://openrouter.ai) → enables **Seedance 2.5** (~$0.07/s cost)

Without a key, that model returns HTTP 402 *"not configured by the site owner yet"* — the site keeps working on the free tier. User prices (with ~2× margin) live in `config/pricing.json`; edit and redeploy to change them.

## Approving recharges (bank transfer flow)

1. User transfers to the bank account shown in the Wallet tab, then submits amount + transaction reference.
2. You review pending requests:
   ```bash
   curl https://YOUR-URL/api/admin/recharge/list -H "x-admin-token: YOUR_ADMIN_TOKEN"
   ```
3. Approve (credits = PKR ÷ 280 × 100) or reject:
   ```bash
   curl -X POST https://YOUR-URL/api/admin/recharge/approve \
     -H "x-admin-token: YOUR_ADMIN_TOKEN" -H "Content-Type: application/json" \
     -d '{"id": 1}'
   # or /api/admin/recharge/reject
   ```

## Updating bank details

Edit `config/bank.json` — the Wallet tab reads it live (no restart needed):

```json
{
  "bankName": "Faisal Bank",
  "iban": "PK80FAYS3183704000005285",
  "accountTitle": "YOUR ACCOUNT TITLE HERE",
  "currency": "PKR"
}
```

## ffmpeg & long videos (1–10 min)

Segment stitching needs `ffmpeg`. Render's default Node image **does not include ffmpeg** — options:
- Easiest: use a Docker deploy with `FROM node:24` + `apt-get install -y ffmpeg` (add a `Dockerfile` at repo root and choose "Docker" as the Render environment).
- Fallback is built in: if ffmpeg is missing, multi-segment videos return the segments separately with an explanatory note instead of crashing.

## Security checklist

- [ ] Never commit `.env` (it's in `.gitignore`)
- [ ] Set a strong `ADMIN_TOKEN` — the default blocks nothing if left as `change-me…`
- [ ] Keep paid API keys only in the Render dashboard, never in code
- [ ] The test database (`studio.db`) is gitignored; each deploy starts fresh unless you add a disk

## Project layout

```
ai-studio-website/
├── backend/
│   ├── server.js            # Express API + static frontend
│   ├── db.js                # SQLite via node:sqlite (zero native deps)
│   ├── package.json
│   ├── providers/
│   │   ├── pollinations.js  # free images
│   │   ├── freevideo.js     # free animated-stills engine (ffmpeg Ken Burns)
│   │   ├── fal.js           # Kling 3.0
│   │   ├── gemini.js        # Veo 3.1 Fast
│   │   └── openrouter.js    # Seedance 2.5
│   └── public/              # frontend (served statically)
│       ├── index.html  styles.css  app.js
│       ├── media/  uploads/  thumbs/   (generated at runtime, gitignored)
├── config/
│   ├── pricing.json         # free tier + per-second cost/price per model
│   └── bank.json            # recharge bank details (IBAN etc.)
├── .env.example  .gitignore  README.md
```

## API quick reference

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | /api/auth/register, /api/auth/login | – | → `{token, username, credits}` |
| POST | /api/image | Bearer | `{prompt, aspect}` → `{imageUrl}` |
| POST | /api/upload | Bearer | `{dataUrl}` → `{imageUrl}` |
| POST | /api/video | Bearer | 202 `{jobId}` → poll `GET /api/job/:jobId` |
| GET | /api/pricing, /api/payment-info | – | public |
| GET | /api/wallet, /api/creations | Bearer | |
| POST | /api/recharge/request | Bearer | `{amountPkr, txRef, note}` |
| GET/POST | /api/admin/recharge/* | `x-admin-token` | list / approve / reject |
