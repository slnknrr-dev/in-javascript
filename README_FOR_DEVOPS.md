# README for devops

How the repository builds its artifacts, how to run and configure the
tooling, and how CI uses it.

The tooling is **`downgrade`**: a self-written, zero-dependency "babel" that
bundles each snippet into a single file, lowers its syntax and built-ins to an
older target, minifies it, and stamps it with a hash of its source tree. It is
plain Node.js (≥ 21; CI uses 24) and lives in the repository root as flat
`downgrade*.js` files — nothing to install.

---

## Quick start

```bash
npm run update
```

That is the usual run before a commit: `lint` → `emit` → summary. Other entry
points:

| command | what it does |
|---|---|
| `npm run lint` | structural invariants of the repository (exit 1 on errors) |
| `npm run emit` | build artifacts into `<source dir>/<target>/` |
| `npm run emit:check` | build in memory and compare with disk; exit 1 if artifacts are stale. Writes nothing |
| `npm run tree` | per source: import tree, file hashes, treeHash, and each target's status with the reason |
| `npm run minify -- <file>` | minify one file to stdout (`--stat` for sizes only) |
| `npm run smoke` | load every artifact the current node can run (see [CI](#ci)) |
| `npm run gen:unicode` | regenerate `downgrade-unicode-props.json` (only when adding a `\p{…}` property) |
| `node downgrade.js` | the CLI itself; prints usage |

Arguments go after `--` and narrow the run to files or folders:

```bash
npm run emit -- png.@image/ --force
```

```bash
npm run emit -- --check --report=build.md --why
```

| flag | meaning |
|---|---|
| `--check` | write nothing, compare with disk (exit 1 on difference) |
| `--force` | rebuild even when the treeHash matches |
| `--prune` | delete artifacts whose source or target no longer exists |
| `--targets=a,b` | limit the target set (`--targets=es5@cjs,es16@mjs`) |
| `--why` | the reason for every `pending` / `unsupported` pair |
| `--report=<file>` | build report: `.json` machine-readable, otherwise Markdown |
| `--json` | machine output (`tree`) |
| `--quiet` | short output |

The CLI's own messages are in Russian for now.

## What gets scanned

`downgrade-scan.js` walks the repository and classifies every `.js`/`.ts`
file **by its path alone** — there is no config file. The naming rules are in
[CODE_STRUCTURE.md](CODE_STRUCTURE.md); their consequences for the build:

| path | treated as |
|---|---|
| a `.js`/`.cjs` in the **root** | tooling — skipped |
| `.git/`, `node_modules/`, `.t9n/`, `.forgejo/` | skipped |
| `<standard>@<modules>/` | an artifact folder — not a source |
| `*-polyfil.js` | a runtime fragment for injection — not a source |
| `*-helper.js` | **helper**: inlined into consumers, no artifacts |
| `algorithm/*.js` | **algorithm**: has artifacts and is imported by others |
| an empty file | `empty` — skipped |
| a file with only comments, or text that does not tokenize | `note` — no targets |
| anything else | **snippet** |

**Which artifacts a snippet gets is decided only by `*_NOTICE.md` files** —
see [Notices](#notices). A snippet with no NOTICE above it gets none.

The folder markers still matter for lint: code using `node:*` or node-only
globals outside `@.nodejs/` (`@.bun/`, `@.deno/`) is warned about, because es
targets of it come out `unsupported`. `.@<paradigm>/` folders change nothing.

The target names and profiles are in [downgrade-targets.js](downgrade-targets.js)
and [downgrade-profiles.js](downgrade-profiles.js).

## What `lint` enforces

* sources are ESM only (no `module.exports` / `require`);
* imports are relative or `node:*`; bare, URL, `npm:` and `jsr:` imports are
  errors (a single file could not be built from them);
* `node:*` imports and node-only globals outside `@.<runtime>/` are warnings:
  the es targets will be marked `unsupported`;
* `algorithm/*` imports only `algorithm/*` and starts with a header comment;
* artifact folders contain only stamped, generated files;
* every `*_NOTICE.md` whose name uses only artifact words is well-formed
  (order, combinations, existing profiles); a `FILES` entry that does not
  resolve is a warning; a NOTICE with foreign words is reported as "not an artifact NOTICE";
* a source with no `export` is a warning.

## How a target is built

For every (source × target) pair:

1. **Link** — follow relative imports and inline helpers and `algorithm/`
   files into one module ([downgrade-link.js](downgrade-link.js)).
2. **Parse** — an own parser with scope analysis
   ([downgrade-parse.js](downgrade-parse.js), [downgrade-scope.js](downgrade-scope.js)).
3. **Lower syntax** — one pass per language feature
   ([downgrade-passes.js](downgrade-passes.js), `downgrade-pass-*.js`). Passes
   rewrite *text in node ranges* rather than reprinting the file, so everything
   they do not touch — comments included — is kept byte for byte.
4. **Lower built-ins** — [downgrade-runtime.js](downgrade-runtime.js) finds
   built-ins the target lacks (`Object.hasOwn`, `.at`, `Promise.any`, …) using
   [downgrade-runtime-features.json](downgrade-runtime-features.json), and
   injects:
   * **helpers** from [downgrade-runtime-helpers.js](downgrade-runtime-helpers.js)
     (`__dg_*` functions the lowered code calls), and
   * **polyfils** — the `*-polyfil.js` files in the topic folders
     (`promise/promise-any-polyfil.js`, `array/array-at-polyfil.js`, …). A feature's
     `shim` is a short id; the `$polyfils` table maps it to the file
     (`"promise-any": "promise/promise-any-polyfil"`). Polyfils are ES5 and guarded: they install a method only if
     it is missing.
   * Larger replacements that are real modules (`symbol/symbol-shim.js`,
     `weakmap/weakmap-shim.js`, `arraybuffer/typedarray-shim.js`) are snippets
     themselves and are pulled in inline, preferring the native built-in.
5. **Module format** — ESM → CJS for `@cjs` targets.
6. **Minify** — [downgrade-minify.js](downgrade-minify.js) and
   [downgrade-mangle.js](downgrade-mangle.js) for the `.min` twin.
7. **Stamp** — [downgrade-stamp.js](downgrade-stamp.js) writes a header with
   the tree hash and every file of the tree with its codeHash.

A target that cannot be built is not an error: it becomes a report line,
`unsupported` (impossible: `BigInt` below ES2020, lookbehind, `Proxy`, …) or
`pending` (the lowering pass is not written yet).

### Hashes and rebuilds

* **codeHash** — sha256 of a file's text *without comments and redundant
  whitespace*: editing a comment does not make artifacts stale.
* **treeHash** — sha256 over "path codeHash" of every file in the import tree,
  plus the target and the tool version.

The stamp at the top of each artifact *is* the manifest: `emit` recomputes the
treeHash and skips the pair when it matches. There is no cache or lock file.
Generation is deterministic — two runs give identical bytes.

The tool version is the `VERSION` constant in [downgrade.js](downgrade.js) and
is part of every treeHash. **Bump it when a change to the tooling changes its
output**, then run `npm run update` to rebuild everything.

## Configuration

There is deliberately little to configure — NOTICE file names and the layout
*are* the configuration.

| to… | do |
|---|---|
| give files artifacts | put a `*_NOTICE.md` in their folder or an ancestor |
| limit a NOTICE to some files | add a `## FILES` list to it |
| make code node-only | move it under `@.nodejs/` and use a `NODEJS…_SINGLEFILE_NOTICE.md` |
| share code without artifacts | name it `*-helper.js` |
| add a polyfil | write `<topic>/<name>-polyfil.js` in ES5 using the `__dg_*` helpers, add its id to `$polyfils` in `downgrade-runtime-features.json`, and set the feature's `shim` to that id |
| add a node profile | extend `NODE_PROFILES` in `downgrade-profiles.js` and in `downgrade-notice.js` |
| skip a folder | add it to `SKIP_DIRS` in `downgrade-scan.js` and `downgrade-notice.js` |

### Notices

**No NOTICE, no artifacts.** The NOTICE files of a folder apply to that folder
and to every subfolder that has no artifact NOTICE of its own (the nearest
folder wins entirely, nothing is inherited past it). Several NOTICE files in
one folder combine. Parsing: [downgrade-notice.js](downgrade-notice.js).

The file name is the configuration:

```
[<engine>_][<format>[_<subformat>…]_][<dialect>[_<modules>]_]NOTICE.md
```

| part | words | default |
|---|---|---|
| engine | `NODEJS`, `ELECTRON`, `BROWSER`, `CHROMIUM`, `QUANTUM`, `BUN`, `DENO`, optionally with a major version (`NODEJS5`) | none: plain ECMAScript |
| format | `SINGLEFILE` | **required** — a NOTICE without a format is a lint error |
| subformat (obfuscator, one only) | `PLAIN`, `MINIFY`, `SIMPLE`, `COMPLEX`, `COMPLICATED` (SIMPLE and COMPLEX mixed), `TRICKY` | `PLAIN` |
| dialect | `ECMASCRIPT<ver>`, `TYPES<ver>` (`.d.ts` next to the code), `TYPESCRIPT<ver>` (code re-emitted as `.ts`), `COFFEESCRIPT` | `ECMASCRIPT` = ES2025 (`es16`), i.e. no downgrade |
| modules | `MJS` (ES modules), `CJS` (CommonJS) | `MJS` where the level has modules (ES2015+, node 13+), else `CJS` |

The parts may come in any order. The format is required; every other part may
be omitted: `ECMASCRIPT6_SINGLEFILE_NOTICE.md` reads as
`ECMASCRIPT6_SINGLEFILE_PLAIN_MJS_NOTICE.md`, and `SINGLEFILE_NOTICE.md` means
`es16@mjs`, plain. `ECMASCRIPT` without a version means no downgrade at all —
only bundling into one file.

The repository default is the root [ECMASCRIPT6_SINGLEFILE_NOTICE.md](ECMASCRIPT6_SINGLEFILE_NOTICE.md):
one `es6@mjs/<name>.js` per snippet. Code using node/bun APIs is attempted as well
(built-ins get polyfilled; `node:*` imports end up `unsupported`). How a name maps onto a target folder:

| NOTICE | builds |
|---|---|
| `ECMASCRIPT3_SINGLEFILE_NOTICE.md` | `es3@cjs/<name>.js` |
| `SINGLEFILE_MINIFY_ECMASCRIPT5_NOTICE.md` | `es5@cjs/<name>.min.js` |
| `ECMASCRIPT6_SINGLEFILE_CJS_NOTICE.md` | `es6@cjs/<name>.js` |
| `NODEJS18_SINGLEFILE_NOTICE.md` | `nodejs18@mjs/<name>.js` |
| `SINGLEFILE_TYPESCRIPT6_NOTICE.md` | `es6@ts/<name>.ts` |
| `DENO_SINGLEFILE_TRICKY_TYPES_MJS_NOTICE.md` | pending (see below) |

`PLAIN` writes `<name>.js`, `MINIFY` writes `<name>.min.js`; for both, use two
NOTICE files. With an engine, the language level comes from the engine, so
`NODEJS` takes no `ECMASCRIPT<ver>` version; node majors with a profile are 5,
13, 18 and 21 (`NODEJS` alone = 21).

What is valid but not built yet becomes a `pending` line in reports (`--why`,
`tree`) instead of an error: engines other than `NODEJS`, obfuscator modes other
than `PLAIN`/`MINIFY`, `TYPES` and `COFFEESCRIPT`. Combinations that can never
work (no `SINGLEFILE`, `ECMASCRIPT5_MJS`, `NODEJS7`, two obfuscator modes, two dialects) are lint
errors.

#### The FILES list

A NOTICE may name the files it covers. The tool takes the **first heading
called `files`** (any level `#`…`######`, any case), skips any text between it
and the first list, and reads that list until Markdown ends it (a blank line
followed by unindented text, or the next heading). Items may wrap; indented or
lazy continuation lines belong to the item.

From each item it takes the path: the first `code span`, else the first
`"quoted"`, `'quoted'` or `«quoted»` text, else the first word. Paths are
relative to the NOTICE's folder (then to the repository root); a folder covers
everything below it. Entries that resolve to nothing are ignored with a lint
warning.

```markdown
## Files

Only the codecs; the helpers come along by themselves.

- `png-format.js`
- [`../algorithm/crc32.js`](../algorithm/crc32.js) — also published alone
```

Without a FILES heading the NOTICE covers every source under its folder.

NOTICE files whose names contain other words are not artifact NOTICEs; lint
reports them and the build ignores them.

## CI

[.forgejo/workflows/artifacts.yml](.forgejo/workflows/artifacts.yml) runs on
Forgejo Actions (Codeberg). The repository uses **sha256** git objects, so
nothing may assume 40-character hashes.

| job | when | what |
|---|---|---|
| `check` | every push and PR | `npm run lint`; `npm run emit -- --check --report=build.md --why`; the report goes to the job summary and is uploaded |
| `smoke` | after `check` | for each node version (4, 5, 6, 13, 18, 21, 24) loads the artifacts of the targets that version must support, using that very node |
| `commit` | push to `main` only | `npm run update -- --prune`, then commits changed `es*@*` / `nodejs*@*` folders as `artifacts-bot` with `[skip ci]` |

On a PR artifacts are not committed: the author runs `npm run update` and
commits them; otherwise `--check` fails. The `commit` job needs the
`ARTIFACTS_TOKEN` secret with push rights.

Smoke uses two files: [downgrade-smoke.js](downgrade-smoke.js) (an ES module,
runs on the container's node) lists the files to load, and
[downgrade-smoke-load.cjs](downgrade-smoke-load.cjs) (ES5, so it starts even on
node 4) `require`s or `import`s each one. Locally:

```bash
node downgrade-smoke.js --targets=es5@cjs,es16@mjs
```

## Files

| file | role |
|---|---|
| `downgrade.js` | CLI: `tree`, `lint`, `emit`, `update`, `minify`, `hash` |
| `downgrade-args.js` | argument parsing, path selection |
| `downgrade-scan.js` | repository walk, classification by path |
| `downgrade-notice.js` | `*_NOTICE.md` names and FILES lists → targets per source |
| `downgrade-targets.js`, `downgrade-profiles.js` | target names, what each target supports |
| `downgrade-graph.js`, `downgrade-link.js` | import graph, single-file linker |
| `downgrade-tokenize.js`, `downgrade-parse.js`, `downgrade-walk.js`, `downgrade-scope.js` | tokenizer, parser, AST walk, scopes |
| `downgrade-typescript.js` | type stripping / keeping for `.@typescript` |
| `downgrade-features.js` | which language features a file uses |
| `downgrade-lower.js`, `downgrade-rewrite.js`, `downgrade-passes.js`, `downgrade-pass-*.js` | syntax lowering |
| `downgrade-regexp.js`, `downgrade-unicode-props.json`, `downgrade-gen-unicode.js` | RegExp lowering and its Unicode tables |
| `downgrade-runtime.js`, `downgrade-runtime-helpers.js`, `downgrade-runtime-features.json` | built-in detection, helpers, polyfil table |
| `downgrade-minify.js`, `downgrade-mangle.js` | minifier, name mangling |
| `downgrade-hash.js`, `downgrade-stamp.js` | codeHash / treeHash, artifact header |
| `downgrade-emit.js`, `downgrade-report.js`, `downgrade-source.js` | writing artifacts, reports, source loading |
| `downgrade-smoke.js`, `downgrade-smoke-load.cjs` | load tests on old engines |
| `*/*-polyfil.js` | polyfils, in their topic folders |

The tool's design notes and history are in [BACKLOG.md](BACKLOG.md) §6 (in
Russian); paths there still refer to the former `.devdeps/downgrade/` layout.
