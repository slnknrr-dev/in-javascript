/* ══════════════════════════════════════════════════════════════════════════
   downgrade-runtime-helpers.js — вспомогательные функции, которые зовут проходы

   В отличие от шимов (*-polyfil.js), они ничего не добавляют в
   глобальные объекты: это обычные функции артефакта, на которые
   ссылается понижённый код. Попадают в runtime-блок, только если проход
   их действительно вызвал, — под свежим именем, не занятым в файле.

   Написаны на ES5: ими будут пользоваться и цели es5 (этап M4). Имя
   функции подставляется снаружи — каждая запись это name => текст.
   ══════════════════════════════════════════════════════════════════════════ */

/* Что помощнику нужно от движка без всяких «если есть». Проверяется при
   понижении: помощник попадает в артефакт уже после того, как детектор
   примитивов прошёл по коду, и сам себя он бы не поймал — а тогда
   es5-артефакт с async молча ссылался бы на Promise, которого нет.
   Прикрытое проверкой (`if (Object.defineProperty)`, `typeof Symbol`)
   сюда не входит: оно и без примитива работает. */
export const HELPER_NEEDS = {
  defineField: ['Object.defineProperty'],
  accessor: ['Object.defineProperty'],
  objectSpread: ['Object.keys', 'Object.defineProperty'],
  objectRest: ['Object.keys', 'Object.defineProperty'],
  inherits: ['Object.create'],
  superGet: ['Object.getOwnPropertyDescriptor'],
  bufferAlloc: ['Uint8Array'],
  bufferAllocUnsafe: ['Uint8Array'],
  async: ['Promise'],
};

export const HELPERS = {

  /* поле класса: определяется, а не присваивается — сеттер прототипа
     не вызывается, как у настоящего поля */
  defineField: name => `
function ${name}(obj, key, value) {
  Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true });
  return value;
}`,

  /* приватное поле: WeakMap от экземпляра к значению */
  privGet: name => `
function ${name}(obj, map) {
  if (!map.has(obj)) throw new TypeError('Cannot read private member from an object whose class did not declare it');
  return map.get(obj);
}`,

  privSet: name => `
function ${name}(obj, map, value) {
  if (!map.has(obj)) throw new TypeError('Cannot write private member to an object whose class did not declare it');
  map.set(obj, value);
  return value;
}`,

  /* приватный метод: WeakSet экземпляров как бренд */
  privMethod: name => `
function ${name}(obj, brand, fn) {
  if (!brand.has(obj)) throw new TypeError('Receiver must be an instance of the class that declared the private method');
  return fn;
}`,

  privAccessorGet: name => `
function ${name}(obj, brand, get) {
  if (!brand.has(obj)) throw new TypeError('Cannot read private member from an object whose class did not declare it');
  if (!get) throw new TypeError('Private accessor was defined without a getter');
  return get.call(obj);
}`,

  privAccessorSet: name => `
function ${name}(obj, brand, set, value) {
  if (!brand.has(obj)) throw new TypeError('Cannot write private member to an object whose class did not declare it');
  if (!set) throw new TypeError('Private accessor was defined without a setter');
  set.call(obj, value);
  return value;
}`,

  /* \`#x in obj\`: справа обязан быть объект */
  privIn: name => `
function ${name}(set, obj) {
  if (Object(obj) !== obj) throw new TypeError("Cannot use 'in' operator to search for a private field in a non-object");
  return set.has(obj);
}`,

  /* {...a} — собственные перечислимые свойства, строки и символы, как
     данные: сеттеры цели не вызываются, как и у настоящего spread */
  objectSpread: name => `
function ${name}(target) {
  for (var i = 1; i < arguments.length; i++) {
    var src = arguments[i];
    if (src === null || src === undefined) continue;
    src = Object(src);
    var keys = Object.keys(src);
    if (typeof Object.getOwnPropertySymbols === 'function') {
      var syms = Object.getOwnPropertySymbols(src);
      for (var j = 0; j < syms.length; j++)
        if (Object.prototype.propertyIsEnumerable.call(src, syms[j])) keys.push(syms[j]);
    }
    for (var k = 0; k < keys.length; k++)
      Object.defineProperty(target, keys[k], { value: src[keys[k]], enumerable: true, configurable: true, writable: true });
  }
  return target;
}`,

  /* { a, ...rest } = src — всё собственное перечислимое, кроме названного */
  objectRest: name => `
function ${name}(src, excluded) {
  if (src === null || src === undefined) throw new TypeError('Cannot destructure ' + src);
  src = Object(src);
  var out = {}, keys = Object.keys(src);
  if (typeof Object.getOwnPropertySymbols === 'function') {
    var syms = Object.getOwnPropertySymbols(src);
    for (var j = 0; j < syms.length; j++)
      if (Object.prototype.propertyIsEnumerable.call(src, syms[j])) keys.push(syms[j]);
  }
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i], skip = false;
    for (var e = 0; e < excluded.length; e++)
      if (excluded[e] === k || (typeof excluded[e] !== 'symbol' && typeof k !== 'symbol' && String(excluded[e]) === k)) { skip = true; break; }
    if (!skip) Object.defineProperty(out, k, { value: src[k], enumerable: true, configurable: true, writable: true });
  }
  return out;
}`,

  /* класс без `new` — TypeError, как у настоящего */
  classCheck: name => `
function ${name}(instance, Ctor) {
  if (!(instance instanceof Ctor)) throw new TypeError('Cannot call a class as a function');
}`,

  /* наследование: прототип от родителя, статика — тоже */
  inherits: name => `
function ${name}(Ctor, Super) {
  if (typeof Super !== 'function' && Super !== null)
    throw new TypeError('Class extends value is not a constructor or null');
  Ctor.prototype = Object.create(Super && Super.prototype, {
    constructor: { value: Ctor, writable: true, configurable: true },
  });
  if (Super) {
    if (Object.setPrototypeOf) Object.setPrototypeOf(Ctor, Super);
    else Ctor.__proto__ = Super;
  }
}`,

  /* метод класса — неперечислимый, как у настоящего класса */
  method: name => `
function ${name}(target, key, fn) {
  if (Object.defineProperty) Object.defineProperty(target, key, { value: fn, writable: true, configurable: true, enumerable: false });
  else target[key] = fn;
}`,

  /* get/set: у класса неперечислимый, у литерала объекта — перечислимый */
  accessor: name => `
function ${name}(target, key, get, set, enumerable) {
  var desc = { configurable: true, enumerable: !!enumerable };
  if (get) desc.get = get;
  if (set) desc.set = set;
  Object.defineProperty(target, key, desc);
}`,

  /* super.x — чтение по цепочке прототипов, но геттер зовётся с this
     вызывающего, а не с прототипа */
  superGet: name => `
function ${name}(proto, key, receiver) {
  while (proto) {
    var desc = Object.getOwnPropertyDescriptor(proto, key);
    if (desc) return desc.get ? desc.get.call(receiver) : desc.value;
    proto = Object.getPrototypeOf ? Object.getPrototypeOf(proto) : proto.__proto__;
  }
  return undefined;
}`,

  /* вычисляемый ключ литерала объекта: свойство определяется, где это
     умеет движок (ES5), иначе присваивается (ES3) */
  defineProp: name => `
function ${name}(obj, key, value) {
  if (Object.defineProperty) Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true });
  else obj[key] = value;
  return obj;
}`,

  /* строки шаблона с тегом: массив кусков со своим .raw */
  taggedTemplate: name => `
function ${name}(cooked, raw) {
  cooked.raw = raw;
  if (Object.freeze) { Object.freeze(raw); Object.freeze(cooked); }
  return cooked;
}`,

  /* перебор для for-of: массив, строка, arguments и типизированный
     массив — по индексу (строка — по кодовым точкам), остальное — через
     протокол итератора */
  iter: name => `
function ${name}(obj) {
  if (obj === null || obj === undefined) throw new TypeError(obj + ' is not iterable');
  var kind = Object.prototype.toString.call(obj);
  var typed = typeof obj === 'object' && typeof obj.length === 'number' &&
    obj.buffer !== undefined && typeof obj.byteLength === 'number';
  if (typeof obj === 'string' || kind === '[object Array]' || kind === '[object Arguments]' || typed) {
    var i = 0, str = typeof obj === 'string';
    return { next: function () {
      if (i >= obj.length) return { value: undefined, done: true };
      if (!str) return { value: obj[i++], done: false };
      var c = obj.charCodeAt(i);
      var size = c >= 0xD800 && c <= 0xDBFF && i + 1 < obj.length ? 2 : 1;
      var value = obj.substr(i, size);
      i += size;
      return { value: value, done: false };
    } };
  }
  var f = typeof Symbol === 'function' && Symbol.iterator ? obj[Symbol.iterator] : obj['@@iterator'];
  if (typeof f !== 'function') throw new TypeError(String(obj) + ' is not iterable');
  return f.call(obj);
}`,

  /* ── общее для шимов (*-polyfil.js) ── */

  /* поставить метод, если его ещё нет: неперечислимым, где это умеет
     движок (ES5), иначе — обычным присваиванием (ES3) */
  define: name => `
function ${name}(obj, key, value) {
  if (key in obj) return;
  try { Object.defineProperty(obj, key, { value: value, writable: true, configurable: true, enumerable: false }); }
  catch (e) { obj[key] = value; }
}`,

  /* прототипы типизированных массивов: общий %TypedArray%.prototype, а
     где его нет (движки до ES2015) — прототип каждого конструктора */
  typedArrayProtos: name => `
function ${name}() {
  if (typeof Int8Array === 'undefined') return [];
  var common = Object.getPrototypeOf ? Object.getPrototypeOf(Int8Array.prototype) : null;
  if (common && common !== Object.prototype) return [common];
  var all = [Int8Array, typeof Uint8Array === 'function' ? Uint8Array : null,
    typeof Uint8ClampedArray === 'function' ? Uint8ClampedArray : null,
    typeof Int16Array === 'function' ? Int16Array : null, typeof Uint16Array === 'function' ? Uint16Array : null,
    typeof Int32Array === 'function' ? Int32Array : null, typeof Uint32Array === 'function' ? Uint32Array : null,
    typeof Float32Array === 'function' ? Float32Array : null, typeof Float64Array === 'function' ? Float64Array : null];
  var out = [];
  for (var i = 0; i < all.length; i++) if (all[i]) out.push(all[i].prototype);
  return out;
}`,

  /* глобальный объект без globalThis */
  global: name => `
function ${name}() {
  if (typeof globalThis === 'object' && globalThis) return globalThis;
  if (typeof self !== 'undefined') return self;
  if (typeof window !== 'undefined') return window;
  if (typeof global !== 'undefined') return global;
  return Function('return this')();
}`,

  /* ToIntegerOrInfinity */
  toInt: name => `
function ${name}(x) {
  x = +x;
  if (x !== x) return 0;
  if (x === 0 || x === Infinity || x === -Infinity) return x;
  return x < 0 ? Math.ceil(x) : Math.floor(x);
}`,

  /* перебрать итерируемое или массивоподобное в массив */
  toArray: name => `
function ${name}(items) {
  if (items == null) throw new TypeError(items + ' is not iterable');
  if (Object.prototype.toString.call(items) === '[object Array]') return items.slice();
  if (typeof Symbol === 'function' && typeof items[Symbol.iterator] === 'function') {
    var out = [], it = items[Symbol.iterator](), r;
    while (!(r = it.next()).done) out.push(r.value);
    return out;
  }
  if (typeof items === 'string' || typeof items.length === 'number') return Array.prototype.slice.call(items);
  throw new TypeError(items + ' is not iterable');
}`,

  /* Buffer.alloc(n) вне движковой папки: в node — Buffer, как было в
     исходнике, вне node — Uint8Array той же длины (runtime.js) */
  bufferAlloc: name => `
function ${name}(size) {
  return typeof Buffer === 'function' && typeof Buffer.alloc === 'function' ? Buffer.alloc(size) : new Uint8Array(size);
}`,

  bufferAllocUnsafe: name => `
function ${name}(size) {
  return typeof Buffer === 'function' && typeof Buffer.allocUnsafe === 'function' ? Buffer.allocUnsafe(size) : new Uint8Array(size);
}`,

  /* async-функция поверх генератора: await → yield */
  async: name => `
function ${name}(fn, self, args) {
  return new Promise(function (resolve, reject) {
    var gen = fn.apply(self, args || []);
    function step(method, arg) {
      var r;
      try { r = gen[method](arg); } catch (e) { reject(e); return; }
      if (r.done) resolve(r.value);
      else Promise.resolve(r.value).then(function (v) { step('next', v); }, function (e) { step('throw', e); });
    }
    step('next');
  });
}`,

  /* ── генератор (проход generators) ── */

  /* Машина состояний: body(ctx) исполняет один шаг до ближайшего yield и
     возвращает `{ y: 1, v }` (отдать значение) или `{ y: 0, v }` (кончился).
     Где мы находимся, помнит ctx.next; исключение ищет себе обработчик по
     таблице областей try: [начало, конец, куда прыгать]. Область — это
     диапазон номеров case, а номера растут вместе с текстом, поэтому
     «самая узкая подходящая» и есть самая внутренняя. */
  gen: name => `
function ${name}(body, tries) {
  var done = false, running = false, started = false;
  var ctx = {
    next: 0, prev: 0, sent: undefined, pending: null,
    yield: function (v) { return { y: 1, v: v }; },
    done: function (v) { return { y: 0, v: v }; },
  };
  function handler(pc) {
    var best = null;
    for (var i = 0; i < tries.length; i++) {
      var t = tries[i];
      if (pc < t[0] || pc >= t[1]) continue;
      if (!best || t[0] > best[0] || (t[0] === best[0] && t[1] < best[1])) best = t;
    }
    return best;
  }
  function raise(e) {
    var t = handler(ctx.prev);
    if (!t) { done = true; throw e; }
    ctx.pending = { e: e };
    ctx.next = t[2];
  }
  function run(mode, value) {
    if (done || (mode !== 'next' && !started)) {
      done = true;
      if (mode === 'throw') throw value;
      return { value: mode === 'return' ? value : undefined, done: true };
    }
    if (running) throw new TypeError('Generator is already running');
    running = true;
    try {
      started = true;
      if (mode === 'throw') raise(value);
      else if (mode === 'return') { done = true; return { value: value, done: true }; }
      else ctx.sent = value;
      for (;;) {
        var r;
        try { r = body(ctx); }
        catch (e) { raise(e); continue; }
        if (r.y) return { value: r.v, done: false };
        done = true;
        return { value: r.v, done: true };
      }
    } finally { running = false; }
  }
  var it = {
    next: function (v) { return run('next', v); },
    'throw': function (e) { return run('throw', e); },
    'return': function (v) { return run('return', v); },
  };
  if (typeof Symbol === 'function' && Symbol.iterator) it[Symbol.iterator] = function () { return this; };
  else it['@@iterator'] = function () { return this; };
  return it;
}`,
};
