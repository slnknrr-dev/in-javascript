/* ══════════════════════════════════════════════════════════════════════════
   args.js — разбор командной строки и выбор файлов по путям

   Форма обычная для такого рода инструментов:

     downgrade <команда> [пути…] [флаги]

   Пути — файлы или папки; без них команда работает по всему репозиторию.
   Это заменяет набор отдельных скриптов на каждый режим: `emit --check`
   вместо `emit:check`, `tree png.@image/` вместо отдельной команды на
   папку.

   Пути сопоставляются с результатом scan(), а не с файловой системой
   напрямую: так `downgrade tree image/` не наткнётся на папку артефактов
   и не примет за исходник заметку в .js.
   ══════════════════════════════════════════════════════════════════════════ */

import { relative, resolve, sep } from 'node:path';
import { toPosix } from './downgrade-scan.js';

/* argv → { command, paths, flags } */
export function parseArgs(argv) {
  const paths = [], flags = new Map();
  let command = null;

  for (const a of argv) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) flags.set(a.slice(2, eq), a.slice(eq + 1));
      else flags.set(a.slice(2), true);
    } else if (a.startsWith('-') && a.length > 1) {
      for (const c of a.slice(1)) flags.set(c, true);
    } else if (command === null) {
      command = a;
    } else {
      paths.push(a);
    }
  }

  return { command, paths, flags };
}

/* Строки из scan(), попадающие под указанные пути.

   Путь-папка отбирает всё под ней, путь-файл — ровно его. Пустой список
   путей означает весь репозиторий. Пути, не давшие ни одного файла,
   возвращаются отдельно: молча собрать не то, что просили, — хуже, чем
   сказать «не нашёл». */
export function selectFiles(rows, paths, root = process.cwd()) {
  if (!paths.length) return { files: rows, unmatched: [] };

  const files = new Set();
  const unmatched = [];

  for (const p of paths) {
    const rel = toPosix(relative(root, resolve(root, p))).replace(/\/+$/, '');
    if (rel.startsWith('..')) { unmatched.push(p + ' — вне репозитория'); continue; }

    const hit = rows.filter(r => r.rel === rel || r.rel.startsWith(rel + '/'));
    if (!hit.length) unmatched.push(p);
    for (const r of hit) files.add(r);
  }

  return { files: rows.filter(r => files.has(r)), unmatched };
}

export { sep };
