/* ══════════════════════════════════════════════════════════════════════════
   grayscale-effect.js — обесцвечивание Universal Image Buffer

     grayscale(uib, mode = 'luma')  →  UIB

   Чужой буфер не изменяется: работа идёт на копии. Режим сам выбирает
   рабочую цветовую схему, uibConvert доводит буфер до неё и возвращает
   в исходную. Альфа не трогается никогда, все кадры обрабатываются разом,
   заголовок и задержки переживают операцию нетронутыми.

   Режимы:
     luma       RGBA, Rec. 709 — веса 0.2126 / 0.7152 / 0.0722
     luma601    RGBA, Rec. 601 — веса 0.299 / 0.587 / 0.114
     average    RGBA, среднее арифметическое трёх каналов
     lightness  HSLA, S := 0 — светлота L остаётся как есть
     value      HSVA, S := 0 — яркость V остаётся как есть

   Два последних режима не считают ничего: в своей схеме обесцвечивание —
   это обнуление одного канала. Ради этого схема и лежит в заголовке UIB.

   Честная граница: веса применяются к гамма-кодированным значениям sRGB
   без линеаризации. Так устроено большинство наивных реализаций, и от
   физически корректного результата это отличается заметно. Снипет
   иллюстрирует буфер, а не колориметрию.

   UIB-ядро импортируется из buffer-helper.js. Самодостаточен не этот
   файл, а его артефакт: сборка инлайнит импорт в один файл.
   ══════════════════════════════════════════════════════════════════════════ */

import { UIB_RGBA, UIB_HSVA, UIB_HSLA, UIB_MAX, uibRead, uibConvert }
  from './buffer-helper.js';


/* ══ режимы ════════════════════════════════════════════════════════════════
   space   — схема, в которой режим считает
   weights — веса RGB либо null, если режим сводится к обнулению насыщенности
   ══════════════════════════════════════════════════════════════════════════ */

const GRAY_MODES = {
  luma:      { space: UIB_RGBA, weights: [0.2126, 0.7152, 0.0722] },
  luma601:   { space: UIB_RGBA, weights: [0.299, 0.587, 0.114] },
  average:   { space: UIB_RGBA, weights: [1 / 3, 1 / 3, 1 / 3] },
  lightness: { space: UIB_HSLA, weights: null },
  value:     { space: UIB_HSVA, weights: null }
};

function grayscale(uib, mode) {
  const key = String(mode === undefined ? 'luma' : mode).toLowerCase();
  const m = GRAY_MODES[key];
  if (!m) throw new Error('grayscale: неизвестный режим ' + mode);

  const src = uibRead(uib);               // валидация чужого буфера
  const u = uibRead(src.buf.slice());     // дальше работаем только на копии

  const home = u.space;
  if (home !== m.space) uibConvert(u.px, home, m.space);

  const px = u.px;
  if (m.weights) {
    const wr = m.weights[0], wg = m.weights[1], wb = m.weights[2];
    for (let i = 0; i < px.length; i += 4) {
      const y = Math.round(wr * px[i] + wg * px[i + 1] + wb * px[i + 2]);
      px[i] = px[i + 1] = px[i + 2] = y > UIB_MAX ? UIB_MAX : y;
    }
  } else {
    /* насыщенность в ноль: L (или V) не трогаем, оттенок становится
       безразличен и остаётся каким был */
    for (let i = 1; i < px.length; i += 4) px[i] = 0;
  }

  /* возвращаем в ту схему, в которой буфер пришёл — байт заголовка не менялся */
  if (home !== m.space) uibConvert(px, m.space, home);
  return u.buf;
}

grayscale.modes = Object.keys(GRAY_MODES);

export default grayscale;
export { grayscale };
