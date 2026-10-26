/* ══════════════════════════════════════════════════════════════════════════
   block-scoping — let и const (ES2015) → var

   var всплывает до функции, поэтому две одноимённые блочные переменные в
   одной функции после замены столкнулись бы. Вторая переименовывается —
   по областям видимости (scope.js), так что меняются ровно ссылки на неё:

     let x = 1;                var x = 1;
     { let x = 2; use(x); }    { var x$2 = 2; use(x$2); }

   Занятыми считаются глобальные имена файла (`{ let Math = 1; }` после
   всплытия затенил бы Math на всю функцию) и то, на что функция ссылается
   наружу. Имена из соседних функций — нет: var всплывает только до своей
   функции, и `function Dog` внутри IIFE остаётся Dog, хотя снаружи есть
   свой Dog. Это важно: имя функции видно в .name и .constructor.name.

   Отдельный случай — замыкание в цикле. У let на каждом витке своя
   переменная, у var одна на всех, поэтому тело цикла, из которого
   создаётся функция, заворачивается в немедленно вызываемую функцию —
   она и даёт свежую переменную на виток:

     for (let i = 0; i < 3; i++) fns.push(function () { return i; });
       →  for (var i = 0; i < 3; i++) { (function (i) {
            fns.push(function () { return i; });
          }).call(this, i); }

   Если в таком теле есть break, continue, return, yield или arguments,
   заворачивать нельзя — это честный отказ (pending).

   Чего нет: мёртвой зоны (обращение до объявления даёт undefined, а не
   ошибку) и запрета на повторное присваивание const.
   ══════════════════════════════════════════════════════════════════════════ */

import { walk } from './downgrade-walk.js';
import { analyze } from './downgrade-scope.js';
import { rewrite, PREC } from './downgrade-rewrite.js';

const FUNCTION_LIKE = new Set(['module', 'function', 'arrow', 'static', 'field']);
const LOOPS = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const BLOCK_KINDS = new Set(['let', 'const', 'class', 'function']);

export default {
  id: 'block-scoping',
  year: 2015,
  features: ['letConst'],
  run(code, ast, { session }) {
    const scope = analyze(ast);

    /* ── имена ── */

    const renames = new Map();

    /* Занятые имена считаются по функции: var всплывает до её начала, и
       два блочных имени внутри одной функции столкнулись бы. В соседней
       функции то же имя безопасно — var из неё наружу не всплывёт, —
       поэтому `function Dog` внутри IIFE остаётся Dog, даже когда снаружи
       есть свой Dog. Имя класса и функции сохраняется намеренно: его
       видно в .name и в .constructor.name (BACKLOG.md §12 п. 21).

       Занять нельзя глобальные имена файла (всплывшая переменная затенила
       бы их) и те, на что функция ссылается наружу. Придуманное имя
       (x$2) вдобавок не должно встречаться среди объявленных во
       вложенных функциях: иначе ссылка, которая шла мимо них наружу,
       попалась бы им в руки. Своё имя при этом остаётся своим — так
       class Some снаружи и function Some внутри своей IIFE уживаются. */
    const inside = (sc, region) => { for (let x = sc; x; x = x.parent) if (x === region) return true; return false; };

    /* имена, которые регион занять не может */
    function reserved(region) {
      const out = new Set(scope.globals.keys());
      walk(region.node, {
        enter(n) {
          if (n.type !== 'Identifier') return;
          const b = scope.bindingOf(n);
          if (b && !inside(b.scope, region)) out.add(b.name);
        },
      });
      return out;
    }

    /* имена, объявленные во вложенных функциях региона */
    function nestedNames(region) {
      const out = new Set();
      (function down(sc, nested) {
        for (const b of sc.bindings.values()) if (nested) out.add(b.name);
        for (const c of sc.children) down(c, nested || FUNCTION_LIKE.has(c.kind));
      })(region, false);
      return out;
    }

    (function assign(s) {
      const taken = reserved(s);
      const nested = nestedNames(s);
      /* привязки функции — первыми: они сохраняют свои имена */
      const order = [];
      (function collect(x, depth) {
        order.push([x, depth]);
        for (const c of x.children) if (!FUNCTION_LIKE.has(c.kind)) collect(c, depth + 1);
      })(s, 0);
      order.sort((a, b) => a[1] - b[1] || a[0].node.start - b[0].node.start);
      for (const [sc] of order)
        for (const b of sc.bindings.values()) {
          let name = b.name;
          for (let i = 2; taken.has(name) || (name !== b.name && nested.has(name)); i++)
            name = `${b.name}$${i}`;
          taken.add(name);
          if (name !== b.name) renames.set(b, name);
        }
      /* вложенные функции — своя область имён */
      (function deeper(x) {
        for (const c of x.children) {
          if (FUNCTION_LIKE.has(c.kind)) assign(c);
          else deeper(c);
        }
      })(s);
    })(scope.root);

    /* ── циклы, где нужна переменная на виток ── */

    const parents = new Map();
    walk(ast, { enter(n, p) { parents.set(n, p); } });

    const loopOf = node => {
      for (let p = parents.get(node); p; p = parents.get(p)) {
        if (LOOPS.has(p.type)) return p;
        if (FUNCTIONS.has(p.type)) return null;
      }
      return null;
    };
    const insideFunctionWithin = (node, loop) => {
      for (let p = parents.get(node); p && p !== loop; p = parents.get(p)) if (FUNCTIONS.has(p.type)) return true;
      return false;
    };

    /* привязка блочная и объявлена внутри цикла, а ссылка — из функции,
       созданной в том же цикле: значит, виткам нужны разные переменные */
    const wrapped = new Set();
    for (const [id, ref] of scope.refs) {
      const b = ref.binding;
      if (!b || !BLOCK_KINDS.has(b.kind) || !b.ids.length) continue;
      const loop = loopOf(b.ids[0]);
      if (!loop) continue;
      if (insideFunctionWithin(id, loop)) wrapped.add(loop);
    }

    /* имена, объявленные в заголовке цикла: они станут параметрами IIFE */
    function headNames(loop) {
      const head = loop.type === 'ForStatement' ? loop.init : loop.left;
      if (!head || head.type !== 'VariableDeclaration' || head.kind === 'var') return [];
      const out = [];
      for (const d of head.declarations)
        walk(d.id, { enter(n) { if (n.type === 'Identifier') out.push(nameOf(n)); } });
      return out;
    }
    const nameOf = id => {
      const b = scope.bindingOf(id);
      return (b && renames.get(b)) ?? id.name;
    };

    const ESCAPES = new Set(['BreakStatement', 'ContinueStatement', 'ReturnStatement', 'YieldExpression', 'AwaitExpression']);
    function escapes(body) {
      let hit = null;
      walk(body, {
        enter(n) {
          if (hit) return false;
          if (FUNCTIONS.has(n.type)) return false;
          if (ESCAPES.has(n.type) || (n.type === 'Identifier' && n.name === 'arguments')) { hit = n; return false; }
        },
      });
      return hit;
    }

    return rewrite(code, ast, {
      VariableDeclaration(n, ctx) {
        if (n.kind === 'var') return;
        return ctx.splice(n, [{ start: n.start, end: n.start + n.kind.length, text: 'var' }]);
      },

      Identifier(n, ctx) {
        const b = ctx.scope.bindingOf(n);
        if (!b || !renames.has(b)) return;
        const name = renames.get(b);
        return { text: ctx.scope.shared.get(n) === 'property' ? `${n.name}: ${name}` : name, prec: PREC.PRIMARY };
      },

      ForStatement: loop, ForInStatement: loop, ForOfStatement: loop,
      WhileStatement: loop, DoWhileStatement: loop,
    }, { session, scope });

    function loop(n, ctx) {
      if (!wrapped.has(n)) return;
      const bad = escapes(n.body);
      if (bad) ctx.fail('pending', bad,
        'замыкание в цикле с break, continue, return, yield или arguments не понижается', 'letConst');
      const params = headNames(n);
      const body = ctx.text(n.body);
      const inner = n.body.type === 'BlockStatement' ? body : `{ ${body} }`;
      const head = ctx.src.slice(n.start, n.body.start);
      const rendered = ctx.splice(n, []).text;
      /* голова цикла с уже переписанными let → var */
      const headText = rendered.slice(0, rendered.length - body.length) || head;
      const call = `(function (${params.join(', ')}) ${inner}).call(this${params.length ? ', ' + params.join(', ') : ''});`;
      return { text: `${headText}{ ${call} }`, prec: 0 };
    }
  },
};
