/* toReversed, toSorted, toSpliced, with — копирующие методы массивов
   и типизированных массивов (у последних нет toSpliced) — ES2023 */
(function () {
  function list(self) {
    if (self == null) throw new TypeError('Array method called on null or undefined');
    var o = Object(self), len = o.length >>> 0, out = new Array(len);
    for (var i = 0; i < len; i++) out[i] = o[i];
    return out;
  }
  /* пустой типизированный массив того же типа */
  function sameType(ta, len) { return new (Object.getPrototypeOf(ta).constructor)(len); }

  __dg_define(Array.prototype, 'toReversed', function () { return list(this).reverse(); });
  __dg_define(Array.prototype, 'toSorted', function (cmp) {
    if (cmp !== undefined && typeof cmp !== 'function') throw new TypeError('The comparison function must be either a function or undefined');
    return list(this).sort(cmp);
  });
  __dg_define(Array.prototype, 'toSpliced', function (start, skipCount) {
    var a = list(this), len = a.length, rel = __dg_toInt(start);
    var from = rel < 0 ? Math.max(len + rel, 0) : Math.min(rel, len);
    var skip = arguments.length === 0 ? 0 : arguments.length === 1 ? len - from
      : Math.min(Math.max(__dg_toInt(skipCount), 0), len - from);
    var items = Array.prototype.slice.call(arguments, 2);
    return a.slice(0, from).concat(items, a.slice(from + skip));
  });
  __dg_define(Array.prototype, 'with', function (index, value) {
    var a = list(this), k = __dg_toInt(index);
    if (k < 0) k += a.length;
    if (k < 0 || k >= a.length) throw new RangeError('Invalid index : ' + index);
    a[k] = value;
    return a;
  });

  var ta = __dg_typedArrayProtos();
  for (var i = 0; i < ta.length; i++) {
    __dg_define(ta[i], 'toReversed', function () {
      var len = this.length, out = sameType(this, len);
      for (var k = 0; k < len; k++) out[k] = this[len - 1 - k];
      return out;
    });
    __dg_define(ta[i], 'toSorted', function (cmp) {
      if (cmp !== undefined && typeof cmp !== 'function') throw new TypeError('The comparison function must be either a function or undefined');
      var out = sameType(this, this.length);
      out.set(this);
      return out.sort(cmp);
    });
    __dg_define(ta[i], 'with', function (index, value) {
      var len = this.length, k = __dg_toInt(index);
      if (k < 0) k += len;
      if (k < 0 || k >= len) throw new RangeError('Invalid typed array index');
      var out = sameType(this, len);
      out.set(this);
      out[k] = value;
      return out;
    });
  }
})();
