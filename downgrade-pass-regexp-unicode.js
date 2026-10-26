/* ══════════════════════════════════════════════════════════════════════════
   regexp-unicode — флаг `u` (ES2015) и `\p{…}` (ES2018)

     /\p{L}+/u   →  es6:  /[\u{41}-\u{5A}…]+/u      свойство развёрнуто
                    es5:  new RegExp(…, "")          и пары суррогатов

   Разворачивает сам шаблон regexp.js; здесь — только то, как результат
   попадает в код.

   **Почему иногда `new RegExp`.** Развёрнутое `\p{L}` — это 684 диапазона,
   килобайтов десять текста. В `email.js` оно встречается 34 раза, и
   литералами артефакт вырос бы до сотен килобайт. Поэтому длинные куски
   выносятся в константы runtime-блока (одно имя на одинаковый текст), а
   литерал становится `new RegExp("…" + имя + "…", "флаги")`. Программа та
   же: литерал тоже создаёт новый объект при каждом вычислении. Отличие
   одно и видно только тому, кто читает `re.source`, — там теперь
   развёрнутый текст.

   Короткие результаты (без свойств) остаются литералом: `/[a-z]/u` →
   `/[a-z]/`.
   ══════════════════════════════════════════════════════════════════════════ */

import { rewrite, PREC } from './downgrade-rewrite.js';
import { lowerPattern, lowerFlags, RegexpError } from './downgrade-regexp.js';

/* кусок длиннее этого выносится в константу */
const HOIST_FROM = 120;
const MARK = String.fromCharCode(1);

export default {
  id: 'regexp-unicode',
  year: 2015,
  features: ['regexpUnicode', 'regexpUnicodeProperty', 'regexpNamedGroups'],
  run(code, ast, { session, profile }) {
    /* цель понимает `u`, но не понимает `\p{…}` — тогда флаг остаётся */
    const keepUnicode = profile.es >= 6;
    /* именованные группы — ES2018 */
    const dropNames = profile.es < 9;
    /* Имя группы видно из кода двумя способами: `m.groups.year` и замена
       вида $<year> в строке. Снять имена молча — сломать и то, и другое,
       поэтому упоминание любого из них в файле означает отказ. */
    const usesNames = dropNames && /\.groups\b|\$</.test(code);

    return rewrite(code, ast, {
      Literal(n, ctx) {
        if (!n.regex) return;
        const { pattern, flags } = n.regex;
        const needsU = flags.includes('u') && !keepUnicode;
        const needsProp = /\\[pP]\{/.test(pattern);
        const needsNames = dropNames && /\(\?<[A-Za-z_$]|\\k</.test(pattern);
        if (!needsU && !needsProp && !needsNames) return;
        if (needsNames && usesNames)
          ctx.fail('pending', n, 'имена групп пришлось бы снять, а код читает `.groups` или замену по имени', 'regexpNamedGroups');

        const chunks = [];
        const hoist = text => {
          if (text.length < HOIST_FROM) return text;
          chunks.push(text);
          return MARK + (chunks.length - 1) + MARK;
        };

        let out;
        try { out = lowerPattern(pattern, flags, { keepUnicode, hoist, dropNames }); }
        catch (e) {
          if (e instanceof RegexpError) ctx.fail(e.kind, n, e.message, 'regexpUnicode');
          throw e;
        }
        const outFlags = lowerFlags(flags, { keepUnicode });

        if (!chunks.length) {
          check(out, outFlags, ctx, n);
          return { text: `/${out}/${outFlags}`, prec: PREC.PRIMARY };
        }

        /* собрать выражение: строки вперемежку с именами констант */
        check(out.split(MARK).map((p, i) => (i % 2 ? chunks[(p | 0)] : p)).join(''), outFlags, ctx, n);
        const parts = out.split(MARK).map((piece, i) => i % 2
          ? ctx.constant(chunks[piece | 0], 'set')
          : JSON.stringify(piece)).filter(p => p !== '""');
        return { text: `new RegExp(${parts.join(' + ')}, ${JSON.stringify(outFlags)})`, prec: PREC.PRIMARY };
      },
    }, { session });
  },
};

/* Понижённый шаблон обязан быть регуляркой — иначе артефакт не загрузится
   у того, кто его возьмёт, а не у нас. */
function check(pattern, flags, ctx, node) {
  try { new RegExp(pattern, flags); }
  catch (e) { ctx.fail('unsupported', node, `понижённая регулярка не разбирается: ${e.message}`, 'regexpUnicode'); }
}
