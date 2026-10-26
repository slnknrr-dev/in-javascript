/* ══════════════════════════════════════════════════════════════════════════
   for-of — перебор итерируемого (ES2015)

     for (const x of xs) { … }
       →  for (var _it = __dg_iter(xs), _step; !(_step = _it.next()).done;) {
            const x = _step.value;
            …
          }

   Помощник __dg_iter решает, чем идти: у массива, строки, arguments и
   типизированного массива — индексный цикл (быстро и без аллокаций, а
   строка перебирается по кодовым точкам, как настоящий for-of), у всего
   остального — протокол итератора через Symbol.iterator.

   Вид объявления сохраняется: был `const x` — останется `const x` внутри
   тела, и о том, что на каждом витке это своя переменная, позаботится
   проход block-scoping.

   Чего нет: закрытия итератора (`return()`) при break и исключении.
   Генератор, прерванный на середине, останется незакрытым — в отличие от
   настоящего for-of.
   ══════════════════════════════════════════════════════════════════════════ */

import { rewrite, PREC, prependToBlock } from './downgrade-rewrite.js';

export default {
  id: 'for-of',
  year: 2015,
  features: ['forOf'],
  run(code, ast, { session }) {
    return rewrite(code, ast, {
      ForOfStatement(n, ctx) {
        if (n.await) ctx.fail('pending', n, '`for await` — этап M6: нужен Promise', 'asyncIteration');
        const it = ctx.scope.fresh('it');
        const step = ctx.scope.fresh('step');
        const head = `for (var ${it} = ${ctx.helper('iter')}(${ctx.expr(n.right, PREC.ASSIGN)}), ${step}; ` +
          `!(${step} = ${it}.next()).done;)`;

        /* сначала связывание витка, потом тело как было */
        const bind = n.left.type === 'VariableDeclaration'
          ? `${n.left.kind} ${ctx.text(n.left.declarations[0].id)} = ${step}.value;`
          : `${ctx.text(n.left)} = ${step}.value;`;

        const body = ctx.text(n.body);
        const block = n.body.type === 'BlockStatement'
          ? prependToBlock(body, bind)
          : `{ ${bind} ${body} }`;
        return { text: `${head} ${block}`, prec: 0 };
      },
    }, { session });
  },
};
