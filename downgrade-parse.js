/* ══════════════════════════════════════════════════════════════════════════
   parse.js — рекурсивно-нисходящий парсер ES2025 → ESTree-совместимый AST

   Поверх готового токенизатора. Имена узлов и полей — как в ESTree, чтобы
   любой, кто видел Babel или acorn, читал этот AST без словаря.

   У КАЖДОГО узла есть start и end — абсолютные смещения в исходнике, и это
   главное свойство для всего остального пайплайна. Проходы понижения не
   будут печатать файл заново из AST: они будут заменять ТЕКСТ в диапазонах
   узлов, как это уже делает линкер. Отсюда два следствия:

     · комментарии и форматирование вне заменённых мест переживают сборку
       нетронутыми — без «прикрепления комментариев к узлам», на котором
       спотыкаются все принтеры;
     · принтер нужен только для тех поддеревьев, которые проход построил
       сам, а не для всего файла.

   Что разбирается: весь синтаксис ES2025, встречающийся в живом коде, —
   классы с приватными полями и статическими блоками, деструктуризация,
   optional chaining, генераторы, async/await, шаблоны, регулярные
   выражения, BigInt, модули.

   Чего НЕТ: аннотаций TypeScript (нужны для @ts-целей, M5), JSX, легаси
   вроде `with`. Про это парсер говорит вслух, а не разбирает наугад.

   Регулярку от деления отличает токенизатор, по предыдущему токену. Когда
   парсер видит `/` там, где ждёт операнд, он не молчит: это значит, что
   эвристика соврала, и лучше упасть с внятной ошибкой, чем разобрать файл
   не так.
   ══════════════════════════════════════════════════════════════════════════ */

import { tokenize, splitTemplate } from './downgrade-tokenize.js';
import * as TS from './downgrade-typescript.js';

export class ParseError extends Error {
  constructor(msg, src, pos) {
    let line = 1, col = 1;
    for (let i = 0; i < pos && i < src.length; i++) {
      if (src[i] === '\n') { line++; col = 1; } else col++;
    }
    super(`${msg} (${line}:${col})`);
    this.name = 'ParseError';
    this.line = line;
    this.column = col;
    this.pos = pos;
  }
}

/* приоритеты бинарных операторов: больше — сильнее связывает */
const BINARY = new Map(Object.entries({
  '??': 1,
  '||': 2, '&&': 3,
  '|': 4, '^': 5, '&': 6,
  '==': 7, '!=': 7, '===': 7, '!==': 7,
  '<': 8, '>': 8, '<=': 8, '>=': 8, 'in': 8, 'instanceof': 8,
  '<<': 9, '>>': 9, '>>>': 9,
  '+': 10, '-': 10,
  '*': 11, '/': 11, '%': 11,
  '**': 12,
}));

const LOGICAL = new Set(['||', '&&', '??']);
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=',
  '>>>=', '&=', '|=', '^=', '&&=', '||=', '??=']);
const UNARY = new Set(['-', '+', '!', '~', 'typeof', 'void', 'delete']);

/* слова, после которых `{` — это блок, а не литерал объекта */
const RESERVED_VALUE = new Set(['true', 'false', 'null']);

/* Зарезервированные слова модуля. Модуль всегда строгий, поэтому сюда
   входят и слова, зарезервированные только в строгом режиме (`let`,
   `static`, `implements`…), и `await`.

   Именем переменной, параметра, метки или ссылкой они быть не могут, а
   именем свойства — могут: `o.default`, `{ class: 1 }`, `import { default
   as x }`. Поэтому проверка стоит в parseIdentifier, а parseIdentifierName
   её не делает. Без неё `function f(default) {}` разбирался как обычная
   функция, и артефакт из такого исходника не загружался. */
const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with',
  'yield', 'await', 'let', 'static', 'implements', 'interface', 'package',
  'private', 'protected', 'public',
]);

class Parser {
  /* inGen / inAsync — внутри генератора / async-функции ли мы сейчас.
     От этого зависит, что такое `yield` и `await`: оператор или
     зарезервированное слово. Верхний уровень модуля — async-контекст:
     там законен top-level await. */
  constructor(src, { from = 0, to = src.length, inGen = false, inAsync = true, ts = false } = {}) {
    this.src = src;
    this.toks = tokenize(src, { from, to });
    this.i = 0;
    this.end = to;
    this.inGen = inGen;
    this.inAsync = inAsync;
    this.ts = ts;             // разбирать ли типы TypeScript
    this.tsRanges = [];       // где они лежат: [начало, конец)
  }

  /* разобрать тело функции в её собственном контексте */
  withContext(inGen, inAsync, fn) {
    const saved = [this.inGen, this.inAsync];
    this.inGen = inGen;
    this.inAsync = inAsync;
    try { return fn(); }
    finally { [this.inGen, this.inAsync] = saved; }
  }

  /* ── работа с потоком ─────────────────────────────────────────────────── */

  peek(k = 0) { return this.toks[this.i + k]; }
  get cur() { return this.toks[this.i]; }
  get done() { return this.i >= this.toks.length; }

  /* позиция для сообщений об ошибке */
  get pos() { return this.cur ? this.cur.s : this.end; }

  is(v, k = 0) {
    const t = this.toks[this.i + k];
    return !!t && (t.t === 'punct' || t.t === 'name') && t.v === v;
  }
  isName(k = 0) { const t = this.toks[this.i + k]; return !!t && t.t === 'name'; }

  next() { return this.toks[this.i++]; }

  eat(v) { if (this.is(v)) { this.i++; return true; } return false; }

  expect(v) {
    if (!this.is(v)) this.fail(`ожидалось «${v}», встречено ${this.describe()}`);
    return this.next();
  }

  describe() {
    const t = this.cur;
    if (!t) return 'конец файла';
    if (t.t === 'punct' && t.v === '/')
      return '«/» — токенизатор принял его за деление; если это регулярное выражение, эвристика соврала';
    return `«${t.v}»`;
  }

  fail(msg, pos = this.pos) { throw new ParseError(msg, this.src, pos); }

  /* точка с запятой по правилам ASI */
  semicolon() {
    if (this.eat(';')) return;
    if (this.done || this.is('}') || this.cur.nl) return;
    this.fail(`ожидалась «;», встречено ${this.describe()}`);
  }

  node(type, start, fields) { return { type, start, end: this.prevEnd(), ...fields }; }
  prevEnd() { return this.toks[this.i - 1] ? this.toks[this.i - 1].e : this.end; }

  /* ── программа ────────────────────────────────────────────────────────── */

  parseProgram() {
    const body = [];
    while (!this.done) body.push(this.parseStatement());
    return { type: 'Program', start: 0, end: this.src.length, body, sourceType: 'module',
      tsRanges: this.tsRanges.sort((a, b) => a[0] - b[0]) };
  }

  /* ── операторы ────────────────────────────────────────────────────────── */

  parseStatement() {
    const t = this.cur;
    if (!t) this.fail('неожиданный конец файла');
    const start = t.s;

    if (this.ts) { const typed = TS.typeStatement(this); if (typed) return typed; }

    if (t.t === 'punct') {
      if (t.v === '{') return this.parseBlock();
      if (t.v === ';') { this.next(); return this.node('EmptyStatement', start, {}); }
    }

    if (t.t === 'name') switch (t.v) {
      case 'const': case 'let': case 'var':
        /* `let` — не всегда объявление: `let` как имя тоже бывает */
        if (t.v !== 'let' || this.startsBinding(1)) {
          const d = this.parseVarDeclaration();
          this.semicolon();
          d.end = this.prevEnd();
          return d;
        }
        break;
      case 'function': return this.parseFunction({ statement: true });
      case 'class': return this.parseClass({ statement: true });
      case 'if': return this.parseIf();
      case 'for': return this.parseFor();
      case 'while': return this.parseWhile();
      case 'do': return this.parseDoWhile();
      case 'switch': return this.parseSwitch();
      case 'try': return this.parseTry();
      case 'throw': {
        this.next();
        if (this.cur && this.cur.nl) this.fail('перевод строки после throw');
        const argument = this.parseExpression();
        this.semicolon();
        return this.node('ThrowStatement', start, { argument });
      }
      case 'return': {
        this.next();
        let argument = null;
        if (!this.is(';') && !this.is('}') && !this.done && !this.cur.nl)
          argument = this.parseExpression();
        this.semicolon();
        return this.node('ReturnStatement', start, { argument });
      }
      case 'break': case 'continue': {
        const kind = t.v === 'break' ? 'BreakStatement' : 'ContinueStatement';
        this.next();
        let label = null;
        if (this.isName() && !this.cur.nl && !RESERVED_VALUE.has(this.cur.v))
          label = this.parseIdentifier();
        this.semicolon();
        return this.node(kind, start, { label });
      }
      case 'debugger':
        this.next(); this.semicolon();
        return this.node('DebuggerStatement', start, {});
      case 'import':
        if (!this.is('(', 1) && !this.is('.', 1)) return this.parseImport();
        break;
      case 'export': return this.parseExport();
      case 'async':
        if (this.is('function', 1) && !this.peek(1).nl)
          return this.parseFunction({ statement: true, async: true });
        break;
      case 'with':
        this.fail('оператор `with` не поддерживается');
        break;
    }

    /* метка: `имя:` */
    if (t.t === 'name' && this.is(':', 1)) {
      const label = this.parseIdentifier();
      this.expect(':');
      const body = this.parseStatement();
      return this.node('LabeledStatement', start, { label, body });
    }

    const expression = this.parseExpression();
    this.semicolon();
    return this.node('ExpressionStatement', start, { expression });
  }

  /* после `let` идёт связывание, а не что-то другое? */
  startsBinding(k) {
    const t = this.peek(k);
    if (!t) return false;
    if (t.t === 'name') return !RESERVED_VALUE.has(t.v);
    return t.t === 'punct' && (t.v === '[' || t.v === '{');
  }

  parseBlock() {
    const start = this.expect('{').s;
    const body = [];
    while (!this.is('}')) {
      if (this.done) this.fail('блок не закрыт', start);
      body.push(this.parseStatement());
    }
    this.expect('}');
    return this.node('BlockStatement', start, { body });
  }

  parseVarDeclaration({ noIn = false } = {}) {
    const start = this.cur.s;
    const kind = this.next().v;
    const declarations = [];
    do {
      const dStart = this.pos;
      const id = this.parseBindingTarget();
      TS.optionalMark(this);
      TS.annotation(this);
      let init = null;
      if (this.eat('=')) init = this.parseAssign({ noIn });
      declarations.push(this.node('VariableDeclarator', dStart, { id, init }));
    } while (this.eat(','));
    return this.node('VariableDeclaration', start, { kind, declarations });
  }

  parseIf() {
    const start = this.expect('if').s;
    this.expect('(');
    const test = this.parseExpression();
    this.expect(')');
    const consequent = this.parseStatement();
    const alternate = this.eat('else') ? this.parseStatement() : null;
    return this.node('IfStatement', start, { test, consequent, alternate });
  }

  parseWhile() {
    const start = this.expect('while').s;
    this.expect('(');
    const test = this.parseExpression();
    this.expect(')');
    const body = this.parseStatement();
    return this.node('WhileStatement', start, { test, body });
  }

  parseDoWhile() {
    const start = this.expect('do').s;
    const body = this.parseStatement();
    this.expect('while');
    this.expect('(');
    const test = this.parseExpression();
    this.expect(')');
    this.eat(';');
    return this.node('DoWhileStatement', start, { body, test });
  }

  parseFor() {
    const start = this.expect('for').s;
    const isAwait = this.inAsync && this.eat('await');
    this.expect('(');

    let init = null;
    if (!this.is(';')) {
      if ((this.is('const') || this.is('var') ||
           (this.is('let') && this.startsBinding(1))))
        init = this.parseVarDeclaration({ noIn: true });
      else
        init = this.parseExpression({ noIn: true });
    }

    /* for-of / for-in */
    if (this.is('of') || this.is('in')) {
      const kind = this.next().v === 'of' ? 'ForOfStatement' : 'ForInStatement';
      const left = init.type === 'VariableDeclaration' ? init : this.toPattern(init);
      const right = kind === 'ForOfStatement' ? this.parseAssign() : this.parseExpression();
      this.expect(')');
      const body = this.parseStatement();
      const fields = { left, right, body };
      if (kind === 'ForOfStatement') fields.await = isAwait;
      return this.node(kind, start, fields);
    }

    if (isAwait) this.fail('`for await` бывает только с `of`', start);

    this.expect(';');
    const test = this.is(';') ? null : this.parseExpression();
    this.expect(';');
    const update = this.is(')') ? null : this.parseExpression();
    this.expect(')');
    const body = this.parseStatement();
    return this.node('ForStatement', start, { init, test, update, body });
  }

  parseSwitch() {
    const start = this.expect('switch').s;
    this.expect('(');
    const discriminant = this.parseExpression();
    this.expect(')');
    this.expect('{');

    const cases = [];
    while (!this.is('}')) {
      if (this.done) this.fail('switch не закрыт', start);
      const cStart = this.pos;
      let test = null;
      if (this.eat('case')) test = this.parseExpression();
      else this.expect('default');
      this.expect(':');
      const consequent = [];
      while (!this.is('case') && !this.is('default') && !this.is('}'))
        consequent.push(this.parseStatement());
      cases.push(this.node('SwitchCase', cStart, { test, consequent }));
    }
    this.expect('}');
    return this.node('SwitchStatement', start, { discriminant, cases });
  }

  parseTry() {
    const start = this.expect('try').s;
    const block = this.parseBlock();

    let handler = null;
    if (this.is('catch')) {
      const hStart = this.next().s;
      let param = null;
      if (this.eat('(')) { param = this.parseBindingTarget(); TS.annotation(this); this.expect(')'); }
      const body = this.parseBlock();
      handler = this.node('CatchClause', hStart, { param, body });
    }

    const finalizer = this.eat('finally') ? this.parseBlock() : null;
    if (!handler && !finalizer) this.fail('try без catch и finally', start);
    return this.node('TryStatement', start, { block, handler, finalizer });
  }

  /* ── модули ───────────────────────────────────────────────────────────── */

  parseImport() {
    const start = this.expect('import').s;
    const specifiers = [];
    /* `import type X from …` — импорт ради типов: в коде его не будет,
       и в дерево сборки он тоже не входит */
    const typeOnly = this.ts && this.is('type') && !this.is('from', 1) && !this.is(',', 1);
    if (typeOnly) this.next();

    if (this.cur.t === 'str') {
      const source = this.parseLiteral();
      const attributes = this.parseImportAttributes();
      this.semicolon();
      return this.node('ImportDeclaration', start, { specifiers, source, attributes });
    }

    if (this.isName() && !this.is('from')) {
      const local = this.parseIdentifier();
      specifiers.push({ type: 'ImportDefaultSpecifier', start: local.start, end: local.end, local });
      this.eat(',');
    }

    if (this.is('*')) {
      const sStart = this.next().s;
      this.expect('as');
      const local = this.parseIdentifier();
      specifiers.push(this.node('ImportNamespaceSpecifier', sStart, { local }));
    } else if (this.eat('{')) {
      while (!this.is('}')) {
        const sStart = this.pos;
        if (this.ts && TS.typeSpecifier(this)) continue;
        /* импортируемое имя — любое, `import { default as x }` законен;
           локальное — связывание, и без `as` им становится то же слово */
        const imported = this.cur.t === 'str' ? this.parseLiteral() : this.parseIdentifierName();
        let local;
        if (this.eat('as')) local = this.parseIdentifier();
        else {
          if (imported.type !== 'Identifier' || RESERVED.has(imported.name))
            this.fail(`«${imported.name ?? imported.value}» нельзя импортировать без \`as\``, imported.start);
          local = imported;
        }
        specifiers.push(this.node('ImportSpecifier', sStart, { imported, local }));
        if (!this.eat(',')) break;
      }
      this.expect('}');
    }

    this.expect('from');
    const source = this.parseLiteral();
    const attributes = this.parseImportAttributes();
    this.semicolon();
    if (typeOnly) return TS.erasedStatement(this, start);
    return this.node('ImportDeclaration', start, { specifiers, source, attributes });
  }

  /* `with { type: 'json' }` — атрибуты импорта (ES2025) */
  parseImportAttributes() {
    const out = [];
    if (!this.is('with') && !this.is('assert')) return out;
    this.next();
    this.expect('{');
    while (!this.is('}')) {
      const aStart = this.pos;
      const key = this.cur.t === 'str' ? this.parseLiteral() : this.parseIdentifier();
      this.expect(':');
      const value = this.parseLiteral();
      out.push(this.node('ImportAttribute', aStart, { key, value }));
      if (!this.eat(',')) break;
    }
    this.expect('}');
    return out;
  }

  parseExport() {
    const start = this.expect('export').s;

    if (this.ts) {
      /* `export type X = …`, `export interface …`, `export declare …` —
         объявления без кода: экспортировать нечего */
      const typed = TS.exportedTypeStatement(this, start);
      if (typed) return typed;
    }

    if (this.eat('default')) {
      let declaration;
      if (this.is('function')) declaration = this.parseFunction({ statement: true });
      else if (this.is('async') && this.is('function', 1))
        declaration = this.parseFunction({ statement: true, async: true });
      else if (this.is('class')) declaration = this.parseClass({ statement: true });
      else { declaration = this.parseAssign(); this.semicolon(); }
      return this.node('ExportDefaultDeclaration', start, { declaration });
    }

    if (this.is('*')) {
      this.next();
      const exported = this.eat('as')
        ? (this.cur.t === 'str' ? this.parseLiteral() : this.parseIdentifierName())
        : null;
      this.expect('from');
      const source = this.parseLiteral();
      const attributes = this.parseImportAttributes();
      this.semicolon();
      return this.node('ExportAllDeclaration', start, { exported, source, attributes });
    }

    if (this.eat('{')) {
      const specifiers = [];
      while (!this.is('}')) {
        const sStart = this.pos;
        if (this.ts && TS.typeSpecifier(this)) continue;
        const local = this.cur.t === 'str' ? this.parseLiteral() : this.parseIdentifierName();
        const exported = this.eat('as')
          ? (this.cur.t === 'str' ? this.parseLiteral() : this.parseIdentifierName())
          : local;
        specifiers.push(this.node('ExportSpecifier', sStart, { local, exported }));
        if (!this.eat(',')) break;
      }
      this.expect('}');
      let source = null, attributes = [];
      if (this.eat('from')) { source = this.parseLiteral(); attributes = this.parseImportAttributes(); }
      /* без `from` локальное имя — ссылка на связывание модуля:
         `export { default }` законен только как ре-экспорт */
      if (!source)
        for (const s of specifiers)
          if (s.local.type !== 'Identifier' || RESERVED.has(s.local.name))
            this.fail(`«${s.local.name ?? s.local.value}» — не имя связывания, экспортировать нечего`, s.local.start);
      this.semicolon();
      return this.node('ExportNamedDeclaration', start, { declaration: null, specifiers, source, attributes });
    }

    let declaration;
    if (this.is('const') || this.is('let') || this.is('var')) {
      declaration = this.parseVarDeclaration();
      this.semicolon();
      declaration.end = this.prevEnd();
    } else if (this.is('function')) declaration = this.parseFunction({ statement: true });
    else if (this.is('async') && this.is('function', 1))
      declaration = this.parseFunction({ statement: true, async: true });
    else if (this.is('class')) declaration = this.parseClass({ statement: true });
    else this.fail(`после export ожидалось объявление, встречено ${this.describe()}`);

    /* подпись без тела: экспортировать нечего */
    if (declaration.type === 'TSTypeOnly') return TS.widenErased(this, start);
    return this.node('ExportNamedDeclaration', start, { declaration, specifiers: [], source: null, attributes: [] });
  }

  /* ── функции и классы ─────────────────────────────────────────────────── */

  parseFunction({ statement = false, async = false } = {}) {
    const start = async ? this.expect('async').s : this.pos;
    if (async) { /* `function` идёт следом */ }
    this.expect('function');
    const generator = this.eat('*');
    const id = this.isName() && !this.is('(') ? this.parseIdentifier() : null;
    TS.typeParams(this);
    const [params, body] = this.withContext(generator, async, () => {
      const ps = this.parseParams();
      TS.annotation(this);
      /* объявление без тела — это перегрузка: подпись для типов, и только */
      if (this.ts && !this.is('{')) { this.semicolon(); return [ps, null]; }
      return [ps, this.parseBlock()];
    });
    if (!body) return TS.erasedStatement(this, start);
    return this.node(statement ? 'FunctionDeclaration' : 'FunctionExpression', start,
      { id, params, body, generator, async, expression: false });
  }

  parseParams() {
    this.expect('(');
    const params = [];
    while (!this.is(')')) {
      const p = this.parseParam();
      params.push(p);
      if (!this.eat(',')) break;
      if (p.type === 'RestElement') this.fail('после rest-параметра ничего не может быть, даже запятой', p.start);
    }
    this.expect(')');
    return params;
  }

  parseParam() {
    const start = this.pos;
    /* `constructor(private x)` — параметр-свойство: оставляет после себя код,
       а не только тип, и потому в erasable TS запрещён (§4.4) */
    if (this.ts && TS.MEMBER_MODIFIERS.has(this.cur?.v) && this.isName(1))
      this.fail('параметр-свойство конструктора оставляет после себя код — в этом репозитории TS только erasable (§4.4)');
    if (this.eat('...')) {
      const argument = this.parseBindingTarget();
      TS.annotation(this);
      return this.node('RestElement', start, { argument });
    }
    const left = this.parseBindingTarget();
    TS.optionalMark(this);
    TS.annotation(this);
    if (this.eat('=')) {
      const right = this.parseAssign();
      return this.node('AssignmentPattern', start, { left, right });
    }
    return left;
  }

  /* цель связывания: имя или деструктуризация */
  parseBindingTarget() {
    if (this.is('[') || this.is('{')) return this.toPattern(this.parsePrimary());
    return this.parseIdentifier();
  }

  parseClass({ statement = false } = {}) {
    const start = this.expect('class').s;
    const id = this.isName() && !this.is('extends') ? this.parseIdentifier() : null;
    TS.typeParams(this);
    let superClass = null;
    if (this.eat('extends')) {
      const sStart = this.pos;
      superClass = this.parseUnaryTail(this.parsePrimary(), sStart);
      TS.typeParams(this);
    }
    TS.heritage(this);
    const body = this.parseClassBody();
    return this.node(statement ? 'ClassDeclaration' : 'ClassExpression', start,
      { id, superClass, body });
  }

  parseClassBody() {
    const start = this.expect('{').s;
    const body = [];
    while (!this.is('}')) {
      if (this.done) this.fail('тело класса не закрыто', start);
      if (this.eat(';')) continue;
      /* типовой член (индексная подпись, перегрузка) кода не даёт:
         его место уже записано в tsRanges, в дереве ему делать нечего */
      const member = this.parseClassMember();
      if (member) body.push(member);
    }
    this.expect('}');
    return this.node('ClassBody', start, { body });
  }

  parseClassMember() {
    const start = this.pos;
    if (this.ts) {
      TS.memberModifiers(this);
      const signature = TS.indexSignature(this);
      if (signature) return null;
    }
    let isStatic = false;

    if (this.is('static') && (this.isModifier('static') || this.is('{', 1))) {
      this.next();
      isStatic = true;
      if (this.is('{')) {
        const body = this.withContext(false, false, () => this.parseBlock());
        return this.node('StaticBlock', start, { body: body.body });
      }
    }

    TS.memberModifiers(this);

    let kind = 'method', async = false, generator = false;

    if (this.isModifier('async') && !this.peek(1)?.nl) { this.next(); async = true; }
    if (this.eat('*')) generator = true;
    if (this.isModifier('get') || this.isModifier('set')) kind = this.next().v;

    const { key, computed } = this.parsePropertyKey();
    TS.optionalMark(this);
    TS.typeParams(this);

    if (this.is('(')) {
      /* значение метода — функция от `(` до `}`, как у acorn */
      const fStart = this.pos;
      const [params, bodyBlock] = this.withContext(generator, async, () => {
        const ps = this.parseParams();
        TS.annotation(this);
        /* член без тела — подпись перегрузки или declare: только для типов */
        if (this.ts && !this.is('{')) { this.semicolon(); return [ps, null]; }
        return [ps, this.parseBlock()];
      });
      if (!bodyBlock) { TS.erasedStatement(this, start); return null; }
      const value = {
        type: 'FunctionExpression', start: fStart,
        end: bodyBlock.end, id: null, params, body: bodyBlock, generator, async, expression: false,
      };
      const isCtor = !isStatic && !computed && kind === 'method' &&
        ((key.type === 'Identifier' && key.name === 'constructor') ||
         (key.type === 'Literal' && key.value === 'constructor'));
      return this.node('MethodDefinition', start,
        { key, value, kind: isCtor ? 'constructor' : kind, computed, static: isStatic });
    }

    if (kind !== 'method') this.fail('у get/set нет тела', start);
    TS.annotation(this);
    /* инициализатор поля — отдельная функция: ни yield, ни await */
    const value = this.eat('=') ? this.withContext(false, false, () => this.parseAssign()) : null;
    this.semicolon();
    return this.node('PropertyDefinition', start, { key, value, computed, static: isStatic });
  }

  parsePropertyKey() {
    if (this.eat('[')) {
      const key = this.parseAssign();
      this.expect(']');
      return { key, computed: true };
    }
    const t = this.cur;
    if (!t) this.fail('ожидалось имя свойства');
    if (t.t === 'priv') {
      this.next();
      return { key: this.node('PrivateIdentifier', t.s, { name: t.v.slice(1) }), computed: false };
    }
    if (t.t === 'str' || t.t === 'num') return { key: this.parseLiteral(), computed: false };
    return { key: this.parseIdentifierName(), computed: false };
  }

  /* ── выражения ────────────────────────────────────────────────────────── */

  parseExpression({ noIn = false } = {}) {
    const start = this.pos;
    let expr = this.parseAssign({ noIn });
    if (!this.is(',')) return expr;

    const expressions = [expr];
    while (this.eat(',')) expressions.push(this.parseAssign({ noIn }));
    return this.node('SequenceExpression', start, { expressions });
  }

  parseAssign({ noIn = false } = {}) {
    const start = this.pos;

    if (this.is('yield') && this.inGen) return this.parseYield();

    const arrow = this.tryArrow();
    if (arrow) return arrow;

    const left = this.parseConditional({ noIn });

    if (this.cur && this.cur.t === 'punct' && ASSIGN.has(this.cur.v)) {
      const operator = this.next().v;
      const target = operator === '=' ? this.toPattern(left) : left;
      const right = this.parseAssign({ noIn });
      return this.node('AssignmentExpression', start, { operator, left: target, right });
    }
    return left;
  }

  parseYield() {
    const start = this.expect('yield').s;
    const delegate = this.eat('*');
    let argument = null;
    if (!this.done && !this.cur.nl && !this.is(')') && !this.is(']') && !this.is('}') &&
        !this.is(',') && !this.is(';') && !this.is(':'))
      argument = this.parseAssign();
    return this.node('YieldExpression', start, { argument, delegate });
  }

  /* Стрелка узнаётся только по `=>`, который стоит уже после списка
     параметров. Поэтому: запомнить позицию, попробовать, откатиться. */
  tryArrow() {
    const save = this.i;
    const mark = TS.markPoint(this);
    const start = this.pos;
    let async = false;

    if (this.is('async') && !this.peek(1)?.nl &&
        (this.isName(1) || this.is('(', 1)) && !this.is('=>', 1)) {
      this.next(); async = true;
    }

    if (this.ts) TS.arrowTypeParams(this);

    let params = null;
    if (this.isName() && this.is('=>', 1)) {
      params = [this.parseIdentifier()];
    } else if (this.is('(')) {
      const close = this.matching(this.i);
      /* с типами за `)` может стоять ещё и `: Тип` — стрелка дальше */
      const arrowNext = close >= 0 &&
        (this.isAt(close + 1, '=>') || (this.ts && this.isAt(close + 1, ':')));
      if (!arrowNext) { this.i = save; TS.rollback(this, mark); return null; }
      try { params = this.parseParams(); TS.annotation(this, { noArrow: true }); }
      catch { this.i = save; TS.rollback(this, mark); return null; }
    } else { this.i = save; TS.rollback(this, mark); return null; }

    if (!this.is('=>')) { this.i = save; TS.rollback(this, mark); return null; }
    this.expect('=>');

    const expression = !this.is('{');
    const body = this.withContext(false, async,
      () => expression ? this.parseAssign() : this.parseBlock());
    return this.node('ArrowFunctionExpression', start,
      { id: null, params, body, async, generator: false, expression });
  }

  /* индекс парной закрывающей скобки для открывающей на позиции k */
  matching(k) {
    const open = this.toks[k].v;
    const close = open === '(' ? ')' : open === '[' ? ']' : '}';
    let d = 0;
    for (let j = k; j < this.toks.length; j++) {
      const t = this.toks[j];
      if (t.t !== 'punct') continue;
      if (t.v === open) d++;
      else if (t.v === close) { d--; if (d === 0) return j; }
      else if (t.v === '(' || t.v === '[' || t.v === '{') {
        const inner = this.matching(j);
        if (inner < 0) return -1;
        j = inner;
      }
    }
    return -1;
  }

  isAt(k, v) { const t = this.toks[k]; return !!t && t.t === 'punct' && t.v === v; }

  /* `async`, `get`, `set`, `static` — модификаторы только тогда, когда за
     ними идёт имя свойства. Иначе это само свойство:

       { async: 1 }   { get, set }   { async = false }   { static }

     Последний случай — деструктуризация с умолчанием — и есть тот, на
     котором ошибиться легче всего: без проверки на `=` разбор уезжает,
     а сообщение об ошибке указывает совсем не туда. */
  isModifier(word) {
    if (!this.is(word)) return false;
    const t = this.peek(1);
    if (!t) return false;
    if (t.t === 'punct') return !['(', ':', ',', '}', '=', ';', ')', ']'].includes(t.v);
    return true;
  }

  parseConditional({ noIn = false } = {}) {
    const start = this.pos;
    const test = this.parseBinary(0, { noIn });
    if (!this.is('?')) return test;
    this.next();
    const consequent = this.parseAssign();
    this.expect(':');
    const alternate = this.parseAssign({ noIn });
    return this.node('ConditionalExpression', start, { test, consequent, alternate });
  }

  parseBinary(minPrec, { noIn = false } = {}) {
    const start = this.pos;
    let left = this.parseUnary();

    for (;;) {
      const t = this.cur;
      if (!t) break;
      const op = t.v;
      /* `x as T` и `x satisfies T`: по месту в грамматике это сравнение,
         но справа стоит тип, и от выражения остаётся только левая часть */
      if (this.ts && (op === 'as' || op === 'satisfies') && !t.nl) {
        if (BINARY.get('instanceof') <= minPrec) break;
        TS.expressionTail(this, left);
        continue;
      }
      if (t.t === 'name' && op !== 'in' && op !== 'instanceof') break;
      if (t.t !== 'punct' && t.t !== 'name') break;
      if (op === 'in' && noIn) break;


      const prec = BINARY.get(op);
      if (prec === undefined || prec <= minPrec) break;

      /* `-a ** 2` — ранняя ошибка: неясно, `(-a) ** 2` это или `-(a ** 2)`,
         и язык требует скобок. То же для typeof/void/delete/await. */
      if (op === '**' && !left.parenthesized &&
          (left.type === 'UnaryExpression' || left.type === 'AwaitExpression'))
        this.fail('унарный оператор перед `**` требует скобок: `(-a) ** 2` или `-(a ** 2)`', left.start);

      this.next();
      /* `**` правоассоциативен */
      const right = this.parseBinary(op === '**' ? prec - 1 : prec, { noIn });

      /* `??` нельзя мешать с `||`/`&&` без скобок — в любую сторону.
         Проверять только левый операнд мало: у `??` приоритет ниже, так что
         в `a ?? b || c` нарушение оказывается справа. */
      const mixes = n => n.type === 'LogicalExpression' && !n.parenthesized &&
        ((op === '??' && (n.operator === '||' || n.operator === '&&')) ||
         (n.operator === '??' && (op === '||' || op === '&&')));
      if (mixes(left) || mixes(right))
        this.fail('`??` нельзя смешивать с `||`/`&&` без скобок', start);

      /* конец — по последнему съеденному токену, а не по right.end:
         у `a + (b)` правый операнд заканчивается раньше скобки */
      left = {
        type: LOGICAL.has(op) ? 'LogicalExpression' : 'BinaryExpression',
        start, end: this.prevEnd(), operator: op, left, right,
      };
    }
    return left;
  }

  parseUnary() {
    const t = this.cur;
    if (!t) this.fail('ожидалось выражение');
    const start = t.s;

    if ((t.t === 'punct' || t.t === 'name') && UNARY.has(t.v)) {
      this.next();
      const argument = this.parseUnary();
      return this.node('UnaryExpression', start, { operator: t.v, argument, prefix: true });
    }
    if (t.t === 'punct' && (t.v === '++' || t.v === '--')) {
      this.next();
      const argument = this.parseUnary();
      return this.node('UpdateExpression', start, { operator: t.v, argument, prefix: true });
    }
    if (t.t === 'name' && t.v === 'await' && this.inAsync) {
      this.next();
      const argument = this.parseUnary();
      return this.node('AwaitExpression', start, { argument });
    }

    let expr = this.parseUnaryTail(this.parsePrimary(), start);

    const u = this.cur;
    if (u && u.t === 'punct' && (u.v === '++' || u.v === '--') && !u.nl) {
      this.next();
      expr = this.node('UpdateExpression', start, { operator: u.v, argument: expr, prefix: false });
    }
    return expr;
  }

  /* хвост: .x  ?.x  [x]  (…)  `tpl`

     start — позиция первого токена основы, а не base.start: у `(a).b`
     основа `a` начинается после скобки, а выражение целиком — на ней. */
  parseUnaryTail(base, start = base.start) {
    let expr = base;
    let optionalSeen = false;

    for (;;) {
      const t = this.cur;
      if (!t) break;

      if (this.ts && t.t === 'punct') {
        /* `x!` — утверждение «не null»: к значению ничего не добавляет */
        if (t.v === '!' && !t.nl) { TS.expressionTail(this, expr); expr.end = this.prevEnd(); continue; }
        /* `f<T>(x)` — аргументы типа у вызова */
        if (t.v === '<' && TS.callTypeArgs(this)) continue;
      }

      if (t.t === 'punct' && t.v === '.') {
        this.next();
        const property = this.cur?.t === 'priv'
          ? this.node('PrivateIdentifier', this.next().s, { name: this.toks[this.i - 1].v.slice(1) })
          : this.parseIdentifierName();
        expr = { type: 'MemberExpression', start, end: property.end, object: expr, property, computed: false, optional: false };
        continue;
      }

      if (t.t === 'punct' && t.v === '?.') {
        this.next();
        optionalSeen = true;
        if (this.is('(')) {
          const args = this.parseArguments();
          expr = { type: 'CallExpression', start, end: this.prevEnd(), callee: expr, arguments: args, optional: true };
        } else if (this.eat('[')) {
          const property = this.parseExpression();
          this.expect(']');
          expr = { type: 'MemberExpression', start, end: this.prevEnd(), object: expr, property, computed: true, optional: true };
        } else {
          const property = this.cur?.t === 'priv'
            ? this.node('PrivateIdentifier', this.next().s, { name: this.toks[this.i - 1].v.slice(1) })
            : this.parseIdentifierName();
          expr = { type: 'MemberExpression', start, end: property.end, object: expr, property, computed: false, optional: true };
        }
        continue;
      }

      if (t.t === 'punct' && t.v === '[') {
        this.next();
        const property = this.parseExpression();
        this.expect(']');
        expr = { type: 'MemberExpression', start, end: this.prevEnd(), object: expr, property, computed: true, optional: false };
        continue;
      }

      if (t.t === 'punct' && t.v === '(') {
        const args = this.parseArguments();
        expr = { type: 'CallExpression', start, end: this.prevEnd(), callee: expr, arguments: args, optional: false };
        continue;
      }

      if (t.t === 'tmpl') {
        if (optionalSeen) this.fail('шаблон с тегом не может продолжать цепочку `?.`');
        const quasi = this.parseTemplate();
        expr = { type: 'TaggedTemplateExpression', start, end: quasi.end, tag: expr, quasi };
        continue;
      }

      break;
    }

    return optionalSeen
      ? { type: 'ChainExpression', start: expr.start, end: expr.end, expression: expr }
      : expr;
  }

  parseArguments() {
    this.expect('(');
    const args = [];
    while (!this.is(')')) {
      if (this.is('...')) {
        const start = this.next().s;
        const argument = this.parseAssign();
        args.push(this.node('SpreadElement', start, { argument }));
      } else args.push(this.parseAssign());
      if (!this.eat(',')) break;
    }
    this.expect(')');
    return args;
  }

  parsePrimary() {
    const t = this.cur;
    if (!t) this.fail('ожидалось выражение');
    const start = t.s;

    if (t.t === 'num' || t.t === 'str' || t.t === 'regexp') return this.parseLiteral();
    if (t.t === 'tmpl') return this.parseTemplate();

    if (t.t === 'priv') {                         /* `#x in obj` */
      this.next();
      return this.node('PrivateIdentifier', start, { name: t.v.slice(1) });
    }

    if (t.t === 'punct') {
      if (t.v === '(') {
        this.next();
        const expr = this.parseExpression();
        this.expect(')');
        expr.parenthesized = true;
        return expr;
      }
      if (t.v === '[') return this.parseArrayLiteral();
      if (t.v === '{') return this.parseObjectLiteral();
      this.fail(`неожиданный токен ${this.describe()}`);
    }

    switch (t.v) {
      case 'this': this.next(); return this.node('ThisExpression', start, {});
      case 'super': this.next(); return this.node('Super', start, {});
      case 'true': case 'false':
        this.next();
        return this.node('Literal', start, { value: t.v === 'true', raw: t.v });
      case 'null':
        this.next();
        return this.node('Literal', start, { value: null, raw: 'null' });
      case 'function': return this.parseFunction({});
      case 'class': return this.parseClass({});
      case 'async':
        if (this.is('function', 1) && !this.peek(1).nl)
          return this.parseFunction({ async: true });
        break;
      case 'new': {
        this.next();
        if (this.eat('.')) {
          const property = this.parseIdentifierName();
          return this.node('MetaProperty', start, { meta: { type: 'Identifier', name: 'new', start, end: start + 3 }, property });
        }
        const callee = this.parseNewCallee();
        const args = this.is('(') ? this.parseArguments() : [];
        return this.node('NewExpression', start, { callee, arguments: args });
      }
      case 'import': {
        this.next();
        if (this.eat('.')) {
          const property = this.parseIdentifierName();
          return this.node('MetaProperty', start, { meta: { type: 'Identifier', name: 'import', start, end: start + 6 }, property });
        }
        this.expect('(');
        const source = this.parseAssign();
        const options = this.eat(',') && !this.is(')') ? this.parseAssign() : null;
        this.eat(',');
        this.expect(')');
        return this.node('ImportExpression', start, { source, options });
      }
    }

    return this.parseIdentifier();
  }

  /* callee у `new`: member-цепочка без вызовов */
  parseNewCallee() {
    const start = this.pos;
    let expr = this.parsePrimary();
    for (;;) {
      if (this.is('.')) {
        this.next();
        const property = this.cur?.t === 'priv'
          ? this.node('PrivateIdentifier', this.next().s, { name: this.toks[this.i - 1].v.slice(1) })
          : this.parseIdentifierName();
        expr = { type: 'MemberExpression', start, end: property.end, object: expr, property, computed: false, optional: false };
      } else if (this.is('[')) {
        this.next();
        const property = this.parseExpression();
        this.expect(']');
        expr = { type: 'MemberExpression', start, end: this.prevEnd(), object: expr, property, computed: true, optional: false };
      } else if (this.is('?.')) {
        this.fail('`new` не может вызывать цепочку `?.`');
      } else break;
    }
    return expr;
  }

  parseArrayLiteral() {
    const start = this.expect('[').s;
    const elements = [];
    while (!this.is(']')) {
      if (this.is(',')) { this.next(); elements.push(null); continue; }   // дырка
      if (this.is('...')) {
        const sStart = this.next().s;
        const argument = this.parseAssign();
        elements.push(this.node('SpreadElement', sStart, { argument }));
      } else elements.push(this.parseAssign());
      if (!this.eat(',')) break;
    }
    this.expect(']');
    return this.node('ArrayExpression', start, { elements });
  }

  parseObjectLiteral() {
    const start = this.expect('{').s;
    const properties = [];

    while (!this.is('}')) {
      if (this.done) this.fail('литерал объекта не закрыт', start);

      if (this.is('...')) {
        const sStart = this.next().s;
        const argument = this.parseAssign();
        properties.push(this.node('SpreadElement', sStart, { argument }));
        if (!this.eat(',')) break;
        continue;
      }

      const pStart = this.pos;
      let kind = 'init', async = false, generator = false;

      if (this.isModifier('async') && !this.peek(1)?.nl) { this.next(); async = true; }
      if (this.eat('*')) generator = true;
      if (this.isModifier('get') || this.isModifier('set')) kind = this.next().v;

      const { key, computed } = this.parsePropertyKey();

      if (this.is('(')) {
        const fStart = this.pos;
        const [params, body] = this.withContext(generator, async,
          () => [this.parseParams(), this.parseBlock()]);
        const value = { type: 'FunctionExpression', start: fStart, end: body.end, id: null, params, body, generator, async, expression: false };
        properties.push(this.node('Property', pStart,
          { key, value, kind: kind === 'init' ? 'init' : kind, computed, method: kind === 'init', shorthand: false }));
      } else if (kind !== 'init') {
        this.fail('у get/set нет тела', pStart);
      } else if (this.eat(':')) {
        const value = this.parseAssign();
        properties.push(this.node('Property', pStart, { key, value, kind: 'init', computed, method: false, shorthand: false }));
      } else {
        /* сокращённая запись, возможно с умолчанием (в паттернах): ключ
           одновременно и ссылка на переменную, так что `{ default }`,
           `{ 1 }` и `{ [a] }` здесь невозможны */
        if (computed || key.type !== 'Identifier')
          this.fail('в сокращённой записи свойства ожидалось имя', key.start);
        if (RESERVED.has(key.name))
          this.fail(`«${key.name}» — зарезервированное слово, именем быть не может`, key.start);
        let value = key;
        if (this.eat('=')) {
          const right = this.parseAssign();
          value = this.node('AssignmentPattern', key.start, { left: key, right });
        }
        properties.push(this.node('Property', pStart, { key, value, kind: 'init', computed: false, method: false, shorthand: true }));
      }

      if (!this.eat(',')) break;
    }

    this.expect('}');
    return this.node('ObjectExpression', start, { properties });
  }

  parseTemplate() {
    const t = this.next();
    const { quasis, exprs } = splitTemplate(this.src, t.s, t.e);

    const expressions = exprs.map(r => {
      const sub = new Parser(this.src, { from: r.start, to: r.end, inGen: this.inGen, inAsync: this.inAsync });
      const e = sub.parseExpression();
      if (!sub.done) sub.fail('лишнее в подстановке ${…}');
      return e;
    });

    return {
      type: 'TemplateLiteral', start: t.s, end: t.e, expressions,
      quasis: quasis.map(q => ({
        type: 'TemplateElement', start: q.start, end: q.end, tail: q.tail,
        value: { raw: this.src.slice(q.start, q.end), cooked: null },
      })),
    };
  }

  parseLiteral() {
    const t = this.next();
    const raw = t.v;
    let value;
    if (t.t === 'str') value = raw.slice(1, -1);
    else if (t.t === 'num') value = raw.endsWith('n') ? null : Number(raw.replace(/_/g, ''));
    else if (t.t === 'regexp') value = null;
    else this.fail('ожидался литерал', t.s);

    const node = { type: 'Literal', start: t.s, end: t.e, value, raw };
    if (t.t === 'regexp') {
      const last = raw.lastIndexOf('/');
      node.regex = { pattern: raw.slice(1, last), flags: raw.slice(last + 1) };
    }
    if (t.t === 'num' && raw.endsWith('n')) node.bigint = raw.slice(0, -1).replace(/_/g, '');
    return node;
  }

  parseIdentifier() {
    const t = this.cur;
    if (!t || t.t !== 'name') this.fail(`ожидалось имя, встречено ${this.describe()}`);
    if (RESERVED.has(t.v)) this.fail(`«${t.v}» — зарезервированное слово, именем быть не может`, t.s);
    this.next();
    return { type: 'Identifier', start: t.s, end: t.e, name: t.v };
  }

  /* имя после точки или ключ свойства: ключевые слова разрешены */
  parseIdentifierName() {
    const t = this.cur;
    if (!t || t.t !== 'name') this.fail(`ожидалось имя свойства, встречено ${this.describe()}`);
    this.next();
    return { type: 'Identifier', start: t.s, end: t.e, name: t.v };
  }

  /* ── выражение → паттерн ──────────────────────────────────────────────────
     Стрелки и деструктуризация разбираются как выражения, а потом
     переосмысляются: до `=>` или `=` отличить `{a}` литерал от паттерна
     нельзя, не заглядывая вперёд на произвольную глубину.            ── */

  toPattern(node) {
    switch (node.type) {
      case 'Identifier': case 'MemberExpression':
      case 'ObjectPattern': case 'ArrayPattern':
      case 'AssignmentPattern': case 'RestElement':
        return node;

      case 'ArrayExpression':
        return {
          type: 'ArrayPattern', start: node.start, end: node.end,
          elements: node.elements.map(e => e === null ? null : this.toPattern(e)),
        };

      case 'ObjectExpression':
        return {
          type: 'ObjectPattern', start: node.start, end: node.end,
          properties: node.properties.map(p => {
            if (p.type === 'SpreadElement')
              return { type: 'RestElement', start: p.start, end: p.end, argument: this.toPattern(p.argument) };
            return { ...p, value: this.toPattern(p.value) };
          }),
        };

      case 'AssignmentExpression':
        if (node.operator !== '=') this.fail('в паттерне допустимо только «=»', node.start);
        return {
          type: 'AssignmentPattern', start: node.start, end: node.end,
          left: this.toPattern(node.left), right: node.right,
        };

      case 'SpreadElement':
        return { type: 'RestElement', start: node.start, end: node.end, argument: this.toPattern(node.argument) };

      default:
        this.fail(`${node.type} не может быть целью присваивания`, node.start);
    }
  }
}

/* Исходный текст → AST. */
/* opts.ts — разбирать типы TypeScript (§4.4): они попадают в
   `ast.tsRanges`, а не в дерево. */
export function parse(src, opts = {}) {
  const p = new Parser(src, opts);
  return p.parseProgram();
}

export { Parser };
