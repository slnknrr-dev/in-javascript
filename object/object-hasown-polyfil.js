/* Object.hasOwn — ES2022 */
__dg_define(Object, 'hasOwn', function (o, key) {
  if (o == null) throw new TypeError('Cannot convert undefined or null to object');
  return Object.prototype.hasOwnProperty.call(Object(o), key);
});
