/* ══════════════════════════════════════════════════════════════════════════
   inversion-effect.js — инверсия каналов Universal Image Buffer

     inversion(uib, mode = 'rgb')  →  UIB

   Устройство то же, что у grayscale-effect.js: чужой буфер не изменяется,
   рабочую схему выбирает режим, uibConvert доводит буфер до неё и
   возвращает в исходную, все кадры обрабатываются разом.

   Режимы:
     rgb        RGBA, R,G,B := MAX - v — привычный негатив, альфа цела
     alpha      любая схема, A := MAX - A — цвет не трогается
     lightness  HSLA, L := MAX - L — оттенок и насыщенность на месте
     value      HSVA, V := MAX - V — оттенок и насыщенность на месте
     hue        HSLA, H += 180° — то есть ровно +32768 по кругу u16

   Оттенок в UIB — целое 0..65535 на полный оборот, поэтому поворот на
   половину круга точен и обходится без деления. Режим alpha не объявляет
   рабочей схемы вовсе: альфа лежит четвёртым каналом в любой из трёх, и
   конвертировать буфер ради неё незачем.

   Честная граница: rgb работает по гамма-кодированным значениям sRGB —
   это негатив из графического редактора, а не инверсия в линейном свете.
   Режимы, требующие смены схемы, платят округлением на каждом переходе:
   HSL/HSV здесь целочисленные, и RGBA → HSLA → RGBA не обязано быть
   тождественным.

   UIB-ядро импортируется из buffer-helper.js. Самодостаточен не этот
   файл, а его артефакт: сборка инлайнит импорт в один файл.
   ══════════════════════════════════════════════════════════════════════════ */

import { UIB_RGBA, UIB_HSVA, UIB_HSLA, UIB_MAX, uibRead, uibConvert }
  from './buffer-helper.js';


/* ══ режимы ════════════════════════════════════════════════════════════════
   space    — схема, в которой режим считает; null — годится любая
   channels — смещения внутри пикселя, которые переворачиваются, либо null
              для поворота оттенка
   ══════════════════════════════════════════════════════════════════════════ */

const INVERSION_MODES = {
  rgb:       { space: UIB_RGBA, channels: [0, 1, 2] },
  alpha:     { space: null, channels: [3] },
  lightness: { space: UIB_HSLA, channels: [2] },
  value:     { space: UIB_HSVA, channels: [2] },
  hue:       { space: UIB_HSLA, channels: null }
};

const HUE_HALF_TURN = 32768;              // 180° в целочисленном круге 0..65535

function inversion(uib, mode) {
  const key = String(mode === undefined ? 'rgb' : mode).toLowerCase();
  const m = INVERSION_MODES[key];
  if (!m) throw new Error('inversion: неизвестный режим ' + mode);

  const src = uibRead(uib);               // валидация чужого буфера
  const u = uibRead(src.buf.slice());     // дальше работаем только на копии

  const home = u.space;
  const work = m.space === null ? home : m.space;
  if (home !== work) uibConvert(u.px, home, work);

  const px = u.px;
  if (m.channels) {
    for (const c of m.channels)
      for (let i = c; i < px.length; i += 4) px[i] = UIB_MAX - px[i];
  } else {
    for (let i = 0; i < px.length; i += 4) px[i] = (px[i] + HUE_HALF_TURN) & 0xFFFF;
  }

  /* возвращаем в ту схему, в которой буфер пришёл — байт заголовка не менялся */
  if (home !== work) uibConvert(px, work, home);
  return u.buf;
}

inversion.modes = Object.keys(INVERSION_MODES);

export default inversion;
export { inversion };
