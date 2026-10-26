/* ══════════════════════════════════════════════════════════════════════════
   rewrite.js — замена текста в диапазонах узлов (gen/ из BACKLOG.md §6.7)

   Проход понижения не печатает файл заново из AST (§6.7d). Он говорит,
   какие узлы заменить и на что; всё остальное переносится байт в байт,
   вместе с комментариями и форматированием.

     rewrite(src, ast, { Тип(node, ctx) → строка | { text, prec } | undefined })

   Обработчик может вернуть новый текст узла или ничего — тогда узел
   остаётся как был, но внутрь него всё равно заглядывают: изменённые
   потомки вклеиваются в исходный текст на свои места.

   Новый текст строится из текста детей: ctx.text(child) — это ребёнок
   уже после замен внутри него. Так вложенные конструкции (`a ** (b ** c)`,
   `a?.b ?? c?.d`) обрабатываются за один обход, снизу вверх.

   Три вещи, которые делаются здесь, чтобы не повторять их в каждом проходе:

     · скобки. У замены есть приоритет (prec), у места, куда она встаёт, —
       требуемый приоритет. Не дотягивает — оборачивается в скобки. Узел,
       который в исходнике уже стоял в скобках, в них и останется: скобки
       лежат вне его диапазона и переносятся родителем;

     · ASI. Замена в начале оператора, начинающаяся с `(` или `[`, после
       оператора без точки с запятой склеилась бы с ним (`f()\n(a…)` —
       вызов). Перед такой заменой ставится `;`;

     · временные переменные. ctx.temp(node) выдаёт свежее имя и объявляет
       его `var` в ближайшей функции; у стрелки с телом-выражением тело
       превращается в блок, у инициализатора поля — в IIFE-стрелку. Имена
       верхнего уровня возвращаются вызывающему: их объявление встанет в
       runtime-блок артефакта.
   ══════════════════════════════════════════════════════════════════════════ */

import { isNode, walk } from './downgrade-walk.js';
import { analyze } from './downgrade-scope.js';

/* Понижение невозможно (unsupported) или пока не написано (pending).
   Не ошибка сборки: цель просто не собирается, причина уходит в отчёт. */
export class LowerError extends Error {
  constructor(kind, message, { feature = null, pos = null } = {}) {
    super(message);
    this.name = 'LowerError';
    this.kind = kind;            // pending | unsupported
    this.feature = feature;
    this.pos = pos;
  }
}

/* ── приоритеты ─────────────────────────────────────────────────────────── */

const BIN_PREC = {
  '??': 4, '||': 5, '&&': 6, '|': 7, '^': 8, '&': 9,
  '==': 10, '!=': 10, '===': 10, '!==': 10,
  '<': 11, '>': 11, '<=': 11, '>=': 11, in: 11, instanceof: 11,
  '<<': 12, '>>': 12, '>>>': 12, '+': 13, '-': 13, '*': 14, '/': 14, '%': 14, '**': 15,
};

export const PREC = {
  SEQUENCE: 1, ASSIGN: 2, CONDITIONAL: 3, UNARY: 16, POSTFIX: 17, CALL: 18, PRIMARY: 19,
  binary: op => BIN_PREC[op],
};

/* Приоритет выражения, каким оно стоит в исходнике. Узел в скобках —
   сильнее всего, но только на своём месте: скобки лежат вне его
   диапазона. Тот, кто переносит текст узла в другое место, берёт
   приоритет без скобок (bare) — иначе `x = (a, b)` уехало бы в аргумент
   вызова как два аргумента. */
export function precOf(node, bare = false) {
  if (node.parenthesized && !bare) return 20;
  switch (node.type) {
    case 'SequenceExpression': return 1;
    case 'AssignmentExpression': case 'ArrowFunctionExpression': case 'YieldExpression': return 2;
    case 'ConditionalExpression': return 3;
    case 'LogicalExpression': case 'BinaryExpression': return BIN_PREC[node.operator];
    case 'UnaryExpression': case 'AwaitExpression': return 16;
    case 'UpdateExpression': return node.prefix ? 16 : 17;
    case 'CallExpression': case 'MemberExpression': case 'NewExpression':
    case 'TaggedTemplateExpression': case 'ChainExpression': case 'ImportExpression':
      return 18;
    default: return 19;
  }
}

/* узлы-выражения: только их замену может понадобиться взять в скобки;
   оператор, декларатор, член класса, свойство, паттерн — не выражения */
const EXPRESSIONS = new Set(['Identifier', 'Literal', 'ThisExpression', 'ArrayExpression',
  'ObjectExpression', 'FunctionExpression', 'ArrowFunctionExpression', 'ClassExpression',
  'TemplateLiteral', 'TaggedTemplateExpression', 'MemberExpression', 'CallExpression',
  'NewExpression', 'UpdateExpression', 'UnaryExpression', 'BinaryExpression',
  'LogicalExpression', 'ConditionalExpression', 'AssignmentExpression', 'SequenceExpression',
  'YieldExpression', 'AwaitExpression', 'ChainExpression', 'ImportExpression', 'MetaProperty']);

/* Какой приоритет должна иметь замена, чтобы встать на место ребёнка key
   узла parent без скобок. 0 — годится что угодно. */
function requiredPrec(parent, key, child) {
  if (!EXPRESSIONS.has(child.type)) return 0;
  /* ключ свойства и имя в паттерне — не места для выражений */
  if ((parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') &&
      key === 'key' && !parent.computed) return 0;
  switch (parent.type) {
    case 'BinaryExpression': case 'LogicalExpression': {
      const p = BIN_PREC[parent.operator];
      if (parent.operator === '**') return key === 'left' ? 17 : 15;
      /* `??` нельзя смешивать с || и && без скобок — в любую сторону */
      if (parent.operator === '??') return 7;
      if ((parent.operator === '||' || parent.operator === '&&')) return key === 'left' ? Math.max(p, 5) : p + 1;
      return key === 'left' ? p : p + 1;
    }
    case 'UnaryExpression': case 'AwaitExpression': return 16;
    case 'UpdateExpression': return 18;
    case 'MemberExpression': return key === 'object' ? 18 : 1;
    case 'CallExpression': return key === 'callee' ? 18 : 2;
    case 'NewExpression': return key === 'callee' ? 19 : 2;
    case 'TaggedTemplateExpression': return key === 'tag' ? 18 : 0;
    case 'ConditionalExpression': return key === 'test' ? 4 : 2;
    case 'AssignmentExpression': return key === 'left' ? 18 : 2;
    case 'TemplateLiteral': return 1;
    case 'ExpressionStatement': case 'ReturnStatement': case 'ThrowStatement':
    case 'IfStatement': case 'WhileStatement': case 'DoWhileStatement': case 'ForStatement':
    case 'ForInStatement': case 'ForOfStatement': case 'SwitchStatement': case 'SwitchCase':
    case 'ChainExpression':
      return 1;
    default: return 2;
  }
}

/* текст, который нельзя ставить в начало оператора или тела стрелки */
function hazard(parent, key, text) {
  if (parent.type === 'ExpressionStatement')
    return /^(\{|function\b|async\s+function\b|class\b|let\s*\[)/.test(text);
  /* only an expression body: a block body `=> { … }` rewritten inside
     stays a block, wrapping it would turn it into an object literal */
  if (parent.type === 'ArrowFunctionExpression' && key === 'body')
    return parent.body.type !== 'BlockStatement' && text.startsWith('{');
  if (parent.type === 'ExportDefaultDeclaration') return /^(function\b|async\s+function\b|class\b)/.test(text);
  return false;
}

/* начало оператора, склеивающееся с предыдущим без `;` */
const asiHazard = text => /^[([`+\-/]/.test(text);

/* оператор, после которого новый оператор начинается наверняка */
const ENDS_WITH_BLOCK = new Set(['FunctionDeclaration', 'ClassDeclaration', 'BlockStatement']);

const LISTS = new Set(['Program', 'BlockStatement', 'SwitchCase', 'StaticBlock']);

/* ── дети узла в порядке текста ─────────────────────────────────────────── */

const SKIP = new Set(['type', 'start', 'end', 'raw', 'regex', 'bigint', 'value_', 'parenthesized']);

function childrenOf(node) {
  const out = [];
  for (const key of Object.keys(node)) {
    if (SKIP.has(key)) continue;
    const v = node[key];
    if (Array.isArray(v)) { for (const x of v) if (isNode(x)) out.push({ child: x, key }); }
    else if (isNode(v)) out.push({ child: v, key });
  }
  /* по началу, при равенстве — длинный раньше: у `{ a = 1 }` ключ `a` и
     значение `a = 1` начинаются вместе, и ключ лежит внутри значения */
  out.sort((a, b) => a.child.start - b.child.start || b.child.end - a.child.end);
  const res = [];
  let lastEnd = -1;
  for (const e of out) {
    if (e.child.start < lastEnd) continue;          // тот же или вложенный узел
    res.push(e);
    lastEnd = e.child.end;
  }
  return res;
}

/* ── обход ──────────────────────────────────────────────────────────────── */

export function rewrite(src, ast, visitors, { scope = null, session = null } = {}) {
  const info = scope ?? analyze(ast);
  const parents = new Map();
  walk(ast, { enter(n, p, k) { parents.set(n, { parent: p, key: k }); } });

  const memo = new Map();
  const temps = new Map();                 // функция → [имена]
  const prologues = new Map();             // функция → [операторы в начало тела]
  const programTemps = [];
  const programPrologues = [];

  const raw = n => src.slice(n.start, n.end);

  function render(node) {
    if (memo.has(node)) return memo.get(node);
    let r = null;
    const h = visitors[node.type];
    if (h) {
      const out = h(node, ctx);
      if (out !== undefined && out !== null)
        r = typeof out === 'string' ? { text: out, prec: 0 } : out;
    }
    if (!r) r = splice(node);
    r = withTemps(node, r);
    memo.set(node, r);
    return r;
  }

  /* исходный текст узла с вклеенными изменёнными детьми и доп. правками */
  function splice(node, extra = []) {
    const kids = childrenOf(node);
    const list = LISTS.has(node.type);
    let out = null, pos = node.start, prev = null, prevText = null;

    const edits = [];
    for (const k of kids) edits.push({ ...k, start: k.child.start, end: k.child.end });
    for (const e of extra) edits.push({ ...e, extra: true });
    edits.sort((a, b) => a.start - b.start);

    for (const e of edits) {
      if (e.extra) {
        out = (out ?? '') + src.slice(pos, e.start) + e.text;
        pos = e.end;
        continue;
      }
      const { child, key } = e;
      const r = render(child);
      let text = r ? r.text : null;
      if (r) {
        if (!child.parenthesized && (r.prec < requiredPrec(node, key, child) || hazard(node, key, text)))
          text = `(${text})`;
        if (list && prev && child.type === 'ExpressionStatement' && asiHazard(text) &&
            !asiHazard(raw(child)) && !prevText.trimEnd().endsWith(';') && !ENDS_WITH_BLOCK.has(prev.type))
          text = ';' + text;
        let gap = src.slice(pos, child.start);
        /* удалённый член или оператор, стоявший на своей строке, уходит
           вместе с отступом и переводом строки — без пустой «дырки» */
        if (text === '') {
          const m = /\r?\n[ \t]*$/.exec(gap);
          if (m && /^[ \t]*(\r?\n|$)/.test(src.slice(child.end))) gap = gap.slice(0, m.index);
          else gap = gap.replace(/[ \t]+$/, '');
        }
        out = (out ?? '') + gap + text;
        pos = child.end;
      }
      prev = child;
      prevText = text ?? raw(child);
    }
    return out === null ? null : { text: out + src.slice(pos, node.end), prec: precOf(node, true) };
  }

  /* ── временные переменные ── */

  function fnNodeFor(node) {
    let s = info.scopeAt(node.start).fn;
    /* выражения в параметрах вычисляются до тела: var из тела им не виден,
       поэтому временная переменная уходит во внешнюю функцию */
    while (s.node.params && s.node.params.some(p => p.start <= node.start && node.end <= p.end))
      s = s.parent.fn;
    return s.node;
  }

  function declare(names) { return 'var ' + names.join(', ') + ';'; }

  const intoBlock = (blockText, names) => prependToBlock(blockText, declare(names));

  const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

  function withTemps(node, r) {
    /* Тело-блок функции объявляет её временные переменные само: тогда
       текст тела один и тот же, кто бы его ни взял — сама функция при
       склейке или проход, который собирает функцию заново из частей. */
    if (node.type === 'BlockStatement') {
      const fn = parents.get(node)?.parent;
      if (!fn || !FUNCTIONS.has(fn.type) || parents.get(node).key !== 'body') return r;
      const names = temps.get(fn) ?? [];
      const head = prologues.get(fn) ?? [];
      if (!names.length && !head.length) return r;
      temps.delete(fn);
      prologues.delete(fn);
      const stmts = [...(names.length ? [declare(names)] : []), ...head].join(' ');
      return { text: prependToBlock(r ? r.text : raw(node), stmts), prec: 0 };
    }

    const names = temps.get(node) ?? [];
    const head = prologues.get(node) ?? [];
    if (!names.length && !head.length) return r;
    temps.delete(node);
    prologues.delete(node);
    const text = r ? r.text : raw(node);

    if (node.type === 'Program') { programTemps.push(...names); programPrologues.push(...head); return r; }

    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' ||
        (node.type === 'ArrowFunctionExpression' && !node.expression))
      throw new Error(`rewrite: временные переменные заведены для ${node.type} уже после того, как отрисовано её тело`);
    if (node.type === 'ArrowFunctionExpression') {
      /* тело-выражение может стоять в скобках (`() => ({ a })`), поэтому
         голова собирается заново: параметры + всё до `=>` включительно */
      let pos = node.params.length ? node.params.at(-1).end : node.start;
      for (;;) {
        pos = skipTrivia(src, pos);
        if (src.startsWith('=>', pos)) break;
        pos++;
      }
      let head = '', at = node.start;
      for (const p of node.params) { head += src.slice(at, p.start) + ctx.text(p); at = p.end; }
      head += src.slice(at, pos + 2);
      return { text: `${head} { ${declare(names)} return ${ctx.text(node.body)}; }`, prec: 2 };
    }
    if (node.type === 'StaticBlock') {
      const i = text.indexOf('{');
      return { text: text.slice(0, i) + intoBlock(text.slice(i), names), prec: 0 };
    }
    if (node.type === 'PropertyDefinition') {
      const v = render(node.value);
      const vText = v ? v.text : raw(node.value);
      const at = text.lastIndexOf(vText);
      return {
        text: text.slice(0, at) + `(() => { ${declare(names)} return ${vText}; })()` + text.slice(at + vText.length),
        prec: 0,
      };
    }
    throw new Error(`rewrite: временные переменные для ${node.type} некуда объявить`);
  }

  const ctx = {
    src, scope: info, session,
    parentOf: n => parents.get(n)?.parent ?? null,
    keyOf: n => parents.get(n)?.key ?? null,
    raw,
    render,

    /* текст узла после замен внутри него */
    text(n) { const r = render(n); return r ? r.text : raw(n); },

    /* то же, но в скобках, если по приоритету не встаёт на место с required */
    expr(n, required = PREC.ASSIGN) {
      const r = render(n);
      const text = r ? r.text : raw(n);
      const prec = r ? r.prec : precOf(n, true);
      return prec < required ? `(${text})` : text;
    },

    /* узел с доп. правками по исходным позициям (не пересекающимися с детьми) */
    splice(n, extra) { return splice(n, extra) ?? { text: raw(n), prec: precOf(n, true) }; },

    /* новое имя для временной переменной, объявленное в ближайшей функции */
    temp(n, base = 'ref') {
      const name = info.fresh(base);
      ctx.addTemps(n, [name]);
      return name;
    },

    /* объявить имена в функции, ближайшей к узлу n */
    addTemps(n, names) {
      if (!names.length) return;
      const fn = fnNodeFor(n);
      if (!temps.has(fn)) temps.set(fn, []);
      temps.get(fn).push(...names);
    },

    /* Забрать временные переменные, заведённые для узла-функции fn, чтобы
       объявить их самому: так делает проход, который переносит тело
       (инициализатор поля — в конструктор, static-блок — в функцию). */
    takeTemps(fn) {
      const names = temps.get(fn) ?? [];
      temps.delete(fn);
      return names;
    },

    /* Оператор в начало тела функции: так стрелка отдаёт свой this
       объемлющей функции (`var __dg_this = this;`). */
    prologue(fn, stmt) {
      if (!prologues.has(fn)) prologues.set(fn, []);
      if (!prologues.get(fn).includes(stmt)) prologues.get(fn).push(stmt);
    },

    /* имя вспомогательной функции runtime-блока */
    helper(id) {
      if (!session) throw new Error('rewrite: helper без сессии понижения');
      return session.helper(id, info);
    },

    /* длинный кусок текста под своим именем в runtime-блоке */
    constant(text, hint) {
      if (!session) throw new Error('rewrite: constant без сессии понижения');
      return session.constant(text, hint, info);
    },

    /* глобальное имя, которое проход собирается вставить: должно быть
       не затенено в этом месте */
    global(name, n, feature) {
      if (!info.isGlobalAt(name, n.start))
        throw new LowerError('pending', `\`${name}\` затенён локальным объявлением — проход вставил бы ссылку не туда`,
          { feature, pos: n.start });
      return name;
    },

    fail(kind, n, message, feature = null) {
      throw new LowerError(kind, message, { feature, pos: n ? n.start : null });
    },
  };

  const r = render(ast);
  return { code: r ? r.text : src, programTemps, programPrologues };
}

/* ── мелочи для проходов ────────────────────────────────────────────────── */

/* Вставить операторы первой строкой блока `{ … }`: если тело блока
   начинается с новой строки — отдельной строкой с тем же отступом,
   иначе — сразу за скобкой. */
export function prependToBlock(blockText, stmts) {
  const m = /^\{([ \t]*\r?\n)?([ \t]*)/.exec(blockText);
  if (m && m[1]) return '{' + m[1] + m[2] + stmts + '\n' + blockText.slice(1 + m[1].length);
  return '{ ' + stmts + blockText.slice(1);
}

/* Вставить операторы после позиции at в тексте блока — на новой строке
   с отступом той строки, где стоит at, если блок многострочный. */
export function insertAfter(text, at, stmts) {
  const lineStart = text.lastIndexOf('\n', at - 1) + 1;
  const indent = /^[ \t]*/.exec(text.slice(lineStart))[0];
  const multiline = text.indexOf('\n', at) >= 0;
  return multiline
    ? text.slice(0, at) + '\n' + indent + stmts + text.slice(at)
    : text.slice(0, at) + ' ' + stmts + text.slice(at);
}

/* позиция первого значимого символа начиная с pos: пропуск пробелов и
   комментариев. Нужна там, где в AST нет узла: запятая после последнего
   аргумента, `catch` без скобок. */
export function skipTrivia(src, pos) {
  for (;;) {
    while (pos < src.length && /\s/.test(src[pos])) pos++;
    if (src.startsWith('//', pos)) { while (pos < src.length && src[pos] !== '\n') pos++; continue; }
    if (src.startsWith('/*', pos)) { const e = src.indexOf('*/', pos + 2); pos = e < 0 ? src.length : e + 2; continue; }
    return pos;
  }
}

/* выражение без побочных эффектов, которое можно вычислить дважды */
export function isSimple(n) {
  return n.type === 'Identifier' || n.type === 'ThisExpression' || n.type === 'Super' ||
    (n.type === 'Literal' && !n.regex);
}
