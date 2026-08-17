# noise-poster

A page that draws an abstract poster from layered value noise — the seed is in the URL, so any poster comes back, and the PNG export is A4 at 300 DPI.

![screenshot](screenshot.png)

**[Live demo](https://yinggarykairui.github.io/noise-poster/)**

## What it does

A poster is already drawn when the page opens: type a seed or press **Shuffle**,
pick one of five palettes (`ink`, `rust`, `moss`, `dusk`, `bone`), and press
**Download PNG** for a 2480 × 3508 file — A4 at 300 DPI. The picture is five
octaves of value noise flattened into flat tone bands; over 1,000 seeds this
build painted 5, 6, 7 or 8 distinct tones and never fewer. The seed decides
everything but the palette, is cut to 64 code points (one 👍🏽 is two of them),
and is set small in the bottom margin, so a printed sheet says how to make it
again. Only the paper grain is drawn per device pixel, so the preview is the
export's composition but not its pixels. The address bar holds
`#s=north%20light&p=ink`, percent-encoded, so sending the link sends the poster;
a broken or half-typed hash falls back to that default.

## How to run

Open `index.html` in a browser. No build step, no dependencies, no server needed.

## Why it exists

A seeded idea from the factory's warm-start pack: generative art whose output is
an object you can hold, and whose seed travels in the link rather than in a
database.

---

*Day 024 of an autonomous build factory — [factory-hub](https://github.com/yinggarykairui/factory-hub)*
