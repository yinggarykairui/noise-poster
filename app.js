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

/* The two middle stops sit at even lightness thirds between stop 0 and stop 3
   (measured in CIELAB, keeping each palette's own a/b so the hue is unchanged).
   Before, every ramp spent its first third on two near-identical light tones —
   bone's adjacent contrast ratios ran 1.28 / 1.86 / 4.68, so it read as mush.
   Measured now: ink 2.19 / 2.60 / 2.49, rust 1.93 / 2.20 / 2.34,
   moss 1.96 / 2.23 / 2.39, dusk 2.02 / 2.34 / 2.43, bone 2.00 / 2.31 / 2.42. */
const PALETTES = {
  ink:  ['#f2efe9', '#9fa4a8', '#535f6a', '#1b2126'],
  rust: ['#f6f0e7', '#c5ab93', '#a5613a', '#5a2f22'],
  moss: ['#f0f2ea', '#a7b29d', '#637657', '#2f3b2b'],
  dusk: ['#f1eef4', '#afa7b8', '#706487', '#342c44'],
  bone: ['#f4f1ec', '#b3aca1', '#776b5a', '#3a3229']
};

const DEFAULT_SEED = 'north light';
const DEFAULT_PALETTE = 'ink';

const SEED_MAX_CP = 64;      // code points, not UTF-16 units
const EXPORT_W = 2480;       // A4 portrait at 300 DPI
const EXPORT_H = 3508;

const OCTAVES = 5;
const LACUNARITY = 2;
const PERSISTENCE = 0.5;

/* Base frequency: noise cells across the field's short edge. Seed-derived over
   [1.7, 5.0] rather than pinned at 3.0, because with one frequency every seed
   produced the same mid-frequency camouflage and Shuffle stopped paying after
   the second press. Still a pure function of the seed — no control, no random. */
const F0_MIN = 1.7;
const F0_SPAN = 3.3;

/* Tone curve. fBm plus the vertical tilt is a narrow hump, not a spread:
   measured over 316,028 samples across 47 seeds, d = n*0.88 + 0.12*(1-v) has
   mean 0.5011 and sd 0.126, min 0.054, max 0.932. Feeding that straight into
   floor(t*B) left the extreme bands unreachable, so a sheet declaring 8 bands
   painted 4 or 5 and lightest-to-darkest measured as little as 1.86:1.
   TONE is the logistic CDF of that measured distribution, which spreads d
   across the whole [0,1) ramp. TONE_K = 12 was picked by measurement: it is
   where the mean dominant-band share bottoms out. */
const TONE_MU = 0.5011;
const TONE_K = 12;

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

function rgbCss(c) {
  return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
}

/** Blend two parsed stops, t = 0 gives a. Used only for the page chrome. */
function mixStops(a, b, t) {
  return rgbCss([
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ]);
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

/* The lightest band starts here on the ramp, not at 0. Stop 0 is the paper, and
   the paper is what the sheet's own margins are filled with — so a band painted
   in stop 0 makes the picture's rectangle dissolve wherever it touches the edge.
   Measured on the build before this floor: paper-coloured pixels inside the
   field ran 3.6-49.2% and up to 53.6% of the field's perimeter was gone.
   0.15 puts the lightest band at 1.32-1.39:1 against the paper, i.e. a slightly
   stronger edge than the 1.23-1.27:1 that already separates sheet from page,
   and still leaves 7.54-10.22:1 from the lightest band to the darkest. */
const RAMP_FLOOR = 0.15;

/** Band count comes from the seed too: 5 to 8 flat tones. */
function bandCount(seed32) {
  return 5 + ((seed32 >>> 8) % 4);
}

/** Base frequency comes from the seed: 1.7 to 5.0 cells across the short edge.
    Taken through the lattice hash rather than off a bit slice of seed32: FNV-1a
    barely moves its high bits when only the last character changes, so a raw
    slice gave 'seed 0' through 'seed 7' just two distinct frequencies. */
function baseFreq(seed32) {
  return F0_MIN + hash2(0, 0, seed32 ^ 0x7f4a7c15) * F0_SPAN;
}

/**
 * The tone curve is  t = 1 / (1 + exp(-TONE_K * (d - TONE_MU))),  and the band
 * is floor(t * B). Because the curve is monotone, that is the same as counting
 * how many band boundaries d has passed — so this solves the B-1 boundaries
 * once per poster instead of evaluating an exp 8.7 million times per export.
 */
function bandEdges(B) {
  const edges = new Float64Array(B - 1);
  for (let b = 1; b < B; b++) edges[b - 1] = TONE_MU - Math.log(B / b - 1) / TONE_K;
  return edges;
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
function drawPoster(ctx, W, H, seed, paletteId, minCaptionPx) {
  const L = layout(W, H);
  // The caption is H/110, which is 32 px on the 3508 px export and 3 px on a
  // 366 px phone preview — a smudge, on the one element the tagline promises is
  // on the sheet. The preview passes a floor in device pixels; the export
  // passes nothing, because its own size is already twelve times the floor.
  if (minCaptionPx > L.fontPx) L.fontPx = minCaptionPx;
  const seed32 = hashSeed(seed);
  const stops = PALETTES[paletteId].map(parseHex);

  // Paper first, so the margins are stop 0 everywhere.
  ctx.fillStyle = 'rgb(' + stops[0][0] + ',' + stops[0][1] + ',' + stops[0][2] + ')';
  ctx.fillRect(0, 0, W, H);

  // q takes exactly B distinct values, so the ramp needs B lookups, not fw*fh.
  // It spans [RAMP_FLOOR, 1], never [0, 1]: see RAMP_FLOOR — the picture has to
  // keep its rectangle against the paper it is printed on.
  const B = bandCount(seed32);
  const band = new Uint8Array(B * 3);
  for (let b = 0; b < B; b++) {
    const rgb = rampAt(stops, RAMP_FLOOR + (1 - RAMP_FLOOR) * (b / (B - 1)));
    band[b * 3] = rgb[0];
    band[b * 3 + 1] = rgb[1];
    band[b * 3 + 2] = rgb[2];
  }

  const seeds = octaveSeeds(seed32);
  const grainSeed = (seed32 ^ 0x5bf03635) | 0;
  const f0 = baseFreq(seed32);
  const edges = bandEdges(B);
  const last = B - 1;
  const aspect = L.fh / L.fw;               // keeps the noise cells square
  const img = ctx.createImageData(L.fw, L.fh);
  const data = img.data;
  let i = 0;

  for (let py = 0; py < L.fh; py++) {
    const v = (py + 0.5) / L.fh;
    const ny = v * f0 * aspect;
    const tilt = 0.12 * (1 - v);            // fixed vertical tilt
    for (let px = 0; px < L.fw; px++) {
      const u = (px + 0.5) / L.fw;
      const n = fbm(u * f0, ny, seeds);
      const g = hash2(px, py, grainSeed) - 0.5;   // paper tooth
      const d = n * 0.88 + tilt + 0.012 * g;
      // The band is how many tone-curve boundaries d has passed.
      let b = 0;
      while (b < last && d >= edges[b]) b++;
      b *= 3;
      data[i++] = band[b];
      data[i++] = band[b + 1];
      data[i++] = band[b + 2];
      data[i++] = 255;
    }
  }
  ctx.putImageData(img, L.m, L.m);

  drawCaption(ctx, W, L, seed, seed32, paletteId, stops[3]);
}

/* The caption may be set smaller than the palette name, down to this fraction
   of it, before anything is cut. A 64-code-point CJK or emoji seed is far wider
   than a 64-character Latin one, and the sheet's whole job is to carry the
   string that reproduces it — so shrinking is always preferred to an ellipsis. */
const CAPTION_MIN_SCALE = 0.55;

/** The seed set small in the bottom margin, and the palette name opposite it. */
function drawCaption(ctx, W, L, seed, seed32, paletteId, inkRgb) {
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgb(' + inkRgb[0] + ',' + inkRgb[1] + ',' + inkRgb[2] + ')';
  ctx.font = L.fontPx + 'px ' + CAPTION_FONT_STACK;

  // The seed gets the margin minus the palette name and one clear gap.
  const limit = L.fw - ctx.measureText(paletteId).width - L.fontPx * 2;
  let text = 'seed: ' + displaySeed(seed, seed32);

  const floor = Math.max(1, Math.round(L.fontPx * CAPTION_MIN_SCALE));
  let size = L.fontPx;
  while (size > floor && ctx.measureText(text).width > limit) {
    size--;
    ctx.font = size + 'px ' + CAPTION_FONT_STACK;
  }
  if (ctx.measureText(text).width > limit) {
    // Only below the floor, and only then: cut code points, not UTF-16 units,
    // so a surrogate pair never splits.
    const cps = Array.from(text);
    while (cps.length > 1 && ctx.measureText(cps.join('') + '…').width > limit) cps.pop();
    text = cps.join('') + '…';
  }

  ctx.textAlign = 'left';
  ctx.fillText(text, L.m, L.captionY);
  ctx.font = L.fontPx + 'px ' + CAPTION_FONT_STACK;
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

/** Filename stem for the export. The ASCII slug alone is not a name: it maps
    every non-alphanumeric code point to '-', so two different posters used to
    share one file (both emoji seeds landed on noise-poster-seed.png). When the
    slug does not read back as the seed, the seed's own hash goes on the end. */
function slugify(seed) {
  const s = Array.from(seed)
    .map((ch) => (/[a-z0-9]/i.test(ch) ? ch.toLowerCase() : '-'))
    .join('')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (s !== '' && s.replace(/-/g, ' ') === seed) return s;
  return (s === '' ? 'seed' : s) + '-' + hashSeed(seed).toString(16).padStart(8, '0');
}

/** The file's whole name. The seed slug alone is not enough: the palette is
    half of what the sheet is, so north light on ink and north light on rust are
    two different 2480x3508 images that both used to land on
    noise-poster-north-light.png and get told apart by the browser's ' (1)'. */
function exportFilename(seed, paletteId) {
  return 'noise-poster-' + slugify(seed) + '-' + paletteId + '.png';
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

/* ---- layout ---------------------------------------------------------------
   There is no breakpoint here on purpose. A breakpoint is a guess about which
   arrangement gives the poster more room, and a guess checked at two widths is
   a cliff at every other one. Both arrangements are laid out on every resize,
   the poster each would get is measured, and the larger one is kept. */

const PAD = 16;              // .page padding, must match style.css
const COL_GAP = 16;
const ROW_GAP = 14;
const STACK_MAX = 440;       // the one-column cap the spec names
const SIDE_COL = 280;        // controls column when the poster is beside them
const POSTER_MIN_H = 200;    // below this the sheet stops being a picture

/* The one-column arrangement sizes the poster from the space the controls leave
   over — and on a phone the controls leave almost nothing: at 320x568 that gave
   a 147x208 sheet, 12.0% of the viewport against the controls' 20.4%, a control
   panel with a stamp on it. The poster gets a floor of this fraction of the
   viewport height instead, and the document scrolls the last part of the
   control stack. It is a floor, not a cap: whenever the space actually
   available is larger, the space wins. */
const POSTER_VH_FLOOR = 0.55;

/* Smallest caption the preview will draw, in CSS pixels. See drawPoster(). */
const CAPTION_MIN_CSS_PX = 6;

/* Backing-store budget for the preview, in device pixels. drawPoster is one
   synchronous typed-array fill, so the backing store is the whole cost: the
   side-by-side arrangement on a 2560x1400 retina desktop asked for 5.27 Mpx and
   blocked the main thread for 502 ms per Shuffle. Capping the store rather than
   the sheet keeps the poster's CSS size where relayout() put it and spends
   fewer device pixels on it. Never below 1 device pixel per CSS pixel, so the
   preview is never upscaled. */
const MAX_BACKING_PX = 1300000;

/** Device pixels per CSS pixel for the preview: DPR, capped at 2 (past that the
    grain is invisible and the fill cost is not), then capped by the budget. */
function previewScale(cssW, cssH) {
  const area = Math.max(1, cssW * cssH);
  let s = Math.min(window.devicePixelRatio || 1, 2);
  if (area * s * s > MAX_BACKING_PX) s = Math.max(1, Math.sqrt(MAX_BACKING_PX / area));
  return s;
}
const BORDER = 2;            // .poster's 1 px border, both sides

function setArrangement(cls, col) {
  els.page.className = 'page ' + cls;
  els.page.style.setProperty('--col', col + 'px');
}

/** Height of everything in the controls column, measured (never assumed). */
function chromeHeight() {
  return els.masthead.offsetHeight + els.controls.offsetHeight;
}

/**
 * Lay both arrangements out, measure, keep the larger poster. Writes the
 * canvas's CSS content box. Returns true when the backing store must be
 * rebuilt, so the caller can decide whether a redraw is needed.
 */
function relayout() {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const ratio = EXPORT_H / EXPORT_W;

  // Collapse the canvas before measuring. In the side arrangement it spans both
  // grid rows, so its previous height stretches the rows the masthead and the
  // controls sit in and chromeHeight() would measure the poster it is about to
  // replace: at 844x390, arriving from 390x844, that read 472 px of chrome
  // instead of 297 and cost the poster 110 px of width.
  els.canvas.style.width = '0px';
  els.canvas.style.height = '0px';

  // A: one column, masthead over poster over controls.
  const colA = Math.max(1, Math.min(vw - 2 * PAD, STACK_MAX));
  setArrangement('lay-stack', colA);
  const freeA = vh - 2 * PAD - chromeHeight() - 2 * ROW_GAP - BORDER;
  const capA = colA - BORDER;
  const floorA = Math.max(POSTER_MIN_H, POSTER_VH_FLOOR * vh);
  // Height first in this arrangement, and rounded once. Deriving the height
  // from a rounded width let a one-pixel-taller viewport make the poster two
  // pixels taller, which is enough to push Download back below a fold it had
  // just cleared — the 1 px sweep caught exactly that at 320x700 and 375x700.
  let hA = Math.min(Math.round(capA * ratio), Math.max(1, Math.floor(Math.max(floorA, freeA))));
  let wA = Math.min(capA, Math.max(1, Math.round(hA / ratio)));

  // B: poster beside the masthead and controls. Width binds here, and the
  // controls never sit under the poster, so the fold does not depend on it.
  const colB = Math.min(SIDE_COL, Math.max(1, vw - 2 * PAD));
  setArrangement('lay-side', colB);
  const freeWB = vw - 2 * PAD - COL_GAP - colB - BORDER;
  const freeHB = vh - 2 * PAD - BORDER;
  let wB = Math.floor(Math.max(0, Math.min(freeWB, freeHB / ratio)));
  let hB = Math.max(0, Math.round(wB * ratio));
  // B is only offered when it also holds its own controls without scrolling;
  // otherwise it is A with a smaller poster, which is not an improvement.
  if (chromeHeight() + 2 * PAD + ROW_GAP > vh) { wB = 0; hB = 0; }

  const side = wB * hB > wA * hA;
  const w = Math.max(1, side ? wB : wA);
  const h = Math.max(1, side ? hB : hA);

  if (side) setArrangement('lay-side', colB);
  else setArrangement('lay-stack', colA);
  els.canvas.style.width = w + 'px';
  els.canvas.style.height = h + 'px';

  const scale = previewScale(els.canvas.clientWidth, els.canvas.clientHeight);
  const bw = Math.max(1, Math.round(els.canvas.clientWidth * scale));
  const bh = Math.max(1, Math.round(els.canvas.clientHeight * scale));
  return els.canvas.width !== bw || els.canvas.height !== bh;
}

function renderPreview() {
  // Both dimensions come from the laid-out box, so the backing store is never a
  // device pixel shorter than the box it fills.
  const scale = previewScale(els.canvas.clientWidth, els.canvas.clientHeight);
  const W = Math.max(1, Math.round(els.canvas.clientWidth * scale));
  const H = Math.max(1, Math.round(els.canvas.clientHeight * scale));
  if (els.canvas.width !== W || els.canvas.height !== H) {
    els.canvas.width = W;
    els.canvas.height = H;
  }
  try {
    const ctx = els.canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    drawPoster(ctx, W, H, state.seed, state.palette,
      Math.round(CAPTION_MIN_CSS_PX * scale));
    // The render worked, so retract our own message if it is the one up.
    if (noteRank === NOTE_RENDER_FAIL) noteWrite(NOTE_RENDER_FAIL, '');
  } catch (err) {
    // An ImageData allocation or a missing context must not escape and leave
    // the sheet blank with nothing said and the URL never written.
    noteWrite(NOTE_RENDER_FAIL, RENDER_FAIL);
  }
  els.canvas.setAttribute('aria-label',
    'Noise poster, seed ' + state.seed + ', palette ' + state.palette);
}

const RENDER_FAIL = 'This browser could not draw the poster';
const EXPORT_FAIL = 'Export failed on this device';

/* ---- the status line ------------------------------------------------------
   #export-note is role="status": the page's only screen-reader voice, and the
   only thing on it that speaks without being asked. Three unrelated things want
   to write it, so it has one ownership rule, and the rule is enforced here
   rather than by each writer remembering it:

     1. The line describes the poster that is on screen right now. Every change
        of poster resets it (noteReset(), called by apply() before the render)
        and bumps an epoch. "Change of poster" means a change of the two inputs
        drawPoster actually consumes — the seed or the palette. A call that
        repaints the same seed in the same palette produces a byte-identical
        sheet, so nothing said about the sheet on screen has stopped being
        true: that call resets nothing and does not move the epoch.
     2. A writer that started before that change may not write after it. Async
        writers carry the epoch they started in; if it has moved on, they are
        describing a poster that is gone, and they are declined.
     3. When two messages are true at once, the more serious one wins, and the
        order is the same for every writer:
           a dead render  >  a failed export  >  the new seed from Shuffle.
        A writer may always retract its own message, and may always replace it.

   Both halves exist because of measured bugs. Without (1) and (2) a Shuffle
   announcement outlived the poster it named, and a 1.2 s export failure landed
   on top of a later, true announcement and pinned a failure to a sheet that was
   never exported. Without (3) the export failure hid a still-dead preview,
   while the Shuffle path deferred to it correctly — the same precedence
   implemented twice, once. Rule 1's definition of "change" is the third: with
   apply() resetting unconditionally, pressing the already-pressed swatch, or
   re-committing the seed already in the field, wiped a true `Seed: X` while
   the sheet on screen was byte-identical. */

const NOTE_NONE = 0;
const NOTE_SEED = 1;
const NOTE_EXPORT_FAIL = 2;
const NOTE_RENDER_FAIL = 3;

let noteRank = NOTE_NONE;
let posterEpoch = 0;

/** Rule 1: the poster changed, so nothing said about the old one is still ours. */
function noteReset() {
  posterEpoch++;
  els.note.textContent = '';
  noteRank = NOTE_NONE;
}

/**
 * The only way to write the line. Returns true if it wrote.
 * `epoch` is the value posterEpoch had when the caller began; omit it for
 * synchronous writers, which cannot be stale. To retract, pass your own rank
 * and an empty string — that is what "a writer may retract its own message"
 * means here, and it is why the rank test is >=, not >.
 */
function noteWrite(rank, text, epoch) {
  if (epoch !== undefined && epoch !== posterEpoch) return false;   // rule 2
  if (rank < noteRank) return false;                                // rule 3
  noteRank = text === '' ? NOTE_NONE : rank;
  if (els.note.textContent === text) return false;
  els.note.textContent = text;
  return true;
}

/** noteWrite for callers outside apply(), which must pick up a height change. */
function noteWriteAndFit(rank, text, epoch) {
  if (noteWrite(rank, text, epoch) && relayout()) renderPreview();
}

/* Write into the seed field only when the field is not already describing the
   poster on screen. Two things fall out of that one rule: an emptied field is
   left empty (its effective seed is the default, which is what is rendered),
   and a field the user is typing into is never reassigned mid-edit — so the
   caret cannot be thrown to the end. */
function syncField() {
  const typed = clampSeed(els.seed.value);
  const effective = typed === '' ? DEFAULT_SEED : typed;
  if (effective === state.seed) return;
  setFieldValue(state.seed);
}

/** Assign input.value only when it really differs, and put the caret back. */
function setFieldValue(text) {
  if (els.seed.value === text) return;
  const focused = document.activeElement === els.seed;
  const start = els.seed.selectionStart;
  const end = els.seed.selectionEnd;
  els.seed.value = text;
  if (focused && start !== null) {
    try {
      els.seed.setSelectionRange(Math.min(start, text.length), Math.min(end, text.length));
    } catch (err) {
      /* Some browsers refuse setSelectionRange on some input types; the value
         is already correct, so a lost caret is the worst case. */
    }
  }
}

function syncControls() {
  syncField();
  for (const btn of els.swatches) {
    btn.setAttribute('aria-pressed', String(btn.dataset.palette === state.palette));
  }
  paintChrome(state.palette);
}

/* The page's own colours, all derived from the active palette so there is one
   source of truth. Two of them exist because of measurements:
   --page is a shade darker than the paper, so the sheet's own margins stop
   being byte-identical to the page behind them (they measured 1.00:1), and
   --line is stop 2 rather than a 28%-alpha ink, because that alpha composited
   to 1.79:1 against the paper and WCAG 1.4.11 asks for 3:1. */
function paintChrome(paletteId) {
  const s = PALETTES[paletteId].map(parseHex);
  const root = document.documentElement.style;
  root.setProperty('--paper', rgbCss(s[0]));
  root.setProperty('--ink', rgbCss(s[3]));
  root.setProperty('--line', rgbCss(s[2]));
  // Secondary text. Not stop 2 (that measured 3.46:1 against the page on rust)
  // and not a 0.7 alpha of the ink (that was the 5.61:1 the old build shipped):
  // this measures 6.24:1 at worst, over the darker page, on every palette.
  root.setProperty('--muted', mixStops(s[3], s[2], 0.3));
  root.setProperty('--page', mixStops(s[0], s[1], 0.34));
  root.setProperty('--wash', mixStops(s[0], s[3], 0.09));
  root.setProperty('--ink-hover', mixStops(s[3], s[2], 0.28));
  root.setProperty('--shadow', 'rgba(' + s[3][0] + ',' + s[3][1] + ',' + s[3][2] + ',0.22)');
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
  // Rule 1's test, and the only place it is made: the poster is what
  // drawPoster draws from, so it has changed exactly when the seed or the
  // palette has. Everything below runs either way — a no-op still re-syncs the
  // controls, re-lays out, repaints and rewrites the hash, all of which are
  // idempotent — but a repaint of the same sheet may not silence a true
  // announcement about it.
  const changed = next.seed !== state.seed || next.palette !== state.palette;
  state.seed = next.seed;
  state.palette = next.palette;
  syncControls();
  // The poster is about to change, so whatever the status line said about the
  // old one stops being true here. renderPreview may write it again.
  if (changed) noteReset();
  relayout();
  renderPreview();
  if (!opts || opts.writeHash !== false) writeHash();
}

/** The seed the field is asking for right now. An empty field asks for the
    default poster without the default being typed into it. */
function fieldSeed() {
  const typed = clampSeed(els.seed.value);
  return typed === '' ? DEFAULT_SEED : typed;
}

function onSeedInput() {
  // Cut at 64 code points immediately, not 200 ms later, so the field can never
  // hold a string the rest of the app would disagree with.
  const cut = clampSeed(els.seed.value);
  if (cut !== els.seed.value) setFieldValue(cut);
  clearTimeout(seedTimer);
  seedTimer = setTimeout(() => {
    seedTimer = 0;
    apply({ seed: fieldSeed(), palette: state.palette });
  }, 200);
}

/** Every control that acts has to take the seed the user has already typed,
    not race the 200 ms debounce for it. Returns the seed to act on and cancels
    the pending commit, because the caller is about to do it. */
function takePendingSeed() {
  if (!seedTimer) return state.seed;
  clearTimeout(seedTimer);
  seedTimer = 0;
  return fieldSeed();
}

/* One reroll, two ways to ask for it: the Shuffle button and the poster
   itself. Extracted rather than duplicated so the sheet can never announce
   itself differently from the button — same new seed, same apply(), same line,
   same replaceState.

   The canvas gets a click handler, `cursor: pointer` and a `title`, and
   deliberately gets nothing else: no tabindex, and role="img" is unchanged. A
   canvas in the tab order would be a focusable control with no name and no
   keyboard action, and Shuffle is already the labelled, reachable equivalent.
   The `title` is the whole disclosure: a `cursor: pointer` that changes under
   the hand and is named nowhere is a promise the page never keeps, and a
   tooltip names the gesture — to a mouse and to voice control — without
   spending a line of an already tight controls column on it. `title` is not
   an accessible name here: the dynamic aria-label outranks it, and still wins.
   This is a shortcut for a pointer, not a second advertised control. */
function reroll() {
  takePendingSeed();      // a reroll replaces the seed, so drop a pending commit
  const seed = randomSeed();
  apply({ seed: seed, palette: state.palette });
  // A reroll changes the canvas and nothing else, and a canvas label is not a
  // live region — so say the new seed through the status line that is already
  // on the page. A palette change announces itself via aria-pressed.
  // Not over a render failure: that message is the truer one.
  // No bespoke check: noteWrite already knows a dead render outranks this.
  noteWriteAndFit(NOTE_SEED, 'Seed: ' + seed);
}

/* The picture's own click is not the Shuffle button, and it must not throw away
   a seed the user has typed and not yet committed. Before the gesture existed
   the canvas was inert and the 200 ms debounce always delivered that seed; with
   the canvas rerolling unconditionally, a click — and on a phone a tap, which
   is the universal way to dismiss the keyboard — ate the input on the most
   natural touch there is.

   So the picture answers the likelier question first: when the field is asking
   for a seed other than the one on screen, the click shows that seed. It only
   rerolls once the field already agrees with the sheet. Committing runs exactly
   the path the debounce would have run 200 ms later — same apply(), so the
   field, the canonical hash, the aria-label, the status line and the pixels are
   identical whether the seed arrived by waiting or by clicking.

   Shuffle is deliberately untouched: it always rerolls, pending seed or not. */
function onPosterActivate() {
  const asked = fieldSeed();          // what the field is asking for right now
  if (asked !== state.seed) {
    takePendingSeed();                // settle the debounce here, not 200 ms on
    apply({ seed: asked, palette: state.palette });
    return;
  }
  reroll();
}

/* A press, a drag and a release across the picture is a drag, not a click — but
   the platform dispatches a click for it all the same, so a mouse drag rerolled
   the poster out from under a user who was selecting, or flinging the page, or
   just resting a hand. Anchor the pointer where it went down on the canvas and
   refuse the click if it travelled further than the slop. 5 CSS px is the usual
   platform figure: a hand-held click jiggles by one or two, a drag never stays
   inside it. Touch needs no help — a swipe scrolls and never produces a click —
   and gets none. This is the canvas's rule only; Shuffle is a real button and
   keeps the platform's own. */
const CLICK_SLOP_PX = 5;

let pressAnchor = null;      // pointer position at pointerdown on the canvas
let pressDragged = false;    // did this press already travel past the slop?

function pastSlop(ev, anchor) {
  return Math.hypot(ev.clientX - anchor.x, ev.clientY - anchor.y) > CLICK_SLOP_PX;
}

function onPosterPointerDown(ev) {
  pressAnchor = { x: ev.clientX, y: ev.clientY };
  pressDragged = false;
}

function onPosterPointerMove(ev) {
  if (pressAnchor && !pressDragged && pastSlop(ev, pressAnchor)) pressDragged = true;
}

/* The browser took the gesture over — a scroll, usually. Whatever it was, it
   was not a click, and the anchor it left behind must not answer for the next
   one. A pointerdown clears this again. */
function onPosterPointerCancel() {
  pressAnchor = null;
  pressDragged = true;
}

function onPosterClick(ev) {
  const anchor = pressAnchor;
  const dragged = pressDragged;
  pressAnchor = null;
  pressDragged = false;
  if (dragged) return;
  // Release far from the press: a drag whose intermediate moves were never seen
  // (the pointer left the canvas and came back) still fails here.
  if (anchor && pastSlop(ev, anchor)) return;
  // No anchor at all means this click had no press of its own on the canvas —
  // synthesised, or from assistive tech. There is no drag to suspect.
  onPosterActivate();
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
      apply({ seed: takePendingSeed(), palette: id });
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

const DOWNLOAD_LABEL = 'Download PNG';

async function onDownload() {
  // One snapshot, taken at click time, and the only thing the rest of this
  // function reads: the pixels, the caption inside them and the filename all
  // come from the same seed, whatever the field or a Shuffle does during the
  // ~1.2 s the 8.7-megapixel fill takes. takePendingSeed() first, so a seed
  // typed less than 200 ms ago is exported rather than the previous one.
  const snap = { seed: takePendingSeed(), palette: state.palette };
  if (snap.seed !== state.seed) apply({ seed: snap.seed, palette: snap.palette });

  // The epoch this export belongs to. toBlob can take ~1.2 s, and a Shuffle in
  // the meantime hands the line to a different poster; if that happens, this
  // export's verdict is about a sheet that is no longer on screen and must not
  // be written. Taken after the apply() above, which itself bumps the epoch.
  const epoch = posterEpoch;

  els.download.disabled = true;
  els.download.textContent = 'Rendering…';
  // A writer may retract its own message: this is a fresh attempt, so last
  // attempt's verdict goes. An export is not a change of poster, so nothing
  // else on the line is touched.
  if (noteRank === NOTE_EXPORT_FAIL) noteWriteAndFit(NOTE_EXPORT_FAIL, '');
  await nextPaint();

  let url = '';
  try {
    const off = document.createElement('canvas');   // detached, never in the DOM
    off.width = EXPORT_W;
    off.height = EXPORT_H;
    drawPoster(off.getContext('2d'), EXPORT_W, EXPORT_H, snap.seed, snap.palette);

    const blob = await new Promise((resolve) => off.toBlob(resolve, 'image/png'));
    // A null blob, or one under 1 KB, is the silent all-transparent failure a
    // canvas over the device ceiling produces. Never fail as a no-op.
    if (!blob || blob.size < 1024) throw new Error('empty blob');

    url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFilename(snap.seed, snap.palette);
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    noteWriteAndFit(NOTE_EXPORT_FAIL, EXPORT_FAIL, epoch);
  } finally {
    // Revoke on the next task, not inside the click's own turn: the download is
    // started during click dispatch, and revoking synchronously can cancel it.
    if (url) setTimeout(() => URL.revokeObjectURL(url), 0);
    els.download.disabled = false;
    els.download.textContent = DOWNLOAD_LABEL;
  }
}

function init() {
  els.page = document.getElementById('page');
  els.masthead = document.querySelector('.masthead');
  els.controls = document.querySelector('.controls');
  els.canvas = document.getElementById('poster');
  els.seed = document.getElementById('seed');
  els.shuffle = document.getElementById('shuffle');
  els.swatchRoot = document.getElementById('swatches');
  els.download = document.getElementById('download');
  els.note = document.getElementById('export-note');

  buildSwatches();

  els.seed.addEventListener('input', onSeedInput);
  els.shuffle.addEventListener('click', reroll);
  els.canvas.addEventListener('pointerdown', onPosterPointerDown);
  els.canvas.addEventListener('pointermove', onPosterPointerMove);
  els.canvas.addEventListener('pointercancel', onPosterPointerCancel);
  els.canvas.addEventListener('click', onPosterClick);
  els.download.addEventListener('click', onDownload);
  window.addEventListener('hashchange', onHashChange);

  // Re-lay out on every resize; re-render only when the backing store changes.
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (relayout()) renderPreview();
    }, 150);
  });

  // Fill the field once, here. After this, syncField()'s rule owns it: an
  // empty field means "the user cleared it", and is left alone.
  const initial = parseHash(location.hash);
  els.seed.value = initial.seed;
  apply(initial);
}

document.addEventListener('DOMContentLoaded', init);
