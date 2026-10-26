/* ══════════════════════════════════════════════════════════════════════════
   arrow — стрелочные функции (ES2015) → обычные

     (a) => a + 1        →  function (a) { return a + 1; }
     () => this.x        →  function () { return __dg_this.x; }
                            (в объемлющей функции: var __dg_this = this;)

   У стрелки нет своих this и arguments — она видит те же, что и функция,
   в которой написана. Обычная функция их заводит, поэтому объемлющая
   функция запоминает свои в переменную, а тело стрелки ссылается на неё.
   Одна переменная на функцию, сколько бы стрелок в ней ни было.
   ══════════════════════════════════════════════════════════════════════════ */

import { rewrite, PREC, skipTrivia } from './downgrade-rewrite.js';

export default {
  id: 'arrow',
  year: 2015,
  features: ['arrow'],
  run(code, ast, { session }) {
    /* функция (не стрелка), чьи this/arguments видит эта позиция */
    const captured = new Map();          // узел функции → { this, arguments }

    const nameFor = (ctx, fnNode, kind) => {
      let box = captured.get(fnNode);
      if (!box) { box = {}; captured.set(fnNode, box); }
      if (!box[kind]) {
        box[kind] = ctx.scope.fresh(kind);
        /* модуль тоже «функция»: там this — это module.exports или undefined */
        ctx.prologue(fnNode, `var ${box[kind]} = ${kind === 'this' ? 'this' : 'arguments'};`);
      }
      return box[kind];
    };

    /* стрелка ли ближайшая функция в этой позиции */
    const insideArrow = (ctx, pos) => ctx.scope.scopeAt(pos).fn.kind === 'arrow';

    return rewrite(code, ast, {
      ThisExpression(n, ctx) {
        if (!insideArrow(ctx, n.start)) return;
        const owner = ctx.scope.scopeAt(n.start).thisScope;
        return { text: nameFor(ctx, owner.node, 'this'), prec: PREC.PRIMARY };
      },

      Identifier(n, ctx) {
        if (n.name !== 'arguments' || !insideArrow(ctx, n.start)) return;
        const binding = ctx.scope.refs.get(n)?.binding;
        if (!binding || binding.kind !== 'arguments') return;
        return { text: nameFor(ctx, binding.scope.node, 'arguments'), prec: PREC.PRIMARY };
      },

      ArrowFunctionExpression(n, ctx) {
        /* голова: параметры как были, до `=>` включительно */
        let pos = n.params.length ? n.params.at(-1).end : n.start;
        for (;;) { pos = skipTrivia(ctx.src, pos); if (ctx.src.startsWith('=>', pos)) break; pos++; }
        let params = '', at = n.start;
        for (const p of n.params) { params += ctx.src.slice(at, p.start) + ctx.text(p); at = p.end; }
        params += ctx.src.slice(at, pos);
        /* `x => …` без скобок — скобки нужны обычной функции. Всё
           остальное (в том числе `<T,>(a: T): T` у `@ts`-цели) идёт как
           было: там скобки уже есть, и лишние сломали бы текст. */
        const bare = n.params.length === 1 && !ctx.src.slice(n.start, n.params[0].start).includes('(');
        const head = bare ? `(${params.trim()})` : params.trim();
        const body = n.expression ? `{ return ${ctx.expr(n.body, PREC.ASSIGN)}; }` : ctx.text(n.body);
        return { text: `function ${head} ${body}`, prec: PREC.PRIMARY };
      },
    }, { session });
  },
};
