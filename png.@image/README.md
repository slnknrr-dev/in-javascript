# png.@image

A self-contained PNG/APNG codec that speaks the **Universal Image Buffer** — one
byte layout shared by every image snippet in this repo, so that a decoder here
and an encoder over there need to know nothing about each other.

**png** · [jpg](../jpg.@image/README.md) · [gif](../gif.@image/README.md) · [effects](../image/README.md)
· [Русская версия](../.t9n/ru/png.@image/README.md)

Source: [png-format.js](png-format.js) — one file, no dependencies, no build step.

---

## What this is

`png-format.js` decodes essentially any PNG you will meet in the wild and
re-encodes it deliberately badly. That asymmetry is the point, and it is stated
in the file's own header comment: the decoder is a serious piece of work, the
encoder is the shortest thing that produces a byte-correct file.

Five names make up the whole surface, and the same five exist on
[jpg](../jpg.@image/README.md) and [gif](../gif.@image/README.md):

| call | returns | throws |
|---|---|---|
| `png(bytes, space = 'rgba')` | UIB `Uint8Array` | yes |
| `png.from(uib)` | PNG/APNG `Uint8Array` | yes |
| `png.check(bytes)` | `boolean` | **never** |
| `png.verify(bytes)` | descriptor object | **never** |
| `png.toImageData(uib, frame)` | `{ width, height, data }` | yes |
| `png.space` | `['rgba', 'hsva', 'hsla']` | — |

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
  and a 12-bit JPEG all arrive as `0..65535`. Bit depths are expanded by *bit
  replication*, not by shifting — 1-bit white becomes `0xFFFF`, not `0x0001` —
  so white stays white. Downstream code never branches on depth.
- **Alpha always exists and is always channel 3**, in all three colour spaces.
  An effect that must not touch transparency simply skips index 3.
- **Animation lives in the buffer.** Delays sit next to the pixels, so APNG in →
  GIF out keeps its timing with no side channel and no options object.
- **Hue is a full `uint16` turn.** 360° is 65536, so rotating by 180° is `+32768`
  exactly — no degrees, no floats, no drift.
- **N formats cost N adapters, not N².** `gif.from(png(bytes))` is a complete
  PNG→GIF converter, and neither snippet has heard of the other.

What it deliberately does **not** carry: loop counts, ICC profiles or any colour
management, per-frame offsets and disposal ops, palettes, EXIF, or any metadata
at all. Decoders composite down to full frames and throw the rest away.

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
| `png.check` | 8 bytes | nothing | never | wrong file type |
| `png.verify` | one pass over the file | a descriptor | never | structural corruption |
| `png(...)` | proportional to pixels | the full raster | yes | everything else |

**`check`** compares the eight signature bytes `89 50 4E 47 0D 0A 1A 0A` and
returns a boolean. Non-`Uint8Array` input is `false`, not an exception. It is a
triage function: use it to route a byte blob to the right codec, never to
conclude the file is sound.

**`verify`** walks the chunk chain, validates CRC32 on every chunk, and enforces
the rules a decoder would otherwise discover the hard way: IHDR first and only
once, bit depth legal for the colour type, palette present for colour type 3,
PLTE and tRNS before IDAT, `fcTL` count matching `acTL`, APNG frames inside the
canvas, known `dispose_op`/`blend_op`. It **never throws** and **always returns
the same shape**, with fields filled in up to the point of failure:

```js
{
  ok: false, error: 'CRC of chunk IDAT does not match', format: 'png',
  width: 320, height: 240, frames: 1,
  depth: 8, ctype: 6, interlace: 0,
  palette: false, transparency: false,
  chunks: 2, trailer: 0
}
```

`format` flips to `'apng'` and `frames` to the real count when a valid `acTL` is
present. `trailer` is the number of bytes after `IEND` — non-zero means
something is appended to the file.

**Where `verify` stops.** It does not inflate. PNG's per-chunk CRC means random
bit-rot inside `IDAT` *is* caught, which makes this the strongest `verify` of the
three codecs — but a stream whose CRC is consistent and whose deflate payload is
nonetheless undecodable will pass. Only the decoder can settle that.

**Note the division of labour with `from`.** `verify` inspects foreign bytes;
`from` produces your own. They never meet.

---

## Decoder — complete

- Colour types 0, 2, 3, 4, 6; bit depths 1, 2, 4, 8, 16 in every legal pairing.
- `PLTE`, and `tRNS` in all three flavours (palette alpha, grey key, RGB key).
- Adam7 interlacing, all seven passes.
- All five row filters — None, Sub, Up, Average, Paeth.
- Its own `inflate`, written as the **puff** algorithm: canonical Huffman codes
  walked bit by bit through `count`/`symbol` arrays, no lookup tables. Slow and
  obviously correct, which is the trade this repo keeps making.
- Full APNG: `acTL`/`fcTL`/`fdAT`, `dispose_op` 0/1/2 including the
  restore-to-previous snapshot, `blend_op` SOURCE and OVER with real
  source-over alpha compositing. Frames are composited onto a canvas and stored
  **whole**, so frame *n* of the UIB is what you would see on screen at step *n*
  — no replaying the animation to seek.

---

## Encoder — deliberately dumb

Colour type 6, 16 bit, no interlacing, filter 0 on every row, deflate emitted as
**stored blocks only**. The zlib wrapper and its adler32 are correct, so the
output is a valid PNG that every viewer opens — it is simply not compressed at
all, and comes out slightly larger than the raw pixels. There is no compressor in
the file.

A multi-frame UIB becomes an APNG of full-frame `fdAT`s with `dispose = NONE` and
`blend = SOURCE`, `num_plays = 0` (infinite, because UIB carries no loop count).
Delays are written as `ms/1000`, and `delay_num` is a `uint16` — so **65.535 s is
the longest frame** that survives the trip.

No quality setting, no filter heuristic, no palette reduction. There are no
knobs, and that is a decision rather than an omission.

---

## Worked example

```js
import png from './png-format.js';
import grayscale from '../image/grayscale-effect.js';

const bytes = new Uint8Array(await readFile('in.png'));

if (!png.check(bytes)) throw new Error('not a PNG');

const info = png.verify(bytes);
if (!info.ok) throw new Error(info.error);
// → { ok: true, format: 'apng', width: 320, height: 240, frames: 12, depth: 8, … }

const uib  = png(bytes);              // every frame, 16 bit/channel, rgba
const gray = grayscale(uib, 'luma');  // all 12 frames, alpha untouched

await writeFile('out.png', png.from(gray));   // APNG in, APNG out, delays intact
```

Cross-format, same buffer, no intermediate knowledge:

```js
import gif from '../gif.@image/gif-format.js';

await writeFile('out.gif', gif.from(png(bytes)));   // PNG → GIF
```

Working in a different space costs one argument, and the effect follows:

```js
const uib = png(bytes, 'hsla');            // decode straight into HSLA
grayscale(uib, 'lightness');               // S := 0 — one field write, no maths
```

---

## UX / DX — what the design buys

- **One vocabulary across three formats.** Learn `check`/`verify`/call/`from`
  once and you know all of `png.@image`, `jpg.@image` and `gif.@image`. Swapping
  codecs is swapping an import.
- **`verify` returns one shape, always.** No union types, no "sometimes null".
  Read `.ok`, then `.error`, then the fields — partially filled diagnostics are
  more useful than an exception with a string in it.
- **Nothing throws until you ask for pixels.** Probing untrusted bytes costs no
  try/catch and no raster allocation.
- **Errors name the offending byte.** `'chunk IDAT runs past end of file'`,
  `'depth 3 is not valid for colour type 2'` — not `'parse error'`.
- **Effects are format-agnostic and frame-agnostic by construction.** A
  ten-line grayscale works identically on a still PNG and a twelve-frame APNG,
  because both are the same buffer.

One caveat to set expectations: **the source comments and every error message are
in Russian.** English documentation, Russian internals.

---

## Scope — portfolio and PoC DX, not production

This is an illustration of a universal buffer for easy processing. It is not a
library to put under load, and the following are known, accepted costs:

- **Nothing compresses.** PNG uses stored deflate blocks, GIF resets its LZW
  dictionary every 254 codes, JPEG quantizes with a table of ones. Output is
  correct and portable, and several times larger than a real encoder's.
- **`inflate` is the slow one on purpose** — bit-at-a-time, no tables.
- **Memory is 8 bytes per pixel per frame**, and effects copy the buffer. A
  4000×3000 photo is ~96 MB in UIB, and a grayscale pass makes it ~192 MB.
  No streaming, no tiling, no worker offload.
- **`verify` cannot certify a compressed stream** (see above).
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
import { crc32 } from '../algorithm/crc32.js';
import { inflateZlib } from '../algorithm/inflate.js';
import { deflateStored } from '../algorithm/deflate-stored.js';
```

`image/buffer-helper.js` holds the `UIB core v1` block that used to sit, byte
for byte, in all five image files. Everything that is *not* specific to images
went to `algorithm/` instead — CRC-32, Adler-32, inflate, stored-deflate, LZW,
the 8×8 DCT. The rule for that directory is exactly that test: an algorithm
belongs there only if you can name a use for it outside the domain it came from.
zip, gzip, PDF and audio codecs all want those six; nothing outside imaging
wants a pixel buffer layout, so the buffer stays a helper.

The build inlines all of it back, so `png.@image/es16@mjs/png-format.js`
works with no package, no install and no bundler — exactly as before. See
[BACKLOG.md](../BACKLOG.md).

The files are ES modules (`export default png`). Node needs `.mjs` or
`"type": "module"`; browsers and bundlers take them as-is.

Directory naming follows [CODE_STRUCTURE.md](../CODE_STRUCTURE.md): `.@image` is
the topic class, and translations live under `.t9n/<lang>/` mirroring the tree.

---

**png** · [jpg](../jpg.@image/README.md) · [gif](../gif.@image/README.md) · [effects](../image/README.md)
