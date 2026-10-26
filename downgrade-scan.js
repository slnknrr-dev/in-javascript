/* ══════════════════════════════════════════════════════════════════════════
   scan.js — обход репозитория и классификация файлов

   Ничего не читает из конфигов: чем является файл, видно из его пути.
   Правила имён — в CODE_STRUCTURE.md, следствия для сборки — в BACKLOG.md §3.

     kind     snippet | helper | algorithm | empty | note
     matrix   es | nodejs          — какая матрица целей применяется
     dialect  null | typescript | coffeescript
     engine   null | nodejs | bun | deno

   helper (*-helper.js) своих артефактов не имеет: он существует, чтобы
   быть заинлайненным 1-в-1 в потребителей. algorithm/* — наоборот,
   полноценный сниппет со своими артефактами, который вдобавок импортируют.
   ══════════════════════════════════════════════════════════════════════════ */

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { TARGET_RE } from './downgrade-targets.js';
import { tokenize } from './downgrade-tokenize.js';

/* не наши деревья */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.t9n', '.forgejo']);

/* .@<name> is a dialect or a paradigm; only dialects change the target matrix */
const DIALECTS = new Set(['typescript', 'coffeescript']);

/* *-polyfil.js are runtime fragments injected by downgrade-runtime.js, not modules */
const isPolyfil = name => name.endsWith('-polyfil.js');

const toPosix = p => p.split('\\').join('/');

function classify(rel) {
  const parts = rel.split('/');
  const name = parts[parts.length - 1];
  const dirs = parts.slice(0, -1);

  let dialect = null, engine = null;
  for (const d of dirs) {
    /* .@<dialect|paradigm>/ and @.<runtime>/ (CODE_STRUCTURE.md) */
    if (d.startsWith('.@') && DIALECTS.has(d.slice(2))) dialect = d.slice(2);
    else if (d.startsWith('@.')) engine = d.slice(2);
  }

  const matrix = engine ? 'nodejs' : 'es';       // bun/deno транслируются в node
  const isHelper = /-helper\.(js|ts)$/.test(name);
  const isAlgorithm = dirs[0] === 'algorithm';

  return {
    rel, name, dialect, engine, matrix,
    kind: isHelper ? 'helper' : isAlgorithm ? 'algorithm' : 'snippet',
  };
}

/* Все исходники репозитория. Папки артефактов и служебные деревья
   пропускаются. */
export function scan(root = process.cwd()) {
  const found = [];

  (function walk(dir, rel) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const childRel = rel ? posix.join(rel, e.name) : e.name;

      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (TARGET_RE.test(e.name)) continue;           // это папка артефактов
        walk(join(dir, e.name), childRel);
        continue;
      }
      if (!/\.(js|ts|mjs|cjs)$/.test(e.name)) continue;

      if (!rel) continue;                               // root-level js is tooling (downgrade*.js)
      if (isPolyfil(e.name)) continue;

      const size = statSync(join(dir, e.name)).size;
      const info = classify(childRel);
      if (size === 0) info.kind = 'empty';
      else {
        /* Заметка, а не сниппет: в файле нет ни одного токена кода — только
           комментарии (план на будущее) — или он вовсе не токенизируется
           (текст в .js). Понижать там нечего, а артефакт вышел бы штампом
           без кода, поэтому целей у таких файлов нет. */
        const src = readFileSync(join(dir, e.name), 'utf8');
        try { if (tokenize(src).length === 0) info.kind = 'note'; }
        catch { info.kind = 'note'; }
      }
      info.size = size;
      found.push(info);
    }
  })(root, '');

  return found;
}

/* Существующие папки артефактов: [{ dir, target, files }] */
export function scanArtifactDirs(root = process.cwd()) {
  const out = [];

  (function walk(dir, rel) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (SKIP_DIRS.has(e.name)) continue;
      const childRel = rel ? posix.join(rel, e.name) : e.name;
      if (TARGET_RE.test(e.name)) {
        out.push({
          dir: childRel,
          target: e.name,
          files: readdirSync(join(dir, e.name)).sort(),
        });
        continue;
      }
      walk(join(dir, e.name), childRel);
    }
  })(root, '');

  return out;
}

export { toPosix };
