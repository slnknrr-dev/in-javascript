/* ══════════════════════════════════════════════════════════════════════════
   parameters — умолчания, rest и паттерны в параметрах (ES2015)

     function f(a, b = 1, ...rest) { … }
       →  function f(a) {
            var b = arguments[1] !== undefined ? arguments[1] : 1;
            var rest = Array.prototype.slice.call(arguments, 2);
            …
          }

   В подписи остаются только параметры до первого умолчания или rest —
   ровно столько, сколько даёт f.length у настоящей функции. Остальное
   читается из arguments в начале тела: умолчание применяется, когда
   аргумент undefined, — как и требует язык.

   Образец в подписи заменяется на свежее имя, а сам разбирается в теле
   обычным объявлением, которое понижает проход destructuring. Позицию в
   подписи он сохраняет: образец — обязательный параметр, и f.length от
   него не меняется.

   Стрелки к этому моменту уже обычные функции (проход arrow идёт
   раньше), так что arguments в теле — своё.
   ══════════════════════════════════════════════════════════════════════════ */

import { rewrite, PREC, prependToBlock } from './downgrade-rewrite.js';

/* сдвигают f.length: в подписи после них ничего не остаётся */
const COMPLEX = new Set(['AssignmentPattern', 'RestElement']);
/* остаются позиционными: образец — обычный обязательный параметр */
const PATTERN = new Set(['ObjectPattern', 'ArrayPattern']);

export default {
  id: 'parameters',
  year: 2015,
  features: ['defaultParams', 'restParams', 'paramPattern'],
  run(code, ast, { session }) {
    function lower(fn, ctx) {
      if (!fn.params.some(p => COMPLEX.has(p.type) || PATTERN.has(p.type))) return;
      if (fn.type === 'ArrowFunctionExpression')
        ctx.fail('pending', fn, 'стрелка с умолчаниями должна быть понижена раньше (проход arrow)', 'defaultParams');

      const first = fn.params.findIndex(p => COMPLEX.has(p.type));
      const limit = first < 0 ? fn.params.length : first;
      const outer = [];
      const stmts = [];

      fn.params.forEach((p, i) => {
        if (i < limit) {
          if (p.type === 'Identifier') { outer.push(p.name); return; }
          const name = ctx.scope.fresh('p' + i);
          outer.push(name);
          stmts.push(`var ${ctx.text(p)} = ${name};`);
          return;
        }
        if (p.type === 'RestElement') {
          stmts.push(`var ${ctx.text(p.argument)} = Array.prototype.slice.call(arguments, ${i});`);
          return;
        }
        if (p.type === 'AssignmentPattern') {
          stmts.push(`var ${ctx.text(p.left)} = arguments[${i}] !== undefined ? arguments[${i}] : ${ctx.expr(p.right, PREC.ASSIGN)};`);
          return;
        }
        stmts.push(`var ${ctx.text(p)} = arguments[${i}];`);
      });

      const head = ctx.src.slice(fn.start, fn.params.length ? fn.params[0].start : fn.body.start);
      const tail = `${head.replace(/\($/, '(')}${outer.join(', ')}) `;
      return { text: tail + prependToBlock(ctx.text(fn.body), stmts.join(' ')), prec: fn.type === 'FunctionDeclaration' ? 0 : PREC.PRIMARY };
    }

    return rewrite(code, ast, {
      FunctionDeclaration: lower,
      FunctionExpression: lower,
      ArrowFunctionExpression: lower,
    }, { session });
  },
};
