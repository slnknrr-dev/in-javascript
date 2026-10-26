/* ══════════════════════════════════════════════════════════════════════════
   spread — `...` в вызове, массиве и new (ES2015)

     f(...xs)          →  f.apply(undefined, __dg_toArray(xs))
     o.m(a, ...xs)     →  (t = o).m.apply(t, [a].concat(__dg_toArray(xs)))
     [a, ...xs]        →  [a].concat(__dg_toArray(xs))
     new F(...xs)      →  new (Function.prototype.bind.apply(F, [null].concat(__dg_toArray(xs))))()

   Метод вызывается через apply, поэтому объект вычисляется один раз и
   попадает в this — как и при обычном вызове. __dg_toArray разворачивает
   не только массивы: строку, arguments и любое итерируемое, как и
   настоящий spread.
   ══════════════════════════════════════════════════════════════════════════ */

import { rewrite, PREC, isSimple } from './downgrade-rewrite.js';

export default {
  id: 'spread',
  year: 2015,
  features: ['spread'],
  run(code, ast, { session }) {
    /* список аргументов или элементов → одно выражение-массив */
    function listExpr(items, ctx) {
      const parts = [];
      let plain = [];
      const flush = () => { if (plain.length) { parts.push(`[${plain.join(', ')}]`); plain = []; } };
      for (const item of items) {
        if (item && item.type === 'SpreadElement') {
          flush();
          parts.push(`${ctx.helper('toArray')}(${ctx.expr(item.argument, PREC.ASSIGN)})`);
          continue;
        }
        plain.push(item === null ? '' : ctx.expr(item, PREC.ASSIGN));
      }
      flush();
      if (!parts.length) return '[]';
      const [first, ...rest] = parts;
      const base = first.startsWith('[') ? first : `[].concat(${first})`;
      return rest.length ? `${base}.concat(${rest.join(', ')})` : base;
    }

    return rewrite(code, ast, {
      ArrayExpression(n, ctx) {
        if (!n.elements.some(e => e && e.type === 'SpreadElement')) return;
        return { text: listExpr(n.elements, ctx), prec: PREC.CALL };
      },

      CallExpression(n, ctx) {
        if (!n.arguments.some(a => a.type === 'SpreadElement')) return;
        const args = listExpr(n.arguments, ctx);
        const callee = n.callee;
        if (callee.type === 'MemberExpression') {
          if (callee.object.type === 'Super')
            ctx.fail('pending', n, 'spread в вызове через super не понижается', 'spread');
          const simple = isSimple(callee.object);
          const t = simple ? ctx.expr(callee.object, PREC.CALL) : ctx.temp(n, 'obj');
          const target = simple
            ? `${t}${memberSuffix(callee, ctx)}`
            : `(${t} = ${ctx.expr(callee.object, PREC.ASSIGN)})${memberSuffix(callee, ctx)}`;
          return { text: `${target}.apply(${t}, ${args})`, prec: PREC.CALL };
        }
        return { text: `${ctx.expr(callee, PREC.CALL)}.apply(undefined, ${args})`, prec: PREC.CALL };
      },

      NewExpression(n, ctx) {
        if (!n.arguments.some(a => a.type === 'SpreadElement')) return;
        const args = listExpr(n.arguments, ctx);
        return {
          text: `new (Function.prototype.bind.apply(${ctx.expr(n.callee, PREC.CALL)}, [null].concat(${args})))()`,
          prec: PREC.CALL,
        };
      },
    }, { session });

    function memberSuffix(m, ctx) {
      return m.computed ? `[${ctx.text(m.property)}]` : `.${m.property.name}`;
    }
  },
};
