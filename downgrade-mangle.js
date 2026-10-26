/* ══════════════════════════════════════════════════════════════════════════
   mangle.js — короткие имена для `.min`

   Минификатор (minify.js) работает по токенам и имён не трогает: его
   результат — ещё и `codeHash`, а хеш обязан меняться от правки кода,
   в том числе от переименования переменной. Сокращение имён — отдельный
   шаг, и делается он только для `.min`-артефакта, поверх разбора и
   областей видимости.

   Что сокращается: параметры, локальные переменные, `catch`-параметры,
   имена импортов — всё, у чего имя видно только самому файлу. Файл с
   прямым `eval(…)` не трогается совсем: тот видит локальные имена по
   буквам, и сокращать их нельзя.

   Что НЕ сокращается (§12 п. 21):

     · **имена функций и классов** — объявленных, именованных выражений и
       тех переменных, которым имя даёт присваивание (`const f = () => {}`
       делает `f.name === 'f'`). `.name` и `.constructor.name` — часть
       поведения кода, и полагаться на них можно;
     · имена свойств: они не привязки, а ключи;
     · глобальные имена: их объявляет не этот файл;
     · экспортируемые имена: локальное имя под ними меняется, а
       экспортируемое остаётся (`export { a as adler32 }`).

   Как выбираются имена. Две привязки конфликтуют, если общее имя у них
   что-нибудь поймает: они в одной области; или между ссылкой на одну и её
   объявлением объявлена другая. Конфликты — граф, имена раздаются жадно,
   от самых частых привязок к редким, поэтому самое короткое достаётся
   тому, кто чаще встречается.

   Проверка (как и у минификатора — своя, обязательная): в переименованном
   тексте заново считаются области видимости, и последовательность
   объявлений и ссылок в порядке текста обязана совпасть с исходной —
   ссылка за ссылкой, привязка за привязкой. Не совпало — значит имя
   кого-то поймало, и лучше упасть, чем положить на диск другую программу.
   ══════════════════════════════════════════════════════════════════════════ */

import { parse } from './downgrade-parse.js';
import { walk } from './downgrade-walk.js';
import { analyze, renameEdits, applyEdits } from './downgrade-scope.js';

/* занимать нельзя: ключевые слова, литералы и имена, которые в строгом
   режиме объявлять запрещено */
const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with',
  'let', 'static', 'yield', 'await', 'implements', 'interface', 'package', 'private',
  'protected', 'public', 'arguments', 'eval', 'undefined', 'NaN', 'Infinity',
]);

const HEAD = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$';
const TAIL = HEAD + '0123456789';

/* n-е допустимое имя: a … $, aa … $$, aaa … */
export function nameAt(n) {
  let out = HEAD[n % HEAD.length];
  n = Math.floor(n / HEAD.length);
  while (n > 0) {
    n--;
    out += TAIL[n % TAIL.length];
    n = Math.floor(n / TAIL.length);
  }
  return out;
}

/* привязки, чьё имя — часть поведения: функции, классы и то, чему имя
   даёт присваивание */
function keepNames(ast, info) {
  const keep = new Set();
  const named = node => node && (node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression' || node.type === 'ClassExpression') && !node.id;
  const byId = id => { const b = info.bindingOf(id); if (b) keep.add(b); };

  for (const b of allBindings(info)) if (b.kind === 'function' || b.kind === 'class' ||
    b.kind === 'fname' || b.kind === 'arguments') keep.add(b);

  walk(ast, {
    enter(n) {
      if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && named(n.init)) byId(n.id);
      if (n.type === 'AssignmentExpression' && n.operator === '=' &&
          n.left.type === 'Identifier' && named(n.right)) byId(n.left);
    },
  });
  return keep;
}

function allBindings(info) {
  const out = [];
  (function down(s) {
    for (const b of s.bindings.values()) out.push(b);
    if (s.argumentsBinding) out.push(s.argumentsBinding);
    for (const c of s.children) down(c);
  })(info.root);
  return out;
}

/* `eval(…)` по имени, а не `window.eval` и не своя функция eval */
function hasDirectEval(ast, info) {
  let hit = false;
  walk(ast, {
    enter(n) {
      if (hit || n.type !== 'CallExpression') return;
      if (n.callee.type === 'Identifier' && n.callee.name === 'eval' &&
          !info.refs.get(n.callee)?.binding) hit = true;
    },
  });
  return hit;
}

/* область, в которой стоит идентификатор */
const scopeOfId = (info, id) => info.refs.get(id)?.scope ?? info.scopeAt(id.start);

/* Сократить локальные имена. Возвращает { code, renamed } — renamed
   это сколько привязок переименовано. */
export function mangle(src, { verify = true } = {}) {
  const ast = parse(src);
  const info = analyze(ast);
  /* прямой eval видит локальные имена по буквам — такой файл не трогаем */
  if (hasDirectEval(ast, info)) return { code: src, renamed: 0, skipped: true };
  const keep = keepNames(ast, info);
  const bindings = allBindings(info);

  /* глобальные имена файла занимать нельзя нигде: переименованная
     привязка накрыла бы ссылку на глобальное имя изнутри */
  const busy = new Set([...RESERVED, ...info.globals.keys()]);

  const conflicts = new Map(bindings.map(b => [b, new Set()]));
  const link = (a, b) => { if (a !== b) { conflicts.get(a)?.add(b); conflicts.get(b)?.add(a); } };

  /* одна область — одно имя */
  (function down(s) {
    const own = [...s.bindings.values()];
    for (let i = 0; i < own.length; i++)
      for (let k = i + 1; k < own.length; k++) link(own[i], own[k]);
    for (const c of s.children) down(c);
  })(info.root);

  /* между идентификатором и его привязкой не должно встать чужое имя */
  for (const b of bindings)
    for (const id of [...b.ids, ...b.refs])
      for (let s = scopeOfId(info, id); s && s !== b.scope; s = s.parent)
        for (const other of s.bindings.values()) link(b, other);

  /* имена: сначала тем, кто встречается чаще */
  const weight = b => b.ids.length + b.refs.length;
  const order = bindings.filter(b => !keep.has(b)).sort((a, b) => weight(b) - weight(a) ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const final = new Map();
  for (const b of bindings) if (keep.has(b)) final.set(b, b.name);

  const renames = new Map();
  for (const b of order) {
    const taken = new Set(busy);
    for (const other of conflicts.get(b)) {
      const name = final.get(other);
      if (name !== undefined) taken.add(name);
    }
    let name, i = 0;
    do { name = nameAt(i++); } while (taken.has(name));
    final.set(b, name);
    if (name !== b.name) renames.set(b, name);
  }

  const code = applyEdits(src, renameEdits(info, renames));
  if (verify) check(src, code);
  return { code, renamed: renames.size };
}

/* ── проверка ───────────────────────────────────────────────────────────── */

/* Строение имён файла: объявления и ссылки в порядке текста, привязки
   пронумерованы по первому появлению. Сравнимо у исходного и
   переименованного текста — имена разные, строение обязано совпасть. */
function shape(src) {
  const ast = parse(src);
  const info = analyze(ast);
  const index = new Map();
  const idx = b => { if (!index.has(b)) index.set(b, index.size); return index.get(b); };
  const out = [];
  /* сокращённая запись (`{ a }`, `export { a }`) — один узел в двух ролях:
     обходчик приходит к нему дважды, считать его надо один раз */
  const seen = new Set();
  walk(ast, {
    enter(n) {
      if (n.type !== 'Identifier' || seen.has(n)) return;
      seen.add(n);
      if (info.declared.has(n)) out.push('d' + idx(info.declared.get(n)));
      else if (info.refs.has(n)) {
        const b = info.refs.get(n).binding;
        out.push(b ? 'r' + idx(b) : 'g:' + n.name);
      }
    },
  });
  return out;
}

function check(before, after) {
  const a = shape(before), b = shape(after);
  if (a.length !== b.length)
    throw new Error(`mangle: было ${a.length} имён, стало ${b.length}`);
  for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i])
      throw new Error(`mangle: имя ${i} сменило привязку: ${a[i]} → ${b[i]}`);
}
