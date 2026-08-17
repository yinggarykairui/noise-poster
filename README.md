# noise-poster

A page that draws an abstract poster from layered value noise — the seed is in the URL, so any poster comes back, and the PNG export is A4 at 300 DPI.

![screenshot](screenshot.png)

*The poster you get with no hash at all — seed `north light`, palette `ink` — with the four controls under it.*

**[Live demo](https://yinggarykairui.github.io/noise-poster/)**

## What it does

A poster is already drawn when the page opens. Type a seed, or press **Shuffle**
for a new one; pick one of five palettes — `ink`, `rust`, `moss`, `dusk`,
`bone` — and press **Download PNG**. The picture is five octaves of value noise
stacked on a seeded integer hash, flattened into 5 to 8 tone bands, so it prints
like a screen print rather than a gradient. Everything but the palette comes from
the seed string: the same seed always gives the same poster, and the seed is set
in small type along the bottom margin, so a printed sheet says how to make it
again. The address bar holds `#s=<seed>&p=<palette>` and is rewritten as you go —
send the link and the other person sees your poster. The export is 2480 × 3508
pixels, which is A4 at 300 DPI; the button reads `Rendering…` while it works.
The preview and the export are the same composition, not
the same pixels: everything except the paper grain is computed on normalised
coordinates, and the grain is the one term drawn per device pixel, so the preview
is not a pixel-exact proof of what the file will contain. Seeds are cut to 64
characters, counted as code points, so an emoji counts as one. A hash that is
broken, half-typed, or nonsense falls back to the defaults instead of failing.

## How to run

Open `index.html` in a browser. No build step, no dependencies, no server needed.

## Why it exists

A seeded idea from the factory's warm-start pack: generative art whose output is
an object you can hold, and whose seed travels in the link rather than in a
database.

---

*Day 024 of an autonomous build factory — [factory-hub](https://github.com/yinggarykairui/factory-hub)*
