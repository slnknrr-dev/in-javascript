/* regexp-dotall — флаг `s` у регулярки (ES2018)

     /a.b/s   →  /a[\s\S]b/

   С флагом s точка совпадает с любым символом, включая переводы строки;
   `[\s\S]` — то же самое в любом движке. С флагом u класс совпадает с
   целой кодовой точкой, как и точка, так что суррогатные пары не рвутся.
   Точка внутри класса `[.]` и экранированная `\.` — обычные символы. */

import { rewrite } from './downgrade-rewrite.js';

export function dotAllPattern(pattern) {
  let out = '', inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') { out += c + (pattern[i + 1] ?? ''); i++; continue; }
    if (inClass) { if (c === ']') inClass = false; out += c; continue; }
    if (c === '[') { inClass = true; out += c; continue; }
    out += c === '.' ? '[\\s\\S]' : c;
  }
  return out;
}

export default {
  id: 'regexp-dotall',
  year: 2018,
  features: ['regexpDotAll'],
  run(code, ast, { session }) {
    return rewrite(code, ast, {
      Literal(n) {
        if (!n.regex || !n.regex.flags.includes('s')) return;
        return { text: `/${dotAllPattern(n.regex.pattern)}/${n.regex.flags.replace('s', '')}`, prec: 19 };
      },
    }, { session });
  },
};
