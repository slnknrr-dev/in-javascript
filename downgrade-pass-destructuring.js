/* ══════════════════════════════════════════════════════════════════════════
   destructuring — разбор по образцу (ES2015)

     const { a, b: c = 2 } = o;   →  var _t = o, a = _t.a, _v = _t.b, c = _v === undefined ? 2 : _v;
     const [x, , y] = xs;         →  var _arr = __dg_toArray(xs), x = _arr[0], y = _arr[2];
     ({ a } = o);                 →  (_t = o, a = _t.a, _t)
     catch ({ message }) { … }    →  catch (_e) { var message = _e.message; … }

   Порядок вычисления сохраняется: источник один раз, ключи слева направо,
   умолчание — только если пришло undefined (свойство читается один раз,
   чтобы геттер не сработал дважды).

   Массив разбирается через __dg_toArray: образец работает с любым
   итерируемым, не только с массивом, — как и в языке.

   rest в объекте (`{ a, ...r }`) к этому моменту уже разобран проходом
   object-rest-spread: он старше (ES2018).
   ══════════════════════════════════════════════════════════════════════════ */

import { rewrite, PREC, prependToBlock } from './downgrade-rewrite.js';

const isPattern = n => !!n && (n.type === 'ObjectPattern' || n.type === 'ArrayPattern');

export default {
  id: 'destructuring',
  year: 2015,
  features: ['destructuring'],
  run(code, ast, { session }) {
    /* образец → список пар [имя, выражение] в порядке вычисления */
    function flatten(pattern, source, ctx, mk, out, sourceIsName) {
      if (pattern.type === 'Identifier') { out.push([pattern.name, source]); return; }
      if (pattern.type === 'MemberExpression') { out.push([ctx.text(pattern), source]); return; }

      if (pattern.type === 'ObjectPattern') {
        let t = source;
        if (!sourceIsName) { t = mk('t'); out.push([t, source]); }
        for (const p of pattern.properties) {
          if (p.type === 'RestElement')
            ctx.fail('pending', p, 'rest в объекте должен быть разобран раньше (object-rest-spread)', 'destructuring');
          const key = p.computed ? `[${ctx.expr(p.key, PREC.ASSIGN)}]`
            : p.key.type === 'Identifier' ? `.${p.key.name}` : `[${ctx.raw(p.key)}]`;
          element(p.value, `${t}${key}`, ctx, mk, out);
        }
        return;
      }

      if (pattern.type === 'ArrayPattern') {
        const arr = mk('arr');
        out.push([arr, `${ctx.helper('toArray')}(${source})`]);
        pattern.elements.forEach((el, i) => {
          if (!el) return;
          if (el.type === 'RestElement') { element(el.argument, `${arr}.slice(${i})`, ctx, mk, out); return; }
          element(el, `${arr}[${i}]`, ctx, mk, out);
        });
        return;
      }

      ctx.fail('pending', pattern, `образец ${pattern.type} не понижается`, 'destructuring');
    }

    /* элемент образца: может быть с умолчанием */
    function element(target, source, ctx, mk, out) {
      if (target.type !== 'AssignmentPattern') { flatten(target, source, ctx, mk, out, false); return; }
      /* свойство читается один раз: геттер не должен сработать дважды */
      const v = mk('v');
      out.push([v, source]);
      const withDefault = `${v} === undefined ? ${ctx.expr(target.right, PREC.ASSIGN)} : ${v}`;
      if (target.left.type === 'Identifier') { out.push([target.left.name, withDefault]); return; }
      const t = mk('t');
      out.push([t, withDefault]);
      flatten(target.left, t, ctx, mk, out, true);
    }

    const pairs = out => out.map(([name, value]) => `${name} = ${value}`).join(', ');

    return rewrite(code, ast, {
      VariableDeclarator(n, ctx) {
        if (!isPattern(n.id)) return;
        if (!n.init) ctx.fail('pending', n, 'образец без инициализатора', 'destructuring');
        const out = [];
        const simple = n.init.type === 'Identifier';
        flatten(n.id, ctx.expr(n.init, PREC.ASSIGN), ctx, b => ctx.scope.fresh(b), out, simple);
        return { text: pairs(out), prec: 0 };
      },

      AssignmentExpression(n, ctx) {
        if (n.operator !== '=' || !isPattern(n.left)) return;
        const out = [];
        const value = ctx.temp(n, 'val');
        out.push([value, ctx.expr(n.right, PREC.ASSIGN)]);
        flatten(n.left, value, ctx, b => ctx.temp(n, b), out, true);
        return { text: `(${pairs(out)}, ${value})`, prec: PREC.PRIMARY };
      },

      CatchClause(n, ctx) {
        if (!isPattern(n.param)) return;
        const e = ctx.scope.fresh('e');
        const out = [];
        flatten(n.param, e, ctx, b => ctx.scope.fresh(b), out, true);
        return { text: `catch (${e}) ${prependToBlock(ctx.text(n.body), `var ${pairs(out)};`)}`, prec: 0 };
      },

      ForInStatement(n, ctx) { headPattern(n, ctx); },
      ForOfStatement(n, ctx) { headPattern(n, ctx); },
    }, { session });

    /* for (const [a] of xs) к этому моменту уже развёрнут проходом for-of
       в объявление внутри тела; остаётся только for-in */
    function headPattern(n, ctx) {
      const left = n.left;
      const pattern = left.type === 'VariableDeclaration' ? left.declarations[0].id : left;
      if (isPattern(pattern)) ctx.fail('pending', n, 'образец в заголовке for-in не понижается', 'destructuring');
    }
  },
};
