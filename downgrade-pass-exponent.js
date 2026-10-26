/* exponent — `**` и `**=` (ES2016) → Math.pow

     a ** b        →  Math.pow(a, b)
     a **= b       →  a = Math.pow(a, b)
     o.p **= b     →  (t = o).p = Math.pow(t.p, b)

   Для чисел это точное равенство: `**` определён через тот же
   Number::exponentiate, что и Math.pow. Для BigInt — нет, но BigInt ниже
   ES2020 не понижается вовсе, и до этого прохода такой файл не доходит. */

import { rewrite, PREC } from './downgrade-rewrite.js';
import { assignTarget } from './downgrade-pass-refs.js';

export default {
  id: 'exponent',
  year: 2016,
  features: ['exponent'],
  run(code, ast, { session }) {
    return rewrite(code, ast, {
      BinaryExpression(n, ctx) {
        if (n.operator !== '**') return;
        const M = ctx.global('Math', n, 'exponent');
        return { text: `${M}.pow(${ctx.expr(n.left)}, ${ctx.expr(n.right)})`, prec: PREC.CALL };
      },
      AssignmentExpression(n, ctx) {
        if (n.operator !== '**=') return;
        const M = ctx.global('Math', n, 'exponent');
        const t = assignTarget(n.left, ctx);
        return { text: t.write(`${M}.pow(${t.read}, ${ctx.expr(n.right)})`), prec: PREC.ASSIGN };
      },
    }, { session });
  },
};
