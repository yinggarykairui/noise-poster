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
