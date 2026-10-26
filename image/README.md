# image

Effects that operate on the **Universal Image Buffer** directly, without knowing
or caring which codec produced it. These are the payoff for the buffer existing
at all: ten lines of arithmetic that work on a still JPEG and a twelve-frame
APNG identically.

[png](../png.@image/README.md) · [jpg](../jpg.@image/README.md) · [gif](../gif.@image/README.md) · **effects**
· [Русская версия](../.t9n/ru/image/README.md)

Source: [grayscale-effect.js](grayscale-effect.js) ·
[inversion-effect.js](inversion-effect.js) — one file each, no dependencies.

---

## The shape of an effect

```js
fx(uib, mode) → new UIB
```

Both files follow the same five rules, and any effect added here should too.

1. **The caller's buffer is never modified.** The input is validated, copied
   once, and all work happens on the copy. `uibRead(uib)` first — so a bad buffer
   throws before anything is allocated — then `uibRead(src.buf.slice())`.
2. **The mode picks a working colour space; the buffer is returned in the one it
   arrived in.** `uibConvert` handles both directions. Decode into HSLA and the
   result is HSLA; the header byte is never rewritten.
3. **Alpha is not touched** unless the mode says so by name.
4. **All frames are processed at once.** The pixel loop runs over the whole
   `u.px` view, which spans every frame. There is no frame argument, and effects
   do not know whether they are looking at an animation.
5. **The header and the delay table survive untouched**, because the copy
   includes them. Timing passes through an effect for free.

Each module also exports its mode list: `grayscale.modes`, `inversion.modes`.

---

## grayscale

```js
import grayscale from './grayscale-effect.js';

grayscale(uib);              // 'luma' — the default
grayscale(uib, 'lightness');
```

| mode | works in | what it does |
|---|---|---|
| `luma` *(default)* | RGBA | Rec. 709 weights — `0.2126 / 0.7152 / 0.0722` |
| `luma601` | RGBA | Rec. 601 weights — `0.299 / 0.587 / 0.114` |
| `average` | RGBA | plain arithmetic mean of R, G, B |
| `lightness` | HSLA | `S := 0` — keeps L |
| `value` | HSVA | `S := 0` — keeps V |

The last two compute nothing at all. In their own colour space, desaturating is
zeroing one channel — and that is precisely why the space is recorded in the UIB
header rather than assumed. Feed the decoder `'hsla'` up front and `lightness`
becomes a single write per pixel with no conversion on either side.

Pure red, `(65535, 0, 0)`, through each mode:

| mode | result |
|---|---|
| `luma` | `13933` |
| `luma601` | `19595` |
| `average` | `21845` |
| `lightness` | `32768` |
| `value` | `65535` |

Five defensible answers to "how bright is red". Which one you want depends on
whether you are matching perception, matching a video standard, or matching
Photoshop — so the mode is an argument rather than a hardcoded constant.

---

## inversion

```js
import inversion from './inversion-effect.js';

inversion(uib);              // 'rgb' — the default
inversion(uib, 'hue');
```

| mode | works in | what it does |
|---|---|---|
| `rgb` *(default)* | RGBA | `R,G,B := MAX − v` — the familiar negative, alpha intact |
| `alpha` | **any** | `A := MAX − A` — colour untouched |
| `lightness` | HSLA | `L := MAX − L` — hue and saturation stay |
| `value` | HSVA | `V := MAX − V` — hue and saturation stay |
| `hue` | HSLA | `H += 180°`, which is exactly `+32768` |

`alpha` declares no working space on purpose. Alpha is channel 3 in all three
spaces, so converting the buffer to invert it would be pure waste — the mode
table carries `space: null` and the conversion is skipped.

`hue` is exact because UIB stores hue as a `uint16` covering one full turn: half
a turn is `+32768` with no remainder, no degrees and no floating point.

Pure red, `(65535, 0, 0, 65535)`, through each mode:

| mode | result |
|---|---|
| `rgb` | `0, 65535, 65535` — cyan |
| `alpha` | `65535, 0, 0` with alpha `0` |
| `lightness` | `65534, 0, 0` — red, one LSB short |
| `value` | `0, 0, 0` — black |
| `hue` | `1, 65535, 65535` — cyan, one LSB off |

Those off-by-one results are not bugs, and they are worth looking at.

---

## The honest caveats

**Colour-space round trips lose a little.** HSL and HSV are integer here.
Inverting the lightness of pure red should give back pure red, and it gives
`65534`. RGBA → HSLA → RGBA is not an identity, and every mode that needs a space
change pays that toll once each way. Modes that work natively in the buffer's own
space pay nothing — another reason to decode into the space you intend to use.

**No linearisation.** The luma weights are applied to gamma-encoded sRGB values.
This is what most naive implementations do and what most people expect to see,
but it is not physically correct: proper luma means linearising, weighting, then
re-encoding. The same applies to `rgb` inversion — it is the negative from a
graphics editor, not an inversion in linear light. Both files say so in their own
header comments.

**Effects double memory.** Copying means peak usage is two full buffers. At 8
bytes per pixel per frame, a 4000×3000 photo is ~96 MB in, ~192 MB at peak.

---

## Why this is the point

Without a shared buffer, "grayscale a PNG, a JPEG and a GIF" is three
implementations against three pixel layouts, three bit depths and three alpha
conventions. With one:

```js
import png from '../png.@image/png-format.js';
import gif from '../gif.@image/gif-format.js';
import jpg from '../jpg.@image/jpg-format.js';
import grayscale from './grayscale-effect.js';

const decode = { png, gif, jpg };

const uib = decode[kind](bytes);         // 16-bit, alpha-carrying, every frame
await writeFile(out, png.from(grayscale(uib, 'luma')));
```

The effect has no branches. It never asks what the source was, how deep its
samples were, whether it had a palette, or how many frames there are. A
twelve-frame animated GIF goes through the same loop as a one-frame JPEG and
comes out the other side still animated, still timed, in whatever container you
choose to encode to.

That is the whole thesis: **N formats and M effects cost N + M pieces of code,
not N × M.**

---

## Scope — portfolio and PoC DX, not production

These are illustrations, not a filter library. The processing is a
straight-line loop over a `Uint16Array` with no SIMD, no workers, no tiling and
no streaming. There is no compositing, no resampling, no convolution — anything
needing neighbouring pixels would need a second buffer and is not here.

What they demonstrate is DX: that a well-chosen buffer makes an image effect
small enough to read in one sitting, and correct across formats by construction
rather than by testing.

---

## Snippet conventions

What is self-sufficient is the **artifact**, not the source. An effect
imports the buffer core it needs and nothing else:

```js
import { uibRead, uibConvert, UIB_MAX } from './buffer-helper.js';
```

`buffer-helper.js` holds the `UIB core v1` block that used to sit, byte for
byte, in all five image files. Effects use a handful of its names — `uibRead`,
`uibConvert`, `UIB_MAX` and the space constants — and now import exactly those
instead of carrying the whole block along.

Everything that is *not* specific to images went to `../algorithm/` instead:
CRC-32, Adler-32, inflate, stored-deflate, LZW, the 8×8 DCT. That directory has
one entry rule — an algorithm belongs there only if you can name a use for it
outside the domain it came from. zip, gzip, PDF and audio codecs all want those
six; nothing outside imaging wants a pixel buffer layout, which is why the
buffer stays a helper.

The build inlines it all back, so
`image/es16@mjs/grayscale-effect.js` works with no package, no install and no
bundler — exactly as before. See [BACKLOG.md](../BACKLOG.md).

The files are ES modules (`export default grayscale`). Node needs `.mjs` or
`"type": "module"`; browsers and bundlers take them as-is.

Source comments and error messages are in Russian. English documentation,
Russian internals.

---

[png](../png.@image/README.md) · [jpg](../jpg.@image/README.md) · [gif](../gif.@image/README.md) · **effects**
