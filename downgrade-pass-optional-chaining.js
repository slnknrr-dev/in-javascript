/* optional-chaining — `?.` (ES2020)

     a?.b             →  a === null || a === void 0 ? void 0 : a.b
     a.b?.c.d         →  (t = a.b) === null || t === void 0 ? void 0 : t.c.d
     a?.b.c?.d        →  a === null || … ? void 0 : (t = a.b.c) === null || … ? void 0 : t.d
     a.m?.(x)         →  (f = a.m) === null || … ? void 0 : f.call(a, x)
     f?.(x)           →  f === null || f === void 0 ? void 0 : f(x)
     delete a?.b      →  a === null || a === void 0 ? true : delete a.b

   Цепочка разворачивается от основы к концу. На каждом `?.` текущее
   значение проверяется на null/undefined — сначала положенное во
   временную переменную, если это не простое имя, — и при совпадении
   вся оставшаяся цепочка заменяется на undefined: короткое замыкание
   распространяется до конца цепочки, но не за скобки вокруг неё.

   Вызов метода через `?.()` должен получить свой this. Поэтому, если за
   обращением к свойству следует `?.()`, объект заранее кладётся во
   временную переменную, а вызов идёт через .call(объект, …). */

import { rewrite, PREC, isSimple } from './downgrade-rewrite.js';

const isNil = t => `${t} === null || ${t} === void 0`;

/* текст цепочки; shortValue — чем заменяется оборванная цепочка;
   last — что сделать с полным текстом (для delete) */
function lowerChain(expr, ctx, { shortValue = 'void 0', last = t => t } = {}) {
  const links = [];
  let base = expr;
  while ((base.type === 'MemberExpression' || base.type === 'CallExpression') && !base.parenthesized) {
    links.push(base);
    base = base.type === 'MemberExpression' ? base.object : base.callee;
  }
  links.reverse();

  let cur = base.type === 'Super' ? 'super' : ctx.expr(base, PREC.CALL);
  let simple = isSimple(base) && base.type !== 'Super';
  let recv = null;               // объект последнего обращения к свойству — для .call
  let prefix = '';

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const next = links[i + 1];

    if (link.optional) {
      if (link.type === 'CallExpression' && recv !== null) {
        /* `obj.m?.()`: функция — во временную, вызов — с this = obj */
        const f = ctx.temp(link, 'fn');
        prefix += `(${f} = ${cur}) === null || ${f} === void 0 ? ${shortValue} : `;
        const args = link.arguments.map(a => ctx.expr(a, PREC.ASSIGN));
        cur = `${f}.call(${[recv, ...args].join(', ')})`;
        simple = false;
        recv = null;
        continue;
      }
      if (simple) prefix += `${isNil(cur)} ? ${shortValue} : `;
      else {
        const t = ctx.temp(link, 'ref');
        prefix += `(${t} = ${cur}) === null || ${t} === void 0 ? ${shortValue} : `;
        cur = t;
        simple = true;
      }
    }

    if (link.type === 'MemberExpression') {
      /* за этим свойством последует `?.()` — объект понадобится как this */
      if (next && next.type === 'CallExpression' && next.optional) {
        if (base.type === 'Super' && i === 0) recv = 'this';
        else if (simple) recv = cur;
        else {
          const r = ctx.temp(link, 'obj');
          cur = `(${r} = ${cur})`;
          recv = r;
        }
      } else recv = null;
      if (link.computed) cur = `${cur}[${ctx.text(link.property)}]`;
      else cur = `${cur}.${link.property.type === 'PrivateIdentifier' ? '#' : ''}${link.property.name}`;
    } else {
      const args = link.arguments.map(a => ctx.expr(a, PREC.ASSIGN));
      cur = `${cur}(${args.join(', ')})`;
      recv = null;
    }
    simple = false;
  }

  return { text: prefix + last(cur), prec: prefix ? PREC.CONDITIONAL : PREC.CALL };
}

export default {
  id: 'optional-chaining',
  year: 2020,
  features: ['optionalChaining'],
  run(code, ast, { session }) {
    return rewrite(code, ast, {
      ChainExpression(n, ctx) {
        const parent = ctx.parentOf(n);
        /* `(a?.b)()` вызывает с this = a даже после скобок — без .call здесь
           не обойтись, а это отдельная форма; честнее отказаться */
        if (parent && ((parent.type === 'CallExpression' && ctx.keyOf(n) === 'callee') ||
            (parent.type === 'TaggedTemplateExpression' && ctx.keyOf(n) === 'tag')))
          ctx.fail('pending', n, '`(a?.b)()` — вызов цепочки в скобках не понижается', 'optionalChaining');
        if (parent && parent.type === 'UnaryExpression' && parent.operator === 'delete') return;
        return lowerChain(n.expression, ctx);
      },
      UnaryExpression(n, ctx) {
        if (n.operator !== 'delete' || n.argument.type !== 'ChainExpression') return;
        const r = lowerChain(n.argument.expression, ctx, { shortValue: 'true', last: t => `delete ${t}` });
        return { text: r.text, prec: r.prec === PREC.CALL ? PREC.UNARY : r.prec };
      },
    }, { session });
  },
};
