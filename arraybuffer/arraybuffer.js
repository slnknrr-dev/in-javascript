/* ══════════════════════════════════════════════════════════════════════════
   arraybuffer.js — вся тема одним файлом

   Баррель: собирает разрозненные файлы папки в один артефакт, чтобы
   потребителю хватило одного `import` (или одной вставки в проект). Сам
   ничего не делает — только перечисляет, что отсюда берут.

   Полифилы подключаются так же, как всё остальное:

     import { ArrayBuffer, Uint8Array, DataView } from './arraybuffer.js';

   В движке, где типизированные массивы есть, брать их отсюда не нужно:
   инструмент сам вставит полифил в артефакт той цели, которой он нужен
   (BACKLOG.md §6.7g).
   ══════════════════════════════════════════════════════════════════════════ */

export { ArrayBuffer, DataView } from './arraybuffer-shim.js';
export {
  TypedArray,
  Int8Array, Uint8Array, Uint8ClampedArray,
  Int16Array, Uint16Array,
  Int32Array, Uint32Array,
  Float32Array, Float64Array,
} from './typedarray-shim.js';
