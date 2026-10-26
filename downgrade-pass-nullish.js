/* nullish — `a ?? b` (ES2020)

     a ?? b       →  a !== null && a !== void 0 ? a : b
     f() ?? b     →  (t = f()) !== null && t !== void 0 ? t : b

   Сравнение строгое, а не `a != null`: у document.all `== null` истинно,
   хотя это объект, и `??` его возвращает. `void 0` — потому что имя
   `undefined` можно затенить. */

import { rewrite, PREC } from './downgrade-rewrite.js';
import { once } from './downgrade-pass-refs.js';

export default {
  id: 'nullish',
  year: 2020,
  features: ['nullish'],
  run(code, ast, { session }) {
    return rewrite(code, ast, {
      LogicalExpression(n, ctx) {
        if (n.operator !== '??') return;
        const a = once(n.left, ctx);
        return {
          text: `${a.first} !== null && ${a.again} !== void 0 ? ${a.again} : ${ctx.expr(n.right, PREC.ASSIGN)}`,
          prec: PREC.CONDITIONAL,
        };
      },
    }, { session });
  },
};
