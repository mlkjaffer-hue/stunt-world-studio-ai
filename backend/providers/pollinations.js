// Pollinations free image generation (no API key required for basic use).
// Docs: https://github.com/pollinations/pollinations
const { ProviderError, fetchBuffer, sleep } = require('./helpers');

const ASPECT_SIZE = {
  '9:16': { width: 768, height: 1344 },
  '16:9': { width: 1280, height: 720 },
  '1:1': { width: 1024, height: 1024 },
};

async function generateImage(prompt, { aspect = '9:16', model = 'sana' } = {}) {
  const size = ASPECT_SIZE[aspect] || ASPECT_SIZE['9:16'];
  const seed = Math.floor(Math.random() * 1000000);
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=${size.width}&height=${size.height}&model=${model}&seed=${seed}&nologo=true`;

  // Pollinations is a free community service — it can be rate-limited.
  // Retry a few times with backoff, then surface a friendly error.
  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const buf = await fetchBuffer(url, { timeoutMs: 180000 });
      if (buf.length < 5000) throw new ProviderError('Image service returned an empty response', { status: 502 });
      return { buffer: buf, seed };
    } catch (err) {
      lastErr = err;
      if (attempt < 4) await sleep(attempt * 4000);
    }
  }
  throw new ProviderError(
    'The free image service is busy right now (rate limited). Please wait a minute and try again. ' +
    `(detail: ${lastErr && lastErr.message ? lastErr.message.slice(0, 120) : 'unknown'})`,
    { status: 503 }
  );
}

module.exports = { generateImage, ASPECT_SIZE };
