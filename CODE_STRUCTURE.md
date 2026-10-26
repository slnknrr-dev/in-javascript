# Code structure

The file and folder standard for this snippet repository. The tooling
([downgrade-scan.js](downgrade-scan.js)) reads no configuration: what a file
*is* follows from its path, so these rules are load-bearing.

---

## 1. The root

| what | rule |
|---|---|
| `*.js`, `*.cjs`, `*.json` in the root | **tooling only** (`downgrade*.js`). Snippets never live in the root; the scanner skips root-level files |
| `*.md` in the root | repository-wide documentation |
| `package.json` | npm scripts for the tooling; no dependencies |
| `.forgejo/` | CI (Forgejo Actions on Codeberg) — the only tooling that is not flat |
| `.t9n/<lang>/` | translations of documentation, mirroring the repository paths |

There is no `.test/` folder. Tests and demos are runnable listings inside the
Markdown next to the code they describe (see §5).

## 2. Folder names

One dot-step per level: `a.b` is allowed, `a.b.c` is not.

| pattern | meaning | examples |
|---|---|---|
| `<topic>/` | a plain subject | `array/`, `crypto/`, `math/`, `string/` |
| `<topic>.@<class>/` | a subject narrowed by a class | `png.@image/`, `email.@string/`, `hashes.@crypto/`, `base64.@encoding/`, `regexp.@inline/` |
| `<package>.<source>@<version>/` | a port of another language's library | `itertools.python@3/`, `secrets.python@3/`, `prelude.rust@1/`, `prelude.java@6/` |
| `<module>.<runtime>@<version>/` | a runtime module's API at that version | `@.nodejs/crypto.nodejs@21/` |
| `.@<dialect>/` | code written in a **dialect** of JavaScript | `.@typescript/`, `.@coffeescript/` |
| `.@<paradigm>/` | code written in an **architectural style / paradigm** | `.@ninjacode/`, `.@defensiveprogramming/` |
| `@.<runtime>/` | code that **requires** a runtime | `@.nodejs/`, `@.bun/`, `@.deno/` |
| `<standard>@<modules>/` | generated artifacts (§4) | `es5@cjs/`, `es16@mjs/`, `nodejs18@cjs/`, `es6@ts/` |

The two markers read in opposite directions on purpose:

* **`.@x` — "written as x"**: a property of the source text. A dialect changes
  how the code is parsed (`.@typescript` adds `@ts` targets); a paradigm
  (`.@ninjacode`) only groups code by style and changes nothing in the build.
* **`@.x` — "needs x"**: a property of the environment. Code under `@.nodejs/`
  may use `node:*` and `Buffer`, and gets the `nodejs*` target matrix instead
  of the `es*` one. Bun and Deno code is built for the node matrix too.

Markers compose: `.@ninjacode/@.nodejs/` is ninjacode-style code that needs
node.

Topic classes in use: `@string` (inline, single-line formats: emails, IPs,
ISO codes, query strings), `@encoding`, `@crypto`, `@math`, `@image`, `@audio`,
`@video`, `@inline`. A class narrows the topic; it never adds a runtime
requirement.

The language level of a **source** is never limited by its folder: sources are
ES2025+ ESM. A level exists only in an artifact folder name.

## 3. File names

`<subject>-<role>.js` — the subject first, then what the file does with it.

| role suffix | meaning | examples |
|---|---|---|
| `-format` | decode/encode a whole file format | `png-format.js`, `gif-format.js` |
| `-parse` | text → value | `ip4-parse.js`, `mac-parse.js` |
| `-regex`, `-regexp` | a validating regular expression | `email-regex.js` |
| `-escape` | escape for a target syntax | `html-escape.js`, `md-escape.js` |
| `-template` | build text from a template | `html-template.js` |
| `-encode`, `-decode`, `-encoding` | one direction, the other, a showcase of both | `hex-encode.js`, `base64url-encoding.js` |
| `-hash` | value → fixed-length identifier | `tide-hash.js`, `email-hash.js` |
| `-random` | random values of the subject | `ip4-random.js` |
| `-operation` | an arithmetic operation | `pow-operation.js`, `modpow-operation.js` |
| `-detecting`, `-detect` | a predicate | `prime-detecting.js`, `getter-detect.js` |
| `-effect` | an image effect over the UIB | `grayscale-effect.js` |
| `-figure` | a geometric figure | `circle-figure.js` |
| `-prng`, `-block`, `-permutation` | crypto building blocks | `lcg-prng.js`, `chacha20-block.js`, `feistel-permutation.js` |
| `-<x>-sure` | the strict / streaming / defensive variant of `-<x>` | `email-regex-sure.js`, `typedarray-verify-sure.js` |
| `-helper` | **inlined 1:1** into every consumer; has no artifacts of its own | `buffer-helper.js`, `tide-hash-helper.js` |
| `-shim` | an **exported** replacement for a missing built-in (`export function Symbol…`); does not patch globals | `symbol-shim.js`, `weakmap-shim.js` |
| `-polyfil` | a **guarded patch of a global** (`Promise.any`, `Array.prototype.at`) written in ES5; not a module — the build injects it into artifacts that need it | `promise/promise-any-polyfil.js` |

The difference between the last three is the subject of
[SHIM_TERM.md](SHIM_TERM.md), [POLYFIL_TERM.md](POLYFIL_TERM.md) and
[BACKPORT_TERM.md](BACKPORT_TERM.md).

A *showcase* file of a topic contains only `export … from` lines and is the
topic's single entry point (`arraybuffer/arraybuffer.js`, `symbol/symbol.js`).

`algorithm/` is special: reusable algorithms that make sense outside any one
subject (CRC-32, inflate, LZW). They are snippets with artifacts of their own
*and* are imported by other snippets. They import only each other and start with
a header comment naming the algorithm. A helper is the opposite: something only
meaningful inside its subject (`image/buffer-helper.js`).

A file whose first line is `/* npm: <package> */` is published as that npm
package (`hashes.@crypto/tide-hash.js` → `@slnknrr/tide-hash.js`).

## 4. Artifacts

Artifacts exist only where a `*_NOTICE.md` asks for them — its name picks the
engine, obfuscation, dialect and module format (rules:
[README_FOR_DEVOPS.md](README_FOR_DEVOPS.md#notices)). Next to every covered
source the build creates one folder per target, named `<standard>@<modules>`:

* standards: `es3`, `es5`, `es6` (ES2015) … `es16` (ES2025); `nodejs5`,
  `nodejs13`, `nodejs18`, `nodejs21`;
* modules: `cjs`, `mjs`, `ts` (types kept; the consumer's tsconfig decides the
  module system).

Each folder holds `<name>.js` (PLAIN) and/or `<name>.min.js` (MINIFY) per source, plus a
generated `package.json`. Artifact folders contain only generated files; each
starts with a stamp naming the source tree and its hashes. How they are built:
[README_FOR_DEVOPS.md](README_FOR_DEVOPS.md).

```
png.@image/
  png-format.js            source: ES2025+, ESM, imports helpers and algorithm/
  README.md
  es16@mjs/png-format.js   canonical single file: source + inlined imports
  es5@cjs/png-format.js    downgraded, polyfils injected
  es5@cjs/png-format.min.js
@.nodejs/crypto.nodejs@21/
  crypto.js
  nodejs18@cjs/crypto.js
```

## 5. Documentation next to code

Every folder documents itself in Markdown, in English:

| file | content |
|---|---|
| `README.md` | what the folder is, the files in it, how to use them |
| `README_FOR_<X>.md` | the same for one technology inside the folder (`README_FOR_TIDE.md`) |
| `DEMO.md`, `DEMO_FOR_<X>.md` | an article with **runnable listings**: demos and tests in one |
| `INTEGRATION.md` | how to wire the code into an application |
| `*_NOTICE.md` | which artifacts to build for this folder and below (see [README_FOR_DEVOPS.md](README_FOR_DEVOPS.md#notices)) |
| `*_TERM.md` | the definition of a term used across the repository |

A runnable listing is a fenced `js` block whose first line is
`// file: <name>.mjs`. Saved under that name next to the Markdown file it runs
with plain `node`; listings that check something use `node:assert`, so a silent
run means it passed. This replaces `*.test.js` and `*-demo.js` files.

Translations live in `.t9n/<lang>/<same path>/README.md`.
