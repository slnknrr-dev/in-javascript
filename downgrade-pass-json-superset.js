/* json-superset — U+2028 и U+2029 в строковом литерале (ES2019)

   До ES2019 это были переводы строки, и строка с ними в исходнике не
   закрывалась. Понижение — экранировать: `\u2028`. Особый случай —
   продолжение строки (`\` прямо перед символом): оно выбрасывает перевод
   из значения, поэтому выбрасывается целиком. */

import { rewrite } from './downgrade-rewrite.js';

export default {
  id: 'json-superset',
  year: 2019,
  features: ['jsonSuperset'],
  run(code, ast, { session }) {
    return rewrite(code, ast, {
      Literal(n) {
        if (typeof n.value !== 'string' || !/[\u2028\u2029]/.test(n.raw)) return;
        let out = '';
        for (let i = 0; i < n.raw.length; i++) {
          const c = n.raw[i];
          if (c === '\\') { out += c + n.raw[i + 1]; i++; continue; }
          if (c === '\u2028' || c === '\u2029') { out += c === '\u2028' ? '\\u2028' : '\\u2029'; continue; }
          out += c;
        }
        /* `\` + U+2028 — продолжение строки: не символ значения */
        out = out.replace(/\\[\u2028\u2029]/g, '');
        return { text: out, prec: 19 };
      },
    }, { session });
  },
};
