/* ══════════════════════════════════════════════════════════════════════════
   typescript.js — типы поверх парсера (M5)

   Инструменту не нужно понимать, что тип значит: ему нужно знать, **где
   тип лежит**. Из этого получается и то, и другое:

     JS-цели   — диапазоны типов вырезаются (проход strip-types), дальше
                 файл идёт как обычный JS;
     `@ts`-цели — диапазоны остаются на месте, понижается только код.

   Поэтому здесь не дерево типов, а разметка: каждая найденная запись
   кладётся в `ast.tsRanges` парой [начало, конец). Разбор типа устроен
   как скобочный: у составных форм (`(…)`, `{…}`, `[…]`, `<…>`) конец
   ищется по парной скобке, а разделители (`|`, `&`, `=>`, условный
   `extends ? :`) просто продолжают запись.

   `>>` — отдельная морока: токенизатор склеивает его в один сдвиг, а в
   типе это две закрывающие скобки. Там, где уже ясно, что перед нами
   тип, такой токен разрезается надвое; в выражении (`f<T>(x)` против
   `a >> b`) — не режется, и аргументы типа принимаются только с чистым
   `>`, так что сдвиг остаётся сдвигом.

   **Только erasable TS** (§4.4). `enum`, `namespace`, `module X {}` и
   параметры-свойства конструктора оставляют после себя код, а не только
   типы, — на них разбор честно падает с объяснением, потому что артефакт
   с ними не прошёл бы ни `node --strip-types`, ни `tsc
   --erasableSyntaxOnly`.
   ══════════════════════════════════════════════════════════════════════════ */

/* Слова, которые в TS значат что-то только перед членом класса. */
export const MEMBER_MODIFIERS = new Set([
  'public', 'private', 'protected', 'readonly', 'abstract', 'override', 'declare',
]);

const NOT_ERASABLE = {
  enum: '`enum` оставляет после себя объект, а не только тип',
  namespace: '`namespace` оставляет после себя объект, а не только тип',
  module: '`module X {}` оставляет после себя объект, а не только тип',
};

/* ── скобки ─────────────────────────────────────────────────────────────── */

/* съесть от текущей открывающей скобки до парной */
function skipBalanced(p) {
  const j = p.matching(p.i);
  if (j < 0) p.fail('незакрытая скобка в типе');
  p.i = j + 1;
}

/* Найти закрывающий `>` для `<` на позиции from, не трогая поток.
   Возвращает { at, clean }: индекс токена и то, закрывается ли он целым
   `>` (а не куском `>>`). */
function scanAngles(p, from) {
  let depth = 0;
  for (let j = from; j < p.toks.length; j++) {
    const t = p.toks[j];
    if (t.t !== 'punct') continue;
    if (t.v === '<') { depth++; continue; }
    if (t.v === '(' || t.v === '[' || t.v === '{') {
      const inner = p.matching(j);
      if (inner < 0) return null;
      j = inner;
      continue;
    }
    if (t.v === ')' || t.v === ']' || t.v === '}' || t.v === ';') return null;
    if (t.v[0] === '>') {
      const closes = /^>+/.exec(t.v)[0].length;
      if (closes < depth) { depth -= closes; continue; }
      return { at: j, clean: closes === depth && t.v.length === closes };
    }
  }
  return null;
}

/* Разрезать `>>` на два токена: в типе это две закрывающие скобки. */
function splitAngle(p, j) {
  const t = p.toks[j];
  if (t.v === '>') return;
  p.toks.splice(j, 1,
    { t: 'punct', v: '>', s: t.s, e: t.s + 1, nl: t.nl },
    { t: 'punct', v: t.v.slice(1), s: t.s + 1, e: t.e, nl: false });
}

/* съесть `<…>` целиком (внутри типа — уже можно резать `>>`) */
function skipAngles(p) {
  let depth = 0;
  for (;;) {
    const t = p.cur;
    if (!t) p.fail('незакрытые угловые скобки в типе');
    if (t.t === 'punct' && t.v === '<') { depth++; p.next(); continue; }
    if (t.t === 'punct' && (t.v === '(' || t.v === '[' || t.v === '{')) { skipBalanced(p); continue; }
    if (t.t === 'punct' && t.v[0] === '>') {
      splitAngle(p, p.i);
      p.next();
      if (--depth === 0) return;
      continue;
    }
    p.next();
  }
}

/* ── типы ───────────────────────────────────────────────────────────────── */

const PREFIX = new Set(['keyof', 'typeof', 'infer', 'readonly', 'unique', 'new', 'abstract', 'asserts']);

function typeAtom(p) {
  while (p.cur && p.cur.t === 'name' && PREFIX.has(p.cur.v)) p.next();
  if (p.is('|') || p.is('&')) { p.next(); return typeAtom(p); }
  const t = p.cur;
  if (!t) p.fail('тип оборвался');
  if (t.t === 'punct' && (t.v === '(' || t.v === '[' || t.v === '{')) skipBalanced(p);
  else if (t.t === 'name' || t.t === 'str' || t.t === 'num' || t.t === 'template') {
    p.next();
    for (;;) {
      if (p.is('.')) { p.next(); p.next(); continue; }
      if (p.is('<')) { skipAngles(p); continue; }
      break;
    }
  } else p.fail(`не похоже на тип: ${t.v}`);

  /* постфиксы: A[], A[K], A! */
  for (;;) {
    if (p.is('[')) { skipBalanced(p); continue; }
    if (p.is('!')) { p.next(); continue; }
    break;
  }
}

/* Тип целиком. noArrow — не забирать `=>`: у стрелки с объявленным
   результатом (`(a): T => a`) стрелка принадлежит выражению, а не типу. */
export function skipType(p, { noArrow = false } = {}) {
  typeAtom(p);
  for (;;) {
    if (p.is('|') || p.is('&')) { p.next(); typeAtom(p); continue; }
    if (p.is('=>') && !noArrow) { p.next(); skipType(p); continue; }
    if (p.is('extends')) {
      p.next();
      skipType(p, { noArrow });
      if (!p.eat('?')) break;
      skipType(p);
      p.expect(':');
      skipType(p, { noArrow });
      continue;
    }
    if (p.is('is')) { p.next(); skipType(p, { noArrow }); continue; }   // предикат типа
    break;
  }
}

/* записать диапазон как тип */
function mark(p, start) {
  const end = p.prevEnd();
  if (end > start) p.tsRanges.push([start, end]);
}

/* `: Тип` после параметра, переменной, функции */
export function annotation(p, opts) {
  if (!p.ts || !p.is(':')) return;
  const start = p.pos;
  p.next();
  skipType(p, opts);
  mark(p, start);
}

/* `<T, U extends V>` — параметры типа */
export function typeParams(p) {
  if (!p.ts || !p.is('<')) return;
  const start = p.pos;
  skipAngles(p);
  mark(p, start);
}

/* `<T>` в вызове: только если дальше скобка — иначе это сравнение */
export function callTypeArgs(p) {
  if (!p.ts || !p.is('<')) return false;
  const found = scanAngles(p, p.i);
  if (!found || !found.clean) return false;
  const after = p.toks[found.at + 1];
  if (!after || !(after.t === 'punct' && after.v === '(') && after.t !== 'template') return false;
  const start = p.pos;
  p.i = found.at + 1;
  mark(p, start);
  return true;
}

/* `?` у необязательного параметра или свойства, `!` у обязательного поля */
export function optionalMark(p) {
  if (!p.ts) return;
  if (p.is('?') || p.is('!')) {
    const start = p.pos;
    p.next();
    mark(p, start);
  }
}

/* `expr as T`, `expr satisfies T`, `expr!` — хвосты выражения */
export function expressionTail(p, node) {
  if (!p.ts) return node;
  for (;;) {
    if (p.is('!') && !p.cur.nl) { const start = p.pos; p.next(); mark(p, start); node.end = p.prevEnd(); continue; }
    if ((p.is('as') || p.is('satisfies')) && !p.cur.nl) {
      const start = p.pos;
      p.next();
      if (p.is('const')) p.next();
      else skipType(p, { noArrow: true });
      mark(p, start);
      node.end = start;                 /* сам узел кончается там, где начался тип */
      continue;
    }
    return node;
  }
}

/* `public`, `readonly`, `abstract` … перед членом класса */
export function memberModifiers(p) {
  if (!p.ts) return;
  for (;;) {
    const t = p.cur;
    if (!t || t.t !== 'name' || !MEMBER_MODIFIERS.has(t.v)) return;
    const next = p.peek(1);
    if (!next) return;
    /* модификатор — только если дальше и правда член, а не `=`, `(` или `:`
       (иначе это поле с таким именем: `readonly = 1`) */
    const member = next.t === 'name' || next.t === 'priv' || next.t === 'str' || next.t === 'num' ||
      (next.t === 'punct' && (next.v === '[' || next.v === '*'));
    if (!member) return;
    const start = p.pos;
    p.next();
    mark(p, start);
  }
}

/* `[key: string]: Тип;` — индексная подпись, кода за ней нет */
export function indexSignature(p) {
  if (!p.ts || !p.is('[')) return null;
  const a = p.peek(1), b = p.peek(2);
  if (!a || a.t !== 'name' || !b || !(b.t === 'punct' && b.v === ':')) return null;
  const start = p.pos;
  skipBalanced(p);
  if (p.is(':')) { p.next(); skipType(p); }
  p.eat(';');
  return erased(p, start);
}

/* `implements A, B` у класса */
export function heritage(p) {
  if (!p.ts || !p.is('implements')) return;
  const start = p.pos;
  p.next();
  do { skipType(p, { noArrow: true }); } while (p.eat(','));
  mark(p, start);
}

/* ── операторы, которых в JS нет вовсе ──────────────────────────────────── */

/* Целиком типовой оператор: interface, type, declare, enum (отказ).
   Возвращает узел-пустышку или null, если это не наш случай. */
export function typeStatement(p) {
  if (!p.ts || !p.cur || p.cur.t !== 'name') return null;
  const word = p.cur.v;
  const start = p.pos;

  if (NOT_ERASABLE[word] && p.isName(1)) p.fail(`${NOT_ERASABLE[word]} — в этом репозитории TS только erasable (§4.4)`);

  if (word === 'interface' && p.isName(1)) {
    p.next();
    p.next();                                   /* имя */
    if (p.is('<')) skipAngles(p);
    if (p.is('extends')) { p.next(); do { skipType(p, { noArrow: true }); } while (p.eat(',')); }
    if (!p.is('{')) p.fail('у интерфейса должно быть тело');
    skipBalanced(p);
    return erased(p, start);
  }

  if (word === 'type' && p.isName(1) && !p.peek(1).nl) {
    /* `type X = …`, но не `type` как обычное имя: `type = 5` */
    const eq = p.is('=', 2) || p.is('<', 2);
    if (!eq) return null;
    p.next();
    p.next();
    if (p.is('<')) skipAngles(p);
    p.expect('=');
    skipType(p);
    p.eat(';');
    return erased(p, start);
  }

  if (word === 'declare') {
    p.next();
    skipDeclaration(p);
    return erased(p, start);
  }

  if (word === 'abstract' && p.is('class', 1)) {
    const mod = p.pos;
    p.next();
    mark(p, mod);
    return undefined;                            /* дальше — обычный класс */
  }

  return null;
}

/* тело `declare …`: до конца оператора, блок — целиком */
function skipDeclaration(p) {
  for (;;) {
    const t = p.cur;
    if (!t) return;
    if (t.t === 'punct' && (t.v === '{' || t.v === '(' || t.v === '[')) { skipBalanced(p); continue; }
    if (t.t === 'punct' && t.v === ';') { p.next(); return; }
    if (t.nl && p.i > 0) return;                 /* перевод строки закрывает объявление */
    p.next();
  }
}

/* подпись без тела (перегрузка, declare-член): кода за ней нет */
export function erasedStatement(p, start) {
  return erased(p, start);
}

/* Сохранить и откатить разметку: у разбора со стрелками бывают попытки,
   после которых поток отматывается назад — вместе с ним должны отматываться
   и записанные диапазоны, иначе вырежется кусок живого кода. */
export const markPoint = p => p.tsRanges.length;
export const rollback = (p, point) => { p.tsRanges.length = point; };

const erased = (p, start) => {
  const end = p.prevEnd();
  p.tsRanges.push([start, end]);
  return { type: 'TSTypeOnly', start, end };
};

/* `import type X from …` и `import { type A }` — уходят целиком или по
   одному имени; здесь только признак, вырезает их уже strip-types */
export function importTypeMark(p) {
  if (!p.ts || !p.is('type')) return false;
  /* `import type from './x'` — импорт имени type, а не типовой импорт */
  const next = p.peek(1);
  if (!next || (next.t === 'punct' && (next.v === ',' || next.v === '}' || next.v === 'from'))) return false;
  if (next.t === 'name' && next.v === 'from') return false;
  const start = p.pos;
  p.next();
  mark(p, start);
  return true;
};

/* `{ type A, B }` внутри import/export: имя, которое существует только в
   типах. Выкидывается вместе со своей запятой, иначе в списке останется
   дырка. */
export function typeSpecifier(p) {
  if (!p.ts || !p.is('type')) return false;
  const next = p.peek(1);
  if (!next || next.t !== 'name' || next.v === 'as') return false;
  const start = p.pos;
  p.next();
  p.next();
  if (p.is('as')) { p.next(); p.next(); }
  p.eat(',');
  p.tsRanges.push([start, p.prevEnd()]);
  return true;
}

/* `export type X = …`, `export interface …`, `export declare …`,
   `export type { A }` — экспорт того, чего в коде не будет. */
export function exportedTypeStatement(p, start) {
  if (!p.ts || !p.cur || p.cur.t !== 'name') return null;
  if (p.is('type') && p.is('{', 1)) {
    p.next();
    skipBalanced(p);
    if (p.eat('from')) p.next();
    p.eat(';');
    return erased(p, start);
  }
  const inner = typeStatement(p);
  if (!inner) return null;
  p.tsRanges[p.tsRanges.length - 1] = [start, p.prevEnd()];
  return { type: 'TSTypeOnly', start, end: p.prevEnd() };
}

/* `<T,>(x: T) => …` — параметры типа у стрелки. Берём только если сразу
   за ними идёт скобка: иначе это сравнение, а не объявление. */
export function arrowTypeParams(p) {
  if (!p.ts || !p.is('<')) return false;
  const found = scanAngles(p, p.i);
  if (!found || !found.clean) return false;
  const after = p.toks[found.at + 1];
  if (!after || after.t !== 'punct' || after.v !== '(') return false;
  const start = p.pos;
  skipAngles(p);
  mark(p, start);
  return true;
}

/* `export function f(a: T): U;` — подпись без тела, но `export` перед ней
   разбор уже прошёл: расширяем записанный диапазон влево, иначе от
   оператора останется голое слово `export`. */
export function widenErased(p, start) {
  const last = p.tsRanges[p.tsRanges.length - 1];
  const end = last ? last[1] : p.prevEnd();
  if (last) p.tsRanges[p.tsRanges.length - 1] = [start, end];
  else p.tsRanges.push([start, end]);
  return { type: 'TSTypeOnly', start, end };
}
