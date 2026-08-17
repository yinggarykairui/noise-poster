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

/* ---- seed strings --------------------------------------------------------- */

/** Cut to 64 code points. One code path owns the cap: the field has no
    maxlength, because maxlength counts UTF-16 units and this counts code
    points, and two units would disagree on any astral character. */
function clampSeed(s) {
  const cps = Array.from(s);
  return cps.length > SEED_MAX_CP ? cps.slice(0, SEED_MAX_CP).join('') : s;
}

const ADJECTIVES = [
  'north', 'quiet', 'pale', 'slow', 'hollow', 'bright', 'damp', 'iron',
  'soft', 'wild', 'cold', 'high', 'shallow', 'dry', 'deep', 'thin',
  'rough', 'still', 'warm', 'dark', 'clear', 'faint', 'sharp', 'plain'
];

const NOUNS = [
  'light', 'tide', 'ridge', 'ember', 'drift', 'harbour', 'marsh', 'spire',
  'gully', 'thaw', 'willow', 'quarry', 'meadow', 'cinder', 'basin', 'lantern',
  'furrow', 'cairn', 'estuary', 'shale', 'orchard', 'cove', 'moraine', 'reef'
];

/** The one place Math.random is allowed: inventing a seed string, never tone.
    24 x 24 x 100 = 57,600 combinations. */
function randomSeed() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const d = String(Math.floor(Math.random() * 100)).padStart(2, '0');
  return a + ' ' + n + ' ' + d;
}

/** Filename stem for the export. */
function slugify(seed) {
  const s = Array.from(seed)
    .map((ch) => (/[a-z0-9]/i.test(ch) ? ch.toLowerCase() : '-'))
    .join('')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s === '' ? 'seed' : s;
}

/* ---- hash ----------------------------------------------------------------- */

/**
 * #s=<encodeURIComponent(seed)>&p=<palette-id>
 *
 * The hash is the only input and the whole product, so every failure here has
 * to degrade to a poster rather than to a blank page. Each decodeURIComponent
 * gets its own try/catch for URIError, and the whole parse gets one more.
 * Called from init(), never at module scope.
 */
function parseHash(raw) {
  const state = { seed: DEFAULT_SEED, palette: DEFAULT_PALETTE };
  try {
    let h = String(raw || '');
    if (h.charAt(0) === '#') h = h.slice(1);
    if (h.charAt(0) === '/') h = h.slice(1);
    if (h.trim() === '') return state;

    for (const part of h.split('&')) {
      const eq = part.indexOf('=');            // split on the FIRST '=' only
      const key = eq < 0 ? part : part.slice(0, eq);
      if (key !== 's' && key !== 'p') continue; // unknown keys ignored
      const encoded = eq < 0 ? '' : part.slice(eq + 1);
      let value;
      try {
        value = decodeURIComponent(encoded);
      } catch (err) {
        if (!(err instanceof URIError)) throw err;
        // Undecodable value: this key falls back to its default, the other
        // key still applies, and the poster still paints.
        if (key === 's') state.seed = DEFAULT_SEED;
        else state.palette = DEFAULT_PALETTE;
        continue;
      }
      // Last occurrence wins, because the loop keeps overwriting.
      if (key === 's') {
        const seed = clampSeed(value);
        state.seed = seed === '' ? DEFAULT_SEED : seed;
      } else if (Object.prototype.hasOwnProperty.call(PALETTES, value)) {
        state.palette = value;                 // case-sensitive match
      } else {
        state.palette = DEFAULT_PALETTE;
      }
    }
  } catch (err) {
    return { seed: DEFAULT_SEED, palette: DEFAULT_PALETTE };
  }
  return state;
}

function canonicalHash(seed, palette) {
  return '#s=' + encodeURIComponent(seed) + '&p=' + palette;
}

/* ---- app ------------------------------------------------------------------ */

const state = { seed: DEFAULT_SEED, palette: DEFAULT_PALETTE };
const els = {};
let seedTimer = 0;

function renderPreview() {
  const cssW = els.canvas.clientWidth;
  if (cssW <= 0) return;
  // Backing store is capped at 2x: past that the grain is invisible and the
  // fill cost is not.
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.max(1, Math.round(cssW * scale));
  const H = Math.round(W * EXPORT_H / EXPORT_W);
  if (els.canvas.width !== W || els.canvas.height !== H) {
    els.canvas.width = W;
    els.canvas.height = H;
  }
  drawPoster(els.canvas.getContext('2d'), W, H, state.seed, state.palette);
  els.canvas.setAttribute('aria-label',
    'Noise poster, seed ' + state.seed + ', palette ' + state.palette);
}

function syncControls() {
  if (els.seed.value !== state.seed) els.seed.value = state.seed;
  for (const btn of els.swatches) {
    btn.setAttribute('aria-pressed', String(btn.dataset.palette === state.palette));
  }
  document.documentElement.style.setProperty('--paper', PALETTES[state.palette][0]);
  document.documentElement.style.setProperty('--ink', PALETTES[state.palette][3]);
  document.documentElement.style.setProperty('--focus', PALETTES[state.palette][3]);
}

function writeHash() {
  const hash = canonicalHash(state.seed, state.palette);
  if (location.hash === hash) return;
  try {
    history.replaceState(null, '', hash);
  } catch (err) {
    // file:// in some browsers refuses replaceState; the page still works.
    location.hash = hash;
  }
}

function apply(next, opts) {
  state.seed = next.seed;
  state.palette = next.palette;
  syncControls();
  renderPreview();
  if (!opts || opts.writeHash !== false) writeHash();
}

function onSeedInput() {
  clearTimeout(seedTimer);
  seedTimer = setTimeout(() => {
    const seed = clampSeed(els.seed.value);
    apply({ seed: seed === '' ? DEFAULT_SEED : seed, palette: state.palette });
  }, 200);
}

/* Compare the hash against the state it would produce, never against a
   remembered "this one was mine" string: a hash the page wrote is a hash the
   user can navigate back to, so remembering it makes Back a no-op and leaves
   the whole UI describing a poster that is no longer on screen. */
function onHashChange() {
  const next = parseHash(location.hash);
  if (next.seed === state.seed && next.palette === state.palette &&
      location.hash === canonicalHash(state.seed, state.palette)) return;
  apply(next);
}

function buildSwatches() {
  els.swatches = PALETTE_IDS.map((id) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch';
    btn.dataset.palette = id;
    btn.setAttribute('aria-pressed', 'false');

    const bar = document.createElement('span');
    bar.className = 'bar';
    // Built from PALETTES so the swatch and the poster cannot drift apart.
    const s = PALETTES[id];
    bar.style.background = 'linear-gradient(to right,' +
      s[0] + ' 0 25%,' + s[1] + ' 25% 50%,' + s[2] + ' 50% 75%,' + s[3] + ' 75% 100%)';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = id;

    btn.appendChild(bar);
    btn.appendChild(name);
    btn.addEventListener('click', () => {
      apply({ seed: state.seed, palette: id });
    });
    els.swatchRoot.appendChild(btn);
    return btn;
  });
}

/* ---- export ---------------------------------------------------------------
   2480 x 3508 = 8,699,840 px, 51.9% of iOS Safari's 16,777,216 px canvas-area
   ceiling, and the long side 3508 is under the 4096 px per-side limit - so this
   is inside the envelope where a canvas over the ceiling silently returns a
   transparent image. The size is still checked on the way out rather than
   trusted. */

/** Let the browser paint the disabled 'Rendering…' state before the main
    thread is blocked by an 8.7-megapixel fill. */
function nextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function onDownload() {
  const label = els.download.textContent;
  els.download.disabled = true;
  els.download.textContent = 'Rendering…';
  els.note.textContent = '';
  await nextPaint();

  let url = '';
  try {
    const off = document.createElement('canvas');   // detached, never in the DOM
    off.width = EXPORT_W;
    off.height = EXPORT_H;
    drawPoster(off.getContext('2d'), EXPORT_W, EXPORT_H, state.seed, state.palette);

    const blob = await new Promise((resolve) => off.toBlob(resolve, 'image/png'));
    // A null blob, or one under 1 KB, is the silent all-transparent failure a
    // canvas over the device ceiling produces. Never fail as a no-op.
    if (!blob || blob.size < 1024) throw new Error('empty blob');

    url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'noise-poster-' + slugify(state.seed) + '.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    els.note.textContent = 'Export failed on this device';
  } finally {
    // Revoke on the next task, not inside the click's own turn: the download is
    // started during click dispatch, and revoking synchronously can cancel it.
    if (url) setTimeout(() => URL.revokeObjectURL(url), 0);
    els.download.disabled = false;
    els.download.textContent = label;
  }
}

function init() {
  els.canvas = document.getElementById('poster');
  els.seed = document.getElementById('seed');
  els.shuffle = document.getElementById('shuffle');
  els.swatchRoot = document.getElementById('swatches');
  els.download = document.getElementById('download');
  els.note = document.getElementById('export-note');

  buildSwatches();

  els.seed.addEventListener('input', onSeedInput);
  els.shuffle.addEventListener('click', () => {
    apply({ seed: randomSeed(), palette: state.palette });
  });
  els.download.addEventListener('click', onDownload);
  window.addEventListener('hashchange', onHashChange);

  // Re-render only when the backing store would actually change size.
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      if (Math.round(els.canvas.clientWidth * scale) !== els.canvas.width) renderPreview();
    }, 150);
  });

  apply(parseHash(location.hash));
}

document.addEventListener('DOMContentLoaded', init);
