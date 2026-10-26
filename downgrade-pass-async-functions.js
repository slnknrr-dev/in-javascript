/* ══════════════════════════════════════════════════════════════════════════
   async-functions — async-функции (ES2017) → генераторы (ES2015)

     async function f(a) { return await g(a); }
       →  function f(a) { return __dg_async(function* () { return (yield g(a)); }, this, arguments); }

     async (x) => { await x; }
       →  (x) => __dg_async(function* () { (yield x); }, this)

   Тело становится генератором, `await x` — `(yield x)`, а __dg_async
   прогоняет генератор на промисах: значение yield — то, чем промис
   разрешился; отказ — исключение в точке yield. До первого await тело
   выполняется синхронно, как и у настоящей async-функции.

   Параметры. Простые имена остаются на внешней функции, генератор видит
   их через замыкание. Умолчания и деструктуризация уезжают в сам
   генератор: генератор вызывается внутри executor'а `new Promise`, так
   что ошибка в параметре становится отклонённым промисом — как у
   настоящей async-функции, а не синхронным исключением. Внешней функции
   остаются заглушки в том количестве, чтобы length не изменился.

   this и arguments генератору передаются явно. У стрелки своих нет: она
   передаёт те, что видит сама, — ровно как было бы внутри async-стрелки.

   pending: super и new.target внутри (генератор — обычная функция, их там
   нет), стрелка со сложными параметрами, читающая arguments, и
   async-генераторы (этап M6, отдельная возможность asyncIteration).
   ══════════════════════════════════════════════════════════════════════════ */

import { walk } from './downgrade-walk.js';
import { rewrite, PREC, skipTrivia } from './downgrade-rewrite.js';

const PLAIN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ClassDeclaration', 'ClassExpression']);

/* узел в теле, не заходя во вложенные обычные функции и классы */
function find(node, test) {
  let hit = null;
  walk(node, {
    enter(n) {
      if (hit) return false;
      if (n !== node && PLAIN.has(n.type)) return false;
      if (test(n)) { hit = n; return false; }
    },
  });
  return hit;
}

/* length функции: параметры до первого умолчания или rest */
const lengthOf = params => {
  const i = params.findIndex(p => p.type === 'AssignmentPattern' || p.type === 'RestElement');
  return i < 0 ? params.length : i;
};

function lowerFn(n, ctx) {
  if (!n.async || n.generator) return;
  const sup = find(n, x => x.type === 'Super');
  if (sup) ctx.fail('pending', sup, 'super в async-методе не понижается', 'asyncFunction');
  const nt = find(n, x => x.type === 'MetaProperty' && x.meta.name === 'new');
  if (nt) ctx.fail('pending', nt, 'new.target в async-функции не понижается', 'asyncFunction');

  const helper = ctx.helper('async');
  const arrow = n.type === 'ArrowFunctionExpression';
  const simple = n.params.every(p => p.type === 'Identifier');
  const usesArgs = !!find(n, x => x.type === 'Identifier' && x.name === 'arguments' &&
    ctx.scope.refs.get(x)?.binding?.kind === 'arguments');

  /* позиция сразу за `=>` у стрелки; у функции — начало тела */
  let headEnd = n.body.start;
  if (arrow) {
    headEnd = n.params.length ? n.params.at(-1).end : n.start;
    for (;;) { headEnd = skipTrivia(ctx.src, headEnd); if (ctx.src.startsWith('=>', headEnd)) break; headEnd++; }
    headEnd += 2;
  }
  const paramsText = () => n.params.map(p => ctx.text(p)).join(', ');
  const bodyText = n.expression ? `{ return ${ctx.expr(n.body, PREC.ASSIGN)}; }` : ctx.text(n.body);

  let outerParams, genParams = '', args;
  if (simple) {
    outerParams = null;                                  // как были
    args = arrow ? (usesArgs ? ', arguments' : '') : ', arguments';
  } else {
    if (arrow && usesArgs)
      ctx.fail('pending', n, 'async-стрелка со сложными параметрами, читающая arguments, не понижается', 'asyncFunction');
    genParams = paramsText();
    const stubs = Array.from({ length: lengthOf(n.params) }, (_, i) => ctx.scope.fresh('p' + i));
    if (arrow) {
      const rest = ctx.scope.fresh('rest');
      outerParams = [...stubs, '...' + rest].join(', ');
      args = `, [${stubs.join(', ')}].concat(${rest})`;
    } else {
      outerParams = stubs.join(', ');
      args = ', arguments';
    }
  }

  const call = `${helper}(function* (${genParams}) ${bodyText}, this${args})`;

  /* голова без `async`: имя, параметры (или заглушки), `=>` */
  let head;
  if (outerParams === null) {
    head = '';
    let at = n.start;
    for (const p of n.params) { head += ctx.src.slice(at, p.start) + ctx.text(p); at = p.end; }
    head += ctx.src.slice(at, headEnd);
  } else {
    /* непростой параметр есть всегда в скобках: `async ({ a }) =>` */
    head = `${ctx.src.slice(n.start, n.params[0].start)}${outerParams}) ${arrow ? '=> ' : ''}`;
  }
  head = head.replace(/^async\s*/, '');

  if (arrow) return { text: `${head.trimEnd()} ${call}`, prec: PREC.ASSIGN };
  return { text: `${head.trimEnd()} { return ${call}; }`, prec: n.type === 'FunctionExpression' ? PREC.PRIMARY : 0 };
}

/* у метода `async` стоит перед ключом, в тексте MethodDefinition/Property */
function lowerMethod(m, ctx) {
  if (!m.value.async || m.value.generator) return;
  const r = ctx.splice(m);
  return { text: r.text.replace(/^(static\s+)?async\s+/, '$1'), prec: 0 };
}

export default {
  id: 'async-functions',
  year: 2017,
  features: ['asyncFunction'],
  run(code, ast, { session }) {
    return rewrite(code, ast, {
      FunctionDeclaration: lowerFn,
      FunctionExpression: lowerFn,
      ArrowFunctionExpression: lowerFn,
      MethodDefinition: lowerMethod,
      Property: (n, ctx) => (n.method ? lowerMethod(n, ctx) : undefined),
      AwaitExpression: (n, ctx) => ({ text: `(yield ${ctx.expr(n.argument, PREC.ASSIGN)})`, prec: PREC.PRIMARY }),
    }, { session });
  },
};
