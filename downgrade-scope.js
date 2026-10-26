/* ══════════════════════════════════════════════════════════════════════════
   scope.js — области видимости: объявления и ссылки (M1b)

   Поверх AST из parse.js. Отвечает на три вопроса, без которых проходы
   понижения писать нельзя:

     · на что ссылается это имя — на локальное объявление или на
       глобальное? `Math.pow` можно вставить, только если `Math` в этом
       месте не затенён; шим для `Map` нужен, только если `Map` глобальный;

     · какие имена в файле уже заняты — чтобы сгенерированные временные
       переменные (`__dg_ref`) ни с чем не столкнулись;

     · где все вхождения данного объявления — чтобы его можно было
       переименовать, не задев одноимённые переменные во вложенных
       функциях (конфликт имён в линкере, BACKLOG.md §12 п. 23).

   Модель — как в спецификации для строгого кода (модуль строгий всегда):

     module    верхний уровень: import, var, let/const, function, class
     function  параметры + var + всё объявленное на верхнем уровне тела;
               тело функции своей блочной области не заводит
     arrow     то же для стрелки; своих this/arguments у неё нет
     block     let/const/class/function внутри { … } (строгий режим:
               функция в блоке видна только в блоке)
     for       let/const из заголовка for / for-in / for-of
     switch    один блок на все case
     catch     параметр catch вместе с телом обработчика
     class     имя класса изнутри класса (и выражение extends)
     static    static { … } — отдельная функция для var
     field     инициализатор поля класса — отдельная функция

   var всплывает до ближайшей функции (function, arrow, static, module).
   Ссылки разрешаются после того, как собраны все объявления: из-за
   всплытия ссылка может стоять раньше объявления.

   `arguments` без явного объявления — неявная привязка ближайшей
   НЕстрелочной функции; на верхнем уровне модуля — глобальное имя.
   ══════════════════════════════════════════════════════════════════════════ */

import { isNode } from './downgrade-walk.js';

const FUNCTION_LIKE = new Set(['module', 'function', 'arrow', 'static', 'field']);

export class Scope {
  constructor(kind, node, parent) {
    this.kind = kind;
    this.node = node;
    this.parent = parent;
    this.bindings = new Map();
    this.children = [];
    /* куда всплывает var */
    this.fn = FUNCTION_LIKE.has(kind) ? this : parent.fn;
    if (parent) parent.children.push(this);
  }

  /* привязка имени, видимая из этой области, или null — имя глобальное */
  lookup(name) {
    for (let s = this; s; s = s.parent) {
      const b = s.bindings.get(name);
      if (b) return b;
      /* неявный arguments у обычной функции */
      if (name === 'arguments' && s.kind === 'function') return s.implicitArguments();
    }
    return null;
  }

  implicitArguments() {
    if (!this.argumentsBinding) {
      this.argumentsBinding = new Binding('arguments', 'arguments', this);
    }
    return this.argumentsBinding;
  }

  /* ближайшая область с собственными this/arguments: обычная функция,
     static-блок, инициализатор поля или модуль — но не стрелка */
  get thisScope() {
    let s = this;
    while (s.kind !== 'module' && s.kind !== 'function' && s.kind !== 'static' && s.kind !== 'field') s = s.parent;
    return s;
  }
}

export class Binding {
  constructor(name, kind, scope) {
    this.name = name;
    this.kind = kind;        // var | let | const | function | class | param | catch | import | fname | arguments
    this.scope = scope;
    this.ids = [];           // идентификаторы, которые его объявляют
    this.refs = [];          // идентификаторы, которые на него ссылаются
  }
}

/* ── сбор объявлений и ссылок ───────────────────────────────────────────── */

class Collector {
  constructor() {
    this.scopeOf = new Map();       // узел, создающий область → область
    this.pending = [];              // [{ id, scope, write }] — разрешаются в конце
    this.declared = new Map();      // объявляющий идентификатор → привязка
    this.names = new Set();         // все имена-идентификаторы файла
    /* идентификаторы, которые одновременно и имя свойства/экспорта:
       `{ a }`, `import { a }`, `export { a }`. Переименовать такой —
       значит развернуть запись: `{ a: b }`, `import { a as b }`. */
    this.shared = new Map();        // идентификатор → property | import | export
  }

  open(kind, node, parent) {
    const s = new Scope(kind, node, parent);
    this.scopeOf.set(node, s);
    return s;
  }

  declare(id, scope, kind) {
    let b = scope.bindings.get(id.name);
    /* var поверх var, function поверх function, var поверх параметра —
       одна привязка; имя функции-выражения уступает всему остальному */
    if (!b || b.kind === 'fname') {
      b = new Binding(id.name, kind, scope);
      scope.bindings.set(id.name, b);
    }
    b.ids.push(id);
    this.declared.set(id, b);
    this.names.add(id.name);
  }

  ref(id, scope, write = false) {
    this.names.add(id.name);
    this.pending.push({ id, scope, write });
  }

  markShorthand(prop) {
    const v = prop.value.type === 'AssignmentPattern' ? prop.value.left : prop.value;
    this.shared.set(v, 'property');
  }

  /* ── паттерны ── */

  /* Объявляющий паттерн: имена в нём — новые привязки.

     exprScope — где разбирать умолчания и вычисляемые ключи. null — не
     разбирать вовсе: так всплывают let/const и var, чьи выражения потом
     разберёт сам оператор, в своём месте (см. defaults). */
  bindPattern(p, scope, kind, exprScope) {
    if (!p) return;
    const ex = n => { if (exprScope) this.expr(n, exprScope); };
    switch (p.type) {
      case 'Identifier': this.declare(p, scope, kind); break;
      case 'ObjectPattern':
        for (const prop of p.properties) {
          if (prop.type === 'RestElement') { this.bindPattern(prop.argument, scope, kind, exprScope); continue; }
          if (prop.computed) ex(prop.key);
          if (prop.shorthand) this.markShorthand(prop);
          this.bindPattern(prop.value, scope, kind, exprScope);
        }
        break;
      case 'ArrayPattern':
        for (const el of p.elements) this.bindPattern(el, scope, kind, exprScope);
        break;
      case 'RestElement': this.bindPattern(p.argument, scope, kind, exprScope); break;
      case 'AssignmentPattern':
        this.bindPattern(p.left, scope, kind, exprScope);
        ex(p.right);
        break;
      default: throw new Error(`scope: ${p.type} в объявляющем паттерне`);
    }
  }

  /* паттерн присваивания: имена в нём — ссылки на запись */
  writePattern(p, scope) {
    switch (p.type) {
      case 'Identifier': this.ref(p, scope, true); break;
      case 'MemberExpression': this.expr(p, scope); break;
      case 'ObjectPattern':
        for (const prop of p.properties) {
          if (prop.type === 'RestElement') { this.writePattern(prop.argument, scope); continue; }
          if (prop.computed) this.expr(prop.key, scope);
          if (prop.shorthand) this.markShorthand(prop);
          this.writePattern(prop.value, scope);
        }
        break;
      case 'ArrayPattern':
        for (const el of p.elements) if (el) this.writePattern(el, scope);
        break;
      case 'RestElement': this.writePattern(p.argument, scope); break;
      case 'AssignmentPattern':
        this.writePattern(p.left, scope);
        this.expr(p.right, scope);
        break;
      default: this.expr(p, scope);
    }
  }

  /* ── всплытие: объявления списка операторов до разбора ссылок ── */

  hoist(stmts, scope) {
    for (const st of stmts) {
      const d = st.type === 'ExportNamedDeclaration' || st.type === 'ExportDefaultDeclaration'
        ? st.declaration : st;
      if (!d) continue;
      if (d.type === 'FunctionDeclaration' && d.id) this.declare(d.id, scope, 'function');
      else if (d.type === 'ClassDeclaration' && d.id) this.declare(d.id, scope, 'class');
      else if (d.type === 'VariableDeclaration' && d.kind !== 'var')
        for (const decl of d.declarations) this.bindPattern(decl.id, scope, d.kind, null);
    }
  }

  /* var всплывает сквозь блоки — собирается отдельным спуском по телу
     функции, не заходя во вложенные функции */
  hoistVars(node, fnScope) {
    const visit = n => {
      if (!isNode(n)) return;
      switch (n.type) {
        case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression':
        case 'ClassDeclaration': case 'ClassExpression': case 'StaticBlock':
          return;
        case 'VariableDeclaration':
          if (n.kind === 'var') for (const d of n.declarations) this.bindPattern(d.id, fnScope, 'var', null);
          /* инициализаторы — выражения, var внутри них не бывает */
          return;
      }
      for (const k of Object.keys(n)) {
        if (k === 'type' || k === 'start' || k === 'end') continue;
        const v = n[k];
        if (Array.isArray(v)) v.forEach(visit);
        else if (isNode(v)) visit(v);
      }
    };
    visit(node);
  }

  /* ── операторы и выражения ── */

  stmts(list, scope) {
    this.hoist(list, scope);
    for (const st of list) this.node(st, scope);
  }

  expr(n, scope) { if (n) this.node(n, scope); }

  func(fn, scope) {
    const kind = fn.type === 'ArrowFunctionExpression' ? 'arrow' : 'function';
    const s = this.open(kind, fn, scope);
    if (fn.type === 'FunctionExpression' && fn.id) this.declare(fn.id, s, 'fname');
    for (const p of fn.params) this.bindPattern(p, s, 'param', s);
    if (fn.body.type === 'BlockStatement') {
      this.hoistVars(fn.body, s);
      this.scopeOf.set(fn.body, s);          // тело функции — та же область
      this.stmts(fn.body.body, s);
    } else {
      this.expr(fn.body, s);
    }
  }

  cls(c, scope) {
    const s = this.open('class', c, scope);
    /* У объявления класса по спецификации две привязки — снаружи и
       изнутри, — но названы они одним и тем же идентификатором, так что
       переименовать одну без другой нельзя. Поэтому внутренняя заводится
       только у выражения: у объявления ссылки изнутри идут на внешнюю. */
    if (c.id && c.type === 'ClassExpression') this.declare(c.id, s, 'class');
    this.expr(c.superClass, s);
    for (const m of c.body.body) {
      if (m.type === 'StaticBlock') {
        const st = this.open('static', m, s);
        this.hoistVars(m, st);
        this.stmts(m.body, st);
        continue;
      }
      if (m.computed) this.expr(m.key, s);
      if (m.type === 'MethodDefinition') this.func(m.value, s);
      else if (m.value) {
        const f = this.open('field', m, s);
        this.expr(m.value, f);
      }
    }
  }

  node(n, scope) {
    switch (n.type) {
      case 'Program': {
        const s = this.open('module', n, null);
        this.root = s;
        this.hoistVars(n, s);
        for (const st of n.body)
          if (st.type === 'ImportDeclaration')
            for (const sp of st.specifiers) {
              this.declare(sp.local, s, 'import');
              if (sp.type === 'ImportSpecifier' && sp.imported === sp.local) this.shared.set(sp.local, 'import');
            }
        this.stmts(n.body, s);
        return;
      }

      case 'ImportDeclaration': return;
      case 'ExportNamedDeclaration':
        if (n.declaration) this.node(n.declaration, scope);
        else if (!n.source)
          for (const sp of n.specifiers) {
            if (sp.local.type !== 'Identifier') continue;
            this.ref(sp.local, scope);
            if (sp.local === sp.exported) this.shared.set(sp.local, 'export');
          }
        return;
      case 'ExportDefaultDeclaration': this.node(n.declaration, scope); return;
      case 'ExportAllDeclaration': return;

      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression':
        this.func(n, scope); return;
      case 'ClassDeclaration': case 'ClassExpression':
        this.cls(n, scope); return;

      case 'VariableDeclaration':
        for (const d of n.declarations) {
          /* объявления уже собраны всплытием — здесь только выражения */
          this.defaults(d.id, scope);
          this.expr(d.init, scope);
        }
        return;

      case 'BlockStatement': {
        const s = this.open('block', n, scope);
        this.stmts(n.body, s);
        return;
      }
      case 'StaticBlock': return;           // разобран в cls

      case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': {
        const head = n.type === 'ForStatement' ? n.init : n.left;
        let s = scope;
        if (head && head.type === 'VariableDeclaration' && head.kind !== 'var') {
          s = this.open('for', n, scope);
          for (const d of head.declarations) this.bindPattern(d.id, s, head.kind, null);
        }
        if (n.type === 'ForStatement') {
          if (head) {
            if (head.type === 'VariableDeclaration') this.node(head, s);
            else this.expr(head, s);
          }
          this.expr(n.test, s);
          this.expr(n.update, s);
        } else {
          if (head.type === 'VariableDeclaration') this.node(head, s);
          else this.writePattern(head, s);
          this.expr(n.right, s);
        }
        this.node(n.body, s);
        return;
      }

      case 'SwitchStatement': {
        this.expr(n.discriminant, scope);
        const s = this.open('switch', n, scope);
        const all = n.cases.flatMap(c => c.consequent);
        this.hoist(all, s);
        for (const c of n.cases) {
          this.expr(c.test, s);
          for (const st of c.consequent) this.node(st, s);
        }
        return;
      }

      case 'CatchClause': {
        const s = this.open('catch', n, scope);
        if (n.param) this.bindPattern(n.param, s, 'catch', s);
        this.scopeOf.set(n.body, s);
        this.stmts(n.body.body, s);
        return;
      }

      case 'LabeledStatement': this.node(n.body, scope); return;
      case 'BreakStatement': case 'ContinueStatement': return;

      case 'Identifier': this.ref(n, scope); return;

      case 'MemberExpression':
        this.expr(n.object, scope);
        if (n.computed) this.expr(n.property, scope);
        return;

      case 'Property':
        if (n.computed) this.expr(n.key, scope);
        if (n.shorthand) this.markShorthand(n);
        this.expr(n.value, scope);          // у сокращённой записи value === key
        return;

      case 'AssignmentExpression':
        if (n.operator === '=') this.writePattern(n.left, scope);
        else if (n.left.type === 'Identifier') this.ref(n.left, scope, true);
        else this.expr(n.left, scope);
        this.expr(n.right, scope);
        return;

      case 'UpdateExpression':
        if (n.argument.type === 'Identifier') this.ref(n.argument, scope, true);
        else this.expr(n.argument, scope);
        return;

      case 'MetaProperty': case 'PrivateIdentifier': case 'Super': case 'ThisExpression':
      case 'Literal': case 'TemplateElement': case 'EmptyStatement': case 'DebuggerStatement':
        return;
    }

    /* всё остальное — просто спуститься по детям-узлам */
    for (const k of Object.keys(n)) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      const v = n[k];
      if (Array.isArray(v)) { for (const x of v) if (isNode(x)) this.node(x, scope); }
      else if (isNode(v)) this.node(v, scope);
    }
  }

  /* умолчания и вычисляемые ключи в объявляющем паттерне — выражения;
     сами имена уже объявлены всплытием */
  defaults(p, scope) {
    if (!p) return;
    switch (p.type) {
      case 'ObjectPattern':
        for (const prop of p.properties) {
          if (prop.type === 'RestElement') { this.defaults(prop.argument, scope); continue; }
          if (prop.computed) this.expr(prop.key, scope);
          this.defaults(prop.value, scope);
        }
        break;
      case 'ArrayPattern': for (const el of p.elements) this.defaults(el, scope); break;
      case 'RestElement': this.defaults(p.argument, scope); break;
      case 'AssignmentPattern': this.defaults(p.left, scope); this.expr(p.right, scope); break;
    }
  }
}

/* ── результат ──────────────────────────────────────────────────────────── */

export class ScopeInfo {
  constructor(c) {
    this.root = c.root;
    this.scopeOf = c.scopeOf;
    this.names = c.names;
    this.refs = new Map();           // идентификатор-ссылка → { scope, binding, write }
    this.globals = new Map();        // имя → [идентификаторы], не нашедшие объявления
    this.declared = c.declared;
    this.shared = c.shared;

    for (const { id, scope, write } of c.pending) {
      const binding = scope.lookup(id.name);
      this.refs.set(id, { scope, binding, write });
      if (binding) binding.refs.push(id);
      else {
        if (!this.globals.has(id.name)) this.globals.set(id.name, []);
        this.globals.get(id.name).push(id);
      }
    }
    this.used = new Set(this.names);
  }

  /* привязка идентификатора — объявляющего или ссылающегося */
  bindingOf(id) {
    return this.declared.get(id) ?? this.refs.get(id)?.binding ?? null;
  }

  /* самая внутренняя область, содержащая позицию */
  scopeAt(pos) {
    let s = this.root;
    for (;;) {
      const inner = s.children.find(c => c.node.start <= pos && pos < c.node.end);
      if (!inner) return s;
      s = inner;
    }
  }

  /* имя видно в этой позиции как глобальное (не затенено)? */
  isGlobalAt(name, pos) {
    return this.scopeAt(pos).lookup(name) === null;
  }

  /* имя свободно во всём файле: ни объявления, ни ссылки */
  isUnused(name) { return !this.used.has(name); }

  /* Новое имя, которого нет в файле. Детерминировано: зависит только от
     base и уже занятых имён, поэтому два прогона дают одинаковый код. */
  fresh(base) {
    const stem = '__dg_' + base.replace(/[^A-Za-z0-9_$]/g, '_');
    let name = stem;
    for (let i = 2; this.used.has(name); i++) name = stem + i;
    this.used.add(name);
    return name;
  }
}

/* AST → области видимости. */
export function analyze(ast) {
  const c = new Collector();
  c.node(ast, null);
  return new ScopeInfo(c);
}

/* ── переименование ─────────────────────────────────────────────────────── */

/* Текст, в котором привязки переименованы: renames — Map<Binding, имя>.

   Меняются ровно те идентификаторы, что объявляют привязку или ссылаются
   на неё; одноимённые переменные во вложенных функциях, имена свойств и
   метки не трогаются. Сокращённые записи разворачиваются:

     { a }            →  { a: b }
     { a = 1 } = o    →  { a: b = 1 } = o
     import { a }     →  import { a as b }
     export { a }     →  export { b as a }                                 */
export function renameEdits(info, renames) {
  const edits = [];
  for (const [binding, name] of renames) {
    for (const id of [...binding.ids, ...binding.refs]) {
      const shared = info.shared.get(id);
      const text = shared === 'property' ? `${id.name}: ${name}`
        : shared === 'import' ? `${id.name} as ${name}`
        : shared === 'export' ? `${name} as ${id.name}`
        : name;
      edits.push({ start: id.start, end: id.end, text });
    }
  }
  return edits.sort((a, b) => a.start - b.start);
}

/* Применить непересекающиеся правки к тексту. */
export function applyEdits(src, edits) {
  let out = '', pos = 0;
  for (const e of [...edits].sort((a, b) => a.start - b.start)) {
    if (e.start < pos) throw new Error(`правки пересекаются на позиции ${e.start}`);
    out += src.slice(pos, e.start) + e.text;
    pos = e.end;
  }
  return out + src.slice(pos);
}
