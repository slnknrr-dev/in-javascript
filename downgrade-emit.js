/* ══════════════════════════════════════════════════════════════════════════
   emit.js — сборка артефактов на диск

   На каждую пару (исходник × цель) получается папка рядом с исходником и
   два файла в ней:

     png.@image/es16@mjs/png-format.js       читаемый, с комментариями
     png.@image/es16@mjs/png-format.min.js   минифицированный
     png.@image/es16@mjs/package.json        {"type":"module"}

   Перед записью считается treeHash и сравнивается с тем, что записан в
   шапке уже лежащего файла. Совпало — файл не трогается вообще: ни mtime,
   ни содержимое. Поэтому правка комментария в любом файле дерева не даёт
   ни одного изменённого артефакта, а CI не видит diff и не коммитит.

   Слинкованный код понижается до уровня цели (lower.js). Если цель
   чего-то не умеет и понизить это нельзя (unsupported) или проход ещё не
   написан (pending), артефакт не собирается: это не ошибка, а строка
   отчёта с причиной. Ошибка — только failed: исходник не разбирается,
   линкер отказался, проход выдал негодный текст.
   ══════════════════════════════════════════════════════════════════════════ */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, posix } from 'node:path';

import { link, LinkError } from './downgrade-link.js';
import { lower, LowerError } from './downgrade-lower.js';
import { profileOf } from './downgrade-profiles.js';
import { minify } from './downgrade-minify.js';
import { mangle } from './downgrade-mangle.js';
import { treeHash } from './downgrade-hash.js';
import { formatStamp, readStampHash, isStamped } from './downgrade-stamp.js';
import { extFor, targetPackageJson, TARGET_RE } from './downgrade-targets.js';
import { noticeIndex } from './downgrade-notice.js';
import { scan, scanArtifactDirs } from './downgrade-scan.js';

const moduleFormatOf = target => (target.endsWith('@cjs') ? 'cjs' : 'esm');

/* Состояние лежащего на диске артефакта относительно свежесобранного.

     missing   файла нет
     same      совпадает байт в байт
     stale     штамп указывает на другое дерево — код изменился, пересобрать
     tampered  штамп тот же, но КОД внутри не тот, что дают исходники,
               то есть файл правили руками
     drifted   штамп тот же, код тот же, отличаются только комментарии

   Последние два различаются нормализацией: minify выбрасывает комментарии,
   поэтому `minify(a) === minify(b)` означает «та же программа, другой текст
   вокруг». drifted — это прямое следствие правила «правка комментария не
   пересобирает артефакт»: комментарии внутри артефакта какое-то время
   отстают от исходника. Так и задумано, поэтому drifted не ошибка. */
function compare(current, fresh, treeHashValue) {
  if (current === null) return 'missing';
  if (current === fresh) return 'same';
  if (readStampHash(current) !== treeHashValue) return 'stale';
  try {
    return minify(current) === minify(fresh) ? 'drifted' : 'tampered';
  } catch {
    return 'tampered';                   // не разбирается — точно не наш вывод
  }
}

/* Что должно получиться для пары (исходник × цель) — без записи на диск.
   Бросает LinkError и ParseError (исходник не собирается), LowerError
   (цель не собирается — pending/unsupported) и Error (баг инструмента). */
export function render(rel, target, { root = process.cwd(), toolVersion = '0' } = {}) {
  /* `@ts`-цель: типы остаются в артефакте, понижается только код (§4.4) */
  const keepTypes = target.endsWith('@ts');
  const first = treeHash(rel, target, { root, toolVersion, keepTypes });
  if (first.problems.length)
    throw new LinkError(first.problems.map(p => `${p.from}: ${p.spec} — ${p.why}`).join('; '));
  const profile = profileOf(target);
  /* встроенный модуль node в es-цели не заинлайнишь и не зашимишь */
  if (first.builtins.length && profile.matrix === 'es')
    throw new LowerError('unsupported',
      `импорт ${first.builtins.join(', ')} есть только в node — движковому коду место в @.nodejs/`,
      { feature: 'nodeBuiltin' });
  const linked = link(rel, {
    root, keepTypes, moduleFormat: moduleFormatOf(target),
    nodePrefix: profile.matrix !== 'nodejs' || profile.node >= 16,
    esModuleMark: profile.es >= 5 ? 'define' : 'assign',
  });
  const low = lower(linked.code, profile, { root, ts: keepTypes });
  const code = low.code;

  /* сниппет-полифил, втянутый понижением, — часть дерева: его правка
     обязана пересобрать артефакт */
  const t = low.snippets.length
    ? treeHash(rel, target, { root, toolVersion, extra: low.snippets, keepTypes })
    : first;

  const lowered = [
    ...low.passes,
    ...(low.helpers.length || low.shims.length ? ['runtime: ' + [...low.helpers, ...low.shims].join(' ')] : []),
  ];
  /* Короткие имена — только в .min: из обычного текста считается codeHash,
     и он обязан меняться от переименования переменной (§6.5). У `@ts`-цели
     имён не трогаем: `typeof x` в типе ссылается на значение, а типы в
     области видимости не участвуют — переименование увело бы ссылку. */
  const short = keepTypes ? { code } : mangle(code);
  const stampArgs = { target, toolVersion, hash: t.hash, entries: t.entries, lowered };
  return {
    treeHash: t.hash,
    plain: formatStamp(stampArgs) + '\n' + code,
    min: formatStamp({ ...stampArgs, minified: true }) + '\n' + minify(short.code) + '\n',
    lowered: low,
  };
}

/* Пути артефактов пары (исходник × цель). */
export function pathsFor(rel, target) {
  const dir = posix.join(posix.dirname(rel), target);
  const base = posix.basename(rel).replace(/\.(js|ts|mjs|cjs)$/, '');
  const ext = extFor(target);
  return {
    dir,
    plain: posix.join(dir, base + ext),
    min: posix.join(dir, base + '.min' + ext),
    pkg: posix.join(dir, 'package.json'),
  };
}

/* Основная работа.

   mode: 'write' — писать на диск; 'check' — только сравнивать.
   Возвращает отчёт: что написано, что пропущено, что разошлось. */
export function emit(files, {
  root = process.cwd(), toolVersion = '0', targets = null,
  mode = 'write', force = false, prune = false, index = noticeIndex(root),
} = {}) {
  const report = {
    written: [], skipped: [], pending: [], unsupported: [], failed: [], mismatched: [], pruned: [],
    drifted: [], dead: [],
  };

  for (const f of files) {
    /* what to build comes from *_NOTICE.md (downgrade-notice.js) */
    const plan = index.jobsFor(f.rel);
    for (const pd of plan.pending)
      report.pending.push({ file: f.rel, target: pd.label, why: `${pd.why} (${pd.notice})` });
    const wanted = plan.jobs.filter(j => !targets || targets.includes(j.target));

    for (const { target, variants } of wanted) {
      const p = pathsFor(f.rel, target);
      /* PLAIN → <name>.js, MINIFY → <name>.min.js */
      const kinds = ['plain', 'min'].filter(k => variants.has(k));

      const onDisk = name => existsSync(resolve(root, name))
        ? readFileSync(resolve(root, name), 'utf8') : null;

      let out;
      try {
        out = render(f.rel, target, { root, toolVersion });
      } catch (e) {
        if (e instanceof LowerError) report[e.kind].push({ file: f.rel, target, why: e.message, feature: e.feature });
        else report.failed.push({
          file: f.rel, target,
          why: e instanceof LinkError ? e.message : `${e.name}: ${e.message}`,
        });
        /* Цель не собирается, а артефакт от прошлых сборок лежит — он уже
           не соответствует дереву. Это расхождение; удаляет его --prune. */
        const left = [p.plain, p.min].filter(x => onDisk(x) !== null);
        if (left.length) {
          report.mismatched.push({ file: f.rel, target, why: 'orphan', paths: left });
          report.dead.push({ file: f.rel, target });
        }
        continue;
      }

      const states = kinds.map(k => compare(onDisk(p[k]), out[k], out.treeHash));

      const bad = states.filter(s => s === 'missing' || s === 'stale' || s === 'tampered');
      const drifted = states.includes('drifted');

      if (mode === 'check') {
        if (bad.length) {
          const paths = kinds.map(k => p[k]).filter((_, i) => bad.includes(states[i]));
          report.mismatched.push({ file: f.rel, target, why: bad[0], paths });
        } else {
          report.skipped.push({ file: f.rel, target });
          if (drifted) report.drifted.push({ file: f.rel, target });
        }
        continue;
      }

      if (!bad.length && !force) {
        report.skipped.push({ file: f.rel, target });
        if (drifted) report.drifted.push({ file: f.rel, target });
        continue;
      }

      mkdirSync(resolve(root, p.dir), { recursive: true });
      for (const k of kinds) writeFileSync(resolve(root, p[k]), out[k], 'utf8');
      const pkg = targetPackageJson(target);
      if (pkg) writeFileSync(resolve(root, p.pkg), pkg, 'utf8');
      report.written.push({ file: f.rel, target, paths: kinds.map(k => p[k]) });
    }
  }

  if (prune) {
    report.pruned.push(...pruneOrphans(root, mode, report.dead, index));
    /* удалённые сироты больше не расхождение */
    if (mode === 'write') report.mismatched = report.mismatched.filter(m => m.why !== 'orphan');
  }
  return report;
}

/* Артефакты, у которых не осталось исходника — или цель которых больше
   не собирается (dead: [{ file, target }] из отчёта emit). Ручные файлы
   в папках целей не трогаем никогда — о них скажет lint. */
export function pruneOrphans(root = process.cwd(), mode = 'write', dead = [], index = noticeIndex(root)) {
  const gone = new Set(dead.map(d => d.file + '\0' + d.target));
  const alive = new Set();
  for (const f of scan(root))
    if (f.kind === 'snippet' || f.kind === 'algorithm')
      for (const { target, variants } of index.jobsFor(f.rel).jobs) {
        if (gone.has(f.rel + '\0' + target)) continue;
        const p = pathsFor(f.rel, target);
        for (const k of variants) alive.add(p[k]);
        alive.add(p.pkg);
      }

  const orphans = [];
  for (const d of scanArtifactDirs(root)) {
    if (!TARGET_RE.test(d.target)) continue;
    for (const name of d.files) {
      const rel = posix.join(d.dir, name);
      if (alive.has(rel)) continue;
      if (name !== 'package.json') {
        const text = readFileSync(resolve(root, rel), 'utf8');
        if (!isStamped(text)) continue;             // ручной файл — дело линта
      }
      orphans.push(rel);
      if (mode === 'write') rmSync(resolve(root, rel), { force: true });
    }
    const left = existsSync(resolve(root, d.dir)) ? readdirSync(resolve(root, d.dir)) : [];
    if (mode === 'write' && left.length === 0) rmSync(resolve(root, d.dir), { recursive: true, force: true });
  }
  return orphans;
}

export { join, dirname };
