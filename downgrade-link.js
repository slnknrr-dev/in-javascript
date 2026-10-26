/* ══════════════════════════════════════════════════════════════════════════
   link.js — сборка дерева модулей в один файл (singlefile)

   Берёт дерево из graph.js, вырезает из каждого файла операторы import и
   export и склеивает модули в порядке зависимостей: сперва то, что ни от
   кого не зависит, последним — корень. Внешних ссылок в результате не
   остаётся, поэтому артефакт можно скопировать куда угодно.

   Резка идёт **по тексту**, по смещениям токенов, а не пересборкой из
   токенов: иначе из артефакта пропали бы все комментарии, а обычный (не
   .min) артефакт существует именно ради того, чтобы в него можно было
   заглянуть.

   Склеенные модули живут в одной области видимости, поэтому каждая
   привязка верхнего уровня получает имя, уникальное на весь артефакт
   (unifyNames): совпавшее с чужим — `имя$2`, импорт — прямо имя того,
   что импортируется. Переименование идёт по областям видимости (scope.js,
   M1b): меняются ровно ссылки на эту привязку, а не одноимённая
   переменная цикла во вложенной функции. Раньше, без разбора областей,
   конфликт имён был отказом.

   Форма экспорта на выходе зависит от целевой системы модулей:
     esm — `export default X; export { a, b };` как было
     cjs — интероп «default-first», см. BACKLOG.md §6.8
   ══════════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { readSource, isTypeScript } from './downgrade-source.js';
import { dirname, resolve, relative, posix } from 'node:path';
import { tokenize } from './downgrade-tokenize.js';
import { treeOf, classifySpec } from './downgrade-graph.js';
import { toPosix } from './downgrade-scan.js';
import { parse } from './downgrade-parse.js';
import { analyze, renameEdits, applyEdits } from './downgrade-scope.js';

const DECL = new Set(['const', 'let', 'var', 'function', 'class']);
/* объявления, за которыми нет значения: экспортировать из них нечего,
   но в singlefile-артефакте `@ts`-цели они должны остаться на месте */
const TYPE_DECL = new Set(['interface', 'type', 'declare', 'abstract', 'enum', 'namespace']);

/* Метка места для runtime-блока (шимы и вспомогательные функции
   понижения, lower.js): перед первым модулем, после шапки, директивы и
   встроенных импортов. Понижение заменяет её блоком или убирает. */
export const RUNTIME_SLOT = '/* @slnknrr/downgrade: runtime */';

class LinkError extends Error {
  constructor(msg) { super(msg); this.name = 'LinkError'; }
}

/* ── разбор одного модуля ───────────────────────────────────────────────── */

/* Что нужно знать о модуле, чтобы его склеить:
     cuts      — диапазоны текста на вырезание (import/export-операторы)
     topLevel  — имена, объявленные на верхнем уровне
     named     — экспортируемые имена: exported → local
     def       — локальное имя, экспортируемое по умолчанию, или null
     imports   — [{ spec, names: [{ imported, local }], def, ns }]
     builtins  — импорты node:*, которые останутся как есть            */
function readModule(rel, root, text = null, keepTypes = false) {
  const abs = resolve(root, rel);
  const src = text ?? readSource(abs, { keepTypes });
  const t = tokenize(src);

  const cuts = [], topLevel = new Map(), named = new Map(), imports = [], reexports = [];
  let def = null;
  let depth = 0;

  const at = i => t[i];
  const isP = (i, v) => t[i] && t[i].t === 'punct' && t[i].v === v;
  const isN = (i, v) => t[i] && t[i].t === 'name' && t[i].v === v;

  /* конец оператора: ';' на нулевой относительной глубине, иначе — до
     токена, перед которым был перевод строки (ASI) */
  function endOfStatement(i) {
    let d = 0;
    for (let j = i; j < t.length; j++) {
      const v = t[j].v;
      if (t[j].t === 'punct') {
        if (v === '{' || v === '(' || v === '[') d++;
        else if (v === '}' || v === ')' || v === ']') d--;
        else if (v === ';' && d === 0) return j;
      }
      if (d === 0 && j > i && t[j + 1] && t[j + 1].nl && !isP(j + 1, ';')) return j;
    }
    return t.length - 1;
  }

  /* имена деклараторов: `const a = 1, b = 2;` → [a, b]

     Глубина проверяется ДО того, как текущий токен её изменит. Иначе
     закрывающая скобка после хвостовой запятой (`[1, 2,]`) выглядит как
     имя следующего декларатора: запятая была на глубине 1, а `]` уже
     опустил счётчик в 0. */
  function declNames(i) {
    const out = [];
    const end = endOfStatement(i);
    let d = 0;
    for (let j = i + 1; j <= end; j++) {
      const tok = t[j];
      const outer = d === 0;
      if (tok.t === 'punct') {
        if ('{(['.includes(tok.v)) d++;
        else if ('})]'.includes(tok.v)) d--;
      }
      if (!outer) continue;
      if (j === i + 1 || (t[j - 1].t === 'punct' && t[j - 1].v === ',')) {
        if (tok.t === 'name') out.push(tok.v);
        else if (j === i + 1 || tok.v === '[' || tok.v === '{') throw new LinkError(
          `${rel}: деструктуризация на верхнем уровне не поддерживается линкером`);
        /* иначе запятая была не между объявляемыми именами: у `@ts`-цели
           так выглядит `<T,>` в параметрах типа стрелки */
      }
    }
    return out;
  }

  /* Конец import-оператора — это его спецификатор, а не ASI: объявление
     свободно переносится (`import { a }\n  from './x.js';`), и общая
     эвристика оборвала бы его на закрывающей фигурной скобке. */
  function endOfImport(i) {
    for (let j = i + 1; j < t.length; j++) {
      if (t[j].t === 'str') return isP(j + 1, ';') ? j + 1 : j;
      if (t[j].t === 'name' && (t[j].v === 'import' || t[j].v === 'export') && j > i + 1) break;
    }
    throw new LinkError(`${rel}: import без спецификатора`);
  }

  /* Конец `export { … }` — парная скобка плюс необязательная точка с запятой. */
  function endOfExportList(i) {
    for (let j = i + 2; j < t.length; j++)
      if (isP(j, '}')) return isP(j + 1, ';') ? j + 1 : j;
    throw new LinkError(`${rel}: незакрытый список export`);
  }

  for (let i = 0; i < t.length; i++) {
    const tok = t[i];

    if (tok.t === 'punct') {
      if ('{(['.includes(tok.v)) { depth++; continue; }
      if ('})]'.includes(tok.v)) { depth--; continue; }
    }
    if (depth !== 0 || tok.t !== 'name') continue;

    /* ── import ── */
    if (tok.v === 'import') {
      if (isP(i + 1, '(') || isP(i + 1, '.')) continue;      // import() / import.meta
      const end = endOfImport(i);
      const entry = { spec: null, names: [], def: null, ns: null };

      /* `import type { X } from …` у `@ts`-цели: сам импорт не нужен —
         объявление типа приедет в singlefile вместе с модулем, — но модуль
         всё равно часть дерева, поэтому запись о нём остаётся. */
      if (keepTypes && isN(i + 1, 'type') && !isN(i + 2, 'from')) {
        for (let j = i + 1; j <= end; j++)
          if (t[j].t === 'str') { entry.spec = t[j].v.slice(1, -1); break; }
        if (!entry.spec) throw new LinkError(`${rel}: import type без спецификатора`);
        imports.push(entry);
        cuts.push([tok.s, t[end].e]);
        i = end;
        continue;
      }

      for (let j = i + 1; j <= end; j++) {
        if (t[j].t === 'str') { entry.spec = t[j].v.slice(1, -1); break; }
        if (t[j].t === 'name' && t[j].v === 'from') continue;
        if (isP(j, '*') && isN(j + 1, 'as') && at(j + 2)) { entry.ns = t[j + 2].v; j += 2; continue; }
        if (isP(j, '{')) {
          for (let k = j + 1; k <= end && !isP(k, '}'); k++) {
            if (t[k].t !== 'name') continue;
            if (isN(k + 1, 'as') && at(k + 2)) { entry.names.push({ imported: t[k].v, local: t[k + 2].v }); k += 2; }
            else entry.names.push({ imported: t[k].v, local: t[k].v });
          }
          while (j <= end && !isP(j, '}')) j++;
          continue;
        }
        if (t[j].t === 'name' && !entry.def && j === i + 1) entry.def = t[j].v;
      }

      if (!entry.spec) throw new LinkError(`${rel}: import без спецификатора`);
      imports.push(entry);
      cuts.push([tok.s, t[end].e]);
      i = end;
      continue;
    }

    /* ── export ── */
    if (tok.v === 'export') {
      if (isN(i + 1, 'default')) {
        const ok = at(i + 2) && t[i + 2].t === 'name' &&
          (!at(i + 3) || isP(i + 3, ';') || t[i + 3].nl);
        if (!ok) throw new LinkError(
          `${rel}: \`export default\` поддерживается только от имени (не от выражения)`);
        def = t[i + 2].v;
        const end = isP(i + 3, ';') ? i + 3 : i + 2;
        cuts.push([tok.s, t[end].e]);
        i = end;
        continue;
      }

      if (isP(i + 1, '{')) {
        const end = endOfExportList(i);
        const pairs = [];
        for (let k = i + 2; k <= end && !isP(k, '}'); k++) {
          if (t[k].t !== 'name') continue;
          if (isN(k + 1, 'as') && at(k + 2)) { pairs.push({ from: t[k].v, to: t[k + 2].v }); k += 2; }
          else pairs.push({ from: t[k].v, to: t[k].v });
        }
        /* `export { a } from './x.js'` — ре-экспорт: имя берётся у соседа,
           своей привязки модуль не заводит */
        const brace = isP(end, '}') ? end : end - 1;
        if (isN(brace + 1, 'from')) {
          const spec = t[brace + 2];
          if (!spec || spec.t !== 'str') throw new LinkError(`${rel}: ре-экспорт без спецификатора`);
          const last = isP(brace + 3, ';') ? brace + 3 : brace + 2;
          reexports.push({ spec: spec.v.slice(1, -1), names: pairs, all: false });
          cuts.push([tok.s, t[last].e]);
          i = last;
        } else {
          for (const p of pairs) named.set(p.to, p.from);
          cuts.push([tok.s, t[end].e]);
          i = end;
        }
        continue;
      }

      if (isP(i + 1, '*')) {
        let j = i + 2;
        if (isN(j, 'as')) throw new LinkError(`${rel}: \`export * as ns\` линкером не поддерживается`);
        if (!isN(j, 'from')) throw new LinkError(`${rel}: \`export *\` без from`);
        const spec = t[j + 1];
        if (!spec || spec.t !== 'str') throw new LinkError(`${rel}: ре-экспорт без спецификатора`);
        const last = isP(j + 2, ';') ? j + 2 : j + 1;
        reexports.push({ spec: spec.v.slice(1, -1), names: null, all: true });
        cuts.push([tok.s, t[last].e]);
        i = last;
        continue;
      }

      /* `export interface X {}` — слово export убираем, имени не заводим:
         типовое объявление значения не создаёт */
      if (keepTypes && at(i + 1) && TYPE_DECL.has(t[i + 1].v) &&
          !(t[i + 1].v === 'type' && isP(i + 2, '='))) {
        cuts.push([tok.s, t[i + 1].s]);
        i++;
        continue;
      }

      if (at(i + 1) && DECL.has(t[i + 1].v)) {
        /* `export function f(){}` → вырезаем только слово export */
        cuts.push([tok.s, t[i + 1].s]);
        const kw = t[i + 1].v;
        if (kw === 'function' || kw === 'class') {
          const name = at(i + 2)?.v;
          if (name) { topLevel.set(name, rel); named.set(name, name); }
        } else {
          for (const n of declNames(i + 1)) { topLevel.set(n, rel); named.set(n, n); }
        }
        i++;
        continue;
      }

      throw new LinkError(`${rel}: неподдерживаемая форма export`);
    }

    /* ── объявления верхнего уровня ── */
    if (DECL.has(tok.v)) {
      if (tok.v === 'function' || tok.v === 'class') {
        const name = at(i + 1)?.v;
        if (name && t[i + 1].t === 'name') topLevel.set(name, rel);
      } else {
        for (const n of declNames(i)) topLevel.set(n, rel);
      }
    }
  }

  return { rel, src, cuts, topLevel, named, def, imports, reexports, lead: t.length ? t[0].s : 0 };
}

/* Текст модуля без import/export-операторов.

   skipLead отрезает шапку файла — комментарий до первого токена. Он нужен
   корню: модули склеиваются зависимостями вперёд, поэтому шапка корня
   оказалась бы в середине артефакта, а файл должен называть себя сверху. */
function stripped(m, { skipLead = false } = {}) {
  const from = skipLead ? m.lead : 0;
  const cuts = [...m.cuts].sort((a, b) => a[0] - b[0]).filter(([, e]) => e > from);
  let out = '', p = from;
  for (const [s, e] of cuts) { out += m.src.slice(p, Math.max(p, s)); p = e; }
  out += m.src.slice(p);
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/* Шапка файла — ведущий комментарий до первого токена. */
const leadOf = m => m.src.slice(0, m.lead).trim();

/* ── порядок склейки: зависимости раньше зависящих ──────────────────────── */

function topoOrder(entryRel, root, keepTypes = false) {
  const order = [], mark = new Map();

  (function visit(rel, chain) {
    if (mark.get(rel) === 'done') return;
    if (mark.get(rel) === 'open')
      throw new LinkError('цикл импортов: ' + [...chain, rel].join(' → '));
    mark.set(rel, 'open');

    const abs = resolve(root, rel);
    const m = readModule(rel, root, null, keepTypes);
    for (const imp of [...m.imports, ...m.reexports]) {
      if (classifySpec(imp.spec) !== 'relative') continue;
      const child = posix.normalize(toPosix(relative(root, resolve(dirname(abs), imp.spec))));
      visit(child, [...chain, rel]);
    }

    mark.set(rel, 'done');
    order.push(rel);
  })(entryRel, []);

  return order;
}

/* ── сборка ─────────────────────────────────────────────────────────────── */

/* entryRel + дерево → один файл под указанную систему модулей.
   Возвращает { code, builtins }. Бросает LinkError на том, что требует
   парсера (конфликт имён, ре-экспорт, деструктуризация верхнего уровня).

   nodePrefix: false — встроенные модули без `node:` (`require("fs")`):
   префикс в require понимает только node ≥ 14.18, а цели nodejs5 и
   nodejs13 старше. */
export function link(entryRel, { root = process.cwd(), moduleFormat = 'esm', nodePrefix = true, esModuleMark = 'define', keepTypes = false } = {}) {
  const { problems } = treeOf(entryRel, root);
  if (problems.length)
    throw new LinkError(problems.map(p => `${p.from}: ${p.spec} — ${p.why}`).join('; '));

  const order = topoOrder(entryRel, root, keepTypes);
  const { mods, builtins } = unifyNames(order, root, keepTypes);

  const entry = mods.get(entryRel);
  const parts = [];

  const head = leadOf(entry);
  if (head) parts.push(head);

  /* ESM всегда строгий, CJS — нет: директиву нужно поставить явно, иначе
     артефакт под require() получит другую семантику, чем исходник. */
  if (moduleFormat === 'cjs') parts.push("'use strict';");

  /* встроенные модули node — по одному импорту на (модуль, имя), сколько
     бы модулей дерева их ни импортировали */
  for (const b of builtins) {
    const spec = JSON.stringify(nodePrefix ? b.spec : b.spec.replace(/^node:/, ''));
    if (moduleFormat === 'cjs') {
      if (b.imported === '*' || b.imported === 'default') parts.push(`const ${b.name} = require(${spec});`);
      else parts.push(`const { ${b.imported === b.name ? b.name : `${b.imported}: ${b.name}`} } = require(${spec});`);
    } else if (b.imported === '*') parts.push(`import * as ${b.name} from ${spec};`);
    else if (b.imported === 'default') parts.push(`import ${b.name} from ${spec};`);
    else parts.push(`import { ${b.imported === b.name ? b.name : `${b.imported} as ${b.name}`} } from ${spec};`);
  }

  if (moduleFormat !== 'inline') parts.push(RUNTIME_SLOT);

  for (const rel of order) {
    const isEntry = rel === entryRel;
    const body = stripped(mods.get(rel), { skipLead: isEntry });
    if (!body) continue;
    parts.push(`/* ── ${rel} ${'─'.repeat(Math.max(3, 66 - rel.length))} */\n\n${body}`);
  }

  /* эпилог: экспорт корня. `inline` — без эпилога: код втягивается в
     чужой артефакт (шим-полифил), а что в нём экспортируется, вызывающий
     узнаёт из карты exports. */
  const names = [...entry.named].map(([exported, local]) =>
    exported === local ? local : `${local} as ${exported}`);

  if (moduleFormat === 'inline') {
    /* ничего не добавляем */
  } else if (moduleFormat === 'cjs') {
    const lines = [];
    if (entry.def) {
      lines.push(`module.exports = ${entry.def};`);
      lines.push(`module.exports.default = ${entry.def};`);
      for (const [exported, local] of entry.named) lines.push(`module.exports.${exported} = ${local};`);
    } else {
      lines.push(`module.exports = { ${[...entry.named]
        .map(([exported, local]) => exported === local ? local : `${exported}: ${local}`)
        .join(', ')} };`);
    }
    /* метку __esModule ставим неперечислимой — она служебная и не должна
       попадать в Object.keys(require(...)). В ES3 дескрипторов нет, там
       остаётся присваивание (BACKLOG.md §12 п. 31). */
    lines.push(esModuleMark === 'assign'
      ? `module.exports.__esModule = true;`
      : `Object.defineProperty(module.exports, '__esModule', { value: true });`);
    parts.push(lines.join('\n'));
  } else {
    if (entry.def) parts.push(`export default ${entry.def};`);
    if (names.length) parts.push(`export { ${names.join(', ')} };`);
  }

  return {
    code: parts.join('\n\n') + '\n',
    builtins: [...new Set(builtins.map(b => b.spec))],
    exports: entry.named,          // экспортируемое имя → имя в собранном коде
    default: entry.def,
  };
}

/* ── окончательные имена ────────────────────────────────────────────────── */

/* Склеенные модули живут в одной области видимости, поэтому у каждой
   привязки верхнего уровня должно быть своё имя на весь артефакт.

     объявление         сохраняет имя, если оно ещё не занято другим
                        модулем; иначе получает `имя$2` (M1b: переименование
                        затрагивает ровно эту привязку, не одноимённые
                        переменные во вложенных функциях)
     относительный      становится именем того, что импортирует: ссылки
     импорт             в теле переименовываются прямо в имя источника,
                        и промежуточные `const b = a` не нужны
     импорт node:*      один на (модуль, имя) во всём дереве

   Возвращает модули, уже разобранные по переименованному тексту, и
   список встроенных импортов. */
function unifyNames(order, root, keepTypes = false) {
  const all = new Map();                   // rel → { src, scope, mod }
  const everyName = new Set();             // все имена всех модулей: свежее с ними не совпадёт
  const globalUsers = new Map();           // глобальное имя → модули, которые на него ссылаются
  for (const rel of order) {
    const src = readSource(resolve(root, rel), { keepTypes });
    let ast;
    try { ast = parse(src, { ts: keepTypes && isTypeScript(rel) }); }
    catch (e) { throw new LinkError(`${rel}: не разбирается — ${e.message}`); }
    const scope = analyze(ast);
    for (const n of scope.names) everyName.add(n);
    for (const n of scope.globals.keys()) {
      if (!globalUsers.has(n)) globalUsers.set(n, new Set());
      globalUsers.get(n).add(rel);
    }
    all.set(rel, { src, scope, mod: readModule(rel, root, src, keepTypes) });
  }

  /* Имя верхнего уровня для привязки модуля rel. Занято, если его уже
     взял другой модуль или если другой модуль ссылается на такое же
     глобальное имя: объявление затенило бы глобальное и для него. */
  const taken = new Set();
  const claim = (base, rel) => {
    const busy = name => taken.has(name) ||
      [...(globalUsers.get(name) ?? [])].some(r => r !== rel) ||
      (name !== base && everyName.has(name));
    let name = base;
    for (let n = 2; busy(name); n++) name = `${base}$${n}`;
    taken.add(name);
    return name;
  };

  const finalNames = new Map();            // rel → Map<Binding, имя>
  const finalOf = (rel, local) => {
    const b = all.get(rel).scope.root.bindings.get(local);
    return (b && finalNames.get(rel).get(b)) ?? local;
  };
  const builtinByKey = new Map();          // spec\0imported → имя
  const builtins = [];

  for (const rel of order) {
    const { scope, mod } = all.get(rel);
    const abs = resolve(root, rel);
    const names = new Map();
    finalNames.set(rel, names);
    const rootBindings = scope.root.bindings;

    for (const imp of mod.imports) {
      const bind = local => {
        const b = rootBindings.get(local);
        if (b.ids.length > 1) throw new LinkError(`${rel}: имя ${local} объявлено дважды — импортом и объявлением`);
        return b;
      };

      if (classifySpec(imp.spec) === 'builtin') {
        const specs = [
          ...(imp.def ? [['default', imp.def]] : []),
          ...(imp.ns ? [['*', imp.ns]] : []),
          ...imp.names.map(n => [n.imported, n.local]),
        ];
        for (const [imported, local] of specs) {
          const key = imp.spec + '\0' + imported;
          if (!builtinByKey.has(key)) {
            const name = claim(local, rel);
            builtinByKey.set(key, name);
            builtins.push({ spec: imp.spec, imported, name });
          }
          names.set(bind(local), builtinByKey.get(key));
        }
        continue;
      }

      const childRel = posix.normalize(toPosix(relative(root, resolve(dirname(abs), imp.spec))));
      const child = all.get(childRel).mod;
      if (imp.ns) throw new LinkError(`${rel}: \`import * as\` линкером не поддерживается`);
      if (imp.def) {
        if (!child.def) throw new LinkError(`${rel}: у ${childRel} нет default-экспорта`);
        names.set(bind(imp.def), finalOf(childRel, child.def));
      }
      for (const { imported, local } of imp.names) {
        const src = child.named.get(imported);
        if (!src) throw new LinkError(`${rel}: ${childRel} не экспортирует ${imported}`);
        names.set(bind(local), finalOf(childRel, src));
      }
    }

    /* объявления верхнего уровня — включая var из блоков: он тоже
       модульный */
    for (const b of rootBindings.values())
      if (b.kind !== 'import') names.set(b, claim(b.name, rel));
  }

  /* переименовать и разобрать заново; экспорт — в окончательных именах */
  const mods = new Map();
  for (const rel of order) {
    const { src, scope, mod } = all.get(rel);
    const renames = new Map([...finalNames.get(rel)].filter(([b, name]) => b.name !== name));
    const text = renames.size ? applyEdits(src, renameEdits(scope, renames)) : src;
    const m = renames.size ? readModule(rel, root, text, keepTypes) : mod;
    m.named = new Map([...mod.named].map(([exported, local]) => [exported, finalOf(rel, local)]));
    m.def = mod.def ? finalOf(rel, mod.def) : null;

    /* ре-экспорт — имя соседа: своей привязки у модуля нет, поэтому
       карта экспортов достраивается по уже собранным соседям (зависимости
       в order идут раньше) */
    for (const rx of mod.reexports) {
      if (classifySpec(rx.spec) !== 'relative')
        throw new LinkError(`${rel}: ре-экспорт из '${rx.spec}' — только из относительных модулей`);
      const childRel = posix.normalize(toPosix(relative(root, resolve(dirname(resolve(root, rel)), rx.spec))));
      const child = mods.get(childRel);
      if (!child) throw new LinkError(`${rel}: ре-экспорт из ${childRel} вне дерева`);
      if (rx.all) {
        for (const [exported, local] of child.named) {
          if (m.named.has(exported) && m.named.get(exported) !== local)
            throw new LinkError(`${rel}: \`export *\` даёт два разных ${exported}`);
          m.named.set(exported, local);
        }
        continue;
      }
      for (const { from, to } of rx.names) {
        const local = from === 'default' ? child.def : child.named.get(from);
        if (!local) throw new LinkError(`${rel}: ${childRel} не экспортирует ${from}`);
        if (to === 'default') m.def = local;
        else m.named.set(to, local);
      }
    }
    mods.set(rel, m);
  }
  return { mods, builtins };
}

export { LinkError };
