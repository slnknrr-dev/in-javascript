/* ══════════════════════════════════════════════════════════════════════════
   template-literals — шаблонные строки (ES2015)

     `a${x}b`   →  "a".concat(x, "b")
     `a`        →  "a"
     tag`a${x}` →  tag(__dg_taggedTemplate(["a", ""], ["a", ""]), x)

   Конкатенация — через concat, а не `+`: у шаблона подстановка проходит
   через ToString, а `+` сначала зовёт ToPrimitive. Для объекта с valueOf
   это разные строки, и concat даёт ту, которую дал бы шаблон.

   Текст между подстановками переносится как есть: экранирования в
   шаблоне и в обычной строке означают одно и то же. Меняются только
   кавычки, настоящие переводы строк (шаблон многострочный, строка — нет)
   и `${`, которое в строке ничего не значит.
   ══════════════════════════════════════════════════════════════════════════ */

import { rewrite, PREC } from './downgrade-rewrite.js';

const BS = String.fromCharCode(92);

/* сырой текст куска шаблона → строковый литерал в двойных кавычках */
export function quasiToString(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === BS) { out += c + (raw[i + 1] ?? ''); i++; continue; }
    if (c === '"') { out += BS + '"'; continue; }
    if (c === '\n') { out += BS + 'n'; continue; }
    if (c === '\r') { out += BS + 'r'; continue; }
    if (c === ' ' || c === ' ') { out += BS + 'u202' + (c === ' ' ? '8' : '9'); continue; }
    out += c;
  }
  return '"' + out + '"';
}

export default {
  id: 'template-literals',
  year: 2015,
  features: ['template', 'taggedTemplate'],
  run(code, ast, { session }) {
    return rewrite(code, ast, {
      TemplateLiteral(n, ctx) {
        const parent = ctx.parentOf(n);
        if (parent && parent.type === 'TaggedTemplateExpression' && ctx.keyOf(n) === 'quasi') return;
        const strings = n.quasis.map(q => quasiToString(ctx.raw(q)));
        if (!n.expressions.length) return { text: strings[0], prec: PREC.PRIMARY };
        /* первый кусок — приёмник concat: строка получается даже если он пуст */
        const args = [];
        n.expressions.forEach((e, i) => {
          args.push(ctx.expr(e, PREC.ASSIGN));
          if (strings[i + 1] !== '""' || i === n.expressions.length - 1) args.push(strings[i + 1]);
        });
        /* хвостовой пустой кусок не нужен, если за ним ничего нет */
        while (args.length && args[args.length - 1] === '""') args.pop();
        return { text: `${strings[0]}.concat(${args.join(', ')})`, prec: PREC.CALL };
      },

      TaggedTemplateExpression(n, ctx) {
        const q = n.quasi;
        const cooked = q.quasis.map(x => quasiToString(ctx.raw(x)));
        const raws = q.quasis.map(x => JSON.stringify(ctx.raw(x)));
        const args = q.expressions.map(e => ctx.expr(e, PREC.ASSIGN));
        const strings = `${ctx.helper('taggedTemplate')}([${cooked.join(', ')}], [${raws.join(', ')}])`;
        return { text: `${ctx.expr(n.tag, PREC.CALL)}(${[strings, ...args].join(', ')})`, prec: PREC.CALL };
      },
    }, { session });
  },
};
