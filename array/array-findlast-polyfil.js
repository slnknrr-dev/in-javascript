/* Array.prototype.findLast / findLastIndex и то же у %TypedArray% — ES2023 */
(function () {
  function findLast(fn, thisArg) {
    if (this == null) throw new TypeError('findLast called on null or undefined');
    if (typeof fn !== 'function') throw new TypeError(fn + ' is not a function');
    var o = Object(this);
    for (var i = (o.length >>> 0) - 1; i >= 0; i--) if (fn.call(thisArg, o[i], i, o)) return o[i];
    return undefined;
  }
  function findLastIndex(fn, thisArg) {
    if (this == null) throw new TypeError('findLastIndex called on null or undefined');
    if (typeof fn !== 'function') throw new TypeError(fn + ' is not a function');
    var o = Object(this);
    for (var i = (o.length >>> 0) - 1; i >= 0; i--) if (fn.call(thisArg, o[i], i, o)) return i;
    return -1;
  }
  var owners = [Array.prototype].concat(__dg_typedArrayProtos());
  for (var i = 0; i < owners.length; i++) {
    __dg_define(owners[i], 'findLast', findLast);
    __dg_define(owners[i], 'findLastIndex', findLastIndex);
  }
})();
