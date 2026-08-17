'use strict';

/* noise-poster — one abstract poster drawn from layered value noise.

   The rules this file is built around:

   - Determinism from the seed string alone. Nothing in the tone path may read
     Math.random, Date, devicePixelRatio or the canvas size. Math.random appears
     in exactly one place: Shuffle, which invents a new seed string.
   - All arithmetic is 32-bit integer (Math.imul, >>>) or IEEE double, so the
     same seed gives the same bytes on any engine.
   - Preview and export run the same layout and tone code. The only term that
     reads a device pixel index is the grain, so the composition is
     resolution-independent and the preview is not a pixel-exact proof of the
     export.
   - Nothing parses the URL hash at module scope: one malformed '%' thrown
     there would leave a blank page instead of a degraded one. */

/* ---- palettes -------------------------------------------------------------
   Four stops each, light -> dark, at ramp positions 0, 1/3, 2/3, 1.
   Stop 0 doubles as the paper colour; stop 3 is the caption ink. */

const PALETTE_IDS = ['ink', 'rust', 'moss', 'dusk', 'bone'];

const PALETTES = {
  ink:  ['#f2efe9', '#cfd4d8', '#6e7b86', '#1b2126'],
  rust: ['#f6f0e7', '#e8cdb4', '#c07850', '#5a2f22'],
  moss: ['#f0f2ea', '#cdd8c2', '#7d9070', '#2f3b2b'],
  dusk: ['#f1eef4', '#d3cbdd', '#8b7fa3', '#342c44'],
  bone: ['#f4f1ec', '#ddd6cb', '#a99c8a', '#3a3229']
};

const DEFAULT_SEED = 'north light';
const DEFAULT_PALETTE = 'ink';

const SEED_MAX_CP = 64;      // code points, not UTF-16 units
const EXPORT_W = 2480;       // A4 portrait at 300 DPI
const EXPORT_H = 3508;

const OCTAVES = 5;
const LACUNARITY = 2;
const PERSISTENCE = 0.5;
const F0 = 3.0;              // three noise cells across the field's short edge

/* ---- seeded noise --------------------------------------------------------- */

/** FNV-1a over the seed string's code points -> uint32. */
function hashSeed(seed) {
  let h = 0x811c9dc5;
  for (const ch of seed) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Integer lattice hash -> [0,1). Negative coordinates are fine. */
function hash2(ix, iy, s) {
  let h = (s ^ Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = (h ^ (h >>> 12)) | 0;
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Quintic fade — zero first and second derivative at 0 and 1. */
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Bilinear value noise over the integer lattice. */
function value2(x, y, s) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const u = fade(x - ix);
  const v = fade(y - iy);
  const a = hash2(ix, iy, s);
  const b = hash2(ix + 1, iy, s);
  const c = hash2(ix, iy + 1, s);
  const d = hash2(ix + 1, iy + 1, s);
  const top = a + (b - a) * u;
  const bot = c + (d - c) * u;
  return top + (bot - top) * v;
}

/** Per-octave seeds, decorrelated by the golden-ratio constant. Hoisted out of
    the pixel loop; the values are identical to computing them inline. */
function octaveSeeds(seed32) {
  const out = new Int32Array(OCTAVES);
  for (let o = 0; o < OCTAVES; o++) out[o] = (seed32 + Math.imul(o + 1, 0x9e3779b1)) | 0;
  return out;
}

/** fBm: 5 octaves, lacunarity 2, persistence 0.5. Returns [0,1] (norm 1.9375). */
function fbm(x, y, seeds) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < OCTAVES; o++) {
    sum += amp * value2(x * freq, y * freq, seeds[o]);
    norm += amp;
    amp *= PERSISTENCE;
    freq *= LACUNARITY;
  }
  return sum / norm;
}

/* ---- colour --------------------------------------------------------------- */

function parseHex(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ];
}

/** Look up q in [0,1] on a four-stop ramp at 0, 1/3, 2/3, 1. */
function rampAt(stops, q) {
  const i = Math.min(2, Math.floor(q * 3));
  const f = q * 3 - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f)
  ];
}

/** Band count comes from the seed too: 5 to 8 flat tones. */
function bandCount(seed32) {
  return 5 + ((seed32 >>> 8) % 4);
}

/* ---- layout ---------------------------------------------------------------
   Everything is derived from the canvas size, so the preview and the 2480x3508
   export share one function. At export: M = 198, field 2084 x 2914, caption
   baseline 3310. */

function layout(W, H) {
  const m = Math.round(W * 0.08);
  return {
    m: m,
    fw: W - 2 * m,          // noise fills only this rect; the rest is paper
    fh: H - 3 * m,          // bottom margin is 2m, the classic wider foot
    captionY: m + (H - 3 * m) + m,
    fontPx: Math.round(H / 110)
  };
}

const CAPTION_FONT_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** The seed as it is set on the sheet: control characters become spaces, runs
    of spaces collapse, ends are trimmed. Falls back to the seed's hash so a
    seed made only of control characters still prints something reproducible. */
function displaySeed(seed, seed32) {
  let out = '';
  for (const ch of seed) {
    const cp = ch.codePointAt(0);
    out += (cp < 0x20 || cp === 0x7f) ? ' ' : ch;
  }
  out = out.replace(/ +/g, ' ').trim();
  return out === '' ? '#' + seed32.toString(16).toUpperCase() : out;
}

/* ---- the poster ----------------------------------------------------------- */

/**
 * Draw the whole sheet into ctx at W x H. Pure in the seed: the only term that
 * reads a device pixel index is the grain.
 */
function drawPoster(ctx, W, H, seed, paletteId) {
  const L = layout(W, H);
  const seed32 = hashSeed(seed);
  const stops = PALETTES[paletteId].map(parseHex);

  // Paper first, so the margins are stop 0 everywhere.
  ctx.fillStyle = 'rgb(' + stops[0][0] + ',' + stops[0][1] + ',' + stops[0][2] + ')';
  ctx.fillRect(0, 0, W, H);

  // q takes exactly B distinct values, so the ramp needs B lookups, not fw*fh.
  const B = bandCount(seed32);
  const band = new Uint8Array(B * 3);
  for (let b = 0; b < B; b++) {
    const rgb = rampAt(stops, b / (B - 1));
    band[b * 3] = rgb[0];
    band[b * 3 + 1] = rgb[1];
    band[b * 3 + 2] = rgb[2];
  }

  const seeds = octaveSeeds(seed32);
  const grainSeed = (seed32 ^ 0x5bf03635) | 0;
  const aspect = L.fh / L.fw;               // keeps the noise cells square
  const img = ctx.createImageData(L.fw, L.fh);
  const data = img.data;
  let i = 0;

  for (let py = 0; py < L.fh; py++) {
    const v = (py + 0.5) / L.fh;
    const ny = v * F0 * aspect;
    const tilt = 0.12 * (1 - v);            // fixed vertical tilt: light top
    for (let px = 0; px < L.fw; px++) {
      const u = (px + 0.5) / L.fw;
      const n = fbm(u * F0, ny, seeds);
      const t0 = n * 0.88 + tilt;
      const g = hash2(px, py, grainSeed) - 0.5;   // paper tooth
      const t = Math.min(0.999999, Math.max(0, t0 + 0.012 * g));
      const b = Math.min(B - 1, Math.floor(t * B)) * 3;
      data[i++] = band[b];
      data[i++] = band[b + 1];
      data[i++] = band[b + 2];
      data[i++] = 255;
    }
  }
  ctx.putImageData(img, L.m, L.m);

  drawCaption(ctx, W, L, seed, seed32, paletteId, stops[3]);
}

/** The seed set small in the bottom margin, and the palette name opposite it. */
function drawCaption(ctx, W, L, seed, seed32, paletteId, inkRgb) {
  ctx.font = L.fontPx + 'px ' + CAPTION_FONT_STACK;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgb(' + inkRgb[0] + ',' + inkRgb[1] + ',' + inkRgb[2] + ')';

  let text = 'seed: ' + displaySeed(seed, seed32);
  const limit = L.fw * 0.7;
  if (ctx.measureText(text).width > limit) {
    // Cut code points, not UTF-16 units, so a surrogate pair never splits.
    const cps = Array.from(text);
    while (cps.length > 1 && ctx.measureText(cps.join('') + '…').width > limit) cps.pop();
    text = cps.join('') + '…';
  }

  ctx.textAlign = 'left';
  ctx.fillText(text, L.m, L.captionY);
  ctx.textAlign = 'right';
  ctx.fillText(paletteId, W - L.m, L.captionY);
}
