/* ══════════════════════════════════════════════════════════════════════════
   generators — `function*` и `yield` (ES2015) → машина состояний

     function* g(a) {          function g(a) {
       var x = yield a;          var x;
       yield x + 1;              return __dg_gen(function (_c) {
     }                             while (1) switch (_c.prev = _c.next) {
                                     case 0:
                                       _c.next = 1;
                                       return _c.yield(a);
                                     case 1:
                                       x = _c.sent;
                                       _c.next = 2;
                                       return _c.yield(x + 1);
                                     default:
                                       return _c.done();
                                   }
                                 }, []);
                               }

   Тело разрезается на куски по каждому `yield`: кусок — это `case`, а
   переход — присваивание `_c.next` и `break` из `switch`. Дальше машину
   крутит помощник `__dg_gen`: он зовёт тело, получает от него значение и
   при следующем `next(v)` кладёт `v` в `_c.sent` и заходит снова.

   **Резать приходится не всё.** Оператор, внутри которого нет ни `yield`,
   ни выхода наружу (`return`, `break` или `continue` за свои пределы),
   выполняется целиком и переносится в `case` как есть — со своими
   комментариями и форматированием. Разбираются только те конструкции, где
   управление и правда уходит между кусками.

   **try.** Области `try` описаны таблицей `[начало, конец, куда прыгать]`
   в номерах `case`; номера растут вместе с текстом, поэтому самая узкая
   подходящая область — она же самая внутренняя. Исключение внутри машины
   ловит помощник и прыгает по таблице; `throw()` снаружи — то же самое.

   Проход идёт **после** block-scoping: к этому моменту все объявления уже
   `var`, циклы обычные, `for-of` разложен в цикл по итератору. Объявления
   поднимаются в объемлющую функцию — тело машины вызывается заново на
   каждый `next()`, и `var` внутри него не пережил бы yield. По той же
   причине `this` и `arguments` запоминаются в объемлющей функции.

   Чего не делается (честный отказ, а не молчаливая подмена):

     · `yield` внутри выражения (`f(yield a)`, `(yield a) + 1`): порядок
       вычисления соседей пришлось бы раскладывать по временным, а это
       отдельная большая работа. Годятся `yield a;`, `x = yield a;`,
       `var x = yield a;`, `return yield a;`;
     · `for-in`, внутри которого есть `yield`: состояние перебора ключей
       между заходами не сохранить;
     · выход (`return`, `break`) из `try`, у которого есть `finally`.

   Отличия, о которых надо знать: `throw()` в генератор, стоящий на
   `yield*`, не передаётся во вложенный итератор, а ловится своей же
   таблицей try; `it.return(v)` не выполняет `finally`.
   ══════════════════════════════════════════════════════════════════════════ */

import { walk } from './downgrade-walk.js';
import { analyze } from './downgrade-scope.js';
import { rewrite, PREC } from './downgrade-rewrite.js';

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const LOOPS = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);
const MARK = String.fromCharCode(0);

/* есть ли yield в этом куске (в чужие функции не заходим) */
function hasYield(node) {
  let hit = false;
  walk(node, {
    enter(n) {
      if (hit || FUNCTIONS.has(n.type)) return false;
      if (n.type === 'YieldExpression') { hit = true; return false; }
    },
  });
  return hit;
}

/* Уходит ли управление за пределы куска. `return` — всегда; `break` и
   `continue` — если цель объявлена снаружи. Цель ищется по цепочке
   родителей: пока идём вверх до самого куска, должен встретиться свой
   цикл, switch или метка. */
function escapes(node) {
  const parent = new Map();
  const found = [];
  walk(node, {
    enter(n, p) {
      if (FUNCTIONS.has(n.type) && n !== node) return false;
      parent.set(n, p);
      if (n.type === 'ReturnStatement' || n.type === 'BreakStatement' || n.type === 'ContinueStatement') found.push(n);
    },
  });
  for (const n of found) {
    if (n.type === 'ReturnStatement') return true;
    let ok = false;
    for (let p = parent.get(n); p && !ok; p = parent.get(p)) {
      if (n.label) ok = p.type === 'LabeledStatement' && p.label.name === n.label.name;
      else if (n.type === 'ContinueStatement') ok = LOOPS.has(p.type);
      else ok = LOOPS.has(p.type) || p.type === 'SwitchStatement';
      if (p === node) break;
    }
    if (!ok) return true;
  }
  return false;
}

/* ── куски и переходы ───────────────────────────────────────────────────── */

class Flow {
  constructor(c) {
    this.c = c;
    this.blocks = [];
    this.labels = [];
    this.tries = [];
    this.depth = 0;                 // сколько try над нами
    this.cur = null;
  }

  label() { const l = { k: this.labels.length, id: null }; this.labels.push(l); return l; }
  ref(l) { return MARK + l.k + MARK; }

  /* Начать кусок: номер он получает по месту в тексте. Пустой кусок не
     заводится — метка достаётся уже начатому, иначе на каждый вложенный
     try приходился бы пустой case. Внутри try кусок ещё и отмечается
     в `prev`: по нему помощник ищет обработчик, а одного `prev` на весь
     заход мало — исключение могло случиться в куске, куда провалились. */
  start(l = this.label()) {
    if (this.cur && !this.cur.lines.length && this.blocks[this.blocks.length - 1] === this.cur) {
      l.id = this.blocks.length - 1;
      return l;
    }
    l.id = this.blocks.length;
    this.blocks.push({ lines: [] });
    this.cur = this.blocks[this.blocks.length - 1];
    if (this.depth > 0) this.emit(`${this.c}.prev = ${l.id};`);
    return l;
  }

  emit(text) { this.cur.lines.push(text); }
  jump(l) { this.emit(`${this.c}.next = ${this.ref(l)}; break;`); }

  print(pad) {
    return this.fill(this.blocks.map((b, i) => `${pad}case ${i}:\n` +
      b.lines.map(l => l.split('\n').map(x => pad + '  ' + x).join('\n')).join('\n')).join('\n'));
  }

  triesText() {
    return this.fill('[' + this.tries
      .map(t => `[${this.ref(t[0])}, ${this.ref(t[1])}, ${this.ref(t[2])}]`).join(', ') + ']');
  }

  /* подставить номера вместо меток */
  fill(text) {
    return text.replace(new RegExp(MARK + '(\\d+)' + MARK, 'g'), (_, k) => {
      const id = this.labels[+k].id;
      if (id === null) throw new Error('generators: метка без места');
      return String(id);
    });
  }
}

export default {
  id: 'generators',
  year: 2015,
  features: ['generator'],
  run(code, ast, { session }) {
    const scope = analyze(ast);

    /* чьи это this и arguments: ближайшая функция, у которой они свои */
    const owner = new Map();
    const stack = [];
    walk(ast, {
      enter(n) {
        if (FUNCTIONS.has(n.type) && n.type !== 'ArrowFunctionExpression') stack.push(n);
        if (n.type === 'ThisExpression' || (n.type === 'Identifier' && n.name === 'arguments'))
          owner.set(n, stack[stack.length - 1] ?? null);
      },
      leave(n) { if (FUNCTIONS.has(n.type) && n.type !== 'ArrowFunctionExpression') stack.pop(); },
    });

    /* генераторам, которым это нужно, — по имени на каждое */
    const captured = new Map();
    for (const [n, fn] of owner) {
      if (!fn || !fn.generator) continue;
      if (!captured.has(fn)) captured.set(fn, {});
      const cap = captured.get(fn);
      if (n.type === 'ThisExpression') cap.self ??= scope.fresh('this');
      else cap.args ??= scope.fresh('args');
    }

    function lower(fn, ctx) {
      if (!fn.generator) return;
      if (fn.async) ctx.fail('pending', fn, 'async-генератор не понижается', 'asyncIteration');
      for (const p of fn.params)
        if (p.type !== 'Identifier')
          ctx.fail('pending', p, 'сложный параметр генератора должен быть понижен раньше', 'generator');

      const c = ctx.scope.fresh('c');
      const flow = new Flow(c);
      const hoisted = [];                 // имена, поднятые в объемлющую функцию
      const before = [];                  // объявления функций
      const temp = () => { const t = ctx.scope.fresh('t'); hoisted.push(t); return t; };
      const text = n => ctx.text(n);
      const targets = [];                 // куда уходят break и continue

      const simpleTarget = n => n.type === 'Identifier' ||
        (n.type === 'MemberExpression' && !n.optional &&
         (n.object.type === 'Identifier' || n.object.type === 'ThisExpression') &&
         (!n.computed || n.property.type === 'Literal' || n.property.type === 'Identifier'));

      const failYield = node => ctx.fail('pending', node,
        'yield внутри выражения не понижается — годятся `yield a;`, `x = yield a;`, ' +
        '`var x = yield a;`, `return yield a;`', 'generator');

      /* yield: отдать значение и продолжить с нового куска */
      function emitYield(y, assignTo) {
        const next = flow.label();
        if (y.delegate) {
          /* yield* — крутим вложенный итератор, пока он не кончится */
          const it = temp(), step = temp();
          flow.emit(`${it} = ${ctx.helper('iter')}(${text(y.argument)});`);
          const loop = flow.start();
          flow.emit(`${step} = ${it}.next(${c}.sent);`);
          flow.emit(`if (${step}.done) { ${c}.sent = ${step}.value; ${c}.next = ${flow.ref(next)}; break; }`);
          flow.emit(`${c}.next = ${flow.ref(loop)};`);
          flow.emit(`return ${c}.yield(${step}.value);`);
        } else {
          flow.emit(`${c}.next = ${flow.ref(next)};`);
          flow.emit(`return ${c}.yield(${y.argument ? text(y.argument) : 'undefined'});`);
        }
        flow.start(next);
        if (assignTo) flow.emit(`${assignTo} = ${c}.sent;`);
      }

      const findTarget = (kind, label) => {
        for (let i = targets.length - 1; i >= 0; i--) {
          const t = targets[i];
          const dest = kind === 'continue' ? t.cont : t.brk;
          if (!dest) continue;
          if (label ? t.label === label : true) return dest;
        }
        return null;
      };

      const emitList = list => { for (const st of list) emitStatement(st); };

      function emitStatement(st, label = null) {
        /* кусок, который выполняется целиком, переносится как есть */
        if (st.type !== 'VariableDeclaration' && st.type !== 'FunctionDeclaration' &&
            !hasYield(st) && !escapes(st)) {
          flow.emit(text(st));
          return;
        }

        switch (st.type) {
          case 'FunctionDeclaration':
            before.push(text(st));
            return;

          case 'VariableDeclaration':
            for (const d of st.declarations) {
              if (d.id.type !== 'Identifier')
                ctx.fail('pending', d, 'образец в объявлении внутри генератора не понижается', 'generator');
              if (!hoisted.includes(d.id.name)) hoisted.push(d.id.name);
              if (!d.init) continue;
              if (d.init.type === 'YieldExpression') emitYield(d.init, d.id.name);
              else if (hasYield(d.init)) failYield(d.init);
              else flow.emit(`${d.id.name} = ${ctx.expr(d.init, PREC.ASSIGN)};`);
            }
            return;

          case 'ExpressionStatement': {
            const e = st.expression;
            if (e.type === 'YieldExpression') { emitYield(e, null); return; }
            if (e.type === 'AssignmentExpression' && e.operator === '=' &&
                e.right.type === 'YieldExpression' && simpleTarget(e.left)) {
              emitYield(e.right, text(e.left));
              return;
            }
            failYield(e);
            return;
          }

          case 'ReturnStatement':
            if (!st.argument) { flow.emit(`return ${c}.done();`); return; }
            if (st.argument.type === 'YieldExpression') {
              const t = temp();
              emitYield(st.argument, t);
              flow.emit(`return ${c}.done(${t});`);
              return;
            }
            if (hasYield(st.argument)) failYield(st.argument);
            flow.emit(`return ${c}.done(${ctx.expr(st.argument, PREC.SEQUENCE)});`);
            return;

          case 'ThrowStatement':
            if (hasYield(st.argument)) failYield(st.argument);
            flow.emit(text(st));
            return;

          case 'BlockStatement':
            emitList(st.body);
            return;

          case 'IfStatement': {
            const other = flow.label(), end = st.alternate ? flow.label() : other;
            flow.emit(`if (!(${text(st.test)})) { ${c}.next = ${flow.ref(other)}; break; }`);
            emitStatement(st.consequent);
            if (st.alternate) {
              flow.jump(end);
              flow.start(other);
              emitStatement(st.alternate);
              flow.start(end);
            } else flow.start(other);
            return;
          }

          case 'WhileStatement': {
            const head = flow.start(), end = flow.label();
            flow.emit(`if (!(${text(st.test)})) { ${c}.next = ${flow.ref(end)}; break; }`);
            targets.push({ label, brk: end, cont: head });
            emitStatement(st.body);
            targets.pop();
            flow.jump(head);
            flow.start(end);
            return;
          }

          case 'DoWhileStatement': {
            const body = flow.start(), test = flow.label(), end = flow.label();
            targets.push({ label, brk: end, cont: test });
            emitStatement(st.body);
            targets.pop();
            flow.start(test);
            flow.emit(`if (${text(st.test)}) { ${c}.next = ${flow.ref(body)}; break; }`);
            flow.start(end);
            return;
          }

          case 'ForStatement': {
            if (st.init) {
              if (st.init.type === 'VariableDeclaration') emitStatement(st.init);
              else flow.emit(`${ctx.expr(st.init, PREC.SEQUENCE)};`);
            }
            const head = flow.start(), step = flow.label(), end = flow.label();
            if (st.test) flow.emit(`if (!(${text(st.test)})) { ${c}.next = ${flow.ref(end)}; break; }`);
            targets.push({ label, brk: end, cont: step });
            emitStatement(st.body);
            targets.pop();
            flow.start(step);
            if (st.update) flow.emit(`${ctx.expr(st.update, PREC.SEQUENCE)};`);
            flow.jump(head);
            flow.start(end);
            return;
          }

          case 'SwitchStatement': {
            const t = temp(), end = flow.label();
            flow.emit(`${t} = ${ctx.expr(st.discriminant, PREC.ASSIGN)};`);
            const arms = st.cases.map(() => flow.label());
            let fallback = end;
            st.cases.forEach((cs, i) => {
              if (!cs.test) { fallback = arms[i]; return; }
              if (hasYield(cs.test)) failYield(cs.test);
              flow.emit(`if (${t} === ${ctx.expr(cs.test, PREC.UNARY)}) { ${c}.next = ${flow.ref(arms[i])}; break; }`);
            });
            flow.jump(fallback);
            targets.push({ label, brk: end, cont: null });
            st.cases.forEach((cs, i) => { flow.start(arms[i]); emitList(cs.consequent); });
            targets.pop();
            flow.start(end);
            return;
          }

          case 'LabeledStatement':
            if (LOOPS.has(st.body.type) || st.body.type === 'SwitchStatement') {
              emitStatement(st.body, st.label.name);
              return;
            } else {
              const end = flow.label();
              targets.push({ label: st.label.name, brk: end, cont: null });
              emitStatement(st.body);
              targets.pop();
              flow.start(end);
              return;
            }

          case 'BreakStatement': case 'ContinueStatement': {
            const kind = st.type === 'BreakStatement' ? 'break' : 'continue';
            const dest = findTarget(kind, st.label && st.label.name);
            if (!dest) ctx.fail('pending', st, `${kind} внутри генератора не находит куда`, 'generator');
            flow.jump(dest);
            return;
          }

          case 'TryStatement': {
            if (st.finalizer && escapes(st.block))
              ctx.fail('pending', st,
                'выход из try, у которого есть finally, внутри генератора не понижается', 'generator');
            const catchL = st.handler ? flow.label() : null;
            const finallyL = st.finalizer ? flow.label() : null;
            const end = flow.label();
            const startL = flow.start();

            if (catchL) flow.tries.push([startL, catchL, catchL]);
            if (finallyL) flow.tries.push([startL, finallyL, finallyL]);

            flow.depth++;
            flow.emit(`${c}.prev = ${startL.id};`);
            emitStatement(st.block);
            flow.depth--;
            flow.jump(finallyL ?? end);

            if (catchL) {
              flow.start(catchL);
              if (st.handler.param) {
                if (st.handler.param.type !== 'Identifier')
                  ctx.fail('pending', st.handler.param,
                    'образец в catch внутри генератора не понижается', 'generator');
                if (!hoisted.includes(st.handler.param.name)) hoisted.push(st.handler.param.name);
                flow.emit(`${st.handler.param.name} = ${c}.pending.e;`);
              }
              flow.emit(`${c}.pending = null;`);
              emitStatement(st.handler.body);
              flow.jump(finallyL ?? end);
            }

            if (finallyL) {
              const err = temp();
              flow.start(finallyL);
              emitStatement(st.finalizer);
              flow.emit(`if (${c}.pending) { ${err} = ${c}.pending.e; ${c}.pending = null; throw ${err}; }`);
              flow.jump(end);
            }

            flow.start(end);
            return;
          }

          case 'ForInStatement':
            ctx.fail('pending', st,
              'for-in с yield внутри не понижается: состояние перебора ключей не сохранить', 'generator');
            return;

          case 'EmptyStatement':
            return;

          default:
            ctx.fail('pending', st, `${st.type} с yield внутри не понижается`, 'generator');
        }
      }

      /* ── сборка ── */

      flow.start();                                   // case 0
      emitList(fn.body.body);
      flow.emit(`return ${c}.done();`);

      const cap = captured.get(fn) ?? {};
      const prologue = [];
      if (hoisted.length) prologue.push(`var ${hoisted.join(', ')};`);
      if (cap.self) prologue.push(`var ${cap.self} = this;`);
      if (cap.args) prologue.push(`var ${cap.args} = arguments;`);
      prologue.push(...before);

      const params = fn.params.map(p => p.name).join(', ');
      return {
        text: [
          `function${fn.id ? ' ' + fn.id.name : ''}(${params}) {`,
          ...prologue.map(l => '  ' + l),
          `  return ${ctx.helper('gen')}(function (${c}) {`,
          `    while (1) switch (${c}.prev = ${c}.next) {`,
          flow.print('      '),
          '      default:',
          `        return ${c}.done();`,
          '    }',
          `  }, ${flow.triesText()});`,
          '}',
        ].join('\n'),
        prec: fn.type === 'FunctionDeclaration' ? 0 : PREC.PRIMARY,
      };
    }

    return rewrite(code, ast, {
      FunctionDeclaration: lower,
      FunctionExpression: lower,

      /* this и arguments генератора уезжают в объемлющую функцию */
      ThisExpression(n) {
        const cap = captured.get(owner.get(n));
        return cap?.self ? { text: cap.self, prec: PREC.PRIMARY } : undefined;
      },
      Identifier(n, ctx) {
        if (n.name !== 'arguments') return;
        const cap = captured.get(owner.get(n));
        if (!cap?.args) return;
        const p = ctx.parentOf(n);
        if (p && ((p.type === 'MemberExpression' && p.property === n && !p.computed) ||
                  (p.type === 'Property' && p.key === n && !p.computed))) return;
        return { text: cap.args, prec: PREC.PRIMARY };
      },
    }, { session, scope });
  },
};
