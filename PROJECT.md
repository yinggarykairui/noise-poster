# PROJECT.md — noise-poster

Written on the first revisit (day 045) of a repo built on day 024, per §4:
a pre-1.3.0 repo gains its PROJECT.md when it is picked up again. It records
the spec being converged on, how the code is shaped, what is closed, what is
fenced out and why, and what is still open.

Repo: `yinggarykairui/noise-poster` · origin issue
[#16](https://github.com/yinggarykairui/factory-hub/issues/16) · residuals
[#58](https://github.com/yinggarykairui/factory-hub/issues/58) · carried
forward in [#123](https://github.com/yinggarykairui/factory-hub/issues/123).

## The spec being converged on

A single page that draws an abstract poster from layered value noise. The seed
and the palette are the whole input, they both live in the URL fragment, and
the export is A4 at 300 DPI. Vanilla HTML, CSS and JS; zero dependencies; no
build step (§13). The seed → pixels contract is frozen: `drawPoster` and every
function it calls are bit-for-bit preserved across revisits, so a link shared
on day 024 still opens the same sheet.

Day 045's increment closes four of #58's ten residuals and the first of its two
delight levers. It adds no new capability to the drawing itself.

## Architecture

- **`index.html`** — one `<main id="page">` grid holding masthead, sheet and
  controls in that source order. No breakpoints in the markup; both
  arrangements are described by one DOM.
- **`style.css`** — two arrangement classes on the same grid, `lay-stack`
  (masthead over poster over controls) and `lay-side` (poster beside them).
  All page colours are CSS custom properties that `paintChrome()` rewrites
  from the active palette, so the chrome and the sheet cannot drift apart.
- **`app.js` — layout.** `relayout()` lays out *both* arrangements on every
  resize, measures the poster each would give, and keeps the larger. There is
  no media query to be wrong about. It writes the canvas's CSS content box and
  returns whether the backing store must be rebuilt.
- **`app.js` — the tone path.** `drawPoster()` is one synchronous typed-array
  fill: five octaves of value noise, flattened to flat tone bands, plus a
  per-device-pixel grain and the seed caption. It is a pure function of
  (seed, palette, size) and is the part of this repo that must not change.
- **`app.js` — state.** One `state = {seed, palette}`, one `apply()` that
  moves it, and one `writeHash()` that mirrors it into `#s=…&p=…` with
  `replaceState`. Every control routes through `apply()`; nothing else writes
  state.
- **`app.js` — the status line.** `#export-note` is `role="status"`, the
  page's only live region, and three writers want it. Ownership is one
  documented rule enforced by `noteReset()` / `noteWrite()` (epoch + rank),
  not by each writer remembering it.

## Done-map — all ten of #58's items

| # | Residual | State |
|---|----------|-------|
| 1 | From 150%/200% zoom on a phone, no control is on the first screen | **excluded** — needs a `POSTER_VH_FLOOR` redesign, not a patch. At 250×445 the 0.55 floor gives 244 px of poster; dropping to `POSTER_MIN_H` buys 44 px, about one control of eight. Carried to #123. |
| 2 | 11 px of horizontal overflow at a 94 CSS px viewport | **excluded** — below WCAG 1.4.10's 320 px target, which passes at 0 px. Letting `#shuffle` shrink moves the overflow into the unbreakable label. Carried to #123. |
| 3 | The draw is synchronous; Shuffle has no pending state | **excluded** — Shuffle is not silent (`Seed: X` through `role="status"`). A disable/relabel dance inside a ≤132 ms fill is a flash, not feedback. Revisit with item 4. Carried to #123. |
| 4 | The backing-store cap softens the poster on large retina displays | **excluded** — 1.5 device px/CSS px at 2560×1400 needs ~2.96 Mpx, ~2.3× today's fill, which is the responsiveness `MAX_BACKING_PX` bought back. Needs a measured adaptive budget. Carried to #123. |
| 5 | A no-op wipes a true announcement | **closed day 045** — `apply()` resets the status line and bumps the epoch only when the seed or the palette actually differs. The doctrine comment was corrected in the same commit. |
| 6 | Overlapping exports leave the earlier failure on the line | **excluded** — re-verified on no user path: `download.disabled` spans the whole export and is cleared in `finally`. Recorded, not owed. Carried to #123. |
| 7 | Nothing in the repo names the file a download produces | **closed day 045** — "What it does" names `noise-poster-<seed-slug>-<palette>.png` and why the palette is in it. |
| 8 | The screenshot's alt text is the word "screenshot" | **closed day 045** — replaced with a sentence describing the shipped capture, verified against the committed `screenshot.png`. |
| 9 | The side arrangement leaves a dead slab under Download | **closed day 045** — CSS only. `.page.lay-side` is now four rows (`1fr`, masthead, controls, `1fr`) with `row-gap: 0` and a 14 px `margin-bottom` welding the masthead to the controls. The leftover is unchanged in total and now splits evenly above and below. The poster's size is untouched at every viewport. |
| 10 | Four smaller truths | **first clause closed day 045** — clicking the poster rerolls it, same code path as Shuffle. **The other three excluded**: the control-character seed caption (needs a seed alias), emoji printing in colour on a monochrome sheet (touches the export path), and Back not undoing a Shuffle (`pushState` would trap Back, and click-to-reroll makes that trade worse). Carried to #123. |

Also fenced out, and named here so it is not re-derived: **the delight
ceiling**. Every poster is still the same family of contoured organic blobs.
Day 045 added a gesture, not a new picture. Changing what the noise *makes* is
not a `size:s` day. Carried to #123.

The excluded set is therefore, in full: items 1, 2, 3, 4, 6, item 10's other
three clauses, and the delight ceiling. Seven members, identical to the day-045
spec comment's EXCLUDES and to #123.

## Open threads

- **#123** carries the seven excluded residuals verbatim. A revisit reads it
  before re-deriving anything.
- **Items 3 and 4 are one conversation** about `MAX_BACKING_PX`. Do not pick
  either alone.
- **Item 1 wants its own day.** It is a redesign of the control stack at small
  viewports, not a constant to nudge.
- **The tone path stays frozen** until a day is picked specifically to change
  it. Any such day breaks old links and must say so in the sign-off.
- **The screenshot is captured at 768×1024 @ dSF 2 with no hash**, which
  resolves to the stack arrangement. Recapture at the same size or the alt
  text stops being true.
