/* ══════════════════════════════════════════════════════════════════════════
   features.js — каталог синтаксических возможностей языка и их детектор

   У каждой возможности — год стандарта и то, что с ней делать, если цель
   её не поддерживает:

     pass         есть проход понижения (src/passes/<pass>.js)
     pending      прохода пока нет — в каком этапе он появится (BACKLOG §11)
     unsupported  понизить в принципе нельзя — почему

   Детектор — одна функция на AST: находит все вхождения. Им пользуются
   трижды: решить, какие проходы нужны цели; назвать причину, по которой
   цель не собирается; и проверить результат — после понижения в тексте
   не должно остаться ничего новее цели. Последнее и есть «проверка
   грамматикой» из §7.2: артефакт es6 разбирается и в нём ищется всё, чего
   в ES2015 не было.
   ══════════════════════════════════════════════════════════════════════════ */

import { walk } from './downgrade-walk.js';
import { skipTrivia } from './downgrade-rewrite.js';

export const FEATURES = {
  /* ── ES2025 ── */
  importAttributes: { year: 2025, title: 'атрибуты импорта `with { type }`', unsupported: 'импорт не-JS модуля не инлайнится' },
  regexpModifiers: { year: 2025, title: 'модификаторы в регулярке `(?i:…)`', unsupported: 'модификаторы не выражаются старым синтаксисом регулярок' },
  regexpDuplicateNamedGroups: { year: 2025, title: 'повтор имени группы в регулярке', unsupported: 'повторяющиеся имена групп не выражаются старым синтаксисом' },

  /* ── ES2024 ── */
  regexpUnicodeSets: { year: 2024, title: 'флаг v у регулярки', unsupported: 'операции над множествами в классах не выражаются флагом u' },

  /* ── ES2022 ── */
  classFields: { year: 2022, title: 'поля класса', pass: 'class-members' },
  privateFields: { year: 2022, title: 'приватные поля #x', pass: 'class-members' },
  privateMethods: { year: 2022, title: 'приватные методы #m()', pass: 'class-members' },
  staticBlock: { year: 2022, title: 'static-блок класса', pass: 'class-members' },
  privateIn: { year: 2022, title: '`#x in obj`', pass: 'class-members' },
  topLevelAwait: { year: 2022, title: 'await на верхнем уровне', unsupported: 'модуль стал бы асинхронным: ни require, ни ES2015-модуль этого не умеют' },
  regexpIndices: { year: 2022, title: 'флаг d у регулярки', unsupported: 'hasIndices не выражается старыми флагами' },

  /* ── ES2021 ── */
  logicalAssignment: { year: 2021, title: '`&&=` `||=` `??=`', pass: 'logical-assignment' },
  numericSeparator: { year: 2021, title: 'разделители в числах `1_000`', pass: 'numeric-separator' },

  /* ── ES2020 ── */
  optionalChaining: { year: 2020, title: 'optional chaining `?.`', pass: 'optional-chaining' },
  nullish: { year: 2020, title: '`??`', pass: 'nullish' },
  bigint: { year: 2020, title: 'BigInt', unsupported: 'BigInt не выражается через Number: другая арифметика и точность' },
  importMeta: { year: 2020, title: '`import.meta`', unsupported: 'import.meta есть только у ES-модуля ES2020+' },
  dynamicImport: { year: 2020, title: 'динамический `import()`', unsupported: 'singlefile не может подгружать модули' },
  exportStarAs: { year: 2020, title: '`export * as ns`', unsupported: 'ре-экспорт линкер не собирает' },

  /* ── ES2019 ── */
  optionalCatch: { year: 2019, title: '`catch` без параметра', pass: 'optional-catch' },
  jsonSuperset: { year: 2019, title: 'U+2028/U+2029 в строковом литерале', pass: 'json-superset' },

  /* ── ES2018 ── */
  objectSpread: { year: 2018, title: 'spread в литерале объекта `{ ...a }`', pass: 'object-rest-spread' },
  objectRest: { year: 2018, title: 'rest в деструктуризации объекта `{ a, ...r }`', pass: 'object-rest-spread' },
  asyncIteration: { year: 2018, title: '`for await` и async-генераторы', pending: 'M6' },
  regexpDotAll: { year: 2018, title: 'флаг s у регулярки', pass: 'regexp-dotall' },
  regexpNamedGroups: { year: 2018, title: 'именованные группы в регулярке', pass: 'regexp-unicode' },
  regexpLookbehind: { year: 2018, title: 'lookbehind в регулярке', unsupported: 'lookbehind не выражается старым синтаксисом регулярок' },
  regexpUnicodeProperty: { year: 2018, title: '`\\p{…}` в регулярке', pass: 'regexp-unicode' },

  /* ── ES2017 ── */
  asyncFunction: { year: 2017, title: 'async-функции', pass: 'async-functions' },
  trailingComma: { year: 2017, title: 'запятая после последнего аргумента или параметра', pass: 'trailing-comma' },

  /* ── ES2016 ── */
  exponent: { year: 2016, title: 'оператор `**`', pass: 'exponent' },

  /* ── ES2015: для es5/es3 — этап M4 ── */
  letConst: { year: 2015, title: 'let/const', pass: 'block-scoping' },
  arrow: { year: 2015, title: 'стрелочные функции', pass: 'arrow' },
  class: { year: 2015, title: 'классы', pass: 'classes' },
  template: { year: 2015, title: 'шаблонные строки', pass: 'template-literals' },
  taggedTemplate: { year: 2015, title: 'шаблон с тегом', pass: 'template-literals' },
  destructuring: { year: 2015, title: 'деструктуризация', pass: 'destructuring' },
  defaultParams: { year: 2015, title: 'параметры по умолчанию', pass: 'parameters' },
  restParams: { year: 2015, title: 'rest-параметры', pass: 'parameters' },
  paramPattern: { year: 2015, title: 'образец в подписи функции', pass: 'parameters' },
  spread: { year: 2015, title: 'spread в вызове, массиве, new', pass: 'spread' },
  forOf: { year: 2015, title: 'for-of', pass: 'for-of' },
  generator: { year: 2015, title: 'генераторы', pass: 'generators' },
  objectLiteralExt: { year: 2015, title: 'сокращённые и вычисляемые свойства', pass: 'object-literal' },
  newTarget: { year: 2015, title: '`new.target`', pending: 'M6' },
  binaryOctal: { year: 2015, title: 'литералы 0b/0o', pass: 'es5-literals' },
  codePointEscape: { year: 2015, title: 'экранирование `\\u{…}`', pass: 'es5-literals' },
  regexpSticky: { year: 2015, title: 'флаг y у регулярки', unsupported: 'sticky не выражается без флага y' },
  regexpUnicode: { year: 2015, title: 'флаг u у регулярки', pass: 'regexp-unicode' },
  modules: { year: 2015, title: 'ES-модули', pending: 'M4' },

  /* ── ES5: для es3 — этап M4 ── */
  accessors: { year: 2009, title: 'get/set в литерале объекта', unsupported: 'в ES3 нет аксессоров' },
  reservedProps: { year: 2009, title: 'зарезервированное слово как имя свойства', pass: 'es3-props' },
};

/* номер редакции: ES2015 → 6, ES2025 → 16; ES5 → 5, ES3 → 3 */
export const edition = year => (year >= 2015 ? year - 2009 : year >= 2009 ? 5 : 3);

/* ── регулярные выражения ───────────────────────────────────────────────── */

/* Возможности внутри литерала регулярки. Разбор — по символам, с учётом
   экранирования и классов: `[(?<]` и `\(?<` группой не являются. */
export function regexpFeatures(pattern, flags) {
  const out = new Set();
  if (flags.includes('s')) out.add('regexpDotAll');
  if (flags.includes('d')) out.add('regexpIndices');
  if (flags.includes('v')) out.add('regexpUnicodeSets');
  if (flags.includes('y')) out.add('regexpSticky');
  if (flags.includes('u')) out.add('regexpUnicode');

  const names = new Set();
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      const n = pattern[i + 1];
      if ((n === 'p' || n === 'P') && pattern[i + 2] === '{' && /[uv]/.test(flags)) out.add('regexpUnicodeProperty');
      if (n === 'k' && pattern[i + 2] === '<') out.add('regexpNamedGroups');
      i++;
      continue;
    }
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c === '(' && pattern[i + 1] === '?') {
      const rest = pattern.slice(i + 2);
      if (rest.startsWith('<=') || rest.startsWith('<!')) out.add('regexpLookbehind');
      else if (rest[0] === '<') {
        out.add('regexpNamedGroups');
        const name = /^<([^>]*)>/.exec(rest)?.[1];
        if (name !== undefined) { if (names.has(name)) out.add('regexpDuplicateNamedGroups'); names.add(name); }
      } else if (/^[-imsx]+:/.test(rest) || /^[imsx]*-[imsx]*:/.test(rest)) out.add('regexpModifiers');
    }
  }
  return out;
}

/* ── детектор ───────────────────────────────────────────────────────────── */

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/* запятая после последнего элемента списка? */
function trailingComma(src, lastEnd) {
  const p = skipTrivia(src, lastEnd);
  return src[p] === ',';
}

/* Все вхождения: [{ id, node }]. src нужен для того, чего в AST нет:
   запятых после последнего аргумента. */
export function detect(ast, src) {
  const found = [];
  const add = (id, node) => found.push({ id, node });
  let fnDepth = 0;

  walk(ast, {
    enter(n, parent, key) {
      if (FUNCTIONS.has(n.type) || n.type === 'StaticBlock' || (parent && parent.type === 'PropertyDefinition' && key === 'value'))
        fnDepth++;

      switch (n.type) {
        case 'BinaryExpression':
          if (n.operator === '**') add('exponent', n);
          if (n.operator === 'in' && n.left.type === 'PrivateIdentifier') add('privateIn', n);
          break;
        case 'AssignmentExpression':
          if (n.operator === '**=') add('exponent', n);
          if (n.operator === '&&=' || n.operator === '||=' || n.operator === '??=') add('logicalAssignment', n);
          break;
        case 'LogicalExpression': if (n.operator === '??') add('nullish', n); break;
        case 'ChainExpression': add('optionalChaining', n); break;

        case 'ObjectExpression':
          if (n.properties.some(p => p.type === 'SpreadElement')) add('objectSpread', n);
          break;
        case 'ObjectPattern':
          if (n.properties.some(p => p.type === 'RestElement')) add('objectRest', n);
          add('destructuring', n);
          break;
        case 'ArrayPattern': add('destructuring', n); break;

        case 'CatchClause': if (!n.param) add('optionalCatch', n); break;

        case 'PropertyDefinition':
          add(n.key.type === 'PrivateIdentifier' ? 'privateFields' : 'classFields', n);
          break;
        case 'MethodDefinition':
          if (n.key.type === 'PrivateIdentifier') add('privateMethods', n);
          if (n.computed) add('objectLiteralExt', n);
          break;
        case 'StaticBlock': add('staticBlock', n); break;
        case 'ClassDeclaration': case 'ClassExpression': add('class', n); break;

        case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression':
          if (n.async && n.generator) add('asyncIteration', n);
          else if (n.async) add('asyncFunction', n);
          else if (n.generator) add('generator', n);
          if (n.type === 'ArrowFunctionExpression') add('arrow', n);
          if (n.params.length && trailingComma(src, n.params.at(-1).end)) add('trailingComma', n);
          for (const p of n.params) {
            if (p.type === 'AssignmentPattern') add('defaultParams', p);
            if (p.type === 'RestElement') add('restParams', p);
            /* образец в подписи разбирает проход parameters — он уносит
               его в тело, где с ним разберётся destructuring */
            if (p.type === 'ObjectPattern' || p.type === 'ArrayPattern') add('paramPattern', p);
          }
          break;
        case 'CallExpression': case 'NewExpression':
          if (n.arguments.length && trailingComma(src, n.arguments.at(-1).end)) add('trailingComma', n);
          break;

        case 'ForOfStatement': add(n.await ? 'asyncIteration' : 'forOf', n); break;
        case 'AwaitExpression': if (fnDepth === 0) add('topLevelAwait', n); break;

        case 'VariableDeclaration': if (n.kind !== 'var') add('letConst', n); break;
        case 'TemplateLiteral':
          add('template', n);
          if (n.quasis.some(q => q.value.raw.includes('\\u{'))) add('codePointEscape', n);
          break;
        case 'SpreadElement': if (parent.type !== 'ObjectExpression') add('spread', n); break;
        case 'RestElement': if (parent.type === 'ArrayPattern') add('destructuring', n); break;
        case 'TaggedTemplateExpression': add('taggedTemplate', n); break;
        case 'Property':
          if (parent.type === 'ObjectExpression') {
            if (n.shorthand || n.method || n.computed) add('objectLiteralExt', n);
            if (n.kind === 'get' || n.kind === 'set') add('accessors', n);
          }
          if (!n.computed && n.key.type === 'Identifier' && ES3_RESERVED.has(n.key.name)) add('reservedProps', n);
          break;
        case 'MemberExpression':
          if (!n.computed && n.property.type === 'Identifier' && ES3_RESERVED.has(n.property.name)) add('reservedProps', n);
          break;
        case 'MetaProperty':
          if (n.meta.name === 'new') add('newTarget', n);
          else add('importMeta', n);
          break;
        case 'ImportExpression': add('dynamicImport', n); if (n.options) add('importAttributes', n); break;
        case 'ImportDeclaration': case 'ExportNamedDeclaration': case 'ExportDefaultDeclaration':
          add('modules', n);
          if (n.attributes && n.attributes.length) add('importAttributes', n);
          break;
        case 'ExportAllDeclaration':
          add('modules', n);
          if (n.exported) add('exportStarAs', n);
          if (n.attributes && n.attributes.length) add('importAttributes', n);
          break;

        case 'Literal':
          if (n.bigint !== undefined) add('bigint', n);
          else if (n.regex) for (const id of regexpFeatures(n.regex.pattern, n.regex.flags)) add(id, n);
          else if (typeof n.value === 'number') {
            if (n.raw.includes('_')) add('numericSeparator', n);
            if (/^0[bBoO]/.test(n.raw)) add('binaryOctal', n);
          } else if (typeof n.value === 'string') {
            if (/[\u2028\u2029]/.test(n.raw)) add('jsonSuperset', n);
            if (n.raw.includes('\\u{')) add('codePointEscape', n);
          }
          break;
      }
    },
    leave(n, parent, key) {
      if (FUNCTIONS.has(n.type) || n.type === 'StaticBlock' || (parent && parent.type === 'PropertyDefinition' && key === 'value'))
        fnDepth--;
    },
  });
  return found;
}

/* зарезервированные слова ES3, которые ES5 разрешил как имена свойств */
const ES3_RESERVED = new Set(['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch',
  'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'abstract',
  'boolean', 'byte', 'char', 'double', 'final', 'float', 'goto', 'implements', 'int',
  'interface', 'long', 'native', 'package', 'private', 'protected', 'public', 'short',
  'static', 'synchronized', 'throws', 'transient', 'volatile']);
