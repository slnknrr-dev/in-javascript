/* Array.prototype.flat, Array.prototype.flatMap — ES2019 */
(function () {
  function flatten(target, source, depth, mapper, thisArg) {
    for (var i = 0, len = source.length >>> 0; i < len; i++) {
      if (!(i in source)) continue;                          /* дырки пропускаются */
      var el = source[i];
      if (mapper) el = mapper.call(thisArg, el, i, source);
      if (depth > 0 && Object.prototype.toString.call(el) === '[object Array]') flatten(target, el, depth - 1);
      else target.push(el);
    }
    return target;
  }
  __dg_define(Array.prototype, 'flat', function (depth) {
    if (this == null) throw new TypeError('Array.prototype.flat called on null or undefined');
    return flatten([], Object(this), depth === undefined ? 1 : __dg_toInt(depth));
  });
  __dg_define(Array.prototype, 'flatMap', function (fn, thisArg) {
    if (this == null) throw new TypeError('Array.prototype.flatMap called on null or undefined');
    if (typeof fn !== 'function') throw new TypeError('flatMap mapper function is not callable');
    return flatten([], Object(this), 1, fn, thisArg);
  });
})();
