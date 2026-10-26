/* Array.prototype: forEach, map, filter, some, every, reduce, reduceRight,
   indexOf, lastIndexOf — ES5. Дыры в массиве пропускаются, как в
   спецификации: значение не вычисляется и функция не зовётся. */
(function () {
  var hasOwn = Object.prototype.hasOwnProperty;
  var self = function (list) {
    if (list === null || list === undefined) throw new TypeError('Array.prototype method called on null or undefined');
    return Object(list);
  };
  var callable = function (fn) {
    if (typeof fn !== 'function') throw new TypeError(fn + ' is not a function');
    return fn;
  };

  __dg_define(Array.prototype, 'forEach', function (fn, thisArg) {
    var o = self(this), len = o.length >>> 0;
    callable(fn);
    for (var i = 0; i < len; i++) if (hasOwn.call(o, i)) fn.call(thisArg, o[i], i, o);
  });

  __dg_define(Array.prototype, 'map', function (fn, thisArg) {
    var o = self(this), len = o.length >>> 0, out = new Array(len);
    callable(fn);
    for (var i = 0; i < len; i++) if (hasOwn.call(o, i)) out[i] = fn.call(thisArg, o[i], i, o);
    return out;
  });

  __dg_define(Array.prototype, 'filter', function (fn, thisArg) {
    var o = self(this), len = o.length >>> 0, out = [];
    callable(fn);
    for (var i = 0; i < len; i++)
      if (hasOwn.call(o, i) && fn.call(thisArg, o[i], i, o)) out.push(o[i]);
    return out;
  });

  __dg_define(Array.prototype, 'some', function (fn, thisArg) {
    var o = self(this), len = o.length >>> 0;
    callable(fn);
    for (var i = 0; i < len; i++) if (hasOwn.call(o, i) && fn.call(thisArg, o[i], i, o)) return true;
    return false;
  });

  __dg_define(Array.prototype, 'every', function (fn, thisArg) {
    var o = self(this), len = o.length >>> 0;
    callable(fn);
    for (var i = 0; i < len; i++) if (hasOwn.call(o, i) && !fn.call(thisArg, o[i], i, o)) return false;
    return true;
  });

  __dg_define(Array.prototype, 'reduce', function (fn, initial) {
    var o = self(this), len = o.length >>> 0, i = 0, acc;
    callable(fn);
    if (arguments.length > 1) acc = initial;
    else {
      while (i < len && !hasOwn.call(o, i)) i++;
      if (i >= len) throw new TypeError('Reduce of empty array with no initial value');
      acc = o[i++];
    }
    for (; i < len; i++) if (hasOwn.call(o, i)) acc = fn(acc, o[i], i, o);
    return acc;
  });

  __dg_define(Array.prototype, 'reduceRight', function (fn, initial) {
    var o = self(this), len = o.length >>> 0, i = len - 1, acc;
    callable(fn);
    if (arguments.length > 1) acc = initial;
    else {
      while (i >= 0 && !hasOwn.call(o, i)) i--;
      if (i < 0) throw new TypeError('Reduce of empty array with no initial value');
      acc = o[i--];
    }
    for (; i >= 0; i--) if (hasOwn.call(o, i)) acc = fn(acc, o[i], i, o);
    return acc;
  });

  __dg_define(Array.prototype, 'indexOf', function (value, fromIndex) {
    var o = self(this), len = o.length >>> 0;
    var i = __dg_toInt(fromIndex);
    if (i < 0) i = Math.max(len + i, 0);
    for (; i < len; i++) if (hasOwn.call(o, i) && o[i] === value) return i;
    return -1;
  });

  __dg_define(Array.prototype, 'lastIndexOf', function (value, fromIndex) {
    var o = self(this), len = o.length >>> 0;
    var i = arguments.length > 1 ? __dg_toInt(fromIndex) : len - 1;
    if (i < 0) i += len;
    for (i = Math.min(i, len - 1); i >= 0; i--) if (hasOwn.call(o, i) && o[i] === value) return i;
    return -1;
  });
})();
