/* Object: assign, is, setPrototypeOf, getOwnPropertySymbols — ES2015.

   getOwnPropertySymbols возвращает пустой массив: без настоящего Symbol
   символов в объекте и не бывает (символ шима — обычная строка). */
(function () {
  __dg_define(Object, 'assign', function (target) {
    if (target === null || target === undefined) throw new TypeError('Cannot convert undefined or null to object');
    var to = Object(target);
    for (var i = 1; i < arguments.length; i++) {
      var from = arguments[i];
      if (from === null || from === undefined) continue;
      from = Object(from);
      var keys = Object.keys(from);
      for (var k = 0; k < keys.length; k++) to[keys[k]] = from[keys[k]];
    }
    return to;
  });

  __dg_define(Object, 'is', function (a, b) {
    if (a === b) return a !== 0 || 1 / a === 1 / b;    /* +0 и -0 различны */
    return a !== a && b !== b;                          /* NaN равен NaN */
  });

  __dg_define(Object, 'setPrototypeOf', function (obj, proto) {
    obj.__proto__ = proto;
    return obj;
  });

  __dg_define(Object, 'getOwnPropertySymbols', function () { return []; });
})();
