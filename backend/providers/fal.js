// Kling 3.0 via fal.ai queue API.
// Needs FAL_KEY in env. Docs: https://fal.ai/models/fal-ai/kling-video
const fs = require('fs');
const { fetchJson, fetchBuffer, sleep, NotConfiguredError, ProviderError } = require('./helpers');

const APP = 'fal-ai/kling-video/v3.0/standard';
const BASE = 'https://queue.fal.run';

function key() {
  const k = process.env.FAL_KEY;
  if (!k) throw new NotConfiguredError('Kling 3.0');
  return k;
}
const auth = () => ({ Authorization: `Key ${key()}` });

async function submit({ prompt, imageUrl, durationSec, aspect }) {
  const mode = imageUrl ? 'image-to-video' : 'text-to-video';
  // Kling v3 clips are 5s or 10s.
  const duration = durationSec <= 5 ? '5' : '10';
  const body = {
    prompt,
    duration,
    aspect_ratio: aspect === '16:9' ? '16:9' : aspect === '1:1' ? '1:1' : '9:16',
  };
  if (imageUrl) body.image_url = imageUrl;
  const data = await fetchJson(`${BASE}/${APP}/${mode}`, {
    method: 'POST', headers: auth(), body, timeoutMs: 60000,
  });
  if (!data.request_id) throw new ProviderError('fal.ai did not return a request id', { status: 502 });
  return data.request_id;
}

async function waitFor(requestId, timeoutMs = 10 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const st = await fetchJson(`${BASE}/${APP}/requests/${requestId}/status`, {
      headers: auth(), timeoutMs: 30000,
    });
    if (st.status === 'COMPLETED') {
      const res = await fetchJson(`${BASE}/${APP}/requests/${requestId}/result`, {
        headers: auth(), timeoutMs: 60000,
      });
      const url = res?.video?.url || res?.video_url;
      if (!url) throw new ProviderError('fal.ai completed but returned no video URL', { status: 502 });
      return url;
    }
    if (st.status === 'FAILED') {
      throw new ProviderError(`Kling generation failed: ${JSON.stringify(st.error || st).slice(0, 300)}`, { status: 502 });
    }
    await sleep(5000);
  }
  throw new ProviderError('Kling generation timed out after 10 minutes', { status: 504 });
}

async function generateKlingSegment({ prompt, imageUrl, durationSec, aspect, outPath }) {
  const requestId = await submit({ prompt, imageUrl, durationSec, aspect });
  const url = await waitFor(requestId);
  const buf = await fetchBuffer(url, { timeoutMs: 300000 });
  fs.writeFileSync(outPath, buf);
  return outPath;
}

module.exports = { generateKlingSegment };
