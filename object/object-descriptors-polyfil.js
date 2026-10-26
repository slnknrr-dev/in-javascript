/* Object.getOwnPropertyDescriptors — ES2017 */
__dg_define(Object, 'getOwnPropertyDescriptors', function (o) {
  if (o == null) throw new TypeError('Cannot convert undefined or null to object');
  var obj = Object(o), out = {};
  var keys = Object.getOwnPropertyNames(obj);
  if (typeof Object.getOwnPropertySymbols === 'function') keys = keys.concat(Object.getOwnPropertySymbols(obj));
  for (var i = 0; i < keys.length; i++) {
    var d = Object.getOwnPropertyDescriptor(obj, keys[i]);
    if (d !== undefined) Object.defineProperty(out, keys[i], { value: d, writable: true, enumerable: true, configurable: true });
  }
  return out;
});
