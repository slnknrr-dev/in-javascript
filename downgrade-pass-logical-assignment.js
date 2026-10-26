/* logical-assignment — `&&=` `||=` `??=` (ES2021)

     a ||= b      →  a || (a = b)
     a &&= b      →  a && (a = b)
     a ??= b      →  a ?? (a = b)            (дальше — проход nullish)
     o.p ||= b    →  (t = o).p || (t.p = b)

   Запись происходит только если короткое замыкание не сработало — ровно
   как у оператора: `o.p ||= b` не вызывает сеттер, если o.p истинно. */

import { rewrite, PREC } from './downgrade-rewrite.js';
import { isSimple } from './downgrade-rewrite.js';

export default {
  id: 'logical-assignment',
  year: 2021,
  features: ['logicalAssignment'],
  run(code, ast, { session }) {
    return rewrite(code, ast, {
      AssignmentExpression(n, ctx) {
        if (n.operator !== '||=' && n.operator !== '&&=' && n.operator !== '??=') return;
        const op = n.operator.slice(0, 2);
        const value = ctx.expr(n.right, PREC.ASSIGN);
        const left = n.left;

        if (left.type === 'Identifier')
          return { text: `${left.name} ${op} (${left.name} = ${value})`, prec: PREC.binary(op) };

        if (left.type !== 'MemberExpression')
          ctx.fail('pending', n, `логическое присваивание в ${left.type} не понижается`, 'logicalAssignment');

        /* объект и ключ — один раз: чтение слева, запись справа */
        const obj = isSimple(left.object)
          ? { first: ctx.expr(left.object, PREC.CALL), again: ctx.expr(left.object, PREC.CALL) }
          : (t => ({ first: `(${t} = ${ctx.expr(left.object, PREC.ASSIGN)})`, again: t }))(ctx.temp(n, 'obj'));
        let keyFirst, keyAgain;
        if (!left.computed) {
          const p = left.property.type === 'PrivateIdentifier' ? '#' + left.property.name : left.property.name;
          keyFirst = keyAgain = '.' + p;
        } else if (isSimple(left.property)) {
          keyFirst = keyAgain = `[${ctx.text(left.property)}]`;
        } else {
          const k = ctx.temp(n, 'key');
          keyFirst = `[${k} = ${ctx.expr(left.property, PREC.ASSIGN)}]`;
          keyAgain = `[${k}]`;
        }
        return {
          text: `${obj.first}${keyFirst} ${op} (${obj.again}${keyAgain} = ${value})`,
          prec: PREC.binary(op),
        };
      },
    }, { session });
  },
};
