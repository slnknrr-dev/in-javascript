# JavaScript Development CV

[← Return to `in-javascript`](https://codeberg.org/slnknrr/in-javascript)
· [Profile README →](https://codeberg.org/slnknrr/.profile)
· [Web development CV →](https://codeberg.org/slnknrr/in-html/src/branch/all-in-one/WEBDEV_CV.md)

> A supplementary CV: it covers only what the `in-javascript` repository and
> the packages grown from it show. Browser work and the web portfolio are in
> [in-html](https://codeberg.org/slnknrr/in-html).

## Profile

JavaScript engineer working at the level where the language meets the
runtime: how data is laid out and moved, what an engine actually allocates,
and which feature costs what on which engine. I treat the repository as an R&D
lab. A question gets a naive implementation as its specification, then a
canonical one, then variants in other paradigms, and each is measured against
the other two. The results are code, documentation, build tooling and
published packages.

## What the work shows

**Language tooling, written from scratch.** I wrote `downgrade`: about 10,000
lines with zero dependencies, which does what Babel, a bundler, Terser and a
polyfill service do together. It runs a tokenizer, a parser and scope
analysis, then about 30 lowering passes: classes, generators and async as
state machines, destructuring, optional chaining, the RegExp `u` and `s` flags
with generated Unicode tables. It then links, polyfills, minifies and mangles,
and stamps every artifact with a content hash. One ES2025+ module becomes
single-file builds for ES3 through ES2025 and Node 4 through 24, in both CJS
and ESM. The result is evidence that I can read a language specification and
turn it into a working compiler.

**Build engineering as a discipline.** Builds are incremental and keyed by
tree hashes, so editing a comment changes no output byte. `--check` makes
stale artifacts a CI failure. Lint enforces structural invariants, so a file's
path alone declares its dialect, runtime and target. Forgejo and GitHub Actions
load the artifacts on the real old engines (a Node 4–24 matrix), so
compatibility is checked by running the code, not by reading a table. A bot
commits only real changes.

**Algorithms and data structures — ports and originals.**
- Ports: Python `itertools` (all 19), Python `secrets`, Java 6 collections
  (`ArrayList`, `HashMap`, `TreeMap`, `PriorityQueue`, `LinkedHashSet`, …) and
  a Rust prelude. Each port reproduces the original's semantics, not just its
  names.
- Originals: TIDE, an injective, tunable discrete-log encoding with
  documented guarantees. Also a ChaCha20 block, CSPRNG and LCG generators, a
  Feistel permutation, PNG/JPEG/GIF and text codecs, IPv4/IPv6/MAC/email
  parsers, and numerics (matrices, calculus, trigonometry, geometry).

**The language itself as the subject.** Polyfills for Promise, Symbol,
WeakMap, Object and Set show where the standard library's seams are.
`.@ninjacode/` and `.@typescript/` restate the same ideas in other paradigms.

**Modularity and reuse.** Every topic is split into small single-role modules
(`<subject>-<role>.js`) that build on one another instead of copying code. The
build inlines them back into one file per target, so I get fine-grained
sources without fine-grained distribution.

**Documentation that runs.** Explanations sit next to the code. Write-ups
double as test suites: every listing is runnable and checked with
`node:assert`. See [DEMO_FOR_TIDE.md](hashes.@crypto/DEMO_FOR_TIDE.md).

## Published packages

The R&D outcomes are published to npm as
[npmjs.com/~slnknrr](https://www.npmjs.com/~slnknrr). Each package is pure
ESM, has zero dependencies and ships TypeScript declarations. The package name
says what kind of package it is:

- **a single word** (`@slnknrr/id`): a full library;
- **`-im` / `-ez`**: a full library in two "accents" over one engine. `-im`
  returns rich `0/1/-1` or bit-flag answers; `-ez` uses familiar names and
  returns plain booleans;
- **`some-name.js`**, with `.js` in the name (`@slnknrr/tide-hash.js`,
  planned): a single snippet from this repository, published as is.

| package | what it shows |
| --- | --- |
| [`str-im`](https://www.npmjs.com/package/@slnknrr/str-im) / [`str-ez`](https://www.npmjs.com/package/@slnknrr/str-ez) | Zero-allocation strings: code points kept as V8 Smis, UTF-8 inspected without decoding, grapheme and display width, mixed-script and homoglyph detection |
| [`num-im`](https://www.npmjs.com/package/@slnknrr/num-im) / [`num-ez`](https://www.npmjs.com/package/@slnknrr/num-ez) | Numbers as exact BigInt rationals in any base: one canonical form per value, modular arithmetic, number theory |
| [`buf-im`](https://www.npmjs.com/package/@slnknrr/buf-im) | Bytes across every `ArrayBufferView` without copying: `memcmp`, constant-time equality, bit fields, LEB128, CRC-32, file-type sniffing |
| [`arr-im`](https://www.npmjs.com/package/@slnknrr/arr-im) | Array structure algebra: cycle-safe deep comparison, structural diff, zero-copy views, in-place rotate and partition |
| [`type-im`](https://www.npmjs.com/package/@slnknrr/type-im) / [`type-ez`](https://www.npmjs.com/package/@slnknrr/type-ez) | Type checks that work across realms and catch forgeries; each predicate returns a bitmask of its evidence, not a verdict |
| [`id`](https://www.npmjs.com/package/@slnknrr/id) | ULID and UUID v4/v7/v8; the CSPRNG-free mode is a seeded, reversible 53-bit bijection of (time, counter) |

## How I work

- **Specification before optimisation.** The naive version stays in the
  repository as the reference the fast version must agree with.
- **Allocation-aware by default.** I ask what the engine creates before I ask
  how the code looks.
- **Portability is tested, not assumed.** If an artifact claims ES3, it is run
  on an ES3-era engine.
- **Small surface, honest answers.** An API that knows more than "true" says
  so (`-1`, bit flags), and a friendly wrapper is offered beside it.

## Stack

JavaScript (ES3 → ES2025+), Node.js, ESM/CommonJS, compiler and bundler
internals, TypeScript lowering, BigInt and typed arrays, Git, Forgejo Actions,
GitHub Actions, npm publishing.
