/* Array.from, Array.of и методы прототипа: find, findIndex, fill,
   copyWithin, entries, keys, values — ES2015. Те же методы получают и
   типизированные массивы: у них свой прототип. */
(function () {
  __dg_define(Array, 'from', function (source, mapFn, thisArg) {
    var list = __dg_toArray(source);
    var out = new Array(list.length);
    for (var i = 0; i < list.length; i++) out[i] = mapFn ? mapFn.call(thisArg, list[i], i) : list[i];
    return out;
  });

  __dg_define(Array, 'of', function () { return Array.prototype.slice.call(arguments); });

  function find(fn, thisArg) {
    var o = Object(this), len = o.length >>> 0;
    for (var i = 0; i < len; i++) if (fn.call(thisArg, o[i], i, o)) return o[i];
    return undefined;
  }
  function findIndex(fn, thisArg) {
    var o = Object(this), len = o.length >>> 0;
    for (var i = 0; i < len; i++) if (fn.call(thisArg, o[i], i, o)) return i;
    return -1;
  }
  function fill(value, start, end) {
    var o = Object(this), len = o.length >>> 0;
    var from = __dg_toInt(start);
    var to = end === undefined ? len : __dg_toInt(end);
    from = from < 0 ? Math.max(len + from, 0) : Math.min(from, len);
    to = to < 0 ? Math.max(len + to, 0) : Math.min(to, len);
    for (var i = from; i < to; i++) o[i] = value;
    return o;
  }
  function copyWithin(target, start, end) {
    var o = Object(this), len = o.length >>> 0;
    var rel = function (v, whenUndefined) {
      if (v === undefined) return whenUndefined;
      var n = __dg_toInt(v);
      return n < 0 ? Math.max(len + n, 0) : Math.min(n, len);
    };
    var to = rel(target, 0), from = rel(start, 0), last = rel(end, len);
    var count = Math.min(last - from, len - to);
    var values = [];
    for (var i = 0; i < count; i++) values.push(o[from + i]);
    for (var k = 0; k < count; k++) o[to + k] = values[k];
    return o;
  }
  function iterator(o, kind) {
    var i = 0;
    var it = { next: function () {
      var len = o.length >>> 0;
      if (i >= len) return { value: undefined, done: true };
      var index = i++;
      return { value: kind === 'keys' ? index : kind === 'entries' ? [index, o[index]] : o[index], done: false };
    } };
    if (typeof Symbol === 'function' && Symbol.iterator) it[Symbol.iterator] = function () { return this; };
    else it['@@iterator'] = function () { return this; };
    return it;
  }

  var protos = [Array.prototype].concat(__dg_typedArrayProtos());
  for (var p = 0; p < protos.length; p++) {
    __dg_define(protos[p], 'find', find);
    __dg_define(protos[p], 'findIndex', findIndex);
    __dg_define(protos[p], 'fill', fill);
    __dg_define(protos[p], 'copyWithin', copyWithin);
    __dg_define(protos[p], 'entries', function () { return iterator(this, 'entries'); });
    __dg_define(protos[p], 'keys', function () { return iterator(this, 'keys'); });
    __dg_define(protos[p], 'values', function () { return iterator(this, 'values'); });
  }
})();
