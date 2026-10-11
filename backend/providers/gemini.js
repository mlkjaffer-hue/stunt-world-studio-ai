// Google Veo 3.1 Fast via the Gemini API (long-running predict operation).
// Needs GEMINI_API_KEY in env. Docs: https://ai.google.dev/gemini-api/docs/video
const fs = require('fs');
const { fetchJson, fetchBuffer, sleep, NotConfiguredError, ProviderError } = require('./helpers');

const MODEL = 'veo-3.1-fast-generate-preview';

function key() {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new NotConfiguredError('Veo 3.1 Fast');
  return k;
}

async function generateVeoSegment({ prompt, imageBase64, durationSec, aspect, outPath }) {
  const k = key();
  const instance = { prompt };
  if (imageBase64) {
    instance.image = { bytesBase64Encoded: imageBase64, mimeType: 'image/jpeg' };
  }
  // Veo Fast clips: 4–8 seconds.
  const durationSeconds = Math.min(8, Math.max(4, Math.round(durationSec)));
  const op = await fetchJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:predictLongRunning?key=${encodeURIComponent(k)}`,
    {
      method: 'POST',
      body: {
        instances: [instance],
        parameters: {
          aspectRatio: aspect === '16:9' ? '16:9' : '9:16',
          durationSeconds,
        },
      },
      timeoutMs: 60000,
    }
  );
  const opName = op && op.name;
  if (!opName) throw new ProviderError('Gemini API did not return an operation name', { status: 502 });

  const started = Date.now();
  while (Date.now() - started < 10 * 60 * 1000) {
    const poll = await fetchJson(
      `https://generativelanguage.googleapis.com/v1beta/${opName}?key=${encodeURIComponent(k)}`,
      { timeoutMs: 30000 }
    );
    if (poll.error) {
      throw new ProviderError(`Veo generation failed: ${JSON.stringify(poll.error).slice(0, 300)}`, { status: 502 });
    }
    if (poll.done) {
      const sample = poll.response && poll.response.generatedSamples && poll.response.generatedSamples[0];
      const uri = sample && sample.video && sample.video.uri;
      if (!uri) throw new ProviderError('Veo finished but returned no video URI', { status: 502 });
      const buf = await fetchBuffer(`${uri}&key=${encodeURIComponent(k)}`, { timeoutMs: 300000 });
      fs.writeFileSync(outPath, buf);
      return outPath;
    }
    await sleep(8000);
  }
  throw new ProviderError('Veo generation timed out after 10 minutes', { status: 504 });
}

module.exports = { generateVeoSegment };
