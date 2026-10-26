/* es5-literals — литералы ES2015, которых нет в ES5 (и в ES3)

     0b1010, 0o777   →  10, 511
     '\u{1F600}'     →  '😀' (суррогатная пара)

   Значение то же, меняется только запись. Экранирование кодовой точки
   разворачивается и в строках, и в шаблонах — там оно означает ровно тот
   же символ. */

import { rewrite } from './downgrade-rewrite.js';

const BS = String.fromCharCode(92);

/* `\u{...}` → `\uXXXX` или суррогатная пара; экранированный обратный
   слэш (`\\u{`) не трогается */
export function expandCodePoints(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== BS) { out += raw[i]; continue; }
    const rest = raw.slice(i);
    const m = /^\\u\{([0-9a-fA-F]+)\}/.exec(rest);
    if (!m) { out += raw[i] + (raw[i + 1] ?? ''); i++; continue; }
    const cp = parseInt(m[1], 16);
    const hex = n => BS + 'u' + n.toString(16).toUpperCase().padStart(4, '0');
    if (cp <= 0xFFFF) out += hex(cp);
    else {
      const v = cp - 0x10000;
      out += hex(0xD800 + (v >> 10)) + hex(0xDC00 + (v & 0x3FF));
    }
    i += m[0].length - 1;
  }
  return out;
}

export default {
  id: 'es5-literals',
  year: 2015,
  features: ['binaryOctal', 'codePointEscape'],
  run(code, ast, { session }) {
    return rewrite(code, ast, {
      Literal(n) {
        if (typeof n.value === 'number' && /^0[bBoO]/.test(n.raw))
          return { text: String(parseInt(n.raw.slice(2), /^0[bB]/.test(n.raw) ? 2 : 8)), prec: 19 };
        if (typeof n.value === 'string' && n.raw.includes(BS + 'u{'))
          return { text: expandCodePoints(n.raw), prec: 19 };
      },
      TemplateElement(n, ctx) {
        const raw = ctx.raw(n);
        if (!raw.includes(BS + 'u{')) return;
        return { text: expandCodePoints(raw), prec: 19 };
      },
    }, { session });
  },
};
