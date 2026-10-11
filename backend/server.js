// Stunt World Studio AI — backend server.
// Serves the frontend from ./public and exposes the JSON API.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const bcrypt = require('bcryptjs');
const { stmts } = require('./db');
const { generateImage } = require('./providers/pollinations');
const { animateSegment, makePoster, stitchSegments, checkFfmpeg } = require('./providers/freevideo');
const { generateKlingSegment } = require('./providers/fal');
const { generateVeoSegment } = require('./providers/gemini');
const { generateSeedanceSegment } = require('./providers/openrouter');
const { ProviderError } = require('./providers/helpers');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

app.use(express.json({ limit: '20mb' }));

// ---------- static dirs ----------
const PUB = path.join(__dirname, 'public');
for (const d of ['media', 'uploads', 'thumbs']) fs.mkdirSync(path.join(PUB, d), { recursive: true });
const WORK = path.join(__dirname, 'work');
fs.mkdirSync(WORK, { recursive: true });
app.use(express.static(PUB));

// ---------- config (re-read per request so owner edits apply without restart) ----------
const pricingPath = path.join(__dirname, '..', 'config', 'pricing.json');
const bankPath = path.join(__dirname, '..', 'config', 'bank.json');
const loadPricing = () => JSON.parse(fs.readFileSync(pricingPath, 'utf8'));
const loadBank = () => JSON.parse(fs.readFileSync(bankPath, 'utf8'));

// ---------- auth ----------
function authUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  return stmts.getSession.get(token) || null;
}
const requireAuth = (req, res, next) => {
  const s = authUser(req);
  if (!s) return res.status(401).json({ error: 'Please log in first.' });
  req.user = { id: s.user_id, username: s.username };
  next();
};
const requireAdmin = (req, res, next) => {
  const t = req.headers['x-admin-token'];
  if (!t || t !== process.env.ADMIN_TOKEN) return res.status(403).json({ error: 'Admin token invalid.' });
  next();
};

app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username))
    return res.status(400).json({ error: 'Username must be 3–20 letters/numbers.' });
  if (!password || password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (stmts.getUserByName.get(username))
    return res.status(400).json({ error: 'Username already taken.' });
  const hash = bcrypt.hashSync(password, 10);
  const info = stmts.createUser.run(username, hash);
  const token = crypto.randomBytes(24).toString('hex');
  stmts.createSession.run(token, info.lastInsertRowid);
  res.json({ token, username, credits: 0 });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = stmts.getUserByName.get(username || '');
  if (!u || !bcrypt.compareSync(password || '', u.password_hash))
    return res.status(401).json({ error: 'Wrong username or password.' });
  const token = crypto.randomBytes(24).toString('hex');
  stmts.createSession.run(token, u.id);
  res.json({ token, username: u.username, credits: u.credits });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const h = req.headers.authorization || '';
  stmts.deleteSession.run(h.slice(7));
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const u = stmts.getUserById.get(req.user.id);
  res.json({ username: u.username, credits: u.credits });
});

// ---------- public info ----------
app.get('/api/pricing', (req, res) => res.json(loadPricing()));
app.get('/api/payment-info', (req, res) => {
  const p = loadPricing();
  res.json({ bank: loadBank(), rate: p.credits });
});

// ---------- wallet ----------
app.get('/api/wallet', requireAuth, (req, res) => {
  const p = loadPricing();
  const u = stmts.getUserById.get(req.user.id);
  const usedV = stmts.countTodayVideos.get(req.user.id).c;
  const usedI = stmts.countTodayImages.get(req.user.id).c;
  res.json({
    username: u.username,
    credits: u.credits,
    creditValueUsd: p.credits.usdPerCredit,
    freeVideosLeft: Math.max(0, p.freeTier.freeVideosPerDay - usedV),
    freeVideosPerDay: p.freeTier.freeVideosPerDay,
    imagesLeft: Math.max(0, p.freeTier.imagesPerDay - usedI),
    imagesPerDay: p.freeTier.imagesPerDay,
  });
});

// ---------- image generation (free) ----------
const ALLOWED_ASPECTS = ['9:16', '16:9', '1:1'];

app.post('/api/image', requireAuth, async (req, res) => {
  const { prompt, aspect = '9:16' } = req.body || {};
  if (!prompt || prompt.trim().length < 3)
    return res.status(400).json({ error: 'Please enter a prompt.' });
  if (!ALLOWED_ASPECTS.includes(aspect))
    return res.status(400).json({ error: 'Invalid aspect ratio.' });
  const p = loadPricing();
  const usedI = stmts.countTodayImages.get(req.user.id).c;
  if (usedI >= p.freeTier.imagesPerDay)
    return res.status(429).json({ error: `Daily free image limit reached (${p.freeTier.imagesPerDay}/day). Try again tomorrow.` });

  try {
    const { buffer } = await generateImage(prompt.trim(), { aspect });
    const name = `img_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.jpg`;
    fs.writeFileSync(path.join(PUB, 'media', name), buffer);
    const mediaUrl = `/media/${name}`;
    stmts.addCreation.run(req.user.id, 'image', 'pollinations', prompt.trim().slice(0, 500), null, aspect, mediaUrl, mediaUrl, 'done', 0);
    res.json({ imageUrl: mediaUrl });
  } catch (err) {
    const status = err.status || 500;
    stmts.addCreation.run(req.user.id, 'image', 'pollinations', (prompt || '').slice(0, 500), null, aspect, null, null, 'failed', 0);
    res.status(status).json({ error: err.message || 'Image generation failed.' });
  }
});

// ---------- image upload (for image-to-video) ----------
app.post('/api/upload', requireAuth, (req, res) => {
  const { dataUrl } = req.body || {};
  const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) return res.status(400).json({ error: 'Invalid image upload.' });
  const ext = m[1] === 'png' ? 'png' : m[1] === 'webp' ? 'webp' : 'jpg';
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'Image too large (max 8MB).' });
  const name = `up_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(PUB, 'uploads', name), buf);
  res.json({ imageUrl: `/uploads/${name}` });
});

// ---------- video generation ----------
const ALLOWED_DURATIONS = [5, 10, 15, 30, 60, 120, 300, 600];
const jobs = new Map(); // jobId -> { status, creationId, mediaUrl, error }

function costCredits(modelCfg, durationSec) {
  // epsilon avoids float artefacts like 10*0.168*100 = 168.00000000000003 -> 169
  return Math.ceil(durationSec * modelCfg.pricePerSecUsd * 100 - 1e-6);
}

app.post('/api/video', requireAuth, (req, res) => {
  const { mode = 'text-to-video', model = 'free-animated', durationSec = 5, prompt, imageUrl, aspect = '9:16' } = req.body || {};
  const p = loadPricing();
  const modelCfg = p.models[model];
  if (!modelCfg) return res.status(400).json({ error: 'Unknown model.' });
  if (!ALLOWED_DURATIONS.includes(durationSec)) return res.status(400).json({ error: 'Invalid duration.' });
  if (!['text-to-video', 'image-to-video'].includes(mode)) return res.status(400).json({ error: 'Invalid mode.' });
  if (!ALLOWED_ASPECTS.includes(aspect)) return res.status(400).json({ error: 'Invalid aspect ratio.' });
  if (!prompt || prompt.trim().length < 3) return res.status(400).json({ error: 'Please enter a prompt.' });
  if (mode === 'image-to-video' && !imageUrl) return res.status(400).json({ error: 'Please upload a start image first.' });

  // Paid-model availability check BEFORE touching credits.
  if (modelCfg.paid) {
    const need =
      model === 'kling' ? 'FAL_KEY' :
      model === 'veo' ? 'GEMINI_API_KEY' : 'OPENROUTER_KEY';
    if (!process.env[need]) {
      return res.status(402).json({
        error: `${modelCfg.label} is a paid model and is not configured by the site owner yet. Use the Free model, or ask the owner to add an API key.`,
        code: 'MODEL_NOT_CONFIGURED',
      });
    }
  } else if (durationSec > p.freeTier.maxFreeSeconds) {
    return res.status(400).json({ error: `The Free model supports up to ${p.freeTier.maxFreeSeconds}s. Choose a paid model for longer videos.` });
  }

  // Free daily quota.
  if (!modelCfg.paid) {
    const used = stmts.countTodayVideos.get(req.user.id).c;
    if (used >= p.freeTier.freeVideosPerDay) {
      return res.status(429).json({
        error: `Daily free limit reached (${p.freeTier.freeVideosPerDay} free videos/day). Come back tomorrow or use a paid model.`,
        code: 'FREE_QUOTA_EXCEEDED',
      });
    }
  }

  const cost = modelCfg.paid ? costCredits(modelCfg, durationSec) : 0;
  const user = stmts.getUserById.get(req.user.id);
  if (user.credits < cost) {
    return res.status(402).json({
      error: `Not enough credits. This video costs ${cost} credits ($${(cost / 100).toFixed(2)}). Recharge from the Wallet tab.`,
      code: 'INSUFFICIENT_CREDITS',
      needed: cost,
      balance: user.credits,
    });
  }

  if (cost > 0) stmts.addCredits.run(-cost, req.user.id);
  const cleanPrompt = prompt.trim().slice(0, 800);
  const cInfo = stmts.addCreation.run(
    req.user.id, 'video', model, cleanPrompt, durationSec, aspect, null, null, 'processing', cost
  );
  const creationId = cInfo.lastInsertRowid;
  const jobId = crypto.randomBytes(12).toString('hex');
  jobs.set(jobId, { status: 'queued', creationId, mediaUrl: null, thumbUrl: null, error: null });

  // Run in background; the client polls /api/job/:jobId.
  runVideoJob(jobId, {
    creationId, userId: req.user.id, mode, model, modelCfg, durationSec,
    prompt: cleanPrompt, imageUrl: imageUrl || null, aspect, cost,
  }).catch(() => { /* errors are recorded on the job */ });

  res.status(202).json({ jobId, creationId, status: 'queued', costCredits: cost });
});

app.get('/api/job/:jobId', requireAuth, (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json(job);
});

async function runVideoJob(jobId, j) {
  const job = jobs.get(jobId);
  const fail = (message, refundable = true) => {
    if (refundable && j.cost > 0) stmts.addCredits.run(j.cost, j.userId); // refund
    job.status = 'failed';
    job.error = message;
    stmts.markCreationFailed.run(j.creationId);
  };
  try {
    job.status = 'running';
    const segLen = Math.min(j.modelCfg.maxSegmentSeconds, j.durationSec);
    const nSeg = Math.ceil(j.durationSec / segLen);
    const tag = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const segPaths = [];

    for (let i = 0; i < nSeg; i++) {
      const thisLen = i === nSeg - 1 ? j.durationSec - segLen * (nSeg - 1) : segLen;
      const segPrompt = nSeg > 1 ? `${j.prompt} (part ${i + 1} of ${nSeg}, seamless continuation)` : j.prompt;
      const segPath = path.join(WORK, `seg_${tag}_${i}.mp4`);

      if (j.model === 'free-animated') {
        // Fresh AI still per segment, alternating push-in / pull-out.
        const imgPrompt = nSeg > 1 ? `${j.prompt} (cinematic still, shot ${i + 1})` : j.prompt;
        let imgPath;
        if (j.imageUrl && i === 0 && nSeg === 1) {
          imgPath = path.join(PUB, j.imageUrl.replace(/^\//, ''));
        } else if (j.imageUrl) {
          imgPath = path.join(PUB, j.imageUrl.replace(/^\//, '')); // reuse uploaded start frame
        } else {
          const { buffer } = await generateImage(imgPrompt, { aspect: j.aspect });
          imgPath = path.join(WORK, `still_${tag}_${i}.jpg`);
          fs.writeFileSync(imgPath, buffer);
        }
        await animateSegment(imgPath, segPath, thisLen, { aspect: j.aspect, zoomIn: i % 2 === 0 });
      } else if (j.model === 'kling') {
        const absImg = j.imageUrl ? `${PUBLIC_BASE_URL}${j.imageUrl}` : null;
        await generateKlingSegment({ prompt: segPrompt, imageUrl: absImg, durationSec: thisLen, aspect: j.aspect, outPath: segPath });
      } else if (j.model === 'veo') {
        let b64 = null;
        if (j.imageUrl) {
          const local = path.join(PUB, j.imageUrl.replace(/^\//, ''));
          if (fs.existsSync(local)) b64 = fs.readFileSync(local).toString('base64');
        }
        await generateVeoSegment({ prompt: segPrompt, imageBase64: b64, durationSec: thisLen, aspect: j.aspect, outPath: segPath });
      } else if (j.model === 'seedance') {
        const absImg = j.imageUrl ? `${PUBLIC_BASE_URL}${j.imageUrl}` : null;
        await generateSeedanceSegment({ prompt: segPrompt, imageUrl: absImg, durationSec: thisLen, aspect: j.aspect, outPath: segPath });
      }
      segPaths.push(segPath);
      job.status = `running (${i + 1}/${nSeg} segments)`;
    }

    let finalName = `vid_${tag}.mp4`;
    let finalPath = path.join(PUB, 'media', finalName);
    let note = null;
    if (segPaths.length > 1) {
      const hasFfmpeg = await checkFfmpeg();
      if (hasFfmpeg) {
        await stitchSegments(segPaths, finalPath, WORK);
      } else {
        // Fallback: expose segments separately.
        note = 'ffmpeg is not available on this server, so segments are returned separately.';
        const urls = [];
        for (let i = 0; i < segPaths.length; i++) {
          const sn = `vid_${tag}_part${i + 1}.mp4`;
          fs.renameSync(segPaths[i], path.join(PUB, 'media', sn));
          urls.push(`/media/${sn}`);
        }
        job.status = 'done';
        job.mediaUrl = urls[0];
        job.segments = urls;
        job.note = note;
        stmts.updateCreation.run('done', urls[0], null, j.creationId);
        return;
      }
    } else {
      fs.renameSync(segPaths[0], finalPath);
    }

    const posterName = `thumb_${tag}.jpg`;
    const posterPath = path.join(PUB, 'thumbs', posterName);
    try { await makePoster(finalPath, posterPath); } catch { /* poster optional */ }
    const thumbUrl = fs.existsSync(posterPath) ? `/thumbs/${posterName}` : null;

    job.status = 'done';
    job.mediaUrl = `/media/${finalName}`;
    job.thumbUrl = thumbUrl;
    if (note) job.note = note;
    stmts.updateCreation.run('done', `/media/${finalName}`, thumbUrl, j.creationId);
  } catch (err) {
    const msg = err instanceof ProviderError ? err.message : `Video job failed: ${(err && err.message || 'unknown error').slice(0, 300)}`;
    fail(msg, !(err instanceof ProviderError) || err.refundable !== false);
  } finally {
    // Clean this job's temp segment/still files (final media is kept).
    try {
      for (const f of fs.readdirSync(WORK)) {
        if (f.includes(tag)) {
          try { fs.unlinkSync(path.join(WORK, f)); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }
}

// ---------- creations ----------
app.get('/api/creations', requireAuth, (req, res) => {
  res.json(stmts.listCreations.all(req.user.id));
});

// ---------- recharge (manual bank transfer) ----------
app.post('/api/recharge/request', requireAuth, (req, res) => {
  const { amountPkr, txRef, note } = req.body || {};
  const amt = parseInt(amountPkr, 10);
  if (!amt || amt < 100) return res.status(400).json({ error: 'Minimum recharge is PKR 100.' });
  if (!txRef || String(txRef).trim().length < 4)
    return res.status(400).json({ error: 'Please enter your bank transaction reference.' });
  const info = stmts.createRecharge.run(req.user.id, amt, String(txRef).trim(), (note || '').slice(0, 300));
  res.json({ ok: true, id: info.lastInsertRowid, status: 'pending' });
});

app.get('/api/recharge/mine', requireAuth, (req, res) => {
  const rows = stmts.listUserRecharges.all(req.user.id);
  res.json(rows);
});

app.get('/api/admin/recharge/list', requireAdmin, (req, res) => {
  res.json(stmts.listRecharges.all());
});

app.post('/api/admin/recharge/approve', requireAdmin, (req, res) => {
  const { id } = req.body || {};
  const r = stmts.getRecharge.get(id);
  if (!r) return res.status(404).json({ error: 'Recharge not found.' });
  if (r.status !== 'pending') return res.status(400).json({ error: `Already ${r.status}.` });
  const p = loadPricing();
  const credits = Math.round(r.amount_pkr / p.credits.pkrPerUsd / p.credits.usdPerCredit);
  stmts.addCredits.run(credits, r.user_id);
  stmts.setRechargeStatus.run('approved', id);
  res.json({ ok: true, creditsAdded: credits });
});

app.post('/api/admin/recharge/reject', requireAdmin, (req, res) => {
  const { id } = req.body || {};
  const r = stmts.getRecharge.get(id);
  if (!r) return res.status(404).json({ error: 'Recharge not found.' });
  if (r.status !== 'pending') return res.status(400).json({ error: `Already ${r.status}.` });
  stmts.setRechargeStatus.run('rejected', id);
  res.json({ ok: true });
});

// ---------- fallback ----------
app.get('*', (req, res) => res.sendFile(path.join(PUB, 'index.html')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Server error. Please try again.' });
});

app.listen(PORT, () => {
  console.log(`Stunt World Studio AI running on http://localhost:${PORT}`);
  if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.startsWith('change-me')) {
    console.warn('WARNING: ADMIN_TOKEN is still the default. Change it before going live!');
  }
  for (const [m, env] of [['kling', 'FAL_KEY'], ['veo', 'GEMINI_API_KEY'], ['seedance', 'OPENROUTER_KEY']]) {
    if (!process.env[env]) console.log(`- Paid model '${m}' not configured (missing ${env}); it will return 402 until you add a key.`);
  }
});
