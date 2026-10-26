/* es3-props — зарезервированное слово как имя свойства (ES5 → ES3)

     o.default        →  o['default']
     { class: 1 }     →  { 'class': 1 }

   В ES3 имя свойства не могло совпадать с ключевым словом ни в записи
   через точку, ни в литерале объекта. Значение и порядок не меняются —
   только форма записи. */

import { rewrite, PREC } from './downgrade-rewrite.js';

export default {
  id: 'es3-props',
  year: 2009,
  features: ['reservedProps'],
  run(code, ast, { session }) {
    return rewrite(code, ast, {
      MemberExpression(n, ctx) {
        if (n.computed || n.property.type !== 'Identifier') return;
        if (!RESERVED.has(n.property.name)) return;
        return { text: `${ctx.expr(n.object, PREC.CALL)}[${JSON.stringify(n.property.name)}]`, prec: PREC.CALL };
      },

      Property(n, ctx) {
        if (n.computed || n.key.type !== 'Identifier' || !RESERVED.has(n.key.name)) return;
        if (n.kind !== 'init') ctx.fail('unsupported', n, 'в ES3 нет аксессоров', 'accessors');
        const value = n.shorthand ? n.key.name : ctx.expr(n.value, PREC.ASSIGN);
        return { text: `${JSON.stringify(n.key.name)}: ${value}`, prec: 0 };
      },
    }, { session });
  },
};

/* слова, зарезервированные в ES3 (включая «будущие»), которые ES5
   разрешил как имена свойств */
const RESERVED = new Set(['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch',
  'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'abstract',
  'boolean', 'byte', 'char', 'double', 'final', 'float', 'goto', 'implements', 'int',
  'interface', 'long', 'native', 'package', 'private', 'protected', 'public', 'short',
  'static', 'synchronized', 'throws', 'transient', 'volatile']);
