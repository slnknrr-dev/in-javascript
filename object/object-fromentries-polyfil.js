/* Object.fromEntries — ES2019 */
__dg_define(Object, 'fromEntries', function (entries) {
  var list = __dg_toArray(entries), out = {};
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (e === null || (typeof e !== 'object' && typeof e !== 'function'))
      throw new TypeError('Iterator value ' + e + ' is not an entry object');
    /* определение, а не присваивание: ключ __proto__ — обычное свойство */
    Object.defineProperty(out, typeof e[0] === 'symbol' ? e[0] : String(e[0]),
      { value: e[1], writable: true, enumerable: true, configurable: true });
  }
  return out;
});
