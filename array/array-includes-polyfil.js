/* Array.prototype.includes, %TypedArray%.prototype.includes — ES2016;
   String.prototype.includes — ES2015 */
(function () {
  function includes(search, fromIndex) {
    if (this == null) throw new TypeError('includes called on null or undefined');
    var o = Object(this), len = o.length >>> 0;
    if (len === 0) return false;
    var n = __dg_toInt(fromIndex), k = n >= 0 ? n : Math.max(len + n, 0);
    for (; k < len; k++) {
      var v = o[k];
      if (v === search || (v !== v && search !== search)) return true;   /* SameValueZero */
    }
    return false;
  }
  __dg_define(Array.prototype, 'includes', includes);
  var ta = __dg_typedArrayProtos();
  for (var i = 0; i < ta.length; i++) __dg_define(ta[i], 'includes', includes);
  __dg_define(String.prototype, 'includes', function (search, position) {
    if (this == null) throw new TypeError('String.prototype.includes called on null or undefined');
    if (Object.prototype.toString.call(search) === '[object RegExp]')
      throw new TypeError('First argument to String.prototype.includes must not be a regular expression');
    return String(this).indexOf(String(search), position) !== -1;
  });
})();
