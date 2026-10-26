/* ══════════════════════════════════════════════════════════════════════════
   targets.js — матрица целей

   Цель — это <профиль>@<модули>: es5@cjs, nodejs18@cjs, es6@ts. Профиль
   задаёт уровень синтаксиса и таблицу доступных runtime-примитивов;
   модули — esm, cjs или ts (у ts система модулей решается tsconfig
   потребителя, поэтому в имени не указана).

   Какая матрица применяется к файлу, решает папка, а не содержимое:
   движковый код (@.nodejs, @.bun, @.deno) — nodejs-матрица, всё
   остальное — es. Диалект .@typescript добавляет к своей матрице
   ts-цели. Подробности — в BACKLOG.md §3.
   ══════════════════════════════════════════════════════════════════════════ */

export const ES_TARGETS = ['es3@cjs', 'es5@cjs', 'es6@mjs', 'es6@cjs', 'es16@cjs', 'es16@mjs'];
export const NODE_TARGETS = ['nodejs5@cjs', 'nodejs13@cjs', 'nodejs18@cjs', 'nodejs21@cjs', 'nodejs21@mjs'];

export const ES_TS_TARGETS = ['es3@ts', 'es5@ts', 'es6@ts', 'es16@ts'];
export const NODE_TS_TARGETS = ['nodejs5@ts', 'nodejs13@ts', 'nodejs18@ts', 'nodejs21@ts'];

/* канонический артефакт: исходник + инлайн, без понижения */
export const CANONICAL = { es: 'es16@mjs', nodejs: 'nodejs21@mjs' };

export const TARGET_RE = /^(es|nodejs)\d+@(cjs|mjs|ts)$/;

/* Цели для файла по его классификации (см. scan.js). */
export function targetsFor({ matrix, dialect }) {
  const base = matrix === 'nodejs' ? NODE_TARGETS : ES_TARGETS;
  if (dialect !== 'typescript') return base;
  return [...base, ...(matrix === 'nodejs' ? NODE_TS_TARGETS : ES_TS_TARGETS)];
}

/* Расширение артефакта цели. */
export const extFor = target => (target.endsWith('@ts') ? '.ts' : '.js');

/* Содержимое package.json, который кладётся в папку цели, чтобы node
   правильно понял модульную систему файлов внутри. */
export function targetPackageJson(target) {
  if (target.endsWith('@ts')) return null;
  const type = target.endsWith('@cjs') ? 'commonjs' : 'module';
  const m = /^nodejs(\d+)@/.exec(target);
  const pkg = { type };
  if (m) pkg.engines = { node: '>=' + m[1] };
  return JSON.stringify(pkg, null, 2) + '\n';
}
