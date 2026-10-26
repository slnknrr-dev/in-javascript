/* ══════════════════════════════════════════════════════════════════════════
   source.js — чтение исходника: один вход для всего конвейера

   Для `.js` это просто файл. Для `.ts` — файл, из которого вырезаны типы:
   их места находит парсер (§6.7h), а здесь текст режется по этим местам.
   Дальше по конвейеру идёт обычный JavaScript, и ни граф, ни линкер, ни
   проходы понижения про TypeScript ничего не знают.

   Вырезается **ровно диапазон**, ничего не подставляя взамен: переводы
   строк вокруг остаются на местах, поэтому номера строк почти не едут, а
   ASI ведёт себя так же, как в исходнике. Соседние и вложенные диапазоны
   перед этим склеиваются — у индексной подписи, например, свой тип
   отмечен отдельно и лежит внутри её же диапазона.

   Что стирается: аннотации, параметры типа, `interface`, `type X = …`,
   `declare …`, подписи перегрузок, `as`/`satisfies`, `!`, модификаторы
   членов класса, `implements`, типовые импорты и экспорты. Проверено
   сравнением с самим node: `node run.ts` (со своим стриппером) и наш
   очищенный текст дают один и тот же вывод.
   ══════════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { parse } from './downgrade-parse.js';

export const isTypeScript = file => /\.ts$/.test(file);

/* Склеить пересекающиеся и соседние диапазоны. */
export function mergeRanges(ranges) {
  const out = [];
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0] || x[1] - y[1])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) { last[1] = Math.max(last[1], b); continue; }
    out.push([a, b]);
  }
  return out;
}

/* Текст без типов. Возвращает { code, ranges } — вырезанные места нужны
   тем, кто хочет знать, что именно ушло. */
export function stripTypes(src) {
  const ast = parse(src, { ts: true });
  const ranges = mergeRanges(ast.tsRanges ?? []);
  let code = '', pos = 0;
  for (const [a, b] of ranges) { code += src.slice(pos, a); pos = b; }
  return { code: code + src.slice(pos), ranges };
}

/* Исходник так, как его видит конвейер. keepTypes — для `@ts`-целей:
   там типы остаются на месте, понижается только код. */
export function readSource(abs, { file = abs, keepTypes = false } = {}) {
  const src = readFileSync(abs, 'utf8');
  return isTypeScript(file) && !keepTypes ? stripTypes(src).code : src;
}
