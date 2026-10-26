/* Object.groupBy, Map.groupBy — ES2024 */
(function () {
  function group(items, fn, add) {
    if (typeof fn !== 'function') throw new TypeError(fn + ' is not a function');
    var list = __dg_toArray(items);
    for (var i = 0; i < list.length; i++) add(fn(list[i], i), list[i]);
  }
  __dg_define(Object, 'groupBy', function (items, fn) {
    var out = Object.create(null);
    group(items, fn, function (key, value) {
      key = typeof key === 'symbol' ? key : String(key);
      if (Object.prototype.hasOwnProperty.call(out, key)) out[key].push(value);
      else out[key] = [value];
    });
    return out;
  });
  if (typeof Map === 'function')
    __dg_define(Map, 'groupBy', function (items, fn) {
      var out = new Map();
      group(items, fn, function (key, value) {
        if (key === 0) key = 0;                             /* -0 → +0, как у Map */
        if (out.has(key)) out.get(key).push(value);
        else out.set(key, [value]);
      });
      return out;
    });
})();
