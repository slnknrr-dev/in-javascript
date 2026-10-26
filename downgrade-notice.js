/* ══════════════════════════════════════════════════════════════════════════
   downgrade-notice.js — *_NOTICE.md decide which artifacts exist

   No NOTICE, no artifacts. A folder's NOTICE files apply to the folder and
   every subfolder that has no artifact NOTICE of its own; several NOTICE
   files in one folder combine. The name is the configuration:

     [<engine>_][<format>[_<subformat>…]_][<dialect>[_<modules>]_]NOTICE.md
     (any order of the parts is accepted)

     engine    NODEJS ELECTRON BROWSER CHROMIUM QUANTUM BUN DENO, + optional
               major version (NODEJS5)
     format    SINGLEFILE (required), subformat = obfuscator mode (one of):
               PLAIN (default) MINIFY SIMPLE COMPLEX COMPLICATED TRICKY
     dialect   ECMASCRIPT<ver> (default) TYPES<ver> (.d.ts)
               TYPESCRIPT<ver> (.ts output) COFFEESCRIPT
     modules   MJS CJS

   The body may hold a `FILES` heading (any level, any case, the first one
   wins) followed by a Markdown list: then the NOTICE covers only those
   files/folders, paths relative to the NOTICE's folder. Text between the
   heading and the list is ignored; the list ends where Markdown ends it.

   What the tool cannot build yet (engines other than node, obfuscators
   other than PLAIN/MINIFY, TYPES, COFFEESCRIPT) becomes a `pending` job,
   so the NOTICE is valid today and starts producing files once supported.
   ══════════════════════════════════════════════════════════════════════════ */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { TARGET_RE } from './downgrade-targets.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.t9n', '.forgejo']);

const ENGINES = ['NODEJS', 'ELECTRON', 'BROWSER', 'CHROMIUM', 'QUANTUM', 'BUN', 'DENO'];
const MODES = ['PLAIN', 'MINIFY', 'SIMPLE', 'COMPLEX', 'COMPLICATED', 'TRICKY'];
const DIALECTS = ['ECMASCRIPT', 'TYPESCRIPT', 'TYPES', 'COFFEESCRIPT'];
const MODULES = ['MJS', 'CJS'];

/* defaults when a part is omitted */
const ES_DEFAULT = 16;                 // ECMASCRIPT without a version = ES2025: no downgrade, only bundling
const NODE_DEFAULT = 21;
const NODE_PROFILES = [5, 13, 18, 21]; // downgrade-profiles.js

const RE_ENGINE = new RegExp(`^(${ENGINES.join('|')})(\\d+)?$`);
const RE_DIALECT = new RegExp(`^(${DIALECTS.join('|')})(\\d+)?$`);

/* ── the name ─────────────────────────────────────────────────────────── */

/* 'DENO_SINGLEFILE_TRICKY_TYPES_MJS_NOTICE.md' →
     { engine, version, format, mode, dialect, es, modules }
   null — not an artifact NOTICE (foreign words: VANILLA_NOTICE.md);
   { error } — artifact words in an impossible combination. */
export function parseNoticeName(name) {
  const m = /^(?:(.*)_)?NOTICE\.md$/.exec(name);
  if (!m) return null;
  const words = m[1] ? m[1].split('_') : [];
  const known = w => RE_ENGINE.test(w) || w === 'SINGLEFILE' || MODES.includes(w) || RE_DIALECT.test(w) || MODULES.includes(w);
  if (!words.every(known)) return null;

  const spec = { engine: null, version: null, format: null, mode: 'PLAIN', dialect: 'ECMASCRIPT', es: null, modules: null };
  const fail = why => ({ error: `${name}: ${why}` });
  /* the canonical order is engine, format, dialect, modules, but any order
     is read: ECMASCRIPT6_SINGLEFILE = ECMASCRIPT6_SINGLEFILE_PLAIN_MJS.
     Each part may appear once; the format (SINGLEFILE) is required. */
  const seen = new Set();
  const once = part => { if (seen.has(part)) return false; seen.add(part); return true; };
  for (const w of words) {
    let e, d;
    if ((e = RE_ENGINE.exec(w))) {
      if (!once('engine')) return fail(`more than one engine (${w})`);
      spec.engine = e[1];
      spec.version = e[2] ? Number(e[2]) : null;
    } else if (w === 'SINGLEFILE') {
      if (!once('format')) return fail('SINGLEFILE twice');
      spec.format = 'SINGLEFILE';
    } else if (MODES.includes(w)) {
      if (!once('mode')) return fail(`obfuscator modes do not combine (${spec.mode}, ${w})`);
      spec.mode = w;
    } else if ((d = RE_DIALECT.exec(w))) {
      if (!once('dialect')) return fail(`more than one dialect (${w})`);
      if (d[2] && d[1] === 'COFFEESCRIPT') return fail('COFFEESCRIPT takes no version');
      spec.dialect = d[1];
      spec.es = d[2] ? Number(d[2]) : null;
    } else {
      if (!once('modules')) return fail(`MJS and CJS do not combine`);
      spec.modules = w;
    }
  }
  if (!spec.format) return fail('the format is required (SINGLEFILE)');
  return spec;
}

/* spec → [{ target, variant } | { pending, label }]
   variant: 'plain' → <name>.js, 'min' → <name>.min.js */
export function jobsOf(spec) {
  const pending = why => [{ pending: why, label: label(spec) }];
  const variant = { PLAIN: 'plain', MINIFY: 'min' }[spec.mode];

  if (spec.engine && spec.engine !== 'NODEJS') return pending(`engine ${spec.engine} is not supported yet`);
  if (spec.dialect === 'COFFEESCRIPT') return pending('COFFEESCRIPT output is not supported yet');
  if (spec.dialect === 'TYPES') return pending('.d.ts generation (TYPES) is not supported yet');
  if (!variant) return pending(`obfuscator ${spec.mode} is not implemented yet`);

  let profile;
  if (spec.engine === 'NODEJS') {
    const v = spec.version ?? NODE_DEFAULT;
    if (!NODE_PROFILES.includes(v)) return [{ error: `NODEJS${v}: no node profile (have ${NODE_PROFILES.join(', ')})` }];
    if (spec.es !== null) return [{ error: `NODEJS fixes the language level itself, drop the version of ${spec.dialect}` }];
    profile = { name: 'nodejs' + v, esm: v >= 13 };
  } else {
    const v = spec.es ?? ES_DEFAULT;
    if (v < 3 || v === 4) return [{ error: `ECMASCRIPT${v}: no such edition (3, 5, 6 … ${ES_DEFAULT})` }];
    profile = { name: 'es' + v, esm: v >= 6 };
  }

  let mod;
  if (spec.dialect === 'TYPESCRIPT') {
    if (spec.modules === 'CJS') return [{ error: 'TYPESCRIPT output is always ESM, CJS does not apply' }];
    mod = 'ts';
  } else if (spec.modules === 'MJS') {
    if (!profile.esm) return [{ error: `${profile.name} has no ES modules, use CJS` }];
    mod = 'mjs';
  } else if (spec.modules === 'CJS') {
    mod = 'cjs';
  } else {
    mod = profile.esm ? 'mjs' : 'cjs';
  }
  const target = `${profile.name}@${mod}`;
  if (!TARGET_RE.test(target)) return [{ error: `${target}: not a known target` }];
  return [{ target, variant }];
}

const label = s => [s.engine && s.engine + (s.version ?? ''), s.mode, s.dialect + (s.es ?? ''), s.modules].filter(Boolean).join('_');

/* ── the FILES list ───────────────────────────────────────────────────── */

const ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;

/* Markdown → [entry] for the first `FILES` heading, or null when there is
   none. An entry is the item's path: the first `code span`, else the first
   "quoted" or 'quoted' text, else the item's first word. */
export function parseFilesList(md) {
  const lines = md.split(/\r?\n/);
  const at = lines.findIndex(l => /^\s{0,3}#{1,6}\s+files\s*#*\s*$/i.test(l));
  if (at < 0) return null;

  let i = at + 1;
  while (i < lines.length && !ITEM.test(lines[i])) {
    if (/^\s{0,3}#{1,6}\s/.test(lines[i])) return [];   // next section, no list
    i++;
  }

  const items = [];
  let cur = null, blank = false;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const it = ITEM.exec(line);
    if (it) { cur = it[2]; items.push(cur); blank = false; continue; }
    if (!line.trim()) { blank = true; continue; }
    if (/^\s{0,3}#{1,6}\s/.test(line)) break;
    /* a continuation: indented, or lazy (no blank line before it) */
    if (/^\s+/.test(line) || !blank) { items[items.length - 1] = cur += ' ' + line.trim(); blank = false; continue; }
    break;                                                // the list is over
  }
  return items.map(entryOf).filter(Boolean);
}

function entryOf(text) {
  const code = /`([^`]+)`/.exec(text);
  if (code) return code[1].trim();
  const quoted = /"([^"]+)"|'([^']+)'|«([^»]+)»/.exec(text);
  if (quoted) return (quoted[1] ?? quoted[2] ?? quoted[3]).trim();
  const word = /^\[?([^\s\]]+)/.exec(text.trim());
  return word ? word[1].replace(/[,;:.]$/, '') : null;
}

/* ── the repository ───────────────────────────────────────────────────── */

/* Every *_NOTICE.md: [{ dir, name, rel, spec?, error?, files? }]. */
export function scanNotices(root = process.cwd()) {
  const out = [];
  (function walk(dir, rel) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || TARGET_RE.test(e.name)) continue;
        walk(join(dir, e.name), rel ? posix.join(rel, e.name) : e.name);
        continue;
      }
      if (!/NOTICE\.md$/.test(e.name)) continue;
      const spec = parseNoticeName(e.name);
      const n = { dir: rel, name: e.name, rel: rel ? posix.join(rel, e.name) : e.name };
      if (spec === null) n.foreign = true;
      else if (spec.error) n.error = n.rel + spec.error.slice(e.name.length);
      else {
        n.spec = spec;
        n.jobs = jobsOf(spec);
        n.files = parseFilesList(readFileSync(join(dir, e.name), 'utf8'));
      }
      out.push(n);
    }
  })(root, '');
  return out;
}

/* Resolves FILES entries of a NOTICE against its folder (or, failing that,
   the repository root): [{ entry, path, isDir } | { entry, missing: true }] */
export function resolveFiles(n, root = process.cwd()) {
  return (n.files ?? []).map(entry => {
    const clean = entry.replace(/^\.\//, '').replace(/\/+$/, '');
    for (const base of [n.dir, '']) {
      const rel = base ? posix.join(base, clean) : clean;
      try {
        const st = statSync(join(root, rel));
        return { entry, path: posix.normalize(rel), isDir: st.isDirectory() };
      } catch { /* try the next base */ }
    }
    return { entry, missing: true };
  });
}

/* The NOTICEs that govern a source: those of the nearest folder (the file's
   own or an ancestor) holding at least one artifact NOTICE. */
export function noticeIndex(root = process.cwd()) {
  const all = scanNotices(root);
  const byDir = new Map();
  for (const n of all) {
    if (!n.spec) continue;
    if (!byDir.has(n.dir)) byDir.set(n.dir, []);
    n.resolved = n.files ? resolveFiles(n, root) : null;
    byDir.get(n.dir).push(n);
  }

  const covers = (n, rel) => !n.resolved || n.resolved.some(r =>
    !r.missing && (r.path === rel || (r.isDir && (r.path === '' || rel.startsWith(r.path + '/')))));

  /* jobs for one source: { jobs: [{ target, variants: Set }], pending: [{ label, why, notice }], errors } */
  function jobsFor(rel) {
    let dir = posix.dirname(rel) === '.' ? '' : posix.dirname(rel);
    for (;;) {
      if (byDir.has(dir)) break;
      if (dir === '') return { jobs: [], pending: [], notices: [] };
      dir = posix.dirname(dir) === '.' ? '' : posix.dirname(dir);
    }
    const notices = byDir.get(dir).filter(n => covers(n, rel));
    const targets = new Map(), pending = [];
    for (const n of notices)
      for (const j of n.jobs) {
        if (j.pending) pending.push({ label: j.label, why: j.pending, notice: n.rel });
        else if (j.target) {
          if (!targets.has(j.target)) targets.set(j.target, new Set());
          targets.get(j.target).add(j.variant);
        }
      }
    return {
      jobs: [...targets].sort(([a], [b]) => (a < b ? -1 : 1)).map(([target, variants]) => ({ target, variants })),
      pending, notices: notices.map(n => n.rel),
    };
  }

  return { all, jobsFor };
}
