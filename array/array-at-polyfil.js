/* Array.prototype.at, String.prototype.at, %TypedArray%.prototype.at — ES2022 */
(function () {
  function at(index) {
    if (this == null) throw new TypeError('at called on null or undefined');
    var o = Object(this), len = o.length >>> 0, k = __dg_toInt(index);
    if (k < 0) k += len;
    return k < 0 || k >= len ? undefined : o[k];
  }
  __dg_define(Array.prototype, 'at', at);
  var ta = __dg_typedArrayProtos();
  for (var i = 0; i < ta.length; i++) __dg_define(ta[i], 'at', at);
  __dg_define(String.prototype, 'at', function (index) {
    if (this == null) throw new TypeError('String.prototype.at called on null or undefined');
    var s = String(this), k = __dg_toInt(index);
    if (k < 0) k += s.length;
    return k < 0 || k >= s.length ? undefined : s.charAt(k);
  });
})();
