/* ══════════════════════════════════════════════════════════════════════════
   object-literal — сокращённые, вычисляемые свойства и методы (ES2015)

     { a, m() {} }        →  { a: a, m: function () {} }
     { x: 1, [k]: v, y }  →  (t = { x: 1 }, __dg_defineProp(t, k, v), t.y = y, t)

   Сокращённая запись и метод разворачиваются на месте — это тот же
   литерал. Вычисляемый ключ требует отдельного шага: в ES5 ключом литерала
   может быть только имя или строка. Порядок вычисления сохраняется —
   свойства идут слева направо, как в исходнике.
   ══════════════════════════════════════════════════════════════════════════ */

import { rewrite, PREC } from './downgrade-rewrite.js';

/* значение свойства: у метода это функция, у остального — как записано */
function valueText(p, ctx) {
  if (!p.method) return ctx.expr(p.value, PREC.ASSIGN);
  const f = p.value;
  return `${f.async ? 'async ' : ''}function${f.generator ? '*' : ''} ${ctx.text(f)}`;
}

export default {
  id: 'object-literal',
  year: 2015,
  features: ['objectLiteralExt'],
  run(code, ast, { session, profile }) {
    return rewrite(code, ast, {
      Property(n, ctx) {
        if (ctx.parentOf(n).type !== 'ObjectExpression' || n.computed) return;
        if (n.shorthand) return { text: `${n.key.name}: ${ctx.text(n.value)}`, prec: 0 };
        if (n.method) return { text: `${n.key.type === 'Identifier' ? n.key.name : ctx.raw(n.key)}: ${valueText(n, ctx)}`, prec: 0 };
      },

      ObjectExpression(n, ctx) {
        if (!n.properties.some(p => p.type === 'Property' && p.computed)) return;
        if (n.properties.some(p => p.type === 'SpreadElement')) return;   // сперва object-rest-spread

        const t = ctx.temp(n, 'obj');
        const steps = [];
        const head = [];                 // свойства до первого вычисляемого — в литерал
        let started = false;

        for (const p of n.properties) {
          if (!started && !p.computed) { head.push(ctx.text(p)); continue; }
          if (!started) { steps.push(`${t} = { ${head.join(', ')} }`); started = true; }

          if (p.kind === 'get' || p.kind === 'set') {
            /* аксессор после вычисляемого ключа — тем же помощником, что
               и у класса; в ES3 дескрипторов нет, и это отказ */
            if (profile.es < 5) ctx.fail('unsupported', p, 'в ES3 нет аксессоров', 'accessors');
            const key = p.computed ? ctx.expr(p.key, PREC.ASSIGN)
              : p.key.type === 'Identifier' ? JSON.stringify(p.key.name) : ctx.raw(p.key);
            const fn = `function ${ctx.text(p.value)}`;
            steps.push(`${ctx.helper('accessor')}(${t}, ${key}, ${p.kind === 'get' ? fn : 'null'}, ${p.kind === 'set' ? fn : 'null'}, true)`);
            continue;
          }

          if (p.computed) {
            steps.push(`${ctx.helper('defineProp')}(${t}, ${ctx.expr(p.key, PREC.ASSIGN)}, ${valueText(p, ctx)})`);
            continue;
          }
          if (p.key.type === 'Identifier' && p.key.name === '__proto__')
            ctx.fail('pending', p, '`__proto__` после вычисляемого ключа не понижается', 'objectLiteralExt');
          const key = p.key.type === 'Identifier' ? `.${p.key.name}` : `[${ctx.raw(p.key)}]`;
          steps.push(`${t}${key} = ${valueText(p, ctx)}`);
        }
        if (!started) steps.push(`${t} = { ${head.join(', ')} }`);
        return { text: `(${[...steps, t].join(', ')})`, prec: PREC.PRIMARY };
      },
    }, { session });
  },
};
