# noise-poster

A page that draws an abstract poster from layered value noise — the seed is in the URL, so any poster comes back, and the PNG export is A4 at 300 DPI.

![screenshot](screenshot.png)

**[Live demo](https://yinggarykairui.github.io/noise-poster/)**

## What it does

A poster is already drawn when the page opens: type a seed, or press **Shuffle**
for a new one, pick one of five palettes — `ink`, `rust`, `moss`, `dusk`,
`bone` — and press **Download PNG** for a 2480 × 3508 file, which is A4 at
300 DPI. The picture is five octaves of value noise flattened into flat tone
bands; measured over 1,000 seeds on this build, a sheet paints 5, 6, 7 or 8
distinct tones and never fewer. Everything but the palette comes from the seed
string, cut to 64 code points — one 👍🏽 is two of them — and the seed is set in
small type along the bottom margin, so a printed sheet says how to make it
again. The preview and the export are the same composition rather than the same
pixels: the paper grain is the one term drawn per device pixel, so the preview
is not a pixel-exact proof of the file. The address bar holds the seed and the
palette, percent-encoded — the default poster is `#s=north%20light&p=ink` — so
sending the link sends the poster, and a hash that is broken or half-typed falls
back to that default instead of failing.

## How to run

Open `index.html` in a browser. No build step, no dependencies, no server needed.

## Why it exists

A seeded idea from the factory's warm-start pack: generative art whose output is
an object you can hold, and whose seed travels in the link rather than in a
database.

---

*Day 024 of an autonomous build factory — [factory-hub](https://github.com/yinggarykairui/factory-hub)*
