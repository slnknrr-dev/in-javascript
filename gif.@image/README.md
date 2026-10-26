# gif.@image

A self-contained GIF codec that speaks the **Universal Image Buffer** — one
byte layout shared by every image snippet in this repo, so that a decoder here
and an encoder over there need to know nothing about each other.

[png](../png.@image/README.md) · [jpg](../jpg.@image/README.md) · **gif** · [effects](../image/README.md)
· [Русская версия](../.t9n/ru/gif.@image/README.md)

Source: [gif-format.js](gif-format.js) — one file, no dependencies, no build step.

---

## What this is

`gif-format.js` is the smallest of the three codecs and the one where the
decoder does the most *interpretation*. GIF stores animation as a pile of
sub-rectangles with disposal rules; the UIB stores it as whole frames. The
decoder collapses one into the other, so callers never replay an animation to
seek into it.

Five names make up the whole surface, and the same five exist on
[png](../png.@image/README.md) and [jpg](../jpg.@image/README.md):

| call | returns | throws |
|---|---|---|
| `gif(bytes, space = 'rgba')` | UIB `Uint8Array` | yes |
| `gif.from(uib)` | GIF89a `Uint8Array` | yes |
| `gif.check(bytes)` | `boolean` | **never** |
| `gif.verify(bytes)` | descriptor object | **never** |
| `gif.toImageData(uib, frame)` | `{ width, height, data }` | yes |
| `gif.space` | `['rgba', 'hsva', 'hsla']` | — |

`space` picks the colour space the buffer comes back in. `'rgb'`, `'hsv'` and
`'hsl'` are accepted as aliases for the alpha-carrying names.

---

## The Universal Image Buffer

One flat `Uint8Array`. Header, optional frame delays, then pixels.

| offset | size | field |
|---|---|---|
| `0` | 1 | flags — `ff kk ss rr` |
| `1` | 1/2/4/8 | frame count |
| … | 1/2/4/8 | width |
| … | 1/2/4/8 | height |
| `off1` | frames × 4 | frame delays in ms, `uint32` big-endian — **only when frames > 1** |
| `off2` | frames × w × h × 4 × 2 | pixels, `uint16` |

- `ff` and `kk` hold **log₂ of the byte width** used for the frame counter and
  for the two axes (`0`→1 byte, `1`→2, `2`→4, `3`→8). A 16×16 sprite spends one
  byte per axis; a gigapixel scan spends four. Nothing is padded to a fixed size
  it does not need.
- `ss` is the colour space (`0` rgba, `1` hsva, `2` hsla). `rr` is reserved and
  **must be zero** — `uibRead` rejects a non-zero value outright, which is how a
  future layout revision stays distinguishable from a corrupt buffer.
- `off1` is the header length rounded up to a power of two; `off2` adds the
  delay table and rounds to 8. The alignment is not decoration: pixels are read
  through a `Uint16Array` view, and that view needs even alignment to exist at
  all.

What it buys you:

- **Every image is 16 bits per channel.** A 1-bit PNG mask, an 8-bit GIF frame
  and a 12-bit JPEG all arrive as `0..65535`. GIF's palette entries are scaled by
  `×257`, which maps `0xFF` exactly to `0xFFFF` — white stays white.
- **Alpha always exists and is always channel 3**, in all three colour spaces.
  GIF's single transparent index becomes a real alpha value of 0.
- **Animation lives in the buffer.** Delays sit next to the pixels, so GIF in →
  APNG out keeps its timing with no side channel and no options object.
- **Hue is a full `uint16` turn.** 360° is 65536, so rotating by 180° is `+32768`
  exactly — no degrees, no floats, no drift.
- **N formats cost N adapters, not N².** `png.from(gif(bytes))` is a complete
  GIF→APNG converter, and neither snippet has heard of the other.

What it deliberately does **not** carry: loop counts, ICC profiles or any colour
management, per-frame offsets and disposal ops, palettes, EXIF, or any metadata
at all. **This is where GIF loses the most**: the decoder composites the
sub-rectangles and disposal logic away into whole frames, and the encoder can
only write whole frames back. A round trip is visually faithful and structurally
nothing like the original.

One genuine wart, stated plainly: header fields and delays are big-endian, but
**pixels are in host byte order**, because they are a raw `Uint16Array` view. A
UIB buffer is not portable between machines of differing endianness. Every
target you would realistically run this on is little-endian, which is exactly why
the shortcut survived.

*(This section is repeated in each format README on purpose — the same reason the
UIB core block is repeated verbatim in each snippet. See
[snippet conventions](#snippet-conventions).)*

---

## check → verify → decode

Three levels of trust, so a caller pays only for the certainty it actually needs.

| | cost | allocates | throws | catches |
|---|---|---|---|---|
| `gif.check` | 6 bytes | nothing | never | wrong file type |
| `gif.verify` | one pass over the file | a descriptor | never | structural corruption |
| `gif(...)` | proportional to pixels | the full raster | yes | everything else |

**`check`** compares the six signature bytes against `GIF87a` or `GIF89a` and
returns a boolean. Non-`Uint8Array` input is `false`, not an exception. It is a
triage function: use it to route a byte blob to the right codec, never to
conclude the file is sound.

**`verify`** walks the block stream, follows every sub-block chain to its
terminating zero byte, and checks that palettes and descriptors stay inside the
file. It **never throws** and **always returns the same shape**, with fields
filled in up to the point of failure:

```js
{
  ok: true, error: null, format: 'gif', version: 'GIF89a',
  width: 320, height: 240, frames: 12,
  delays: [100, 100, 100, …],          // ms, only when frames > 1
  globalPalette: true, transparency: true, trailer: 0
}
```

**`verify` is deliberately stricter than the decoder.** The decoder tolerates
junk between blocks and moves on; `verify` treats an unknown block marker as an
error and names its offset. The two functions have different jobs, so they get
different tolerances — being lenient when reading and strict when auditing is the
point, not an inconsistency. The source states this explicitly.

**Where `verify` stops.** It does not run LZW. A frame whose block framing is
intact but whose compressed codes are garbage passes `verify` and fails only in
the decoder.

**Note the division of labour with `from`.** `verify` inspects foreign bytes;
`from` produces your own. They never meet.

---

## Decoder — complete

- `GIF87a` and `GIF89a`.
- Global and local colour tables, of any legal size, per frame.
- LZW with the full code-width ramp and dictionary.
- Interlacing — the four-pass row order.
- Graphic Control Extensions: delay, transparent index, and **all four disposal
  methods** (0 unspecified, 1 keep, 2 restore-to-background, 3
  restore-to-previous, which needs a canvas snapshot).
- Sub-rectangle compositing: frames smaller than the logical screen are placed
  at their offset, transparent pixels leave the canvas untouched, and the result
  is snapshotted as a **whole frame** — frame *n* of the UIB is what you would
  see on screen at step *n*.
- Application, comment and plain-text extensions are skipped correctly by
  walking the sub-block chain rather than guessing a length.
- Delays are centiseconds in the file and are converted to **milliseconds** in
  the buffer.

---

## Encoder — deliberately dumb

- **A fixed 6×6×6 palette** (216 web-safe colours) plus index 216 as the
  transparent entry. No median cut, no octree, no dithering — each channel is
  rounded to its nearest of six levels, independently.
- **Full-frame frames with `disposal = 2`**, so every frame stands alone and
  nothing accumulates.
- **LZW without a dictionary**: a `CLEAR` code is emitted every 254 codes, so the
  code width never grows past nine bits. The stream is valid and every decoder
  reads it; it just does not compress.

Consequences to expect:

- **Colour is visibly quantized.** A luma value of `13933` lands on `13107`
  (`51 × 257`); `4732` lands on `0`. Gradients band. This is the single most
  visible artefact of the whole repo.
- **Alpha is binary.** Anything below 50% opacity becomes fully transparent,
  anything at or above becomes fully opaque. GIF cannot express the middle.
- **`num_plays = 0`** — loops forever, because UIB carries no loop count.
- Delays are written as `ms/10` clamped to `uint16`, so **655.35 s is the longest
  frame** that survives.
- Dimensions are `uint16`; anything past 65535 on an axis throws a clear error.

---

## Worked example

```js
import gif from './gif-format.js';
import grayscale from '../image/grayscale-effect.js';

const bytes = new Uint8Array(await readFile('in.gif'));

if (!gif.check(bytes)) throw new Error('not a GIF');

const info = gif.verify(bytes);
if (!info.ok) throw new Error(info.error);
// → { ok: true, version: 'GIF89a', width: 320, height: 240, frames: 12, delays: […] }

const uib  = gif(bytes);              // every frame composited whole, rgba
const gray = grayscale(uib, 'luma');  // all 12 frames at once

await writeFile('out.gif', gif.from(gray));   // timing preserved, colour re-quantized
```

Cross-format, same buffer, no intermediate knowledge:

```js
import png from '../png.@image/png-format.js';

await writeFile('out.png', png.from(gif(bytes)));   // GIF → APNG, 16-bit, real alpha
```

That direction is the good one: APNG can hold everything GIF has and more. Going
the other way costs the palette and the alpha, every time.

---

## UX / DX — what the design buys

- **One vocabulary across three formats.** Learn `check`/`verify`/call/`from`
  once and you know all of `png.@image`, `jpg.@image` and `gif.@image`. Swapping
  codecs is swapping an import.
- **`verify` returns one shape, always.** No union types, no "sometimes null".
  Read `.ok`, then `.error`, then the fields — partially filled diagnostics are
  more useful than an exception with a string in it.
- **Whole frames, not deltas.** The hardest part of consuming GIF — replaying
  disposal to reach frame 7 — is done once in the decoder. Random access to any
  frame is a subarray.
- **Nothing throws until you ask for pixels.** Probing untrusted bytes costs no
  try/catch and no raster allocation.
- **Errors name the offending byte.** `'unknown block 0x2B at offset 812'`,
  `'sub-block chain truncated'` — not `'parse error'`.
- **Timing is data, not an argument.** Delays live in the buffer, so an effect
  that never mentions animation still preserves it.

One caveat to set expectations: **the source comments and every error message are
in Russian.** English documentation, Russian internals.

---

## Scope — portfolio and PoC DX, not production

This is an illustration of a universal buffer for easy processing. It is not a
library to put under load, and the following are known, accepted costs:

- **Nothing compresses.** GIF resets its LZW dictionary every 254 codes, PNG
  uses stored deflate blocks, JPEG quantizes with a table of ones. Output is
  correct and portable, and several times larger than a real encoder's.
- **The encoder's palette is fixed.** Any real GIF tool picks colours per image;
  this one does not, and it shows.
- **Memory is 8 bytes per pixel per frame**, and effects copy the buffer. A
  12-frame 320×240 animation is ~7 MB; whole-frame storage means an animation
  costs frames × full raster regardless of how little moves between them.
- **`verify` cannot certify an LZW stream** (see above).
- **No test suite, no fuzzing, no benchmarks** in the repo.

What it *is* good for: showing that a small, honest, dependency-free core can
span three very different container formats; giving a caller one mental model
instead of three; and demonstrating that once the buffer exists, an image effect
is ten lines that work on stills and animation alike.

---

## Snippet conventions

This is a monorepo of snippets, and what is self-sufficient is the
**artifact**, not the source. The source imports what it shares with its
neighbours:

```js
import { uibCreate, uibRead, uibConvert } from '../image/buffer-helper.js';
import { lzwDecode, lzwEncodeStored } from '../algorithm/lzw.js';
```

`image/buffer-helper.js` holds the `UIB core v1` block that used to sit, byte
for byte, in all five image files. Everything that is *not* specific to images
went to `algorithm/` instead — CRC-32, Adler-32, inflate, stored-deflate, LZW,
the 8×8 DCT. The rule for that directory is exactly that test: an algorithm
belongs there only if you can name a use for it outside the domain it came from.
zip, gzip, PDF and audio codecs all want those six; nothing outside imaging
wants a pixel buffer layout, so the buffer stays a helper.

The build inlines all of it back, so `gif.@image/es16@mjs/gif-format.js`
works with no package, no install and no bundler — exactly as before. See
[BACKLOG.md](../BACKLOG.md).

The files are ES modules (`export default gif`). Node needs `.mjs` or
`"type": "module"`; browsers and bundlers take them as-is.

Directory naming follows [CODE_STRUCTURE.md](../CODE_STRUCTURE.md): `.@image` is
the topic class, and translations live under `.t9n/<lang>/` mirroring the tree.

---

[png](../png.@image/README.md) · [jpg](../jpg.@image/README.md) · **gif** · [effects](../image/README.md)
