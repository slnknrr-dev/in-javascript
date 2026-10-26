/* ══════════════════════════════════════════════════════════════════════════
   symbol-shim.js — Symbol для движков, где его нет

   Настоящий символ — отдельный тип значения, которого в ES5 не бывает.
   Здесь символ — уникальная строка вида `@@iterator` или
   `@@desc_17_k3n1`: её можно положить в ключ свойства, сравнить на
   равенство и передать куда угодно, а больше от символа обычно ничего и
   не нужно.

   Чем это отличается от настоящего Symbol, и это видно в коде:

     typeof Symbol() === 'string', а не 'symbol';
     свойство с таким ключом видно в for-in и Object.keys;
     Object.getOwnPropertySymbols его не найдёт.

   Общеизвестные символы получают свои постоянные имена (`@@iterator` и
   так далее) — на них же рассчитывает перебор for-of, когда Symbol'а в
   движке нет. Заодно, если своего Symbol у движка нет, массивы и строки
   получают итератор по этому ключу: без него `arr[Symbol.iterator]()`
   было бы не на чем вызвать.

   Написан на ES5 намеренно: полифил обязан работать там, где нет того,
   что он полифилит.
   ══════════════════════════════════════════════════════════════════════════ */

var counter = 0;
var registry = {};

export function Symbol(description) {
  if (this instanceof Symbol) throw new TypeError('Symbol is not a constructor');
  counter++;
  return '@@' + (description === undefined ? '' : String(description)) +
    '_' + counter + '_' + Math.random().toString(36).slice(2);
}

/* общеизвестные символы — постоянные ключи */
Symbol.iterator = '@@iterator';
Symbol.asyncIterator = '@@asyncIterator';
Symbol.hasInstance = '@@hasInstance';
Symbol.isConcatSpreadable = '@@isConcatSpreadable';
Symbol.match = '@@match';
Symbol.matchAll = '@@matchAll';
Symbol.replace = '@@replace';
Symbol.search = '@@search';
Symbol.species = '@@species';
Symbol.split = '@@split';
Symbol.toPrimitive = '@@toPrimitive';
Symbol.toStringTag = '@@toStringTag';
Symbol.unscopables = '@@unscopables';

/* реестр Symbol.for/keyFor: один и тот же ключ — один и тот же символ */
Symbol['for'] = function (key) {
  var k = String(key);
  if (!Object.prototype.hasOwnProperty.call(registry, k)) registry[k] = '@@for_' + k;
  return registry[k];
};

Symbol.keyFor = function (symbol) {
  for (var k in registry) if (Object.prototype.hasOwnProperty.call(registry, k) && registry[k] === symbol) return k;
  return undefined;
};

/* Итератор массива, строки и arguments по ключу @@iterator — но только
   там, где своего Symbol нет: с настоящим Symbol эти ключи были бы
   лишним мусором в прототипах. */
var hasNative = typeof globalThis === 'object' && globalThis !== null && typeof globalThis.Symbol === 'function';

function define(target, key, value) {
  if (target[key]) return;
  try {
    Object.defineProperty(target, key, { value: value, writable: true, configurable: true, enumerable: false });
  } catch (e) {
    target[key] = value;
  }
}

if (!hasNative) {
  define(Array.prototype, Symbol.iterator, function () {
    var self = this, i = 0;
    return { next: function () { return i < self.length ? { value: self[i++], done: false } : { value: undefined, done: true }; } };
  });

  /* строка перебирается по кодовым точкам, а не по половинкам пар */
  define(String.prototype, Symbol.iterator, function () {
    var self = String(this), i = 0;
    return { next: function () {
      if (i >= self.length) return { value: undefined, done: true };
      var code = self.charCodeAt(i);
      var size = code >= 0xD800 && code <= 0xDBFF && i + 1 < self.length ? 2 : 1;
      var value = self.substr(i, size);
      i += size;
      return { value: value, done: false };
    } };
  });
}
