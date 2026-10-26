/* ══════════════════════════════════════════════════════════════════════════
   runtime.js — runtime-примитивы, которых нет у цели (M3)

   Синтаксис понижают проходы; здесь — то, что синтаксисом не является:
   Object.hasOwn, Array.prototype.at, globalThis. Детектор идёт по AST уже
   понижённого кода и находит:

     global   свободное (не объявленное в файле) имя: globalThis, WeakRef
     static   свойство свободного имени: Object.hasOwn, Promise.any
     method   обращение к свойству с таким именем у чего угодно: `.at`

   Тип получателя метода статически неизвестен, поэтому `.at` у своего
   объекта тоже приведёт шим Array.prototype.at — это безопасно: шимы
   ставят метод, только если его нет (BACKLOG.md §12 п. 9). Лишний шим —
   лишние строки, но не другая программа.

   Чего у цели нет и что зашимить нельзя — unsupported; для чего шим ещё не
   написан — pending. Таблица — downgrade-runtime-features.json, шимы —
   *-polyfil.js на ES5, общее для них — downgrade-runtime-helpers.js.

   Node-only имена (Buffer, process, …) в es-цели недоступны. Одно
   исключение переписывается переносимо: Buffer.alloc(n) и
   Buffer.allocUnsafe(n) — в node это по-прежнему Buffer, а вне node —
   Uint8Array той же длины. Для кода, которому нужен просто массив байт,
   этого достаточно; всё прочее от Buffer — unsupported.
   ══════════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { walk } from './downgrade-walk.js';
import { HELPER_NEEDS } from './downgrade-runtime-helpers.js';
import { analyze } from './downgrade-scope.js';
import { edition } from './downgrade-features.js';
import { LowerError, rewrite, PREC } from './downgrade-rewrite.js';
import { link } from './downgrade-link.js';

const TABLE = JSON.parse(readFileSync(new URL('./downgrade-runtime-features.json', import.meta.url), 'utf8'));
delete TABLE.$comment;

/* shim id → polyfil path from the repository root (promise-any → promise/promise-any-polyfil) */
const POLYFILS = TABLE.$polyfils;
delete TABLE.$polyfils;

const shimSource = id => readFileSync(new URL(`./${POLYFILS[id]}.js`, import.meta.url), 'utf8');

/* есть ли у цели примитив (для method — все его владельцы) */
function available(entry, owner, profile) {
  const e = owner ?? entry;
  if (entry.node === true) return profile.matrix === 'nodejs';
  if (profile.matrix === 'nodejs') return e.node <= profile.node;
  return edition(e.es) <= profile.es;
}

/* Что из таблицы встречается в коде: Map<ключ, первый узел>.

   Имя, которое код проверяет сам (`typeof Symbol === 'function' && …`),
   не требует ничего: проверка на то и стоит, чтобы обойтись без него.
   Считается это по всем ссылкам сразу — достаточно одной неприкрытой,
   чтобы имя понадобилось по-настоящему. */
export function usedPrimitives(ast, info = analyze(ast)) {
  const used = new Map();
  const note = (key, node) => { if (TABLE[key] && !used.has(key)) used.set(key, node); };

  const parents = new Map();
  walk(ast, { enter(n, p) { parents.set(n, p); } });
  const guarded = id => {
    const p = parents.get(id);
    return !!p && p.type === 'UnaryExpression' && p.operator === 'typeof' && p.argument === id;
  };

  for (const [name, ids] of info.globals) {
    const open = ids.filter(id => !guarded(id));
    if (open.length) note(name, open[0]);
  }
  walk(ast, {
    enter(n) {
      if (n.type !== 'MemberExpression' || n.computed || n.property.type !== 'Identifier') return;
      const o = n.object;
      if (o.type === 'Identifier' && info.refs.get(o)?.binding === null && !guarded(o))
        note(`${o.name}.${n.property.name}`, n);
      note('.' + n.property.name, n);
    },
  });
  return used;
}

const where = (code, node) => {
  let line = 1;
  for (let i = 0; i < node.start; i++) if (code[i] === '\n') line++;
  return ` (строка ${line})`;
};

/* Шимы для цели: { blocks: [{ id, code }], snippets: [путь] }.
   snippets — сниппеты-полифилы, втянутые в артефакт: они входят в дерево
   и в его хеш, иначе правка полифила не пересобрала бы артефакт.
   Отказ — LowerError. */
/* Помощники в артефакт попадают после детектора — их нужды проверяются
   отдельно, иначе es5-артефакт с async сослался бы на Promise молча. */
function checkHelpers(session, profile) {
  for (const id of session.helpers.keys())
    for (const key of HELPER_NEEDS[id] ?? []) {
      const entry = TABLE[key];
      if (!entry || available(entry, null, profile)) continue;
      const why = entry.unsupported ?? (entry.pending ? `шим появится на этапе ${entry.pending}` : null);
      if (!why) continue;                       // шим есть — подтянется сам
      throw new LowerError(entry.unsupported ? 'unsupported' : 'pending',
        `${key} (ES${entry.es}) — ${why}; это нужно помощнику ${id}`, { feature: key });
    }
}

export function runtimeFor(ast, code, profile, session, info = analyze(ast), root = process.cwd()) {
  checkHelpers(session, profile);
  const shims = new Set();
  const fromSnippet = new Map();          // путь сниппета → [{ global, export }]

  for (const [key, node] of usedPrimitives(ast, info)) {
    const entry = TABLE[key];
    const missing = entry.kind === 'method'
      ? entry.owners.some(o => !available(entry, o, profile))
      : !available(entry, null, profile);
    if (!missing) continue;

    const name = key.startsWith('.') ? key.slice(1) : key;
    const year = entry.es ?? entry.owners?.map(o => o.es).sort().at(-1);
    if (entry.node === true)
      throw new LowerError('unsupported',
        `\`${name}\` есть только в node — es-цели он недоступен; движковому коду место в @.nodejs/${where(code, node)}`,
        { feature: key, pos: node.start });
    /* полифил-сниппету самому может не хватать цели (аксессоры в ES3) */
    if (entry.snippet && profile.es >= (entry.needs ?? 0)) {
      if (!fromSnippet.has(entry.snippet)) fromSnippet.set(entry.snippet, []);
      fromSnippet.get(entry.snippet).push({ global: name, export: entry.export });
      continue;
    }
    if (entry.unsupported)
      throw new LowerError('unsupported', `${name} (ES${year}) — ${entry.unsupported}${where(code, node)}`,
        { feature: key, pos: node.start });
    if (entry.pending)
      throw new LowerError('pending', `${name} (ES${year}) — шим появится на этапе ${entry.pending}${where(code, node)}`,
        { feature: key, pos: node.start });
    shims.add(entry.shim);
  }

  const blocks = [...shims].sort().map(id => {
    let text = shimSource(id);
    /* общие помощники шимов — под именами, свободными в этом файле */
    text = text.replace(/\b__dg_(define|typedArrayProtos|global|toInt|toArray)\b/g,
      (_, h) => session.helper(h, info));
    return { id, code: text };
  });

  for (const [rel, wanted] of [...fromSnippet].sort())
    blocks.push({ id: rel, code: inlineSnippet(rel, wanted, session, info, root) });

  return { blocks, snippets: [...fromSnippet.keys()].sort() };
}

/* Сниппет-полифил внутрь артефакта: его код прячется в IIFE (его имена
   не должны столкнуться с именами артефакта), а нужное берётся из
   глобального объекта, если оно там есть, и из полифила, если нет. */
function inlineSnippet(rel, wanted, session, info, root) {
  const linked = link(rel, { root, moduleFormat: 'inline' });
  const box = info.fresh(rel.replace(/^.*\//, '').replace(/\.js$/, '').replace(/[^A-Za-z0-9_$]/g, '_'));
  const g = session.helper('global', info);
  const returns = wanted.map(w => {
    const local = linked.exports.get(w.export);
    if (!local) throw new Error(`${rel}: полифил не экспортирует ${w.export}`);
    return `${w.export}: ${local}`;
  });
  const names = wanted.map(w => `var ${w.global} = ${g}().${w.global} || ${box}.${w.export};`);
  return `/* ${wanted.map(w => w.global).join(', ')} — полифил из ${rel} */\n` +
    `var ${box} = (function () {\n${linked.code.trim()}\nreturn { ${returns.join(', ')} };\n})();\n` +
    names.join('\n');
}


/* ── переносимая замена Buffer.alloc* ───────────────────────────────────── */

const ALLOC = new Set(['alloc', 'allocUnsafe', 'allocUnsafeSlow']);

/* Все ли обращения к глобальному Buffer — Buffer.alloc*(n)? Тогда их
   можно заменить; иначе оставить как есть и дать runtimeFor отказать. */
function portableBuffer(ast, info) {
  const refs = info.globals.get('Buffer');
  if (!refs) return null;
  const parents = new Map();
  walk(ast, { enter(n, p) { parents.set(n, p); } });
  const calls = [];
  for (const id of refs) {
    const m = parents.get(id);
    const call = m && parents.get(m);
    if (!m || m.type !== 'MemberExpression' || m.object !== id || m.computed || !ALLOC.has(m.property.name)) return null;
    if (!call || call.type !== 'CallExpression' || call.callee !== m || call.arguments.length !== 1 ||
        call.arguments[0].type === 'SpreadElement') return null;
    calls.push(call);
  }
  return calls;
}

/* Buffer.alloc(n) → __dg_alloc(n): Buffer в node, Uint8Array вне его. */
export function rewriteBuffer(code, ast, session, profile) {
  if (profile.matrix === 'nodejs') return code;
  const info = analyze(ast);
  const calls = portableBuffer(ast, info);
  if (!calls || !calls.length) return code;
  const set = new Set(calls);
  return rewrite(code, ast, {
    CallExpression(n, ctx) {
      if (!set.has(n)) return;
      const kind = n.callee.property.name === 'alloc' ? 'bufferAlloc' : 'bufferAllocUnsafe';
      return { text: `${ctx.helper(kind)}(${ctx.expr(n.arguments[0], PREC.ASSIGN)})`, prec: PREC.CALL };
    },
  }, { session, scope: info }).code;
}
