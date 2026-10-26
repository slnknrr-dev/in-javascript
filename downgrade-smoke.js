/* ══════════════════════════════════════════════════════════════════════════
   smoke.mjs — «а грузятся ли артефакты на самом деле»

   Понижение проверяется исполнением в тестах, но там всё крутится на
   свежем node. Здесь — вторая половина проверки: артефакт берут и грузят
   тем движком, ради которого его понижали. Сам запуск делает
   downgrade-smoke-load.cjs (он на ES5, потому что должен стартовать и на node 4);
   этот файл только выбирает, что кому отдать.

     node downgrade-smoke.js                 всё по силам текущего node
     node downgrade-smoke.js --targets=es5@cjs,es3@cjs
     node downgrade-smoke.js --list           только перечислить пути

   Со старым node сам этот файл не запустится — он на ESM. В CI список
   готовит node из контейнера, а грузит файлы уже нужный движок:

     node …/smoke.mjs --targets=es5@cjs --list > files.txt
     <старый node> …/downgrade-smoke-load.cjs $(cat files.txt)

   Какой цели какой движок нужен — таблица ниже. Цель, которая новее
   текущего node, пропускается: на этом движке её и не ждали. В CI матрица
   заданий ставит нужный node и передаёт свой список целей (§7.2).
   ══════════════════════════════════════════════════════════════════════════ */

import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
const LOADER = resolve(dirname(fileURLToPath(import.meta.url)), 'downgrade-smoke-load.cjs');

/* минимальный node, на котором цель обязана грузиться */
const NEEDS = {
  'es3@cjs': 4, 'es5@cjs': 4, 'es6@cjs': 6, 'es6@mjs': 13, 'es16@cjs': 20, 'es16@mjs': 20,
  'nodejs5@cjs': 5, 'nodejs13@cjs': 13, 'nodejs18@cjs': 18, 'nodejs21@cjs': 21, 'nodejs21@mjs': 21,
};

const args = process.argv.slice(2);
const want = args.find(a => a.startsWith('--targets='))?.slice('--targets='.length).split(',');
const listOnly = args.includes('--list');
const here = Number(process.versions.node.split('.')[0]);

/* папки целей рядом с исходниками: png.@image/es5@cjs/… */
function artifacts(dir = ROOT, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const full = join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    if (NEEDS[name] !== undefined) {
      for (const file of readdirSync(full))
        if (file.endsWith('.js') || file.endsWith('.ts')) {
          if (file === 'package.json') continue;
          out.push({ target: name, file: join(full, file) });
        }
    } else artifacts(full, out);
  }
  return out;
}

const all = artifacts();
const targets = [...new Set(all.map(a => a.target))].sort();
const chosen = targets.filter(t => (want ? want.includes(t) : NEEDS[t] <= here));
const skipped = targets.filter(t => !chosen.includes(t));

/* при --list в stdout идут только пути: их читает xargs в CI */
const say = listOnly ? (...a) => console.error(...a) : (...a) => console.log(...a);
say(`node ${process.versions.node}; целей на диске: ${targets.length}, берём: ${chosen.join(' ') || '—'}`);
if (skipped.length) say(`не для этого движка: ${skipped.join(' ')}`);

const files = all.filter(a => chosen.includes(a.target)).map(a => a.file);
say(`файлов: ${files.length}`);
if (listOnly || !files.length) {
  if (listOnly) for (const f of files) console.log(f);
  process.exit(0);
}

/* Грузим пачками: командная строка не резиновая. Каждая пачка печатает
   свои жалобы сама, а в конце — одна сводка на весь прогон. */
let loaded = 0, skippedFiles = 0, failed = 0;
for (let i = 0; i < files.length; i += 40) {
  const r = spawnSync(process.execPath, [LOADER, '-q', ...files.slice(i, i + 40)],
    { encoding: 'utf8' });
  for (const line of (r.stdout ?? '').split('\n')) {
    const m = /^# (\d+) (\d+) (\d+)$/.exec(line);
    if (m) { loaded += +m[1]; skippedFiles += +m[2]; failed += +m[3]; }
    else if (line.trim()) console.log(line);
  }
  if (r.stderr) process.stderr.write(r.stderr);
}
console.log(`загрузилось: ${loaded}, пропущено: ${skippedFiles}, упало: ${failed}`);
process.exit(failed ? 1 : 0);
