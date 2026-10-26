/* ══════════════════════════════════════════════════════════════════════════
   arraybuffer-shim.js — ArrayBuffer и DataView для движков, где их нет

   Полифил, а не обёртка: конструкторы настоящие, `instanceof` работает,
   байты лежат в обычном массиве чисел 0..255, поэтому два представления
   одного буфера видят правки друг друга — как и должно быть.

   Написан на ES5 намеренно (см. bytes-helper.js): полифил обязан
   работать там, где нет того, что он полифилит. Из ES5 нужен только
   Object.defineProperty — в ES3 дескрипторов нет, и там полифил
   невозможен.

   Порядок байт по умолчанию — little-endian, как у всех живых движков.

     const buf = new ArrayBuffer(8);
     const view = new DataView(buf);
     view.setFloat64(0, Math.PI);
     view.getFloat64(0) === Math.PI
   ══════════════════════════════════════════════════════════════════════════ */

import { toIndex, defineHidden, readInt, writeInt, readFloat, writeFloat } from './bytes-helper.js';

/* ── ArrayBuffer ────────────────────────────────────────────────────────── */

export function ArrayBuffer(length) {
  if (!(this instanceof ArrayBuffer)) throw new TypeError("Constructor ArrayBuffer requires 'new'");
  var n = toIndex(length);
  var bytes = new Array(n);
  for (var i = 0; i < n; i++) bytes[i] = 0;
  defineHidden(this, '_bytes', bytes);
  defineHidden(this, 'byteLength', n);
}

ArrayBuffer.isView = function (value) {
  return !!value && typeof value === 'object' && !!value._isView;
};

ArrayBuffer.prototype.slice = function (start, end) {
  var len = this.byteLength;
  var from = relativeIndex(start, len, 0);
  var to = relativeIndex(end, len, len);
  var out = new ArrayBuffer(Math.max(to - from, 0));
  for (var i = 0; i < out.byteLength; i++) out._bytes[i] = this._bytes[from + i];
  return out;
};

/* start/end как у slice: отрицательные считаются от конца */
export function relativeIndex(value, length, whenUndefined) {
  if (value === undefined) return whenUndefined;
  var n = +value;
  n = n !== n ? 0 : n < 0 ? Math.ceil(n) : Math.floor(n);
  if (n < 0) return Math.max(length + n, 0);
  return Math.min(n, length);
}

/* ── DataView ───────────────────────────────────────────────────────────── */

export function DataView(buffer, byteOffset, byteLength) {
  if (!(this instanceof DataView)) throw new TypeError("Constructor DataView requires 'new'");
  if (!buffer || !buffer._bytes) throw new TypeError('First argument to DataView constructor must be an ArrayBuffer');
  var offset = toIndex(byteOffset);
  if (offset > buffer.byteLength) throw new RangeError('Start offset is outside the bounds of the buffer');
  var length = byteLength === undefined ? buffer.byteLength - offset : toIndex(byteLength);
  if (offset + length > buffer.byteLength) throw new RangeError('Invalid DataView length');
  defineHidden(this, 'buffer', buffer);
  defineHidden(this, 'byteOffset', offset);
  defineHidden(this, 'byteLength', length);
  defineHidden(this, '_isView', true);
}

/* Каждый get/set проверяет границы — как настоящий DataView, который
   бросает RangeError, а не читает соседнюю память. */
function at(view, offset, size) {
  var n = toIndex(offset);
  if (n + size > view.byteLength) throw new RangeError('Offset is outside the bounds of the DataView');
  return view.byteOffset + n;
}

function intAccessors(name, size, signed) {
  DataView.prototype['get' + name] = function (offset, littleEndian) {
    return readInt(this.buffer._bytes, at(this, offset, size), size, size === 1 ? true : !!littleEndian, signed);
  };
  DataView.prototype['set' + name] = function (offset, value, littleEndian) {
    writeInt(this.buffer._bytes, at(this, offset, size), size, size === 1 ? true : !!littleEndian, value);
  };
}

function floatAccessors(name, size, mLen) {
  DataView.prototype['get' + name] = function (offset, littleEndian) {
    return readFloat(this.buffer._bytes, at(this, offset, size), size, !!littleEndian, mLen);
  };
  DataView.prototype['set' + name] = function (offset, value, littleEndian) {
    writeFloat(this.buffer._bytes, at(this, offset, size), size, !!littleEndian, mLen, value);
  };
}

intAccessors('Int8', 1, true);
intAccessors('Uint8', 1, false);
intAccessors('Int16', 2, true);
intAccessors('Uint16', 2, false);
intAccessors('Int32', 4, true);
intAccessors('Uint32', 4, false);
floatAccessors('Float32', 4, 23);
floatAccessors('Float64', 8, 52);
