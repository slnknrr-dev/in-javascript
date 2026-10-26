/* ══════════════════════════════════════════════════════════════════════════
   typedarray-shim.js — типизированные массивы для движков, где их нет

   Девять конструкторов на общем прототипе (%TypedArray%.prototype), поверх
   ArrayBuffer из arraybuffer-shim.js. Элементы читаются и пишутся через
   аксессоры, заведённые на каждый индекс при создании: только так в ES5
   можно получить `a[i]`, которое лезет в байты буфера, а не в обычное
   свойство. Отсюда и цена: создание массива на N элементов — это N пар
   геттер/сеттер, то есть полифил годится для сотен и тысяч элементов, но
   не для мегабайтных картинок. Там, где типизированные массивы есть
   нативно, полифил не подключается вовсе.

   Что воспроизводится: конструкторы от длины, от массива (и любого
   массивоподобного или итерируемого), от другого типизированного массива
   и от буфера со смещением; арифметика типа при записи (обрезание,
   clamp, float32); буфер общий для представлений; методы прототипа,
   from/of, итераторы.

   Чего нет: SharedArrayBuffer, species, наследования от %TypedArray% и
   изменения длины буфера — в ES5 этого либо нет, либо оно требует Proxy.
   ══════════════════════════════════════════════════════════════════════════ */

import { ArrayBuffer, relativeIndex } from './arraybuffer-shim.js';
import {
  toIndex, toInt, defineHidden, readInt, writeInt, readFloat, writeFloat, clampByte,
} from './bytes-helper.js';

/* ── общий прототип ─────────────────────────────────────────────────────── */

export function TypedArray() {
  throw new TypeError('Abstract class TypedArray not directly constructable');
}

var proto = TypedArray.prototype;

/* значение элемента: у каждого типа своя пара «прочитать/записать» */
function elementAt(self, index) {
  return self._read(self.buffer._bytes, self.byteOffset + index * self.BYTES_PER_ELEMENT);
}
function setElementAt(self, index, value) {
  self._write(self.buffer._bytes, self.byteOffset + index * self.BYTES_PER_ELEMENT, value);
}

proto.at = function (index) {
  var k = toInt(index);
  if (k < 0) k += this.length;
  return k < 0 || k >= this.length ? undefined : elementAt(this, k);
};

proto.set = function (source, offset) {
  var start = toIndex(offset);
  var len = source.length >>> 0;
  if (start + len > this.length) throw new RangeError('offset is out of bounds');
  /* через промежуточный массив: источник может быть тем же буфером */
  var values = new Array(len);
  for (var i = 0; i < len; i++) values[i] = source[i];
  for (var k = 0; k < len; k++) setElementAt(this, start + k, values[k]);
};

proto.subarray = function (begin, end) {
  var from = relativeIndex(begin, this.length, 0);
  var to = relativeIndex(end, this.length, this.length);
  var count = Math.max(to - from, 0);
  return new this.constructor(this.buffer, this.byteOffset + from * this.BYTES_PER_ELEMENT, count);
};

proto.slice = function (begin, end) {
  var from = relativeIndex(begin, this.length, 0);
  var to = relativeIndex(end, this.length, this.length);
  var out = new this.constructor(Math.max(to - from, 0));
  for (var i = 0; i < out.length; i++) out[i] = elementAt(this, from + i);
  return out;
};

proto.fill = function (value, start, end) {
  var from = relativeIndex(start, this.length, 0);
  var to = relativeIndex(end, this.length, this.length);
  for (var i = from; i < to; i++) setElementAt(this, i, value);
  return this;
};

proto.copyWithin = function (target, start, end) {
  var len = this.length;
  var to = relativeIndex(target, len, 0);
  var from = relativeIndex(start, len, 0);
  var last = relativeIndex(end, len, len);
  var count = Math.min(last - from, len - to);
  var values = [];
  for (var i = 0; i < count; i++) values.push(elementAt(this, from + i));
  for (var k = 0; k < count; k++) setElementAt(this, to + k, values[k]);
  return this;
};

proto.indexOf = function (value, fromIndex) {
  var start = toInt(fromIndex);
  if (start < 0) start += this.length;
  for (var i = Math.max(start, 0); i < this.length; i++) if (elementAt(this, i) === value) return i;
  return -1;
};

proto.lastIndexOf = function (value, fromIndex) {
  var start = fromIndex === undefined ? this.length - 1 : toInt(fromIndex);
  if (start < 0) start += this.length;
  for (var i = Math.min(start, this.length - 1); i >= 0; i--) if (elementAt(this, i) === value) return i;
  return -1;
};

proto.includes = function (value, fromIndex) {
  var start = toInt(fromIndex);
  if (start < 0) start += this.length;
  for (var i = Math.max(start, 0); i < this.length; i++) {
    var v = elementAt(this, i);
    if (v === value || (v !== v && value !== value)) return true;
  }
  return false;
};

proto.join = function (separator) {
  var sep = separator === undefined ? ',' : String(separator);
  var out = '';
  for (var i = 0; i < this.length; i++) out += (i ? sep : '') + elementAt(this, i);
  return out;
};

proto.toString = function () { return this.join(','); };

proto.forEach = function (fn, thisArg) {
  for (var i = 0; i < this.length; i++) fn.call(thisArg, elementAt(this, i), i, this);
};

proto.map = function (fn, thisArg) {
  var out = new this.constructor(this.length);
  for (var i = 0; i < this.length; i++) out[i] = fn.call(thisArg, elementAt(this, i), i, this);
  return out;
};

proto.filter = function (fn, thisArg) {
  var kept = [];
  for (var i = 0; i < this.length; i++) {
    var v = elementAt(this, i);
    if (fn.call(thisArg, v, i, this)) kept.push(v);
  }
  var out = new this.constructor(kept.length);
  for (var k = 0; k < kept.length; k++) out[k] = kept[k];
  return out;
};

proto.reduce = function (fn, initial) {
  var i = 0, acc;
  if (arguments.length > 1) acc = initial;
  else {
    if (this.length === 0) throw new TypeError('Reduce of empty array with no initial value');
    acc = elementAt(this, i++);
  }
  for (; i < this.length; i++) acc = fn(acc, elementAt(this, i), i, this);
  return acc;
};

proto.reduceRight = function (fn, initial) {
  var i = this.length - 1, acc;
  if (arguments.length > 1) acc = initial;
  else {
    if (this.length === 0) throw new TypeError('Reduce of empty array with no initial value');
    acc = elementAt(this, i--);
  }
  for (; i >= 0; i--) acc = fn(acc, elementAt(this, i), i, this);
  return acc;
};

proto.some = function (fn, thisArg) {
  for (var i = 0; i < this.length; i++) if (fn.call(thisArg, elementAt(this, i), i, this)) return true;
  return false;
};

proto.every = function (fn, thisArg) {
  for (var i = 0; i < this.length; i++) if (!fn.call(thisArg, elementAt(this, i), i, this)) return false;
  return true;
};

proto.find = function (fn, thisArg) {
  for (var i = 0; i < this.length; i++) {
    var v = elementAt(this, i);
    if (fn.call(thisArg, v, i, this)) return v;
  }
  return undefined;
};

proto.findIndex = function (fn, thisArg) {
  for (var i = 0; i < this.length; i++) if (fn.call(thisArg, elementAt(this, i), i, this)) return i;
  return -1;
};

proto.findLast = function (fn, thisArg) {
  for (var i = this.length - 1; i >= 0; i--) {
    var v = elementAt(this, i);
    if (fn.call(thisArg, v, i, this)) return v;
  }
  return undefined;
};

proto.findLastIndex = function (fn, thisArg) {
  for (var i = this.length - 1; i >= 0; i--) if (fn.call(thisArg, elementAt(this, i), i, this)) return i;
  return -1;
};

proto.reverse = function () {
  var values = [];
  for (var i = 0; i < this.length; i++) values.push(elementAt(this, i));
  for (var k = 0; k < this.length; k++) setElementAt(this, k, values[this.length - 1 - k]);
  return this;
};

/* по умолчанию — числовое сравнение, а не строковое, как у массива */
proto.sort = function (compare) {
  var values = [];
  for (var i = 0; i < this.length; i++) values.push(elementAt(this, i));
  values.sort(compare || function (a, b) {
    if (a !== a) return b !== b ? 0 : 1;
    if (b !== b) return -1;
    if (a < b) return -1;
    if (a > b) return 1;
    if (a === 0 && b === 0) return (1 / a < 0 ? -1 : 1) - (1 / b < 0 ? -1 : 1);
    return 0;
  });
  for (var k = 0; k < values.length; k++) setElementAt(this, k, values[k]);
  return this;
};

/* итераторы: объект с next(), и он же итерируемый, если Symbol есть */
function makeIterator(self, kind) {
  var i = 0;
  var it = {
    next: function () {
      if (i >= self.length) return { value: undefined, done: true };
      var index = i++;
      var value = kind === 'keys' ? index
        : kind === 'entries' ? [index, elementAt(self, index)]
          : elementAt(self, index);
      return { value: value, done: false };
    },
  };
  if (typeof Symbol === 'function' && Symbol.iterator) it[Symbol.iterator] = function () { return this; };
  return it;
}

proto.values = function () { return makeIterator(this, 'values'); };
proto.keys = function () { return makeIterator(this, 'keys'); };
proto.entries = function () { return makeIterator(this, 'entries'); };
if (typeof Symbol === 'function' && Symbol.iterator) proto[Symbol.iterator] = proto.values;

/* ── конструкторы ───────────────────────────────────────────────────────── */

/* Элементы буфера видны как a[0], a[1], … — в ES5 это возможно только
   аксессорами, заведёнными на каждый индекс. */
function defineIndex(self, index) {
  Object.defineProperty(self, index, {
    get: function () { return elementAt(self, index); },
    set: function (value) { setElementAt(self, index, value); },
    enumerable: true,
    configurable: true,
  });
}

/* источник: массив, массивоподобное или итерируемое */
function valuesOf(source) {
  if (typeof source.length === 'number') {
    var out = new Array(source.length >>> 0);
    for (var i = 0; i < out.length; i++) out[i] = source[i];
    return out;
  }
  if (typeof Symbol === 'function' && Symbol.iterator && typeof source[Symbol.iterator] === 'function') {
    var list = [], it = source[Symbol.iterator](), step;
    while (!(step = it.next()).done) list.push(step.value);
    return list;
  }
  throw new TypeError('The object is not array-like or iterable');
}

function makeType(name, size, read, write) {
  function Type(arg, byteOffset, length) {
    if (!(this instanceof Type)) throw new TypeError("Constructor " + name + " requires 'new'");
    defineHidden(this, 'BYTES_PER_ELEMENT', size);
    defineHidden(this, '_read', read);
    defineHidden(this, '_write', write);
    defineHidden(this, '_isView', true);

    var count, values = null;
    if (arg && arg._bytes) {                         /* от буфера */
      var offset = toIndex(byteOffset);
      if (offset % size) throw new RangeError('start offset of ' + name + ' should be a multiple of ' + size);
      if (offset > arg.byteLength) throw new RangeError('Start offset is outside the bounds of the buffer');
      count = length === undefined ? Math.floor((arg.byteLength - offset) / size) : toIndex(length);
      if (offset + count * size > arg.byteLength) throw new RangeError('Invalid typed array length');
      defineHidden(this, 'buffer', arg);
      defineHidden(this, 'byteOffset', offset);
    } else {
      if (arg === undefined || typeof arg === 'number') count = toIndex(arg);
      else { values = valuesOf(arg); count = values.length; }
      defineHidden(this, 'buffer', new ArrayBuffer(count * size));
      defineHidden(this, 'byteOffset', 0);
    }

    defineHidden(this, 'length', count);
    defineHidden(this, 'byteLength', count * size);
    for (var i = 0; i < count; i++) defineIndex(this, i);
    if (values) for (var k = 0; k < count; k++) setElementAt(this, k, values[k]);
  }

  Type.prototype = Object.create(proto);
  Type.prototype.constructor = Type;
  Type.BYTES_PER_ELEMENT = size;
  Type.prototype.BYTES_PER_ELEMENT = size;

  Type.from = function (source, mapFn, thisArg) {
    var values = valuesOf(source);
    var out = new Type(values.length);
    for (var i = 0; i < values.length; i++) out[i] = mapFn ? mapFn.call(thisArg, values[i], i) : values[i];
    return out;
  };
  Type.of = function () { return Type.from(arguments); };
  return Type;
}

var readInt8 = function (bytes, at) { return readInt(bytes, at, 1, true, true); };
var writeInt8 = function (bytes, at, v) { writeInt(bytes, at, 1, true, v); };
var readUint8 = function (bytes, at) { return readInt(bytes, at, 1, true, false); };
var writeUint8 = function (bytes, at, v) { writeInt(bytes, at, 1, true, v); };

export var Int8Array = makeType('Int8Array', 1, readInt8, writeInt8);
export var Uint8Array = makeType('Uint8Array', 1, readUint8, writeUint8);
export var Uint8ClampedArray = makeType('Uint8ClampedArray', 1, readUint8,
  function (bytes, at, v) { writeInt(bytes, at, 1, true, clampByte(v)); });
export var Int16Array = makeType('Int16Array', 2,
  function (bytes, at) { return readInt(bytes, at, 2, true, true); },
  function (bytes, at, v) { writeInt(bytes, at, 2, true, v); });
export var Uint16Array = makeType('Uint16Array', 2,
  function (bytes, at) { return readInt(bytes, at, 2, true, false); },
  function (bytes, at, v) { writeInt(bytes, at, 2, true, v); });
export var Int32Array = makeType('Int32Array', 4,
  function (bytes, at) { return readInt(bytes, at, 4, true, true); },
  function (bytes, at, v) { writeInt(bytes, at, 4, true, v); });
export var Uint32Array = makeType('Uint32Array', 4,
  function (bytes, at) { return readInt(bytes, at, 4, true, false); },
  function (bytes, at, v) { writeInt(bytes, at, 4, true, v); });
export var Float32Array = makeType('Float32Array', 4,
  function (bytes, at) { return readFloat(bytes, at, 4, true, 23); },
  function (bytes, at, v) { writeFloat(bytes, at, 4, true, 23, v); });
export var Float64Array = makeType('Float64Array', 8,
  function (bytes, at) { return readFloat(bytes, at, 8, true, 52); },
  function (bytes, at, v) { writeFloat(bytes, at, 8, true, 52, v); });
