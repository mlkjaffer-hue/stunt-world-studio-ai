// Stunt World Studio AI — frontend app (vanilla JS).
const $ = (id) => document.getElementById(id);
const state = {
  token: localStorage.getItem('sws_token') || null,
  username: localStorage.getItem('sws_user') || null,
  pricing: null,
  sel: {
    'img-aspect': '9:16', 't2v-aspect': '9:16', 'i2v-aspect': '9:16',
    't2v-duration': 5, 'i2v-duration': 5,
    't2v-model': 'free-animated', 'i2v-model': 'free-animated',
  },
  i2vImageUrl: null,
};

const DURATIONS = [
  { s: 5, label: '5s', free: true }, { s: 10, label: '10s', free: true }, { s: 15, label: '15s', free: true },
  { s: 30, label: '30s', free: false }, { s: 60, label: '1 min', free: false },
  { s: 120, label: '2 min', free: false }, { s: 300, label: '5 min', free: false }, { s: 600, label: '10 min', free: false },
];
const DUR_LABEL = Object.fromEntries(DURATIONS.map((d) => [d.s, d.label]));

// ---------- helpers ----------
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data && data.code;
    throw err;
  }
  return data;
}

function setBusy(btn, busy, label) {
  btn.disabled = busy;
  if (label !== undefined) btn.dataset.label = btn.dataset.label || btn.textContent;
  btn.textContent = busy ? '⏳ Working…' : (btn.dataset.label || btn.textContent);
}

function downloadBtn(url, filename) {
  const a = document.createElement('a');
  a.href = url; a.download = filename || 'stunt-world-studio';
  a.className = 'btn ghost'; a.textContent = '⬇ Download';
  return a;
}

// ---------- auth ----------
let authMode = 'login';
function renderAuth() {
  const area = $('auth-area');
  if (state.username) {
    area.innerHTML = `<span style="color:var(--muted);font-size:14px">👤 ${esc(state.username)}</span>
      <button class="btn ghost" id="logout-btn">Logout</button>`;
    $('logout-btn').onclick = async () => {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
      state.token = null; state.username = null;
      localStorage.removeItem('sws_token'); localStorage.removeItem('sws_user');
      renderAuth(); updateWalletChip(); toast('Logged out.');
    };
    $('wallet-chip').classList.remove('hidden');
  } else {
    area.innerHTML = `<button class="btn primary" id="login-btn">Login / Sign up</button>`;
    $('login-btn').onclick = () => { authMode = 'login'; syncAuthModal(); $('auth-modal').classList.remove('hidden'); };
    $('wallet-chip').classList.add('hidden');
  }
}
function esc(s) { return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function syncAuthModal() {
  $('auth-title').textContent = authMode === 'login' ? 'Log in' : 'Create account';
  $('auth-toggle').textContent = authMode === 'login' ? 'New here? Create an account' : 'Have an account? Log in';
}
function requireLogin() {
  if (!state.username) {
    toast('Please log in or create an account first.', 'error');
    authMode = 'login'; syncAuthModal();
    $('auth-modal').classList.remove('hidden');
    return false;
  }
  return true;
}

// ---------- tabs ----------
$('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.panel').forEach((p) => p.classList.add('hidden'));
  const tab = btn.dataset.tab;
  $('panel-' + tab).classList.remove('hidden');
  if (tab === 'pricing') renderPricing();
  if (tab === 'wallet') renderWallet();
  if (tab === 'creations') renderCreations();
});

// ---------- segmented controls ----------
function wireSeg(id, key, onChange) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $(id).querySelectorAll('button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    state.sel[key] = key.endsWith('duration') ? parseInt(b.dataset.v, 10) : b.dataset.v;
    if (onChange) onChange();
  });
}
function buildDurations(id, key, onChange) {
  $(id).innerHTML = DURATIONS.map((d) =>
    `<button data-v="${d.s}" class="${d.s === 5 ? 'on' : ''}">${d.label}<span class="badge ${d.free ? 'free' : 'paid'}">${d.free ? 'FREE' : 'PAID'}</span></button>`
  ).join('');
  wireSeg(id, key, onChange);
}

// ---------- pricing / models ----------
async function loadPricing() {
  state.pricing = await api('/api/pricing');
  const models = state.pricing.models;
  for (const selId of ['t2v-model', 'i2v-model']) {
    $(selId).innerHTML = Object.entries(models).map(([k, m]) =>
      `<option value="${k}">${esc(m.label)} ${m.paid ? '(PAID)' : '(FREE)'}</option>`
    ).join('');
  }
  updateModelHints(); updateCostLines();
}
function modelCfg(k) { return state.pricing.models[k]; }
function updateModelHints() {
  for (const [selId, hintId] of [['t2v-model', 't2v-model-hint'], ['i2v-model', 'i2v-model-hint']]) {
    const m = modelCfg($(selId).value);
    state.sel[selId] = $(selId).value;
    $(hintId).textContent = m.description + (m.paid ? ' — Paid model, billed per second from your credits.' : ' — Free, no credits needed.');
  }
  updateCostLines();
}
function costFor(modelKey, dur) {
  const m = modelCfg(modelKey);
  if (!m.paid) return { credits: 0, usd: 0 };
  const usd = dur * m.pricePerSecUsd;
  return { credits: Math.ceil(usd * 100), usd };
}
function updateCostLines() {
  for (const [mKey, dKey, el] of [['t2v-model', 't2v-duration', 't2v-cost'], ['i2v-model', 'i2v-duration', 'i2v-cost']]) {
    const model = state.sel[mKey], dur = state.sel[dKey];
    const c = costFor(model, dur);
    $(el).textContent = c.credits === 0
      ? `✅ FREE — ${DUR_LABEL[dur]} video`
      : `💰 Cost: ${c.credits} credits ($${c.usd.toFixed(2)}) for ${DUR_LABEL[dur]}`;
  }
}

// ---------- image ----------
async function generateImage() {
  if (!requireLogin()) return;
  const btn = $('img-generate');
  const prompt = $('img-prompt').value.trim();
  if (prompt.length < 3) return toast('Please enter a prompt.', 'error');
  setBusy(btn, true);
  $('img-result').innerHTML = `<div class="spinner"><div class="ring"></div>Painting your image…</div>`;
  try {
    const r = await api('/api/image', { method: 'POST', body: { prompt, aspect: state.sel['img-aspect'] } });
    $('img-result').innerHTML = '';
    const img = document.createElement('img');
    img.src = r.imageUrl; img.alt = esc(prompt);
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.appendChild(downloadBtn(r.imageUrl, 'sws-image.jpg'));
    $('img-result').append(img, actions);
    updateWalletChip();
  } catch (e) {
    $('img-result').innerHTML = '';
    toast(e.message, 'error');
  } finally { setBusy(btn, false); }
}

// ---------- video ----------
async function generateVideo(mode) {
  if (!requireLogin()) return;
  const pfx = mode === 'text-to-video' ? 't2v' : 'i2v';
  const btn = $(pfx + '-generate');
  const prompt = $(pfx + '-prompt').value.trim();
  if (prompt.length < 3) return toast('Please enter a prompt.', 'error');
  const model = state.sel[pfx + '-model'];
  const durationSec = state.sel[pfx + '-duration'];
  const aspect = state.sel[pfx + '-aspect'];
  const imageUrl = mode === 'image-to-video' ? state.i2vImageUrl : null;
  if (mode === 'image-to-video' && !imageUrl) return toast('Please upload a start image first.', 'error');

  setBusy(btn, true);
  const resEl = $(pfx + '-result');
  resEl.innerHTML = `<div class="spinner"><div class="ring"></div><div>Queued… starting generation.</div><div class="progress-note" id="${pfx}-prog"></div></div>`;
  try {
    const r = await api('/api/video', {
      method: 'POST',
      body: { mode, model, durationSec, prompt, imageUrl, aspect },
    });
    if (r.costCredits) toast(`Charged ${r.costCredits} credits.`, 'success');
    updateWalletChip();
    // Poll job status.
    const prog = $(pfx + '-prog');
    for (;;) {
      await new Promise((x) => setTimeout(x, 5000));
      const job = await api('/api/job/' + r.jobId);
      if (prog) prog.textContent = job.status === 'done' || job.status === 'failed' ? '' : 'Status: ' + job.status + ' — this can take a few minutes for long videos.';
      if (job.status === 'done') {
        resEl.innerHTML = '';
        const v = document.createElement('video');
        v.src = job.mediaUrl; v.controls = true; v.playsInline = true;
        if (job.thumbUrl) v.poster = job.thumbUrl;
        const actions = document.createElement('div');
        actions.className = 'actions';
        actions.appendChild(downloadBtn(job.mediaUrl, 'sws-video.mp4'));
        resEl.append(v, actions);
        if (job.note) toast(job.note);
        if (job.segments) {
          const p = document.createElement('p');
          p.className = 'hint center';
          p.innerHTML = 'Segments: ' + job.segments.map((s, i) => `<a href="${s}" download>part ${i + 1}</a>`).join(' · ');
          resEl.append(p);
        }
        toast('Video ready! 🎬', 'success');
        break;
      }
      if (job.status === 'failed') {
        resEl.innerHTML = '';
        throw new Error(job.error || 'Video generation failed.');
      }
    }
  } catch (e) {
    resEl.innerHTML = '';
    toast(e.message, 'error');
    if (e.code === 'INSUFFICIENT_CREDITS' || e.code === 'MODEL_NOT_CONFIGURED') switchTab('wallet');
    updateWalletChip();
  } finally { setBusy(btn, false); }
}

function switchTab(name) {
  document.querySelector(`.tab[data-tab="${name}"]`).click();
}

// ---------- upload ----------
function wireUpload() {
  const drop = $('i2v-drop'), file = $('i2v-file'), prev = $('i2v-preview');
  drop.onclick = (e) => { if (e.target.closest('img')) return; file.click(); };
  file.onchange = async () => {
    const f = file.files[0];
    if (!f) return;
    if (!requireLogin()) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        toast('Uploading image…');
        const r = await api('/api/upload', { method: 'POST', body: { dataUrl: reader.result } });
        state.i2vImageUrl = r.imageUrl;
        prev.innerHTML = `<img src="${r.imageUrl}" alt="start frame" />`;
        toast('Start image ready.', 'success');
      } catch (e) { toast(e.message, 'error'); }
    };
    reader.readAsDataURL(f);
  };
}

// ---------- pricing tab ----------
function renderPricing() {
  const tb = document.querySelector('#rates-table tbody');
  const models = state.pricing.models;
  tb.innerHTML = Object.entries(models).filter(([, m]) => m.paid).map(([k, m]) => {
    const per = (s) => '$' + (s * m.pricePerSecUsd).toFixed(2);
    return `<tr><td><b>${esc(m.label)}</b></td><td>${esc(m.provider || '')}</td>
      <td>$${m.pricePerSecUsd.toFixed(3)}/s</td><td>${per(30)}</td><td>${per(60)}</td></tr>`;
  }).join('');
  const ft = state.pricing.freeTier;
  tb.innerHTML += `<tr><td><b>${esc(models['free-animated'].label)}</b></td><td>built-in</td>
    <td>$0</td><td colspan="2">Free up to ${ft.maxFreeSeconds}s · ${ft.freeVideosPerDay}/day</td></tr>`;
}

// ---------- wallet ----------
async function updateWalletChip() {
  if (!state.username) return;
  try {
    const w = await api('/api/wallet');
    $('chip-credits').textContent = w.credits;
  } catch { /* ignore */ }
}

async function renderWallet() {
  if (!requireLogin()) { switchTab('image'); return; }
  const box = $('wallet-summary');
  box.innerHTML = `<div class="spinner"><div class="ring"></div></div>`;
  try {
    const [w, pay] = await Promise.all([api('/api/wallet'), api('/api/payment-info')]);
    $('chip-credits').textContent = w.credits;
    box.innerHTML = `
      <div class="stat"><div class="v">🪙 ${w.credits}</div><div class="k">credits ($${(w.credits * w.creditValueUsd).toFixed(2)})</div></div>
      <div class="stat"><div class="v">🎬 ${w.freeVideosLeft}/${w.freeVideosPerDay}</div><div class="k">free videos left today</div></div>
      <div class="stat"><div class="v">🖼 ${w.imagesLeft}/${w.imagesPerDay}</div><div class="k">free images left today</div></div>`;
    const b = pay.bank;
    $('bank-card').innerHTML = `
      <div>🏦 Bank: <b>${esc(b.bankName)}</b></div>
      <div>🔢 IBAN: <b>${esc(b.iban)}</b></div>
      <div>👤 Account title: <b>${esc(b.accountTitle)}</b></div>
      <div>💱 Rate: <b>${pay.rate.pkrPerUsd} PKR = $1</b> → credits = PKR ÷ ${pay.rate.pkrPerUsd} × 100</div>
      <div class="hint">${esc(b.note || '')}</div>`;
    const mines = await api('/api/recharge/mine');
    $('rech-list').innerHTML = mines.length ? mines.map((r) =>
      `<div class="rech-item"><span>PKR ${r.amount_pkr} · <small>${esc(r.tx_ref)}</small></span><span class="status ${r.status}">${r.status}</span></div>`
    ).join('') : `<p class="hint">No recharge requests yet.</p>`;
  } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
}

async function submitRecharge() {
  if (!requireLogin()) return;
  const amountPkr = $('rech-amount').value, txRef = $('rech-txref').value.trim(), note = $('rech-note').value.trim();
  try {
    await api('/api/recharge/request', { method: 'POST', body: { amountPkr, txRef, note } });
    toast('Recharge request submitted. Credits will appear after owner approval.', 'success');
    $('rech-amount').value = ''; $('rech-txref').value = ''; $('rech-note').value = '';
    renderWallet();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------- creations ----------
async function renderCreations() {
  if (!requireLogin()) { switchTab('image'); return; }
  const grid = $('creations-grid');
  grid.innerHTML = `<div class="spinner"><div class="ring"></div></div>`;
  try {
    const rows = await api('/api/creations');
    if (!rows.length) { grid.innerHTML = `<p class="empty">Nothing here yet — go create something! 🎬</p>`; return; }
    grid.innerHTML = rows.map((c) => {
      const media = c.kind === 'image'
        ? `<img src="${c.media_url}" loading="lazy" alt="" />`
        : (c.media_url ? `<video src="${c.media_url}" controls playsinline ${c.thumb_url ? `poster="${c.thumb_url}"` : ''}></video>` : `<div class="empty">${esc(c.status)}</div>`);
      return `<div class="creation">${media}
        <div class="meta"><div class="p">${esc(c.prompt)}</div>
        <div>${esc(c.kind)} · ${esc(c.model)}${c.duration_sec ? ' · ' + (DUR_LABEL[c.duration_sec] || (c.duration_sec + 's')) : ''} · ${esc(c.status)}</div></div></div>`;
    }).join('');
  } catch (e) { grid.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
}

// ---------- init ----------
function init() {
  renderAuth();
  wireSeg('img-aspect', 'img-aspect');
  wireSeg('t2v-aspect', 't2v-aspect');
  wireSeg('i2v-aspect', 'i2v-aspect');
  buildDurations('t2v-duration', 't2v-duration', updateCostLines);
  buildDurations('i2v-duration', 'i2v-duration', updateCostLines);
  $('t2v-model').addEventListener('change', updateModelHints);
  $('i2v-model').addEventListener('change', updateModelHints);
  $('img-generate').onclick = generateImage;
  $('t2v-generate').onclick = () => generateVideo('text-to-video');
  $('i2v-generate').onclick = () => generateVideo('image-to-video');
  $('rech-submit').onclick = submitRecharge;
  wireUpload();
  $('auth-close').onclick = () => $('auth-modal').classList.add('hidden');
  $('auth-toggle').onclick = (e) => { e.preventDefault(); authMode = authMode === 'login' ? 'register' : 'login'; syncAuthModal(); };
  $('auth-submit').onclick = async () => {
    const username = $('auth-username').value.trim(), password = $('auth-password').value;
    try {
      const r = await api('/api/auth/' + authMode, { method: 'POST', body: { username, password } });
      state.token = r.token; state.username = r.username;
      localStorage.setItem('sws_token', r.token); localStorage.setItem('sws_user', r.username);
      $('auth-modal').classList.add('hidden');
      $('auth-password').value = '';
      renderAuth(); updateWalletChip();
      toast(`Welcome, ${r.username}! 🎬`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  };
  loadPricing().catch((e) => toast('Could not load pricing: ' + e.message, 'error'));
  if (state.username) updateWalletChip();
}
document.addEventListener('DOMContentLoaded', init);
