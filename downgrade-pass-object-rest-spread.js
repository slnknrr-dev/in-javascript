/* ══════════════════════════════════════════════════════════════════════════
   object-rest-spread — `{ ...a }` и `{ a, ...rest } = o` (ES2018)

   spread:
     { a: 1, ...b, c }          →  __dg_objectSpread({ a: 1 }, b, { c })

   rest — выносится из паттерна в отдельное связывание:
     const { a, ...r } = f();   →  const __dg_rest = f(), { a } = __dg_rest,
                                         r = __dg_objectRest(__dg_rest, ["a"]);
     function g({ a, ...r }) {} →  function g(__dg_rest) { var { a } = __dg_rest,
                                         r = __dg_objectRest(__dg_rest, ["a"]); }
     ({ a, ...r } = o)          →  (t = o, { a } = t, r = __dg_objectRest(t, ["a"]), t)
     for (const { a, ...r } of xs) body
                                →  for (const t of xs) { const { a } = t, r = …; body }
     catch ({ a, ...r }) { … }  →  catch (t) { let { a } = t, r = …; … }

   Обе вспомогательные функции копируют собственные перечислимые свойства
   (строки и символы) как данные — сеттеры не вызываются, как у настоящего
   spread. Отличие, о котором надо знать: spread копирует источник в
   момент, когда до него дошло вычисление литерала, а здесь все
   источники сначала вычисляются как аргументы. Разница видна, только
   если вычисление следующего свойства меняет уже разобранный источник.

   Вложенный паттерн с rest (`{ x: { a, ...r } }`) выносится в своё
   связывание следующим кругом того же прохода.
   ══════════════════════════════════════════════════════════════════════════ */

import { walk } from './downgrade-walk.js';
import { rewrite, PREC, isSimple, skipTrivia } from './downgrade-rewrite.js';

const hasRest = p => p && p.type === 'ObjectPattern' && p.properties.some(x => x.type === 'RestElement');

/* первый (внешний) ObjectPattern с rest внутри паттерна */
function findRestPattern(pattern) {
  let hit = null;
  walk(pattern, {
    enter(n) {
      if (hit) return false;
      if (n.type === 'AssignmentPattern') return;          // и left, и right
      if (hasRest(n)) { hit = n; return false; }
    },
  });
  return hit;
}

export default {
  id: 'object-rest-spread',
  year: 2018,
  features: ['objectSpread', 'objectRest'],
  run(code, ast, { session }) {

    /* ключи, которые rest должен исключить; вычисляемые — через временные */
    function excluded(pattern, ctx, pre, mk) {
      const keys = [];
      const props = [];
      for (const p of pattern.properties) {
        if (p.type === 'RestElement') continue;
        let keyText;
        if (!p.computed) {
          keyText = p.key.type === 'Identifier' ? JSON.stringify(p.key.name) : JSON.stringify(String(p.key.value));
          props.push(ctx.text(p));
        } else if (p.key.type === 'Literal') {
          keyText = JSON.stringify(String(p.key.value));
          props.push(ctx.text(p));
        } else {
          const k = mk('key');
          pre.push([k, ctx.expr(p.key, PREC.ASSIGN)]);
          keyText = k;
          props.push(`[${k}]: ${ctx.text(p.value)}`);
        }
        keys.push(keyText);
      }
      const rest = pattern.properties.find(p => p.type === 'RestElement');
      return { keys, props, restTarget: ctx.text(rest.argument) };
    }

    /* паттерн без rest-элемента и связывания для него: [[id, init]] */
    function split(pattern, source, ctx, mk = b => ctx.scope.fresh(b)) {
      const pre = [];
      const { keys, props, restTarget } = excluded(pattern, ctx, pre, mk);
      const out = [...pre];
      out.push([`{ ${props.join(', ')} }`, source]);
      out.push([restTarget, `${ctx.helper('objectRest')}(${source}, [${keys.join(', ')}])`]);
      return out;
    }

    /* паттерн, в котором внешний ObjectPattern с rest заменён на имя */
    function carve(id, target, name, ctx) {
      if (id === target) return name;
      const text = ctx.text(id);
      const inner = ctx.text(target);
      const at = text.indexOf(inner);
      return text.slice(0, at) + name + text.slice(at + inner.length);
    }

    /* связывания для паттерна id = init */
    function bindings(id, initText, initSimple, ctx) {
      const target = findRestPattern(id);
      const t = initSimple && id === target ? initText : ctx.scope.fresh('rest');
      const out = [];
      if (id === target) {
        if (t !== initText) out.push([t, initText]);
        out.push(...split(target, t, ctx));
      } else {
        out.push([carve(id, target, t, ctx), initText]);
        out.push(...split(target, t, ctx));
      }
      return out;
    }

    const decl = pairs => pairs.map(([a, b]) => `${a} = ${b}`).join(', ');

    return rewrite(code, ast, {
      ObjectExpression(n, ctx) {
        if (!n.properties.some(p => p.type === 'SpreadElement')) return;
        /* первый аргумент — свежий объект-цель: либо свойства до первого
           spread, либо {} */
        const args = [];
        let group = [];
        const flush = () => { if (group.length) { args.push(`{ ${group.join(', ')} }`); group = []; } };
        for (const p of n.properties) {
          if (p.type === 'SpreadElement') {
            flush();
            if (!args.length) args.push('{}');
            args.push(ctx.expr(p.argument, PREC.ASSIGN));
            continue;
          }
          if (args.length) {
            /* свойства после spread уезжают в отдельный литерал: __proto__
               там задал бы прототип не тому объекту, а super в методе
               смотрел бы не на тот прототип */
            if (!p.computed && !p.shorthand && !p.method && p.kind === 'init' &&
                ((p.key.type === 'Identifier' && p.key.name === '__proto__') || (p.key.type === 'Literal' && p.key.value === '__proto__')))
              ctx.fail('pending', p, '`__proto__:` после spread не понижается', 'objectSpread');
            let sup = null;
            walk(p, { enter(x) { if (x.type === 'Super') sup = x; } });
            if (sup) ctx.fail('pending', sup, 'super в методе после spread не понижается', 'objectSpread');
          }
          group.push(ctx.text(p));
        }
        flush();
        return { text: `${ctx.helper('objectSpread')}(${args.join(', ')})`, prec: PREC.CALL };
      },

      VariableDeclarator(n, ctx) {
        if (!findRestPattern(n.id)) return;
        const parent = ctx.parentOf(n);
        const loop = ctx.parentOf(parent);
        if (loop && (loop.type === 'ForOfStatement' || loop.type === 'ForInStatement') && ctx.keyOf(parent) === 'left') return;
        if (!n.init) ctx.fail('pending', n, 'rest-паттерн без инициализатора', 'objectRest');
        return { text: decl(bindings(n.id, ctx.expr(n.init, PREC.ASSIGN), isSimple(n.init), ctx)), prec: 0 };
      },

      ForOfStatement: loopHead,
      ForInStatement: loopHead,

      CatchClause(n, ctx) {
        if (!n.param || !findRestPattern(n.param)) return;
        const t = ctx.scope.fresh('rest');
        const body = ctx.text(n.body);
        return {
          text: `catch (${t}) { let ${decl(bindings(n.param, t, true, ctx))}; ${body.slice(1)}`,
          prec: 0,
        };
      },

      AssignmentExpression(n, ctx) {
        if (n.operator !== '=' || !hasRest(n.left)) {
          if (n.operator === '=' && findRestPattern(n.left))
            ctx.fail('pending', n, 'вложенный rest в деструктурирующем присваивании не понижается', 'objectRest');
          return;
        }
        const t = ctx.temp(n, 'rest');
        const parts = [`${t} = ${ctx.expr(n.right, PREC.ASSIGN)}`];
        for (const [a, b] of split(n.left, t, ctx, b => ctx.temp(n, b))) parts.push(`${a} = ${b}`);
        parts.push(t);
        return { text: `(${parts.join(', ')})`, prec: PREC.PRIMARY };
      },

      FunctionDeclaration: params, FunctionExpression: params, ArrowFunctionExpression: params,
    }, { session });

    function loopHead(n, ctx) {
      const left = n.left;
      if (left.type !== 'VariableDeclaration') {
        if (findRestPattern(left)) ctx.fail('pending', n, 'rest-паттерн в заголовке for без объявления не понижается', 'objectRest');
        return;
      }
      const d = left.declarations[0];
      if (!findRestPattern(d.id)) return;
      const t = ctx.scope.fresh('rest');
      const head = `${left.kind} ${t}`;
      const inner = `${left.kind} ${decl(bindings(d.id, t, true, ctx))};`;
      const kw = n.type === 'ForOfStatement' ? 'of' : 'in';
      const prefix = ctx.src.slice(n.start, left.start);          // `for (` или `for await (`
      return {
        text: `${prefix}${head} ${kw} ${ctx.expr(n.right, PREC.ASSIGN)}) { ${inner} ${ctx.text(n.body)} }`,
        prec: 0,
      };
    }

    function params(n, ctx) {
      const i = n.params.findIndex(p => findRestPattern(p.type === 'AssignmentPattern' ? p.left : p));
      if (i < 0) return;
      if (n.params.slice(i + 1).some(p => p.type === 'AssignmentPattern'))
        ctx.fail('pending', n, 'rest-паттерн в параметре перед параметрами с умолчанием не понижается', 'objectRest');
      const lines = [];
      const texts = n.params.map((p, k) => {
        const pat = p.type === 'AssignmentPattern' ? p.left : p;
        if (k < i || !findRestPattern(pat)) return ctx.text(p);
        const t = ctx.scope.fresh('rest');
        lines.push(decl(bindings(pat, t, true, ctx)));
        return p.type === 'AssignmentPattern' ? `${t} = ${ctx.expr(p.right, PREC.ASSIGN)}` : t;
      });
      const stmt = `var ${lines.join(', ')};`;

      /* голова функции с новыми параметрами */
      let head = '', at = n.start;
      n.params.forEach((p, k) => { head += ctx.src.slice(at, p.start) + texts[k]; at = p.end; });
      if (n.expression) {
        let pos = at;
        for (;;) { pos = skipTrivia(ctx.src, pos); if (ctx.src.startsWith('=>', pos)) break; pos++; }
        head += ctx.src.slice(at, pos + 2);
        return { text: `${head} { ${stmt} return ${ctx.expr(n.body, PREC.ASSIGN)}; }`, prec: PREC.ASSIGN };
      }
      head += ctx.src.slice(at, n.body.start);
      const body = ctx.text(n.body);
      return { text: `${head}{ ${stmt}${body.slice(1)}`, prec: n.type === 'FunctionDeclaration' ? 0 : n.type === 'ArrowFunctionExpression' ? PREC.ASSIGN : PREC.PRIMARY };
    }
  },
};
