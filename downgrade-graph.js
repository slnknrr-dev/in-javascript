/* ══════════════════════════════════════════════════════════════════════════
   graph.js — дерево файлов через import/export

   Дерево строится ровно так, как его потом будет обходить линкер: от
   исходника по относительным импортам и ре-экспортам, вглубь, до
   неподвижной точки. Всё, что в это дерево попало, участвует в сборке
   артефакта — значит участвует и в его хеш-сумме (см. hash.js).

   Спецификаторы берутся из потока токенов, а не регулярками по тексту:
   строка './x.js' внутри комментария или шаблона импортом не является.

   Что считается допустимым импортом (BACKLOG.md §2, инвариант 3):
     · относительный  './…', '../…'   — helper'ы и algorithm/
     · встроенный     'node:…'        — только в движковом коде
   Bare-, URL-, npm:- и jsr:-импорты помечаются как нерезолвимые: singlefile
   из них не собрать.
   ══════════════════════════════════════════════════════════════════════════ */

import { readFileSync, existsSync } from 'node:fs';
import { readSource } from './downgrade-source.js';
import { dirname, resolve, relative, posix } from 'node:path';
import { tokenize } from './downgrade-tokenize.js';
import { toPosix } from './downgrade-scan.js';

/* Спецификаторы модулей, на которые ссылается файл. */
export function specifiers(src) {
  const t = tokenize(src);
  const out = [];
  const str = tok => tok.v.slice(1, -1);

  for (let i = 0; i < t.length; i++) {
    const tok = t[i];

    /* import … from '…' | export … from '…' */
    if (tok.t === 'name' && (tok.v === 'import' || tok.v === 'export')) {
      /* import('…') — динамический */
      if (tok.v === 'import' && t[i + 1]?.v === '(' && t[i + 2]?.t === 'str') {
        out.push({ spec: str(t[i + 2]), dynamic: true });
        continue;
      }
      /* import '…' — только ради побочного эффекта */
      if (tok.v === 'import' && t[i + 1]?.t === 'str') {
        out.push({ spec: str(t[i + 1]), dynamic: false });
        continue;
      }
      /* ищем from '…' до конца оператора */
      for (let j = i + 1; j < t.length; j++) {
        if (t[j].t === 'punct' && t[j].v === ';') break;
        if (t[j].t === 'name' && (t[j].v === 'import' || t[j].v === 'export') && j > i + 1) break;
        if (t[j].t === 'name' && t[j].v === 'from' && t[j + 1]?.t === 'str') {
          out.push({ spec: str(t[j + 1]), dynamic: false });
          i = j + 1;
          break;
        }
      }
    }
  }
  return out;
}

export function classifySpec(spec) {
  if (spec.startsWith('./') || spec.startsWith('../')) return 'relative';
  if (spec.startsWith('node:')) return 'builtin';
  if (spec.startsWith('npm:') || spec.startsWith('jsr:')) return 'registry';
  if (/^[a-z][a-z0-9+.-]*:/i.test(spec)) return 'url';
  return 'bare';
}

/* Транзитивное замыкание импортов от entry.

   Возвращает:
     files     — rel-пути в порядке обхода, entry первым
     builtins  — встроенные модули node, встреченные по дороге
     problems  — [{ from, spec, why }] — то, из чего singlefile не собрать */
/* keepTypes — дерево для `@ts`-цели: там типовые импорты остаются в
   тексте, и файл, откуда берётся тип, тоже часть дерева. */
export function treeOf(entryRel, root = process.cwd(), { keepTypes = false } = {}) {
  const files = [];
  const builtins = new Set();
  const problems = [];
  const seen = new Set();

  (function visit(rel) {
    if (seen.has(rel)) return;
    seen.add(rel);
    files.push(rel);

    const abs = resolve(root, rel);
    let src;
    try { src = readSource(abs, { keepTypes }); }
    catch { problems.push({ from: rel, spec: rel, why: 'файл не читается' }); return; }

    let specs;
    try { specs = specifiers(src); }
    catch (e) { problems.push({ from: rel, spec: '', why: 'не разбирается: ' + e.message }); return; }

    for (const { spec, dynamic } of specs) {
      const kind = classifySpec(spec);

      if (kind === 'builtin') { builtins.add(spec); continue; }
      if (kind !== 'relative') {
        problems.push({ from: rel, spec, why: `${kind}-импорт: артефакт не будет singlefile` });
        continue;
      }
      if (dynamic) {
        problems.push({ from: rel, spec, why: 'динамический import(): инлайн невозможен' });
        continue;
      }

      const childAbs = resolve(dirname(abs), spec);
      if (!existsSync(childAbs)) {
        problems.push({ from: rel, spec, why: 'файл не найден' });
        continue;
      }
      visit(posix.normalize(toPosix(relative(root, childAbs))));
    }
  })(entryRel);

  return { files, builtins: [...builtins].sort(), problems };
}
