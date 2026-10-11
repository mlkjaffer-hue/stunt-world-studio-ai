// FREE video model: "AI Animated Stills".
// Generates a cinematic slow zoom/pan over an AI-generated (or uploaded) still
// using ffmpeg. Genuinely free — no API key, no per-video cost.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const VIDEO_SIZE = {
  '9:16': { w: 720, h: 1280 },
  '16:9': { w: 1280, h: 720 },
  '1:1': { w: 960, h: 960 },
};
const FPS = 30;

function runFfmpeg(args, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`ffmpeg failed: ${(stderr || err.message).slice(-500)}`));
      resolve(stdout);
    });
  });
}

function checkFfmpeg() {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-version'], { timeout: 10000 }, (err) => resolve(!err));
  });
}

// One animated segment. zoomIn=true starts wide and pushes in; false pulls out.
async function animateSegment(imagePath, outPath, durationSec, { aspect = '9:16', zoomIn = true } = {}) {
  const { w, h } = VIDEO_SIZE[aspect] || VIDEO_SIZE['9:16'];
  const frames = Math.max(1, Math.round(durationSec * FPS));
  const step = 0.35 / frames; // total zoom travel ≈ 1.0 → 1.35
  // zoompan works on a single input frame; d=frames sets output length.
  const zoomExpr = zoomIn
    ? `min(1+${step.toFixed(6)}*on,1.35)`
    : `max(1.35-${step.toFixed(6)}*on,1.0)`;
  const vf =
    `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,` +
    `crop=${w * 2}:${h * 2},` +
    `zoompan=z='${zoomExpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${FPS}`;
  await runFfmpeg([
    '-y', '-loop', '1', '-i', imagePath,
    '-vf', vf,
    '-frames:v', String(frames),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '21',
    '-movflags', '+faststart',
    outPath,
  ]);
}

// Extract a poster frame (jpg) from a video.
async function makePoster(videoPath, posterPath, atSec = 0.5) {
  await runFfmpeg(['-y', '-ss', String(atSec), '-i', videoPath, '-frames:v', '1', '-q:v', '4', posterPath], 60000);
}

// Concatenate same-codec mp4 segments losslessly.
async function stitchSegments(segmentPaths, outPath, workDir) {
  const listFile = path.join(workDir, `concat_${Date.now()}.txt`);
  fs.writeFileSync(listFile, segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  try {
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', outPath]);
  } finally {
    try { fs.unlinkSync(listFile); } catch { /* ignore */ }
  }
}

module.exports = { animateSegment, makePoster, stitchSegments, checkFfmpeg, VIDEO_SIZE };
