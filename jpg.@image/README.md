# jpg.@image

A self-contained JPEG codec that speaks the **Universal Image Buffer** — one
byte layout shared by every image snippet in this repo, so that a decoder here
and an encoder over there need to know nothing about each other.

[png](../png.@image/README.md) · **jpg** · [gif](../gif.@image/README.md) · [effects](../image/README.md)
· [Русская версия](../.t9n/ru/jpg.@image/README.md)

Source: [jpg-format.js](jpg-format.js) — one file, no dependencies, no build step.

---

## What this is

`jpg-format.js` is the deep end of the three codecs. It decodes arithmetic-coded
JPEG, progressive JPEG, lossless JPEG and 16-bit precision — things most
real-world decoders quietly refuse — and then re-encodes at the level of a
textbook exercise. That asymmetry is deliberate and is stated in the file's own
header comment.

Five names make up the whole surface, and the same five exist on
[png](../png.@image/README.md) and [gif](../gif.@image/README.md):

| call | returns | throws |
|---|---|---|
| `jpg(bytes, space = 'rgba')` | UIB `Uint8Array` | yes |
| `jpg.from(uib)` | baseline JPEG `Uint8Array` | yes |
| `jpg.check(bytes)` | `boolean` | **never** |
| `jpg.verify(bytes)` | descriptor object | **never** |
| `jpg.toImageData(uib, frame)` | `{ width, height, data }` | yes |
| `jpg.space` | `['rgba', 'hsva', 'hsla']` | — |
| `jpg.trailer` | `Uint8Array \| null` — bytes after EOI | — |

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
  and a 12-bit JPEG all arrive as `0..65535`. JPEG's 8/12/16-bit precision is
  normalised on the way in, so nothing downstream ever asks what precision the
  file had.
- **Alpha always exists and is always channel 3**, in all three colour spaces —
  even though JPEG itself has none, where it is filled with opaque.
- **Animation lives in the buffer.** Delays sit next to the pixels. JPEG is
  always single-frame, but the same buffer carries a twelve-frame APNG.
- **Hue is a full `uint16` turn.** 360° is 65536, so rotating by 180° is `+32768`
  exactly — no degrees, no floats, no drift.
- **N formats cost N adapters, not N².** `jpg.from(png(bytes))` is a complete
  PNG→JPEG converter, and neither snippet has heard of the other.

What it deliberately does **not** carry: loop counts, ICC profiles or any colour
management, per-frame offsets and disposal ops, palettes, EXIF, or any metadata
at all. EXIF orientation is applied to the pixels and then discarded.

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
| `jpg.check` | 3 bytes | nothing | never | wrong file type |
| `jpg.verify` | one pass over the file | a descriptor | never | structural corruption |
| `jpg(...)` | proportional to pixels | the full raster | yes | everything else |

**`check`** compares `FF D8 FF` and returns a boolean. Non-`Uint8Array` input is
`false`, not an exception. It is a triage function: use it to route a byte blob
to the right codec, never to conclude the file is sound.

**`verify`** is the most semantic of the three codecs' checkers. It walks the
marker chain and enforces cross-references that a pure framing check would miss:

- every scan component must reference a **declared** quantization table;
- for Huffman streams, a scan must reference **declared** DC and AC tables — and
  it works out *which* are actually needed, honouring the progressive rules
  (`Ss == 0 && Ah == 0` needs DC, `Ss > 0` needs AC) and lossless mode;
- a scan may not reference a component the frame never declared;
- sampling factors must be 1–4;
- **hierarchical mode is rejected with a clear message** rather than silently
  mis-parsed — a second `SOFn` in the file is an error, not a guess.

It **never throws** and **always returns the same shape**, with fields filled in
up to the point of failure:

```js
{
  ok: true, error: null, format: 'jpeg',
  width: 1920, height: 1080, frames: 1,
  precision: 8, components: 3,
  mode: 'progressive', entropy: 'huffman', colorTransform: -1,
  scans: 10, restartInterval: 0, trailer: 0
}
```

`mode` is one of `baseline` / `sequential` / `progressive` / `lossless` /
`hierarchical`; `entropy` is `huffman` or `arithmetic`; `colorTransform` is the
Adobe APP14 byte or `-1` when absent. `trailer` counts bytes after `EOI`.

**Where `verify` stops.** It never touches entropy-coded data — it skips it by
scanning for the next real marker, respecting `FF00` stuffing and `RSTn`. A
corrupt Huffman or arithmetic stream passes `verify` and only fails in the
decoder. The source says so in as many words.

**Note the division of labour with `from`.** `verify` inspects foreign bytes;
`from` produces your own. They never meet.

---

## Decoder — complete, minus one mode

- **Entropy layers: both.** Huffman *and* arithmetic — a full QM-coder per
  T.81 Annex D. Arithmetic JPEG is rare and most decoders simply reject it.
- **Frame types:** `SOF0`/`SOF1` sequential, `SOF2` progressive, `SOF3` lossless,
  and their arithmetic twins `SOF9`/`SOF10`/`SOF11`.
- **Hierarchical (`SOF5-7`/`SOF13-15`) is not implemented** — and is rejected
  with a clear error instead of being silently misread. The distinction matters
  more than the coverage.
- Precision 8, 12 and 16 bits; arbitrary sampling factors.
- `DRI`/`RSTn` with resynchronisation, `DNL` (height declared after the scan),
  multiple scans.
- **Colour:** grayscale, YCbCr, RGB, CMYK and YCCK, with Adobe APP14 and its
  inversion handled. With no APP14, three components are YCbCr *unless* the
  component IDs are literally `'R'`, `'G'`, `'B'`; lossless frames define no
  transform, so their components are taken as-is.
- **EXIF orientation is applied to the pixels** and then dropped — the buffer is
  upright, and no consumer has to remember to rotate.
- **`jpg.trailer`** holds whatever follows `EOI`. Marker walking stops cleanly at
  `EOI`, so a polyglot file — the classic *rarjpeg*, a ZIP or RAR appended to a
  JPEG — decodes normally and hands you the tail instead of choking on it.

  Caveat worth knowing: `jpg.trailer` is a **module-level property reassigned on
  every decode**. Read it immediately after the call; it is not safe across
  interleaved or concurrent decodes.

---

## Encoder — deliberately dumb

Baseline `SOF0`, a quantization table **of all ones** (so there is effectively no
quantization), 4:4:4 with no chroma subsampling, the standard Annex K Huffman
tables, a single scan, no restart markers. The output is a valid baseline JPEG
that anything opens — and a large one.

There is no quality setting and no knobs. The residual **±1 LSB** loss is the DCT
round-trip itself, not a configuration you can turn off.

Two behaviours to know before you call it:

- **Alpha is lost.** JPEG has no alpha channel; transparency silently becomes
  opaque. Round-trip a semi-transparent pixel and it comes back at full opacity.
- **Only frame 0 is written.** Hand `jpg.from` a twelve-frame UIB and you get a
  one-frame JPEG of the first frame, without a warning. JPEG cannot express the
  rest.

Dimensions are `uint16`, so anything past 65535 on an axis throws a clear error.

---

## Worked example

```js
import jpg from './jpg-format.js';
import grayscale from '../image/grayscale-effect.js';

const bytes = new Uint8Array(await readFile('in.jpg'));

if (!jpg.check(bytes)) throw new Error('not a JPEG');

const info = jpg.verify(bytes);
if (!info.ok) throw new Error(info.error);
// → { ok: true, mode: 'progressive', entropy: 'huffman', width: 1920, … }

const uib  = jpg(bytes);              // 16 bit/channel, rgba, already upright
const tail = jpg.trailer;             // read it now — reassigned on next decode

const gray = grayscale(uib, 'luma601');
await writeFile('out.jpg', jpg.from(gray));
```

Cross-format, same buffer, no intermediate knowledge:

```js
import png from '../png.@image/png-format.js';

await writeFile('out.png', png.from(jpg(bytes)));   // JPEG → PNG, lossless from here on
```

Working in a different space costs one argument, and the effect follows:

```js
const uib = jpg(bytes, 'hsva');            // decode straight into HSVA
grayscale(uib, 'value');                   // S := 0 — one field write, no maths
```

---

## UX / DX — what the design buys

- **One vocabulary across three formats.** Learn `check`/`verify`/call/`from`
  once and you know all of `png.@image`, `jpg.@image` and `gif.@image`. Swapping
  codecs is swapping an import.
- **`verify` returns one shape, always.** No union types, no "sometimes null".
  Read `.ok`, then `.error`, then the fields — partially filled diagnostics are
  more useful than an exception with a string in it.
- **Unsupported beats misparsed.** Hierarchical mode is named and refused. A
  decoder that guesses is worse than one that stops.
- **Nothing throws until you ask for pixels.** Probing untrusted bytes costs no
  try/catch and no raster allocation.
- **Errors name the offending byte.** `'segment 0xC4 runs past end of file'`,
  `'scan references undeclared DC table 1'` — not `'parse error'`.
- **Awkward reality is handled once, here.** EXIF rotation, Adobe colour
  transforms, CMYK inversion, appended archives: all absorbed by the decoder so
  that consumers of the buffer never see them.

One caveat to set expectations: **the source comments and every error message are
in Russian.** English documentation, Russian internals.

---

## Scope — portfolio and PoC DX, not production

This is an illustration of a universal buffer for easy processing. It is not a
library to put under load, and the following are known, accepted costs:

- **Nothing compresses.** JPEG quantizes with a table of ones, PNG uses stored
  deflate blocks, GIF resets its LZW dictionary every 254 codes. Output is
  correct and portable, and several times larger than a real encoder's.
- **The DCT is the literal `O(n²)` definition**, two nested passes of eight
  multiply-accumulates per row and column. No AAN, no integer approximation.
- **Memory is 8 bytes per pixel per frame**, and effects copy the buffer. A
  4000×3000 photo is ~96 MB in UIB, and a grayscale pass makes it ~192 MB.
  No streaming, no tiling, no worker offload.
- **`jpg.trailer` is mutable module state** — not concurrency-safe.
- **`verify` cannot certify an entropy stream** (see above).
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
import { dct8, idct8 } from '../algorithm/dct8.js';
```

`image/buffer-helper.js` holds the `UIB core v1` block that used to sit, byte
for byte, in all five image files. Everything that is *not* specific to images
went to `algorithm/` instead — CRC-32, Adler-32, inflate, stored-deflate, LZW,
the 8×8 DCT. The rule for that directory is exactly that test: an algorithm
belongs there only if you can name a use for it outside the domain it came from.
zip, gzip, PDF and audio codecs all want those six; nothing outside imaging
wants a pixel buffer layout, so the buffer stays a helper.

The build inlines all of it back, so `jpg.@image/es16@mjs/jpg-format.js`
works with no package, no install and no bundler — exactly as before. See
[BACKLOG.md](../BACKLOG.md).

The files are ES modules (`export default jpg`). Node needs `.mjs` or
`"type": "module"`; browsers and bundlers take them as-is.

Directory naming follows [CODE_STRUCTURE.md](../CODE_STRUCTURE.md): `.@image` is
the topic class, and translations live under `.t9n/<lang>/` mirroring the tree.

---

[png](../png.@image/README.md) · **jpg** · [gif](../gif.@image/README.md) · [effects](../image/README.md)
