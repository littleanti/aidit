#!/usr/bin/env node
// Build docs/assets/condense.gif from the frame sequence that
// capture-media.spec.ts produced in docs/assets/condense/.
//
// Why a script instead of an npm-script one-liner: the ffmpeg filter graph is
// full of quotes, commas and semicolons that npm hands to cmd.exe on Windows and
// to sh elsewhere, with different quoting rules. Passing an argv ARRAY through
// spawnSync sidesteps shell quoting entirely.
//
// Usage:
//   node e2e/make-gif.mjs            # from frontend/
//   npm run media:gif
//
// Requires ffmpeg on PATH. Frames are NOT committed (see .gitignore) — only the
// resulting GIF is, so regenerating media is: npm run media && npm run media:gif

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(here, '..', '..', 'docs', 'assets');
const FRAMES = resolve(ASSETS, 'condense');
const OUT = resolve(ASSETS, 'condense.gif');

// Output width in CSS px. The frames are captured at deviceScaleFactor 2, so
// downscaling here is what keeps the GIF small enough for a README.
const WIDTH = 380;
const FPS = 4;

if (!existsSync(FRAMES)) {
  console.error(
    `[media:gif] frame directory missing: ${FRAMES}\n` +
      '            run `npm run media` first.',
  );
  process.exit(1);
}

const frames = readdirSync(FRAMES).filter((f) => f.endsWith('.png'));
if (frames.length === 0) {
  console.error('[media:gif] no frames found — run `npm run media` first.');
  process.exit(1);
}

// Two-pass palette so the phosphor-green gradients don't band:
// generate a 64-colour palette from the whole sequence, then apply it.
const filter =
  `scale=${WIDTH}:-1:flags=lanczos,split[a][b];` +
  '[a]palettegen=max_colors=64[p];' +
  '[b][p]paletteuse=dither=bayer:bayer_scale=3';

const args = [
  '-y',
  '-framerate',
  String(FPS),
  '-i',
  resolve(FRAMES, '%03d.png'),
  '-vf',
  filter,
  '-loop',
  '0',
  OUT,
];

const res = spawnSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });

if (res.error) {
  console.error(
    '[media:gif] could not run ffmpeg — is it on PATH?\n' + String(res.error.message),
  );
  process.exit(1);
}
if (res.status !== 0) {
  console.error('[media:gif] ffmpeg failed:\n' + res.stderr?.toString().slice(-2000));
  process.exit(res.status ?? 1);
}

const bytes = statSync(OUT).size;
console.log(
  `[media:gif] wrote ${OUT} — ${frames.length} frames, ${WIDTH}px, ` +
    `${(bytes / 1024).toFixed(0)} KB`,
);
