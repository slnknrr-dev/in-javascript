/* ══════════════════════════════════════════════════════════════════════════
   gen-unicode.mjs — таблица свойств Unicode для прохода regexp-unicode

   `\p{L}` в ES5 не выразить ничем, кроме явного перечисления диапазонов
   кодовых точек, а перечисление надо откуда-то взять. Берётся оно у самого
   движка: node умеет `\p{…}`, и здесь его ответ спрашивается для каждой
   кодовой точки подряд. Результат — вшитый в инструмент файл
   downgrade-unicode-props.json, одинаковый у всех сборок; версия Unicode
   записана в него же, чтобы было видно, чьими глазами таблица снята.

   Запуск (нужен только при обновлении таблицы):

     node downgrade-gen-unicode.js

   Формат: имя свойства → строка «пропуск.длина пропуск.длина …» в base36.
   Пропуск — сколько кодовых точек от конца прошлого диапазона, длина — на
   сколько диапазон тянется дальше своего начала. Обе величины маленькие,
   поэтому такая запись втрое короче списка пар.

   Суррогаты (U+D800…U+DFFF) проверяются по одному коду, а не как кодовая
   точка: в ES5-регулярке они и встречаются поодиночке.
   ══════════════════════════════════════════════════════════════════════════ */

import { writeFileSync } from 'node:fs';

/* Свойства, которые инструмент умеет разворачивать. Общие категории —
   все; из двоичных те, что встречаются в живом коде. Добавить ещё одно —
   дописать сюда и перегенерировать. */
const PROPS = [
  'L', 'Lu', 'Ll', 'Lt', 'Lm', 'Lo',
  'M', 'Mn', 'Mc', 'Me',
  'N', 'Nd', 'Nl', 'No',
  'P', 'Pc', 'Pd', 'Ps', 'Pe', 'Pi', 'Pf', 'Po',
  'S', 'Sm', 'Sc', 'Sk', 'So',
  'Z', 'Zs', 'Zl', 'Zp',
  'C', 'Cc', 'Cf', 'Co', 'Cs', 'Cn',
  'Alphabetic', 'White_Space', 'ASCII', 'Any', 'Assigned',
  'Uppercase', 'Lowercase', 'ID_Start', 'ID_Continue', 'Emoji',
];

const BS = String.fromCharCode(92);
const MAX = 0x10FFFF;

function rangesOf(name) {
  const re = new RegExp(BS + 'p{' + name + '}', 'u');
  const out = [];
  let start = -1;
  for (let cp = 0; cp <= MAX; cp++) {
    const ch = cp >= 0xD800 && cp <= 0xDFFF ? String.fromCharCode(cp) : String.fromCodePoint(cp);
    const hit = re.test(ch);
    if (hit && start < 0) start = cp;
    else if (!hit && start >= 0) { out.push([start, cp - 1]); start = -1; }
  }
  if (start >= 0) out.push([start, MAX]);
  return out;
}

const encode = ranges => {
  let prev = 0;
  return ranges.map(([a, b]) => {
    const s = (a - prev).toString(36) + '.' + (b - a).toString(36);
    prev = b + 1;
    return s;
  }).join(' ');
};

const props = {};
let bytes = 0;
for (const name of PROPS) {
  let ranges;
  try { ranges = rangesOf(name); }
  catch { console.error('пропущено (движок не знает свойства):', name); continue; }
  props[name] = encode(ranges);
  bytes += props[name].length;
  console.error(name.padEnd(12), String(ranges.length).padStart(5), 'диапазонов');
}

const out = {
  $comment: 'Сгенерировано downgrade-gen-unicode.js — руками не править. ' +
    'Формат: пропуск.длина в base36, см. заголовок генератора.',
  unicode: process.versions.unicode,
  node: process.versions.node,
  props,
};
const path = new URL('./downgrade-unicode-props.json', import.meta.url);
writeFileSync(path, JSON.stringify(out, null, 1) + '\n');
console.error('записано:', bytes, 'байт данных, Unicode', out.unicode);
