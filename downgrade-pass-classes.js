/* ══════════════════════════════════════════════════════════════════════════
   classes — классы (ES2015) → функции-конструкторы

     class A extends B {          var A = (function (_super) {
       constructor(x) {             __dg_inherits(A, _super);
         super(x);                  function A(x) {
         this.x = x;                  __dg_classCheck(this, A);
       }                    →         _super.call(this, x);
       m() { return 1; }              this.x = x;
       static of() {}               }
       get size() { … }             __dg_method(A.prototype, "m", function () { return 1; });
     }                              __dg_method(A, "of", function () {});
                                    __dg_accessor(A.prototype, "size", function () { … }, null);
                                    return A;
                                  })(B);

   Строго, а не «попроще» (решение от 2026-09-23): методы неперечислимые,
   вызов без `new` — TypeError, прототип через Object.create, `super.m()`
   — через прототип родителя с сохранением this. Поля и приватные имена к
   этому моменту уже перенесены в конструктор проходом class-members.

   Чего ES5 не умеет, поэтому — честный отказ (pending):
     · наследование от встроенных (Error, Array, Map): их конструктор
       возвращает свой объект, и `_super.call(this)` его не заменит;
     · конструктор, возвращающий объект, и `new.target`;
     · присваивание в `super.x` (оно пишет в this, а не в прототип);
     · аксессоры в es3 — там нет дескрипторов свойств.

   Чего нет и что заметно: `var A = …` всплывает как undefined, а не
   лежит в мёртвой зоне до объявления.
   ══════════════════════════════════════════════════════════════════════════ */

import { walk } from './downgrade-walk.js';
import { rewrite, PREC, prependToBlock } from './downgrade-rewrite.js';

const PLAIN = new Set(['FunctionDeclaration', 'FunctionExpression']);
const CLASSES = new Set(['ClassDeclaration', 'ClassExpression']);

/* встроенные, наследование от которых в ES5 не воспроизвести */
const BUILTIN_BASES = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'EvalError',
  'ReferenceError', 'URIError', 'AggregateError', 'Array', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Promise', 'RegExp', 'Date', 'Function', 'Object', 'Number', 'String', 'Boolean',
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'ArrayBuffer', 'DataView']);

/* узел в поддереве, не заходя во вложенные функции и классы */
function find(node, test) {
  let hit = null;
  walk(node, {
    enter(n) {
      if (hit) return false;
      if (n !== node && (PLAIN.has(n.type) || CLASSES.has(n.type))) return false;
      if (test(n)) { hit = n; return false; }
    },
  });
  return hit;
}

export default {
  id: 'classes',
  year: 2015,
  features: ['class'],
  run(code, ast, { session, profile }) {
    const info = new Map();            // узел класса → { name, superName }

    function lower(cls, ctx) {
      const members = cls.body.body;
      const name = cls.id ? cls.id.name : ctx.scope.fresh('class');
      const superName = cls.superClass ? ctx.scope.fresh('super') : null;
      info.set(cls, { name, superName });

      for (const m of members) {
        if (m.type !== 'MethodDefinition')
          ctx.fail('pending', m, 'поля класса должны быть перенесены раньше (class-members)', 'class');
        if (m.computed) ctx.fail('pending', m, 'вычисляемое имя метода не понижается', 'class');
        if ((m.kind === 'get' || m.kind === 'set') && profile.es < 5)
          ctx.fail('unsupported', m, 'в ES3 нет аксессоров', 'accessors');
        const nt = find(m.value, n => n.type === 'MetaProperty' && n.meta.name === 'new');
        if (nt) ctx.fail('pending', nt, 'new.target в классе не понижается', 'newTarget');
      }

      if (cls.superClass && cls.superClass.type === 'Identifier' &&
          BUILTIN_BASES.has(cls.superClass.name) && ctx.scope.isGlobalAt(cls.superClass.name, cls.superClass.start))
        ctx.fail('pending', cls.superClass,
          `наследование от встроенного ${cls.superClass.name} в ES5 не воспроизводится`, 'class');

      /* конструктор */
      const ctor = members.find(m => m.kind === 'constructor');
      let ctorText;
      if (ctor) {
        const fn = ctor.value;
        const ret = find(fn.body, n => n.type === 'ReturnStatement' && n.argument);
        if (ret) ctx.fail('pending', ret, 'конструктор, который что-то возвращает, не понижается', 'class');
        const head = ctx.src.slice(fn.start, fn.body.start);
        const check = `${ctx.helper('classCheck')}(this, ${name});`;
        ctorText = `function ${name}${head}${prependToBlock(ctx.text(fn.body), check)}`;
      } else {
        const check = `${ctx.helper('classCheck')}(this, ${name});`;
        ctorText = superName
          ? `function ${name}() { ${check} ${superName}.apply(this, arguments); }`
          : `function ${name}() { ${check} }`;
      }

      /* методы и аксессоры */
      const steps = [];
      if (superName) steps.push(`${ctx.helper('inherits')}(${name}, ${superName});`);
      const accessors = new Map();               // цель + имя → пара get/set
      for (const m of members) {
        if (m.kind === 'constructor') continue;
        const target = m.static ? name : `${name}.prototype`;
        const key = m.key.type === 'Identifier' ? JSON.stringify(m.key.name) : ctx.raw(m.key);
        const fn = `${m.value.async ? 'async ' : ''}function${m.value.generator ? '*' : ''} ${ctx.text(m.value)}`;
        if (m.kind === 'get' || m.kind === 'set') {
          const id = target + '\0' + key;
          if (!accessors.has(id)) accessors.set(id, { get: 'null', set: 'null', target, key });
          accessors.get(id)[m.kind] = fn;
          continue;
        }
        steps.push(`${ctx.helper('method')}(${target}, ${key}, ${fn});`);
      }
      for (const a of accessors.values())
        steps.push(`${ctx.helper('accessor')}(${a.target}, ${a.key}, ${a.get}, ${a.set});`);

      const body = [ctorText, ...steps, `return ${name};`].join('\n');
      const iife = `(function (${superName ?? ''}) {\n${body}\n})(${cls.superClass ? ctx.expr(cls.superClass, PREC.ASSIGN) : ''})`;
      return cls.type === 'ClassExpression'
        ? { text: iife, prec: PREC.PRIMARY }
        : { text: `var ${name} = ${iife};`, prec: 0 };
    }

    /* класс, к которому относится super в этой позиции */
    function ownerOf(n, ctx) {
      for (let p = ctx.parentOf(n); p; p = ctx.parentOf(p)) if (CLASSES.has(p.type)) return info.get(p);
      return null;
    }
    function inStatic(n, ctx) {
      for (let p = ctx.parentOf(n); p; p = ctx.parentOf(p))
        if (p.type === 'MethodDefinition' || p.type === 'PropertyDefinition') return p.static;
      return false;
    }
    const baseOf = (own, n, ctx) => (inStatic(n, ctx) ? own.superName : `${own.superName}.prototype`);

    return rewrite(code, ast, {
      ClassDeclaration: lower,
      ClassExpression: lower,

      CallExpression(n, ctx) {
        const callee = n.callee;
        const isSuperCall = callee.type === 'Super';
        const isSuperMethod = callee.type === 'MemberExpression' && callee.object.type === 'Super';
        if (!isSuperCall && !isSuperMethod) return;
        const own = ownerOf(n, ctx);
        if (!own || !own.superName) ctx.fail('pending', n, 'super вне класса с наследованием', 'class');
        const args = n.arguments.map(a => ctx.expr(a, PREC.ASSIGN));
        if (isSuperCall)
          return { text: `${own.superName}.call(${['this', ...args].join(', ')})`, prec: PREC.CALL };
        const key = callee.computed ? ctx.text(callee.property) : JSON.stringify(callee.property.name);
        const fn = `${ctx.helper('superGet')}(${baseOf(own, n, ctx)}, ${key}, this)`;
        return { text: `${fn}.call(${['this', ...args].join(', ')})`, prec: PREC.CALL };
      },

      AssignmentExpression(n, ctx) {
        if (n.left.type === 'MemberExpression' && n.left.object.type === 'Super')
          ctx.fail('pending', n, 'присваивание в super.x не понижается: оно пишет в this', 'class');
      },

      /* чтение super.x вне вызова */
      MemberExpression(n, ctx) {
        if (n.object.type !== 'Super') return;
        const own = ownerOf(n, ctx);
        if (!own || !own.superName) ctx.fail('pending', n, 'super вне класса с наследованием', 'class');
        const key = n.computed ? ctx.text(n.property) : JSON.stringify(n.property.name);
        return { text: `${ctx.helper('superGet')}(${baseOf(own, n, ctx)}, ${key}, this)`, prec: PREC.CALL };
      },
    }, { session });
  },
};
