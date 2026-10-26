/* ══════════════════════════════════════════════════════════════════════════
   hash.js — хеш-суммы файла и дерева

   Три величины:

     rawHash(file)    sha256 байтов файла. Меняется от правки комментария.
                      Нигде в решении о пересборке не участвует — только
                      для отладки.

     codeHash(file)   sha256 нормализованного текста (minify.js): без
                      комментариев, с выброшенными лишними пробелами.
                      Переписал комментарий, переставил отступы, добавил
                      пустую строку — codeHash тот же.

     treeHash(entry)  sha256 по списку «путь codeHash» всех файлов дерева
                      импортов, плюс идентификатор цели и версия формата.
                      Это и есть число, которое стоит в шапке артефакта.

   Решение о пересборке: посчитать treeHash → сравнить с тем, что записан
   в существующем артефакте → совпало, значит артефакт актуален и не
   трогается. Отсюда требование к генератору быть детерминированным:
   иначе «не изменилось» не отличить от «изменилось незаметно».

   Хеш берётся sha256 не случайно: репозиторий живёт на sha256-объектах,
   и второй алгоритм рядом был бы лишней сущностью.
   ══════════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { normalize } from './downgrade-minify.js';
import { treeOf } from './downgrade-graph.js';

/* Версия схемы хеширования. Меняется, когда меняется нормализация или
   формат штампа: иначе старые артефакты будут считаться актуальными. */
export const HASH_FORMAT = 'dg1';

const sha256 = s => createHash('sha256').update(s, 'utf8').digest('hex');

export const rawHash = (rel, root = process.cwd()) =>
  createHash('sha256').update(readFileSync(resolve(root, rel))).digest('hex');

export function codeHash(rel, root = process.cwd()) {
  return sha256(normalize(readFileSync(resolve(root, rel), 'utf8')));
}

/* Хеш дерева для конкретной цели.

   Тело — построчный список «<путь> <codeHash>» в порядке обхода дерева,
   с заголовком из версии схемы, версии инструмента и имени цели. Список
   кладётся в штамп артефакта целиком, поэтому по артефакту всегда видно,
   из чего он собран, а не только «что-то поменялось». */
/* extra — файлы, попавшие в артефакт помимо дерева импортов: сниппеты-
   полифилы, которые втянуло понижение (BACKLOG.md §6.7g). Правка такого
   файла обязана пересобирать артефакт, значит он входит в хеш. */
export function treeHash(entryRel, target, { root = process.cwd(), toolVersion = '0', extra = [], keepTypes = false } = {}) {
  const { files, builtins, problems } = treeOf(entryRel, root, { keepTypes });
  for (const rel of extra)
    for (const f of treeOf(rel, root, { keepTypes }).files) if (!files.includes(f)) files.push(f);
  const entries = files.map(f => ({ file: f, hash: codeHash(f, root) }));

  const body = [
    `${HASH_FORMAT} tool=${toolVersion} target=${target}`,
    ...entries.map(e => `${e.file} ${e.hash}`),
    ...builtins.map(b => `builtin ${b}`),
  ].join('\n');

  return { hash: sha256(body), entries, builtins, problems, body };
}
