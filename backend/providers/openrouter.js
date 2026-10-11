// ByteDance Seedance 2.5 via OpenRouter's video API.
// Needs OPENROUTER_KEY in env. Docs: https://openrouter.ai/docs
// NOTE: OpenRouter's video API surface evolves; if a generation fails with a
// schema error after you add your key, check the current docs and adjust the
// request body below — the polling + download logic stays the same.
const fs = require('fs');
const { fetchJson, fetchBuffer, sleep, NotConfiguredError, ProviderError } = require('./helpers');

const MODEL = 'bytedance/seedance-2.5';

function key() {
  const k = process.env.OPENROUTER_KEY;
  if (!k) throw new NotConfiguredError('Seedance 2.5');
  return k;
}
function headers() {
  return {
    Authorization: `Bearer ${key()}`,
    'HTTP-Referer': process.env.PUBLIC_BASE_URL || 'http://localhost:3000',
    'X-Title': 'Stunt World Studio AI',
  };
}

// Seedance 2.5 supports 4–30s clips; we cap segments at 30s.
async function generateSeedanceSegment({ prompt, imageUrl, durationSec, aspect, outPath }) {
  const seconds = Math.min(30, Math.max(4, Math.round(durationSec)));
  const body = {
    model: MODEL,
    prompt,
    duration: seconds,
    aspect_ratio: aspect === '16:9' ? '16:9' : aspect === '1:1' ? '1:1' : '9:16',
  };
  if (imageUrl) body.image = imageUrl;

  const created = await fetchJson('https://openrouter.ai/api/v1/videos', {
    method: 'POST', headers: headers(), body, timeoutMs: 60000,
  });

  // Accept either a synchronous result or a task id to poll.
  let videoUrl = created?.data?.url || created?.url || created?.data?.video_url;
  const taskId = created?.id || created?.data?.id;

  const started = Date.now();
  while (!videoUrl && taskId && Date.now() - started < 10 * 60 * 1000) {
    await sleep(8000);
    const poll = await fetchJson(`https://openrouter.ai/api/v1/videos/${encodeURIComponent(taskId)}`, {
      headers: headers(), timeoutMs: 30000,
    });
    const d = poll?.data || poll || {};
    if (d.status === 'failed' || d.error) {
      throw new ProviderError(`Seedance generation failed: ${JSON.stringify(d.error || d.status).slice(0, 300)}`, { status: 502 });
    }
    videoUrl = d.url || d.video_url;
  }
  if (!videoUrl) throw new ProviderError('Seedance did not return a video URL (check OpenRouter dashboard for the task status)', { status: 502 });

  const buf = await fetchBuffer(videoUrl, { timeoutMs: 300000 });
  fs.writeFileSync(outPath, buf);
  return outPath;
}

module.exports = { generateSeedanceSegment };
