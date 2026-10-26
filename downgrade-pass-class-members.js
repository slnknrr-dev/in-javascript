/* ══════════════════════════════════════════════════════════════════════════
   class-members — поля, приватные имена и static-блоки классов (ES2022)

     class A extends B {             var __dg_A_x = new WeakMap();
       #x = 1;                       class A extends B {
       y = this.#x + 1;                constructor(...args) {
       static z = 2;          →          super(...args);
       static { init(this); }            __dg_A_x.set(this, 1);
       get() { return this.#x; }         __dg_defineField(this, "y", __dg_privGet(this, __dg_A_x) + 1);
     }                                 }
                                       get() { return __dg_privGet(this, __dg_A_x); }
                                     }
                                     __dg_defineField(A, "z", 2);
                                     (function () { init(this); }).call(A);

   Что куда уходит:

     поле экземпляра     в конструктор: в начало у базового класса, сразу
                         после `super(…);` у производного; публичное —
                         defineProperty (поле определяется, а не
                         присваивается), приватное — WeakMap.set
     приватный метод,    функция перед классом; экземпляры метятся в
     аксессор            WeakSet-бренде, обращение проверяет бренд
     static-поле,        после класса, в порядке объявления; this
     static-блок         внутри — сам класс (через .call)
     `#x in o`           has() у WeakMap или бренда

   Инициализаторы полей переезжают в конструктор, а там их имена могут
   оказаться затенены параметрами или локальными переменными
   конструктора. Такие переменные конструктора переименовываются.

   Чего проход не делает и говорит об этом (pending): super внутри того,
   что уезжает из класса (приватные методы, static-инициализаторы),
   new.target в инициализаторах, `super(…)` не отдельным оператором при
   полях у производного класса, приватные имена в деструктуризации и в
   цепочках `?.`, запись в приватный метод, вычисляемые ключи полей.
   ══════════════════════════════════════════════════════════════════════════ */

import { walk } from './downgrade-walk.js';
import { analyze } from './downgrade-scope.js';
import { rewrite, PREC, isSimple, prependToBlock, insertAfter } from './downgrade-rewrite.js';

const CLASSES = new Set(['ClassDeclaration', 'ClassExpression']);
const PLAIN_FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression']);

/* узел в поддереве, не заходя во вложенные обычные функции и классы
   (у них свои this, super и new.target) */
function uses(node, test) {
  let hit = null;
  walk(node, {
    enter(n) {
      if (hit) return false;
      if (n !== node && (PLAIN_FUNCTIONS.has(n.type) || CLASSES.has(n.type))) return false;
      if (test(n)) { hit = n; return false; }
    },
  });
  return hit;
}
const isSuper = n => n.type === 'Super';
const isThis = n => n.type === 'ThisExpression';
const isNewTarget = n => n.type === 'MetaProperty' && n.meta.name === 'new';
const isPriv = n => !!n && n.type === 'MemberExpression' && n.property.type === 'PrivateIdentifier';

/* ключ поля для defineProperty */
function fieldKey(m, ctx) {
  if (m.computed) {
    if (m.key.type === 'Literal') return ctx.raw(m.key);
    ctx.fail('pending', m, 'вычисляемый ключ поля класса не понижается', 'classFields');
  }
  if (m.key.type === 'Identifier') return JSON.stringify(m.key.name);
  return ctx.raw(m.key);                       // строковый или числовой литерал
}

/* ── сведения о классе ──────────────────────────────────────────────────── */

function classInfo(cls) {
  const members = cls.body.body;
  const lowered = members.some(m => m.type === 'PropertyDefinition' || m.type === 'StaticBlock' ||
    (m.type === 'MethodDefinition' && m.key.type === 'PrivateIdentifier'));
  if (!lowered) return null;

  const privates = new Map();         // имя → { kind, static, method, get, set, field }
  for (const m of members) {
    if (m.type === 'StaticBlock' || m.key.type !== 'PrivateIdentifier') continue;
    const name = m.key.name;
    const p = privates.get(name) ?? { name, static: m.static };
    if (m.type === 'PropertyDefinition') { p.kind = 'field'; p.field = m; }
    else if (m.kind === 'get' || m.kind === 'set') { p.kind = 'accessor'; p[m.kind] = m; }
    else { p.kind = 'method'; p.method = m; }
    privates.set(name, p);
  }
  return {
    cls, privates,
    ctor: members.find(m => m.type === 'MethodDefinition' && m.kind === 'constructor') ?? null,
    derived: !!cls.superClass,
    names: null,                      // выдаются, когда обход доходит до класса
    init: [],                         // операторы инициализации экземпляра
  };
}

export default {
  id: 'class-members',
  year: 2022,
  features: ['classFields', 'privateFields', 'privateMethods', 'staticBlock', 'privateIn'],
  run(code, ast, { session }) {
    const scope = analyze(ast);

    const infos = new Map();
    walk(ast, { enter(n) { if (CLASSES.has(n.type)) { const i = classInfo(n); if (i) infos.set(n, i); } } });

    const renames = new Map();        // привязка конструктора → новое имя

    /* класс, объявивший приватное имя, видимое в позиции узла */
    function owner(name, n, ctx) {
      let best = null;
      for (const info of infos.values()) {
        const b = info.cls.body;
        if (b.start <= n.start && n.start < b.end && info.privates.has(name))
          if (!best || info.cls.start > best.cls.start) best = info;
      }
      if (!best || !best.names)
        ctx.fail('pending', n, `приватное имя #${name} не объявлено ни одним понижаемым классом`, 'privateFields');
      return { p: best.privates.get(name), nm: best.names.get(name) };
    }

    /* o.#x на чтение; obj — готовый текст объекта */
    function privRead(target, ctx, obj) {
      const { p, nm } = owner(target.property.name, target, ctx);
      if (p.kind === 'field') return `${ctx.helper('privGet')}(${obj}, ${nm.map})`;
      if (p.kind === 'method') return `${ctx.helper('privMethod')}(${obj}, ${nm.brand}, ${nm.method})`;
      return `${ctx.helper('privAccessorGet')}(${obj}, ${nm.brand}, ${nm.get ?? 'void 0'})`;
    }

    function privWrite(target, ctx, obj, value) {
      const { p, nm } = owner(target.property.name, target, ctx);
      if (p.kind === 'field') return `${ctx.helper('privSet')}(${obj}, ${nm.map}, ${value})`;
      if (p.kind === 'method') ctx.fail('pending', target, `запись в приватный метод #${p.name} не понижается`, 'privateMethods');
      return `${ctx.helper('privAccessorSet')}(${obj}, ${nm.brand}, ${nm.set ?? 'void 0'}, ${value})`;
    }

    /* объект, который понадобится дважды: первое вычисление и повтор */
    function objTwice(target, ctx) {
      if (isSimple(target.object) && target.object.type !== 'Super') {
        const t = ctx.expr(target.object, PREC.ASSIGN);
        return { first: t, again: t };
      }
      const t = ctx.temp(target, 'obj');
      return { first: `${t} = ${ctx.expr(target.object, PREC.ASSIGN)}`, again: t };
    }

    /* приватное имя — цель деструктуризации? */
    function patternTarget(n, ctx) {
      const parent = ctx.parentOf(n), key = ctx.keyOf(n);
      if (!parent) return false;
      if (parent.type === 'ArrayPattern' || parent.type === 'RestElement') return true;
      if (parent.type === 'AssignmentPattern') return key === 'left';
      if (parent.type === 'Property') return key === 'value' && ctx.parentOf(parent)?.type === 'ObjectPattern';
      if (parent.type === 'ForOfStatement' || parent.type === 'ForInStatement') return key === 'left';
      return false;
    }

    function inChain(n, ctx) {
      if (n.optional) return true;
      for (let p = ctx.parentOf(n); p; p = ctx.parentOf(p)) {
        if (p.type === 'ChainExpression') return true;
        if (p.type !== 'MemberExpression' && p.type !== 'CallExpression') return false;
      }
      return false;
    }

    const classOf = (member, ctx) => ctx.parentOf(ctx.parentOf(member));

    const visitors = {
      MemberExpression(n, ctx) {
        if (!isPriv(n)) return;
        if (inChain(n, ctx)) ctx.fail('pending', n, `приватное имя #${n.property.name} в цепочке ?. не понижается`, 'privateFields');
        if (patternTarget(n, ctx)) ctx.fail('pending', n, `приватное имя #${n.property.name} как цель деструктуризации не понижается`, 'privateFields');
        return { text: privRead(n, ctx, ctx.expr(n.object, PREC.ASSIGN)), prec: PREC.CALL };
      },

      AssignmentExpression(n, ctx) {
        if (!isPriv(n.left)) return;
        const target = n.left;
        if (inChain(target, ctx)) ctx.fail('pending', target, 'приватное имя в цепочке ?. не понижается', 'privateFields');
        if (n.operator === '=')
          return { text: privWrite(target, ctx, ctx.expr(target.object, PREC.ASSIGN), ctx.expr(n.right, PREC.ASSIGN)), prec: PREC.CALL };
        const o = objTwice(target, ctx);
        const op = n.operator.slice(0, -1);
        if (op === '||' || op === '&&' || op === '??')
          return {
            text: `${privRead(target, ctx, o.first)} ${op} ${privWrite(target, ctx, o.again, ctx.expr(n.right, PREC.ASSIGN))}`,
            prec: PREC.binary(op),
          };
        const right = ctx.expr(n.right, PREC.binary(op) + (op === '**' ? 0 : 1));
        const left = op === '**' ? `(${privRead(target, ctx, o.again)})` : privRead(target, ctx, o.again);
        return { text: privWrite(target, ctx, o.first, `${left} ${op} ${right}`), prec: PREC.CALL };
      },

      UpdateExpression(n, ctx) {
        if (!isPriv(n.argument)) return;
        const target = n.argument;
        const o = objTwice(target, ctx);
        const d = n.operator === '++' ? '+ 1' : '- 1';
        if (n.prefix)
          return { text: privWrite(target, ctx, o.first, `+${privRead(target, ctx, o.again)} ${d}`), prec: PREC.CALL };
        const v = ctx.temp(n, 'old');
        return {
          text: `(${v} = +${privRead(target, ctx, o.first)}, ${privWrite(target, ctx, o.again, `${v} ${d}`)}, ${v})`,
          prec: PREC.PRIMARY,
        };
      },

      CallExpression(n, ctx) {
        if (!isPriv(n.callee)) return;
        if (inChain(n.callee, ctx) || n.optional) ctx.fail('pending', n, 'приватный метод в цепочке ?. не понижается', 'privateMethods');
        /* this.#m(x) — вызов с this = объект */
        const o = objTwice(n.callee, ctx);
        const args = n.arguments.map(a => ctx.expr(a, PREC.ASSIGN));
        return { text: `${privRead(n.callee, ctx, o.first)}.call(${[o.again, ...args].join(', ')})`, prec: PREC.CALL };
      },

      TaggedTemplateExpression(n, ctx) {
        if (isPriv(n.tag)) ctx.fail('pending', n, 'приватный метод как тег шаблона не понижается', 'privateFields');
      },

      BinaryExpression(n, ctx) {
        if (n.operator !== 'in' || n.left.type !== 'PrivateIdentifier') return;
        const { p, nm } = owner(n.left.name, n, ctx);
        return { text: `${ctx.helper('privIn')}(${p.kind === 'field' ? nm.map : nm.brand}, ${ctx.expr(n.right, PREC.ASSIGN)})`, prec: PREC.CALL };
      },

      /* переименования в конструкторе — из-за переехавших инициализаторов */
      Identifier(n, ctx) {
        if (!renames.size) return;
        const b = ctx.scope.bindingOf(n);
        if (!b || !renames.has(b)) return;
        const name = renames.get(b);
        return { text: ctx.scope.shared.get(n) === 'property' ? `${n.name}: ${name}` : name, prec: PREC.PRIMARY };
      },

      /* ── сам класс ── */

      PropertyDefinition(n, ctx) { if (infos.has(classOf(n, ctx))) return { text: '', prec: 0 }; },
      StaticBlock(n, ctx) { if (infos.has(classOf(n, ctx))) return { text: '', prec: 0 }; },

      MethodDefinition(n, ctx) {
        const info = infos.get(classOf(n, ctx));
        if (!info) return;
        if (n.key.type === 'PrivateIdentifier') return { text: '', prec: 0 };
        if (n.kind === 'constructor') return { text: constructorText(n, info, ctx), prec: 0 };
      },

      ClassBody(n, ctx) {
        const info = infos.get(ctx.parentOf(n));
        if (!info || info.ctor || !info.init.length) return;
        /* конструктора нет — заводится свой */
        const r = ctx.splice(n);
        const init = info.init.map(s => s + ';').join(' ');
        const ctor = info.derived
          ? `constructor(...args) { super(...args); ${init} }`
          : `constructor() { ${init} }`;
        return { text: `{ ${ctor}${r.text.slice(1)}`, prec: 0 };
      },

      ClassDeclaration: (n, ctx) => lowerClass(n, ctx),
      ClassExpression: (n, ctx) => lowerClass(n, ctx),
    };

    /* ── понижение класса ── */

    function lowerClass(cls, ctx) {
      const info = infos.get(cls);
      if (!info) return;
      const members = cls.body.body;
      const expr = cls.type === 'ClassExpression';
      const base = cls.id ? cls.id.name : 'class';
      /* имена того, что стоит вокруг класса: у объявления — var перед
         ним, у выражения — временные переменные функции */
      const name = b => (expr ? ctx.temp(cls, b) : ctx.scope.fresh(b));

      const innerName = n => expr && cls.id && uses(n, x => x.type === 'Identifier' &&
        ctx.scope.refs.get(x)?.binding?.scope?.node === cls);

      /* WeakMap на приватное поле, WeakSet-бренды */
      info.names = new Map();
      const pre = [];                    // [имя, значение]
      let brand = null, sbrand = null;
      for (const p of info.privates.values()) {
        const nm = {};
        if (p.kind === 'field') {
          nm.map = name(`${base}_${p.name}`);
          pre.push([nm.map, `new ${ctx.global('WeakMap', cls, 'privateFields')}()`]);
        } else if (p.static) nm.brand = sbrand ??= name(`${base}_static_brand`);
        else nm.brand = brand ??= name(`${base}_brand`);
        info.names.set(p.name, nm);
      }
      if (brand) pre.push([brand, `new ${ctx.global('WeakSet', cls, 'privateMethods')}()`]);
      if (sbrand) pre.push([sbrand, `new ${ctx.global('WeakSet', cls, 'privateMethods')}()`]);

      /* имена функций приватных методов — до того, как отрисуется хоть
         одно тело: методы могут звать друг друга */
      const methods = [];
      for (const p of info.privates.values()) {
        if (p.kind === 'field') continue;
        const nm = info.names.get(p.name);
        for (const slot of ['method', 'get', 'set']) {
          if (!p[slot]) continue;
          nm[slot] = name(`${base}_${p.name}${slot === 'method' ? '' : '_' + slot}`);
          methods.push([nm[slot], p[slot], p.name]);
        }
      }
      for (const [fnName, m, pname] of methods) {
        const bad = uses(m.value, isSuper);
        if (bad) ctx.fail('pending', bad, `super в приватном методе #${pname} не понижается: метод уезжает из класса`, 'privateMethods');
        if (innerName(m.value)) ctx.fail('pending', m, `приватный метод #${pname} ссылается на внутреннее имя класса-выражения`, 'privateMethods');
        const f = m.value;
        pre.push([fnName, `${f.async ? 'async ' : ''}function${f.generator ? '*' : ''} ${ctx.text(f)}`]);
      }

      /* инициализация экземпляра: бренд, затем поля по порядку */
      const fields = members.filter(m => m.type === 'PropertyDefinition' && !m.static);
      for (const m of fields) {
        const nt = m.value && uses(m.value, isNewTarget);
        if (nt) ctx.fail('pending', nt, 'new.target в инициализаторе поля не понижается', 'classFields');
      }
      prepareRenames(info, fields, ctx);
      const init = [];
      const ctorTemps = [];
      if (brand) init.push(`${brand}.add(this)`);
      for (const m of fields) {
        const value = m.value ? ctx.expr(m.value, PREC.ASSIGN) : 'void 0';
        ctorTemps.push(...ctx.takeTemps(m));
        if (m.key.type === 'PrivateIdentifier') init.push(`${info.names.get(m.key.name).map}.set(this, ${value})`);
        else init.push(`${ctx.helper('defineField')}(this, ${fieldKey(m, ctx)}, ${value})`);
      }
      if (ctorTemps.length) init.unshift(`var ${ctorTemps.join(', ')}`);
      info.init = init;

      /* static-часть: после класса, в порядке объявления */
      /* сам класс для static-части: у выражения — временная переменная,
         заводится, только если static-часть есть */
      let selfName = null;
      const self = () => (selfName ??= expr ? ctx.temp(cls, base) : cls.id.name);
      const post = [];
      if (sbrand) post.push(`${sbrand}.add(${self()})`);
      for (const m of members) {
        if (m.type === 'StaticBlock') {
          const bad = uses(m, isSuper);
          if (bad) ctx.fail('pending', bad, 'super в static-блоке не понижается', 'staticBlock');
          if (innerName(m)) ctx.fail('pending', m, 'static-блок ссылается на внутреннее имя класса-выражения', 'staticBlock');
          let block = ctx.splice(m).text;
          block = block.slice(block.indexOf('{'));
          const ts = ctx.takeTemps(m);
          if (ts.length) block = `{ var ${ts.join(', ')};` + block.slice(1);
          post.push(`(function () ${block}).call(${self()})`);
          continue;
        }
        if (m.type !== 'PropertyDefinition' || !m.static) continue;
        let value = 'void 0';
        if (m.value) {
          const bad = uses(m.value, isSuper) || uses(m.value, isNewTarget);
          if (bad) ctx.fail('pending', bad, 'super и new.target в static-поле не понижаются', 'classFields');
          if (innerName(m.value)) ctx.fail('pending', m, 'static-поле ссылается на внутреннее имя класса-выражения', 'classFields');
          const v = ctx.expr(m.value, PREC.ASSIGN);
          const ts = ctx.takeTemps(m);
          value = uses(m.value, isThis) || ts.length
            ? `function () { ${ts.length ? `var ${ts.join(', ')}; ` : ''}return ${v}; }.call(${self()})`
            : v;
        }
        if (m.key.type === 'PrivateIdentifier') post.push(`${info.names.get(m.key.name).map}.set(${self()}, ${value})`);
        else post.push(`${ctx.helper('defineField')}(${self()}, ${fieldKey(m, ctx)}, ${value})`);
      }

      const body = ctx.splice(cls).text;

      if (!expr) {
        const vars = pre.length ? `var ${pre.map(([n, v]) => `${n} = ${v}`).join(',\n  ')};\n` : '';
        return { text: vars + body + post.map(s => `\n${s};`).join(''), prec: 0 };
      }

      /* выражение: всё — в одну последовательность, значение — класс */
      if (!pre.length && !post.length) return { text: body, prec: PREC.PRIMARY };
      const seq = pre.map(([n, v]) => `${n} = ${v}`);
      if (!post.length) seq.push(body);
      else seq.push(`${self()} = ${body}`, ...post, self());
      return { text: `(${seq.join(', ')})`, prec: PREC.PRIMARY };
    }

    /* Имена из инициализаторов полей, которые в конструкторе окажутся
       затенены, — переименовать переменные конструктора. */
    function prepareRenames(info, fields, ctx) {
      if (!info.ctor) return;
      const wanted = new Set();
      for (const m of fields)
        if (m.value) walk(m.value, { enter(n) { if (n.type === 'Identifier' && ctx.scope.refs.has(n)) wanted.add(n.name); } });
      if (!wanted.size) return;
      const fn = info.ctor.value;
      const fnScope = ctx.scope.scopeOf.get(fn);
      const sites = superSites(fn);
      const points = info.derived && sites.length ? sites.map(s => s.start) : [fn.body.start + 1];
      for (const pos of points)
        for (let s = ctx.scope.scopeAt(pos); s; s = s.parent) {
          for (const b of s.bindings.values())
            if (wanted.has(b.name) && !renames.has(b)) renames.set(b, ctx.scope.fresh(b.name));
          if (s === fnScope) break;
        }
    }

    /* вызовы super(…) в теле конструктора — не во вложенных функциях */
    function superSites(fn) {
      const out = [];
      walk(fn.body, {
        enter(n) {
          if (PLAIN_FUNCTIONS.has(n.type) || CLASSES.has(n.type)) return false;
          if (n.type === 'CallExpression' && n.callee.type === 'Super') out.push(n);
        },
      });
      return out;
    }

    /* конструктор с инициализацией полей */
    function constructorText(m, info, ctx) {
      const text = ctx.splice(m).text;
      const init = info.init;
      if (!init.length) return text;
      const stmts = init.map(s => s + ';').join(' ');
      const body = m.value.body;
      const bodyText = ctx.text(body);
      const head = text.slice(0, text.length - bodyText.length);

      if (!info.derived) return head + prependToBlock(bodyText, stmts);

      /* производный класс: поля — сразу после `super(…);`, отдельного
         оператора тела; иначе вставлять некуда без переписывания */
      const sites = superSites(m.value);
      const top = body.body.find(s => s.type === 'ExpressionStatement' && s.expression.type === 'CallExpression' &&
        s.expression.callee.type === 'Super');
      if (sites.length !== 1 || !top)
        ctx.fail('pending', m, 'поля производного класса: super(…) должен быть одним отдельным оператором конструктора', 'classFields');
      const stText = ctx.text(top);
      const at = bodyText.indexOf(stText) + stText.length;
      const semi = stText.trimEnd().endsWith(';') ? '' : ';';
      return head + insertAfter(bodyText.slice(0, at) + semi + bodyText.slice(at), at + semi.length, stmts);
    }

    return rewrite(code, ast, visitors, { session, scope });
  },
};
