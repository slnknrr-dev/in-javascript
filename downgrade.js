#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   downgrade — сборщик артефактов репозитория сниппетов

   Vanilla Node.js ≥ 21, ноль зависимостей. Подробности — BACKLOG.md §6.
   ══════════════════════════════════════════════════════════════════════════ */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { parseArgs, selectFiles } from './downgrade-args.js';
import { scan, scanArtifactDirs } from './downgrade-scan.js';
import { treeOf, specifiers, classifySpec } from './downgrade-graph.js';
import { rawHash, codeHash, treeHash } from './downgrade-hash.js';
import { minify } from './downgrade-minify.js';
import { CANONICAL, TARGET_RE } from './downgrade-targets.js';
import { noticeIndex, resolveFiles } from './downgrade-notice.js';
import { emit, pathsFor, render } from './downgrade-emit.js';
import { format as formatReport } from './downgrade-report.js';
import { LowerError } from './downgrade-lower.js';
import { isStamped } from './downgrade-stamp.js';
import { parse } from './downgrade-parse.js';
import { analyze } from './downgrade-scope.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/* tool version: part of every treeHash, bump it when the output of the tool changes */
const VERSION = '0.2.0';
const ROOT = process.cwd();

const USAGE = `
downgrade <команда> [пути…] [флаги]

  tree     дерево импортов, хеши файлов, treeHash и список целей
  lint     структурные инварианты репозитория
  emit     собрать артефакты в папки вида png.@image/es16@mjs/
  update   lint → emit → сводка: обычный прогон перед коммитом
  minify   минифицировать файл в stdout
  hash     rawHash / codeHash / дерево файла

Пути — файлы или папки. Без них команда работает по всему репозиторию:

  downgrade emit png.@image/            только эта тема
  downgrade emit png.@image/png-format.js algorithm/
  downgrade tree --json

Флаги:
  --check            ничего не писать, сверить с диском (код 1 при расхождении)
  --force            пересобрать, игнорируя совпадение treeHash
  --prune            удалить артефакты без исходника или без собираемой цели
  --targets=a,b      ограничить набор целей
  --why              причины pending/unsupported по каждой паре (emit)
  --json             машинный вывод (tree)
  --report=файл      отчёт о сборке: .json — машинный, иначе Markdown (emit)
  --stat             только статистика (minify)
  --quiet            короткий вывод

Через npm аргументы идут после --:  npm run emit -- png.@image/ --force
`.trim();

const { command, paths, flags } = parseArgs(process.argv.slice(2));
const flag = n => flags.get(n) === true || flags.get(n) === 'true';
const quiet = flag('quiet');
const say = (...a) => { if (!quiet) console.log(...a); };

/* Исходники, попадающие под указанные пути. */
function pick({ sourcesOnly = true } = {}) {
  const rows = scan(ROOT).filter(f => !sourcesOnly || f.kind === 'snippet' || f.kind === 'algorithm');
  const { files, unmatched } = selectFiles(rows, paths, ROOT);
  for (const p of unmatched) console.error(`downgrade: ${p} — ни одного исходника не найдено`);
  return { files, bad: unmatched.length > 0 };
}

const wantedTargets = () => {
  const v = flags.get('targets');
  return typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : null;
};

/* ── tree ───────────────────────────────────────────────────────────────── */

/* Соберётся ли цель: ready | pending | unsupported | failed — и почему.
   Это та же сборка, что у emit, только в память. */
function statusOf(rel, target) {
  try {
    const r = render(rel, target, { root: ROOT, toolVersion: VERSION });
    const done = r.lowered.passes.length + r.lowered.helpers.length + r.lowered.shims.length;
    return { status: 'ready', why: done ? [...r.lowered.passes, ...r.lowered.helpers, ...r.lowered.shims].join(', ') : '' };
  } catch (e) {
    return { status: e instanceof LowerError ? e.kind : 'failed', why: e.message };
  }
}

const MARKS = { ready: '', pending: '*', unsupported: '×', failed: '!' };

function cmdTree() {
  const { files, bad } = pick();
  const index = noticeIndex(ROOT);
  const rows = files.map(f => {
    const canon = CANONICAL[f.matrix];
    const plan = index.jobsFor(f.rel);
    const targets = plan.jobs.map(j => j.target).filter(t => !wantedTargets() || wantedTargets().includes(t));
    return {
      ...f, targets, canon, plan,
      tree: treeHash(f.rel, canon, { root: ROOT, toolVersion: VERSION }),
      status: Object.fromEntries(targets.map(t => [t, statusOf(f.rel, t)])),
    };
  });

  if (flag('json')) {
    console.log(JSON.stringify(rows.map(r => ({
      file: r.rel, kind: r.kind, matrix: r.matrix, dialect: r.dialect,
      targets: r.status, treeHash: r.tree.hash,
      tree: r.tree.entries, builtins: r.tree.builtins, problems: r.tree.problems,
    })), null, 2));
    return bad ? 1 : 0;
  }

  let problems = 0;
  const count = { ready: 0, pending: 0, unsupported: 0, failed: 0 };
  for (const r of rows) {
    const deps = r.tree.entries.length - 1;
    console.log(`\n${r.rel}  [${r.kind}/${r.matrix}${r.dialect ? '/' + r.dialect : ''}]`);
    console.log(`  tree ${r.tree.hash.slice(0, 16)}…  (${deps} ${deps === 1 ? 'зависимость' : 'зависимостей'})`);
    for (const e of r.tree.entries.slice(1)) console.log(`    ← ${e.file}  ${e.hash.slice(0, 12)}…`);
    for (const b of r.tree.builtins) console.log(`    ← ${b}  (встроенный)`);
    console.log(`  NOTICE: ${r.plan.notices.length ? r.plan.notices.join(', ') : '— (нет: артефактов не будет)'}`);
    console.log(`  цели: ${r.targets.map(t => t + MARKS[r.status[t].status]).join(' ')}`);
    for (const p of r.plan.pending) console.log(`    * ${p.label}: ${p.why} (${p.notice})`);
    /* причины — по одной на вид отказа: у пяти es5-целей одна и та же */
    const seen = new Set();
    for (const t of r.targets) {
      const s = r.status[t];
      count[s.status]++;
      if (s.status === 'failed') problems++;
      if (s.status === 'ready') continue;
      const key = s.status + s.why.replace(/ \(строка \d+\)/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`    ${MARKS[s.status]} ${t}: ${s.why}`);
    }
    for (const p of r.tree.problems) { problems++; console.log(`  !! ${p.from}: ${p.spec} — ${p.why}`); }
  }

  const all = scan(ROOT);
  console.log(`\n${rows.length} исходников, ` +
    `${all.filter(f => f.kind === 'helper').length} helper'ов (без своих артефактов), ` +
    `${all.filter(f => f.kind === 'empty').length} пустых заготовок, ` +
    `${all.filter(f => f.kind === 'note').length} заметок.`);
  console.log(`целей: ${rows.reduce((a, r) => a + r.targets.length, 0)} — собирается ${count.ready}, ` +
    `* ждут прохода ${count.pending}, × не понижаются ${count.unsupported}` +
    (count.failed ? `, ! ошибок ${count.failed}` : '') + '.');
  return problems || bad ? 1 : 0;
}

/* ── lint ───────────────────────────────────────────────────────────────── */

const NODE_ONLY = ['Buffer', 'process', '__dirname', '__filename', 'global', 'setImmediate', 'clearImmediate'];

function cmdLint() {
  const { files, bad } = pick({ sourcesOnly: false });
  let errors = 0, warns = 0;
  const err = m => { errors++; console.log('  error  ' + m); };
  const warn = m => { warns++; console.log('  warn   ' + m); };

  for (const f of files) {
    if (f.kind === 'empty' || f.kind === 'note') continue;

    let src;
    try { src = readFileSync(resolve(ROOT, f.rel), 'utf8'); } catch { continue; }

    let specs;
    try { specs = specifiers(src); }
    catch (e) { err(`${f.rel}: не токенизируется — ${e.message}`); continue; }

    /* исходник обязан разбираться: из неразбираемого не собрать ни одной
       цели, а es16-артефакт без понижения просто не загрузился бы */
    let ast;
    try { ast = parse(src); }
    catch (e) { err(`${f.rel}: не разбирается — ${e.message}`); continue; }

    /* node-only глобальные имена вне движковой папки: es-цели их не
       получат. Buffer.alloc/allocUnsafe переписываются в Uint8Array
       (lower.js), остальное — unsupported */
    if (f.matrix !== 'nodejs') {
      const globals = analyze(ast).globals;
      for (const name of NODE_ONLY)
        if (globals.has(name))
          warn(`${f.rel}: \`${name}\` есть только в node — es-цели ${name === 'Buffer' ? 'получат Uint8Array вместо Buffer.alloc*' : 'пометятся unsupported'}; движковому коду место в @.nodejs/`);
    }

    for (const { spec } of specs) {
      const k = classifySpec(spec);
      if (k === 'bare' || k === 'url' || k === 'registry')
        err(`${f.rel}: импорт '${spec}' (${k}) — артефакт не будет singlefile`);
      if (k === 'builtin' && f.matrix !== 'nodejs')
        warn(`${f.rel}: импорт '${spec}' вне движковой папки — es-цели пометятся unsupported`);
    }

    if (/^\s*(module\.exports|exports)\s*[.=]/m.test(src))
      err(`${f.rel}: CJS в исходнике — исходники только ESM`);
    if (!/(^|\n)\s*export\s/.test(src))
      warn(`${f.rel}: нет ни одного export`);

    if (f.kind === 'algorithm') {
      for (const { spec } of specs)
        if (classifySpec(spec) === 'relative' && !/^\.\/[^/]+$/.test(spec))
          err(`${f.rel}: algorithm/ импортирует вне algorithm/ — '${spec}'`);
      if (!/^\s*\/\*/.test(src))
        err(`${f.rel}: algorithm/ требует шапку-комментарий с именем алгоритма`);
    }
  }

  /* *_NOTICE.md: the name is the configuration (downgrade-notice.js) */
  for (const n of noticeIndex(ROOT).all) {
    if (n.foreign) { warn(`${n.rel}: не артефактный NOTICE (слова вне грамматики) — артефактов не задаёт`); continue; }
    if (n.error) { err(n.error); continue; }
    for (const j of n.jobs) if (j.error) err(`${n.rel}: ${j.error}`);
    if (n.files) {
      if (!n.files.length) warn(`${n.rel}: раздел FILES без списка — NOTICE не покрывает ни одного файла`);
      for (const r of resolveFiles(n, ROOT)) if (r.missing) warn(`${n.rel}: FILES — «${r.entry}» не найден, пропущен`);
    }
  }

  for (const d of scanArtifactDirs(ROOT)) {
    for (const name of d.files) {
      if (name === 'package.json') continue;
      if (!isStamped(readFileSync(resolve(ROOT, d.dir, name), 'utf8')))
        err(`${d.dir}/${name}: ручной файл в папке артефактов`);
    }
  }

  say(`\n${errors} ошибок, ${warns} предупреждений.`);
  return errors || bad ? 1 : 0;
}

/* ── emit ───────────────────────────────────────────────────────────────── */

function runEmit() {
  const { files, bad } = pick();
  const mode = flag('check') ? 'check' : 'write';
  const r = emit(files, {
    root: ROOT, toolVersion: VERSION, targets: wantedTargets(),
    mode, force: flag('force'), prune: flag('prune'),
  });

  if (!quiet) {
    for (const w of r.written) console.log(`  + ${w.paths.join(', ')}`);
    for (const m of r.mismatched) for (const p of m.paths)
      console.log(`  ≠ ${p}  [${m.why === 'orphan' ? 'цель больше не собирается — удалит --prune' : m.why}]`);
    for (const d of r.drifted) console.log(`  ~ ${d.file} [${d.target}] — отстали только комментарии`);
    for (const p of r.pruned) console.log(`  − ${p}`);
    for (const f of r.failed) console.log(`  !! ${f.file} [${f.target}] — ${f.why}`);
    if (flag('why')) {
      for (const u of r.unsupported) console.log(`  × ${u.file} [${u.target}] — ${u.why}`);
      for (const p of r.pending) console.log(`  * ${p.file} [${p.target}] — ${p.why}`);
    }
  }

  const byTarget = list => [...new Set(list.map(p => p.target))].sort().join(' ');
  console.log(
    `\n${mode === 'check' ? 'сверено' : 'записано'}: ${r.written.length}, ` +
    `без изменений: ${r.skipped.length}` +
    (r.mismatched.length ? `, расхождений: ${r.mismatched.length}` : '') +
    (r.pruned.length ? `, удалено: ${r.pruned.length}` : '') +
    (r.failed.length ? `, отказов: ${r.failed.length}` : ''));

  if (r.unsupported.length)
    console.log(`не понижаются: ${r.unsupported.length} (${byTarget(r.unsupported)}) — BigInt, lookbehind и т. п.`);
  if (r.pending.length)
    console.log(`ждут проходов понижения: ${r.pending.length} (${byTarget(r.pending)}) — BACKLOG.md §11, M4–M5`);
  if ((r.unsupported.length || r.pending.length) && !flag('why'))
    console.log('причины: --why, или `downgrade tree`');

  const where = flags.get('report');
  if (typeof where === 'string') {
    writeFileSync(where, formatReport(r, where, { title: `downgrade ${VERSION} — ${mode}`, root: ROOT }));
    if (!quiet) console.log(`отчёт: ${where}`);
  }

  return { code: (r.mismatched.length || r.failed.length || bad) ? 1 : 0, report: r };
}

const cmdEmit = () => runEmit().code;

/* ── update ─────────────────────────────────────────────────────────────── */

/* Обычный прогон перед коммитом: проверить структуру, собрать, показать
   что получилось. Останавливается на первом же шаге, который упал: собирать
   артефакты из репозитория, не прошедшего линт, смысла нет. */
function cmdUpdate() {
  say('── lint ───────────────────────────────────────────────');
  const lint = cmdLint();
  if (lint !== 0) {
    console.error('\nupdate прерван: линт не прошёл.');
    return 1;
  }

  say('\n── emit ───────────────────────────────────────────────');
  const { code, report } = runEmit();
  if (code !== 0) {
    console.error('\nupdate прерван: сборка не прошла.');
    return code;
  }

  say('\n── итог ───────────────────────────────────────────────');
  const touched = report.written.length;
  console.log(touched
    ? `${touched} артефактов пересобрано.`
    : 'Артефакты актуальны: ни один файл не тронут.');
  if (report.pending.length)
    console.log(`${report.pending.length} целей ещё ждут проходов понижения.`);
  say('Дальше: `downgrade tree` — что во что входит.');
  return 0;
}

/* ── minify / hash ──────────────────────────────────────────────────────── */

function cmdMinify() {
  const { files, bad } = pick();
  if (!files.length) { console.error('нечего минифицировать'); return 2; }
  for (const f of files) {
    const src = readFileSync(resolve(ROOT, f.rel), 'utf8');
    const out = minify(src);
    if (flag('stat') || files.length > 1) {
      const pct = (100 * (1 - out.length / src.length)).toFixed(1);
      console.log(`${f.rel}: ${src.length} → ${out.length} байт (−${pct}%)`);
    } else console.log(out);
  }
  return bad ? 1 : 0;
}

function cmdHash() {
  const { files, bad } = pick();
  for (const f of files) {
    console.log(`${f.rel}\n  raw  ${rawHash(f.rel, ROOT)}\n  code ${codeHash(f.rel, ROOT)}`);
    const t = treeOf(f.rel, ROOT);
    if (t.files.length > 1) console.log('  дерево: ' + t.files.join(', '));
    for (const target of (wantedTargets() ?? [CANONICAL[f.matrix]]))
      console.log(`  tree[${target}] ${treeHash(f.rel, target, { root: ROOT, toolVersion: VERSION }).hash}`);
  }
  return bad ? 1 : 0;
}

/* ── диспетчер ──────────────────────────────────────────────────────────── */

const COMMANDS = {
  tree: cmdTree, lint: cmdLint, emit: cmdEmit,
  update: cmdUpdate, minify: cmdMinify, hash: cmdHash,
};

if (!command || flag('help') || flag('h')) { console.log(USAGE); process.exit(0); }
if (!COMMANDS[command]) {
  console.error(`downgrade: неизвестная команда «${command}»\n`);
  console.error(USAGE);
  process.exit(2);
}

try {
  process.exit(COMMANDS[command]());
} catch (e) {
  console.error('downgrade: ' + (e && e.message ? e.message : e));
  if (flag('trace')) console.error(e);
  process.exit(2);
}

export { TARGET_RE, pathsFor };
