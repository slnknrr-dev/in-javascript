/* ══════════════════════════════════════════════════════════════════════════
   bytes-helper.js — байтовая арифметика для ArrayBuffer, DataView и
   типизированных массивов: приведение индексов, скрытые свойства,
   упаковка чисел в байты и обратно.

   Helper: своих артефактов не имеет, инлайнится 1-в-1 в тех, кто его
   импортирует (BACKLOG.md §1).

   Написан на ES5 намеренно. Это часть полифила: он должен работать там,
   где нет того, что он полифилит, — а значит, не может рассчитывать ни
   на классы, ни на стрелки, ни на типизированные массивы. Понижать его
   нечего, и в артефакт любой цели он попадает как есть.
   ══════════════════════════════════════════════════════════════════════════ */

/* ToIntegerOrInfinity: NaN → 0, дробь → к нулю */
export function toInt(value) {
  var n = +value;
  if (n !== n) return 0;
  if (n === 0 || n === Infinity || n === -Infinity) return n;
  return n < 0 ? Math.ceil(n) : Math.floor(n);
}

/* ToIndex: длина или смещение — целое от 0 до 2^53−1 */
export function toIndex(value) {
  if (value === undefined) return 0;
  var n = toInt(value);
  if (n < 0 || n > 9007199254740991) throw new RangeError('Invalid array length');
  return n;
}

/* Неперечислимое свойство: у настоящих ArrayBuffer и DataView внутренние
   поля не видны ни в for-in, ни в Object.keys. */
export function defineHidden(obj, name, value) {
  try {
    Object.defineProperty(obj, name, { value: value, writable: true, enumerable: false, configurable: true });
  } catch (e) {
    obj[name] = value;
  }
}

/* Целое из байтов: little-endian по умолчанию, знаковое по флагу */
export function readInt(bytes, offset, size, littleEndian, signed) {
  var value = 0;
  for (var i = 0; i < size; i++) {
    var byte = bytes[offset + (littleEndian ? i : size - 1 - i)];
    value += byte * Math.pow(256, i);
  }
  if (signed) {
    var half = Math.pow(256, size) / 2;
    if (value >= half) value -= half * 2;
  }
  return value;
}

/* Целое в байты: лишние разряды отбрасываются, как у настоящих
   типизированных массивов */
export function writeInt(bytes, offset, size, littleEndian, value) {
  var v = toInt(value);
  /* ToInt8/ToUint32 и прочие: NaN и бесконечность дают ноль */
  if (v === Infinity || v === -Infinity) v = 0;
  var limit = Math.pow(256, size);
  v = v % limit;
  if (v < 0) v += limit;
  for (var i = 0; i < size; i++) {
    bytes[offset + (littleEndian ? i : size - 1 - i)] = v % 256;
    v = Math.floor(v / 256);
  }
}

/* ── IEEE-754 ─────────────────────────────────────────────────────────────
   Классический алгоритм распаковки и упаковки: знак, экспонента, мантисса
   собираются побайтно. mLen — бит мантиссы (23 у float32, 52 у float64),
   size — всего байт. ── */

export function readFloat(bytes, offset, size, littleEndian, mLen) {
  var eLen = size * 8 - mLen - 1;
  var eMax = (1 << eLen) - 1;
  var eBias = eMax >> 1;
  var nBits = -7;
  var i = littleEndian ? size - 1 : 0;
  var d = littleEndian ? -1 : 1;
  var s = bytes[offset + i];
  var e, m;

  i += d;
  e = s & ((1 << (-nBits)) - 1);
  s >>= (-nBits);
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + bytes[offset + i], i += d, nBits -= 8) { /* экспонента */ }

  m = e & ((1 << (-nBits)) - 1);
  e >>= (-nBits);
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + bytes[offset + i], i += d, nBits -= 8) { /* мантисса */ }

  if (e === 0) e = 1 - eBias;
  else if (e === eMax) return m ? NaN : (s ? -1 : 1) * Infinity;
  else { m = m + Math.pow(2, mLen); e = e - eBias; }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
}

export function writeFloat(bytes, offset, size, littleEndian, mLen, value) {
  var eLen = size * 8 - mLen - 1;
  var eMax = (1 << eLen) - 1;
  var eBias = eMax >> 1;
  var rt = mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0;
  var i = littleEndian ? 0 : size - 1;
  var d = littleEndian ? 1 : -1;
  var v = +value;
  var s = v < 0 || (v === 0 && 1 / v < 0) ? 1 : 0;
  var e, m, c;

  v = Math.abs(v);
  if (v !== v || v === Infinity) {
    m = v !== v ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(v) / Math.LN2);
    if (v * (c = Math.pow(2, -e)) < 1) { e--; c *= 2; }
    if (e + eBias >= 1) v += rt / c;
    else v += rt * Math.pow(2, 1 - eBias);
    if (v * c >= 2) { e++; c /= 2; }

    if (e + eBias >= eMax) { m = 0; e = eMax; }
    else if (e + eBias >= 1) { m = (v * c - 1) * Math.pow(2, mLen); e = e + eBias; }
    else { m = v * Math.pow(2, eBias - 1) * Math.pow(2, mLen); e = 0; }
  }

  for (; mLen >= 8; bytes[offset + i] = m & 0xFF, i += d, m /= 256, mLen -= 8) { /* мантисса */ }
  e = (e << mLen) | m;
  eLen += mLen;
  for (; eLen > 0; bytes[offset + i] = e & 0xFF, i += d, e /= 256, eLen -= 8) { /* экспонента */ }
  bytes[offset + i - d] |= s * 128;
}

/* float32 округляет значение до ближайшего представимого — то же делает
   и запись в Float32Array */
export function roundFloat32(value) {
  var bytes = [0, 0, 0, 0];
  writeFloat(bytes, 0, 4, true, 23, value);
  return readFloat(bytes, 0, 4, true, 23);
}

/* Uint8ClampedArray: обрезка в 0..255 с округлением половин к чётному */
export function clampByte(value) {
  var v = +value;
  if (v !== v) return 0;
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  var floor = Math.floor(v);
  var rest = v - floor;
  if (rest < 0.5) return floor;
  if (rest > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}
