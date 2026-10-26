/* Object.values, Object.entries — ES2017 */
(function () {
  function own(o, pick) {
    if (o == null) throw new TypeError('Cannot convert undefined or null to object');
    var obj = Object(o), keys = Object.keys(obj), out = [];
    for (var i = 0; i < keys.length; i++)
      if (Object.prototype.propertyIsEnumerable.call(obj, keys[i])) out.push(pick(obj, keys[i]));
    return out;
  }
  __dg_define(Object, 'values', function (o) { return own(o, function (obj, k) { return obj[k]; }); });
  __dg_define(Object, 'entries', function (o) { return own(o, function (obj, k) { return [k, obj[k]]; }); });
})();
